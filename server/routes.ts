import { Router, Response } from "express";
import crypto from "crypto";
import db from "./db.js";
import { AuthRequest, authMiddleware } from "./auth.js";
import { chatCompletion, chatCompletionJSON, chatCompletionM27, generateImage, textToSpeech, ChatMessage } from "./minimax.js";
import {
  getChatRuntime,
  getUnreadMessagesCount,
  markChatRead,
  queueUserTurn,
  resetProactiveCharacters,
} from "./chat-runtime.js";
import {
  PRESET_MAP,
  getPresetAvatar,
  getPresetGreeting,
  getPresetName,
  getPresetOverview,
  getPresetPersona,
  resolvePresetId,
} from "./preset-characters.js";
import {
  chooseRelationshipEventOption,
  getRelationshipEventHistory,
  getRelationshipEventsForChat,
  getRelationshipEventSession,
  RelationshipEventError,
  startRelationshipEvent,
} from "./relationship-events-service.js";
import asrRouter from "./routes/asr.js";

const router = Router();
router.use("/asr", asrRouter);
const PRESET_IDS = Object.keys(PRESET_MAP);
const INITIAL_RELATION_INTIMACY = 299;
const INITIAL_RELATION_TRUST = 299;
const INITIAL_RELATION_STAGE = "陌生";
const ACCESSIBLE_CHAT_FILTER = `
  (
    c.character_id IN (${PRESET_IDS.map(() => "?").join(",")})
    OR EXISTS (
      SELECT 1
      FROM characters owned
      WHERE owned.id = c.character_id AND owned.user_id = c.user_id
    )
  )
`;
const INTERACTION_MOMENTS_ORDER_BY = `
  ORDER BY
    is_favorited DESC,
    CASE WHEN is_favorited = 1 THEN COALESCE(favorited_at, created_at) END DESC,
    created_at DESC
`;
const ALLOWED_PROACTIVE_TYPES = new Set(["sleep", "greeting"]);

function parseStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function parseProactiveTypes(value: unknown) {
  return parseStringArray(value).filter((item) => ALLOWED_PROACTIVE_TYPES.has(item));
}

function parseStoredStringArray(value: string | null | undefined) {
  try {
    return parseStringArray(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function getOwnedChat(userId: string, chatId: string) {
  return db.prepare(
    "SELECT id, user_id, character_id FROM chats WHERE id = ? AND user_id = ?"
  ).get(chatId, userId) as { id: string; user_id: string; character_id: string } | undefined;
}

function getOwnedAccessibleChat(userId: string, chatId: string) {
  const chat = getOwnedChat(userId, chatId);
  if (!chat) return null;
  if (!getAccessibleCharacter(userId, chat.character_id)) return null;
  return chat;
}

function getAccessibleCharacter(userId: string, characterId: string) {
  const presetId = resolvePresetId(characterId);
  const preset = PRESET_MAP[presetId];
  if (preset) {
    return {
      kind: "preset" as const,
      id: presetId,
      greeting: preset.greeting,
      name: preset.name,
      avatar_url: preset.avatarUrl,
      overview: preset.overview,
      persona: preset.persona,
      opening_story: preset.openingStory,
    };
  }

  const custom = db.prepare(
    "SELECT id, greeting, name, avatar_url, overview, persona FROM characters WHERE id = ? AND user_id = ?"
  ).get(characterId, userId) as any;

  if (!custom) return null;

  return {
    kind: "custom" as const,
    ...custom,
  };
}

function getConnectedMomentCharacters(userId: string) {
  const rows = db.prepare(
    `SELECT c.character_id, c.updated_at,
            ch.name AS custom_name, ch.avatar_url AS custom_avatar_url,
            ch.persona AS custom_persona, ch.overview AS custom_overview
     FROM chats c
     LEFT JOIN characters ch ON ch.id = c.character_id AND ch.user_id = c.user_id
     WHERE c.user_id = ?
       AND c.is_connected = 1
       AND ${ACCESSIBLE_CHAT_FILTER}
     ORDER BY datetime(c.updated_at) DESC, c.updated_at DESC`
  ).all(userId, ...PRESET_IDS) as any[];

  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (!row.character_id || seen.has(row.character_id)) return false;
      seen.add(row.character_id);
      return true;
    })
    .map((row) => {
      const presetId = resolvePresetId(row.character_id);
      const preset = PRESET_MAP[presetId];
      return {
        id: row.character_id,
        name: row.custom_name || preset?.name || getPresetName(row.character_id) || "AI",
        avatar_url: row.custom_avatar_url || preset?.avatarUrl || getPresetAvatar(row.character_id) || "",
        persona: row.custom_persona || preset?.persona || getPresetPersona(row.character_id) || "",
        overview: row.custom_overview || preset?.overview || getPresetOverview(row.character_id) || "",
      };
    });
}

function parseMomentComments(raw: string | null | undefined) {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function mapMomentRow(row: any) {
  return {
    ...row,
    comments: parseMomentComments(row.comments),
  };
}

async function analyzeUserMomentForComments(params: {
  content: string;
  hasImage: boolean;
  mentionedNames: string[];
}) {
  const trimmedContent = params.content.trim();
  if (!trimmedContent && !params.hasImage) {
    return {
      summary: "",
      tone: "日常",
      focus: "生活分享",
    };
  }

  try {
    const analyzeMessages: ChatMessage[] = [
      {
        role: "system",
        content: `你是朋友圈内容分析助手。请对用户准备发布的朋友圈做非常简洁的结构化分析，供角色评论时参考。

规则：
- 不要改写用户原文
- summary 用中文概括朋友圈内容，1 句话
- tone 用 2-4 个字概括氛围，如“轻松”“撒娇”“疲惫”“开心”
- focus 用 2-6 个字概括主题，如“下班回家”“夜宵分享”“自拍记录”
- 如果内容里提到了被 @ 的角色，也在概括里自然体现
- 必须返回有效 JSON，不要有任何额外文字：{"summary":"...","tone":"...","focus":"..."}`,
      },
      {
        role: "user",
        content: `朋友圈正文：${trimmedContent || "（无正文，仅图片）"}
是否带图：${params.hasImage ? "是" : "否"}
被@角色：${params.mentionedNames.length ? params.mentionedNames.join("、") : "无"}`,
      },
    ];

    const raw = await chatCompletion(analyzeMessages, { maxTokens: 200, temperature: 0.3 });
    const cleaned = (raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        summary: typeof result?.summary === "string" ? result.summary.trim() : trimmedContent || "分享了一条朋友圈",
        tone: typeof result?.tone === "string" ? result.tone.trim() : "日常",
        focus: typeof result?.focus === "string" ? result.focus.trim() : "生活分享",
      };
    }
    return {
      summary: trimmedContent || "分享了一条朋友圈",
      tone: "日常",
      focus: "生活分享",
    };
  } catch (error) {
    console.error("Analyze user moment failed:", error);
    return {
      summary: trimmedContent || "分享了一条朋友圈",
      tone: "日常",
      focus: "生活分享",
    };
  }
}

// ─── Profile ────────────────────────────────────────────────────────

router.get("/profile", authMiddleware, (req: AuthRequest, res: Response) => {
  const row = db.prepare(
    `SELECT preferred_name, comfort_style, cover_image, avatar_image,
            display_id, gender, content_preferences_json, membership_level, membership_expires_at,
            proactive_enabled, proactive_types_json, proactive_bedtime_minutes,
            proactive_character_ids_json, proactive_timezone
     FROM users
     WHERE id = ?`
  ).get(req.userId!) as any;
  if (!row) {
    res.status(401).json({ error: "用户不存在" });
    return;
  }
  if (!row.preferred_name) {
    res.json({ needsOnboarding: true });
    return;
  }
  res.json({
    preferred_name: row.preferred_name,
    comfort_style: row.comfort_style,
    cover_image: row.cover_image,
    avatar_image: row.avatar_image,
    display_id: row.display_id || null,
    gender: row.gender || null,
    content_preferences: parseStoredStringArray(row.content_preferences_json),
    membership_level: row.membership_level || "free",
    membership_expires_at: row.membership_expires_at || null,
    proactive_enabled: row.proactive_enabled || 0,
    proactive_types: parseStoredStringArray(row.proactive_types_json),
    proactive_bedtime_minutes: typeof row.proactive_bedtime_minutes === "number" ? row.proactive_bedtime_minutes : 1380,
    proactive_character_ids: parseStoredStringArray(row.proactive_character_ids_json),
    proactive_timezone: row.proactive_timezone || null,
  });
});

router.put("/profile", authMiddleware, (req: AuthRequest, res: Response) => {
  const { preferredName, comfortStyle } = req.body;
  db.prepare("UPDATE users SET preferred_name = ?, comfort_style = ? WHERE id = ?")
    .run(preferredName, comfortStyle, req.userId!);
  res.json({ ok: true });
});

router.put("/profile/cover", authMiddleware, (req: AuthRequest, res: Response) => {
  const { cover_image } = req.body;
  if (!cover_image) { res.status(400).json({ error: "缺少封面图数据" }); return; }
  db.prepare("UPDATE users SET cover_image = ? WHERE id = ?").run(cover_image, req.userId!);
  res.json({ ok: true });
});

router.put("/profile/avatar", authMiddleware, (req: AuthRequest, res: Response) => {
  const { avatar_image } = req.body;
  if (!avatar_image) { res.status(400).json({ error: "缺少头像数据" }); return; }
  db.prepare("UPDATE users SET avatar_image = ? WHERE id = ?").run(avatar_image, req.userId!);
  res.json({ ok: true });
});

router.get("/membership", authMiddleware, (req: AuthRequest, res: Response) => {
  const row = db.prepare("SELECT membership_level, membership_expires_at FROM users WHERE id = ?").get(req.userId!) as any;
  if (!row) { res.status(401).json({ error: "用户不存在" }); return; }
  res.json({
    membership_level: row.membership_level || "free",
    membership_expires_at: row.membership_expires_at || null,
  });
});

router.put("/profile/preferences", authMiddleware, (req: AuthRequest, res: Response) => {
  const gender = typeof req.body?.gender === "string" ? req.body.gender.trim() : null;
  const raw = req.body?.contentPreferences;
  const contentPreferences = Array.isArray(raw)
    ? raw.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  db.prepare("UPDATE users SET gender = ?, content_preferences_json = ? WHERE id = ?")
    .run(gender, JSON.stringify(contentPreferences), req.userId!);
  res.json({ ok: true });
});

router.put("/profile/proactive-settings", authMiddleware, (req: AuthRequest, res: Response) => {
  const proactiveEnabled = req.body?.proactiveEnabled ? 1 : 0;
  const proactiveTypes = parseProactiveTypes(req.body?.proactiveTypes);
  const proactiveCharacterIds = parseStringArray(req.body?.proactiveCharacterIds).filter(
    (characterId) => !!getAccessibleCharacter(req.userId!, characterId)
  );
  const proactiveTimezone = typeof req.body?.proactiveTimezone === "string" ? req.body.proactiveTimezone.trim() : null;
  const resetCharacterIds = parseStringArray(req.body?.resetCharacterIds).filter(
    (characterId) => proactiveCharacterIds.includes(characterId)
  );
  const bedtimeMinutesRaw = Number(req.body?.proactiveBedtimeMinutes);
  const proactiveBedtimeMinutes = Number.isFinite(bedtimeMinutesRaw)
    ? Math.min(1439, Math.max(0, Math.round(bedtimeMinutesRaw)))
    : 1380;

  db.prepare(
    `UPDATE users
     SET proactive_enabled = ?,
         proactive_types_json = ?,
         proactive_bedtime_minutes = ?,
         proactive_character_ids_json = ?,
         proactive_timezone = ?
     WHERE id = ?`
  ).run(
    proactiveEnabled,
    JSON.stringify(proactiveTypes),
    proactiveBedtimeMinutes,
    JSON.stringify(proactiveCharacterIds),
    proactiveTimezone || null,
    req.userId!
  );

  if (resetCharacterIds.length > 0) {
    resetProactiveCharacters(req.userId!, resetCharacterIds);
  }

  res.json({ ok: true });
});

// ─── Characters ─────────────────────────────────────────────────────

router.get("/characters", authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = db.prepare("SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC").all(req.userId!);
  res.json(rows);
});

router.post("/characters", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, overview, persona, greeting, avatarUrl } = req.body;
  if (!name || !persona) {
    res.status(400).json({ error: "名称和人设不能为空" });
    return;
  }

  const id = crypto.randomUUID();
  const finalAvatar = avatarUrl || `https://picsum.photos/seed/${name}/400/400`;

  db.prepare(
    "INSERT INTO characters (id, user_id, name, avatar_url, persona, overview, greeting, is_custom) VALUES (?,?,?,?,?,?,?,1)"
  ).run(id, req.userId!, name, finalAvatar, persona, overview || "", greeting || "");

  // Auto-create a chat + initial relation state
  db.prepare("INSERT INTO chats (id, user_id, character_id, updated_at) VALUES (?,?,?,?)").run(id, req.userId!, id, new Date().toISOString());
  db.prepare(
    "INSERT INTO relation_states (chat_id, intimacy_score, trust_score, relation_stage, unlocked_events) VALUES (?,?,?,?,?)"
  ).run(id, INITIAL_RELATION_INTIMACY, INITIAL_RELATION_TRUST, INITIAL_RELATION_STAGE, "[]");

  res.json({ id, avatarUrl: finalAvatar });
});

// ─── Discover ───────────────────────────────────────────────────────

router.get("/discover/search", authMiddleware, (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || "").trim().toLowerCase();
  if (!q) { res.json([]); return; }

  const presetResults = Object.entries(PRESET_MAP)
    .filter(([, p]) =>
      p.name.toLowerCase().includes(q) ||
      p.overview.toLowerCase().includes(q) ||
      p.persona.toLowerCase().includes(q)
    )
    .map(([id, p]) => ({
      id,
      name: p.name,
      avatar_url: p.avatarUrl,
      overview: p.overview,
      persona: p.persona,
      greeting: p.greeting,
      opening_story: p.openingStory,
      is_preset: true,
    }));

  const customRows = db.prepare(
    `SELECT id, name, avatar_url, overview, persona, greeting FROM characters
     WHERE user_id = ?
       AND (LOWER(name) LIKE ? OR LOWER(overview) LIKE ? OR LOWER(persona) LIKE ?)
     LIMIT 20`
  ).all(req.userId!, `%${q}%`, `%${q}%`, `%${q}%`) as any[];

  const customResults = customRows.map(r => ({ ...r, is_preset: false }));
  res.json([...presetResults, ...customResults]);
});

router.get("/discover/ranking", authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT c.character_id, COUNT(m.id) as msg_count
    FROM chats c
    JOIN messages m ON m.chat_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.character_id
    ORDER BY msg_count DESC
    LIMIT 5
  `).all(req.userId!) as { character_id: string; msg_count: number }[];

  const ranking = rows.map(r => {
    const presetId = resolvePresetId(r.character_id);
    const preset = PRESET_MAP[presetId];
    if (preset) {
      return {
        id: presetId,
        name: preset.name,
        avatar_url: preset.avatarUrl,
        overview: preset.overview,
        persona: preset.persona,
        greeting: preset.greeting,
        opening_story: preset.openingStory,
        msg_count: r.msg_count,
        is_preset: true,
      };
    }
    const custom = db.prepare(
      "SELECT id, name, avatar_url, overview, persona FROM characters WHERE id = ? AND user_id = ?"
    ).get(r.character_id, req.userId!) as any;
    if (custom) {
      return { ...custom, msg_count: r.msg_count, is_preset: false };
    }
    return null;
  }).filter(Boolean);

  res.json(ranking);
});

router.post("/characters/generate-avatar", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, persona, overview } = req.body;
  try {
    const prompt = `A high-quality, expressive portrait avatar for an AI companion. Name: ${name}. Personality: ${persona}. Overview: ${overview}. Style: Clean, modern, slightly stylized, warm lighting, solid background.`;
    const url = await generateImage(prompt);
    res.json({ url });
  } catch (e: any) {
    console.error("Avatar generation failed:", e);
    res.status(500).json({ error: "头像生成失败", detail: e.message });
  }
});

router.post("/characters/generate-from-tags", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { tags } = req.body as { tags: string[] };
  if (!tags || tags.length === 0) {
    res.status(400).json({ error: "请至少提供一个词条" });
    return;
  }

  const systemPrompt = `你是一个创意角色设计师。根据用户提供的词条标签，生成一个完整的 AI 伴侣角色设定。

要求：
- 角色名称：一个有质感的中文名字（2-3字），符合词条描述的气质
- 简介：一句话概括角色身份和气质（15-30字）
- 性格与规则：用顿号分隔的关键性格词，5-8个（如：温柔、体贴、偶尔毒舌、内心细腻）
- 开场白：符合角色性格的第一句话，自然、有代入感（15-40字），不要自我介绍

你必须只返回 JSON，不要有任何其他文字：
{"name": "...", "overview": "...", "persona": "...", "greeting": "..."}`;

  const userContent = `词条标签：${tags.map(t => "#" + t).join(" ")}`;

  try {
    const raw = await chatCompletionM27(systemPrompt, userContent, { maxTokens: 4096, noFallback: true });
    console.log("[generate-from-tags] M2.7 raw:", raw.slice(0, 500));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let jsonStr = cleaned.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) {
      const partial = cleaned.match(/\{[\s\S]*/)?.[0];
      if (partial) {
        let repaired = partial;
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
          const lastColon = repaired.lastIndexOf(":");
          const lastQuote = repaired.lastIndexOf('"');
          if (lastColon > lastQuote) {
            repaired += ' ""';
          } else {
            const quoteCount = (repaired.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) repaired += '"';
          }
          for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
        }
        try {
          JSON.parse(repaired);
          jsonStr = repaired;
          console.log("[generate-from-tags] Repaired truncated JSON");
        } catch { /* repair failed, will throw below */ }
      }
    }
    if (!jsonStr) throw new Error("Failed to parse generated character JSON");
    const result = JSON.parse(jsonStr);
    if (!result.name || !result.overview || !result.persona || !result.greeting) {
      throw new Error("生成结果缺少必要字段");
    }
    res.json(result);
  } catch (e: any) {
    console.error("Character generation from tags failed:", e);
    res.status(500).json({ error: "角色生成失败，请重试", detail: e.message });
  }
});

router.delete("/characters/:id", authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.userId!;

  const char = db.prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND is_custom = 1").get(id, userId);
  if (!char) { res.status(404).json({ error: "角色不存在或无法删除" }); return; }

  const chat = db.prepare("SELECT id FROM chats WHERE character_id = ? AND user_id = ?").get(id, userId) as any;
  if (chat) {
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM memories WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM relation_states WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM session_snapshots WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM interaction_moments WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM chat_turn_queue WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM relationship_event_progress WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM relationship_event_playthroughs WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM relationship_event_recaps WHERE chat_id = ?").run(chat.id);
    db.prepare("DELETE FROM moments WHERE character_id = ? AND user_id = ?").run(id, userId);
    db.prepare("DELETE FROM chats WHERE id = ?").run(chat.id);
  }
  db.prepare("DELETE FROM characters WHERE id = ?").run(id);

  res.json({ ok: true });
});

// ─── Interaction Moments ─────────────────────────────────────────────

router.post("/interaction-moments", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { chatId, startMessageId, count } = req.body as { chatId: string; startMessageId: string; count: number };
  const userId = req.userId!;

  const chat = db.prepare("SELECT id, character_id FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId) as any;
  if (!chat) { res.status(404).json({ error: "聊天不存在" }); return; }

  const startMsg = db.prepare("SELECT created_at FROM messages WHERE id = ? AND chat_id = ?").get(startMessageId, chatId) as any;
  if (!startMsg) { res.status(404).json({ error: "消息不存在" }); return; }

  const msgs = db.prepare(
    "SELECT id, text, role, created_at FROM messages WHERE chat_id = ? AND datetime(created_at) >= datetime(?) ORDER BY datetime(created_at) ASC, created_at ASC LIMIT ?"
  ).all(chatId, startMsg.created_at, count) as any[];

  if (msgs.length === 0) { res.status(400).json({ error: "没有可保存的消息" }); return; }

  const character = db.prepare(
    "SELECT name, avatar_url, persona FROM characters WHERE id = ? AND user_id = ?"
  ).get(chat.character_id, userId) as any;
  const charName = character?.name || getPresetName(chat.character_id);
  const charAvatar = character?.avatar_url || getPresetAvatar(chat.character_id);
  const profile = db.prepare("SELECT preferred_name FROM users WHERE id = ?").get(userId) as any;
  const userName = profile?.preferred_name || "用户";

  const dialogText = msgs.map((m: any) =>
    `${m.role === "model" ? charName : userName}: ${m.text || "[图片]"}`
  ).join("\n");

  let summary = "";
  let title = "";
  try {
    const systemPrompt = `你是一个对话摘要专家。请为以下对话片段生成：
1. title: 一个简短的标题（5-10字），概括这段对话的主题或情感
2. summary: 一段简洁的摘要（30-80字），概括对话的关键内容、情感走向和重要细节

只返回 JSON：{"title": "...", "summary": "..."}`;

    const raw = await chatCompletionM27(systemPrompt, dialogText, { maxTokens: 300 });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      summary = parsed.summary || "";
      title = parsed.title || "";
    }
  } catch (e: any) {
    console.error("Moment summary generation failed:", e.message);
    title = `${charName}的对话片段`;
    summary = msgs.slice(0, 2).map((m: any) => m.text?.slice(0, 30)).filter(Boolean).join("；");
  }

  const momentId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO interaction_moments (id, user_id, chat_id, character_id, character_name, character_avatar, messages_json, summary, title, message_count, start_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).run(momentId, userId, chatId, chat.character_id, charName, charAvatar, JSON.stringify(msgs), summary, title, msgs.length, startMessageId);

  res.json({
    id: momentId,
    title,
    summary,
    message_count: msgs.length,
    character_name: charName,
    created_at: new Date().toISOString(),
    is_favorited: 0,
    favorited_at: null,
  });
});

router.get("/interaction-moments", authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = db.prepare(
    `SELECT id, chat_id, character_id, character_name, character_avatar, summary, title, message_count, is_favorited, favorited_at, created_at
     FROM interaction_moments
     WHERE user_id = ?
     ${INTERACTION_MOMENTS_ORDER_BY}`
  ).all(req.userId!);
  res.json(rows);
});

router.get("/chats/:chatId/interaction-moments", authMiddleware, (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const rows = db.prepare(
    `SELECT id, title, summary, messages_json, message_count, is_favorited, favorited_at, created_at
     FROM interaction_moments
     WHERE chat_id = ? AND user_id = ?
     ${INTERACTION_MOMENTS_ORDER_BY}`
  ).all(chatId, req.userId!);
  res.json(rows);
});

router.post("/interaction-moments/:id/favorite", authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const row = db.prepare(
    "SELECT id, is_favorited FROM interaction_moments WHERE id = ? AND user_id = ?"
  ).get(id, req.userId!) as any;

  if (!row) {
    res.status(404).json({ error: "记忆不存在" });
    return;
  }

  const nextFavorited = row.is_favorited ? 0 : 1;
  const favoritedAt = nextFavorited ? new Date().toISOString() : null;

  db.prepare(
    "UPDATE interaction_moments SET is_favorited = ?, favorited_at = ? WHERE id = ?"
  ).run(nextFavorited, favoritedAt, id);

  res.json({ ok: true, is_favorited: nextFavorited, favorited_at: favoritedAt });
});

router.delete("/interaction-moments/:id", authMiddleware, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const row = db.prepare("SELECT id FROM interaction_moments WHERE id = ? AND user_id = ?").get(id, req.userId!);
  if (!row) { res.status(404).json({ error: "记忆不存在" }); return; }
  db.prepare("DELETE FROM interaction_moments WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ─── Chats ───────────────────────────────────────────────────────────

router.get("/chats", authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = (db.prepare(`
    SELECT c.id, c.character_id, c.updated_at, c.is_connected, c.unread_ai_count, c.reply_state, c.pending_turns_count, c.proactive_silenced,
           ch.name AS character_name, ch.avatar_url AS character_avatar_url,
           ch.persona, ch.overview, ch.greeting, ch.is_custom,
           (SELECT m.text FROM messages m WHERE m.chat_id = c.id ORDER BY datetime(m.created_at) DESC, m.created_at DESC LIMIT 1) AS last_message,
           (SELECT m.image_url FROM messages m WHERE m.chat_id = c.id ORDER BY datetime(m.created_at) DESC, m.created_at DESC LIMIT 1) AS last_message_image_url,
           (SELECT m.role FROM messages m WHERE m.chat_id = c.id ORDER BY datetime(m.created_at) DESC, m.created_at DESC LIMIT 1) AS last_message_role
    FROM chats c
    LEFT JOIN characters ch ON ch.id = c.character_id AND ch.user_id = c.user_id
    WHERE c.user_id = ?
      AND ${ACCESSIBLE_CHAT_FILTER}
    ORDER BY datetime(c.updated_at) DESC, c.updated_at DESC
  `).all(req.userId!, ...PRESET_IDS) as any[]).map((row) => {
    const preset = PRESET_MAP[resolvePresetId(row.character_id)];
    if (!preset) return row;
    return {
      ...row,
      character_name: row.character_name || preset.name,
      character_avatar_url: row.character_avatar_url || preset.avatarUrl,
      persona: row.persona || preset.persona,
      overview: row.overview || preset.overview,
      greeting: row.greeting || preset.greeting,
      opening_story: preset.openingStory,
    };
  });
  res.json(rows);
});

router.post("/chats/:characterId/select", authMiddleware, (req: AuthRequest, res: Response) => {
  const { characterId } = req.params;
  const userId = req.userId!;
  const accessibleCharacter = getAccessibleCharacter(userId, characterId);

  if (!accessibleCharacter) {
    res.status(404).json({ error: "角色不存在或无权访问" });
    return;
  }

  let existing = db.prepare("SELECT id FROM chats WHERE user_id = ? AND character_id = ?").get(userId, characterId) as any;
  let chatId: string;
  let isNew = false;

  if (!existing) {
    chatId = `${userId.slice(0, 8)}_${characterId}`;
    db.prepare("INSERT OR IGNORE INTO chats (id, user_id, character_id, updated_at) VALUES (?,?,?,?)").run(chatId, userId, characterId, new Date().toISOString());
    isNew = true;
  } else {
    chatId = existing.id;
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), chatId);
  }

  const state = db.prepare("SELECT * FROM relation_states WHERE chat_id = ?").get(chatId);
  if (!state) {
    db.prepare(
      "INSERT OR IGNORE INTO relation_states (chat_id, intimacy_score, trust_score, relation_stage, unlocked_events) VALUES (?,?,?,?,?)"
    ).run(chatId, INITIAL_RELATION_INTIMACY, INITIAL_RELATION_TRUST, INITIAL_RELATION_STAGE, "[]");
  }

  // Save greeting as first message if this is a new chat
  if (isNew) {
    const greeting = accessibleCharacter.greeting || getPresetGreeting(characterId);
    if (greeting) {
      db.prepare("INSERT INTO messages (id, chat_id, text, role, created_at) VALUES (?,?,?,?,?)")
        .run(crypto.randomUUID(), chatId, greeting, "model", new Date().toISOString());
    }
  }

  res.json({ chatId });
});

// ─── Relationship Events ─────────────────────────────────────────────

router.get("/chats/:chatId/relationship-events", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const events = getRelationshipEventsForChat(req.userId!, req.params.chatId);
    res.json(events);
  } catch (error) {
    if (error instanceof RelationshipEventError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Relationship events list failed:", error);
    res.status(500).json({ error: "加载关系事件失败" });
  }
});

router.post("/chats/:chatId/relationship-events/:eventId/start", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const mode = req.body?.mode === "replay" ? "replay" : "start";
    const session = startRelationshipEvent(req.userId!, req.params.chatId, req.params.eventId, mode);
    res.json(session);
  } catch (error) {
    if (error instanceof RelationshipEventError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Relationship event start failed:", error);
    res.status(500).json({ error: "进入剧情失败" });
  }
});

router.get("/chats/:chatId/relationship-events/:eventId/session", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const session = getRelationshipEventSession(req.userId!, req.params.chatId, req.params.eventId);
    res.json(session);
  } catch (error) {
    if (error instanceof RelationshipEventError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Relationship event session failed:", error);
    res.status(500).json({ error: "加载剧情失败" });
  }
});

router.post("/chats/:chatId/relationship-events/:eventId/choose", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const choiceId = typeof req.body?.choiceId === "string" ? req.body.choiceId : "";
    if (!choiceId) {
      res.status(400).json({ error: "缺少选项" });
      return;
    }
    const session = await chooseRelationshipEventOption(req.userId!, req.params.chatId, req.params.eventId, choiceId);
    res.json(session);
  } catch (error) {
    if (error instanceof RelationshipEventError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Relationship event choose failed:", error);
    res.status(500).json({ error: "推进剧情失败" });
  }
});

router.get("/chats/:chatId/relationship-events/:eventId/history", authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const history = getRelationshipEventHistory(req.userId!, req.params.chatId, req.params.eventId);
    res.json(history);
  } catch (error) {
    if (error instanceof RelationshipEventError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Relationship event history failed:", error);
    res.status(500).json({ error: "加载剧情记录失败" });
  }
});

// ─── Messages ────────────────────────────────────────────────────────

router.get("/chats/:chatId/messages", authMiddleware, (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const chat = getOwnedAccessibleChat(req.userId!, chatId);
  if (!chat) { res.status(404).json({ error: "聊天不存在" }); return; }

  const rows = db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) ASC, created_at ASC").all(chatId);
  res.json(rows);
});

router.get("/chats/:chatId/runtime", authMiddleware, (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const chat = getOwnedAccessibleChat(req.userId!, chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const runtime = getChatRuntime(chatId, req.userId!);
  if (!runtime) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  res.json(runtime);
});

router.post("/chats/:chatId/read", authMiddleware, (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const chat = getOwnedAccessibleChat(req.userId!, chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const ok = markChatRead(chatId, req.userId!);
  if (!ok) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  res.json({ ok: true });
});

router.get("/chats/unread-count", authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ count: getUnreadMessagesCount(req.userId!) });
});

router.post("/chats/:chatId/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const { text, imageUrl, voiceInput, momentContext } = req.body;
  const userId = req.userId!;

  const chat = getOwnedAccessibleChat(userId, chatId);
  if (!chat) { res.status(404).json({ error: "聊天不存在" }); return; }
  if (!text && !imageUrl) { res.status(400).json({ error: "消息不能为空" }); return; }

  const createdAt = new Date().toISOString();
  const userMsgId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (id, chat_id, text, image_url, role, message_type, segment_index, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(userMsgId, chatId, text || "", imageUrl || null, "user", "reply", 0, createdAt);

  const queueState = queueUserTurn({
    chatId,
    userId,
    userMessageId: userMsgId,
    text: text || "",
    imageUrl: imageUrl || null,
    voiceInput: Boolean(voiceInput),
    momentContext: momentContext || null,
  });

  let userAudioUrl: string | null = null;

  if (voiceInput && text) {
    try {
      userAudioUrl = await textToSpeech(text, "male-qn-qingse");
      db.prepare("UPDATE messages SET audio_url = ? WHERE id = ?").run(userAudioUrl, userMsgId);
    } catch (err: any) {
      console.error("[Routes] User voice TTS failed:", err.message);
    }
  }

  res.json({
    userMessage: {
      id: userMsgId,
      chat_id: chatId,
      text: text || "",
      image_url: imageUrl || null,
      audio_url: userAudioUrl,
      role: "user",
      message_type: "reply",
      created_at: createdAt,
    },
    queueState,
  });
});

// ─── Suggestions ─────────────────────────────────────────────────────

router.post("/chats/:chatId/suggestions", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const chat = getOwnedAccessibleChat(req.userId!, chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const character = getAccessibleCharacter(req.userId!, chat.character_id)!;

  const recentMsgs = db.prepare(
    "SELECT role, text FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC, created_at DESC LIMIT 5"
  ).all(chatId) as any[];

  const charName = character.name || getPresetName(chat.character_id);
  const charPersona = character.persona || getPresetPersona(chat.character_id);

  const profile = db.prepare("SELECT preferred_name FROM users WHERE id = ?").get(req.userId!) as any;
  const userName = profile?.preferred_name || "用户";

  const historyText = recentMsgs.reverse().map(m =>
    `${m.role === "model" ? charName : userName}: ${m.text}`
  ).join("\n");

  try {
    const result = await chatCompletionJSON<string[]>([
      {
        role: "system",
        content: `你是聊天建议助手。根据对话历史，为用户（${userName}）推荐 3 条简短、自然的回复建议。

重要规则：
- 建议必须是用户（${userName}）说的话，不是角色（${charName}）说的话
- 用中文，口语化，每条不超过 15 字
- 结合上下文，自然衔接对话
- 返回 JSON 数组，包含 3 个字符串`
      },
      {
        role: "user",
        content: `角色：${charName}（${charPersona}）\n\n最近对话：\n${historyText}`
      }
    ]);
    res.json(Array.isArray(result) ? result : []);
  } catch (e: any) {
    console.error("Suggestions error:", e);
    res.json([]);
  }
});

// ─── Chat State ──────────────────────────────────────────────────────

router.get("/chats/:chatId/state", authMiddleware, (req: AuthRequest, res: Response) => {
  const chat = getOwnedAccessibleChat(req.userId!, req.params.chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const row = db.prepare("SELECT * FROM relation_states WHERE chat_id = ?").get(req.params.chatId) as any;
  if (row && row.unlocked_events) row.unlocked_events = JSON.parse(row.unlocked_events);
  res.json(row || null);
});

router.get("/chats/:chatId/memories", authMiddleware, (req: AuthRequest, res: Response) => {
  const chat = getOwnedAccessibleChat(req.userId!, req.params.chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const rows = db.prepare("SELECT * FROM memories WHERE chat_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.chatId);
  res.json(rows);
});

router.get("/chats/:chatId/snapshot", authMiddleware, (req: AuthRequest, res: Response) => {
  const chat = getOwnedAccessibleChat(req.userId!, req.params.chatId);
  if (!chat) {
    res.status(404).json({ error: "聊天不存在" });
    return;
  }
  const row = db.prepare("SELECT * FROM session_snapshots WHERE chat_id = ?").get(req.params.chatId);
  res.json(row || null);
});

// ─── Moments ─────────────────────────────────────────────────────────

router.get("/moments/character/:characterId", authMiddleware, (req: AuthRequest, res: Response) => {
  const { characterId } = req.params;
  const rows = db.prepare(
    "SELECT * FROM moments WHERE user_id = ? AND character_id = ? ORDER BY created_at DESC"
  ).all(req.userId!, characterId) as any[];
  res.json(rows.map(mapMomentRow));
});

router.get("/moments/connected-characters", authMiddleware, (req: AuthRequest, res: Response) => {
  res.json(getConnectedMomentCharacters(req.userId!));
});

router.post("/moments", authMiddleware, async (req: AuthRequest, res: Response) => {
  const rawContent = typeof req.body?.content === "string" ? req.body.content : "";
  const content = rawContent.trim();
  const imageUrl = typeof req.body?.imageUrl === "string" && req.body.imageUrl.trim()
    ? req.body.imageUrl.trim()
    : null;
  const mentionedCharacterIds = parseStringArray(req.body?.mentionedCharacterIds);

  if (!content && !imageUrl) {
    res.status(400).json({ error: "朋友圈内容不能为空" });
    return;
  }

  const profile = db.prepare(
    "SELECT preferred_name, avatar_image FROM users WHERE id = ?"
  ).get(req.userId!) as any;
  const userName = profile?.preferred_name || "我";
  const userAvatar = profile?.avatar_image || "";

  const connectedCharacters = getConnectedMomentCharacters(req.userId!);
  const connectedMap = new Map(connectedCharacters.map((character) => [character.id, character]));
  const validMentionIds = [...new Set(mentionedCharacterIds.filter((id) => connectedMap.has(id)))];
  const mentionedNames = validMentionIds
    .map((id) => connectedMap.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  const analysis = await analyzeUserMomentForComments({
    content,
    hasImage: Boolean(imageUrl),
    mentionedNames,
  });

  const momentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO moments (
      id, user_id, character_id, character_name, character_avatar, content, image_url, source_type, status, comments, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    momentId,
    req.userId!,
    null,
    userName,
    userAvatar,
    content,
    imageUrl,
    "user_post",
    "published",
    "[]",
    createdAt
  );

  const guaranteedIds = new Set(validMentionIds);
  const optionalIds = connectedCharacters
    .map((character) => character.id)
    .filter((characterId) => !guaranteedIds.has(characterId))
    .filter(() => Math.random() < 0.5);
  const scheduledIds = [...guaranteedIds, ...optionalIds];

  scheduledIds.forEach((characterId, index) => {
    const character = connectedMap.get(characterId);
    if (!character) return;

    const executeAfter = new Date(
      Date.now() + (45 + index * 35 + Math.floor(Math.random() * 90)) * 1000
    ).toISOString();

    db.prepare(
      "INSERT INTO event_queue (id, event_type, event_status, execute_after, payload) VALUES (?,?,?,?,?)"
    ).run(
      crypto.randomUUID(),
      "user_moment_character_comment",
      "pending",
      executeAfter,
      JSON.stringify({
        moment_id: momentId,
        user_id: req.userId!,
        user_name: userName,
        character_id: character.id,
        character_name: character.name,
        character_avatar: character.avatar_url,
        persona: character.persona,
        overview: character.overview,
        was_mentioned: guaranteedIds.has(characterId),
        moment_content: content,
        moment_image_url: imageUrl,
        moment_summary: analysis.summary,
        moment_tone: analysis.tone,
        moment_focus: analysis.focus,
      })
    );
  });

  const row = db.prepare("SELECT * FROM moments WHERE id = ? AND user_id = ?").get(momentId, req.userId!) as any;
  res.json(mapMomentRow(row));
});

router.get("/moments", authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = db.prepare("SELECT * FROM moments WHERE user_id = ? ORDER BY created_at DESC").all(req.userId!) as any[];
  res.json(rows.map(mapMomentRow));
});

router.post("/moments/:id/like", authMiddleware, (req: AuthRequest, res: Response) => {
  const moment = db.prepare("SELECT * FROM moments WHERE id = ? AND user_id = ?").get(req.params.id, req.userId!) as any;
  if (!moment) { res.status(404).json({ error: "动态不存在" }); return; }

  const newLiked = moment.is_liked ? 0 : 1;
  const newLikes = newLiked ? moment.likes + 1 : Math.max(0, moment.likes - 1);
  db.prepare("UPDATE moments SET is_liked = ?, likes = ? WHERE id = ?").run(newLiked, newLikes, req.params.id);
  res.json({ is_liked: newLiked, likes: newLikes });
});

router.post("/moments/:id/comment", authMiddleware, (req: AuthRequest, res: Response) => {
  const { text } = req.body;
  const moment = db.prepare("SELECT * FROM moments WHERE id = ? AND user_id = ?").get(req.params.id, req.userId!) as any;
  if (!moment) { res.status(404).json({ error: "动态不存在" }); return; }
  if (moment.source_type === "user_post") {
    res.status(400).json({ error: "用户朋友圈暂不支持手动评论" });
    return;
  }

  const comments = parseMomentComments(moment.comments);
  const profile = db.prepare("SELECT preferred_name FROM users WHERE id = ?").get(req.userId!) as any;
  const userName = profile?.preferred_name || "用户";
  const userComment = { id: Date.now().toString(), author: userName, text, isAI: false, created_at: new Date().toISOString() };
  comments.push(userComment);
  db.prepare("UPDATE moments SET comments = ? WHERE id = ?").run(JSON.stringify(comments), req.params.id);

  let persona = "温暖、体贴的AI伴侣。";
  const charDoc = db.prepare(
    "SELECT persona FROM characters WHERE id = ? AND user_id = ?"
  ).get(moment.character_id, moment.user_id) as any;
  if (charDoc) persona = charDoc.persona;

  const delayMs = (1 + Math.random() * 4) * 60 * 1000;
  const executeAfter = new Date(Date.now() + delayMs).toISOString();

  db.prepare(
    "INSERT INTO event_queue (id, event_type, event_status, execute_after, payload) VALUES (?,?,?,?,?)"
  ).run(
    crypto.randomUUID(),
    "moment_comment_reply",
    "pending",
    executeAfter,
    JSON.stringify({
      moment_id: req.params.id,
      user_id: req.userId!,
      comment_text: text,
      user_name: userName,
      character_name: moment.character_name || "AI",
      persona,
      moment_content: moment.content || "",
    })
  );

  res.json({ userComment });
});

router.get("/moments/unread-count", authMiddleware, (req: AuthRequest, res: Response) => {
  const row = db.prepare("SELECT unread_moment_replies FROM users WHERE id = ?").get(req.userId!) as any;
  res.json({ count: row?.unread_moment_replies || 0 });
});

router.post("/moments/mark-read", authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare("UPDATE users SET unread_moment_replies = 0 WHERE id = ?").run(req.userId!);
  res.json({ ok: true });
});

export default router;
