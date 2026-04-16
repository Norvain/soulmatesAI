import crypto from "crypto";
import db from "./db.js";
import { generateImage } from "./minimax.js";
import {
  RELATIONSHIP_EVENT_SEEDS,
  RelationshipChoiceNode,
  RelationshipEventNode,
  RelationshipEventScript,
} from "./relationship-events-data.js";
import { getPresetName, resolvePresetId } from "./preset-characters.js";

type EventStatus = "locked" | "available" | "in_progress" | "completed" | "not_started";
type CgStatus = "idle" | "generating" | "ready" | "failed";

interface TranscriptEntry {
  id: string;
  speaker: "character" | "user";
  text: string;
  created_at: string;
  kind: "dialogue" | "choice" | "ending";
  act: number;
  node_id: string;
}

interface ChoicePathEntry {
  node_id: string;
  choice_id: string;
  label: string;
  emotion_tags: string[];
  selected_at: string;
  act: number;
}

interface EventDefinitionRecord {
  id: string;
  character_id: string;
  title: string;
  description: string;
  cover_image_url: string;
  required_intimacy: number;
  required_stage: string | null;
  prerequisite_event_ids_json: string;
  trigger_context_json: string;
  script_json: string;
  summary_template: string;
  cg_prompt_template: string;
  cg_image_url: string | null;
  sort_order: number;
  is_active: number;
}

interface EventProgressRecord {
  id: string;
  user_id: string;
  chat_id: string;
  event_definition_id: string;
  status: "not_started" | "in_progress" | "completed";
  current_node_id: string | null;
  current_act: number | null;
  choice_path_json: string | null;
  emotion_tags_json: string | null;
  started_at: string | null;
  last_saved_at: string | null;
  completed_at: string | null;
  completion_count: number | null;
  last_playthrough_id: string | null;
}

interface EventPlaythroughRecord {
  id: string;
  user_id: string;
  chat_id: string;
  event_definition_id: string;
  status: "in_progress" | "completed" | "abandoned";
  transcript_json: string | null;
  choice_path_json: string | null;
  emotion_tags_json: string | null;
  started_at: string;
  ended_at: string | null;
  cg_image_url: string | null;
  cg_status: CgStatus | null;
  summary_text: string | null;
}

interface EventRecapRecord {
  event_definition_id: string;
  summary_text: string;
  cg_image_url: string | null;
  cg_status: CgStatus | null;
  updated_at: string | null;
}

interface LoadedEventDefinition {
  id: string;
  characterId: string;
  title: string;
  description: string;
  coverImageUrl: string;
  requiredIntimacy: number;
  prerequisiteEventIds: string[];
  summary: string;
  cgPrompt: string;
  cgImageUrl: string | null;
  sortOrder: number;
  script: RelationshipEventScript;
}

interface ChatRecord {
  id: string;
  user_id: string;
  character_id: string;
}

export interface RelationshipEventCard {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  required_intimacy: number;
  status: EventStatus;
  locked_reason: string | null;
  progress_percent: number;
  current_act: number;
  total_acts: number;
  completion_count: number;
  last_saved_at: string | null;
  completed_at: string | null;
  last_summary: string | null;
  last_cg_image_url: string | null;
}

export interface RelationshipEventSession {
  event: RelationshipEventCard;
  session_status: EventStatus;
  transcript: TranscriptEntry[];
  current_choices: { id: string; label: string }[];
  current_node_id: string | null;
  choice_path: ChoicePathEntry[];
  emotion_tags: string[];
  started_at: string | null;
  last_saved_at: string | null;
  completed_at: string | null;
  cg_image_url: string | null;
  cg_status: CgStatus;
  summary_text: string | null;
}

export interface RelationshipEventHistory {
  event: RelationshipEventCard;
  status: "in_progress" | "completed" | "abandoned";
  transcript: TranscriptEntry[];
  choice_path: ChoicePathEntry[];
  emotion_tags: string[];
  started_at: string;
  ended_at: string | null;
  cg_image_url: string | null;
  cg_status: CgStatus;
  summary_text: string | null;
}

export class RelationshipEventError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadChat(userId: string, chatId: string): ChatRecord {
  const chat = db.prepare(
    "SELECT id, user_id, character_id FROM chats WHERE id = ? AND user_id = ?"
  ).get(chatId, userId) as ChatRecord | undefined;
  if (!chat) {
    throw new RelationshipEventError(404, "聊天不存在");
  }
  return chat;
}

function loadDefinitionsForCharacter(characterId: string): LoadedEventDefinition[] {
  const resolvedCharacterId = resolvePresetId(characterId);
  const rows = db.prepare(
    `SELECT *
     FROM relationship_event_definitions
     WHERE character_id = ? AND is_active = 1
     ORDER BY sort_order ASC, required_intimacy ASC`
  ).all(resolvedCharacterId) as EventDefinitionRecord[];

  return rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    description: row.description,
    coverImageUrl: row.cover_image_url,
    requiredIntimacy: row.required_intimacy,
    prerequisiteEventIds: parseJSON<string[]>(row.prerequisite_event_ids_json, []),
    summary: row.summary_template,
    cgPrompt: row.cg_prompt_template,
    cgImageUrl: row.cg_image_url || null,
    sortOrder: row.sort_order,
    script: parseJSON<RelationshipEventScript>(row.script_json, { startNodeId: "", totalActs: 0, nodes: [] }),
  }));
}

function loadDefinitionOrThrow(characterId: string, eventId: string): LoadedEventDefinition {
  const definition = loadDefinitionsForCharacter(characterId).find((item) => item.id === eventId);
  if (!definition) {
    throw new RelationshipEventError(404, "关系事件不存在");
  }
  return definition;
}

function loadRelationState(chatId: string) {
  return db.prepare(
    "SELECT intimacy_score, unlocked_events FROM relation_states WHERE chat_id = ?"
  ).get(chatId) as { intimacy_score?: number; unlocked_events?: string } | undefined;
}

function loadProgressMap(userId: string, chatId: string) {
  const rows = db.prepare(
    "SELECT * FROM relationship_event_progress WHERE user_id = ? AND chat_id = ?"
  ).all(userId, chatId) as EventProgressRecord[];
  return new Map(rows.map((row) => [row.event_definition_id, row]));
}

function loadRecapMap(userId: string, chatId: string) {
  const rows = db.prepare(
    `SELECT event_definition_id, summary_text, cg_image_url, cg_status, updated_at
     FROM relationship_event_recaps
     WHERE user_id = ? AND chat_id = ?`
  ).all(userId, chatId) as EventRecapRecord[];
  return new Map(rows.map((row) => [row.event_definition_id, row]));
}

function getCompletedEventIds(
  relationState: { unlocked_events?: string } | undefined,
  progressMap: Map<string, EventProgressRecord>,
  recapMap: Map<string, EventRecapRecord>
) {
  const completed = new Set<string>(parseJSON<string[]>(relationState?.unlocked_events, []));
  for (const [eventId, row] of progressMap) {
    if (row.status === "completed") completed.add(eventId);
  }
  for (const eventId of recapMap.keys()) completed.add(eventId);
  return completed;
}

function getTotalChoiceCount(script: RelationshipEventScript) {
  return script.nodes.filter((node) => node.type === "choice").length;
}

function computeProgressPercent(script: RelationshipEventScript, choicePathLength: number, isCompleted: boolean) {
  if (isCompleted) return 100;
  const totalChoices = getTotalChoiceCount(script);
  if (!totalChoices) return 0;
  return Math.min(99, Math.round((choicePathLength / totalChoices) * 100));
}

function isDefinitionAvailable(definition: LoadedEventDefinition, intimacy: number, completedIds: Set<string>) {
  const requiredScore = Math.max(0, definition.requiredIntimacy - 1);
  const meetsIntimacy = intimacy >= requiredScore;
  const meetsPrerequisites = definition.prerequisiteEventIds.every((eventId) => completedIds.has(eventId));
  return meetsIntimacy && meetsPrerequisites;
}

function getLockedReason(definition: LoadedEventDefinition, intimacy: number, completedIds: Set<string>) {
  const missingPrerequisite = definition.prerequisiteEventIds.find((eventId) => !completedIds.has(eventId));
  if (missingPrerequisite) {
    return "需先完成上一关系事件";
  }
  const requiredScore = Math.max(0, definition.requiredIntimacy - 1);
  if (intimacy < requiredScore) {
    return `亲密度达到 ${definition.requiredIntimacy} 解锁`;
  }
  return null;
}

function buildEventCard(
  definition: LoadedEventDefinition,
  progress: EventProgressRecord | undefined,
  recap: EventRecapRecord | undefined,
  intimacy: number,
  completedIds: Set<string>
): RelationshipEventCard {
  const choicePath = parseJSON<ChoicePathEntry[]>(progress?.choice_path_json, []);
  const isCompleted = progress?.status === "completed" || completedIds.has(definition.id);

  let status: EventStatus = "locked";
  if (progress?.status === "in_progress") status = "in_progress";
  else if (isCompleted) status = "completed";
  else if (isDefinitionAvailable(definition, intimacy, completedIds)) status = "available";

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    cover_image_url: definition.coverImageUrl,
    required_intimacy: definition.requiredIntimacy,
    status,
    locked_reason: status === "locked" ? getLockedReason(definition, intimacy, completedIds) : null,
    progress_percent: computeProgressPercent(definition.script, choicePath.length, status === "completed"),
    current_act: progress?.current_act || 0,
    total_acts: definition.script.totalActs,
    completion_count: progress?.completion_count || 0,
    last_saved_at: progress?.last_saved_at || null,
    completed_at: progress?.completed_at || null,
    last_summary: recap?.summary_text || null,
    last_cg_image_url: recap?.cg_image_url || null,
  };
}

function buildNodeMap(script: RelationshipEventScript) {
  return new Map(script.nodes.map((node) => [node.id, node]));
}

function createTranscriptEntry(
  speaker: "character" | "user",
  text: string,
  kind: "dialogue" | "choice" | "ending",
  act: number,
  nodeId: string
): TranscriptEntry {
  return {
    id: crypto.randomUUID(),
    speaker,
    text,
    kind,
    act,
    node_id: nodeId,
    created_at: new Date().toISOString(),
  };
}

function advanceTranscript(
  script: RelationshipEventScript,
  nextNodeId: string,
  existingTranscript: TranscriptEntry[]
) {
  const transcript = [...existingTranscript];
  const nodeMap = buildNodeMap(script);
  let node = nodeMap.get(nextNodeId);

  while (node) {
    if (node.type === "dialogue") {
      for (const line of node.lines) {
        transcript.push(createTranscriptEntry("character", line, "dialogue", node.act, node.id));
      }
      node = node.nextNodeId ? nodeMap.get(node.nextNodeId) : undefined;
      continue;
    }

    if (node.type === "choice") {
      return { transcript, currentChoiceNode: node, endingNode: null as RelationshipEventNode | null };
    }

    if (node.type === "ending") {
      for (const line of node.lines) {
        transcript.push(createTranscriptEntry("character", line, "ending", node.act, node.id));
      }
      return { transcript, currentChoiceNode: null as RelationshipChoiceNode | null, endingNode: node };
    }
  }

  return { transcript, currentChoiceNode: null as RelationshipChoiceNode | null, endingNode: null as RelationshipEventNode | null };
}

function loadProgress(userId: string, chatId: string, eventId: string) {
  return db.prepare(
    `SELECT *
     FROM relationship_event_progress
     WHERE user_id = ? AND chat_id = ? AND event_definition_id = ?`
  ).get(userId, chatId, eventId) as EventProgressRecord | undefined;
}

function loadPlaythroughById(playthroughId: string | null | undefined) {
  if (!playthroughId) return null;
  return db.prepare(
    "SELECT * FROM relationship_event_playthroughs WHERE id = ?"
  ).get(playthroughId) as EventPlaythroughRecord | undefined;
}

function loadLatestPlaythrough(userId: string, chatId: string, eventId: string) {
  return db.prepare(
    `SELECT *
     FROM relationship_event_playthroughs
     WHERE user_id = ? AND chat_id = ? AND event_definition_id = ?
     ORDER BY datetime(started_at) DESC, started_at DESC
     LIMIT 1`
  ).get(userId, chatId, eventId) as EventPlaythroughRecord | undefined;
}

function loadLatestCompletedPlaythrough(userId: string, chatId: string, eventId: string) {
  return db.prepare(
    `SELECT *
     FROM relationship_event_playthroughs
     WHERE user_id = ? AND chat_id = ? AND event_definition_id = ? AND status = 'completed'
     ORDER BY datetime(ended_at) DESC, ended_at DESC, datetime(started_at) DESC
     LIMIT 1`
  ).get(userId, chatId, eventId) as EventPlaythroughRecord | undefined;
}

function buildSessionPayload(
  card: RelationshipEventCard,
  definition: LoadedEventDefinition,
  progress: EventProgressRecord | undefined,
  playthrough: EventPlaythroughRecord | undefined
): RelationshipEventSession {
  const transcript = parseJSON<TranscriptEntry[]>(playthrough?.transcript_json, []);
  const choicePath = parseJSON<ChoicePathEntry[]>(playthrough?.choice_path_json || progress?.choice_path_json, []);
  const emotionTags = parseJSON<string[]>(playthrough?.emotion_tags_json || progress?.emotion_tags_json, []);
  const nodeMap = buildNodeMap(definition.script);
  const currentNode = progress?.current_node_id ? nodeMap.get(progress.current_node_id) : undefined;
  const currentChoices = currentNode?.type === "choice"
    ? currentNode.choices.map((item) => ({ id: item.id, label: item.label }))
    : [];

  return {
    event: card,
    session_status: progress?.status || "not_started",
    transcript,
    current_choices: currentChoices,
    current_node_id: progress?.current_node_id || null,
    choice_path: choicePath,
    emotion_tags: emotionTags,
    started_at: progress?.started_at || playthrough?.started_at || null,
    last_saved_at: progress?.last_saved_at || null,
    completed_at: progress?.completed_at || playthrough?.ended_at || null,
    cg_image_url: playthrough?.cg_image_url || card.last_cg_image_url || null,
    cg_status: (playthrough?.cg_status || (playthrough?.cg_image_url ? "ready" : "idle")) as CgStatus,
    summary_text: playthrough?.summary_text || card.last_summary || null,
  };
}

function upsertRelationshipRecap(params: {
  userId: string;
  chatId: string;
  eventId: string;
  title: string;
  summary: string;
  cgImageUrl: string | null;
  cgStatus: CgStatus;
  characterId: string;
  characterName: string;
  timestamp: string;
}) {
  db.prepare(
    `INSERT INTO relationship_event_recaps
      (id, user_id, chat_id, event_definition_id, event_title, summary_text, cg_image_url, cg_status, character_id, character_name, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, chat_id, event_definition_id) DO UPDATE SET
       event_title = excluded.event_title,
       summary_text = excluded.summary_text,
       cg_image_url = excluded.cg_image_url,
       cg_status = excluded.cg_status,
       character_id = excluded.character_id,
       character_name = excluded.character_name,
       updated_at = excluded.updated_at`
  ).run(
    crypto.randomUUID(),
    params.userId,
    params.chatId,
    params.eventId,
    params.title,
    params.summary,
    params.cgImageUrl,
    params.cgStatus,
    params.characterId,
    params.characterName,
    params.timestamp,
    params.timestamp
  );
}

function scheduleRelationshipEventCgGeneration(params: {
  userId: string;
  chatId: string;
  eventId: string;
  playthroughId: string;
  definition: LoadedEventDefinition;
  characterId: string;
  characterName: string;
}) {
  queueMicrotask(async () => {
    let cgImageUrl: string | null = params.definition.cgImageUrl || null;
    let cgStatus: CgStatus = "ready";

    if (!cgImageUrl) {
      try {
        cgImageUrl = await generateImage(params.definition.cgPrompt);
      } catch (error) {
        cgStatus = "failed";
        console.error("[RelationshipEvent] CG generation failed:", error);
      }
    }

    const finishedAt = new Date().toISOString();

    db.prepare(
      `UPDATE relationship_event_playthroughs
       SET cg_image_url = ?, cg_status = ?, summary_text = COALESCE(summary_text, ?)
       WHERE id = ?`
    ).run(cgImageUrl, cgStatus, params.definition.summary, params.playthroughId);

    const progress = db.prepare(
      `SELECT last_playthrough_id
       FROM relationship_event_progress
       WHERE user_id = ? AND chat_id = ? AND event_definition_id = ?`
    ).get(params.userId, params.chatId, params.eventId) as { last_playthrough_id?: string | null } | undefined;

    if (progress?.last_playthrough_id === params.playthroughId) {
      upsertRelationshipRecap({
        userId: params.userId,
        chatId: params.chatId,
        eventId: params.eventId,
        title: params.definition.title,
        summary: params.definition.summary,
        cgImageUrl,
        cgStatus,
        characterId: params.characterId,
        characterName: params.characterName,
        timestamp: finishedAt,
      });
    }
  });
}

function updateUnlockedEvents(chatId: string, eventId: string) {
  const row = db.prepare(
    "SELECT unlocked_events FROM relation_states WHERE chat_id = ?"
  ).get(chatId) as { unlocked_events?: string } | undefined;
  const nextEvents = new Set(parseJSON<string[]>(row?.unlocked_events, []));
  nextEvents.add(eventId);
  db.prepare(
    "UPDATE relation_states SET unlocked_events = ? WHERE chat_id = ?"
  ).run(JSON.stringify(Array.from(nextEvents)), chatId);
}

function upsertRelationshipMemory(chatId: string, eventId: string, title: string, summary: string) {
  db.prepare(
    "DELETE FROM memories WHERE chat_id = ? AND type = 'relationship_event' AND keyphrase = ?"
  ).run(chatId, eventId);

  db.prepare(
    `INSERT INTO memories (id, chat_id, type, summary, keyphrase, salience)
     VALUES (?,?,?,?,?,?)`
  ).run(crypto.randomUUID(), chatId, "relationship_event", `${title}：${summary}`, eventId, 10);
}

export function getRelationshipEventsForChat(userId: string, chatId: string): RelationshipEventCard[] {
  const chat = loadChat(userId, chatId);
  const definitions = loadDefinitionsForCharacter(chat.character_id);
  if (!definitions.length) return [];

  const relationState = loadRelationState(chatId);
  const intimacy = relationState?.intimacy_score || 0;
  const progressMap = loadProgressMap(userId, chatId);
  const recapMap = loadRecapMap(userId, chatId);
  const completedIds = getCompletedEventIds(relationState, progressMap, recapMap);

  return definitions.map((definition) =>
    buildEventCard(
      definition,
      progressMap.get(definition.id),
      recapMap.get(definition.id),
      intimacy,
      completedIds
    )
  );
}

export function getRelationshipEventSession(userId: string, chatId: string, eventId: string): RelationshipEventSession {
  const chat = loadChat(userId, chatId);
  const definition = loadDefinitionOrThrow(chat.character_id, eventId);
  const cards = getRelationshipEventsForChat(userId, chatId);
  const card = cards.find((item) => item.id === eventId);
  if (!card) {
    throw new RelationshipEventError(404, "关系事件不存在");
  }

  const progress = loadProgress(userId, chatId, eventId);
  const playthrough = progress?.last_playthrough_id
    ? loadPlaythroughById(progress.last_playthrough_id)
    : loadLatestPlaythrough(userId, chatId, eventId);

  return buildSessionPayload(card, definition, progress, playthrough || undefined);
}

export function getRelationshipEventHistory(userId: string, chatId: string, eventId: string): RelationshipEventHistory {
  const chat = loadChat(userId, chatId);
  const definition = loadDefinitionOrThrow(chat.character_id, eventId);
  const card = getRelationshipEventsForChat(userId, chatId).find((item) => item.id === eventId);
  if (!card) {
    throw new RelationshipEventError(404, "关系事件不存在");
  }

  const playthrough =
    loadLatestCompletedPlaythrough(userId, chatId, eventId) ||
    loadLatestPlaythrough(userId, chatId, eventId);

  if (!playthrough) {
    throw new RelationshipEventError(404, "暂无剧情记录");
  }

  return {
    event: card,
    status: playthrough.status,
    transcript: parseJSON<TranscriptEntry[]>(playthrough.transcript_json, []),
    choice_path: parseJSON<ChoicePathEntry[]>(playthrough.choice_path_json, []),
    emotion_tags: parseJSON<string[]>(playthrough.emotion_tags_json, []),
    started_at: playthrough.started_at,
    ended_at: playthrough.ended_at,
    cg_image_url: playthrough.cg_image_url,
    cg_status: (playthrough.cg_status || (playthrough.cg_image_url ? "ready" : "idle")) as CgStatus,
    summary_text: playthrough.summary_text,
  };
}

export function startRelationshipEvent(
  userId: string,
  chatId: string,
  eventId: string,
  mode: "start" | "replay" = "start"
): RelationshipEventSession {
  const chat = loadChat(userId, chatId);
  const definition = loadDefinitionOrThrow(chat.character_id, eventId);
  const cards = getRelationshipEventsForChat(userId, chatId);
  const card = cards.find((item) => item.id === eventId);

  if (!card) {
    throw new RelationshipEventError(404, "关系事件不存在");
  }
  if (card.status === "locked") {
    throw new RelationshipEventError(400, card.locked_reason || "当前无法进入该剧情");
  }
  if (card.status === "completed" && mode !== "replay") {
    throw new RelationshipEventError(409, "该剧情已完成");
  }
  if (card.status === "in_progress" && mode !== "replay") {
    return getRelationshipEventSession(userId, chatId, eventId);
  }

  const existingProgress = loadProgress(userId, chatId, eventId);
  if (mode === "replay" && existingProgress?.last_playthrough_id) {
    db.prepare(
      "UPDATE relationship_event_playthroughs SET status = CASE WHEN status = 'in_progress' THEN 'abandoned' ELSE status END WHERE id = ?"
    ).run(existingProgress.last_playthrough_id);
  }

  const startedAt = new Date().toISOString();
  const playthroughId = crypto.randomUUID();
  const firstPass = advanceTranscript(definition.script, definition.script.startNodeId, []);
  const currentChoiceNode = firstPass.currentChoiceNode;
  const currentAct = currentChoiceNode?.act || definition.script.totalActs;

  db.prepare(
    `INSERT INTO relationship_event_playthroughs
      (id, user_id, chat_id, event_definition_id, status, transcript_json, choice_path_json, emotion_tags_json, started_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    playthroughId,
    userId,
    chatId,
    eventId,
    "in_progress",
    JSON.stringify(firstPass.transcript),
    "[]",
    "[]",
    startedAt
  );

  const progressId = existingProgress?.id || crypto.randomUUID();
  const completionCount = existingProgress?.completion_count || 0;
  db.prepare(
    `INSERT INTO relationship_event_progress
      (id, user_id, chat_id, event_definition_id, status, current_node_id, current_act, choice_path_json,
       emotion_tags_json, started_at, last_saved_at, completed_at, completion_count, last_playthrough_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, chat_id, event_definition_id) DO UPDATE SET
       status = excluded.status,
       current_node_id = excluded.current_node_id,
       current_act = excluded.current_act,
       choice_path_json = excluded.choice_path_json,
       emotion_tags_json = excluded.emotion_tags_json,
       started_at = excluded.started_at,
       last_saved_at = excluded.last_saved_at,
       completed_at = NULL,
       last_playthrough_id = excluded.last_playthrough_id`
  ).run(
    progressId,
    userId,
    chatId,
    eventId,
    "in_progress",
    currentChoiceNode?.id || null,
    currentAct,
    "[]",
    "[]",
    startedAt,
    startedAt,
    null,
    completionCount,
    playthroughId
  );

  return getRelationshipEventSession(userId, chatId, eventId);
}

export async function chooseRelationshipEventOption(
  userId: string,
  chatId: string,
  eventId: string,
  choiceId: string
): Promise<RelationshipEventSession> {
  const chat = loadChat(userId, chatId);
  const definition = loadDefinitionOrThrow(chat.character_id, eventId);
  const progress = loadProgress(userId, chatId, eventId);
  if (!progress || progress.status !== "in_progress" || !progress.current_node_id) {
    throw new RelationshipEventError(400, "当前没有可继续的剧情");
  }

  const playthrough =
    loadPlaythroughById(progress.last_playthrough_id) ||
    loadLatestPlaythrough(userId, chatId, eventId);

  if (!playthrough) {
    throw new RelationshipEventError(404, "剧情记录不存在");
  }

  const nodeMap = buildNodeMap(definition.script);
  const currentNode = nodeMap.get(progress.current_node_id);
  if (!currentNode || currentNode.type !== "choice") {
    throw new RelationshipEventError(400, "当前节点不可选择");
  }

  const selectedChoice = currentNode.choices.find((item) => item.id === choiceId);
  if (!selectedChoice) {
    throw new RelationshipEventError(400, "选项不存在");
  }

  const transcript = parseJSON<TranscriptEntry[]>(playthrough.transcript_json, []);
  transcript.push(createTranscriptEntry("user", selectedChoice.label, "choice", currentNode.act, currentNode.id));

  const choicePath = parseJSON<ChoicePathEntry[]>(playthrough.choice_path_json, []);
  choicePath.push({
    node_id: currentNode.id,
    choice_id: selectedChoice.id,
    label: selectedChoice.label,
    emotion_tags: selectedChoice.emotionTags || [],
    selected_at: new Date().toISOString(),
    act: currentNode.act,
  });

  const emotionTags = Array.from(new Set([
    ...parseJSON<string[]>(playthrough.emotion_tags_json, []),
    ...(selectedChoice.emotionTags || []),
  ]));

  const advanced = advanceTranscript(definition.script, selectedChoice.nextNodeId, transcript);
  const now = new Date().toISOString();

  if (advanced.endingNode) {
    db.prepare(
      `UPDATE relationship_event_playthroughs
       SET status = 'completed',
           transcript_json = ?,
           choice_path_json = ?,
           emotion_tags_json = ?,
           ended_at = ?,
           cg_image_url = ?,
           cg_status = ?,
           summary_text = ?
       WHERE id = ?`
    ).run(
      JSON.stringify(advanced.transcript),
      JSON.stringify(choicePath),
      JSON.stringify(emotionTags),
      now,
      null,
      "generating",
      definition.summary,
      playthrough.id
    );

    db.prepare(
      `UPDATE relationship_event_progress
       SET status = 'completed',
           current_node_id = NULL,
           current_act = ?,
           choice_path_json = ?,
           emotion_tags_json = ?,
           last_saved_at = ?,
           completed_at = ?,
           completion_count = ?,
           last_playthrough_id = ?
       WHERE id = ?`
    ).run(
      definition.script.totalActs,
      JSON.stringify(choicePath),
      JSON.stringify(emotionTags),
      now,
      now,
      (progress.completion_count || 0) + 1,
      playthrough.id,
      progress.id
    );

    const characterName = getPresetName(chat.character_id) || "AI";
    const hasPregeneratedCg = !!definition.cgImageUrl;
    upsertRelationshipRecap({
      userId,
      chatId,
      eventId,
      title: definition.title,
      summary: definition.summary,
      cgImageUrl: hasPregeneratedCg ? definition.cgImageUrl : null,
      cgStatus: hasPregeneratedCg ? "ready" : "generating",
      characterId: resolvePresetId(chat.character_id),
      characterName,
      timestamp: now,
    });

    updateUnlockedEvents(chatId, eventId);
    upsertRelationshipMemory(chatId, eventId, definition.title, definition.summary);
    scheduleRelationshipEventCgGeneration({
      userId,
      chatId,
      eventId,
      playthroughId: playthrough.id,
      definition,
      characterId: resolvePresetId(chat.character_id),
      characterName,
    });

    return getRelationshipEventSession(userId, chatId, eventId);
  }

  db.prepare(
    `UPDATE relationship_event_playthroughs
     SET transcript_json = ?,
         choice_path_json = ?,
         emotion_tags_json = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(advanced.transcript),
    JSON.stringify(choicePath),
    JSON.stringify(emotionTags),
    playthrough.id
  );

  db.prepare(
    `UPDATE relationship_event_progress
     SET status = 'in_progress',
         current_node_id = ?,
         current_act = ?,
         choice_path_json = ?,
         emotion_tags_json = ?,
         last_saved_at = ?,
         last_playthrough_id = ?
     WHERE id = ?`
  ).run(
    advanced.currentChoiceNode?.id || null,
    advanced.currentChoiceNode?.act || definition.script.totalActs,
    JSON.stringify(choicePath),
    JSON.stringify(emotionTags),
    now,
    playthrough.id,
    progress.id
  );

  return getRelationshipEventSession(userId, chatId, eventId);
}

export function getRelationshipEventSeedRows() {
  return RELATIONSHIP_EVENT_SEEDS.map((seed) => ({
    id: seed.id,
    character_id: seed.characterId,
    title: seed.title,
    description: seed.description,
    cover_image_url: seed.coverImageUrl,
    required_intimacy: seed.requiredIntimacy,
    required_stage: null,
    prerequisite_event_ids_json: JSON.stringify(seed.prerequisiteEventIds),
    trigger_context_json: "{}",
    script_json: JSON.stringify(seed.script),
    summary_template: seed.summary,
    cg_prompt_template: seed.cgPrompt,
    sort_order: seed.sortOrder,
    is_active: 1,
  }));
}
