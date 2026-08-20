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
- [x] **Finding #3** (2026-08-20) — login timing side-channel fixed: a
  precomputed dummy hash means `verifyPassword` always runs, existence or
  not. Test proves `argon2.verify` is always called.
- [x] **Finding #4** (2026-08-20) — `scoped-prisma.ts` now also scopes
  `upsert`'s `create` payload, not just plain `create`.
- [x] **Finding #5** (2026-08-20) — signup transaction now wrapped via
  `withUniqueConstraintGuard`; P2002 → 409, unrelated errors still
  propagate as 500 (both proven with a real `PrismaClientKnownRequestError`
  and a mocked unrelated error).
- [x] **Finding #6** (2026-08-20) — `canAccessProperty` now reuses
  `ORG_WIDE_ROLES` instead of a hand-rolled duplicate check.
- [x] **Finding #7** (2026-08-20) — `seed.ts` uses the shared `prisma`
  singleton; re-run for real (`npm run db:seed -w backend`) to verify,
  since this file isn't covered by `tsc`'s typecheck include list.
- [x] **Finding #8** (2026-08-20) — documented retroactively in
  DECISIONS.md, not a code fix (the fix itself was correct; only the
  missing boundary-crossing note was the finding).
- [x] **Finding #9** (2026-08-20) — extracted `withUniqueConstraintGuard`
  into `lib/prisma-errors.ts`; all 5 call sites (organizations/properties/
  rooms create+update) now use it. No behavior change — full suite passes
  unchanged before and after.
- [x] **Finding #10** (2026-08-20) — backend slug pattern consolidated
  into `lib/slug.ts`. Frontend's 2 HTML `pattern` attributes intentionally
  left as-is (no shared workspace package yet — see DECISIONS.md), an
  explained partial fix, not silently dropped.

**All 10 branch-review findings are now resolved.** See DECISIONS.md for
verification detail on each.

## Phase 1 UX completeness (2026-08-20)

- [x] **Dashboard placeholder** — `/app` now shows a real `DashboardPage`
  (org name, real property count, honest "not built yet" note) instead
  of silently redirecting to Properties. Nav updated to match.
- [x] **Loading/success feedback** — `PropertiesPage`/`RoomsPage` now
  give a brief success confirmation after create/delete/status-change,
  and loading text is visually consistent with `RequireAuth`'s session-
  init loading state. No new dependency, no fabricated data.

Verified: `npm run typecheck/lint/build -w frontend` pass; frontend
suite 19/19 (6 files, 5 new); backend fully re-verified unaffected
(47/47 full suite; 34/34 auth/tenant-isolation/token-revocation/
organizations specifically). See DECISIONS.md for detail.

## Phase 1 completion — staff management (2026-08-20)

- [x] **Backend — staff management API** (2026-08-20)
  Closes the gap that made Phase 1's RBAC unreachable: an organization
  could only ever have the single OWNER created at signup, so
  `MANAGER`/`STAFF` presets could never be assigned, `PropertyAccess`
  could never be granted, and `platform/auth/revocation.ts` stayed
  unwired. Three separate code comments pointed at this missing endpoint
  (`permissions.ts`, `revocation.ts`, and both test files that provisioned
  users directly through Prisma to work around it).

  `GET/POST /api/v1/staff`, `GET/PATCH /api/v1/staff/:userId`, and
  `PUT /api/v1/staff/:userId/property-access`. New `staff:read` /
  `staff:manage` permissions. Privilege escalation is blocked by a role
  rank rule (`ROLE_RANK`) layered on top of the permission guard — a
  permission says what you may do, not who you may do it to. Role and
  property-access changes bump the revocation watermark so a demotion
  takes effect on the user's next request instead of up to 15 minutes
  later. Deactivation goes through `deactivateUser`; there is no hard
  delete. **No schema change was required** — every table already existed.

  Also fixed, surfaced by wiring the watermark to role changes: the
  watermark comparison mixed a millisecond timestamp with JWT's
  second-granular `iat`, spuriously rejecting a token minted in the same
  second as a bump. `signAccessToken` now records `iatMs`. This removed
  the 1100ms sleep that `token-revocation.test.ts` had been using to work
  around it. See DECISIONS.md.

  Verified: `npm run typecheck && npm run lint && npm run build && npm run
  test` all pass. Backend 78/78 across 9 files (was 47/47 across 8);
  frontend 19/19 untouched. `npm run db:seed -w backend` run for real
  (backfilled 3295 role-permission mappings onto existing organizations,
  then reported 0 on a second run). Full flow — including the
  escalation attempts that pass the permission guard and rely solely on
  the rank rule — exercised over real HTTP against the built artifact.

  **Awaiting Security sign-off before merge:** touches token issuance and
  the revocation check, which `AGENTS.md` marks as mandatory-review areas
  regardless of diff size.

- [x] **Frontend — staff management screens** (2026-08-21)
  The UI half of the above, sequenced after it per `AGENTS.md`'s
  schema → API → UI split. New `/app/staff` route ("Team"), reached from a
  nav link that only appears with `staff:read`.

  Introduces the app's first **feature module** (`frontend/src/features/staff/`:
  `types` / `api` / `permissions` / `StaffPage` / `StaffDialog`) and its
  first **shared UI primitives** (`frontend/src/components/`: `Modal`,
  `ConfirmDialog`, `DataTable`, `Badge`) — both boundaries chosen so the
  next module doesn't have to reinvent them. All staff endpoints are named
  in exactly one file (`features/staff/api.ts`).

  Table with search + role/status filters (client-side — the API has no
  query or pagination parameters, and inventing them was not an option),
  create/edit dialog, property-access picker, and a real focus-trapped
  confirmation dialog for deactivate/reactivate, replacing native
  `confirm()` for this feature.

  `AuthContext` now exposes display-only `session` claims decoded from the
  access token (`auth/session.ts`), so the UI can avoid rendering controls
  that would only earn a 403. **This is presentation, not access control**
  — see DECISIONS.md. `lib/api.ts` gained `PUT` and a token-change
  subscription so those claims can't go stale after a silent refresh.

  Verified: frontend typecheck/lint/build pass; frontend suite 42/42
  across 7 files (was 19/42 across 6 — 23 new). Backend re-run unaffected
  at 78/78. Beyond the mocked unit tests, a live contract check against
  the running backend exercised every request the frontend actually makes
  and asserted every field the frontend's `StaffMember` type declares —
  92 checks, all passing, including that no `passwordHash` is ever
  returned and that the server still refuses an action the UI hides.

- [x] **Server-side list contract: pagination, search, filters** (2026-08-21)
  Closes the client-side-filtering limitation recorded above. `GET
  /api/v1/staff` now accepts `page`, `pageSize`, `search`, `role` and
  `status`, and returns `{ staff, page: { page, pageSize, totalItems,
  totalPages } }`.

  The reusable half lives in `backend/src/lib/pagination.ts` (query-schema
  fragment, `toSkipTake`, `buildPageMeta`, `MAX_PAGE_SIZE`) and
  `frontend/src/lib/pagination.ts` (`PageMeta`, `toQueryString`), plus a
  domain-free `components/Pagination.tsx`. **This is the pattern every
  future module's list endpoint inherits** — properties, units, leases,
  maintenance — rather than each inventing its own page shape.

  Filtering/sorting stay with each module (they differ per domain); only
  the page contract is shared. Search requires every whitespace-separated
  term to match first name, last name or email, so a full name finds one
  person even though the name spans two columns. Count and page are read
  in one transaction, and ordering carries an `id` tiebreaker so rows
  can't straddle or fall between pages. Over-large `pageSize` is a 400
  rather than a silent truncation.

  Frontend: search is debounced (300ms → one request per pause), filters
  and paging are not; any filter change resets to page 1; the table stays
  on screen while refetching instead of collapsing to a placeholder.

  Verified: typecheck/lint/build pass. Backend 91/91 (was 78 — 13 new
  covering paging, search semantics, each filter, AND-combination,
  filtered totals, validation boundaries, and a cross-tenant probe).
  Frontend 47/47 (was 42 — 5 new asserting the *request* rather than a
  filtered DOM, since a DOM assertion would still pass if filtering had
  silently reverted to the client). A live check against the running
  backend ran 40 assertions using the exact query strings the frontend
  builds, including that another organization searching for a known name
  gets zero rows and a zero total.

- [x] **Properties vertical slice** (2026-08-21) — see the Phase 2 entry below.

- [x] **Audit trail** (2026-08-21)
  New `AuditLog` model + `20260820201210_audit_log` migration, generated
  and applied with `prisma migrate dev` against a **real PostgreSQL
  16.15** (`postgres:16-alpine`).

  Deliberately generic rather than staff-specific: `entityType` +
  `entityId` name the target polymorphically and `action` is a namespaced
  string (`"staff.role_changed"`) rather than a database enum, so
  properties, units, leases, maintenance, payments and agent actions
  reuse the table without a schema change — adding an action costs a
  constant in `platform/audit/actions.ts`. `AuditActorType`
  (`USER | SYSTEM | AGENT`) is in place from the start so an AI agent's
  actions are attributable without a later migration.

  Writes happen in `platform/audit/recorder.ts`, called from inside the
  staff service's existing transactions, so an entry commits or rolls
  back with the change it describes. Actor and organization come from
  `getRequestContext()` and are not parameters — a caller cannot
  attribute an action to someone else or file it under another tenant,
  and a future AI agent running inside `runWithRequestContext(...)` is
  audited automatically with no opt-out.

  Covered: create, rename, role change, deactivate, reactivate, and
  property-access change. Read API is `GET /api/v1/audit-logs`
  (paginated, filterable by action/entity/actor, newest-first) behind a
  new `audit:read` permission held by OWNER/ADMIN only — the trail
  records administrative actions taken *on* MANAGER/STAFF, so they are
  deliberately excluded. There is no write, update or delete endpoint.

  Verified: typecheck/lint/build pass. Backend 115/115 (was 91 — 24 new,
  covering authorized/unauthorized/forbidden/wrong-tenant, each mutation
  type, entry shape, credential redaction, and that a *refused* action
  leaves no entry). Frontend 47/47 unchanged. `npm run db:seed`
  backfilled `audit:read` onto 2856 role-permission mappings for existing
  organizations. A live run made 38 assertions against the running
  server, including cross-tenant probing by real entity ID returning
  nothing.

  **UI deliberately deferred** — the write path and read API are done and
  documented, but where an audit view belongs (per-staff timeline vs.
  global activity log) is a product-design question, and the dashboard
  pass is scheduled after the core domain modules. Contract is fixed, so
  the UI task is presentation only.

  **Known limitation:** `deactivateUser` runs outside the service
  transaction, so its audit entry is written after it succeeds — a crash
  between the two leaves an unrecorded deactivation. Recording first was
  rejected because a trail that lies is worse than one with a gap. See
  DECISIONS.md.

## Phase 2 — Properties vertical slice (2026-08-21)

- [x] **Properties & Rooms: server-side lists, audit coverage, UI migration** (2026-08-21)
  No schema change — this hardened two modules that already existed onto
  the three foundations established by the staff slice, which was the
  point: proving the pagination contract, the audit table and the UI
  primitives generalize *before* committing to them for domains that
  don't exist yet.

  **Backend.** `GET /properties` and `GET /properties/:id/rooms` now use
  the shared pagination contract. Properties filter on `search`
  (name/slug/city) and `status`; rooms on `search` (name/type/floor) and
  the full `RoomStatus` enum. Rooms sort by name rather than creation
  date — "101, 102, 201" is the order a property is actually walked, and
  pagination made that ordering visible in a way an unbounded list didn't.

  **A real correctness fix came with it.** `listProperties` filtered by
  PropertyAccess grants *after* fetching rows. Once paginated that
  silently breaks: the database slices a page, then the filter removes
  rows from it, producing short pages and a `totalItems` counting
  properties the caller cannot see. The grant is now a query condition,
  so the count is correct too. Regression-tested directly.

  **Audit.** `property.created/updated/deleted` and
  `room.created/updated/deleted`, reusing `platform/audit` — no second
  mechanism. Updates record a real before/after field diff computed from
  the persisted rows, so re-submitting an unchanged value produces no
  entry. Deletion captures the name and slug before the row is gone, plus
  the number of rooms that cascaded with it.

  **Frontend.** `pages/PropertiesPage.tsx` and `pages/RoomsPage.tsx` are
  replaced by `features/properties/` and `features/rooms/`, following the
  feature-module convention: endpoints named in one `api.ts`, typed
  models, dialogs for create/edit, `DataTable` + `Pagination` +
  `ConfirmDialog` instead of bespoke list markup and native `confirm()`.
  Debounced server-side search, filters that reset to page 1, and
  permission-gated controls (presentation only). Room status stays
  editable inline — it is the field changed most often, and a one-field
  edit shouldn't need a dialog.

  Verified: typecheck/lint/build pass, `prisma migrate status` clean.
  Backend 141/141 (was 115 — 26 new: pagination, search semantics, each
  filter, grant-filter paging correctness, audit entries for every
  mutation, and that a refused mutation writes nothing). Frontend 79/79
  (was 47; 4 old tests removed with the page they covered, 36 added). A
  live run made 41 assertions against the running server, including the
  manager-with-one-grant paging case and cross-tenant probes.

  **Two bugs found and fixed en route, neither introduced by this task:**
  `.page-error`/`.page-success`/`.empty-state` were defined only in
  `pages/resource-pages.css`, imported only by the two pages being
  replaced — `DataTable`, `StaffPage`, `StaffDialog` and `DashboardPage`
  all used them and worked purely by accident of global CSS bundling.
  Moved to `components/ui.css`. And `Pagination` singularized by stripping
  a trailing "s", rendering "1 propertie"; it now takes an optional
  explicit singular.

  **Deferred deliberately:** no room-level audit for the cascade when a
  property is deleted (the property entry records the count instead —
  emitting N room-deleted entries for one action would bury the action
  that caused them). No bulk operations. No property detail route; the
  dialog carries the full record, and a dedicated route is a
  product-design question for the dashboard pass.

- [x] **Transactional audit writes** (2026-08-21)
  All three services (staff deactivation, properties, rooms) now commit
  the mutation and its audit entry in one transaction. The blocker was a
  type, not an architecture: the recorder now declares its client
  structurally, so base/scoped clients and their transactions all satisfy
  it. `deactivateUser` accepts a transaction so the user update, session
  revocation and audit entry are atomic; its cache eviction deliberately
  stays outside (an in-memory eviction can't roll back).

  The tenancy extension propagating into `$transaction` — which the whole
  fix depends on — is now pinned by a regression test rather than
  assumed. Backend 150/150 (9 new, including forced-audit-failure
  rollback proofs for every service). See DECISIONS.md.

- [ ] **Audit trail UI**
  Presentation only; contract is `GET /api/v1/audit-logs` →
  `{ auditLogs: [{ id, action, entityType, entityId, actorType,
  actorUserId, actorEmail, actor: { id, firstName, lastName, email } |
  null, metadata, createdAt }], page }`. Needs `audit:read` gating and
  reuses `DataTable`/`Pagination`.

- [ ] **JSON 404 for unmatched routes**
  An unknown path returns Express's default HTML page instead of the
  app's `{ error: { code, message } }` shape. Pre-existing (no catch-all
  handler in `app.ts`), found while verifying the audit endpoints. Small,
  but it is an API-consistency bug a client sees on any typo'd URL.

Phase 2 onward (RoomType/rate plans/availability, reservations, folios,
housekeeping, notifications/jobs infra, reports, AI Marketing Studio,
OTA integrations, POS/inventory, direct booking/loyalty/PWA) follows the
phased roadmap in the architecture review; each phase gets its own
`TASKS.md` breakdown when it starts, not before.

## Explicitly out of scope for now

Bookings/reservations, OTA integrations, reviews, payments, marketing —
do not start these until a task here explicitly calls for them.
