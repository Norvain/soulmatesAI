"""Sherpa-ONNX SenseVoice ASR service (int8, CPU).

Exposes:
  GET  /health       -> { ok, model_loaded }
  POST /transcribe   -> multipart audio file -> { text, duration_ms }

Uses the official sherpa-onnx SenseVoice bundle (int8 quantized ONNX). Runtime
footprint on CPU is ~400-600MB, versus ~1.5-2GB for PyTorch + FunASR.

ffmpeg normalizes arbitrary input (webm/opus/mp4/wav/mp3) to 16kHz mono PCM WAV
before inference.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("asr")

_SERVICE_DIR = Path(__file__).resolve().parent
_DEFAULT_MODEL_DIR = _SERVICE_DIR / "models" / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"

MODEL_DIR = Path(os.environ.get("ASR_MODEL_DIR", str(_DEFAULT_MODEL_DIR)))
MODEL_FILE = os.environ.get("ASR_MODEL_FILE", "model.int8.onnx")
TOKENS_FILE = os.environ.get("ASR_TOKENS_FILE", "tokens.txt")
NUM_THREADS = int(os.environ.get("ASR_NUM_THREADS", "2"))
LANGUAGE = os.environ.get("ASR_LANGUAGE", "zh")

_state: dict[str, Any] = {"recognizer": None}


def _load_recognizer() -> Any:
    import sherpa_onnx  # imported lazily so /health works during load

    model_path = MODEL_DIR / MODEL_FILE
    tokens_path = MODEL_DIR / TOKENS_FILE
    if not model_path.is_file():
        raise FileNotFoundError(f"ASR model not found at {model_path}. Run scripts/setup-asr.sh.")
    if not tokens_path.is_file():
        raise FileNotFoundError(f"tokens file not found at {tokens_path}.")

    log.info("loading sherpa-onnx SenseVoice model: %s", model_path)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_path),
        tokens=str(tokens_path),
        num_threads=NUM_THREADS,
        use_itn=True,
        language=LANGUAGE,
        debug=False,
    )
    log.info("model loaded (threads=%d, language=%s)", NUM_THREADS, LANGUAGE)
    return recognizer


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _state["recognizer"] = _load_recognizer()
    yield
    _state["recognizer"] = None


app = FastAPI(title="soulmate-asr", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "model_loaded": _state["recognizer"] is not None}


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


def _read_wav_mono(path: str) -> tuple[np.ndarray, int]:
    """Read a 16-bit PCM WAV into float32 mono samples in [-1, 1]."""
    with wave.open(path, "rb") as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())

    if sampwidth != 2:
        raise RuntimeError(f"expected 16-bit PCM, got sampwidth={sampwidth}")

    pcm = np.frombuffer(frames, dtype=np.int16)
    if n_channels > 1:
        pcm = pcm.reshape(-1, n_channels).mean(axis=1).astype(np.int16)
    samples = pcm.astype(np.float32) / 32768.0
    return samples, sample_rate


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> JSONResponse:
    recognizer = _state["recognizer"]
    if recognizer is None:
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

            samples, sample_rate = _read_wav_mono(dst_path)
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, samples)
            recognizer.decode_stream(stream)
            text = (stream.result.text or "").strip()

            duration_ms = int((time.time() - started) * 1000)
            log.info("transcribed bytes=%d text_len=%d duration=%dms",
                     len(content), len(text), duration_ms)
            return JSONResponse({"text": text, "duration_ms": duration_ms})
        finally:
            for p in (src_path, dst_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, workers=1)
