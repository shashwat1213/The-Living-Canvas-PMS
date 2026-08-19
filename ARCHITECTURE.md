# Architecture — The Living Canvas PMS

## Stack

| Layer     | Choice                                   |
|-----------|-------------------------------------------|
| Frontend  | React 19 + TypeScript, Vite               |
| Backend   | Node.js + TypeScript, Express             |
| Database  | PostgreSQL, accessed via Prisma ORM       |
| Testing   | Vitest (both workspaces)                  |
| Linting   | oxlint (frontend), ESLint (backend)       |
| Monorepo  | npm workspaces                            |

See [DECISIONS.md](DECISIONS.md) for the reasoning behind each choice.

## Repository layout

```
The-Living-Canvas-PMS/
├── backend/                 Node/Express API
│   ├── prisma/
│   │   ├── schema.prisma    Source of truth for the DB schema
│   │   └── migrations/      Generated SQL migrations
│   ├── src/
│   │   ├── config/          Environment/config loading
│   │   ├── lib/             Shared infra (Prisma client singleton)
│   │   ├── routes/          Express route handlers
│   │   ├── app.ts           Express app factory (used by tests)
│   │   └── index.ts         Process entry point
│   └── test/                Vitest tests
├── frontend/                React/Vite SPA
│   └── src/
├── docker-compose.yml       Local PostgreSQL for development
├── package.json             Workspace root (scripts fan out to both apps)
└── *.md                     Project docs (this file and siblings)
```

## Backend

- **Express app factory** (`src/app.ts`) is separated from the process
  entry point (`src/index.ts`) so tests can exercise the app with
  supertest without binding a real port.
- **Prisma** is the single data-access layer. `src/lib/prisma.ts` exports
  one shared `PrismaClient` instance (reused across hot reloads in dev to
  avoid exhausting Postgres connections).
- **No authentication yet.** The `User` model has a nullable
  `passwordHash` field reserved for a future auth task; there is currently
  no login, session, or token handling.
- `GET /health` is the only route so far — used to verify the server is up
  and to let the frontend show live API connectivity.

## Frontend

- Plain Vite + React SPA, no router or state library yet — there's
  nothing to route to until the next feature task adds real screens.
- Talks to the backend only via `VITE_API_URL` (defaults to
  `http://localhost:4000`), never a hardcoded origin.

## Multi-tenancy model

Every domain row is scoped under `Organization` (directly, or transitively
through `Property`). There is no cross-organization data access — enforcing
that at the query layer is a concern for the task that adds real API
endpoints beyond `/health`.

## Local development

```bash
npm install                  # installs both workspaces
docker compose up -d         # starts local Postgres
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:migrate           # applies Prisma migrations
npm run dev:backend          # http://localhost:4000
npm run dev:frontend         # http://localhost:5173
```

## Approved direction (locked 2026-08-19, not yet implemented)

Everything above this section describes what exists today. This section
records the production architecture direction approved for Phase 1
onward — see [DECISIONS.md](DECISIONS.md) for the full reasoning behind
each choice. **None of it is implemented yet;** it governs how upcoming
tasks get built, sequenced per [TASKS.md](TASKS.md).

- **Shape:** a modular monolith, not microservices — one API process plus
  one background-worker process, sharing the same codebase and Prisma
  client, deployed separately. `backend/src/modules/<domain>/` (routes,
  service, repository, schemas per module) replaces the flat
  `backend/src/routes/` layout as real domains land; `backend/src/platform/`
  holds cross-cutting infra (auth, tenancy, rbac, jobs, storage, ai).
- **Auth:** JWT access token + a DB-backed refresh session (revocable —
  a stateless-only JWT can't guarantee a fired staff member's access
  dies immediately). Password hashing via argon2id.
- **Authorization:** permission-based RBAC (`Permission` /
  `Role` / `RolePermission`) from the first auth task, not the raw
  `UserRole` enum used as the enforcement mechanism. The existing
  OWNER/ADMIN/MANAGER/STAFF values remain as built-in role presets.
  Property-level access is explicit (`PropertyAccess` join table) — org
  admin roles reach every property in the org; other roles need a grant
  per property.
- **Multi-tenancy enforcement:** a Prisma Client Extension auto-injects
  `organizationId` (and, where applicable, `propertyId`) into every query
  against a tenant-scoped model, sourced from request-scoped context —
  not left to each repository function to remember. QA carries a standing
  cross-tenant regression suite once real endpoints exist.
- **Dates:** reservation stay dates (check-in/check-out) are date-only;
  actual event timestamps (e.g. the real check-in moment) are
  `timestamptz`.
- **Currency & tax:** INR-only for the initial release; no
  multi-currency schema work until a real need appears.
- **Background jobs:** pg-boss (Postgres-backed queue) — no Redis. Job
  categories: AI generation, notifications (email/SMS/WhatsApp),
  channel-sync (future), report generation, scheduled/cron-style tasks.
  Cross-module side effects go through a domain-event outbox, not direct
  module-to-module calls.
- **Object storage:** accessed only through a `platform/storage`
  abstraction; the S3-compatible vendor behind it is a config choice tied
  to the hosting decision below, never imported directly by application
  code.
- **AI provider abstraction:** an `AIMediaProvider` interface
  (`submit` / `checkStatus` / `handleWebhook`) with one adapter per vendor
  (Higgsfield, Veo, Kling, Seedance, …). The Marketing Studio and core PMS
  depend only on the interface. First real adapter targets an
  image-generation provider before video.
- **Payments:** Razorpay, tokenized only — the PMS never stores raw card
  data, only gateway references.
- **Hosting:** the simplest PaaS-class option that runs both the API and
  worker processes from this one repo with a managed Postgres add-on and
  CI-triggered deploys — evaluated, not re-litigated, at Phase 1 DevOps
  kickoff. No container-orchestration platform until traffic/team size
  actually justifies the operational cost.
- **Process:** an eighth agent role, Documentation, is added now (see
  [AGENTS.md](AGENTS.md) and
  [docs/agents/documentation.md](docs/agents/documentation.md)). A
  `packages/shared` types workspace is deliberately deferred until the
  Reservations phase.
