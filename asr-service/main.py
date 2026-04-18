"""FunASR SenseVoice-Small ASR service.

Exposes:
  GET  /health       -> { ok, model_loaded }
  POST /transcribe   -> multipart audio file -> { text, duration_ms }

The model is loaded once at startup and kept in memory. ffmpeg is used to
normalize arbitrary input (webm/opus/mp4/wav/mp3) to 16kHz mono WAV before
feeding it to the model.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("asr")

MODEL_ID = os.environ.get("ASR_MODEL_ID", "iic/SenseVoiceSmall")
MODEL_REVISION = os.environ.get("ASR_MODEL_REVISION", "master")

_state: dict[str, Any] = {"model": None}


def _load_model() -> Any:
    from funasr import AutoModel  # imported lazily so /health works during load

    log.info("loading FunASR model: %s", MODEL_ID)
    model = AutoModel(
        model=MODEL_ID,
        model_revision=MODEL_REVISION,
        disable_update=True,
        device="cpu",
    )
    log.info("model loaded")
    return model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _state["model"] = _load_model()
    yield
    _state["model"] = None


app = FastAPI(title="soulmate-asr", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "model_loaded": _state["model"] is not None}


def _ffmpeg_to_wav(src_path: str, dst_path: str) -> None:
    """Transcode any input to 16kHz mono PCM WAV."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", src_path,
        "-ac", "1", "-ar", "16000",
        "-f", "wav", dst_path,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode(errors='replace')}")


def _extract_text(raw: Any) -> str:
    """FunASR returns a list of dicts like [{'key': ..., 'text': '...'}]; SenseVoice
    text may include emotion/event tags like <|zh|><|HAPPY|><|...|>. Strip those.
    """
    if not raw:
        return ""
    first = raw[0] if isinstance(raw, list) else raw
    text = first.get("text", "") if isinstance(first, dict) else str(first)
    import re
    text = re.sub(r"<\|[^|]*\|>", "", text)
    return text.strip()


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> JSONResponse:
    model = _state["model"]
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    started = time.time()
    suffix = os.path.splitext(audio.filename or "")[1] or ".bin"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as src, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as dst:
        src_path, dst_path = src.name, dst.name
        try:
            content = await audio.read()
            if not content:
                raise HTTPException(status_code=400, detail="empty audio")
            src.write(content)
            src.flush()

            try:
                _ffmpeg_to_wav(src_path, dst_path)
            except RuntimeError as exc:
                log.warning("ffmpeg error: %s", exc)
                raise HTTPException(status_code=400, detail="invalid audio format") from exc

            result = model.generate(
                input=dst_path,
                cache={},
                language="zh",
                use_itn=True,
                batch_size_s=60,
            )
            text = _extract_text(result)
            duration_ms = int((time.time() - started) * 1000)
            log.info("transcribed bytes=%d text_len=%d duration=%dms",
                     len(content), len(text), duration_ms)
            return JSONResponse({"text": text, "duration_ms": duration_ms})
        finally:
            for p in (src_path, dst_path):
                try: os.unlink(p)
                except OSError: pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, workers=1)
