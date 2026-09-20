# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server control — ./dev.sh is the entry point; it owns the ports.
# Bare `./dev.sh` (or `start`) is the default. PIDs/logs under .dev/.
./dev.sh [start]      # background dev environment
./dev.sh fg           # foreground (Ctrl-C to quit)
./dev.sh status | stop | restart
./dev.sh logs [client]
./dev.sh build        # frontend static export -> out/
./dev.sh pkg [目标]    # build + installer; mac(默认) | mac-arm | mac-intel | win | all | source
./dev.sh db <动作>     # push | gen | studio | reset
./dev.sh clean        # stop + remove build artifacts and .dev/{pids,logs}
./dev.sh run <脚本>    # escape hatch: run any pnpm script
./dev.sh help

# `pkg win` / `pkg all` only DISPATCH GitHub Actions and return immediately —
# no local artifact. `pkg` also refuses a dirty tree (CLASSNODE_ALLOW_DIRTY_RELEASE=1
# to override). Legacy names (r, release, db:push, reset-db, ...) still resolve.

# Ports: CLASSNODE_CLIENT_PORT (default 4000) / CLASSNODE_SERVER_PORT (default 4001).
# dev.sh exports PORT=… to each process; there is no hard-coded 4000 anywhere.

# Run each separately — these do NOT get dev.sh's port env, so they use defaults
pnpm dev           # Next.js frontend only → :3000
pnpm dev:server    # Express backend only → PORT from server/.env (:3001)

# Next.js 15 development uses Webpack by default. Turbopack currently panics
# while resolving Next through this pnpm workspace and causes an HMR reload loop.

# Build
pnpm build         # Next.js static export → out/, then check-classroom-browser-compat.mjs
pnpm build:server  # tsc compile server/src → server/dist/
pnpm build:all     # both, then assemble the web runtime dir via scripts/package-web.mjs

# Test (compiles server then runs Node built-in test runner over dist/tests/*.test.js)
pnpm test
# Run a single test file (from server/, after pnpm build:server)
node --test dist/tests/security.test.js

# Lint (ESLint)
pnpm lint

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

**Dev mode:** `pnpm dev:all` (→ `dev.sh foreground`) runs Next.js on 4000 and Express on 4001 concurrently. In production the Express server serves the static frontend from `server/frontend/` (populated from `out/`); `NODE_ENV=development` deliberately skips that static mount so a stale build can't shadow the Next dev server.

**Runtime data root:** `CLASSNODE_DATA_DIR` is the desktop-app data directory. When set, it relocates uploads (`uploads/`), API-key encryption material, export backups (`backups/`), and logs (`logs/`). In dev it is unset and everything falls back under `server/`. Any new persisted file should respect it.

### Frontend (`src/app/`)

Static export via `next.config.ts` (`output: 'export'`, `trailingSlash: true`, `images.unoptimized`) — no server-side rendering, so every page that talks to the API is a client component. Teacher pages live under `src/app/teacher/`; the student-facing pages are `/`, `/classroom/`, and `/help/agents/`:

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
| `/help/agents/` | `help/agents/page.tsx` | Screenshot walkthrough for each AI platform, opened from the agents page with a `?platform=` query param |
| `/classroom/` | `classroom/page.tsx` | **Student-facing portal** — join with code, chat, avatar changer |
| `/` | `page.tsx` | Student entry (4-digit code); redirects to `/classroom/` |

**Shared libs** (`src/lib/`):
- `api.ts` — All API calls with typed responses; auto-injects `Authorization: Bearer` for student tokens; dispatches `classnode-teacher-session-expired` custom event on 401
- `api-base.ts` — API base URL resolution (dev vs production)
- `socket.ts` — Socket.IO client, global singleton with typed events
- `socket-events.ts` — `ServerToClientEvents` / `ClientToServerEvents` TypeScript interfaces
- `types.ts` — Shared types: `InitStatus`, `AgentSummary`, `ClassroomSummary`, `StudentSessionResponse`
- `components.tsx` — Shared UI: `Toast`, `Pagination`, `FieldError`
- `markdown.tsx` — Markdown renderer (remark/rehype with KaTeX math)
- `remark-gfm-compat.ts` — GFM plugin wiring for the markdown renderer
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
| `/api/changelogs` | `changelogs.ts` | Teacher | Lists changelog markdown files sorted by version |
| `/api/system` | `system.ts` | Teacher | System info |
| `/api/upgrade` | `upgrade.ts` | Teacher | App upgrade check (proxy-aware fetch, Gitee primary + GitHub fallback) |
| `/api/health` | inline in `index.ts` | **Public** | Liveness probe used by the student entry page |
| `/api/server-info` | inline in `index.ts` | Teacher | LAN IPs, chosen bind IP, and the QR-code student URL |

**Auth layer in `index.ts`:** Routes are wrapped with middleware at registration time — individual routers do **not** add their own teacher auth:
- Most admin routes use `requireTeacher` directly
- `/api/classroom` — only three shapes bypass teacher auth: `POST /code/:code/student-session`, `GET /code/:code`, `GET /:id/students`. A valid student token additionally unlocks `GET /:id/student/:studentId/messages` and `GET /:id/notifications` for that student only
- `/api/upload` — any valid student token passes
- `/api/avatars` — public for `GET` except `/student-tokens/…`; a student token unlocks their own `PUT /student-self/:id` and `GET /student-tokens/:id`
- `/api/settings` — no route-level teacher gate; each handler opts in (only `change-password` does; password/session/reset endpoints authenticate internally because they are the bootstrap path)

**LAN gate:** before any route, a middleware 403s non-loopback requests when the `lan-access` Setting is `'false'` — Socket.IO has the matching check in `io.use()`. Both read the flag from `app.get('lanAccessEnabled')`, which is loaded once at startup, so toggling the setting requires a server restart.

#### Services (`server/src/services/`)

| Service | File | Purpose |
|---------|------|---------|
| **AI Proxy** | `ai-proxy.ts` | Multi-platform AI API: Coze (low-code + bot), Wenxin, Zhipuai. Streaming + non-streaming. `fetchWithTimeout()` bounds **time-to-response-headers only** (30s) — a long stream is not cut off by it. |
| **Coze Bot** | `coze-bot/` | Coze agent protocol implementation (streaming, tool calls) |
| **Wenxin** | `wenxin/` | Baidu Wenxin agent protocol |
| **Zhipuai** | `zhipuai/` | Zhipu AI agent protocol |
| **Crypto** | `crypto.ts` | AES encrypt/decrypt for API keys stored in DB |
| **Password Security** | `password-security.ts` | Scrypt hashing via Node's built-in `crypto.scryptSync` (no native dep), `timingSafeEqual` verify, legacy SHA256 fallback |
| **Upload Security** | `upload-security.ts` | File magic number detection, SVG sanitization, ZIP safe extraction |
| **Agent Checker** | `agent-checker.ts` | Periodic connectivity check for all agents, emits via Socket.IO |
| **Agent Secret Policy** | `agent-secret-policy.ts` | `shouldPreserveAgentSecret()` — keep the stored encrypted key when the editor submits a blank/unchanged secret; `maskAgentSecret()` for API responses |
| **Classroom State** | `classroom-state.ts` | `canTransition(status, action)` — the single source of truth for which pause/resume/end/restore transitions are legal (`active`/`paused`/`ended`) |
| **Participant Migration** | `participant-migration.ts` | One-time migration of legacy virtual-group Students → real group participants (`ClassroomGroupMember`) |
| **Shield Filter** | `shield-filter.ts` | AC automaton-based content filtering |
| **Default Shield Words** | `default-shield-words.ts` | Built-in bad word list (seeded on first launch) |
| **Default Avatars** | `default-avatars.ts` | 44 seed SVG avatars |
| **Student Avatar Generator** | `student-avatar-generator.ts` | Programmatic SVG avatar generation for students |
| **Student Sort** | `student-sort.ts` | Student ordering utilities |
| **Anonymizer** | `anonymizer.ts` | Real name ⇄ `User_NNN` pseudonym map applied on the way into and out of every AI request (see Key Patterns) |
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
- `Classroom` / `ClassroomClass` / `ClassroomStudent` / `ClassroomAgent` / `ClassroomGroup` / `ClassroomGroupMember` — active classroom state
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
- macOS: `scripts/build-mac.sh --target <triple> [--without-node]` — steps 2–6 are delegated to `scripts/package-server.mjs`
- Windows: `pnpm build:windows[:arm64]` runs the same packaging locally, then `tauri build --bundles msi`
- `scripts/package-server.mjs` — packages server + frontend into the Tauri resource dir (shared by all platforms)
- `scripts/build-windows.sh` — does **not** build; it dispatches `.github/workflows/build.yml` on GitHub Actions (`v*` tags build both Windows arches automatically) and returns immediately unless `--wait` is passed

**Release entry point:** users go through `./dev.sh pkg`, which normalizes its target vocabulary and execs `./release.sh <all|mac|mac-arm64|mac-intel|windows|source>`. `release.sh` stays internal — it is not part of the `dev.sh` help surface. It refuses to run on a dirty working tree unless `CLASSNODE_ALLOW_DIRTY_RELEASE=1`, and archives installers to `CLASSNODE_INSTALLER_DIR` (default `~/Downloads/ClassNode/installer`).

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
- **API auth** is layered in `index.ts` route registration — routers don't add their own teacher gate. `settings.ts` is the deliberate exception (it gates itself, because its password/session endpoints *are* the login path).
- **AI proxy** timeouts cover time-to-first-byte (30s, timer cleared once the response resolves); cancelling a stream is the student's `stop-generation` → `activeStreams` AbortController, not a timeout.
- **Shield filter** uses AC automaton for O(n) matching, rebuilt from DB every 3s.
- **Admin password** is stored as scrypt hash; old SHA256 hashes are migrated on first login attempt.
- **API keys** are AES-encrypted at rest via `services/crypto.ts`; decrypted on-the-fly for AI proxying.
- **Changelogs** are individual markdown files in `server/changelogs/v*.md`, served at `/api/changelogs` (sorted by semver, newest first).
- **Tests** live in `server/src/tests/`; run via Node.js built-in test runner (`node --test`).
- **`anonymizer`** is a minors-privacy boundary, not a display filter. Before any prompt leaves the machine, `ai-proxy.ts` rewrites the student's real name to a stable pseudonym (`User_001`, …) and re-substitutes the real name into the model's reply before persisting it — so no AI provider ever receives a student's name. The `Anonymizer` singleton holds a bidirectional map that resets when full (500 entries) or on a new classroom.

## Compatibility constraints

The student portal runs on whatever the school already owns — including old iPads, whose Safari is stuck on 15. Two consequences that will otherwise bite you:

- **No regex lookbehind** (`(?<=` / `(?<!`) anywhere reachable from `/classroom/`. `scripts/check-classroom-browser-compat.mjs` runs as part of `pnpm build` and **fails the build** if the student bundle contains one, so prefer `String.prototype.matchAll` or capture groups over lookbehind.
- **HTML must not be cached.** The server sends `no-store` for `.html`, immutable caching only for `_next/static/`. Preserve this when touching static-file serving — Safari will otherwise keep loading a previous release's now-deleted JS chunks after an upgrade.

Pay attention to input/layout work on `/classroom/` too: text-entry flows and viewport handling are tuned for these devices.
