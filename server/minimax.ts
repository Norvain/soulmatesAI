import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const M2HER_URL = "https://api.minimaxi.com/v1/text/chatcompletion_v2";
const ANTHROPIC_URL = "https://api.minimaxi.com/anthropic/v1/messages";
const IMAGE_URL = "https://api.minimaxi.com/v1/image_generation";
const T2A_URL = "https://api.minimaxi.com/v1/t2a_v2";
const GENERATED_MEDIA_DIR = path.join(process.cwd(), "generated-media");
const GENERATED_MEDIA_PUBLIC_PATH = "/generated-media";

function getM2HerKey() {
  return process.env.MINIMAX_M2HER_API_KEY || process.env.MINIMAX_API_KEY || "";
}

function getM27Key() {
  return process.env.MINIMAX_API_KEY || "";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "user_system" | "group" | "sample_message_user" | "sample_message_ai";
  content: string;
  name?: string;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

function isRetryableError(err: any): boolean {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("529") ||
    msg.includes("system error") ||
    msg.includes("overloaded") ||
    msg.includes("1033") ||
    msg.includes("empty response")
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function inferImageExtension(contentType: string | null, sourceUrl: string): string {
  const normalizedType = (contentType || "").toLowerCase();
  if (normalizedType.includes("png")) return ".png";
  if (normalizedType.includes("webp")) return ".webp";
  if (normalizedType.includes("gif")) return ".gif";
  if (normalizedType.includes("bmp")) return ".bmp";
  if (normalizedType.includes("svg")) return ".svg";
  if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return ".jpg";

  try {
    const pathname = new URL(sourceUrl).pathname;
    const ext = path.extname(pathname);
    if (ext) return ext.toLowerCase();
  } catch {}

  return ".jpg";
}

async function persistGeneratedImage(sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to download generated image: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type");
  const ext = inferImageExtension(contentType, sourceUrl);
  const fileName = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(GENERATED_MEDIA_DIR, fileName);
  const arrayBuffer = await res.arrayBuffer();

  await mkdir(GENERATED_MEDIA_DIR, { recursive: true });
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return `${GENERATED_MEDIA_PUBLIC_PATH}/${fileName}`;
}

/**
 * M2-her: roleplay-optimized text response (OpenAI-compatible endpoint).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const apiMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.name ? { name: m.name } : {}),
  }));

  console.log("[M2-her] msgs:", apiMessages.length);

  return retryCall(async () => {
    const res = await fetch(M2HER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getM2HerKey()}`,
      },
      body: JSON.stringify({
        model: "M2-her",
        messages: apiMessages,
        temperature: options.temperature ?? 1.0,
        top_p: 0.95,
        max_completion_tokens: options.maxTokens ?? 2048,
      }),
    });

    const data = await res.json();
    if (data.base_resp?.status_code) {
      throw new Error(`M2-her error: [${data.base_resp.status_code}] ${data.base_resp.status_msg}`);
    }
    const text = data.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("M2-her returned empty response");
    return text;
  });
}

/**
 * M2.7: general-purpose model via Anthropic-compatible endpoint.
 * Used for intent detection and structured JSON output.
 */
export async function chatCompletionM27(
  systemPrompt: string,
  userContent: string,
  options: { maxTokens?: number; noFallback?: boolean } = {}
): Promise<string> {
  console.log("[M2.7] call, system:", systemPrompt.slice(0, 60) + "...");

  const callM27 = async () => {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getM27Key(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "MiniMax-M2.7",
        max_tokens: options.maxTokens ?? 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await res.json();

    if (data.error) {
      throw new Error(`M2.7 error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    let text = "";
    const hasThinking = Array.isArray(data.content) && data.content.some((b: any) => b.type === "thinking");
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) { text = block.text; break; }
      }
    } else if (typeof data.content === "string") {
      text = data.content;
    }
    if (!text) {
      if (hasThinking && !options.noFallback) {
        console.warn("[M2.7] Thinking-only response, skipping retry → M2-her fallback");
        throw Object.assign(new Error("M2.7 thinking-only"), { __skipRetry: true });
      }
      console.warn(`[M2.7] Thinking-only response, will retry (noFallback=${!!options.noFallback})`);
      throw new Error("M2.7 returned empty text (thinking-only)");
    }
    return text;
  };

  try {
    return await retryCall(callM27);
  } catch (err: any) {
    if (!options.noFallback && (err?.__skipRetry || err?.message?.includes("thinking-only"))) {
      return chatCompletion(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        { maxTokens: options.maxTokens ?? 512, temperature: 0.35 }
      );
    }
    throw err;
  }
}

export interface IntentResult {
  need_image: boolean;
  image_prompt?: string;
  subject?: "self" | "with_self" | "none";
}

/**
 * Use M2.7 to detect user intent based on conversation context.
 * Determines if image generation is needed, what to generate, and whether
 * the character themselves should appear (in which case the appearance
 * card is prepended to lock identity consistency).
 */
export async function detectIntent(
  userText: string,
  conversationContext: string,
  charName: string,
  charPersona: string,
  charOverview: string,
  charAppearance: string = ""
): Promise<IntentResult> {
  const systemPrompt = `You are an intent classifier. Based on the conversation context and the user's latest message, determine if the user is requesting to see an image/photo.

Image requests include:
- Asking to see the character (selfie, photo of them)
- Asking to see scenery, landscape, or a place they're talking about
- Asking to see food, objects, or anything visual they're discussing
- Asking the character to share/send a photo of anything

Return ONLY valid JSON (no markdown, no extra text):
{"need_image": true/false, "image_prompt": "detailed Chinese or English prompt", "subject": "self" | "with_self" | "none"}

Subject classification rules (only meaningful when need_image is true):
- "self": user wants a portrait/selfie of ${charName} themselves — face, outfit, look. Identity must be locked.
- "with_self": ${charName} appears in the scene but is not the sole focus (e.g., "拍一下你做的菜，最好你也入镜"、"你画稿的样子"). Identity must still be locked.
- "none": image is unrelated to the character's appearance — pure scenery, food, objects, third parties (e.g., "今晚做的汤"、"窗外的雨"). Free generation.

For image_prompt:
- If subject is "self" or "with_self" → describe ONLY the scene / pose / context (NOT the character's physical appearance — identity will be injected separately). Be concrete about action, environment, lighting, mood.
- If subject is "none" → fully describe the target object/scenery in detail.
- Always end with quality cues: 高清, 细节丰富, 自然光, 电影感.

If need_image is false, image_prompt should be empty string and subject should be "none".`;

  const userContent = `Recent conversation:\n${conversationContext}\n\nUser's latest message: ${userText}`;

  try {
    const raw = await chatCompletionM27(systemPrompt, userContent, { maxTokens: 360 });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const need = !!parsed.need_image;
      const subject: IntentResult["subject"] =
        parsed.subject === "self" || parsed.subject === "with_self" ? parsed.subject : "none";
      let prompt = (parsed.image_prompt || "").trim();

      if (need && prompt && (subject === "self" || subject === "with_self") && charAppearance) {
        const focusHint =
          subject === "self"
            ? `画面主体是${charName}本人，正脸或半身入镜`
            : `${charName}出现在场景中，需要清晰露脸`;
        prompt = `${charAppearance}。${focusHint}。场景与动作：${prompt}`;
      }

      return {
        need_image: need,
        image_prompt: prompt,
        subject,
      };
    }
  } catch (e: any) {
    console.error("[M2.7] Intent detection failed:", e.message);
  }
  return { need_image: false, subject: "none" };
}

async function retryCall<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (err?.__skipRetry) throw err;
      console.error(`[MiniMax] Failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message || err);
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * JSON output via M2.7 (better at following structured instructions than M2-her).
 */
export async function chatCompletionJSON<T = any>(
  messages: ChatMessage[],
  _options: ChatOptions = {}
): Promise<T> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsg = messages.find((m) => m.role === "user");

  const system = (systemMsg?.content || "") +
    "\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown fences, no extra text. Start with { or [.";

  const raw = await chatCompletionM27(system, userMsg?.content || "", { maxTokens: 1024 });

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]) as T;
    throw new Error(`Failed to parse MiniMax JSON response: ${cleaned.slice(0, 300)}`);
  }
}

export async function generateImage(prompt: string): Promise<string> {
  const apiKey = getM27Key();

  let lastError: any;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(IMAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "image-01",
          prompt,
          aspect_ratio: "1:1",
          response_format: "url",
          n: 1,
        }),
      });

      const data = await res.json();

      if (data.base_resp && data.base_resp.status_code !== 0) {
        const code = data.base_resp.status_code;
        const msg = data.base_resp.status_msg;
        lastError = new Error(`MiniMax Image API error: [${code}] ${msg}`);
        if (attempt < MAX_RETRIES && (code >= 1000 || !res.ok)) {
          console.error(`[MiniMax Image] Error (attempt ${attempt}/${MAX_RETRIES}): [${code}] ${msg}`);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new Error(`MiniMax Image API HTTP ${res.status}: ${JSON.stringify(data)}`);
      }

      const url = data.data?.image_urls?.[0] || data.data?.[0]?.url || "";
      if (!url) throw new Error("MiniMax image generation returned no URL");
      return await persistGeneratedImage(url);
    } catch (err: any) {
      if (err === lastError) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        console.error(`[MiniMax Image] Error (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MiniMax image generation failed after retries");
}

/**
 * MiniMax T2A: text-to-speech synthesis.
 * Returns a base64 data URI (audio/mp3).
 */
export async function textToSpeech(
  text: string,
  voiceId: string = "female-shaonv"
): Promise<string> {
  console.log("[T2A] Generating speech, voice:", voiceId, "chars:", text.length);

  return retryCall(async () => {
    const res = await fetch(T2A_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getM27Key()}`,
      },
      body: JSON.stringify({
        model: "speech-2.8-hd",
        text,
        stream: false,
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    });

    const data = await res.json();

    if (data.base_resp && data.base_resp.status_code !== 0) {
      const code = data.base_resp.status_code;
      const msg = data.base_resp.status_msg;
      throw new Error(`T2A error: [${code}] ${msg}`);
    }

    const hexAudio = data.data?.audio;
    if (!hexAudio) throw new Error("T2A returned no audio data");

    const base64Audio = Buffer.from(hexAudio, "hex").toString("base64");
    return `data:audio/mp3;base64,${base64Audio}`;
  });
}
