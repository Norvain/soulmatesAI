# soulmate-asr

Local FunASR service for speech-to-text. Runs as a separate process next to the
Node app; Node forwards audio to this service over `127.0.0.1:8000`.

Model: [SenseVoiceSmall](https://www.modelscope.cn/models/iic/SenseVoiceSmall)
(~230MB, Chinese-optimized, CPU inference ~1GB RAM).

## Prerequisites

- Python 3.9+ (`python3 --version`)
- `ffmpeg` on `PATH`
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install -y ffmpeg`

## Setup (macOS / Ubuntu, same commands)

From the repo root:

```bash
bash scripts/setup-asr.sh
```

This creates `asr-service/venv/`, installs deps, and pre-downloads the model
(first run downloads ~230MB to `~/.cache/modelscope/`).

If downloading from ModelScope is slow, set the mirror:

```bash
export MODELSCOPE_DOMAIN=modelscope.cn   # usually default
# or switch to HF mirror if needed
```

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
# {"text":"你好世界","duration_ms":823}
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ASR_MODEL_ID` | `iic/SenseVoiceSmall` | ModelScope model id |
| `ASR_MODEL_REVISION` | `master` | Model revision |

## Troubleshooting

- **Model download fails**: check network, or use a pre-downloaded cache at
  `~/.cache/modelscope/hub/iic/SenseVoiceSmall`.
- **`ffmpeg: command not found`**: install via brew / apt (see Prerequisites).
- **OOM on 4GB server**: restart the process; PM2 has `max_memory_restart: 2G`
  set. If persistent, switch `ASR_MODEL_ID` to a smaller Paraformer variant.
