# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (frontend + backend concurrently)
pnpm dev:all

# Build frontend (Next.js static export to out/)
pnpm build

# Build server (TypeScript compilation to server/dist/)
pnpm build:server

# Build both
pnpm build:all

# Build Tauri distribution for macOS ARM64
pnpm build:mac:arm64

# Sync version across all package.json files
pnpm sync-version

# Server database commands (run in server/)
pnpm --filter classnode-server db:generate   # Generate Prisma client after schema change
pnpm --filter classnode-server db:push       # Push schema to SQLite database
pnpm --filter classnode-server db:studio     # Open Prisma Studio GUI

# Kill dev servers
pnpm stop
```

## Architecture

### Monorepo (pnpm workspace)

- **`src/`** — Next.js frontend (React, static export via `output: 'export'`)
- **`server/`** — Express.js backend (TypeScript, ES modules)
- **`src-tauri/`** — Tauri v2 desktop wrapper (Rust sidecar)

### Frontend (`src/app/`)

Static export served by the Express backend. All pages in `src/app/teacher/`:

| Page | File | Purpose |
|------|------|---------|
| `teacher/` | `page.tsx` | Teacher login/home |
| `teacher/dashboard/` | `page.tsx` | Statistics dashboard |
| `teacher/classes/` | `page.tsx` | Class & student management (CRUD, grouping, avatars, batch ops) |
| `teacher/classroom/` | `page.tsx` | Active classroom board (real-time interaction) |
| `teacher/classroom/new/` | `page.tsx` | Create new classroom |
| `teacher/avatars/` | `page.tsx` | Avatar/icon library management (CRUD, random generation) |
| `teacher/agents/` | `page.tsx` | AI agent configuration (Coze/Dify/OpenAI) |
| `teacher/history/` | `page.tsx` | Past classroom records |
| `teacher/shield/` | `page.tsx` | Shield words management |
| `teacher/guide/` | `page.tsx` | User guide |
| `teacher/about/` | `page.tsx` | About page |
| `classroom/` | `page.tsx` | Student-facing portal (join with code, chat, avatar changer) |

**Shared libs** in `src/lib/`:
- `api.ts` — All API calls to Express backend
- `api-base.ts` — API base URL resolution (dev vs production)
- `components.tsx` — Shared UI components (Toast, Pagination)
- `socket.ts` — Socket.IO client setup
- `export-doc.ts` — DOCX report export

### Backend (`server/src/`)

Express server on port 3001. Routes in `server/src/routes/`:

| Route | File | Purpose |
|-------|------|---------|
| `/api/agents` | `agents.ts` | AI agent CRUD + proxy + connectivity check |
| `/api/classes` | `classes.ts` | Class CRUD, student CRUD, group management |
| `/api/classroom` | `classroom.ts` | Classroom lifecycle, messages, real-time state |
| `/api/avatars` | `avatars.ts` | Avatar/icon library, random SVG generation, assignments |
| `/api/export` | `export.ts` | Conversation export, stats, backup/restore |
| `/api/settings` | `settings.ts` | Admin password, global settings |
| `/api/shield` | `shield.ts` | Shield words, rate limiting, warnings |
| `/api/upload` | `upload.ts` | File upload (chat attachments, avatar images) |

Key services in `server/src/services/`:
- `ai-proxy.ts` — AI API proxy (Coze/Dify/OpenAI)
- `default-avatars.ts` — 44 seed SVG avatars (pre-generated)
- `file-logger.ts` — Console output → file logging (auto-initialized on import)
- `shield-filter.ts` — Message content filtering
- `crypto.ts` — AES encryption for API keys

### Database (Prisma + SQLite)

Schema at `server/prisma/schema.prisma`. Key models: Agent, Avatar, Class, Student, Classroom, Message, ShieldWord.

Schema auto-sync: on startup, `server/src/index.ts` checks for missing tables/columns and creates them via raw SQL (handles upgrades from older versions).

### Tauri Desktop (`src-tauri/`)

Rust sidecar (`src-tauri/src/lib.rs`) that:
- Bundles Node.js + Express server as embedded resources
- Copies database from built-in to user data directory on first launch
- Manages server lifecycle (start/stop via tray menu)
- Opens teacher/student URLs in browser
- Schema versioning based on `schema.prisma` content hash

### Distribution Build

```bash
# Full Tauri .dmg build for ARM64
pnpm build:mac:arm64

# Creates source distribution zip (without Tauri)
bash make-dist.sh
```

The Tauri build process:
1. `sync-version.mjs` — syncs version from root package.json to all sub-packages
2. `next build` — builds frontend static export to `out/`
3. `tsc` — compiles server TypeScript to `server/dist/`
4. Copies compiled server + frontend + database to `src-tauri/resources/server/`
5. Runs `prisma db push` on the bundled database
6. `tauri build` — packages as `.dmg`

### Key Patterns

- **Console logging** is captured by `file-logger.ts` (writes to `CLASSNODE_DATA_DIR/logs/` or `server/logs/`)
- **Avatar generation** is programmatic SVG composition (no image files for student avatars)
- **Real-time updates** via Socket.IO (classroom board, avatar rewards, student status)
- **All API routes** inject `prisma` and `io` via `req.app.get('prisma')` / `req.app.get('io')`
- **Trailing slashes** on all routes (`trailingSlash: true` in Next.js config)
