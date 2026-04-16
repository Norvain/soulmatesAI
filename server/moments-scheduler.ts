import crypto from "crypto";
import db from "./db.js";
import { chatCompletion, generateImage, ChatMessage } from "./minimax.js";
import {
  getPresetAvatar,
  getPresetName,
  getPresetOverview,
  getPresetPersona,
} from "./preset-characters.js";

const SCHEDULE_INTERVAL_MS = 60 * 1000; // 1 minute
const FIRST_MOMENT_DELAY_MS = 5 * 60 * 1000;

function isInSleepWindow(sleepStart: number, sleepEnd: number): boolean {
  const hour = new Date().getHours();
  if (sleepStart <= sleepEnd) {
    return hour >= sleepStart && hour < sleepEnd;
  }
  // wraps midnight, e.g. 23 -> 7
  return hour >= sleepStart || hour < sleepEnd;
}

function randomHours(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function nextRecurringWindow(): string {
  const ms = randomHours(3, 24) * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

interface ConnectedChat {
  id: string;
  user_id: string;
  character_id: string;
  last_moment_at: string | null;
  last_user_message_at: string | null;
  next_moment_window: string | null;
  moment_probability: number;
  sleep_start: number;
  sleep_end: number;
}

async function generateMomentForChat(chat: ConnectedChat) {
  const character = db.prepare(
    "SELECT name, persona, overview, avatar_url FROM characters WHERE id = ? AND user_id = ?"
  ).get(chat.character_id, chat.user_id) as any;
  const charName = character?.name || getPresetName(chat.character_id);
  const charPersona = character?.persona || getPresetPersona(chat.character_id);
  const charOverview = character?.overview || getPresetOverview(chat.character_id);
  const charAvatar = character?.avatar_url || getPresetAvatar(chat.character_id) || `/avatars/${charName}.png`;

  const relationState = db.prepare(
    "SELECT * FROM relation_states WHERE chat_id = ?"
  ).get(chat.id) as any;
  const stage = relationState?.relation_stage || "陌生";
  const intimacy = relationState?.intimacy_score || 0;

  const recentMemories = db.prepare(
    "SELECT summary FROM memories WHERE chat_id = ? ORDER BY created_at DESC LIMIT 3"
  ).all(chat.id) as any[];
  const memoryContext = recentMemories.map(m => m.summary).filter(Boolean).join("；");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `你叫${charName}。${charPersona}。补充信息：${charOverview}。你不是AI助手，你是一个真实的人。

当前与用户的关系阶段：${stage}（亲密度：${intimacy}）
近期记忆：${memoryContext || "无"}

现在你要发一条朋友圈动态。如果你觉得这条动态适合配图（比如美食、风景、自拍、活动等），请在正文末尾另起一行，用 [IMG: 图片描述] 标记你想配的图片。

规则：
- 用中文写
- 内容可以是你的日常生活、心情、爱好，也可以跟用户的关系有关
- 保持 1-3 句话，自然的社交媒体风格
- 不要写引号，不要加解释说明
- 绝对不要在正文里写"（配上一张...的照片）"之类的括号描述
- 如果需要配图，只用 [IMG: 描述] 格式标记，放在最后一行
- 如果不需要配图就不要加 [IMG] 标记`,
      name: charName,
    },
    {
      role: "user",
      content: `请以${charName}的身份发一条朋友圈。`,
    },
  ];

  try {
    let rawContent = (await chatCompletion(messages, { maxTokens: 300, temperature: 0.95 }))
      .replace(/^\s*["']+|["']+\s*$/g, "")
      .trim();
    if (!rawContent) return;

    let imageUrl = "";
    const imgTagMatch = rawContent.match(/\[IMG:\s*(.+?)\]\s*$/i);
    const parenImageMatch = rawContent.match(/[（(]\s*(?:配上|附上|配图|拍了|晒一?张?)[^)）]*[)）]\s*$/);

    if (imgTagMatch) {
      const imgDesc = imgTagMatch[1].trim();
      rawContent = rawContent.replace(/\[IMG:\s*.+?\]\s*$/i, "").trim();
      try {
        const imagePrompt = `${imgDesc}, high quality, photorealistic, social media photo style, ${charOverview || charPersona}`;
        imageUrl = await generateImage(imagePrompt);
      } catch (e: any) {
        console.error("[MomentScheduler] Image generation failed:", e.message);
      }
    } else if (parenImageMatch) {
      const hintText = parenImageMatch[0].replace(/[（()）]/g, "").trim();
      rawContent = rawContent.replace(parenImageMatch[0], "").trim();
      try {
        const imagePrompt = `${hintText}, high quality, photorealistic, social media photo, ${charOverview || charPersona}`;
        imageUrl = await generateImage(imagePrompt);
      } catch (e: any) {
        console.error("[MomentScheduler] Image generation failed:", e.message);
      }
    }

    const content = rawContent
      .split("\n")
      .filter((l: string) => l.trim())
      .join("\n")
      .trim();
    if (!content) return;

    const momentId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO moments (id, user_id, character_id, character_name, character_avatar, content, image_url, source_type, status) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(momentId, chat.user_id, chat.character_id, charName, charAvatar, content, imageUrl || null, "independent", "published");

    console.log(`[MomentScheduler] ${charName} posted: "${content.slice(0, 40)}..." image: ${imageUrl ? "yes" : "no"}`);
  } catch (e: any) {
    console.error("[MomentScheduler] Generation failed for", charName, ":", e.message);
  }
}

async function tick() {
  const now = new Date().toISOString();

  const chats = db.prepare(
    `SELECT id, user_id, character_id, last_moment_at, last_user_message_at,
            next_moment_window, moment_probability, sleep_start, sleep_end
     FROM chats
     WHERE is_connected = 1`
  ).all() as ConnectedChat[];

  for (const chat of chats) {
    let dueWindow = chat.next_moment_window;

    if (!chat.last_moment_at) {
      const baseTime = chat.last_user_message_at
        ? new Date(chat.last_user_message_at).getTime() + FIRST_MOMENT_DELAY_MS
        : Date.now() + FIRST_MOMENT_DELAY_MS;
      const firstDueWindow = new Date(baseTime).toISOString();
      if (!dueWindow || dueWindow > firstDueWindow) {
        dueWindow = firstDueWindow;
        db.prepare("UPDATE chats SET next_moment_window = ? WHERE id = ?").run(dueWindow, chat.id);
      }
    } else if (!dueWindow) {
      dueWindow = nextRecurringWindow();
      db.prepare("UPDATE chats SET next_moment_window = ? WHERE id = ?").run(dueWindow, chat.id);
    }

    if (!dueWindow) {
        dueWindow = nextRecurringWindow();
      db.prepare("UPDATE chats SET next_moment_window = ? WHERE id = ?").run(dueWindow, chat.id);
    }

    if (now < dueWindow) continue;

    const isFirstMoment = !chat.last_moment_at;

    if (!isFirstMoment && isInSleepWindow(chat.sleep_start, chat.sleep_end)) continue;

    if (isFirstMoment) {
      console.log(`[MomentScheduler] Generating first moment for chat ${chat.id}`);
      await generateMomentForChat(chat);
      db.prepare("UPDATE chats SET next_moment_window = ?, last_moment_at = ? WHERE id = ?")
        .run(nextRecurringWindow(), now, chat.id);
      continue;
    }

    const roll = Math.random();
    const probability = chat.moment_probability || 0.6;
    db.prepare("UPDATE chats SET next_moment_window = ? WHERE id = ?")
      .run(nextRecurringWindow(), chat.id);
    if (roll >= probability) {
      console.log(`[MomentScheduler] ${chat.character_id}: probability miss (${roll.toFixed(2)} >= ${probability})`);
      continue;
    }

    console.log(`[MomentScheduler] Generating moment for chat ${chat.id}`);
    await generateMomentForChat(chat);
    db.prepare("UPDATE chats SET last_moment_at = ? WHERE id = ?").run(now, chat.id);
  }
}

export function startMomentsScheduler() {
  console.log("[MomentScheduler] Started, interval:", SCHEDULE_INTERVAL_MS / 1000, "s");
  // Run first check after a short delay
  setTimeout(() => {
    tick().catch(e => console.error("[MomentScheduler] tick error:", e));
  }, 5000);
  setInterval(() => {
    tick().catch(e => console.error("[MomentScheduler] tick error:", e));
  }, SCHEDULE_INTERVAL_MS);
}
