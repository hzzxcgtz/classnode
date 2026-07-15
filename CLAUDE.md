# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Background dev server control
./dev.sh start       # PID files + logs under .dev/
./dev.sh status
./dev.sh logs
./dev.sh stop

# Foreground frontend + backend
pnpm dev:all

# Development uses `next dev --webpack`. Turbopack currently panics while
# resolving Next through this pnpm workspace and causes an HMR reload loop.

# Run each separately
pnpm dev           # Next.js frontend only (port 3000 → auto-redirect to 4000)
pnpm dev:server    # Express backend only (port 3001, or 4001 in dev:all)

# Build
pnpm build         # Next.js static export → out/
pnpm build:server  # tsc compile server/src → server/dist/
pnpm build:all     # both, then replace server/frontend from out/

# Test (compiles server then runs Node built-in test runner)
pnpm test

# Database (run in project root — pnpm --filter classnode-server handles it)
pnpm --filter classnode-server db:generate   # Generate Prisma client after schema change
pnpm --filter classnode-server db:push       # Push schema to SQLite (creates dev.db)
pnpm --filter classnode-server db:studio     # Open Prisma Studio

# Sync version from root package.json to all sub-packages
pnpm sync-version

# Prepare version/changelog/release date without committing
pnpm prepare-release patch

# Tauri distribution builds
pnpm build:mac:arm64     # Full .dmg for Apple Silicon (also: build:mac:intel)
pnpm build:windows       # Full .msi for Windows x64 (also: build:windows:arm64)

# Unified release orchestration
./release.sh --help

# Kill dev servers
pnpm stop
```

## Architecture

### Monorepo (pnpm workspace)

```
classnode/
├── src/                 # Next.js frontend (React, static export)
├── server/              # Express.js backend (TypeScript, ESM)
├── src-tauri/           # Tauri v2 desktop wrapper (Rust sidecar)
├── myportal/            # Landing page (HTML/CSS/JS, served by Express static)
└── scripts/             # Build helpers (sync-version, package-server, build-mac.sh, etc.)
```

**Dev mode:** `pnpm dev:all` runs Next.js on port 4000 and Express on port 4001 concurrently. Express serves the static frontend from `out/` at `http://localhost:4001` in production, but in dev mode the Next.js dev server handles HMR. The `.env` files configure the ports.

**Important:** Express server has a 30s startup delay before listening (random argon2 scrypt hash for password security). Be patient after restart.

### Frontend (`src/app/`)

Static export via `next.config.ts` (`output: 'export'`, `trailingSlash: true`). All pages under `src/app/teacher/` and one student portal page:

| Route | File | Purpose |
|-------|------|---------|
| `/teacher/` | `teacher/page.tsx` | Login / home |
| `/teacher/dashboard/` | `teacher/dashboard/page.tsx` | Statistics dashboard |
| `/teacher/classes/` | `teacher/classes/page.tsx` | Class & student CRUD, grouping, avatars, batch ops |
| `/teacher/classroom/` | `teacher/classroom/page.tsx` | Active classroom board (real-time) |
| `/teacher/classroom/new/` | `teacher/classroom/new/page.tsx` | Create classroom |
| `/teacher/agents/` | `teacher/agents/` | AI agent config — page.tsx + 12 split components/hooks |
| `/teacher/avatars/` | `teacher/avatars/page.tsx` | Avatar icon library management |
| `/teacher/history/` | `teacher/history/page.tsx` | Past classroom records |
| `/teacher/shield/` | `teacher/shield/page.tsx` | Shield words + rate limiting |
| `/teacher/about/` | `teacher/about/page.tsx` | About page |
| `/teacher/guide/` | `teacher/guide/page.tsx` | User guide |
| `/classroom/` | `classroom/page.tsx` | **Student-facing portal** — join with code, chat, avatar changer |

**Shared libs** (`src/lib/`):
- `api.ts` — All API calls with typed responses; auto-injects `Authorization: Bearer` for student tokens; dispatches `classnode-teacher-session-expired` custom event on 401
- `api-base.ts` — API base URL resolution (dev vs production)
- `socket.ts` — Socket.IO client, global singleton with typed events
- `socket-events.ts` — `ServerToClientEvents` / `ClientToServerEvents` TypeScript interfaces
- `types.ts` — Shared types: `InitStatus`, `AgentSummary`, `ClassroomSummary`, `StudentSessionResponse`
- `components.tsx` — Shared UI: `Toast`, `Pagination`, `FieldError`
- `markdown.tsx` — Markdown renderer (remark/rehype with KaTeX math)
- `export-doc.ts` — DOCX report export (classroom conversations + stats)
- `version.ts` — Reads version from `package.json` via `APP_VERSION` constant
- `upgrade-check.ts` — Version update checker (Gitee primary + GitHub fallback)
- `constants.ts` — App-wide constants

### Backend (`server/src/`)

Express on port 3001 (or 4001 in dev). CJS-free ESM (`"type": "module"` in package.json). The entry point (`index.ts`) initializes Prisma, Socket.IO, sets up middleware, registers routes, then listens.

#### Middleware (`server/src/middleware/`)
- **`auth.ts`** — Teacher session management (cookie-based, HttpOnly, SameSite=Strict). `createTeacherSession()` / `destroyTeacherSession()` / `requireTeacher()` / `isLoopbackRequest()`. Sessions stored in-memory Map, 24h TTL.
- **`student-auth.ts`** — Student temporary token (JWT-like, 2h expiry). `createStudentToken(classroomId, studentId)` / `verifyStudentToken(token)` / `getStudentSession(req)`.

#### Routes (`server/src/routes/`)

All routes inject Prisma via `req.app.get('prisma')` and Socket.IO via `req.app.get('io')`:

| Route | File | Auth | Purpose |
|-------|------|------|---------|
| `/api/agents` | `agents.ts` | Teacher | Agent CRUD, logo upload, connectivity test, greeting fetch |
| `/api/classes` | `classes.ts` | Teacher | Class/Student CRUD, group management |
| `/api/classroom` | `classroom.ts` | **Mixed** | Classroom lifecycle, student session, messages; whitelisted student GET endpoints bypass teacher auth |
| `/api/avatars` | `avatars.ts` | **Mixed** | Avatar CRUD, SVG assign, student self-service with token |
| `/api/export` | `export.ts` | Teacher | Conversation export (Word), stats, backup/restore with safety snapshots |
| `/api/settings` | `settings.ts` | **None** | Admin password, session, init-status, change password — auth handled internally |
| `/api/shield` | `shield.ts` | Teacher | Shield words CRUD, CSV import, config, auto-blacklist |
| `/api/upload` | `upload.ts` | Teacher/Student | File upload (chat attachments, avatar images) |
| `/api/changelogs` | `changelogs.ts` | **Public** | Lists changelog markdown files sorted by version |
| `/api/system` | `system.ts` | Teacher | System info |
| `/api/upgrade` | `upgrade.ts` | **None** | App upgrade check |

**Auth layer in `index.ts`:** Routes are wrapped with middleware at registration time:
- Most admin routes use `requireTeacher` directly
- `classroom` and `upload` allow public student access for specific paths (match via regex)
- `avatars` allows student self-service for token-authenticated requests
- `/api/settings` and `/api/changelogs` have internal auth or are public

#### Services (`server/src/services/`)

| Service | File | Purpose |
|---------|------|---------|
| **AI Proxy** | `ai-proxy.ts` | Multi-platform AI API: Coze (low-code + bot), Wenxin, Zhipuai. Streaming + non-streaming. 30s timeout, abort controller support. |
| **Coze Bot** | `coze-bot/` | Coze agent protocol implementation (streaming, tool calls) |
| **Wenxin** | `wenxin/` | Baidu Wenxin agent protocol |
| **Zhipuai** | `zhipuai/` | Zhipu AI agent protocol |
| **Crypto** | `crypto.ts` | AES encrypt/decrypt for API keys stored in DB |
| **Password Security** | `password-security.ts` | Scrypt hashing (via argon2), verify, migrate from old SHA256 |
| **Upload Security** | `upload-security.ts` | File magic number detection, SVG sanitization, ZIP safe extraction |
| **Agent Checker** | `agent-checker.ts` | Periodic connectivity check for all agents, emits via Socket.IO |
| **Agent Secret Policy** | `agent-secret-policy.ts` | Controls when to preserve encrypted secrets on agent update |
| **Classroom State** | `classroom-state.ts` | Allowed source status constants |
| **Shield Filter** | `shield-filter.ts` | AC automaton-based content filtering |
| **Default Shield Words** | `default-shield-words.ts` | Built-in bad word list (seeded on first launch) |
| **Default Avatars** | `default-avatars.ts` | 44 seed SVG avatars |
| **Anonymizer** | `anonymizer.ts` | Student name de-identification for teacher board display |
| **Export Service** | `export-service.ts` | Word document generation (conversations + stats) |
| **File Logger** | `file-logger.ts` | Captures console.log → file in `CLASSNODE_DATA_DIR/logs/` or `server/logs/` |
| **Ping** | `ping.ts` | Anonymous usage statistics ping (opt-in via setting) |

**Important:** `file-logger.ts` must be imported first in `index.ts` — it monkey-patches `console.log/warn/error` to tee output to a log file. Any module failure before this import won't be logged.

#### Socket.IO (`server/src/socket/index.ts`)

Real-time classroom interactions. Key event flows:

- **Student joins:** `join-classroom` → verify student token → track active connection → emit `joined` with agents/groups
- **Student sends message:** `send-message` → shield filter check → rate limit check → AI proxy stream → `ai-chunk`/`student-chunk` real-time push → save to DB → emit `ai-response`/`student-message`
- **Student stops AI:** `stop-generation` → abort AbortController for active stream
- **Teacher view:** `join-teacher-board` → verify teacher session → receive `student-message`, `student-online/offline`, `shield-warning`, `student-blacklisted` events
- **Teacher sends notification:** `teacher-send-notification` → save to DB → cache in memory → emit to specific student/group/all → replay on reconnect
- **Status polling:** `listen-classroom-status` → get online student list for identity selection page

The socket module also manages:
- `activeConnections` Map (exposed to HTTP routes via `app.set`)
- `platformConversations` Map — stores Zhipu/Wenxin conversation IDs for context continuity
- `activeStreams` Map — AbortController per socket for stop-generation
- `teacherNotificationCache` — last 5 notifications per classroom, 10min TTL, replayed on reconnect
- Student rate limiting per 60s window (cached from DB every 10s)

### Database (Prisma + SQLite)

Schema at `server/prisma/schema.prisma`. Key models:
- `Setting` — key-value global config (admin password, bind IP)
- `Agent` — AI agent config (AES-encrypted API keys)
- `Avatar` — SVG icon library (seed + student-generated)
- `Class` / `Student` / `ClassGroup` — class hierarchy with grouping
- `Classroom` / `ClassroomStudent` / `ClassroomAgent` / `ClassroomGroup` — active classroom state
- `Message` — conversation messages (user + assistant rounds)
- `Interaction` — per-student interaction summary statistics
- `ShieldWord` / `ShieldConfig` / `ShieldWarning` — content filtering
- `TeacherNotification` — teacher-to-student notifications (persisted for export)

**Schema auto-sync:** On startup, `index.ts` checks for missing tables/columns via raw SQL (`PRAGMA table_info`) and creates/alters them — this handles upgrades from older versions without Prisma migrations.

**Engine:** `binary` Prisma engine (`engineType = "binary"`) with native targets.

### Tauri Desktop (`src-tauri/`)

Rust sidecar that bundles Node.js + Express server as embedded resources:
- On first launch, copies the bundled database from resources to user data directory
- Manages server lifecycle (start/stop via system tray menu)
- Opens teacher URL in default browser on startup
- **Upgrade safety:** backs up database to `backups/` before `prisma db push`, rejects upgrade if push fails
- Schema versioning based on `schema.prisma` content hash (stored in `CLASSNODE_DATA_DIR/.schema-version`)
- Requires bundled Node.js binary for production builds

**Build flow (macOS):** `scripts/build-mac.sh`
1. `sync-version.mjs` — idempotently syncs version only; normal builds never change release dates
2. `next build` → `out/`
3. `tsc` → `server/dist/`
4. Copy server + frontend to `src-tauri/resources/server/`
5. Install production dependencies for the target architecture and generate matching Prisma engines
6. `prisma db push` — initialize bundled database
7. Download Node.js binary for target arch (optional)
8. `tauri build` → `.dmg` / `.msi`

**Cross-platform build scripts:**
- macOS: `scripts/build-mac.sh` (supports `--target` and `--without-node`)
- Windows: `pnpm build:windows` uses `scripts/package-server.mjs` (works without Tauri CLI)
- `scripts/package-server.mjs` — packages server + frontend to Tauri resource dir (shared by all platforms)

### Portal / Landing Pages

`myportal/` is the static landing site. Its displayed version is synchronized by
`sync-version.mjs`.

### Versioning

Single source of truth: **root `package.json` → `version`**. The `scripts/sync-version.mjs` script (runs as `prebuild` hook) propagates it to:
- `server/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- `src-tauri/resources/server/package.json` (bundled copy)
- `myportal/classnode.html`, `myportal/index.html`
- `updater/latest.json` version only
- `README.md`, `README.en.md`

Release dates and changelogs are updated only by `prepare-release.mjs`. The
script deliberately does not run `git add`, commit, push, or create a tag.

Frontend reads it via `src/lib/version.ts` → `import pkg from '../../package.json'; export const APP_VERSION = pkg.version;`

## Key Patterns

- **Console logging** is captured by `file-logger.ts` (must be imported first in `index.ts`). Writes to `CLASSNODE_DATA_DIR/logs/` or `server/logs/`.
- **Avatar generation** is programmatic SVG composition — no image files for student avatars.
- **Real-time updates** via Socket.IO (classroom board, avatar rewards, student status, notifications).
- **All API routes** inject `prisma` and `io` via `req.app.get('prisma')` / `req.app.get('io')` instead of importing directly.
- **Active connections** Map is exposed via `app.set('activeConnections', ...)` so HTTP routes can query online students.
- **API auth** is layered in `index.ts` route registration — routes don't add their own auth middleware.
- **AI proxy** has a 30s fetch timeout; uses AbortController for student-initiated cancellation.
- **Shield filter** uses AC automaton for O(n) matching, rebuilt from DB every 3s.
- **Admin password** is stored as scrypt hash; old SHA256 hashes are migrated on first login attempt.
- **API keys** are AES-encrypted at rest via `services/crypto.ts`; decrypted on-the-fly for AI proxying.
- **Changelogs** are individual markdown files in `server/changelogs/v*.md`, served at `/api/changelogs` (sorted by semver, newest first).
- **Tests** live in `server/src/tests/`; run via Node.js built-in test runner (`node --test`).
- **`anonymizer`** ("匿名者") provides `anonymize(name)` that shows only first/last char of Chinese names for teacher board display.
