# soulmate-asr

Local speech-to-text service backed by **sherpa-onnx + SenseVoice (int8)**. Runs
as a separate process next to the Node app; Node forwards audio to this service
over `127.0.0.1:8000`.

Model: [sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
(int8 quantized, ~250MB on disk, **~400-600MB RAM** at inference). This replaces
the previous PyTorch + FunASR setup, which used ~1.5-2GB RAM and OOM'd on 2C4G
servers.

## Prerequisites

- Python 3.9+ (`python3 --version`)
- `ffmpeg` on `PATH`
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install -y ffmpeg`
- `curl` or `wget` (for downloading the model bundle)

## Setup (macOS / Ubuntu)

From the repo root:

```bash
bash scripts/setup-asr.sh
```

This creates `asr-service/venv/`, installs deps, and downloads the model bundle
to `asr-service/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/`.

If the GitHub release download is slow in CN, you can manually fetch the tarball
via a mirror and extract it under `asr-service/models/`.

## Run

Standalone (for debugging):

```bash
cd asr-service
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

Via PM2 (production):

```bash
pm2 start ecosystem.config.cjs     # starts both soulmate-ai and soulmate-asr
pm2 logs soulmate-asr              # tail logs
```

## Quick test

```bash
curl http://127.0.0.1:8000/health
# {"ok":true,"model_loaded":true}

curl -F "audio=@sample.wav" http://127.0.0.1:8000/transcribe
# {"text":"你好世界","duration_ms":420}
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ASR_MODEL_DIR` | `asr-service/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` | Directory containing the model + tokens |
| `ASR_MODEL_FILE` | `model.int8.onnx` | ONNX model filename (use `model.onnx` for fp32 if RAM permits) |
| `ASR_TOKENS_FILE` | `tokens.txt` | Tokens filename |
| `ASR_NUM_THREADS` | `2` | ONNX Runtime intra-op threads (match vCPU count on small VMs) |
| `ASR_LANGUAGE` | `zh` | One of: `zh`, `en`, `ja`, `ko`, `yue`, `auto` |

## Memory budget on 2C4G

- sherpa-onnx + int8 model: ~500MB resident
- ffmpeg per request: ~30MB peak, transient
- Node app (soulmate-ai): typically 200-400MB

PM2 is configured with `max_memory_restart: 1200M` for soulmate-asr; if the
process exceeds that it will be restarted automatically.

## Troubleshooting

- **`model.int8.onnx` missing**: re-run `bash scripts/setup-asr.sh`, or download
  the tarball manually from the GitHub release page and extract under
  `asr-service/models/`.
- **`ffmpeg: command not found`**: install via brew / apt (see Prerequisites).
- **Higher accuracy needed**: set `ASR_MODEL_FILE=model.onnx` (fp32, ~900MB
  RAM). Only viable if you have ≥2GB headroom.
