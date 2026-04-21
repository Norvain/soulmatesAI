# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (Express + Vite HMR on http://localhost:3000)
npm run dev

# Type check (no emit)
npm run lint

# Run API integration tests (requires dev server running)
node tests/api-test.mjs

# Production build
npm run build

# Production serve (after build)
npm start

# PM2 process management
npm run pm2:start       # Start both Node + Python ASR processes
npm run pm2:restart     # Restart Node process only
npm run pm2:logs        # Tail logs
npm run pm2:stop

# Database backup
npm run backup:local-prod
```

## Architecture

Full-stack TypeScript monorepo: React 19 frontend + Express backend, both served from the same Node process (`server.ts`). In dev, Vite runs as middleware for HMR; in production, Express serves the pre-built `dist/`.

```
React (src/)
  └─ src/lib/api.ts           ← all fetch calls to backend
        ↓ HTTP/REST
Express (server.ts → server/routes.ts)
  ├─ server/chat-runtime.ts   ← turn queue, context builder, proactive sender
  ├─ server/minimax.ts        ← MiniMax API wrapper (chat, TTS, image gen)
  ├─ server/db.ts             ← SQLite schema + all query helpers
  ├─ server/auth.ts           ← JWT middleware, register/login
  ├─ server/event-queue.ts    ← async comment generation for moments
  ├─ server/moments-scheduler.ts  ← periodic AI-generated moments
  └─ server/relationship-events-service.ts  ← story progression & choices
        ↓
SQLite (soulmate.db, WAL mode)
        ↓
MiniMax API  +  ASR service (Python/FastAPI on :8000)
```

### Chat Runtime Flow

1. User message → pushed to per-chat turn queue (`chat-runtime.ts`)
2. Queue processor builds context: character persona + relationship state + memories + recent history
3. Calls MiniMax M2-her; parses & stores response segments with inter-segment delays
4. Updates intimacy/trust scores; checks if relationship events unlock
5. Background loop (60s) evaluates proactive message schedule per user preference

### Relationship Event System

Visual-novel branching stories defined in `server/relationship-events-data.ts` as JSON trees. Unlocked by intimacy score threshold. Tracked across three tables: `relationship_event_definitions` (templates), `relationship_event_progress` (active playthrough), `relationship_event_playthroughs` (completed archive). CG images generated via MiniMax image API on completion.

### Moments (Social Feed)

Users post text/image moments → `event-queue.ts` asynchronously generates character comments via MiniMax → pushed as notifications. `moments-scheduler.ts` has characters proactively create moments on a probabilistic schedule.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion |
| Backend | Express 4, TypeScript, tsx |
| Database | SQLite via `better-sqlite3` (WAL mode, synchronous queries) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| AI | MiniMax (M2-her chat, image gen, TTS) |
| ASR | sherpa-onnx + SenseVoice int8 quantized model via Python FastAPI |
| Production | PM2 (manages Node + Python processes) |

## Environment Variables

Create `.env.local`:

```env
MINIMAX_M2HER_API_KEY=   # Text chat (M2-her model)
MINIMAX_API_KEY=          # Image generation + TTS
JWT_SECRET=               # Production: set a strong random string
ASR_SERVICE_URL=http://127.0.0.1:8000   # Optional, this is the default
```

## Key Conventions

- **Database queries** live entirely in `server/db.ts`; routes import query helpers, never call `better-sqlite3` directly.
- **API client** (`src/lib/api.ts`) is the single source of truth for endpoint URLs on the frontend.
- **Character data**: preset characters defined in `server/preset-characters.ts`; custom characters stored in DB with `is_custom = 1`.
- **Message roles**: `'user'` or `'model'`; message types: `'reply'` or `'proactive'`.
- **Relationship stage** progression is driven by `intimacy_score` thresholds stored in `relation_states`.
- **Generated media** (TTS audio, AI images) saved to `/generated-media/` and served as static files.

## ASR Service Setup (one-time)

```bash
bash scripts/setup-asr.sh
# Then start separately:
cd asr-service && ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

The ASR service is optional for development — speech input falls back gracefully when unavailable.
