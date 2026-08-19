# Decisions — The Living Canvas PMS

Chronological log of technical decisions. Newest at the bottom.

---

## 2026-08-18 — Bootstrap the project from an empty repository

**Context:** The VS Code/WSL workspace was completely empty (no git repo,
no docs) when implementation started, despite planning having reportedly
happened in Claude Desktop. Rather than guess at undocumented plans, the
user was asked and confirmed: treat this as a genuine fresh start and
bootstrap the docs and codebase here.

**Decision:** Created PROJECT_CONTEXT.md, ARCHITECTURE.md,
DATABASE_SCHEMA.md, DECISIONS.md, and TASKS.md from scratch, then began
implementing the first task. If a separate, more authoritative doc set
from Claude Desktop turns up later, reconcile these against it.

---

## 2026-08-18 — Domain: multi-property hospitality PMS

**Decision:** "PMS" = Property Management System in the hospitality sense
(hotels/venues, rooms, staff, and later bookings/OTA/reviews/payments),
not landlord-tenant leasing. Confirmed multi-property: this is a SaaS
platform where multiple organizations each manage their own properties,
not a single-venue system.

**Why it matters:** Drives multi-tenancy into the schema from day one
(`Organization` as the top-level tenant) rather than retrofitting it later.

---

## 2026-08-18 — Stack: Node.js + Express + TypeScript, React + Vite, PostgreSQL

**Decision:** Confirmed by the user. Backend is Express (not Fastify/Nest)
for simplicity and broad familiarity; frontend is Vite + React (not
Next.js) since backend and frontend are already split into separate
workspaces with no current need for SSR.

---

## 2026-08-18 — ORM: Prisma

**Decision:** Use Prisma as the data-access layer and migration tool
instead of a raw query builder (Knex) or a lower-level ORM.

**Why:** Type-safe queries generated straight from the schema, a single
`schema.prisma` as readable source of truth, and built-in migration
tooling — all of which matter more here than Prisma's runtime overhead,
given this is an internal CRUD-heavy admin system rather than a
latency-critical service.

---

## 2026-08-18 — Monorepo via npm workspaces

**Decision:** Single git repo with `backend/` and `frontend/` as npm
workspaces under one root `package.json`, rather than separate repos or a
heavier tool (Turborepo/Nx).

**Why:** Two packages don't yet justify a build-orchestration tool; npm
workspaces gives shared installs and root-level scripts with zero extra
tooling. Revisit if the number of packages or build complexity grows.

---

## 2026-08-18 — First task scope: scaffolding + core schema only

**Decision:** The first implementation task covers project scaffolding
(tooling, structure, CI-less build/lint/test) and the foundational schema
(Organization, User, Property, Room) — explicitly **not** authentication,
booking, or any UI beyond a minimal shell that proves frontend↔backend
connectivity.

**Why:** Confirmed by the user, and keeps the foundation reviewable in one
pass before layering auth and real features on top of it.

---

## 2026-08-18 — Migration generated without a live database

**Context:** The dev sandbox that authored this code has no Postgres
instance available (no Docker, no local `postgres` package, no
passwordless sudo to install one).

**Decision:** Used `prisma migrate diff --from-empty --to-schema-datamodel`
to generate the initial migration SQL from the schema alone, and validated
the schema with `prisma validate` + `prisma generate` (both of which work
without a DB connection). The migration has **not** been applied/tested
against a real Postgres instance.

**Follow-up required:** The next person with a real Postgres instance
available must run `npm run db:migrate -w backend` and confirm the
migration applies cleanly before this schema is considered verified
end-to-end.

---

## 2026-08-18 — Adopt a controlled multi-agent development system

**Context:** As implementation moves past the initial foundation, work
increasingly benefits from specialist agents (Frontend, Backend, Database,
QA, Security, DevOps) rather than one generalist doing everything. Without
explicit boundaries, that risks agents overwriting each other's work or
editing files outside their domain (e.g. a UI task touching the Prisma
schema).

**Decision:** Documented a multi-agent system in `AGENTS.md` plus one file
per role under `docs/agents/`, defining each agent's file-scope ownership,
communication via written handoff reports, git-worktree-per-task isolation
on `agent/<role>/<slug>` branches, a bug flow (report → triage → reproduce
→ fix → verify → conditional security review), and a human-approval gate
before anything merges to `main`. This is process documentation only — no
application code, tech stack, or existing architecture changed as part of
this decision, and no agent is authorized to implement business features
outside a task explicitly defined in `TASKS.md`.

**Why:** Fixing ownership boundaries and a handoff protocol in writing,
before delegating real feature work, is cheaper than untangling conflicting
edits after the fact — and keeps every agent's job legible to a human
reviewer at the approval step.

---

## 2026-08-19 — Production architecture direction, locked

**Context:** With the foundation stage complete, a full architecture and
product-planning review was carried out against the entire scope in
`PROJECT_CONTEXT.md` plus the future modules described in planning
(bookings, OTA integrations, payments, and a provider-agnostic AI
Marketing Studio). That review produced a proposed production
architecture; the following decisions from it are now confirmed by the
human and locked for Phase 1 planning. See `ARCHITECTURE.md`'s "Approved
direction" section for how these fit together.

**Decisions:**

1. **Session model:** JWT access token + DB-backed refresh session (not
   stateless JWT alone). **Why:** a fired staff member's access must be
   revocable immediately, which a stateless token can't guarantee before
   it expires.
2. **Authorization model:** permission-based RBAC from day one — a
   `Permission`/`Role`/`RolePermission` schema, not the raw four-value
   `UserRole` enum used as the authorization mechanism itself. The
   existing OWNER/ADMIN/MANAGER/STAFF labels remain as built-in role
   presets in the UI. **Why:** migrating live staff accounts off a
   hardcoded enum onto a permission table later is a breaking,
   user-visible change; building the permission schema now costs little.
3. **Reservation date/time storage:** stay dates (check-in/check-out)
   stored as date-only; actual event timestamps (e.g. actual check-in
   moment) stored as `timestamptz`. **Why:** a stay date is a property-
   local calendar date independent of clock time; an event timestamp is a
   real moment that needs timezone-correct ordering.
4. **Currency & tax scope:** INR-only for the initial release. No
   multi-currency modeling in Phase 1's schema beyond what's trivially
   additive later (e.g. not hardcoding "₹" into display strings). **Why:**
   confirmed no near-term international property; avoids speculative
   currency-conversion complexity.
5. **Object storage:** an S3-compatible provider, selected to match
   whichever cloud the production hosting decision (#9) puts the app on,
   accessed only through the `platform/storage` abstraction — never a
   vendor SDK called directly from a route or module. **Why:** no
   provider choice should be able to leak into application code; the
   abstraction is the actual decision, the vendor behind it is a config
   value.
6. **Background job queue:** pg-boss (Postgres-backed), no Redis. **Why:**
   introduces zero new infrastructure classes — the project already runs
   Postgres — consistent with the existing DevOps convention against
   adding a second data store without a documented reason. Revisit only
   if real throughput demands it.
7. **AI provider integration order:** build and ship the first real
   `AIMediaProvider` adapter against an image-generation provider before
   attempting video. **Why:** lower cost and latency to validate the
   provider-agnostic abstraction end-to-end; video adapters follow once
   the pattern is proven. The specific first vendor (Higgsfield / Veo /
   Kling / Seedance) is chosen at the start of that implementation task,
   not here — the abstraction is what's locked, not the vendor.
8. **Payment gateway:** Razorpay. **Why:** fits the INR/GST context
   confirmed above; tokenized card handling only, the PMS never stores
   raw card data.
9. **Hosting:** the simplest production-ready option compatible with the
   current repo shape (npm-workspaces monorepo, two Node deployables —
   API and worker — plus Postgres) — a managed PaaS that runs both
   processes from one repo with a managed Postgres add-on and
   git-push/CI-triggered deploys, rather than a self-managed
   container-orchestration platform. **Why:** the team and traffic don't
   yet justify Kubernetes-class operational overhead; a PaaS gets managed
   TLS, managed Postgres, and zero-downtime deploys without a DevOps
   role dedicated to infrastructure. The specific vendor is a DevOps task
   at Phase 1 kickoff (see `TASKS.md`), evaluated against: native support
   for a second background-worker process from the same repo, a managed
   Postgres offering, and GitHub-based deploy triggers — not re-litigated
   here.
10. **Documentation Agent:** added as the eighth role now (see `AGENTS.md`
    and `docs/agents/documentation.md`), rather than deferred. **Why:**
    doc drift compounds fastest exactly when feature velocity picks up,
    which is what Phase 1 is about to do.
11. **Shared-types workspace (`packages/shared`):** deferred until the
    Reservations phase (Phase 4), not introduced now. **Why:** Phase 1's
    surface (auth, org/property/room CRUD) doesn't yet generate enough
    cross-workspace shared shapes to justify a third workspace's
    boundary overhead.

**Status:** these are architecture-direction decisions, not implemented
code. No schema, route, or config file has changed as a result of this
entry — Phase 1 implementation begins only after separate, explicit human
approval per task, per the existing approval process in `AGENTS.md`.

---

## 2026-08-19 — Migration verification via PGlite, in lieu of Docker access

**Context:** Phase 1 was approved and implementation began. The Phase 1
schema task (1a/1b) needed to apply and verify two migrations
(`20260818130940_init`, `20260819000000_phase1_auth_rbac_tenancy`)
against a real Postgres, but this dev sandbox has no path to one:
`docker compose up` fails (`permission denied` on the Docker socket — the
sandbox user isn't in the `docker` group and `sudo` requires interactive
auth this session doesn't have), and no local `postgres`/`psql` binary is
installed.

**Decision:** Rather than repeat the original foundation migration's
"schema-validated only" outcome, verification used
[PGlite](https://pglite.dev/) (`@electric-sql/pglite`) — the actual
PostgreSQL engine compiled to WASM, run in-process — fronted by
`@electric-sql/pglite-socket`, which speaks the real Postgres wire
protocol on a local TCP port. `prisma migrate deploy` was pointed at it
like any other Postgres instance. This is not a repo dependency: it was
installed and run from the session's scratchpad directory, entirely
outside `backend/`, purely as a verification tool.

**What this did and didn't prove:**

- Did: both migrations apply cleanly and in order from an empty
  database; every table, constraint, and foreign key referenced by the
  new Phase 1 models works under real SQL execution (verified with a full
  Prisma Client create + nested-read round-trip across every table); the
  documented cascade-delete behavior is real — deleting an `Organization`
  removes every dependent row through `User`/`Role`/`Session`/
  `PropertyAccess`/`Room`, while `Permission` correctly survives as its
  documented non-tenant exception.
- Didn't: confirm behavior against the project's actual Postgres 16
  binary (the one `docker-compose.yml` runs) or under real concurrent
  connection-pool load — PGlite is single-session internally, and
  Prisma's connection string needed `pgbouncer=true` to avoid a prepared-
  statement collision artifact of that. Neither limitation affects the
  migration SQL's correctness, but a native-Postgres confirmation via
  `npm run db:migrate -w backend` is still worth doing once Docker access
  is available.

**Why:** a schema-validated-only migration was already the accepted
starting position for the foundation migration; a real (if WASM) engine
execution is strictly more evidence than that starting position, at
effectively zero cost, and is worth doing again rather than re-accepting
the weaker bar by default just because Docker access repeated the same
gap.

---

## 2026-08-19 — Phase 1 backend: platform layer, auth, tenancy, CRUD (1c/1d/1e)

**Decision:** Implemented the `platform/` cross-cutting layer described in
`ARCHITECTURE.md`'s "Approved direction" and the `organizations`,
`properties`, `rooms`, and `auth` modules on top of it, per the locked
Phase 1 decisions.

**Notable implementation choices not already covered by the locked
decisions:**

- **Tenant-scoping mechanism:** a Prisma Client Extension
  (`platform/tenancy/scoped-prisma.ts`) reading from an
  `AsyncLocalStorage`-based request context. One config block per
  tenant-scoped model — `Property` (direct `organizationId` column) and
  `Room` (scoped via its `property` relation, since it has no
  `organizationId` column of its own). Extend this file the same way —
  one block per model — as new tenant-scoped models land; a model not
  listed is not auto-scoped.
- **A real gotcha, documented in code:** combining `AsyncLocalStorage`
  with Prisma's lazily-evaluated queries requires the query to actually
  be `await`ed *inside* the `storage.run()` callback — merely returning
  the (unawaited) query loses the context, because Prisma doesn't start
  real execution until `.then()`/`await`, which by then runs outside
  `storage.run`'s synchronous extent. Documented on
  `runWithRequestContext` itself so it isn't rediscovered the hard way.
- **`PropertyAccess` vs. tenant boundary are two independent layers, on
  purpose:** the RBAC guard's `canAccessProperty` only answers
  "property-level grant within the org" and deliberately does not verify
  organization membership — that's the tenant-scoping extension's job,
  enforced unconditionally at the data-access layer regardless of what
  the RBAC guard decided. Neither layer re-implements the other's job.
- **Room creation's tenant boundary:** since `Room` has no
  `organizationId` column, a `create` can't have it injected the way
  `Property`'s can. The rooms repository instead resolves the parent
  `Property` through the *scoped* client first — a cross-organization
  `propertyId` resolves to nothing there and 404s before any room row is
  written.
- **Uniqueness checks are proactive, not catch-only:** property slug and
  room name uniqueness are checked with a `findFirst` before `create`/
  `update`, with the database's own unique-constraint error still caught
  as a backstop for the narrow check-then-write race. Chosen for a clean
  `ConflictError` on the common path rather than depending solely on the
  database round-tripping a well-formed constraint-violation error.
- **Signup is the one public endpoint:** `POST /organizations` has no
  authenticated caller by construction — it bootstraps a new tenant (org
  + OWNER user + the org's four system roles, seeded from the code-level
  permission catalog) in one transaction. Every other route sits behind
  `authenticate`.

**Verification:** `npm run typecheck && npm run lint && npm run build &&
npm run test` all pass for both workspaces. Beyond that, the full
login → org → property → room flow, cookie-based refresh rotation with
replay detection, and validation/auth-guard error paths were exercised
end-to-end over HTTP against the live PGlite instance (see the migration-
verification entry above) via manual `curl` runs before the automated
suite was written.

**A real bug found and fixed during that manual verification:** `GET
/properties/:propertyId/rooms` for a property belonging to a *different*
organization returned `200 {"rooms":[]}` instead of `404` — not a data
leak (tenant scoping still zeroed the result correctly), but inconsistent
with every other property sub-route, which 404s on a cross-org ID. Fixed
by having the rooms repository verify the parent property exists (through
the scoped client) before listing, same pattern already used for `create`.

---

## 2026-08-19 — Phase 1 QA: standing tenant-isolation regression suite (1f)

**Decision:** Added `backend/test/tenant-isolation.test.ts` as a
permanent regression suite (not a one-off check) covering: a property/
room created in one organization is invisible to another organization
across list/get/create/update/delete; two organizations can reuse the
same property slug independently; a `MANAGER` without a `PropertyAccess`
grant gets 403 on a property in their *own* org, and gains access once
granted. Since Phase 1 has no staff-invite endpoint yet, the
`PropertyAccess` scenarios provision a second user directly against the
database rather than through the API — exactly the schema path a future
staff-management task will wire an endpoint onto.

**Also decided:** `backend/vitest.config.ts` now sets
`fileParallelism: false`. This suite shares one real database across all
test files with no per-worker isolation (no schema-per-worker, no
transactional rollback) — running files concurrently risks state races
regardless of which Postgres is behind it. Revisit if/when the suite
gains real per-worker DB isolation.

**Verification:** `npm run test -w backend` — 30 tests across 6 files,
all passing against the live (PGlite) database, including every
cross-tenant case above.

---

## 2026-08-19 — Phase 1 Security review (1g)

**Context:** Reviewed the auth, tenancy, and RBAC code from the two
entries above per `docs/agents/security.md`'s focus areas before Phase 1
proceeds to Frontend.

**Findings and outcomes:**

1. **No rate limiting on `/auth/login` (fixed).** Unlimited login
   attempts against a known email is a brute-force exposure. Added a
   minimal in-memory limiter (`platform/auth/rate-limit.ts`, 10 attempts
   per 15-minute window per IP+email) — a narrow, isolated fix within
   Security's write exception. **Follow-up:** this is single-process
   only; a shared store (e.g. Redis) is needed before running more than
   one API process, which doesn't apply yet (see the hosting/job-queue
   decisions above) but will need revisiting alongside that.
2. **`sameSite: 'lax'` on the refresh cookie (reviewed, kept).** Works
   for local dev (different ports on `localhost` are same-site) and for
   any production topology where the frontend and API share a
   registrable domain. Documented directly on `cookies.ts` as a
   deployment-topology constraint, since choosing genuinely different
   registrable domains for frontend/API later would silently break the
   refresh flow rather than erroring loudly.
3. **Residual CSRF surface on `/auth/refresh` and `/auth/logout`
   (reviewed, accepted for now).** `sameSite: 'lax'` already blocks a
   truly cross-*site* POST from carrying the cookie at all; the remaining
   exposure is same-site-but-different-subdomain, and even then CORS
   blocks the attacker from reading the response — worst case is a forced
   logout/session rotation, not token theft. No fix applied; noted as
   acceptable for Phase 1's threat model, not for the payments/guest-PII
   modules later.
4. **No account lockout / password-reset flow.** Out of Phase 1 scope by
   design (`TASKS.md` doesn't call for it yet) — noted, not fixed, so it
   isn't silently forgotten before Phase 5 (payments) raises the stakes.
5. **Secrets handling, CORS, input validation, Prisma query
   parameterization:** reviewed, no findings — `.env` stays gitignored,
   `.env.example` stays placeholder-only, CORS is origin-locked (not
   wildcard) with credentials, every route validates input via `zod`
   before it reaches Prisma, and no raw SQL exists anywhere in the
   Phase 1 code.

**Status:** sign-off given for Phase 1's auth/tenancy/RBAC code with the
above two follow-ups (items 1 handled inline; items 2–4 documented for
future phases) — required per `AGENTS.md`'s mandatory-sign-off list for
this exact category of change.

---

## 2026-08-19 — Phase 1 frontend: router, auth context, admin shell (1i/1j)

**Decision:** Introduced `react-router-dom` and `AuthContext` — the
first routing/state-management dependency, exactly the task this
project's conventions said to wait for (see `docs/agents/frontend.md`).
Built `/login`, `/signup`, and a protected `/app/*` tree (`AppShell` +
`RequireAuth`) with `PropertiesPage` and `RoomsPage` against the Phase 1
CRUD API.

**Notable choices:**

- **Access token in memory only, never `localStorage`.** A page reload
  loses it by design; `AuthContext` recovers the session with a silent
  `POST /auth/refresh` against the httpOnly cookie on mount. Keeps the
  access token out of reach of an XSS payload that can read
  `localStorage`.
- **`/signup` wasn't originally scoped in TASKS.md's 1i description
  ("login screen"), but was added anyway:** without it, `/login` has no
  way to produce a first account — `POST /organizations` (the backend's
  one public endpoint, from 1e) is otherwise unreachable from the UI.
  Treated as necessarily part of "login screen + admin shell" rather
  than scope creep.
- **`lib/api.ts`'s fetch wrapper** centralizes the Authorization header,
  a single-flight refresh-and-retry on a 401 (concurrent 401s coalesce
  into one refresh call), and a typed `ApiError` — no component calls
  `fetch` directly.

**A real bug found and fixed along the way (unrelated to this task's own
code, but blocking it):** the frontend's Vitest setup had no Testing
Library cleanup wired up (`globals: true` isn't enabled, so
`@testing-library/react`'s automatic `afterEach(cleanup)` registration
never fires) — every test's rendered DOM was accumulating across tests
within the same file. Invisible with the original single-test
`App.test.tsx`; surfaced immediately once a second test was added. Fixed
in `src/test/setup.ts` with an explicit `afterEach(cleanup)`.

**Verification:** `npm run typecheck && npm run lint && npm run build &&
npm run test -w frontend` pass (14 tests, 5 files, mocked-fetch component
tests). Additionally verified over real HTTP: signup → login → property
→ room CRUD exercised via `curl` sent with `Origin: http://localhost:5173`
against the live backend, confirming CORS (echoed origin +
`Access-Control-Allow-Credentials`) and the refresh cookie's
`SameSite=Lax`/`HttpOnly`/`Path=/api/v1/auth` attributes are actually
usable from the frontend's real origin — not just asserted in code
comments. No Chrome extension was connected in this sandbox, so an actual
browser click-through wasn't performed; that's a reasonable follow-up
before treating Phase 1's frontend as fully closed, but the HTTP contract
itself is proven end-to-end.

---

## 2026-08-19 — Phase 1 DevOps: CI pipeline (1h)

**Decision:** Added `.github/workflows/ci.yml` — one job, one
`postgres:16-alpine` service container with credentials matching
`docker-compose.yml`, running install → `prisma generate` → `prisma
migrate deploy` → the same `typecheck`/`lint`/`build`/`test` root
commands documented in `README.md` and required by `AGENTS.md`. No
parallel verification path invented — this runs exactly what a human
already runs locally, per the DevOps role's stated convention.

**Why a real Postgres service container, not another workaround:** the
Phase 1 backend and database work in this sandbox had to verify
migrations against PGlite (see the 2026-08-19 "Migration verification via
PGlite" entry) because Docker wasn't reachable non-interactively here.
GitHub Actions doesn't have that constraint — a `postgres:16-alpine`
service container is the actual target engine, not an emulation. Once
this workflow runs on a real push/PR, it becomes the first genuine
confirmation that both Phase 1 migrations apply cleanly against real
Postgres, closing the gap flagged since the very first foundation
migration.

**JWT_SECRET in CI:** a hardcoded dummy value
(`ci-only-dummy-secret-not-used-anywhere-else`), not a GitHub Actions
secret — it signs tokens that live only for the duration of one CI run
against a database that's destroyed immediately after, so there's
nothing here worth protecting as a secret. Real deployment secrets are
a separate, later DevOps concern (see the hosting decision in the
architecture-lock entry above).

**Verification:** the workflow's exact command sequence
(`db:generate` → `db:migrate:deploy` → `typecheck` → `lint` → `build` →
`test`) was run locally against a live database and passed. **Not yet
observed running on GitHub's own infrastructure** — no push/PR has
happened from this sandbox. That's a real gap, not glossed over: the
workflow file's syntax and command sequence are verified as correct as
they can be without actually triggering a GitHub Actions run.


