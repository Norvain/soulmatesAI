import crypto from "crypto";
import db from "./db.js";
import {
  chatCompletion,
  chatCompletionJSON,
  detectIntent,
  generateImage,
  textToSpeech,
  type ChatMessage,
} from "./minimax.js";
import {
  PRESET_MAP,
  getPresetGreeting,
  getPresetName,
  getPresetOverview,
  getPresetPersona,
  resolvePresetId,
  getPresetVoiceId,
  getPresetAppearance,
} from "./preset-characters.js";

const SEGMENT_DELAY_MS = 1000;
const PROACTIVE_POLL_INTERVAL_MS = 60 * 1000;
const PROACTIVE_DEFAULT_TIMEZONE = "Asia/Shanghai";

type QueueSourceType = "user" | "proactive";
type MessageType = "reply" | "proactive";

interface QueueTurn {
  id: string;
  chat_id: string;
  user_message_id: string | null;
  source_type: QueueSourceType;
  status: "queued" | "processing" | "completed" | "failed";
  metadata_json: string | null;
  created_at: string;
}

interface TurnMetadata {
  text?: string;
  imageUrl?: string | null;
  voiceInput?: boolean;
  momentContext?: string | null;
  proactiveType?: "sleep" | "greeting";
  slotKey?: string;
}

interface ChatContext {
  character: any;
  profile: any;
  relationState: any;
  recentMemories: any[];
  snapshot: any;
  history: Array<{ role: "user" | "model"; text: string | null }>;
  charName: string;
  charPersona: string;
  charOverview: string;
  charAppearance: string;
  charGreeting: string;
  charVoiceId: string;
  userName: string;
  memoryContext: string;
  snapshotContext: string;
  stage: string;
  intimacy: number;
}

interface QueueUserTurnInput {
  chatId: string;
  userId: string;
  userMessageId: string;
  text?: string;
  imageUrl?: string | null;
  voiceInput?: boolean;
  momentContext?: string | null;
}

interface QueueProactiveTurnInput {
  chatId: string;
  userId: string;
  proactiveType: "sleep" | "greeting";
  slotKey: string;
}

const activeChatProcessors = new Set<string>();
let runtimeStarted = false;

function isAccessibleCharacterId(characterId: string, userId: string) {
  if (PRESET_MAP[resolvePresetId(characterId)]) {
    return true;
  }

  const row = db.prepare("SELECT 1 FROM characters WHERE id = ? AND user_id = ? LIMIT 1").get(characterId, userId);
  return !!row;
}

function hasOfficialRelationshipEvents(characterId: string) {
  const resolvedCharacterId = resolvePresetId(characterId);
  const row = db.prepare(
    "SELECT 1 FROM relationship_event_definitions WHERE character_id = ? AND is_active = 1 LIMIT 1"
  ).get(resolvedCharacterId);
  return !!row;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIsoNow() {
  return new Date().toISOString();
}

function safeTimeZone(timezone?: string | null) {
  const candidate = timezone?.trim();
  if (!candidate) return PROACTIVE_DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return PROACTIVE_DEFAULT_TIMEZONE;
  }
}

function getLocalParts(date: Date, timezone?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const year = Number(parts.year || 0);
  const month = Number(parts.month || 0);
  const day = Number(parts.day || 0);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);

  return {
    dateKey: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

function normalizeSegments(reply: string, forceSingleSegment = false) {
  const cleaned = (reply || "")
    .replace(/\r/g, "")
    .replace(/^\s*["'「『]+|["'」』]+\s*$/g, "")
    .trim();

  if (!cleaned) return ["……"];
  if (forceSingleSegment) return [cleaned.replace(/<<SEG>>/g, " ").trim()];

  const markerSplit = cleaned
    .split(/<<SEG>>|<SEG>/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (markerSplit.length > 1) {
    return markerSplit.slice(0, 3);
  }

  const paragraphSplit = cleaned
    .split(/\n{2,}|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphSplit.length > 1) {
    return paragraphSplit.slice(0, 3);
  }

  const sentenceParts = cleaned
    .split(/(?<=[。！？!?])/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return [cleaned];
  }

  const segments: string[] = [];
  let current = "";
  for (const sentence of sentenceParts) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current + sentence).length <= 34 && segments.length < 2) {
      current += sentence;
      continue;
    }
    segments.push(current);
    current = sentence;
    if (segments.length >= 2) break;
  }
  if (current) segments.push(current);
  return segments.slice(0, 3);
}

function getChatOwnership(chatId: string, userId: string) {
  return db.prepare("SELECT id FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId) as any;
}

function getChatRuntimeRow(chatId: string) {
  return db.prepare(
    "SELECT reply_state, unread_ai_count, pending_turns_count, proactive_silenced FROM chats WHERE id = ?"
  ).get(chatId) as any;
}

function refreshPendingTurns(chatId: string) {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM chat_turn_queue WHERE chat_id = ? AND status IN ('queued', 'processing')"
  ).get(chatId) as { count: number } | undefined;
  const count = row?.count || 0;
  const replyState = count > 0 || activeChatProcessors.has(chatId) ? "processing" : "idle";
  db.prepare("UPDATE chats SET pending_turns_count = ?, reply_state = ? WHERE id = ?").run(count, replyState, chatId);
  return { pending_turns_count: count, reply_state: replyState };
}

function loadChatContext(chatId: string, userId: string, turn?: QueueTurn): ChatContext {
  const chat = db.prepare(
    "SELECT character_id, user_id FROM chats WHERE id = ? AND user_id = ?"
  ).get(chatId, userId) as { character_id?: string; user_id?: string } | undefined;
  const characterKey = chat?.character_id || chatId;
  const character = chat && !PRESET_MAP[resolvePresetId(chat.character_id || "")]
    ? db.prepare("SELECT * FROM characters WHERE id = ? AND user_id = ?").get(chat.character_id, chat.user_id) as any
    : null;
  const profile = db.prepare(
    "SELECT id, preferred_name, comfort_style, proactive_timezone FROM users WHERE id = ?"
  ).get(userId) as any;
  const relationState = db.prepare("SELECT * FROM relation_states WHERE chat_id = ?").get(chatId) as any;
  const recentMemories = db.prepare(
    "SELECT * FROM memories WHERE chat_id = ? ORDER BY created_at DESC LIMIT 5"
  ).all(chatId) as any[];
  const snapshot = db.prepare("SELECT * FROM session_snapshots WHERE chat_id = ?").get(chatId) as any;
  let historyRows: any[] = [];
  if (turn) {
    const futureUserRows = db.prepare(
      `SELECT user_message_id
       FROM chat_turn_queue
       WHERE chat_id = ?
         AND user_message_id IS NOT NULL
         AND status IN ('queued', 'processing')
         AND created_at > ?`
    ).all(chatId, turn.created_at) as Array<{ user_message_id: string }>;

    const futureUserIds = futureUserRows.map((row) => row.user_message_id).filter(Boolean);
    if (futureUserIds.length > 0) {
      historyRows = db.prepare(
        `SELECT role, text
         FROM messages
         WHERE chat_id = ?
           AND (role = 'model' OR id NOT IN (${futureUserIds.map(() => "?").join(",")}))
         ORDER BY datetime(created_at) DESC, created_at DESC
         LIMIT 30`
      ).all(chatId, ...futureUserIds) as any[];
    } else {
      historyRows = db.prepare(
        "SELECT role, text FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC, created_at DESC LIMIT 30"
      ).all(chatId) as any[];
    }
  } else {
    historyRows = db.prepare(
      "SELECT role, text FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC, created_at DESC LIMIT 30"
    ).all(chatId) as any[];
  }
  const history = historyRows.reverse();

  const charName = character?.name || getPresetName(characterKey);
  const charPersona = character?.persona || getPresetPersona(characterKey);
  const charOverview = character?.overview || getPresetOverview(characterKey);
  const charAppearance = getPresetAppearance(characterKey);
  const charGreeting = character?.greeting || getPresetGreeting(characterKey);
  const charVoiceId = character?.voice_id || getPresetVoiceId(characterKey);
  const userName = profile?.preferred_name || "用户";
  const memoryContext = recentMemories
    .slice(0, 3)
    .map((item: any) => item.summary)
    .filter(Boolean)
    .join("；");
  const snapshotContext = snapshot
    ? `场景：${snapshot.scene_tag || "日常"}，情绪：${snapshot.emotion_tag || "平静"}，未完话题：${snapshot.unfinished_topic || "无"}`
    : "";
  const stage = relationState?.relation_stage || "陌生";
  const intimacy = relationState?.intimacy_score || 0;

  return {
    character,
    profile,
    relationState,
    recentMemories,
    snapshot,
    history,
    charName,
    charPersona,
    charOverview,
    charAppearance,
    charGreeting,
    charVoiceId,
    userName,
    memoryContext,
    snapshotContext,
    stage,
    intimacy,
  };
}

function buildRoleplayMessages(context: ChatContext, momentContext?: string | null, extraPrompt?: string) {
  const { charName, charPersona, charOverview, charGreeting, userName, stage, intimacy, memoryContext, snapshotContext, profile, history } = context;
  const systemContent = `你叫${charName}。${charPersona}。${charOverview ? `${charOverview}。` : ""}你不是AI助手，你是一个真实的人。
当前关系阶段：${stage}（亲密度${intimacy}）
${memoryContext ? `你记得：${memoryContext}` : ""}
${snapshotContext ? `上次对话：${snapshotContext}` : ""}
${momentContext ? `【用户提及的过去互动记忆】${momentContext}` : ""}

行为规则：
- 始终用中文回复，保持角色一致
- ${stage === "陌生" ? "礼貌但稍有距离感" : stage === "了解" ? "自然随意，偶尔关心" : "亲密、随意，可以撒娇或吃醋"}
- 日常回复保持自然口语感，不要像写作文
- 如果想连续发送多条消息，请使用 <<SEG>> 作为分隔符，最多 3 条；如果一条就够，不要强行拆分
${extraPrompt ? `- ${extraPrompt}` : ""}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent, name: charName },
    {
      role: "user_system",
      content: `你叫${userName}。${profile?.comfort_style ? `你偏好${profile.comfort_style}的沟通方式。` : ""}`,
      name: userName,
    },
    { role: "group", content: `${charName}与${userName}的私聊`, name: `${charName}与${userName}` },
  ];

  if (charGreeting) {
    messages.push({ role: "sample_message_user", content: "你好呀", name: userName });
    messages.push({ role: "sample_message_ai", content: charGreeting, name: charName });
  }

  for (const item of history.slice(-15)) {
    messages.push({
      role: item.role === "model" ? "assistant" : "user",
      content: item.text || "[图片]",
      name: item.role === "model" ? charName : userName,
    });
  }

  return messages;
}

async function extractAndUpdateState(chatId: string, userId: string, userText: string, aiReply: string, relationState: any) {
  const updates = await chatCompletionJSON<any>([
    {
      role: "system",
      content: `Extract high-value memory and relationship updates from this turn.
Return JSON with:
- profile_updates (array of {field, value})
- new_memories (array of {type, summary, keyphrase, salience})
- relation_updates (object with intimacy_delta (1-5), trust_delta (1-5), triggered_event (string or empty))
- session_snapshot (object with scene_tag, emotion_tag, unfinished_topic, followup_hint)`,
    },
    {
      role: "user",
      content: `User: "${userText}"\nAI: "${aiReply}"\nCurrent Intimacy: ${relationState?.intimacy_score || 0}`,
    },
  ]);

  const { profile_updates, new_memories, relation_updates, session_snapshot } = updates || {};

  if (profile_updates?.length > 0) {
    for (const update of profile_updates) {
      if (update.field === "preferredName" || update.field === "preferred_name") {
        db.prepare("UPDATE users SET preferred_name = ? WHERE id = ?").run(update.value, userId);
      } else if (update.field === "comfortStyle" || update.field === "comfort_style") {
        db.prepare("UPDATE users SET comfort_style = ? WHERE id = ?").run(update.value, userId);
      }
    }
  }

  if (new_memories?.length > 0) {
    const stmt = db.prepare(
      "INSERT INTO memories (id, chat_id, type, summary, keyphrase, salience) VALUES (?,?,?,?,?,?)"
    );
    for (const memory of new_memories) {
      stmt.run(
        crypto.randomUUID(),
        chatId,
        memory.type,
        memory.summary,
        memory.keyphrase,
        memory.salience || 0
      );
    }
  }

  if (relation_updates) {
    const chatRow = db.prepare("SELECT character_id FROM chats WHERE id = ?").get(chatId) as { character_id?: string } | undefined;
    const currentIntimacy = relationState?.intimacy_score || 0;
    const currentTrust = relationState?.trust_score || 0;
    let events: string[] = [];
    try {
      events = JSON.parse(relationState?.unlocked_events || "[]");
    } catch {}

    let newIntimacy = currentIntimacy + (relation_updates.intimacy_delta || 1);
    let newTrust = currentTrust + (relation_updates.trust_delta || 1);

    if (relation_updates.triggered_event) {
      events.push(relation_updates.triggered_event);
      db.prepare(
        "INSERT INTO memories (id, chat_id, type, summary, keyphrase, salience) VALUES (?,?,?,?,?,?)"
      ).run(
        crypto.randomUUID(),
        chatId,
        "event",
        relation_updates.triggered_event,
        "Milestone",
        10
      );
    }

    const nextStageBase = (Math.floor(currentIntimacy / 300) + 1) * 300;
    const requiredEvents = Math.floor(nextStageBase / 300);
    const shouldGateByEvents = !!chatRow?.character_id && hasOfficialRelationshipEvents(chatRow.character_id);
    if (shouldGateByEvents && newIntimacy >= nextStageBase && events.length < requiredEvents) {
      newIntimacy = nextStageBase - 1;
    }

    let newStage = "陌生";
    if (newIntimacy >= 900) newStage = "知己/爱人";
    else if (newIntimacy >= 600) newStage = "熟悉";
    else if (newIntimacy >= 300) newStage = "了解";

    db.prepare(
      "INSERT OR REPLACE INTO relation_states (chat_id, intimacy_score, trust_score, relation_stage, unlocked_events) VALUES (?,?,?,?,?)"
    ).run(chatId, Math.min(1200, newIntimacy), Math.min(1200, newTrust), newStage, JSON.stringify(events));
  }

  if (session_snapshot) {
    db.prepare(
      "INSERT OR REPLACE INTO session_snapshots (chat_id, scene_tag, emotion_tag, unfinished_topic, followup_hint, updated_at) VALUES (?,?,?,?,?,datetime('now'))"
    ).run(
      chatId,
      session_snapshot.scene_tag,
      session_snapshot.emotion_tag,
      session_snapshot.unfinished_topic,
      session_snapshot.followup_hint
    );
  }
}

async function insertModelMessage(
  chatId: string,
  data: {
    text: string;
    imageUrl?: string | null;
    audioUrl?: string | null;
    messageType: MessageType;
    replyBatchId: string;
    segmentIndex: number;
  }
) {
  const createdAt = toIsoNow();
  db.prepare(
    `INSERT INTO messages (id, chat_id, text, image_url, audio_url, role, message_type, reply_batch_id, segment_index, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    crypto.randomUUID(),
    chatId,
    data.text,
    data.imageUrl || null,
    data.audioUrl || null,
    "model",
    data.messageType,
    data.replyBatchId,
    data.segmentIndex,
    createdAt
  );

  db.prepare(
    "UPDATE chats SET updated_at = ?, unread_ai_count = COALESCE(unread_ai_count, 0) + 1 WHERE id = ?"
  ).run(createdAt, chatId);
}

async function generateUserTurnReply(turn: QueueTurn, metadata: TurnMetadata) {
  const userId = db.prepare("SELECT user_id FROM chats WHERE id = ?").get(turn.chat_id) as any;
  const context = loadChatContext(turn.chat_id, userId?.user_id, turn);
  const chatMessages = buildRoleplayMessages(
    context,
    metadata.momentContext,
    metadata.voiceInput
      ? "这是一次语音转文字后的回复，先专注自然回应，不要强行拆成多条。"
      : undefined
  );

  const userText = metadata.text?.trim() || (metadata.imageUrl ? "[图片]" : "……");
  const recentForContext = context.history
    .slice(-6)
    .map((item) => `${item.role === "model" ? context.charName : context.userName}: ${item.text || "[图片]"}`)
    .join("\n");

  const [replyRaw, intent] = await Promise.all([
    chatCompletion(chatMessages),
    metadata.text?.trim()
      ? detectIntent(metadata.text, recentForContext, context.charName, context.charPersona, context.charOverview, context.charAppearance)
      : Promise.resolve({ need_image: false, image_prompt: "" }),
  ]);

  const segments = normalizeSegments(
    (replyRaw || "……").replace(/\[IMG:\s*.+?\]\s*$/g, "").trim(),
    Boolean(metadata.voiceInput)
  );

  let audioUrl = "";
  if (metadata.voiceInput && segments[0]) {
    try {
      audioUrl = await textToSpeech(segments[0], context.charVoiceId);
    } catch (error: any) {
      console.error("[ChatRuntime] TTS generation failed:", error.message);
    }
  }

  return {
    context,
    userText,
    replyText: segments.join(" "),
    segments,
    imageUrl: null,
    audioUrl: audioUrl || null,
    messageType: "reply" as MessageType,
    pendingImageIntent: intent.need_image && intent.image_prompt ? intent.image_prompt : null,
  };
}

async function generateProactiveTurnReply(turn: QueueTurn, metadata: TurnMetadata) {
  const userId = db.prepare("SELECT user_id FROM chats WHERE id = ?").get(turn.chat_id) as any;
  const context = loadChatContext(turn.chat_id, userId?.user_id, turn);
  const chatMessages = buildRoleplayMessages(
    context,
    null,
    "这是你主动联系用户的时刻，语气自然、温柔，不要像系统通知。"
  );
  const timezone = safeTimeZone(context.profile?.proactive_timezone);
  const localNow = getLocalParts(new Date(), timezone);
  const sceneLabel = metadata.proactiveType === "sleep" ? "睡前陪伴" : "日常问候";
  const timeLabel = `${localNow.hour.toString().padStart(2, "0")}:${localNow.minute.toString().padStart(2, "0")}`;

  chatMessages.push({
    role: "user",
    content: `现在是用户当地时间 ${timeLabel}。请以${context.charName}的身份主动发起一次${sceneLabel}。

要求：
- 纯中文
- 1 到 3 条短消息，如果需要拆分请使用 <<SEG>> 分隔
- 结合你们之前的聊天痕迹，像真实关系里的主动关心
- 不要提到“系统”“提醒”“设定”“任务”
- 如果最近对方回复较少，语气放轻，不要责备`,
    name: context.userName,
  });

  const replyRaw = await chatCompletion(chatMessages);
  const segments = normalizeSegments(replyRaw || "在吗？", false);

  return {
    context,
    userText: `[主动消息:${metadata.proactiveType || "greeting"}]`,
    replyText: segments.join(" "),
    segments,
    imageUrl: null,
    audioUrl: null,
    messageType: "proactive" as MessageType,
  };
}

async function processTurn(turn: QueueTurn) {
  const metadata = parseJSON<TurnMetadata>(turn.metadata_json, {});
  const generated =
    turn.source_type === "proactive"
      ? await generateProactiveTurnReply(turn, metadata)
      : await generateUserTurnReply(turn, metadata);

  for (let index = 0; index < generated.segments.length; index += 1) {
    if (index > 0) {
      await wait(SEGMENT_DELAY_MS);
    }
    await insertModelMessage(turn.chat_id, {
      text: generated.segments[index],
      imageUrl: index === 0 ? generated.imageUrl : null,
      audioUrl: index === 0 ? generated.audioUrl : null,
      messageType: generated.messageType,
      replyBatchId: turn.id,
      segmentIndex: index,
    });
  }

  if ((generated as any).pendingImageIntent) {
    const imagePrompt = (generated as any).pendingImageIntent as string;
    generateImage(imagePrompt)
      .then((url) => {
        if (url) {
          insertModelMessage(turn.chat_id, {
            text: "",
            imageUrl: url,
            messageType: generated.messageType,
            replyBatchId: turn.id,
            segmentIndex: generated.segments.length,
          });
        }
      })
      .catch((error) => console.error("[ChatRuntime] async image generation failed:", error.message));
  }

  if (turn.source_type === "user") {
    extractAndUpdateState(
      turn.chat_id,
      generated.context.profile?.id || db.prepare("SELECT user_id FROM chats WHERE id = ?").pluck().get(turn.chat_id),
      generated.userText,
      generated.replyText,
      generated.context.relationState
    ).catch((error) => console.error("[ChatRuntime] state extraction failed:", error));
  }
}

async function emitFallbackMessage(turn: QueueTurn) {
  await insertModelMessage(turn.chat_id, {
    text: "刚刚有点走神了，再和我说一次好不好？",
    messageType: turn.source_type === "proactive" ? "proactive" : "reply",
    replyBatchId: turn.id,
    segmentIndex: 0,
  });
}

async function processChatQueue(chatId: string) {
  if (activeChatProcessors.has(chatId)) return;
  activeChatProcessors.add(chatId);

  try {
    while (true) {
      const nextTurn = db.prepare(
        `SELECT id, chat_id, user_message_id, source_type, status, metadata_json
               , created_at
         FROM chat_turn_queue
         WHERE chat_id = ? AND status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1`
      ).get(chatId) as QueueTurn | undefined;

      if (!nextTurn) {
        refreshPendingTurns(chatId);
        db.prepare("UPDATE chats SET reply_state = 'idle' WHERE id = ?").run(chatId);
        break;
      }

      db.prepare("UPDATE chat_turn_queue SET status = 'processing', started_at = ? WHERE id = ?")
        .run(toIsoNow(), nextTurn.id);
      db.prepare("UPDATE chats SET reply_state = 'processing' WHERE id = ?").run(chatId);
      refreshPendingTurns(chatId);

      try {
        await processTurn(nextTurn);
        db.prepare("UPDATE chat_turn_queue SET status = 'completed', completed_at = ? WHERE id = ?")
          .run(toIsoNow(), nextTurn.id);
      } catch (error: any) {
        console.error("[ChatRuntime] turn failed:", nextTurn.id, error.message);
        await emitFallbackMessage(nextTurn);
        db.prepare("UPDATE chat_turn_queue SET status = 'failed', completed_at = ? WHERE id = ?")
          .run(toIsoNow(), nextTurn.id);
      }

      const runtime = refreshPendingTurns(chatId);
      if (runtime.pending_turns_count <= 0) {
        db.prepare("UPDATE chats SET reply_state = 'idle' WHERE id = ?").run(chatId);
      }
    }
  } finally {
    activeChatProcessors.delete(chatId);
  }
}

function kickChatQueue(chatId: string) {
  queueMicrotask(() => {
    processChatQueue(chatId).catch((error) => {
      console.error("[ChatRuntime] queue processor crashed:", error);
      refreshPendingTurns(chatId);
      db.prepare("UPDATE chats SET reply_state = 'idle' WHERE id = ?").run(chatId);
    });
  });
}

function recoverChatRuntime() {
  db.prepare("UPDATE chat_turn_queue SET status = 'queued', started_at = NULL WHERE status = 'processing'").run();
  db.prepare("UPDATE chats SET reply_state = 'idle', pending_turns_count = 0").run();

  const rows = db.prepare(
    `SELECT chat_id, COUNT(*) AS count
     FROM chat_turn_queue
     WHERE status IN ('queued', 'processing')
     GROUP BY chat_id`
  ).all() as Array<{ chat_id: string; count: number }>;

  const stmt = db.prepare("UPDATE chats SET pending_turns_count = ?, reply_state = ? WHERE id = ?");
  for (const row of rows) {
    stmt.run(row.count, row.count > 0 ? "processing" : "idle", row.chat_id);
  }

  for (const row of rows) {
    if (row.count > 0) kickChatQueue(row.chat_id);
  }
}

function getUserTimezone(userId: string) {
  const row = db.prepare("SELECT proactive_timezone FROM users WHERE id = ?").get(userId) as any;
  return safeTimeZone(row?.proactive_timezone);
}

function applyUserReplyActivity(chatId: string, userId: string) {
  const timezone = getUserTimezone(userId);
  const localDate = getLocalParts(new Date(), timezone).dateKey;

  db.prepare(
    `UPDATE chats
     SET last_user_message_at = ?,
         last_user_message_local_date = ?,
         proactive_miss_streak = CASE WHEN last_proactive_sent_local_date = ? THEN 0 ELSE proactive_miss_streak END,
         proactive_skip_remaining = CASE WHEN last_proactive_sent_local_date = ? THEN 0 ELSE proactive_skip_remaining END
     WHERE id = ?`
  ).run(toIsoNow(), localDate, localDate, localDate, chatId);
}

function evaluateMissStateForChat(chat: any, _timezone: string, currentLocalDate: string) {
  if (!chat.last_proactive_sent_local_date) return;
  if (chat.last_proactive_evaluated_date === chat.last_proactive_sent_local_date) return;
  if (currentLocalDate <= chat.last_proactive_sent_local_date) return;

  if (chat.last_user_message_local_date === chat.last_proactive_sent_local_date) {
    db.prepare(
      `UPDATE chats
       SET proactive_miss_streak = 0,
           proactive_skip_remaining = 0,
           last_proactive_evaluated_date = ?
       WHERE id = ?`
    ).run(chat.last_proactive_sent_local_date, chat.id);
    return;
  }

  const nextMiss = (chat.proactive_miss_streak || 0) + 1;
  const nextSkip = nextMiss === 1 ? 1 : nextMiss === 2 ? 2 : chat.proactive_skip_remaining || 0;
  db.prepare(
    `UPDATE chats
     SET proactive_miss_streak = ?,
         proactive_skip_remaining = ?,
         proactive_silenced = ?,
         last_proactive_evaluated_date = ?
     WHERE id = ?`
  ).run(nextMiss, nextMiss >= 3 ? 0 : nextSkip, nextMiss >= 3 ? 1 : chat.proactive_silenced || 0, chat.last_proactive_sent_local_date, chat.id);
}

function queueProactiveTurnInternal(input: QueueProactiveTurnInput, localDate: string) {
  const queueId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO chat_turn_queue (id, chat_id, user_message_id, source_type, status, metadata_json, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    queueId,
    input.chatId,
    null,
    "proactive",
    "queued",
    JSON.stringify({ proactiveType: input.proactiveType, slotKey: input.slotKey }),
    toIsoNow()
  );

  db.prepare(
    `UPDATE chats
     SET pending_turns_count = COALESCE(pending_turns_count, 0) + 1,
         reply_state = 'processing',
         last_proactive_slot = ?,
         last_proactive_sent_at = ?,
         last_proactive_sent_local_date = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(input.slotKey, toIsoNow(), localDate, toIsoNow(), input.chatId, input.userId);

  kickChatQueue(input.chatId);
}

async function proactiveTick() {
  const users = db.prepare(
    `SELECT id, proactive_enabled, proactive_types_json, proactive_bedtime_minutes,
            proactive_character_ids_json, proactive_timezone
     FROM users
     WHERE proactive_enabled = 1`
  ).all() as any[];

  for (const user of users) {
    const proactiveTypes = parseJSON<string[]>(user.proactive_types_json, []);
    const characterIds = parseJSON<string[]>(user.proactive_character_ids_json, []);
    if (!proactiveTypes.length || !characterIds.length) continue;

    const timezone = safeTimeZone(user.proactive_timezone);
    const localNow = getLocalParts(new Date(), timezone);
    const chats = db.prepare(
      `SELECT id, user_id, character_id, is_connected, proactive_silenced, proactive_skip_remaining,
              proactive_miss_streak, last_proactive_slot, last_proactive_sent_local_date,
              last_proactive_evaluated_date, last_user_message_local_date
       FROM chats
       WHERE user_id = ? AND character_id IN (${characterIds.map(() => "?").join(",")})`
    ).all(user.id, ...characterIds).filter((chat: any) => isAccessibleCharacterId(chat.character_id, chat.user_id)) as any[];

    for (const chat of chats) {
      evaluateMissStateForChat(chat, timezone, localNow.dateKey);
    }

    const dueSlots: Array<{ type: "greeting" | "sleep"; slotKey: string }> = [];
    if (proactiveTypes.includes("greeting")) {
      if (localNow.hour === 9 && localNow.minute <= 5) {
        dueSlots.push({ type: "greeting", slotKey: `${localNow.dateKey}:morning` });
      }
      if (localNow.hour === 16 && localNow.minute <= 5) {
        dueSlots.push({ type: "greeting", slotKey: `${localNow.dateKey}:afternoon` });
      }
    }

    if (
      proactiveTypes.includes("sleep") &&
      typeof user.proactive_bedtime_minutes === "number"
    ) {
      const diff = localNow.minutesOfDay - user.proactive_bedtime_minutes;
      if (diff >= 0 && diff <= 5) {
        dueSlots.push({ type: "sleep", slotKey: `${localNow.dateKey}:sleep` });
      }
    }

    if (!dueSlots.length) continue;

    console.log(`[Proactive] User ${user.id}: due slots=${dueSlots.map(s => s.slotKey).join(",")}, local=${localNow.hour}:${String(localNow.minute).padStart(2, "0")}`);

    const freshChats = db.prepare(
      `SELECT id, user_id, character_id, is_connected, proactive_silenced, proactive_skip_remaining, last_proactive_slot
       FROM chats
       WHERE user_id = ? AND character_id IN (${characterIds.map(() => "?").join(",")})`
    ).all(user.id, ...characterIds).filter((chat: any) => isAccessibleCharacterId(chat.character_id, chat.user_id)) as any[];

    for (const dueSlot of dueSlots) {
      for (const chat of freshChats) {
        if (!chat.is_connected) { console.log(`[Proactive] Skip ${chat.character_id}: not connected`); continue; }
        if (chat.proactive_silenced) { console.log(`[Proactive] Skip ${chat.character_id}: silenced`); continue; }
        if (chat.last_proactive_slot === dueSlot.slotKey) { continue; }

        if ((chat.proactive_skip_remaining || 0) > 0) {
          console.log(`[Proactive] Skip ${chat.character_id}: skip_remaining=${chat.proactive_skip_remaining}`);
          db.prepare(
            "UPDATE chats SET proactive_skip_remaining = proactive_skip_remaining - 1, last_proactive_slot = ? WHERE id = ?"
          ).run(dueSlot.slotKey, chat.id);
          continue;
        }

        console.log(`[Proactive] Queuing ${dueSlot.type} for chat ${chat.id} (${chat.character_id})`);
        queueProactiveTurnInternal(
          { chatId: chat.id, userId: user.id, proactiveType: dueSlot.type, slotKey: dueSlot.slotKey },
          localNow.dateKey
        );
      }
    }
  }
}

export function startChatRuntime() {
  if (runtimeStarted) return;
  runtimeStarted = true;
  recoverChatRuntime();

  setTimeout(() => {
    proactiveTick().catch((error) => console.error("[ChatRuntime] proactive tick failed:", error));
  }, 15_000);

  setInterval(() => {
    proactiveTick().catch((error) => console.error("[ChatRuntime] proactive tick failed:", error));
  }, PROACTIVE_POLL_INTERVAL_MS);
}

export function queueUserTurn(input: QueueUserTurnInput) {
  const queueId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO chat_turn_queue (id, chat_id, user_message_id, source_type, status, metadata_json, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    queueId,
    input.chatId,
    input.userMessageId,
    "user",
    "queued",
    JSON.stringify({
      text: input.text || "",
      imageUrl: input.imageUrl || null,
      voiceInput: Boolean(input.voiceInput),
      momentContext: input.momentContext || null,
    }),
    toIsoNow()
  );

  applyUserReplyActivity(input.chatId, input.userId);
  db.prepare(
    "UPDATE chats SET pending_turns_count = COALESCE(pending_turns_count, 0) + 1, reply_state = 'processing', updated_at = ?, is_connected = 1 WHERE id = ? AND user_id = ?"
  ).run(toIsoNow(), input.chatId, input.userId);

  const chatRow = db.prepare("SELECT next_moment_window FROM chats WHERE id = ?").get(input.chatId) as any;
  if (!chatRow?.next_moment_window) {
    const windowMs = 5 * 60 * 1000;
    db.prepare("UPDATE chats SET next_moment_window = ? WHERE id = ?")
      .run(new Date(Date.now() + windowMs).toISOString(), input.chatId);
  }

  kickChatQueue(input.chatId);
  return refreshPendingTurns(input.chatId);
}

export function getChatRuntime(chatId: string, userId: string) {
  if (!getChatOwnership(chatId, userId)) return null;
  return getChatRuntimeRow(chatId) || {
    reply_state: "idle",
    unread_ai_count: 0,
    pending_turns_count: 0,
    proactive_silenced: 0,
  };
}

export function markChatRead(chatId: string, userId: string) {
  if (!getChatOwnership(chatId, userId)) return false;
  db.prepare("UPDATE chats SET unread_ai_count = 0 WHERE id = ? AND user_id = ?").run(chatId, userId);
  return true;
}

export function getUnreadMessagesCount(userId: string) {
  const rows = db.prepare("SELECT character_id, unread_ai_count FROM chats WHERE user_id = ?").all(userId) as Array<{
    character_id: string;
    unread_ai_count: number | null;
  }>;
  return rows.reduce((total, row) => {
    if (!isAccessibleCharacterId(row.character_id, userId)) {
      return total;
    }
    return total + (row.unread_ai_count || 0);
  }, 0);
}

export function resetProactiveCharacters(userId: string, characterIds: string[]) {
  if (!characterIds.length) return;
  db.prepare(
    `UPDATE chats
     SET proactive_miss_streak = 0,
         proactive_skip_remaining = 0,
         proactive_silenced = 0,
         last_proactive_slot = NULL,
         last_proactive_sent_at = NULL,
         last_proactive_sent_local_date = NULL,
         last_proactive_evaluated_date = NULL
     WHERE user_id = ? AND character_id IN (${characterIds.map(() => "?").join(",")})`
  ).run(userId, ...characterIds);
}
