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
│   │   ├── migrations/      Generated SQL migrations
│   │   └── seed.ts          Seeds the global permission catalog
│   ├── src/
│   │   ├── config/          Environment/config loading
│   │   ├── lib/             Shared infra (Prisma client singleton, HTTP errors)
│   │   ├── platform/        Cross-cutting infra — not a business domain
│   │   │   ├── auth/        Password hashing, JWT, refresh sessions, cookies, rate limiting, revocation
│   │   │   ├── tenancy/     Request context + the tenant-scoping Prisma extension
│   │   │   └── rbac/        Permission catalog, role provisioning, route guards
│   │   ├── modules/         One dir per business domain
│   │   │   ├── auth/        Login/refresh/logout routes
│   │   │   ├── organizations/
│   │   │   ├── properties/
│   │   │   └── rooms/       Nested under /properties/:propertyId/rooms
│   │   ├── middleware/      Centralized error handling
│   │   ├── routes/          health.ts (the one route with no module of its own)
│   │   ├── app.ts           Express app factory (used by tests)
│   │   └── index.ts         Process entry point
│   └── test/                Vitest tests
├── frontend/                React/Vite SPA
│   └── src/
│       ├── auth/            AuthContext, useAuth, RequireAuth route guard
│       ├── layout/          AppShell (protected layout: top bar + <Outlet/>)
│       ├── pages/           LoginPage, SignupPage, PropertiesPage, RoomsPage
│       ├── lib/api.ts       The only place that calls fetch() against the backend
│       ├── AppRouter.tsx    Route tree
│       └── App.tsx          "/" — the original connectivity-check landing page
├── .github/workflows/ci.yml Root verification commands against real Postgres
├── docker-compose.yml       Local PostgreSQL for development
├── package.json             Workspace root (scripts fan out to both apps)
└── *.md                     Project docs (this file and siblings)
```

## Backend

- **Express app factory** (`src/app.ts`) is separated from the process
  entry point (`src/index.ts`) so tests can exercise the app with
  supertest without binding a real port.
- **Prisma** is the single data-access layer. `src/lib/prisma.ts` exports
  one shared, *unscoped* `PrismaClient` instance (used by the platform
  code that runs before tenant context exists — auth, signup). Every
  tenant-scoped module (`properties`, `rooms`, `staff`) instead imports
  `scopedPrisma` from `platform/tenancy/scoped-prisma.ts` — see
  "Multi-tenancy model" below.
- **Authentication is implemented** (Phase 1, 2026-08-19): JWT access
  token + a DB-backed, rotating refresh session delivered as an httpOnly
  cookie. See `platform/auth/**` and `modules/auth/**`, and
  [DECISIONS.md](DECISIONS.md) for the reasoning.
- **Token revocation has two layers** (Phase 1, 2026-08-20): revoking a
  user's `Session` rows (e.g. `deactivateUser`) stops them minting *new*
  access tokens; a per-user revocation watermark
  (`User.tokensValidAfter`, checked in `authenticate` via
  `platform/auth/revocation-cache.ts`) additionally rejects an
  *already-issued* access token, bounded by a short in-process cache TTL
  rather than the token's own (longer) expiry. Single-process only —
  same caveat as the login rate limiter, needs a shared store before
  running more than one API process. See DECISIONS.md.
- **Authorization is permission-based**, not a raw role-string check:
  every route declares the permission(s) it needs via
  `platform/rbac/guard.ts`'s `requirePermission`; property-level routes
  additionally sit behind `requirePropertyAccess`. See
  [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the underlying
  `Role`/`Permission`/`PropertyAccess` schema.
- **Staff administration adds a third check on top of permissions**
  (2026-08-20): a permission answers "may this caller do X", but not "may
  they do it *to that person*". `platform/rbac/permissions.ts`'s
  `ROLE_RANK` supplies the missing half — `modules/staff` refuses to
  assign a role above the caller's own or to act on a staff member at or
  above their level, which is what stops a flat `staff:manage` permission
  from becoming an escalation path. See DECISIONS.md.
- Routes live under `/api/v1/...`, one Express router per module.
  `GET /health` (unversioned, no module) remains for connectivity checks.

## Frontend

- Vite + React SPA with `react-router-dom` (introduced Phase 1,
  2026-08-19 — the task that finally needed it). Route tree lives in
  `src/AppRouter.tsx`: `/` (the original connectivity-check landing
  page), `/login`, `/signup`, and a protected `/app/*` tree guarded by
  `auth/RequireAuth.tsx`.
- `auth/AuthContext.tsx` is the one piece of app-wide state. The access
  token lives in memory only (`lib/api.ts`), never `localStorage`; a
  silent `POST /auth/refresh` against the httpOnly cookie on mount
  recovers the session after a page reload.
- `lib/api.ts` is the only place that calls `fetch` against the backend —
  it attaches the `Authorization` header, retries once on a 401 after a
  single-flight refresh, and throws a typed `ApiError`. Components never
  call `fetch` directly.
- **Feature modules** (added 2026-08-21, first used by staff management):
  `src/features/<name>/` holds a feature's types, data access, render-time
  permission rules, and components together. The boundary rule is that a
  feature's endpoints are named in exactly one file (`features/<name>/api.ts`),
  so a contract change has one point of contact. `src/pages/**` remains as
  the older flat convention for the screens that predate this; both
  coexist.
- **Shared UI primitives** live in `src/components/` (`Modal`,
  `ConfirmDialog`, `DataTable`, `Badge`) and are deliberately domain-free
  — no fetching and no feature-specific columns, so the next module can
  use them unchanged.
- `auth/session.ts` decodes display-only claims (user id, permissions,
  roles) from the access token so the UI can avoid rendering controls that
  would only earn a 403. **Presentation only — never an access-control
  decision;** the signature is not verified client-side and the backend
  re-derives everything per request. See DECISIONS.md.
- Talks to the backend only via `VITE_API_URL` (defaults to
  `http://localhost:4000`), never a hardcoded origin.

## Multi-tenancy model

Every domain row is scoped under `Organization` (directly, or transitively
through `Property`). Enforced at the query layer (not just by convention)
via a Prisma Client Extension — `platform/tenancy/scoped-prisma.ts` —
that reads the caller's `organizationId` from request-scoped context
(`AsyncLocalStorage`) and injects it into every query a tenant-scoped
repository issues. A repository function cannot forget the tenant filter
because it never writes it. See the "Approved direction" section below
and `DECISIONS.md`'s Phase 1 backend entry for the mechanism's specifics
and its documented gotchas.

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

## CI

`.github/workflows/ci.yml` (added Phase 1, 2026-08-19) runs on every push
to `main` and every PR: a real `postgres:16-alpine` service container,
then the same `typecheck`/`lint`/`build`/`test` commands documented
above and in `README.md` — no separate CI-only check. Migrations are
applied via `prisma migrate deploy` against that real Postgres before
the test suite runs.

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
