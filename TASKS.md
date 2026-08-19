# Tasks — The Living Canvas PMS

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified

## Foundation

- [x] **Project scaffolding + core schema** (2026-08-18)
  - npm-workspaces monorepo: `backend/` (Express + TS + Prisma) and
    `frontend/` (React + TS + Vite)
  - Tooling: TypeScript strict mode, ESLint (backend) / oxlint (frontend),
    Vitest (both), `docker-compose.yml` for local Postgres
  - Prisma schema: `Organization`, `User` (staff, no auth yet),
    `Property`, `Room` — see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
  - `GET /health` backend endpoint + minimal frontend shell that checks
    API connectivity
  - Verified: backend typecheck/lint/build/test pass, built server boots
    and serves `/health`; frontend typecheck/lint/build/test pass; Prisma
    schema validates, client generates, initial migration SQL generated
  - **Not yet verified:** migration has not been applied to a real
    Postgres instance — no DB was available in the authoring sandbox (see
    [DECISIONS.md](DECISIONS.md)). Run `npm run db:migrate -w backend`
    against a real database and confirm before building on top of this.

## Process / tooling

Not feature work — governs how implementation tasks get carried out.

- [x] **Multi-agent development system (docs only)** (2026-08-18)
  - Defined seven agent roles (Orchestrator, Frontend, Backend, Database,
    QA, Security, DevOps) with explicit file-scope ownership, in
    [AGENTS.md](AGENTS.md) and [docs/agents/](docs/agents/)
  - Defined communication (written handoff reports/findings), delegation,
    bug flow, git-worktree-per-task isolation, testing/verification rules,
    and a human-approval gate before any merge to `main`
  - No application code, tech stack, or existing architecture was changed
    by this task — documentation only, per [DECISIONS.md](DECISIONS.md)
  - Verified: cross-checked every path referenced in the new docs against
    the actual repo layout; no code changes to build/lint/test

## Architecture & product planning (2026-08-19)

- [x] **Architecture and product-planning review** (2026-08-19)
  - Full repository read against the complete product scope (core PMS
    through AI Marketing Studio); produced a proposed production
    architecture, domain model, agent-role extension, and phased roadmap
  - No code changed — planning output only
- [x] **Lock Phase 1 architecture decisions** (2026-08-19)
  - Session model (JWT + DB-backed refresh), permission-based RBAC,
    date-only stay dates / `timestamptz` event timestamps, INR-only
    initial scope, storage/job-queue/AI-provider/payment-gateway/hosting
    choices, Documentation Agent added, shared-types workspace deferred —
    see [DECISIONS.md](DECISIONS.md) for the full list and reasoning, and
    [ARCHITECTURE.md](ARCHITECTURE.md)'s "Approved direction" section for
    how they fit together
  - Documentation-only: `AGENTS.md`, `docs/agents/documentation.md`
    (new), `ARCHITECTURE.md`, `PROJECT_CONTEXT.md`, `DECISIONS.md`,
    `TASKS.md` (this entry) updated; no application code, schema, or
    config touched
  - **Phase 1 implementation below is planned but not started — waiting
    on explicit human approval before any agent is dispatched.**

## Phase 1 — Auth, RBAC, tenancy enforcement (planned, not started)

Sequenced Database → Backend → Frontend, per [AGENTS.md](AGENTS.md)'s
delegation model. Nothing in this phase begins until approved.

- [~] **1a. Database — apply & verify the foundation migration**
  **Blocked, not closed:** no live Postgres was reachable in this
  sandbox — Docker's socket requires group access this session doesn't
  have non-interactively, and no local `postgres`/`psql` binary exists
  either. Same gap as the original foundation migration, now compounded
  by a second unverified migration (1b). Both `prisma validate` and
  `prisma generate` pass. **Standing follow-up:** the next person with
  real Postgres access must run `npm run db:migrate -w backend` and
  confirm both migrations apply cleanly, in order, before this schema is
  considered verified end-to-end.
- [x] **1b. Database — auth & access schema** (2026-08-19)
  Added `Session`, `Permission`, `Role`, `RolePermission`,
  `UserRoleAssignment`, and `PropertyAccess` per the locked RBAC decision
  — see `backend/prisma/schema.prisma` and migration
  `20260819000000_phase1_auth_rbac_tenancy`. `DATABASE_SCHEMA.md` updated
  to match. Verified: `prisma validate` and `prisma generate` pass; the
  new migration's statements were diffed against a from-empty full-schema
  regeneration to confirm the incremental SQL is equivalent — not a
  substitute for applying it to a real database (see 1a).
- [ ] **1c. Backend — auth endpoints**
  Login, refresh, logout; argon2id password hashing; JWT issuance against
  the new `Session` model.
- [ ] **1d. Backend — tenancy & RBAC middleware**
  `platform/tenancy` (request-scoped org/property context + the Prisma
  tenant-scoping extension) and `platform/rbac` (permission-guard
  middleware), per the enforcement design in
  [ARCHITECTURE.md](ARCHITECTURE.md).
- [ ] **1e. Backend — Organizations/Properties/Rooms CRUD**
  Authenticated, tenant-scoped, permission-guarded endpoints, built on
  1c/1d from the start rather than retrofitted after.
- [ ] **1f. QA — tenant-isolation regression suite**
  Stood up alongside 1e's endpoints: cross-org access attempts must
  403/404 on every tenant-scoped route. A permanent gate, not a one-off
  check.
- [ ] **1g. Security — sign-off**
  Mandatory review of 1c/1d/1b before merge, per the fixed sign-off list
  in [AGENTS.md](AGENTS.md)'s approval process (session/permission
  schema, tenant-scoping enforcement).
- [ ] **1h. DevOps — CI pipeline**
  GitHub Actions (or equivalent) running the root verification commands
  (`typecheck && lint && build && test`) on every PR, plus a migration
  dry-run. Do this alongside Phase 1 rather than after — manual
  verification stops scaling once more than one or two tasks are in
  flight concurrently.
- [ ] **1i. Frontend — router, auth context, login screen, admin shell**
  First introduction of routing/state for auth per
  [docs/agents/frontend.md](docs/agents/frontend.md).
- [ ] **1j. Frontend — Properties/Rooms management screens**
  Against the now-real, authenticated CRUD API from 1e.

Phase 2 onward (RoomType/rate plans/availability, reservations, folios,
housekeeping, notifications/jobs infra, reports, AI Marketing Studio,
OTA integrations, POS/inventory, direct booking/loyalty/PWA) follows the
phased roadmap in the architecture review; each phase gets its own
`TASKS.md` breakdown when it starts, not before.

## Explicitly out of scope for now

Bookings/reservations, OTA integrations, reviews, payments, marketing —
do not start these until a task here explicitly calls for them.
