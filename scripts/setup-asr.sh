#!/usr/bin/env bash
# Install Python deps and download the sherpa-onnx SenseVoice int8 model.
# Works on macOS (Apple Silicon / Intel) and Ubuntu (x86_64 / arm64).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$SCRIPT_DIR/../asr-service"
cd "$SERVICE_DIR"

MODEL_NAME="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
MODEL_DIR="$SERVICE_DIR/models/$MODEL_NAME"
MODEL_TARBALL="$MODEL_NAME.tar.bz2"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$MODEL_TARBALL"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[setup-asr] python3 not found. Install Python 3.9+ first." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[setup-asr] WARNING: ffmpeg not found on PATH."
  echo "  macOS:  brew install ffmpeg"
  echo "  Ubuntu: sudo apt install -y ffmpeg"
fi

if [ ! -d venv ]; then
  echo "[setup-asr] creating venv..."
  python3 -m venv venv
fi

echo "[setup-asr] upgrading pip..."
./venv/bin/pip install --upgrade pip

echo "[setup-asr] installing requirements..."
./venv/bin/pip install -r requirements.txt

mkdir -p "$SERVICE_DIR/models"
if [ -f "$MODEL_DIR/model.int8.onnx" ] && [ -f "$MODEL_DIR/tokens.txt" ]; then
  echo "[setup-asr] model already present at $MODEL_DIR"
else
  echo "[setup-asr] downloading model bundle (~250MB)..."
  cd "$SERVICE_DIR/models"
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail -o "$MODEL_TARBALL" "$MODEL_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$MODEL_TARBALL" "$MODEL_URL"
  else
    echo "[setup-asr] need curl or wget to download the model" >&2
    exit 1
  fi
  echo "[setup-asr] extracting..."
  tar -xjf "$MODEL_TARBALL"
  rm -f "$MODEL_TARBALL"
  cd "$SERVICE_DIR"
fi

if [ ! -f "$MODEL_DIR/model.int8.onnx" ]; then
  echo "[setup-asr] model.int8.onnx missing after extract; check $MODEL_DIR" >&2
  exit 1
fi

echo
echo "[setup-asr] done. Start the service with:"
echo "  cd asr-service && ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000"
echo "Or via PM2 (production):"
echo "  pm2 start ecosystem.config.cjs"
