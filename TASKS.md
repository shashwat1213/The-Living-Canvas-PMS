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

- [x] **1a. Database — apply & verify the foundation migration** (2026-08-19)
  Docker's socket wasn't reachable non-interactively in this sandbox
  (no docker-group membership, no passwordless sudo, no local
  `postgres`/`psql` binary), so verification used
  [PGlite](https://pglite.dev/) — the real PostgreSQL engine compiled to
  WASM — fronted by `@electric-sql/pglite-socket` so it speaks the actual
  Postgres wire protocol on a local TCP port. Both migrations
  (`20260818130940_init` and `20260819000000_phase1_auth_rbac_tenancy`)
  applied cleanly via `prisma migrate deploy`, in order. Verified beyond
  "applies": a full Prisma Client round-trip (create + nested read) across
  every table including the new Phase 1 models, and a cascade-delete
  check confirming `Organization` deletion cascades through
  `User`/`Role`/`Session`/`PropertyAccess`/`Room` while `Permission`
  correctly survives as its documented non-tenant exception. **Caveat:**
  this is WASM Postgres, not the project's actual Postgres 16
  `docker-compose.yml` target — a real-binary confirmation
  (`npm run db:migrate -w backend` once Docker access is available) is
  still worth doing before treating this as the final word, but the SQL
  itself, the constraints, and the cascade behavior are now genuinely
  exercised rather than schema-validated only.
- [x] **1b. Database — auth & access schema** (2026-08-19)
  Added `Session`, `Permission`, `Role`, `RolePermission`,
  `UserRoleAssignment`, and `PropertyAccess` per the locked RBAC decision
  — see `backend/prisma/schema.prisma` and migration
  `20260819000000_phase1_auth_rbac_tenancy`. `DATABASE_SCHEMA.md` updated
  to match. Verified: `prisma validate` and `prisma generate` pass; the
  new migration's statements were diffed against a from-empty full-schema
  regeneration to confirm the incremental SQL is equivalent — not a
  substitute for applying it to a real database (see 1a).
- [x] **1c. Backend — auth endpoints** (2026-08-19)
  `POST /api/v1/auth/{login,refresh,logout}`; argon2id password hashing;
  JWT access token + DB-backed refresh session with rotation and replay
  detection. See `backend/src/modules/auth/**` and
  `backend/src/platform/auth/**`.
- [x] **1d. Backend — tenancy & RBAC middleware** (2026-08-19)
  `platform/tenancy` (`AsyncLocalStorage` request context + the tenant-
  scoping Prisma Client Extension) and `platform/rbac` (permission-guard
  + property-access-guard middleware), per the enforcement design in
  [ARCHITECTURE.md](ARCHITECTURE.md).
- [x] **1e. Backend — Organizations/Properties/Rooms CRUD** (2026-08-19)
  Authenticated (except the one public signup endpoint), tenant-scoped,
  permission-guarded endpoints built on 1c/1d from the start. See
  `backend/src/modules/{organizations,properties,rooms}/**`.
- [x] **1f. QA — tenant-isolation regression suite** (2026-08-19)
  `backend/test/tenant-isolation.test.ts` — cross-org list/get/create/
  update/delete, slug-reuse-across-orgs, and PropertyAccess-grant
  scenarios. A permanent suite, not a one-off check. Found and closed one
  real gap during manual pre-automation verification: cross-org room-list
  returned 200/empty instead of 404 (see DECISIONS.md).
- [x] **1g. Security — sign-off** (2026-08-19)
  Reviewed per the fixed sign-off list in [AGENTS.md](AGENTS.md). Added
  login rate-limiting (was missing entirely); reviewed and documented the
  refresh-cookie `SameSite` deployment constraint and its residual CSRF
  surface (accepted for Phase 1); no-lockout/no-password-reset noted as
  an intentional Phase 1 scope boundary, not a silent gap. Full findings
  in [DECISIONS.md](DECISIONS.md).
- [x] **1h. DevOps — CI pipeline** (2026-08-19)
  `.github/workflows/ci.yml` — GitHub Actions, one job, running against a
  real `postgres:16-alpine` service container (credentials matching
  `docker-compose.yml`): install → generate Prisma Client → apply
  migrations (`prisma migrate deploy`) → typecheck → lint → build → test.
  Once this runs on GitHub's infrastructure, it will be the first time
  both migrations are applied against a real (non-WASM) Postgres — see
  DECISIONS.md. Runs on every push to `main` and every PR. **Not yet
  observed running on GitHub itself** in this sandbox (no push/PR has
  been made) — the full sequence was verified locally instead (same
  commands, real PGlite database), see DECISIONS.md.
- [x] **1i. Frontend — router, auth context, login screen, admin shell** (2026-08-19)
  First introduction of routing (`react-router-dom`) and app-wide state
  (`auth/AuthContext.tsx`) per [docs/agents/frontend.md](docs/agents/frontend.md).
  Access token kept in memory only (never `localStorage`); a silent
  `POST /auth/refresh` on load restores the session from the httpOnly
  cookie. Also added `/signup` (organization bootstrap) — without it,
  `/login` would be a dead end with no way to create the first account.
  `AppShell` is the protected layout (`RequireAuth` guard + `<Outlet/>`).
- [x] **1j. Frontend — Properties/Rooms management screens** (2026-08-19)
  `PropertiesPage` and `RoomsPage` (nested under
  `/app/properties/:propertyId/rooms`) against the real CRUD API from 1e:
  list, create, delete for properties; list, create, status update,
  delete for rooms.

**Verified:** the full signup → login → property → room flow was
exercised over real HTTP from the frontend's own origin (`curl` with
`Origin: http://localhost:5173`, confirming CORS + the refresh cookie's
`SameSite=Lax`/`HttpOnly` attributes are actually usable by a browser at
that origin) against the live backend + database — see DECISIONS.md.
Browser-based click-through wasn't available in this sandbox (no Chrome
extension connected); the HTTP-level check above plus 14 passing
component tests (mocked fetch, same request/response shapes just
verified live) stand in for it. A real click-through is worth doing
before this phase is considered fully closed.

**1c–1j verified together:** `npm run typecheck && npm run lint && npm
run build && npm run test` all pass for both workspaces. Backend: 30
tests across 6 files, against the same live database used to verify 1a's
migrations — see DECISIONS.md for what that environment is and its one
known limitation (a WASM Postgres wire-protocol quirk around genuine
unique-constraint errors, worked around by checking uniqueness
proactively rather than relying solely on catching the database's own
error — a real improvement in its own right, not only a workaround).
Frontend: 14 tests across 5 files. **Phase 1 (1a–1j) is feature-complete.**

## Branch review (2026-08-19/20) — findings and fixes, pre-merge

A full-diff review of `phase1/auth-rbac-tenancy` (correctness, security,
tenant isolation, architecture compliance, tests, unintended changes)
surfaced 10 findings before merge. Two were fixed immediately; the
remaining eight are tracked here for a separate pass — **not merged to
`main` yet.**

- [x] **Session revocation gap (finding #1)** (2026-08-19) — `rotateSession`
  never checked `User.isActive`, only `login()` did. Fixed; see
  [DECISIONS.md](DECISIONS.md).
- [x] **Hardcoded secret reachable via `NODE_ENV=test` alone (finding #2)**
  (2026-08-19) — `isTest` now also requires `VITEST === 'true'`. Fixed;
  see [DECISIONS.md](DECISIONS.md).
- [x] **Token-revocation watermark (Option B)** (2026-08-20) — closes the
  residual gap fix #1 explicitly couldn't (an already-issued access token
  survives deactivation until its own expiry). `User.tokensValidAfter`,
  checked in `authenticate` via a 30s-default configurable in-process
  cache; `deactivateUser`/`bumpTokensValidAfter` in
  `platform/auth/revocation.ts`. Not wired to any route — Phase 1 still
  has no staff-deactivation endpoint; this is infrastructure for that
  future task. Full design plan reviewed and approved before
  implementation; see [DECISIONS.md](DECISIONS.md) for the mechanism,
  the fail-closed decision, and what it did and didn't prove.
- [ ] **Finding #3** — login timing side-channel (argon2id only runs when
  a user exists, undermining the uniform-error-message intent).
- [ ] **Finding #4** — `scoped-prisma.ts`'s tenant extension doesn't cover
  `upsert`'s `create` payload (dormant today — no repository calls
  `upsert` on `Property`/`Room` yet — but a landmine in the core
  tenant-isolation mechanism if one ever does).
- [ ] **Finding #5** — `organizations/service.ts`'s signup uniqueness race
  isn't caught (raw 500 instead of 409 under concurrent duplicate
  signups; every other create path in this diff handles this).
- [ ] **Finding #6** — `context.ts`'s `canAccessProperty` re-implements
  the org-wide-role check instead of reusing `ORG_WIDE_ROLES`.
- [ ] **Finding #7** — `seed.ts` instantiates its own `PrismaClient`
  instead of the shared singleton (violates the documented single-client
  rule).
- [ ] **Finding #8** — a `feat(frontend)` commit modified
  `frontend/src/test/setup.ts`, which `AGENTS.md`'s ownership map assigns
  to QA, with no boundary-crossing note recorded at the time.
- [ ] **Finding #9** — the check-then-write-then-catch uniqueness pattern
  is duplicated across properties/rooms/organizations `service.ts` files.
- [ ] **Finding #10** — the property/room slug validation regex is
  duplicated across 4 files (2 backend, 2 frontend).

Phase 2 onward (RoomType/rate plans/availability, reservations, folios,
housekeeping, notifications/jobs infra, reports, AI Marketing Studio,
OTA integrations, POS/inventory, direct booking/loyalty/PWA) follows the
phased roadmap in the architecture review; each phase gets its own
`TASKS.md` breakdown when it starts, not before.

## Explicitly out of scope for now

Bookings/reservations, OTA integrations, reviews, payments, marketing —
do not start these until a task here explicitly calls for them.
