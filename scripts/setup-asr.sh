#!/usr/bin/env bash
# Install Python deps and pre-download the FunASR model.
# Works on macOS (Apple Silicon / Intel) and Ubuntu (x86_64 / arm64).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$SCRIPT_DIR/../asr-service"
cd "$SERVICE_DIR"

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

echo "[setup-asr] installing requirements (this may take a few minutes)..."
./venv/bin/pip install -r requirements.txt

echo "[setup-asr] pre-downloading model (~230MB on first run)..."
./venv/bin/python - <<'PY'
from funasr import AutoModel
AutoModel(model="iic/SenseVoiceSmall", model_revision="master", disable_update=True, device="cpu")
print("model ready")
PY

echo
echo "[setup-asr] done. Start the service with:"
echo "  cd asr-service && ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000"
echo "Or via PM2 (production):"
echo "  pm2 start ecosystem.config.cjs"
