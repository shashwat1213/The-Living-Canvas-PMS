# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Living Canvas PMS is a multi-property **hospitality** Property
Management System (hotels/venues, rooms, staff — not landlord-tenant
leasing). It's a monorepo: `backend/` (Node + Express + TypeScript +
Prisma/PostgreSQL) and `frontend/` (React 19 + TypeScript + Vite), wired
together with npm workspaces.

The project is still at its foundation stage: `Organization` → `User`
(staff) → `Property` → `Room` schema exists, `GET /health` is the only
backend route, and the frontend is a shell that checks API connectivity.
No authentication yet. Do not build ahead of what
[TASKS.md](TASKS.md) currently calls for — bookings, OTA integrations,
reviews, payments, and marketing are explicitly out of scope until a task
calls for them.

## Commands

From the repo root (workspace scripts fan out to both `backend` and
`frontend` via `npm run <script> -w <workspace>`):

```bash
npm install                  # installs both workspaces
docker compose up -d         # starts local Postgres
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:migrate           # applies Prisma migrations (backend only)

npm run dev:backend          # http://localhost:4000
npm run dev:frontend         # http://localhost:5173

npm run typecheck            # backend tsc + frontend tsc -b
npm run lint                 # backend eslint + frontend oxlint
npm run build                # backend tsc + frontend tsc -b && vite build
npm run test                 # backend vitest run + frontend vitest run
```

A task is not done until `npm run typecheck && npm run lint && npm run
build && npm run test` all pass — see the Testing section of
[AGENTS.md](AGENTS.md).

**Single test / one workspace at a time**, run inside the workspace dir
(both use Vitest):

```bash
cd backend && npx vitest run test/health.test.ts
cd frontend && npx vitest run src/App.test.tsx
```

**Prisma** (backend only, run from `backend/` or via `-w backend`):

```bash
npm run db:generate -w backend        # regenerate Prisma client
npm run db:migrate -w backend         # prisma migrate dev (dev DB)
npm run db:migrate:deploy -w backend  # prisma migrate deploy (no prompts)
npm run db:studio -w backend          # Prisma Studio
```

Migrations must be applied and verified against a real Postgres instance,
not just validated against the schema file — see
[docs/agents/database.md](docs/agents/database.md).

## Architecture

- **Backend**: Express app factory (`backend/src/app.ts`) is separated
  from the process entry point (`backend/src/index.ts`) specifically so
  tests can exercise the app with supertest without binding a real port.
  `backend/src/lib/prisma.ts` exports one shared `PrismaClient` instance
  (reused across dev hot-reloads to avoid exhausting Postgres
  connections) — this is the only data-access layer; don't instantiate
  `PrismaClient` elsewhere.
- **Frontend**: plain Vite + React SPA, no router or state library yet.
  Talks to the backend only through `VITE_API_URL` (defaults to
  `http://localhost:4000`) — never hardcode the backend origin.
- **Multi-tenancy**: every domain row is scoped under `Organization`,
  either directly or transitively through `Property`. There is no
  cross-organization data access; this must be enforced at the query
  layer as real endpoints get added beyond `/health`.
- **Schema source of truth**: `backend/prisma/schema.prisma`.
  [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) is a human-readable mirror of
  it — if they disagree, the schema wins and the doc must be updated to
  match.

## Multi-agent development process

This repo is built through a **controlled multi-agent system** defined in
[AGENTS.md](AGENTS.md) — read it before making changes that go beyond a
small, obviously-scoped fix. The short version:

- Seven roles, each with an explicit file-scope ownership boundary:
  Orchestrator, Frontend, Backend, Database, QA, Security, DevOps (roles
  detailed in `docs/agents/*.md`). The **ownership map** in AGENTS.md
  tells you which paths belong to which role — e.g. `backend/prisma/**`
  is Database-owned even though a Backend task might feel adjacent to it;
  `backend/src/**` (excluding `prisma/` and tests) is Backend-owned;
  `frontend/src/**` (excluding tests) is Frontend-owned; test files
  belong to QA except when an agent adds a narrow test alongside its own
  change.
- Work that spans owners (e.g. "add a room-status field") is split into
  sequential sub-tasks in dependency order — schema → API → UI — rather
  than touched all at once.
- Non-obvious technical choices get one entry appended to
  [DECISIONS.md](DECISIONS.md) by whoever made the decision.
- Each delegated task normally runs on its own git worktree/branch
  (`agent/<role>/<short-task-slug>`, branched from `main`). No agent
  commits or pushes to `main` directly — merges happen only after
  verification commands pass and a human approves.
- If you're operating as (or dispatching) one of these specialist roles,
  stay inside your file-scope boundary; if a task needs a change outside
  it, stop and report the need rather than reaching across it.

## Planning vs. implementation

Architecture, requirements, and task breakdown are owned by planning
conversations outside this repo; this repository is where that plan gets
implemented, and its files/git history are the source of truth for what
has actually been built. Current task status lives in
[TASKS.md](TASKS.md) — check it before starting new feature work.
