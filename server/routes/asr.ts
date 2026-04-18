import { Router, Response } from "express";
import { AuthRequest, authMiddleware } from "../auth.js";

const router = Router();

const ASR_SERVICE_URL = process.env.ASR_SERVICE_URL || "http://127.0.0.1:8000";
const ASR_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB decoded

interface TranscribeBody {
  audio?: string;       // base64 (no data URL prefix)
  mimeType?: string;    // e.g. "audio/webm;codecs=opus", "audio/mp4"
}

function extFromMime(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("webm")) return "webm";
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return "m4a";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  return "bin";
}

router.post("/transcribe", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { audio, mimeType } = (req.body || {}) as TranscribeBody;
  if (!audio || typeof audio !== "string") {
    return res.status(400).json({ error: "缺少音频数据" });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(audio, "base64");
  } catch {
    return res.status(400).json({ error: "音频数据格式错误" });
  }
  if (buf.length === 0) {
    return res.status(400).json({ error: "音频数据为空" });
  }
  if (buf.length > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: "音频过大，请缩短时长后重试" });
  }

  const ext = extFromMime(mimeType || "");
  const blob = new Blob([buf], { type: mimeType || "application/octet-stream" });
  const form = new FormData();
  form.append("audio", blob, `upload.${ext}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ASR_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${ASR_SERVICE_URL}/transcribe`, {
      method: "POST",
      body: form as any,
      signal: ctrl.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("[asr] upstream error", upstream.status, detail);
      return res.status(502).json({ error: "语音识别服务异常，请稍后再试" });
    }

    const data = await upstream.json() as { text?: string; duration_ms?: number };
    const text = (data.text || "").trim();
    if (!text) {
      return res.status(200).json({ text: "", error: "没有识别到语音，请靠近麦克风再试一次" });
    }
    return res.json({ text, durationMs: data.duration_ms });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "语音识别超时，请缩短时长后重试" });
    }
    console.error("[asr] fetch failed", err);
    return res.status(503).json({ error: "语音识别服务暂不可用，请使用文字输入" });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
