import db from "./db.js";
import { chatCompletion, ChatMessage } from "./minimax.js";

const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

interface CommentReplyPayload {
  moment_id: string;
  user_id: string;
  comment_text: string;
  user_name: string;
  character_name: string;
  persona: string;
  moment_content: string;
}

interface UserMomentCharacterCommentPayload {
  moment_id: string;
  user_id: string;
  user_name: string;
  character_id: string;
  character_name: string;
  character_avatar?: string;
  persona: string;
  overview?: string;
  was_mentioned: boolean;
  moment_content: string;
  moment_image_url?: string | null;
  moment_summary?: string;
  moment_tone?: string;
  moment_focus?: string;
}

function parseComments(raw: string | null | undefined) {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function normalizeGeneratedComment(raw: string): string {
  const cleaned = (raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleaned) return "";

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.comment === "string") {
      return parsed.comment.replace(/^\s*["']+|["']+\s*$/g, "").trim();
    }
  } catch {}

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (typeof parsed?.comment === "string") {
        return parsed.comment.replace(/^\s*["']+|["']+\s*$/g, "").trim();
      }
    } catch {}
  }

  return cleaned
    .replace(/^comment\s*[:：]\s*/i, "")
    .replace(/^\s*["']+|["']+\s*$/g, "")
    .split("\n")[0]
    .trim();
}

async function processCommentReply(payload: CommentReplyPayload) {
  const { moment_id, user_id, comment_text, user_name, character_name, persona, moment_content } = payload;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `你叫${character_name}。${persona}。你不是AI助手，你是一个真实的人。\n现在你在回复自己朋友圈下面的评论，保持角色一致，回复简短自然（1-2句）。`,
      name: character_name,
    },
    {
      role: "user",
      content: `你发了一条朋友圈："${moment_content}"\n\n${user_name}评论了："${comment_text}"\n\n请以${character_name}的身份回复这条评论。`,
      name: user_name,
    },
  ];

  const reply = await chatCompletion(messages, { maxTokens: 256 });
  const cleanReply = (reply || "").replace(/^\s*["']+|["']+\s*$/g, "").trim();

  const moment = db.prepare("SELECT comments FROM moments WHERE id = ? AND user_id = ?").get(moment_id, user_id) as any;
  if (!moment) return;

  const comments = parseComments(moment.comments);

  comments.push({
    id: `reply_${Date.now()}`,
    author: character_name,
    text: cleanReply,
    isAI: true,
    created_at: new Date().toISOString(),
  });

  db.prepare("UPDATE moments SET comments = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(comments), moment_id, user_id);

  db.prepare("UPDATE users SET unread_moment_replies = unread_moment_replies + 1 WHERE id = ?")
    .run(payload.user_id);

  console.log(`[EventQueue] ${character_name} replied to comment on moment ${moment_id}: "${cleanReply.slice(0, 40)}..."`);
}

async function processUserMomentCharacterComment(payload: UserMomentCharacterCommentPayload) {
  const moment = db.prepare(
    "SELECT comments, content, image_url, source_type FROM moments WHERE id = ? AND user_id = ?"
  ).get(payload.moment_id, payload.user_id) as any;
  if (!moment || moment.source_type !== "user_post") return;

  const comments = parseComments(moment.comments);
  const alreadyCommented = comments.some((comment: any) =>
    comment?.character_id === payload.character_id ||
    (comment?.isAI && comment?.author === payload.character_name)
  );
  if (alreadyCommented) return;

  const analysisSummary = payload.moment_summary || payload.moment_content || "分享了一条朋友圈";
  const analysisTone = payload.moment_tone || "日常";
  const analysisFocus = payload.moment_focus || "生活分享";

  let cleanComment = "";
  try {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `你叫${payload.character_name}。人设：${payload.persona || "自然、真实"}。补充信息：${payload.overview || "无"}。你不是AI助手，你是一个真实的人。

现在你要在用户的朋友圈下留言。

规则：
- 必须完全以${payload.character_name}的口吻说话
- 中文，自然像真实评论，不要像客服或助手
- 只写 1 句话，尽量 8-24 个字
- 如果用户 @ 了你，可以更熟稔、更直接一点
- 如果没有 @ 你，就像偶然刷到后的自然回应
- 不要使用引号，不要加表情包，不要解释自己为什么这么说
- 只返回评论正文这一句话，不要有任何额外说明`,
        name: payload.character_name,
      },
      {
        role: "user",
        content: `发朋友圈的人：${payload.user_name}
朋友圈正文：${payload.moment_content || "（无正文）"}
朋友圈概括：${analysisSummary}
氛围：${analysisTone}
主题：${analysisFocus}
是否配图：${payload.moment_image_url ? "是" : "否"}
是否@了你：${payload.was_mentioned ? "是" : "否"}

请以${payload.character_name}的身份留一条评论。`,
        name: payload.user_name,
      },
    ];
    const raw = await chatCompletion(messages, { maxTokens: 160, temperature: 0.9 });
    cleanComment = (raw || "")
      .replace(/^\s*["']+|["']+\s*$/g, "")
      .split("\n")[0]
      .trim();
  } catch (error) {
    console.error("[EventQueue] User moment comment generation failed:", error);
  }
  if (!cleanComment) return;

  comments.push({
    id: `moment_comment_${Date.now()}`,
    author: payload.character_name,
    text: cleanComment,
    isAI: true,
    character_id: payload.character_id,
    created_at: new Date().toISOString(),
  });

  db.prepare("UPDATE moments SET comments = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(comments), payload.moment_id, payload.user_id);

  db.prepare("UPDATE users SET unread_moment_replies = unread_moment_replies + 1 WHERE id = ?")
    .run(payload.user_id);

  console.log(`[EventQueue] ${payload.character_name} commented on user moment ${payload.moment_id}: "${cleanComment.slice(0, 40)}..."`);
}

async function tick() {
  const now = new Date().toISOString();

  const events = db.prepare(
    "SELECT * FROM event_queue WHERE event_status = 'pending' AND execute_after <= ? ORDER BY execute_after ASC LIMIT 10"
  ).all(now) as any[];

  for (const event of events) {
    try {
      const payload = JSON.parse(event.payload);

      if (event.event_type === "moment_comment_reply") {
        await processCommentReply(payload as CommentReplyPayload);
      } else if (event.event_type === "user_moment_character_comment") {
        await processUserMomentCharacterComment(payload as UserMomentCharacterCommentPayload);
      }

      db.prepare(
        "UPDATE event_queue SET event_status = 'completed', processed_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), event.id);
    } catch (e: any) {
      console.error(`[EventQueue] Error processing event ${event.id}:`, e.message);
      db.prepare(
        "UPDATE event_queue SET event_status = 'failed', processed_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), event.id);
    }
  }
}

export function startEventQueue() {
  console.log("[EventQueue] Started, interval:", POLL_INTERVAL_MS / 1000, "s");
  setTimeout(() => {
    tick().catch(e => console.error("[EventQueue] tick error:", e));
  }, 10000);
  setInterval(() => {
    tick().catch(e => console.error("[EventQueue] tick error:", e));
  }, POLL_INTERVAL_MS);
}
