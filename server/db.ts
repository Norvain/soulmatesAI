import Database from "better-sqlite3";
import path from "path";
import { RELATIONSHIP_EVENT_SEEDS } from "./relationship-events-data.js";
import { PRESET_MAP } from "./preset-characters.js";

const DB_PATH = path.join(process.cwd(), "soulmate.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_id TEXT UNIQUE,
    preferred_name TEXT,
    comfort_style TEXT,
    avatar_image TEXT,
    cover_image TEXT,
    gender TEXT,
    content_preferences_json TEXT DEFAULT '[]',
    membership_level TEXT DEFAULT 'free',
    membership_expires_at TEXT,
    unread_moment_replies INTEGER DEFAULT 0,
    proactive_enabled INTEGER DEFAULT 0,
    proactive_types_json TEXT DEFAULT '[]',
    proactive_bedtime_minutes INTEGER DEFAULT 1380,
    proactive_character_ids_json TEXT DEFAULT '[]',
    proactive_timezone TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    persona TEXT,
    overview TEXT,
    greeting TEXT,
    is_custom INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    is_connected INTEGER DEFAULT 0,
    last_moment_at TEXT,
    next_moment_window TEXT,
    moment_probability REAL DEFAULT 0.6,
    sleep_start INTEGER DEFAULT 23,
    sleep_end INTEGER DEFAULT 7,
    reply_state TEXT DEFAULT 'idle',
    unread_ai_count INTEGER DEFAULT 0,
    pending_turns_count INTEGER DEFAULT 0,
    last_proactive_slot TEXT,
    last_proactive_sent_at TEXT,
    last_proactive_sent_local_date TEXT,
    last_proactive_evaluated_date TEXT,
    proactive_miss_streak INTEGER DEFAULT 0,
    proactive_skip_remaining INTEGER DEFAULT 0,
    proactive_silenced INTEGER DEFAULT 0,
    last_user_message_at TEXT,
    last_user_message_local_date TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    text TEXT,
    image_url TEXT,
    audio_url TEXT,
    role TEXT NOT NULL CHECK(role IN ('user', 'model')),
    message_type TEXT DEFAULT 'reply',
    reply_batch_id TEXT,
    segment_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS relation_states (
    chat_id TEXT PRIMARY KEY,
    intimacy_score REAL DEFAULT 0,
    trust_score REAL DEFAULT 0,
    relation_stage TEXT DEFAULT '陌生',
    unlocked_events TEXT DEFAULT '[]',
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    type TEXT,
    summary TEXT,
    keyphrase TEXT,
    salience REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS moments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT,
    character_name TEXT,
    character_avatar TEXT,
    content TEXT,
    image_url TEXT,
    likes INTEGER DEFAULT 0,
    is_liked INTEGER DEFAULT 0,
    comments TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS session_snapshots (
    chat_id TEXT PRIMARY KEY,
    scene_tag TEXT,
    emotion_tag TEXT,
    unfinished_topic TEXT,
    followup_hint TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS event_queue (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_status TEXT DEFAULT 'pending',
    execute_after TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS interaction_moments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    character_id TEXT,
    character_name TEXT,
    character_avatar TEXT,
    messages_json TEXT NOT NULL,
    summary TEXT,
    title TEXT,
    message_count INTEGER DEFAULT 0,
    start_message_id TEXT,
    is_favorited INTEGER DEFAULT 0,
    favorited_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS chat_turn_queue (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_message_id TEXT,
    source_type TEXT NOT NULL CHECK(source_type IN ('user', 'proactive')),
    status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_message_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS relationship_event_definitions (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    required_intimacy INTEGER DEFAULT 0,
    required_stage TEXT,
    prerequisite_event_ids_json TEXT DEFAULT '[]',
    trigger_context_json TEXT DEFAULT '{}',
    script_json TEXT NOT NULL,
    summary_template TEXT,
    cg_prompt_template TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relationship_event_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    status TEXT DEFAULT 'not_started' CHECK(status IN ('not_started', 'in_progress', 'completed')),
    current_node_id TEXT,
    current_act INTEGER DEFAULT 0,
    choice_path_json TEXT DEFAULT '[]',
    emotion_tags_json TEXT DEFAULT '[]',
    started_at TEXT,
    last_saved_at TEXT,
    completed_at TEXT,
    completion_count INTEGER DEFAULT 0,
    last_playthrough_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, event_definition_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  );

  CREATE TABLE IF NOT EXISTS relationship_event_playthroughs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned')),
    transcript_json TEXT DEFAULT '[]',
    choice_path_json TEXT DEFAULT '[]',
    emotion_tags_json TEXT DEFAULT '[]',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    cg_image_url TEXT,
    cg_status TEXT DEFAULT 'idle',
    summary_text TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  );

  CREATE TABLE IF NOT EXISTS relationship_event_recaps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    event_title TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    cg_image_url TEXT,
    cg_status TEXT DEFAULT 'idle',
    character_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, event_definition_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
  CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id);
  CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(event_status, execute_after);
  CREATE INDEX IF NOT EXISTS idx_interaction_moments_user ON interaction_moments(user_id);
  CREATE INDEX IF NOT EXISTS idx_interaction_moments_chat ON interaction_moments(chat_id);
  CREATE INDEX IF NOT EXISTS idx_chat_turn_queue_chat_status ON chat_turn_queue(chat_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_relationship_event_definitions_character ON relationship_event_definitions(character_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_relationship_event_progress_lookup ON relationship_event_progress(user_id, chat_id, event_definition_id);
  CREATE INDEX IF NOT EXISTS idx_relationship_event_playthroughs_lookup ON relationship_event_playthroughs(user_id, chat_id, event_definition_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_relationship_event_recaps_lookup ON relationship_event_recaps(user_id, chat_id, event_definition_id, updated_at);
`);

// Schema migrations for existing databases
const migrations: string[] = [
  "ALTER TABLE chats ADD COLUMN is_connected INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN last_moment_at TEXT",
  "ALTER TABLE chats ADD COLUMN next_moment_window TEXT",
  "ALTER TABLE chats ADD COLUMN moment_probability REAL DEFAULT 0.6",
  "ALTER TABLE chats ADD COLUMN sleep_start INTEGER DEFAULT 23",
  "ALTER TABLE chats ADD COLUMN sleep_end INTEGER DEFAULT 7",
  "ALTER TABLE moments ADD COLUMN source_type TEXT DEFAULT 'independent'",
  "ALTER TABLE moments ADD COLUMN status TEXT DEFAULT 'published'",
  "ALTER TABLE users ADD COLUMN cover_image TEXT",
  "ALTER TABLE users ADD COLUMN avatar_image TEXT",
  "ALTER TABLE users ADD COLUMN unread_moment_replies INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN proactive_enabled INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN proactive_types_json TEXT DEFAULT '[]'",
  "ALTER TABLE users ADD COLUMN proactive_bedtime_minutes INTEGER DEFAULT 1380",
  "ALTER TABLE users ADD COLUMN proactive_character_ids_json TEXT DEFAULT '[]'",
  "ALTER TABLE users ADD COLUMN proactive_timezone TEXT",
  "ALTER TABLE messages ADD COLUMN audio_url TEXT",
  "ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'reply'",
  "ALTER TABLE messages ADD COLUMN reply_batch_id TEXT",
  "ALTER TABLE messages ADD COLUMN segment_index INTEGER DEFAULT 0",
  "ALTER TABLE interaction_moments ADD COLUMN is_favorited INTEGER DEFAULT 0",
  "ALTER TABLE interaction_moments ADD COLUMN favorited_at TEXT",
  "ALTER TABLE chats ADD COLUMN reply_state TEXT DEFAULT 'idle'",
  "ALTER TABLE chats ADD COLUMN unread_ai_count INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN pending_turns_count INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN last_proactive_slot TEXT",
  "ALTER TABLE chats ADD COLUMN last_proactive_sent_at TEXT",
  "ALTER TABLE chats ADD COLUMN last_proactive_sent_local_date TEXT",
  "ALTER TABLE chats ADD COLUMN last_proactive_evaluated_date TEXT",
  "ALTER TABLE chats ADD COLUMN proactive_miss_streak INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN proactive_skip_remaining INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN proactive_silenced INTEGER DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN last_user_message_at TEXT",
  "ALTER TABLE chats ADD COLUMN last_user_message_local_date TEXT",
  `CREATE TABLE IF NOT EXISTS chat_turn_queue (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_message_id TEXT,
    source_type TEXT NOT NULL CHECK(source_type IN ('user', 'proactive')),
    status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_message_id) REFERENCES messages(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_interaction_moments_favorite ON interaction_moments(user_id, is_favorited, favorited_at, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_chat_turn_queue_chat_status ON chat_turn_queue(chat_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_chats_unread_ai ON chats(user_id, unread_ai_count)",
  `CREATE TABLE IF NOT EXISTS relationship_event_definitions (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    required_intimacy INTEGER DEFAULT 0,
    required_stage TEXT,
    prerequisite_event_ids_json TEXT DEFAULT '[]',
    trigger_context_json TEXT DEFAULT '{}',
    script_json TEXT NOT NULL,
    summary_template TEXT,
    cg_prompt_template TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS relationship_event_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    status TEXT DEFAULT 'not_started' CHECK(status IN ('not_started', 'in_progress', 'completed')),
    current_node_id TEXT,
    current_act INTEGER DEFAULT 0,
    choice_path_json TEXT DEFAULT '[]',
    emotion_tags_json TEXT DEFAULT '[]',
    started_at TEXT,
    last_saved_at TEXT,
    completed_at TEXT,
    completion_count INTEGER DEFAULT 0,
    last_playthrough_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, event_definition_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS relationship_event_playthroughs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned')),
    transcript_json TEXT DEFAULT '[]',
    choice_path_json TEXT DEFAULT '[]',
    emotion_tags_json TEXT DEFAULT '[]',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    cg_image_url TEXT,
    cg_status TEXT DEFAULT 'idle',
    summary_text TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS relationship_event_recaps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    event_definition_id TEXT NOT NULL,
    event_title TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    cg_image_url TEXT,
    cg_status TEXT DEFAULT 'idle',
    character_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, event_definition_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (event_definition_id) REFERENCES relationship_event_definitions(id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_relationship_event_definitions_character ON relationship_event_definitions(character_id, sort_order)",
  "CREATE INDEX IF NOT EXISTS idx_relationship_event_progress_lookup ON relationship_event_progress(user_id, chat_id, event_definition_id)",
  "CREATE INDEX IF NOT EXISTS idx_relationship_event_playthroughs_lookup ON relationship_event_playthroughs(user_id, chat_id, event_definition_id, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_relationship_event_recaps_lookup ON relationship_event_recaps(user_id, chat_id, event_definition_id, updated_at)",
  "ALTER TABLE relationship_event_playthroughs ADD COLUMN cg_status TEXT DEFAULT 'idle'",
  "ALTER TABLE relationship_event_recaps ADD COLUMN cg_status TEXT DEFAULT 'idle'",
  "ALTER TABLE relationship_event_definitions ADD COLUMN cg_image_url TEXT",
  "ALTER TABLE users ADD COLUMN display_id TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_id ON users(display_id)",
  "ALTER TABLE users ADD COLUMN gender TEXT",
  "ALTER TABLE users ADD COLUMN content_preferences_json TEXT DEFAULT '[]'",
  "ALTER TABLE users ADD COLUMN membership_level TEXT DEFAULT 'free'",
  "ALTER TABLE users ADD COLUMN membership_expires_at TEXT",
];

for (const sql of migrations) {
  try { db.exec(sql); } catch {}
}

export function generateDisplayId(): string {
  const MAX_ATTEMPTS = 100;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString();
    const exists = db.prepare("SELECT 1 FROM users WHERE display_id = ?").get(candidate);
    if (!exists) return candidate;
  }
  throw new Error("Failed to generate unique display_id after max attempts");
}

// Backfill display_id for existing users
{
  const rows = db.prepare("SELECT id FROM users WHERE display_id IS NULL").all() as Array<{ id: string }>;
  const updateStmt = db.prepare("UPDATE users SET display_id = ? WHERE id = ?");
  for (const row of rows) {
    updateStmt.run(generateDisplayId(), row.id);
  }
}

const seedRelationshipEventDefinition = db.prepare(
  `INSERT INTO relationship_event_definitions
    (id, character_id, title, description, cover_image_url, required_intimacy, required_stage,
     prerequisite_event_ids_json, trigger_context_json, script_json, summary_template,
     cg_prompt_template, cg_image_url, sort_order, is_active, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
   ON CONFLICT(id) DO UPDATE SET
     character_id = excluded.character_id,
     title = excluded.title,
     description = excluded.description,
     cover_image_url = excluded.cover_image_url,
     required_intimacy = excluded.required_intimacy,
     required_stage = excluded.required_stage,
     prerequisite_event_ids_json = excluded.prerequisite_event_ids_json,
     trigger_context_json = excluded.trigger_context_json,
     script_json = excluded.script_json,
     summary_template = excluded.summary_template,
     cg_prompt_template = excluded.cg_prompt_template,
     cg_image_url = excluded.cg_image_url,
     sort_order = excluded.sort_order,
     is_active = excluded.is_active,
     updated_at = datetime('now')`
);

for (const seed of RELATIONSHIP_EVENT_SEEDS) {
  seedRelationshipEventDefinition.run(
    seed.id,
    seed.characterId,
    seed.title,
    seed.description,
    seed.coverImageUrl,
    seed.requiredIntimacy,
    null,
    JSON.stringify(seed.prerequisiteEventIds),
    "{}",
    JSON.stringify(seed.script),
    seed.summary,
    seed.cgPrompt,
    seed.cgImageUrl || null,
    seed.sortOrder,
    1
  );
}

function isPresetCharacterId(characterId: string | null | undefined) {
  return typeof characterId === "string" && !!PRESET_MAP[characterId];
}

function parseStoredIds(value: string | null | undefined) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function isAccessibleCharacterForUser(userId: string, characterId: string) {
  if (isPresetCharacterId(characterId)) return true;
  const row = db.prepare("SELECT 1 FROM characters WHERE id = ? AND user_id = ? LIMIT 1").get(characterId, userId);
  return !!row;
}

export interface IsolationCleanupResult {
  invalidChatsRemoved: number;
  deletedChatTurns: number;
  deletedMessages: number;
  deletedMemories: number;
  deletedRelationStates: number;
  deletedSnapshots: number;
  deletedInteractionMoments: number;
  deletedRelationshipProgress: number;
  deletedRelationshipPlaythroughs: number;
  deletedRelationshipRecaps: number;
  deletedMoments: number;
  deletedEventQueueItems: number;
  prunedProactiveUsers: number;
  prunedProactiveCharacterRefs: number;
}

export function cleanupIsolatedUserData(): IsolationCleanupResult {
  const result: IsolationCleanupResult = {
    invalidChatsRemoved: 0,
    deletedChatTurns: 0,
    deletedMessages: 0,
    deletedMemories: 0,
    deletedRelationStates: 0,
    deletedSnapshots: 0,
    deletedInteractionMoments: 0,
    deletedRelationshipProgress: 0,
    deletedRelationshipPlaythroughs: 0,
    deletedRelationshipRecaps: 0,
    deletedMoments: 0,
    deletedEventQueueItems: 0,
    prunedProactiveUsers: 0,
    prunedProactiveCharacterRefs: 0,
  };

  const cleanup = db.transaction(() => {
    const invalidChats = db.prepare(
      `SELECT id, user_id, character_id
       FROM chats c
       WHERE NOT (
         c.character_id IN (${Object.keys(PRESET_MAP).map(() => "?").join(",")})
         OR EXISTS (
           SELECT 1
           FROM characters ch
           WHERE ch.id = c.character_id AND ch.user_id = c.user_id
         )
       )`
    ).all(...Object.keys(PRESET_MAP)) as Array<{ id: string; user_id: string; character_id: string }>;

    const deleteRelationshipProgress = db.prepare("DELETE FROM relationship_event_progress WHERE chat_id = ?");
    const deleteRelationshipPlaythroughs = db.prepare("DELETE FROM relationship_event_playthroughs WHERE chat_id = ?");
    const deleteRelationshipRecaps = db.prepare("DELETE FROM relationship_event_recaps WHERE chat_id = ?");
    const deleteInteractionMoments = db.prepare("DELETE FROM interaction_moments WHERE chat_id = ?");
    const deleteChatTurns = db.prepare("DELETE FROM chat_turn_queue WHERE chat_id = ?");
    const deleteMessages = db.prepare("DELETE FROM messages WHERE chat_id = ?");
    const deleteMemories = db.prepare("DELETE FROM memories WHERE chat_id = ?");
    const deleteRelationStates = db.prepare("DELETE FROM relation_states WHERE chat_id = ?");
    const deleteSnapshots = db.prepare("DELETE FROM session_snapshots WHERE chat_id = ?");
    const deleteChat = db.prepare("DELETE FROM chats WHERE id = ?");

    for (const chat of invalidChats) {
      result.deletedRelationshipProgress += deleteRelationshipProgress.run(chat.id).changes;
      result.deletedRelationshipPlaythroughs += deleteRelationshipPlaythroughs.run(chat.id).changes;
      result.deletedRelationshipRecaps += deleteRelationshipRecaps.run(chat.id).changes;
      result.deletedInteractionMoments += deleteInteractionMoments.run(chat.id).changes;
      result.deletedChatTurns += deleteChatTurns.run(chat.id).changes;
      result.deletedMessages += deleteMessages.run(chat.id).changes;
      result.deletedMemories += deleteMemories.run(chat.id).changes;
      result.deletedRelationStates += deleteRelationStates.run(chat.id).changes;
      result.deletedSnapshots += deleteSnapshots.run(chat.id).changes;
      result.invalidChatsRemoved += deleteChat.run(chat.id).changes;
    }

    result.deletedChatTurns += db.prepare(
      `DELETE FROM chat_turn_queue
       WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = chat_turn_queue.chat_id)
          OR (user_message_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM messages m WHERE m.id = chat_turn_queue.user_message_id
          ))`
    ).run().changes;

    result.deletedMessages += db.prepare(
      "DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = messages.chat_id)"
    ).run().changes;
    result.deletedMemories += db.prepare(
      "DELETE FROM memories WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = memories.chat_id)"
    ).run().changes;
    result.deletedRelationStates += db.prepare(
      "DELETE FROM relation_states WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = relation_states.chat_id)"
    ).run().changes;
    result.deletedSnapshots += db.prepare(
      "DELETE FROM session_snapshots WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = session_snapshots.chat_id)"
    ).run().changes;
    result.deletedInteractionMoments += db.prepare(
      `DELETE FROM interaction_moments
       WHERE NOT EXISTS (
         SELECT 1 FROM chats c WHERE c.id = interaction_moments.chat_id AND c.user_id = interaction_moments.user_id
       )`
    ).run().changes;
    result.deletedRelationshipProgress += db.prepare(
      "DELETE FROM relationship_event_progress WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = relationship_event_progress.chat_id)"
    ).run().changes;
    result.deletedRelationshipPlaythroughs += db.prepare(
      "DELETE FROM relationship_event_playthroughs WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = relationship_event_playthroughs.chat_id)"
    ).run().changes;
    result.deletedRelationshipRecaps += db.prepare(
      "DELETE FROM relationship_event_recaps WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = relationship_event_recaps.chat_id)"
    ).run().changes;

    result.deletedMoments += db.prepare(
      `DELETE FROM moments
       WHERE character_id IS NOT NULL
         AND character_id NOT IN (${Object.keys(PRESET_MAP).map(() => "?").join(",")})
         AND NOT EXISTS (
           SELECT 1 FROM characters ch WHERE ch.id = moments.character_id AND ch.user_id = moments.user_id
         )`
    ).run(...Object.keys(PRESET_MAP)).changes;

    const eventRows = db.prepare(
      "SELECT id, event_type, payload FROM event_queue WHERE event_type IN ('moment_comment_reply', 'user_moment_character_comment')"
    ).all() as Array<{ id: string; event_type: string; payload: string }>;
    const deleteEvent = db.prepare("DELETE FROM event_queue WHERE id = ?");
    const findMoment = db.prepare("SELECT 1 FROM moments WHERE id = ? AND user_id = ? LIMIT 1");

    for (const row of eventRows) {
      let payload: any = null;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        result.deletedEventQueueItems += deleteEvent.run(row.id).changes;
        continue;
      }

      if (!payload?.moment_id || !payload?.user_id) {
        result.deletedEventQueueItems += deleteEvent.run(row.id).changes;
        continue;
      }

      if (!findMoment.get(payload.moment_id, payload.user_id)) {
        result.deletedEventQueueItems += deleteEvent.run(row.id).changes;
      }
    }

    const userRows = db.prepare("SELECT id, proactive_character_ids_json FROM users").all() as Array<{
      id: string;
      proactive_character_ids_json: string | null;
    }>;
    const updateUserProactiveCharacters = db.prepare(
      "UPDATE users SET proactive_character_ids_json = ? WHERE id = ?"
    );

    for (const user of userRows) {
      const currentIds = parseStoredIds(user.proactive_character_ids_json);
      const seen = new Set<string>();
      const nextIds = currentIds.filter((characterId) => {
        if (seen.has(characterId)) return false;
        if (!isAccessibleCharacterForUser(user.id, characterId)) return false;
        seen.add(characterId);
        return true;
      });

      if (nextIds.length !== currentIds.length) {
        result.prunedProactiveUsers += 1;
        result.prunedProactiveCharacterRefs += currentIds.length - nextIds.length;
        updateUserProactiveCharacters.run(JSON.stringify(nextIds), user.id);
      }
    }
  });

  cleanup();
  return result;
}

export default db;
