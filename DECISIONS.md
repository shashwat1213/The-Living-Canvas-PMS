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

---

## 2026-08-19 — Branch review fixes: session revocation + secret-fallback guard

**Context:** A full-diff review of `phase1/auth-rbac-tenancy` (correctness,
security, tenant isolation, architecture compliance, tests, unintended
changes) surfaced ten findings. Per explicit instruction, only the two
most severe were fixed at this point; #3–#10 were deliberately left
untouched pending separate review.

**Fix 1 — `rotateSession` never checked `User.isActive`.** Only `login()`
did, so a deactivated staff member's existing refresh cookie (up to 30
days) kept minting valid access tokens indefinitely via
`POST /auth/refresh`. `rotateSession` now checks the session owner's
`isActive` and revokes the session the moment a deactivated user's cookie
is presented — dead on first use, not just rejected-and-retryable.

**Fix 2 — the hardcoded fallback JWT secret was reachable via `NODE_ENV`
alone.** `isTest` was `nodeEnv === 'test'`, which a misconfigured real
deployment could end up with, silently signing tokens with a secret
committed in this repo. `isTest` now additionally requires
`process.env.VITEST === 'true'` (confirmed empirically: Vitest sets this
for its whole process; a real running server never has it), so a real
deployment merely misconfigured with `NODE_ENV=test` still hits the
required-variable throw.

**What this fix deliberately did NOT close:** an access token minted
*before* deactivation and not yet expired remains valid until its own
(≤15 min) expiry — inherent to a stateless JWT, and explicitly scoped as
an accepted tradeoff in the original session-model decision above ("a
stateless token can't guarantee [revocation] before it expires"). See the
next entry for the follow-up that closes this specific gap.

**Verification:** `npm run typecheck/lint/build -w backend` pass; full
backend suite 36/36 (30 pre-existing + 6 new — 2 in `auth.test.ts`
proving the revocation behavior, 4 in new `env.test.ts` covering the
`isTest`/`VITEST` guard via isolated child processes, since that guard
runs once at module-import time and can't safely be exercised by
mutating this suite's own live `process.env`).

---

## 2026-08-20 — Token-revocation watermark (Option B)

**Context:** Following up on the residual gap named in the entry above:
an already-issued access token survives a user's deactivation for up to
its own TTL, because `authenticate` verifies it purely by signature and
expiry — no database or cache lookup on that path, by design (that's the
entire performance point of using a JWT for the access-token layer).
Several designs were weighed (shorten the TTL; a per-user revocation
watermark; a fully stateful per-token check; a push-based "kick" signal)
before implementing a per-user watermark, checked through a short-lived
in-process cache — bounding the lag to the cache TTL instead of the
access-token TTL, without a database hit on every request and without a
new infrastructure dependency (no Redis).

**Schema:** `User.tokensValidAfter DateTime?`, nullable and
unbackfilled — `null` is "no floor," the state of every existing user on
migration day, so this is purely additive with no forced logout on
deploy.
Migration `20260819182224_token_revocation_watermark`.

**Mechanism:**
- `authenticate` (`tenancy/middleware.ts`) compares the verified token's
  `iat` against `User.tokensValidAfter` (via
  `platform/auth/revocation-cache.ts`), rejecting when `iat` predates it,
  regardless of the token's own expiry.
- The cache is cache-first including a cached `null` (the common case —
  this is what avoids a database hit for every request from a user who's
  never been touched, not only for revoked ones), database fallback on a
  miss, `env.auth.tokensValidAfterCacheTtlSeconds` — **30s default,
  configurable via `TOKENS_VALID_AFTER_CACHE_TTL_SECONDS`.**
- `platform/auth/revocation.ts` exposes `bumpTokensValidAfter` (sets the
  watermark + proactively evicts the cache entry, so the process
  performing a revocation enforces it immediately in its own subsequent
  requests) and `deactivateUser` (composes the watermark bump with
  `isActive: false` and `revokeAllSessionsForUser`, so a deactivated
  user's already-issued access token *and* refresh cookie both die
  together — closing this gap and the one from the entry above in one
  call). Neither is wired to a route yet — **Phase 1 still has no
  staff-deactivation endpoint** (see TASKS.md); this is the seam a future
  task calls into, built now specifically so that task doesn't have to
  invent it or forget the watermark.

**Fail-closed on a database error during a cache miss (explicit choice,
overriding the plan's own recommendation of fail-open):** the lookup
(`prisma.user.findUniqueOrThrow`) is not swallowed — a database error, or
the user no longer existing, propagates and `authenticate` rejects the
request. Chosen deliberately in favor of stricter security over
availability at this checkpoint specifically.

**Logout does not bump the watermark; deactivation does.** Plain
single-device logout must only kill the caller's own session — bumping
the watermark there would silently log out every other device/tab that
user has open, which is not what "log out" means. A future explicit
"log out everywhere" feature would call the same bump helper; ordinary
logout is unchanged.

**Multi-instance caveat, stated plainly:** the cache is in-process, same
limitation already documented for the login rate limiter. Phase 1 is
single-process, so this is fully effective as built. Before running more
than one API process, this needs a shared store (e.g. Redis) — each
process otherwise tracks its own independent cache, bounding revocation
lag to "within TTL, per process" rather than "within TTL, globally."

**A real, predicted edge case, confirmed in testing:** JWT `iat` has
one-second granularity. A token minted in the same wall-clock second as
a watermark bump can have a truncated `iat` that appears to predate the
bump even though it was actually issued after — this can only cause
spurious *rejection*, never spurious *acceptance*, so it's an accepted,
safe-direction imprecision (a rare, harmless "please log in again," not
a security gap). The "accepts a token minted after the bump" test
originally failed on exactly this collision and was fixed by waiting
past the second boundary — confirming the behavior matches what was
designed, not papering over a bug.

**Verification:** `npm run typecheck/lint/build -w backend` pass. New
`test/token-revocation.test.ts` (7 tests) covers: proactive same-process
rejection immediately after a bump; a fresh post-bump login still works;
`deactivateUser` closing both the access-token and refresh-session gaps
together; no regression to the default null-watermark case; the cache
TTL boundary itself (a cached value survives within TTL, a direct DB
write — bypassing the proactive-eviction helper on purpose — is picked
up once the TTL elapses); and fail-closed behavior on a simulated
database error, including recovery once the database is reachable again.
Full backend suite: 43/43. Additionally verified live against a real
`postgres:16-alpine` (Docker access became available partway through
Phase 1 — see the migration-verification follow-up in
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)): deactivated a user from a
separate process while the API server kept running, confirmed the
existing token still worked within the 30s cache window and was rejected
immediately after it elapsed — the exact real-world sequence the design
was built for, not just the test suite's simulation of it.

**Status:** implemented on `phase1/auth-rbac-tenancy`, not merged to
`main`.

---

## 2026-08-20 — Branch review findings #3, #4, #5, #6, #7, #9, #10 resolved; #8 documented

**Context:** Continuing the branch review from the earlier entries above.
Each finding was re-verified against the actual current code before
fixing (none were false positives).

**#3 — login timing side-channel (confirmed, fixed).** `login()` only
called `verifyPassword` when a user existed, via short-circuit
evaluation — a nonexistent email returned in a fraction of the time a
real argon2id comparison takes. Fixed in `modules/auth/service.ts`: a
precomputed dummy hash (never a real password) is used when no user is
found, so `verifyPassword` always runs exactly once regardless of
account existence. Test: `auth.test.ts` spies on `argon2.verify` and
proves it's called for a nonexistent email.

**#4 — `scoped-prisma.ts`'s `upsert` gap (confirmed, fixed).** The
tenant-scoping extension injected `organizationId` into `create`'s
`data`, but `upsert`'s create payload lives at `create`, a different
field — never scoped. Dormant (no repository currently calls `upsert` on
`Property`/`Room`) but a real gap in the mechanism the whole
architecture treats as the single source of truth for tenant isolation.
Fixed by adding the same injection for `operation === 'upsert'`.

**#5 — organizations signup race (confirmed, fixed).** No `try/catch`
around the signup transaction, unlike every other create path — a
concurrent duplicate signup would have surfaced as a raw 500 instead of
409. Fixed: the transaction is now wrapped via the new
`withUniqueConstraintGuard` helper (see #9). Tests in
`organizations.test.ts`: a real `Prisma.PrismaClientKnownRequestError`
(P2002) mocked from `prisma.$transaction` is confirmed converted to 409;
an unrelated mocked error is confirmed to propagate as 500, unconverted;
a genuine unique signup still succeeds normally.

**#6 — `context.ts` duplicated the org-wide-role check (confirmed,
fixed).** `canAccessProperty` hand-rolled `name === 'OWNER' || name ===
'ADMIN'` instead of reusing `ORG_WIDE_ROLES` from `rbac/permissions.ts`,
risking drift between the property-list filter and the property-detail
guard. Fixed to import and use the shared constant. No new test needed —
behavior is unchanged (same two role names), and the existing
`tenant-isolation.test.ts` PropertyAccess scenarios already exercise
this exact function; re-run and still passing (6/6).

**#7 — `seed.ts` instantiated its own `PrismaClient` (confirmed,
fixed).** Violated the documented single-client rule
(`lib/prisma.ts`'s shared instance is meant to be the only one).
Fixed to import the shared client. Verified by actually running
`npm run db:seed -w backend` against the live database, not just
typechecking (`prisma/seed.ts` isn't covered by `tsconfig.typecheck.json`,
which only includes `src`/`test` — running it for real was the only way
to prove the change works).

**#9 — duplicated check-then-write-then-catch pattern (confirmed,
fixed).** The same five-line try/catch (`isUniqueConstraintError` →
`ConflictError`) was repeated in `properties`/`rooms` `service.ts`
(create + update, 4 sites) plus a less-complete variant in
`organizations/service.ts` before #5's fix. Extracted
`withUniqueConstraintGuard(write, message)` into `lib/prisma-errors.ts`
— the proactive existence-check logic (which genuinely differs per
entity) stays in each service; only the catch-and-convert boilerplate is
now shared. All 5 call sites (organizations create, properties
create/update, rooms create/update) now use it. No behavior change;
proven by the full suite passing unchanged before and after (47/47).

**#10 — slug regex duplicated across 4 files (confirmed, partially
fixed).** `organizations/schemas.ts` and `properties/schemas.ts` each
independently defined the same pattern and message. Consolidated into a
new `lib/slug.ts` (`SLUG_PATTERN`, `SLUG_PATTERN_MESSAGE`), imported by
both. The frontend's two HTML `pattern="..."` attributes
(`SignupPage.tsx`, `PropertiesPage.tsx`) are left as-is, deliberately:
there is no shared package between the two npm workspaces yet
(`packages/shared` is explicitly deferred until the Reservations phase —
see the Phase 1 architecture-lock entry above), and introducing one just
to deduplicate one regex would be a larger change than the duplication
it removes. Accepted as a known, explained remainder, not silently
dropped.

**#8 — a `feat(frontend)` commit touched QA-owned `frontend/src/test/setup.ts`
(confirmed as a process finding, not a code defect — documented, no code
change).** The fix itself (wiring up Testing Library's `afterEach(cleanup)`,
missing since the original test infra was scaffolded) was necessary and
correct — without it, every test file's rendered DOM leaked into the
next test in the same file. It was bundled into a Frontend-owned feature
commit without a recorded boundary-crossing note, which is what
`AGENTS.md`'s ownership map asks for. Recorded here retroactively:
future shared-test-infrastructure changes discovered while doing
Frontend work should get an explicit one-line escalation note in the
commit or in `DECISIONS.md`, even when the fix itself is correct and
was reasonable to make in the moment.

**Verification:** `npm run typecheck && npm run lint -w backend` pass.
Full backend suite: 47/47 (30 Phase 1 + 6 finding #1/#2 tests + 4 Option B
core tests + 3 additional Option B tests + 3 new #5 tests + the #3 test,
across 8 files) passing against the live database. `npm run db:seed -w
backend` re-run successfully for #7. No test was weakened, skipped, or
removed to reach this state.

---

## 2026-08-20 — Phase 1 UX completeness: dashboard, loading/success feedback

**Context:** the E2E verification pass flagged that `/app` silently
redirected straight to `PropertiesPage` — functional, but it meant there
was no honest "this is what Phase 1 actually has" screen; a genuinely
empty product surface was being papered over by treating a CRUD list as
the dashboard.

**Decision:** Added a real `DashboardPage` as the `/app` index route,
replacing the redirect. It shows the org name, a real property count
(fetched, never fabricated) linking to Properties, and an explicit note
naming what isn't built yet (occupancy, revenue, booking activity) rather
than a blank space or a silent redirect pretending nothing was skipped.
Added a "Dashboard" nav link alongside "Properties" in `AppShell`.

**Success feedback:** `PropertiesPage` and `RoomsPage` now show a brief,
self-clearing (`setTimeout`, 3.5s) confirmation banner after create/
delete/status-change actions, reusing the same visual pattern as the
existing error banner (`.page-error` → new `.page-success`) rather than
introducing a toast library or new dependency. The updated list was
already the "real" evidence an action worked; this makes it also
immediately legible without reading the list diff.

**Loading states:** `PropertiesPage`/`RoomsPage`'s bare `<p>Loading…</p>`
now uses the same `.page-loading` class `RequireAuth` already uses for
session-initialization loading, for visual consistency — no new
component, no animation, matching the existing minimal style.

**Explicitly not done, and why:** no fake dashboard data of any kind; no
analytics/billing/reporting (Phase 2+ territory); no toast/notification
library added; no redesign of existing pages beyond the loading/success
additions described above.

**Verification:** `npm run typecheck/lint/build -w frontend` pass. New
`DashboardPage.test.tsx` (5 tests): loading state, real org name + count
rendered, singular/plural property label, the "not yet built" note is
present (guards against ever silently reverting to fabricated data),
and the error state. Full frontend suite: 19/19 (14 pre-existing + 5
new), across 6 files. Backend untouched — re-ran the full backend suite
(47/47) and the auth/tenant-isolation/token-revocation/organizations
regression suites specifically (34/34) to confirm zero impact, as
required before this phase could be considered done.



---

## 2026-08-20 — Staff management API: making the RBAC that already existed reachable

**Context.** Phase 1 shipped a full permission-based RBAC system —
`Role`, `RolePermission`, `UserRoleAssignment`, `PropertyAccess`, four
seeded role presets, a property-access guard — and then shipped no way to
create a second user. Every organization was permanently a single OWNER
account. The consequence was that most of that machinery was unreachable
from the API: `MANAGER`/`STAFF` presets could never be assigned,
`PropertyAccess` could never be granted, and `platform/auth/revocation.ts`
(`deactivateUser`, `bumpTokensValidAfter`) sat unwired, its own header
noting it was "the seam a future task calls into." Two test files worked
around the gap by provisioning users directly through Prisma, each with a
comment pointing at the missing endpoint. This task is that endpoint.

**Scope.** Backend + tests only. No schema change was needed — every
table this uses already existed, which is the main reason this was the
safe next step rather than a risky one.

### Decision 1 — `staff:read` + `staff:manage`, not CRUD-granular keys

The existing catalog is granular (`properties:create/read/update/delete`).
Staff deliberately isn't: creating a staff member, changing their role,
moving their property access and deactivating them are one administrative
capability, and an organization that grants "create staff" but withholds
"deactivate staff" has expressed a policy nobody asked for. This also
matches the `staff:manage` placeholder `permissions.ts` had described in
prose since Phase 1 (while, in fact, never defining the key — the comment
was aspirational, and is now accurate).

`MANAGER` gets `staff:read` only. `STAFF` gets neither.

### Decision 2 — role rank, because a permission can't express "to whom"

`staff:manage` is flat: any holder can call any staff mutation. Without a
second rule, an ADMIN could mint an OWNER and act through it, demote a
peer ADMIN, or deactivate the OWNER above them — all while passing the
permission guard legitimately. `ROLE_RANK` (OWNER 3 > ADMIN 2 > MANAGER 1
> STAFF 0) supplies the missing dimension, enforced in
`modules/staff/service.ts` as two rules:

- **Assign:** you may not grant a role above your own rank.
- **Target:** you may only act on a staff member *strictly below* your own
  rank.

The strictness of the second rule is doing three jobs at once, on purpose:
it blocks acting on a superior, on a peer, and on yourself (your own rank
is never strictly below itself). That last case is why **an organization
can never be left with zero OWNERs** — nothing outranks OWNER, so no
request can remove the last one. There is no separate "don't lock yourself
out" special case to forget; it falls out of the rank rule. The self case
is still checked explicitly first, but only to return an accurate message.

Rank is kept deliberately separate from `SYSTEM_ROLE_PERMISSIONS`:
permissions say which actions exist, rank says who may be on the receiving
end of one. Collapsing them would mean re-deriving authority from a
permission set, which is exactly the "raw role-string check" the Phase 1
RBAC decision rejected.

### Decision 3 — the admin sets an initial password; no invite-token flow

There is no email delivery anywhere in this system, so an invite-token
flow would mint a token with no way to deliver it. The creating admin sets
an initial password (same 8-character floor as signup). This is a real,
working path rather than a half-built one; a proper invite/reset flow is
future work, consistent with the Phase 1 boundary already recorded for
"no password reset."

**Accepted tradeoff:** `User.email` is globally unique rather than unique
per organization, so the duplicate-email check necessarily spans tenants
and an admin can learn that an address is registered *somewhere*. This is
pre-existing (the public signup endpoint has the identical property) and
the message is deliberately the same one signup returns. Changing it would
mean a schema change to per-organization email uniqueness — a Database-owned
decision with real consequences for login, which resolves users by email
alone. Not made unilaterally here.

### Decision 4 — `User` added to the tenant-scoping extension

`scoped-prisma.ts` scoped `Property` and `Room` only; `User` was unscoped,
because until now nothing served user rows to a client. The documented way
to add a tenant-scoped model is to register it there, so that's what was
done rather than hand-filtering `organizationId` in the new repository —
a hand-written filter is exactly what that extension exists to make
impossible to forget.

The three org-column blocks (`Property`, `User`) now share one
`scopeByOrganizationColumn()` factory instead of being copy-pasted.
Branch-review finding #4 was precisely a drifted copy of that block (its
`upsert` branch missing in one of two places); one definition means a
model is either fully scoped or not registered at all, with no
partially-scoped state available to get wrong.

`Session`, `UserRoleAssignment` and `PropertyAccess` are deliberately
**not** registered. They can't be: the auth platform reads them before a
tenant context exists. They don't need to be either — staff management
only ever writes them for a `userId`/`propertyId` it has already resolved
through the scoped `user`/`property` entries, which is the same
enforcement shape `Room`'s create has always relied on.

### Decision 5 — no `DELETE /staff/:id`

Offboarding is `PATCH { isActive: false }`, routed through
`deactivateUser` so the account, its already-issued access token and every
refresh session die together. A hard delete would cascade sessions and
grants away and destroy the record of who did what. Reactivation
(`isActive: true`) is a plain write; only deactivation needs the composed
path.

### Decision 6 — role and access changes bump the revocation watermark

The access token embeds `permissions` and `grantedPropertyIds`. Without a
bump, a demotion or an access revocation would not take effect for up to
15 minutes — the user would keep operating on the authority they just
lost, which makes the revocation cosmetic. Both paths therefore call
`bumpTokensValidAfter`, the function Phase 1 built and left unwired. A
*promotion* costs the user one extra silent refresh; a *demotion* takes
effect on their very next request.

### Fix, surfaced by the above — millisecond precision for the watermark

Wiring the watermark to role/access changes exposed a latent defect in it.
`User.tokensValidAfter` is a millisecond timestamp; JWT's `iat` is whole
seconds. A token minted a fraction of a second *after* a bump truncated to
an `iat` that compared as earlier, so it was rejected even though it was
issued after the revocation. Previously harmless — the only caller was
deactivation, where the user is never coming back — and it was known:
`token-revocation.test.ts` carried a 1100ms sleep and a comment calling it
"documented, accepted imprecision." Once a role change has to leave the
user working, spurious rejection stops being acceptable.

`signAccessToken` now also records `iatMs` (millisecond issue time), and
`authenticate` compares that against the watermark. This removes the
ambiguity outright rather than trading a false rejection for a false
acceptance — the alternative fixes (truncating or rounding the watermark
to the second) each buy one error by taking on the other, and taking on
false *acceptance* in a revocation check would have been weakening the
security property to fix a usability bug.

Backwards compatible: a token minted by a previous deployment has no
`iatMs`, so the check falls back to `iat * 1000`, which can only reject
such a token too eagerly, never too late. The fallback self-clears within
one access-token lifetime after a deploy.

The 1100ms sleep is gone, replaced by three assertions: a token minted
after a bump is accepted with no wait; a token minted just *before* a bump
in the same second is still rejected (proving no false acceptance was
introduced); and a hand-signed `iatMs`-less token still fails closed.

**This touches token issuance and the revocation check — an area
`AGENTS.md` marks as requiring mandatory Security sign-off regardless of
diff size. Flagged for that review; not self-approved.**

### Decision 7 — `syncSystemRolePermissions` for existing organizations

`seedSystemRoles` runs once per organization, at creation. Adding
`staff:read`/`staff:manage` to the catalog would therefore have reached
only organizations created *after* the deploy — the same OWNER would have
different powers depending on the month they signed up, silently. The seed
script now also backfills missing role→permission mappings onto existing
organizations.

Deliberately **additive only**: it grants what's missing and never
revokes. A destructive reconcile could delete grants a future custom-role
builder had added to a role, which is not a call a seed step should make.

**Verified for real, not just typechecked** (`prisma/seed.ts` is outside
`tsconfig.typecheck.json`'s include list — the lesson from finding #7):
`npm run db:seed -w backend` backfilled 3295 mappings across the dev
database's accumulated organizations, and a second run reported zero,
confirming idempotency.

### Verification

`npm run typecheck && npm run lint && npm run build && npm run test` all
pass. Backend 78/78 across 9 files (was 47/47 across 8) — 25 new in
`staff.test.ts`, 4 new cross-organization cases in
`tenant-isolation.test.ts` per that suite's standing contract, and 2 new
watermark-precision cases. Frontend 19/19, untouched and unaffected.

Beyond the suite, the whole flow was exercised over real HTTP against the
built artifact (`node dist/index.js`) with the frontend's `Origin`:
signup → create property → create a MANAGER with a property grant →
that manager logging in and reading the granted property; then, as an
ADMIN who genuinely holds `staff:manage` so the permission guard passes
and only the rank rule stands in the way — creating an OWNER (403),
self-promoting to OWNER (403), creating a MANAGER below them (201), and
finally deactivation killing a live token (401) and re-login (401).

**Known limitation, unchanged from Phase 1:** the revocation cache is
per-process, so with more than one API process a revocation is enforced in
other processes only once their own cache entry expires (30s default).
Same shared-store caveat already recorded for the rate limiter.

**Not built, deliberately:** no staff UI (Frontend-owned, sequenced next
per `AGENTS.md`'s schema → API → UI split), no invite/password-reset flow,
no custom-role builder, no per-property role assignment.

---

## 2026-08-21 — Staff management UI: the app's first feature module

**Context.** The staff API shipped with no consumer. This is the UI half,
and it's also the first time the frontend has needed more structure than
"a page per screen" — so the shape chosen here is the one the next module
inherits.

### Decision 1 — `features/<name>/` as the module boundary

Everything staff-specific lives in `frontend/src/features/staff/`:
`types.ts` (the domain shapes), `api.ts` (data access), `permissions.ts`
(what to render), `StaffPage.tsx`, `StaffDialog.tsx`, `staff.css`. The
existing flat `pages/` directory stays as-is for the older screens rather
than being retrofitted — moving working code to prove a point is churn,
and the two conventions coexist without conflict.

The rule that makes it a boundary rather than a folder: **staff endpoints
are named in exactly one file.** No component builds a `/api/v1/staff/...`
path. If the contract changes, `features/staff/api.ts` changes and nothing
else has to.

`PropertyOption` (`{id, name}`) is defined inside the staff feature rather
than imported from a properties module. Staff management depends on the
*idea* of a property — enough to label a checkbox — not on how some other
feature models one. That keeps the two independent.

### Decision 2 — shared primitives in `components/`, deliberately domain-free

`Modal`, `ConfirmDialog`, `DataTable`, `Badge`. The test for whether these
belong in `components/` rather than in the feature: none of them mention
staff, and `DataTable` takes columns and rows and owns only its loading
placeholder, empty state and markup — no fetching, no sorting policy, no
domain columns. Filtering and loading stay with the feature that owns the
data, which is what keeps the table reusable by the next module instead of
by staff alone.

`DataTable` distinguishes `rows === null` (loading) from `[]` (loaded,
nothing to show), which is what stops an empty state flashing before the
first response lands.

No component library was added. What was actually needed was a focus trap
and an aria contract, not a design system — and the app has no component
library to be consistent with. `Modal` is labelled by its own title,
closes on Escape and backdrop click, moves focus in on open, wraps Tab at
both ends, and restores focus to the trigger on close.

### Decision 3 — session claims decoded from the access token, for rendering only

The UI needs to know who the user is and what they may do, to avoid
rendering buttons that only ever produce a 403. `AuthContext` previously
discarded the user entirely, and `POST /auth/refresh` returns only an
access token, so after a page reload there was no identity at all.

**No backend change was made to solve this**, and none was needed: the
access token already carries `sub`, `organizationId`, `permissions`,
`roleNames` and `grantedPropertyIds`. `auth/session.ts` decodes that
payload — **without verifying its signature**, which the browser has no
key for and which would prove nothing anyway, since anything running in
the page could skip it. Adding a `GET /auth/me` round-trip to re-fetch
data the client already holds would have been worse, and
`docs/agents/frontend.md` forbids the Frontend role from touching the API
regardless.

The contract is stated at the top of that file and repeated in
`features/staff/permissions.ts`: **these claims decide visibility, never
permission.** Every action is still sent to the server and its answer is
displayed honestly, 403s included. A live check confirmed the server
refuses an action the UI hides.

`lib/api.ts` gained an `onAccessTokenChange` subscription because it
silently refreshes on a 401 without going through `AuthContext`. Without
it, a staff member whose role changed mid-session would keep the old
permissions in the UI until a full reload.

### Decision 4 — the rank rules are mirrored client-side, and why that's acceptable

`features/staff/permissions.ts` re-implements `ROLE_RANK` and the two
rules from `backend/src/modules/staff/service.ts`. Duplicating server
logic in a client is normally a mistake; the exception is deciding what to
*render*, and there is no way to know which rows can't be acted on without
knowing the rule.

Three things keep it honest: it lives in one small file rather than spread
through components, so drift has a single place to be found; it returns
*why* an action is unavailable (`'self'` / `'outranked'`) so the UI can say
"Your account" or "Restricted" instead of silently omitting a control; and
if it ever drifts, the consequence is a button that shouldn't have been
there — never an action that shouldn't have been allowed.

### Decision 5 — edit sends only what changed

Role and property access are two different endpoints (`PATCH` and `PUT`),
and both bump the member's token-revocation watermark server-side. Sending
an unchanged role would therefore interrupt that person's session for no
reason. `StaffDialog` diffs against the loaded member and calls only the
endpoints whose values actually moved; if nothing changed it just closes.

Email and password are create-only fields, because the API supports
changing neither. The dialog says so ("Share it with them directly — there
is no invite email yet") rather than offering a control that does nothing.

### Decision 6 — filtering is client-side, and that's a real limitation

Search and the role/status filters run over the already-loaded list,
because `GET /api/v1/staff` takes no query parameters and returns the
whole organization. Inventing `?search=` would have meant coding against a
contract that doesn't exist. This is correct at current scale and will
need a backend task (query params + pagination) before an organization
with hundreds of staff.

### Verification

`npm run typecheck && npm run lint && npm run build && npm run test` all
pass. Frontend 42/42 across 7 files (was 19/19 across 6 — 23 new tests
covering loading/empty/error states, search and each filter, permission
gating for three different role levels, the deactivate confirm-and-cancel
flows, create validation, the exact create/edit request bodies, role-picker
narrowing, a server-rejected create, read-only mode, and Escape-to-close
with focus restoration). Backend re-run unaffected at 78/78.

Because those tests mock `fetch`, they cannot prove the frontend and
backend agree. A separate live contract check against the running backend
issued every request `features/staff/api.ts` actually makes, with the
exact bodies `StaffDialog` builds, and asserted every field the frontend's
`StaffMember` interface declares — 92 checks, all passing. It also
confirmed no `passwordHash`/`tokensValidAfter` ever reaches the client,
that 400s carry the `{path, message}` issues the dialog maps to fields,
and that a token without `staff:manage` is refused with 403 on the very
action the UI hides from it.

**Not done, deliberately:** `PropertiesPage`/`RoomsPage` were left on
native `confirm()` and their existing markup — they work, and migrating
them is a separate task now queued in TASKS.md. No AI-agent integration
points were added; the module boundary is the preparation for that, and
building more would have been speculation.

---

## 2026-08-21 — Paginated list contract, established on staff

**Context.** `GET /staff` returned every row in the organization and the
UI filtered in the browser. That works at demo scale and fails quietly at
real scale — and by the time it fails, the response shape is already
public and every other module has copied it. This establishes the shape
now, on the one module that has a consumer, rather than retrofitting it
across five later.

### Decision 1 — every list endpoint is paginated, no opt-out

The alternative considered was "paginate only when `page` is supplied",
which would have been perfectly backwards compatible. Rejected: it leaves
the unbounded default in place, so the liability survives and only
disappears for callers who already knew to ask. A default `pageSize` of
25 with a hard `MAX_PAGE_SIZE` of 100 means no request can ever ask the
database for everything.

A `pageSize` over the ceiling is a **400, not a silent truncation** — a
client that receives 100 of 500 rows while believing it asked for all of
them is a bug that surfaces as missing data much later.

### Decision 2 — the shared half is only the page contract

`lib/pagination.ts` (both sides) owns `page`/`pageSize`, `toSkipTake`,
`buildPageMeta`, and the envelope. It deliberately does **not** own
filtering or sorting: those depend on columns only the module knows, and
a generic filter builder would either be too weak to use or so general it
becomes a query language. Each module extends `paginationQuerySchema`
with its own filters. That is the extension point future modules plug
into.

### Decision 3 — an out-of-range page returns empty, not clamped

Asking for page 9 of a 3-page result gets an empty page 9 with honest
metadata, not a silently-served page 3. Clamping would tell the client it
received what it asked for when it didn't; returning the truth lets the
client decide. `totalPages` is floored at 1 so a client never renders
"page 1 of 0".

### Decision 4 — count and rows in one transaction, ordering with a tiebreaker

The count and the page are read in a single `$transaction`, so the total
can't come from a different instant than the rows — otherwise a
concurrent signup produces a page that contradicts its own "of N" label.

Ordering is `createdAt asc, id asc`. `createdAt` alone is not unique, and
under a non-deterministic tiebreak two rows sharing a timestamp can
appear on two pages or on neither. A test walks every page and asserts
the union is exactly the full set, which is what makes that a guarantee
rather than an intention.

### Decision 5 — search requires every term to match

`"mary manager"` is split on whitespace and each term must match first
name, last name **or** email. A single OR over the raw string finds
nobody (the name spans two columns); an ANY-term match returns everyone
called Mary and everyone called Manager. Matching is `contains`,
case-insensitive — substring, not prefix, because searching a partial
surname is the more common need. One consequence worth knowing: `"mar"`
also matches `"Omar"`. That is correct for a contains-search and is
asserted explicitly, so it can't be mistaken for a bug later.

### Tenant isolation

`buildWhere` contains no mention of `organizationId`. The scoping
extension ANDs the tenant filter in, so a user-supplied filter can only
ever narrow *within* the caller's organization — it has no way to widen
it. The count goes through the same scoped client, so totals can't
disclose another tenant's size even with rows hidden. Both are tested:
another organization searching for a name it doesn't own gets zero rows
**and** a zero total.

### Frontend

Search is debounced at 300ms so a burst of keystrokes is one request;
filters and paging are not debounced, because they are discrete choices
and delaying them only feels laggy. Any filter change resets to page 1 —
staying on page 4 of a result set that now has one page would show an
empty table for a filter that actually matched. The table stays on screen
while refetching (`refreshing`) instead of collapsing to a loading
placeholder, which would make every keystroke flash the layout.

The new frontend tests assert **the request, not a filtered DOM**. A DOM
assertion would still pass if the page silently went back to filtering a
full local list, which is precisely the regression worth catching.

### Verification

typecheck / lint / build pass. Backend 91/91 (was 78), frontend 47/47
(was 42). A live run against the running backend made 40 assertions using
the exact query strings `frontend/src/lib/pagination.ts` builds — paging
across three pages with no row duplicated or dropped, multi-term search,
each filter, AND-combination, filtered totals, every validation boundary,
and the cross-tenant probe above.

**Deferred, and recorded in TASKS.md:** `GET /properties` and the rooms
list are still unbounded. The contract now exists, so converting them is
mechanical — but it changes the response shape for two endpoints with
live consumers, which deserves its own task rather than riding along
here.

---

## 2026-08-21 — Audit trail: one generic table, written from inside the services

**Context.** Nothing recorded who changed a role or deactivated an
account. For a platform sold to property-management businesses that is a
compliance question, not a nicety — and the staff module is exactly where
the consequential, hard-to-reverse actions live.

### Decision 1 — one generic `AuditLog`, not a per-module table

`entityType` + `entityId` name the target polymorphically, so properties,
units, leases, maintenance, payments and agent actions reuse the same
table. A `staff_audit_log` would have meant a new table, new indexes, new
queries and a new read endpoint per module, and no way to answer "what
happened in this organization today" without unioning all of them.

The cost of the generic shape is the lack of a foreign key on
`entityId` — the database cannot enforce that it points at a real row.
Accepted deliberately: a polymorphic FK isn't expressible in Postgres
without a column per target type, which is the per-module design again by
another name. `entityType` is validated against a catalog in application
code, and the trail is append-only evidence rather than an operational
join target.

### Decision 2 — `action` is a namespaced string, not a database enum

`"staff.role_changed"`, not an enum value. An enum would mean a migration
against an ever-growing table every time a module adds an event, which is
the kind of friction that ends with people not adding events. Type safety
is recovered in application code: `recordAuditEvent` only accepts the
`AuditAction` union from `platform/audit/actions.ts`, so nothing can
record an action that isn't in the catalog, and the read endpoint
validates the filter against the same list (an unknown action is a 400,
not an empty page that reads as "nothing happened").

The `<module>.<event>` convention keeps the namespace usable once many
modules share the table, and makes "everything from module X" a prefix
match.

### Decision 3 — `AuditActorType` exists now, with `AGENT` already in it

`USER | SYSTEM | AGENT`. Nothing writes `SYSTEM` or `AGENT` yet. It is
here because adding an enum value to a live audit table later is a
migration, and because it forces the question now rather than when the
first agent ships: an AI agent's actions must be attributable and
distinguishable from a human's. This is one column value, not
speculative machinery.

### Decision 4 — the recorder reads actor and tenant from request context

`recordAuditEvent` takes no actor or organization parameter. Both come
from `getRequestContext()`. A caller therefore cannot attribute an action
to someone else or file it under another tenant — it has no way to say
who it is, because the signed access token already decided.

This is also what makes the trail work for future AI agents with no extra
wiring: an agent invoking a service inside `runWithRequestContext(...)`
is audited under the identity and tenant it was given, and has no opt-out.
The corollary is the rule that matters going forward — **agents must go
through services, never Prisma directly**, or they leave no trace.

### Decision 5 — audit writes join the caller's transaction

`recordAuditEvent(event, tx)` takes an optional client, the same
convention as `platform/rbac/provisioning.ts`. Inside the staff service's
existing transactions the entry commits or rolls back with the change it
describes: no entry for a change that didn't happen, no change without an
entry. Proven by the duplicate-email test, where the rejected create
leaves no orphan entry behind.

Failures are not swallowed. Inside a transaction that means an audit
failure rolls the action back — the intended posture, since an
unrecorded privileged action is a worse outcome than a failed one.

**One deliberate exception.** `deactivateUser` composes several writes
plus a cache eviction outside this service's transaction, so its audit
entry is written *after* it succeeds. Recording first would risk an entry
for a deactivation that then failed, and a trail that lies is worse than
one with a gap. **Residual risk:** a process crash between the
deactivation and its audit write leaves an unrecorded deactivation. Not
closed here — closing it means moving `deactivateUser` inside the
transaction, which is a change to the revocation path and belongs in a
task where that path is under review.

### Decision 6 — metadata is redacted centrally, not carefully

`REDACTED_KEYS` strips `password`, `passwordHash`, `token`, `secret` and
friends inside the recorder. Call sites already avoid passing them, but a
future service that spreads an input object into `metadata` should
produce a redacted entry rather than a leak. Typed as
`Record<string, Prisma.InputJsonValue>` so unserializable values fail at
compile time instead of at the database.

### Decision 7 — read-only API, `audit:read` for OWNER/ADMIN only

`GET /api/v1/audit-logs`, reusing the pagination contract, newest-first
(an audit trail is read backwards, unlike the chronological list
endpoints). No POST, PATCH or DELETE: an endpoint that let a client
author entries would let it fabricate history, and one that let it delete
them would let it erase history. Tested by asserting those verbs 404.

MANAGER and STAFF are excluded on purpose — the trail records
administrative actions taken *on* those roles, so it is not appropriate
reading for them. The exclusion is commented in `permissions.ts` so it
isn't later "fixed" as an oversight.

### Tenant isolation

`AuditLog` is registered in the tenant-scoping extension, and
`buildWhere` never mentions `organizationId`. Reads, counts and filters
are all scoped by the extension, so a filter can only narrow within the
caller's organization. Verified live: a second organization filtering by
the first's real `entityId` gets zero rows **and** a zero total.

### Frontend — deliberately deferred

No UI. The write path is complete and the read API is documented and
tested, but where an audit view belongs (a per-staff-member timeline, a
global activity log, or both) is a product-design question, and the
dashboard/product-design pass is explicitly scheduled after the core
domain modules are stable. Building a screen now would mean designing
that surface twice. The contract is fixed and recorded in TASKS.md so the
UI task is presentation work only.

### Verification

typecheck / lint / build pass. Backend 115/115 (was 91 — 24 new), frontend
47/47 unchanged. The migration was generated and applied with
`prisma migrate dev` against a real PostgreSQL 16.15 (`postgres:16-alpine`),
not a WASM stand-in. `npm run db:seed` backfilled `audit:read` onto 2856
role-permission mappings for existing organizations — the mechanism added
in the previous task, doing its job for its first new permission key.

A live run against the running server made 38 assertions: a full staff
lifecycle producing all six event types in order, entry shape and actor
attribution, no credential in any form reaching the trail, filters,
403/401 for the wrong roles, POST/DELETE returning 404, cross-tenant
probing by real entity ID returning nothing, and a refused action leaving
the trail unchanged.

**Finding, not fixed here:** an unmatched route returns Express's default
**HTML** 404 rather than the app's `{ error: { code, message } }` shape.
Pre-existing (there is no catch-all handler in `app.ts`) and unrelated to
this task, so it is recorded in TASKS.md rather than fixed in an audit
commit.

---

## 2026-08-21 — Properties/Rooms hardened onto the shared foundations

**Context.** Properties and Rooms predated the pagination contract, the
audit table and the shared UI primitives. This slice brings them onto all
three. Choosing an existing module over a new domain was the point: if any
of those three foundations needed adjusting, finding out on code that
already works is far cheaper than discovering it three modules deep.

### Decision 1 — the PropertyAccess filter moves into the query

`listProperties` fetched every property the tenant owned and then filtered
by the caller's grants in application code. Correct while the endpoint
returned everything; **silently wrong the moment it paginated** — the
database slices a page first, then the filter removes rows from that page,
so a MANAGER granted one of four properties gets a page of 25 containing
one row and a `totalItems` of 4. Both errors point the wrong way: a short
page looks like missing data, and the count discloses how many properties
exist that the caller may not see.

The grant is now a `where` condition, so the count runs against the same
restriction as the rows. Two tests pin it: the total must equal the grant,
not the organization.

This is worth remembering as a general rule for this codebase — **any
authorization filter applied after a query is a latent pagination bug**.

### Decision 2 — rooms sort by name, properties by creation

Rooms sort `name asc`; "101, 102, 201" is how a property is walked. That
ordering existed before but was invisible in an unbounded list, and
pagination makes ordering a user-facing decision rather than an
implementation detail. Both carry an `id` tiebreaker so rows can't
straddle pages.

### Decision 3 — update audits diff the persisted rows

`property.updated` and `room.updated` compare the row before and after
rather than recording the request body. Re-submitting a field with the
value it already had is not a change, and an audit trail that says
otherwise trains people to ignore it. Verified by a test that resubmits an
unchanged `city` alongside a changed `name` and asserts only `name`
appears.

The diff type is JSON scalars, not `unknown`, so an unserializable value
fails at compile time rather than at the database.

### Decision 4 — property deletion records the cascade count, not N room events

Deleting a property cascades its rooms. Emitting a `room.deleted` entry
per room would bury the action that actually happened under its
consequences — someone reading the trail wants "who deleted Mountain
Lodge", not fifteen room entries they have to correlate. The
`property.deleted` entry carries `cascadedRooms` instead. Asserted both
ways: the count is right, and no `room.deleted` is emitted.

### Decision 5 — audit writes stay post-hoc for these modules

Properties and rooms mutate through `scopedPrisma` in their repositories
and are not wrapped in a transaction, and the audit recorder needs the
unscoped client. Rather than restructure two working repositories, the
entry is written after the mutation succeeds — the same ordering already
accepted for staff deactivation, and the same tradeoff: the trail can have
a gap after a crash, but can never claim something happened that didn't.

**Superseded 2026-08-21** — see "Audit writes made transactional" below.
All three now commit the mutation and its audit entry together.

### Decision 6 — `features/properties/` and `features/rooms/` as siblings

Rooms are reached through a property, but they are a distinct entity with
their own endpoints and their own future (housekeeping, turnover status).
Nesting them inside the properties feature would have made the eventual
split a refactor. `RoomsPage` importing `getProperty` from the properties
feature is a deliberate, one-way dependency: rooms need to name their
parent, properties know nothing about rooms.

### Two pre-existing bugs found while migrating

**Shared CSS held by accident.** `.page-error`, `.page-success` and
`.empty-state` were defined only in `pages/resource-pages.css`, imported
only by the two pages this task replaces — while `DataTable`, `StaffPage`,
`StaffDialog` and `DashboardPage` all used them. They rendered correctly
purely because Vite bundles all imported CSS globally and those two pages
were always in the graph. Deleting the old pages would have broken the
staff UI with no test catching it. Moved to `components/ui.css`, next to
the primitives that reference them.

**`Pagination` singularized naively.** `itemLabel.replace(/s$/, '')`
turned "properties" into "1 propertie". Now an optional explicit singular
with a rule that handles the regular cases; staff passes "person" for the
irregular one. Caught by writing the assertion and disbelieving the
output.

### Verification

typecheck / lint / build pass; `prisma migrate status` reports no drift
(no schema change in this slice). Backend 141/141 (was 115), frontend
79/79 (was 47 — 4 tests removed with the page they covered, 36 added).

Live run against the running server, 41 assertions: paging with no row
dropped or duplicated, multi-term search, every filter, validation
boundaries, audit entries with real diffs for both modules, the cascade
count on delete, the manager-with-one-grant paging case, and cross-tenant
probes returning zero rows and zero totals for properties, rooms and the
audit trail.

**Deferred:** no bulk operations; no dedicated property detail route (the
dialog carries the full record, and a route is a product-design question
for the dashboard pass); no room-level cascade entries, per decision 4.


---

## 2026-08-21 — Audit writes made transactional across all three services

**Context.** Three services wrote their audit entry *after* the mutation
(staff deactivation, properties, rooms), because their write paths use
`scopedPrisma` and the recorder was typed for the unscoped client. The
trail could therefore lose an entry to a crash. This closes that.

### The blocker was a type, not an architecture

The recorder took `PrismaClient | Prisma.TransactionClient`. A client
extension rewrites the generated delegate signatures, so the scoped
client is a *different* type — neither `Pick<PrismaClient, …>` nor a
union accepts both. Solved by declaring `AuditDb` **structurally**: an
interface naming only the two calls the recorder makes
(`user.findFirst`, `auditLog.create`). Base client, base transaction,
scoped client and scoped transaction all satisfy it, so every caller can
pass whatever transaction it is already inside.

`findUnique` also became `findFirst` for the actor lookup, so the same
code works whether or not the extension is injecting `organizationId`
into the where-clause.

### Verified, not assumed: the extension propagates into `$transaction`

The whole fix rests on the tenancy extension still applying inside a
transaction opened from `scopedPrisma`. Confirmed against the real
database (a scoped `property.count()` inside a transaction returned 1 for
a fresh organization while the unscoped count was 785) and then **pinned
by a regression test** in `test/audit-transactional.test.ts`, covering
both a read and a write. This is the highest-consequence silent
assumption in the codebase: if a Prisma upgrade changed it, every
transactional mutation would go cross-tenant with no other test failing.

### What each service now does

- **Properties, Rooms** — `scopedPrisma.$transaction`; repositories take
  an optional client (`PropertiesDb`/`RoomsDb`, a `Pick` of the models
  they touch) so the write joins the caller's transaction while keeping
  tenancy injected.
- **Staff** — base `prisma.$transaction`, deliberately: these paths write
  `user`, `session`, `userRoleAssignment` and `propertyAccess`, and
  `assignSystemRole` is typed for the base transaction client. Tenancy is
  not weakened, because every one of them resolves its target through a
  *scoped* read (`requireStaff`, `assertPropertiesInOrganization`) before
  the transaction opens, and `organizationId` always comes from the
  signed token.
- **`deactivateUser`** now accepts a transaction client, so the user
  update, the session revocation and the audit entry are one atomic act.
  Its cache eviction stays outside the transaction on purpose — an
  in-memory eviction cannot be rolled back, and doing it inside a
  transaction that later aborts would leave the process enforcing a
  revocation that never committed. Evicting after the writes means a
  rolled-back deactivation leaves at worst a cold cache entry.

### A doc correction

An earlier note in `scoped-prisma.ts` claimed Prisma *rejects* a
non-unique field in a `findUnique` where-clause. Probing showed it does
not. The note was wrong and is corrected; `findFirst` remains the
convention because it states the intent and works uniformly.

### Verification

typecheck / lint / build pass; `prisma migrate diff` reports no
difference between the schema file and the live database. Backend
**150/150** (was 141 — 9 new), frontend 79/79 unchanged.

The new tests prove rollback where it matters rather than asserting
structure: with the audit write forced to fail, a property create leaves
no property, an update leaves the original values, a delete leaves the
row in place, a room create leaves no room, and — the case this fix
exists for — a staff deactivation leaves the account active, its sessions
unrevoked, `tokensValidAfter` null, and the person still able to sign in.

A separate live run made 28 assertions confirming the trail still records
the right actor, tenant, action, target, timestamp and before/after
state, including that the actor on a staff role change is the ADMIN who
acted rather than the target, that a resubmitted unchanged field produces
no diff entry, that no credential appears anywhere, and that a second
organization sees nothing.


---

## 2026-08-21 — Role/property-access changes bump the token watermark inside the transaction

**Context.** A focused trace of the role and property-access mutation
flows, looking for anything escaping the transaction boundary.

**What was already safe.** Both authorization reads (`requireStaff`,
`assertPropertiesInOrganization`) run on the tenant-scoped client. They
sit *outside* the transaction, which would be a TOCTOU concern if a row
could change tenant between check and write — verified it cannot:
`organizationId` is not an accepted input on any schema and is never
updated anywhere in the codebase. No change made.

**What was not.** `bumpTokensValidAfter` ran *after* the transaction on
both paths. It is the mutation that actually removes the old authority —
the access token embeds `permissions` and `grantedPropertyIds` — so a
transaction that committed while the bump then failed would leave the
change persisted **and audited** while the user kept the permissions they
had just lost, for up to an access-token lifetime, with the trail saying
otherwise.

**Fix.** `bumpTokensValidAfter` takes an optional client, reusing the
exact pattern `deactivateUser` already had; both call sites moved inside
their existing transactions. No second transaction architecture, no
change to the base-vs-scoped choice (staff writes `user`, `session` and
`userRoleAssignment`, and `assignSystemRole` is typed for the base
transaction client), no contract change. Cache eviction stays outside the
transaction — an in-memory eviction cannot be rolled back, so a
rolled-back change leaves at worst a cold cache entry that re-reads the
unchanged row.

**Verification.** Backend 155/155 (was 150). The load-bearing new test
forces the transaction to fail and asserts `tokensValidAfter` stays null
with the role assignment intact: if the bump is ever moved back out, that
user would carry a watermark — and a needlessly killed session — for a
change that never happened, and this test fails. Cross-tenant attempts
still 404 with role, grants and watermark all untouched, and the
pre-existing demotion-invalidates-token and stale-grant tests pass
unchanged.

## 2026-08-21 — JSON 404 for unmatched routes

**The bug.** `app.ts` had no catch-all, so any path no router matched fell
through to Express's default handler and came back as an HTML error page —
the one response in the API that a JSON client couldn't parse.

**Fix.** One path-less middleware, after every router and before
`errorHandler`, calling `next(new NotFoundError('The requested endpoint
does not exist.'))`. Deliberately *not* a `res.status(404).json(...)`
inline: `lib/http-errors.ts` already documents that route code throws
typed errors and the centralized handler owns the shape, so responding
here would have created a second place that formats an error body. No new
error class, no new middleware file, no change to any existing route.

**What was left alone, on purpose.** Under `/api/v1` the staff, audit and
properties routers each mount `authenticate` path-lessly, so an anonymous
request to an unknown API path is answered 401 by whichever of them runs
first and never reaches the catch-all. Scoping those `use()` calls to
their own prefixes would touch four route files to change the status code
an unauthenticated caller sees on a typo — out of proportion to the fix,
and the current behavior is defensible on its own terms: the response is
already correct JSON, and not telling an unauthenticated caller which
endpoints exist is the safer default. Authenticated callers — the ones
who'd actually be debugging a typo'd URL — get the 404. Noted here so the
next person meets it as a decision, not a surprise.

**Verification.** Backend 175/175 (was 173). The two new tests live in
`test/health.test.ts`, the existing app-wiring test file: one anonymous
request to a path outside `/api/v1`, one authenticated request to an
unknown `/api/v1` path — the second is the one that would have been
silently satisfied by the 401 above if written without a token. Live-
checked against the built server (`node dist/index.js`): `/helth`,
`/api/v1/does-not-exist` and `/api/v1/staff/typo/oops` all return
`{"error":{"code":"not_found",...}}` with `content-type:
application/json`, while `/health` and `/api/v1/organizations/me` still
return 200. typecheck, lint and build pass for both workspaces.

---

## 2026-08-21 — Security sign-off: staff-management slice

Required by `AGENTS.md`'s mandatory-sign-off list: the slice changes
session/token issuance and revocation (`signAccessToken`'s `iatMs`,
`bumpTokensValidAfter`, `deactivateUser`) and writes to the
permission/property-access models. `TASKS.md` had carried "Awaiting
Security sign-off before merge" since 2026-08-20; this entry closes it.

**Scope reviewed.** The whole slice as it stands on
`feat/staff-management`, not one commit: `modules/staff/**`,
`platform/audit/**`, `platform/auth/revocation.ts`,
`platform/rbac/{guard,permissions,provisioning}.ts`,
`platform/tenancy/**`, the audit and staff route surfaces, and
`frontend/src/features/staff/permissions.ts`.

**Method.** Source review, then an independent live probe against the
built artifact (`node dist/index.js`) and the real database — 50
assertions, deliberately written from the outside over real HTTP rather
than by calling services directly, so the guards, request context and
tenancy extension are all genuinely in the path. The probe is not
committed; it duplicates coverage the standing suites already own
(`authorization.test.ts`, `staff.test.ts`, `tenant-isolation.test.ts`,
`audit.test.ts`), and its value here was being written independently of
them.

**Findings: no must-fix issues.** What was confirmed:

- *Authentication.* All six staff/audit routes reject an anonymous
  request with 401 and a JSON body; a forged bearer token is also 401.
- *Authorization is permission-based end to end.* STAFF cannot read or
  create staff; MANAGER can read but cannot create, PATCH, set property
  access, or read the audit trail. The alternate routes (`PATCH
  /staff/:id`, `PUT /staff/:id/property-access`) are guarded
  independently, so there is no verb that reaches a mutation without
  `staff:manage`.
- *Rank rules hold above the permission guard.* An ADMIN cannot create an
  OWNER, promote anyone to OWNER, modify a peer ADMIN, or deactivate
  themselves. The self case is what keeps an organization from ever
  reaching zero OWNERs.
- *Tenant isolation.* Org B gets 404 on GET/PATCH/property-access for org
  A's staff, sees only its own rows with a total of 1, and gets zero rows
  *and a zero total* when searching for org A's email. Granting org B's
  property to org A's staff is a 404, not a 403 — existence stays
  undisclosed across the boundary. Audit reads are isolated the same way,
  including a probe by org A's real `entityId`.
- *Deactivation is immediate and complete.* A deactivated member's access
  token dies on the next request (watermark, not expiry), their refresh
  session is revoked, and login is refused.
- *Audit trail.* Entries exist for creation and deactivation; no
  `passwordHash`, no plaintext password, no `$argon2` string, no token
  field appears anywhere in the audit API's output. A refused escalation
  leaves the entry count unchanged — no entry for an action that did not
  happen.
- *No tenancy bypass.* Every repository imports `scopedPrisma`; the base
  client appears only in three services, each for a documented
  pre-tenancy or post-scoped-read reason (`auth` login, `organizations`
  signup, `staff` writes whose `organizationId` comes from the token and
  whose target was already resolved through a scoped read).
- *No frontend-only authorization.* `features/staff/permissions.ts`
  decides visibility only, and the probe reached the API with no UI at
  all — every refusal above came from the server.

**Accepted risks, recorded rather than fixed** (none blocking):

1. An anonymous request to an *unknown* `/api/v1` path returns 401, not
   404, because `staffRouter`/`auditRouter`/`propertiesRouter` mount
   `authenticate` path-lessly at the v1 root. Measured against a HEAD
   build to confirm it is pre-existing and not introduced by the 404
   catch-all. Correct JSON either way; withholding endpoint existence
   from anonymous callers is defensible, and the path-less mount is
   fail-safe (a new route in those files cannot accidentally skip auth).
   Changing it would touch three route files in a mandatory-review area
   to improve a status code.
2. `recordAuditEvent`'s redaction is shallow — top-level keys only. No
   current call site nests a credential, and the metadata shapes are
   small and explicit, but a future call site spreading a nested object
   would not be caught.
3. A single `PATCH` carrying both a rename and `isActive: false` runs as
   two transactions (the rename/role transaction, then the deactivation
   transaction). Each is internally atomic with its own audit entry; a
   crash between them could leave the rename applied and the
   deactivation not. Rare shape, and it fails in the safe direction.
4. The audit route's cross-organization case lives in `audit.test.ts`
   rather than the standing `tenant-isolation.test.ts` suite. Covered
   either way, but `CLAUDE.md` names the latter as the standing home.

**Verification at sign-off.** Backend 175/175 across 12 files, frontend
99/99 across 9 files, typecheck/lint/build pass for both workspaces, plus
the 50-assertion live probe above.

---

## 2026-08-21 — RoomType: a per-property catalogue, introduced additively

**The problem.** `Room.roomType` was a free-text column. Nothing could
reference a room type, "Deluxe King" and "deluxe king" were different
categories, and every later domain in the roadmap — rate plans,
availability, reservations — needs to attach to a type that has an
identity. Hotel PMS products model this as a first-class entity for
exactly that reason.

### Decision 1 — scoped to the Property, not the Organization

Two hotels in the same group name and price their rooms independently; a
shared organization-level catalogue would force one property's rename
onto the other, and there is no product requirement for a group-wide
catalogue today. `RoomType` therefore carries `property_id` and no
`organization_id`, reaching its tenant transitively exactly as `Room`
does. Registered in `platform/tenancy/scoped-prisma.ts` through the
property relation.

### Decision 2 — additive migration, legacy column retained

`Room.roomType` is load-bearing right now: `createRoomSchema` /
`updateRoomSchema` accept it, the rooms repository searches on it, the
rooms service writes it into audit metadata, and five frontend files
render it. Replacing the column in this slice would have meant editing
the API, the UI and their tests in a migration task — three ownership
boundaries at once, and a destructive migration.

So `room_type` stays exactly as it is and `room_type_id` arrives beside
it, nullable, backfilled. Nothing outside `prisma/` had to change for the
data model to move forward. The column is dropped and the FK made NOT
NULL in task 2d, after 2b and 2c have moved every reader onto the
relation — the one destructive step, isolated and last.

The transitional cost is a `Room` carrying two representations of the
same fact, with the free text as the source of truth. That is the honest
trade for a non-destructive rollout, and it is written into the schema
comments so nobody has to infer which one wins.

### Decision 3 — exact-match backfill, no normalization

The backfill creates one type per distinct `(property_id, room_type)`
pair and matches rooms on the exact string. Case-insensitive or
whitespace-trimmed matching was considered and rejected: it would change
nothing on this database (checked first — 900 distinct pairs, zero
differing only by case or surrounding whitespace, zero null or blank
labels) while silently merging two genuinely distinct labels on some
future one. A migration that quietly merges data is the kind of thing
nobody notices until it matters.

### Decision 4 — deliberately thin

No occupancy fields. `Room.capacity` already exists, and a second copy on
`RoomType` with no code to reconcile them is a source-of-truth conflict
waiting to be discovered. No rate, no availability, no bed configuration
— those are their own slices, and guessing their shape now would bake in
assumptions before the requirement exists. `code` is included but
nullable because the backfill has only the legacy label to work from and
must not invent one; it is uniquely constrained per property when
present.

`Room.room_type_id` is `onDelete: SetNull`, the second deliberate
non-cascade in the schema after `AuditLog.actor_user_id`: a room is
physical and outlives a catalogue decision. The label survives in
`room_type` either way.

### A boundary crossing, flagged

This was a Database-owned task, but `platform/tenancy/scoped-prisma.ts`
(Backend-owned) was edited to register the new model. Leaving a
tenant-scoped model unregistered is a latent isolation gap — CLAUDE.md
names registration as part of adding such a model — so it was done rather
than deferred. The edit also extracted the existing inline `room` block
into `scopeByPropertyRelation()` and reused it, instead of pasting a
second copy: the file's own comment records that branch-review finding #4
was a drifted copy of a scoping block. `room`'s behaviour is unchanged.

**Verification.** Applied with `prisma migrate dev` against real
PostgreSQL 16.15 (`postgres:16-alpine`). Existing data proven intact
rather than assumed: an md5 fingerprint over `id:room_type` for all 1069
rooms is identical before and after, 900 types created from 900 distinct
pairs, all 1069 rooms linked, zero label-or-property mismatches. Backend
180/180 across 13 files (5 new in `test/room-types.test.ts`), frontend
99/99 unchanged, typecheck/lint/build pass, `prisma migrate status`
clean. The scoping tests are verified by deletion: unregistering
`roomType` makes three of them fail.

---

## 2026-08-22 — RoomType API: new permissions, and a delete that refuses

The CRUD half of Phase 2's RoomType work, in a new `modules/room-types/`
built on the rooms module's shape. Split from the original task 2b, whose
second half (teaching the rooms API `roomTypeId`) is now 2c: keeping them
apart meant this slice touched no existing module beyond mounting a
router and extending two catalogs.

### Decision 1 — `room-types:*` rather than reusing `rooms:*`

Reusing the existing keys would have been the smaller diff and the wrong
call. STAFF holds `rooms:update` so the front desk can put 204 into
maintenance — a correct grant. But room types are what rate plans,
availability and reservations will all reference, and renaming or
retiring one is a revenue-management act, not a front-desk one. Reusing
`rooms:update` would have handed that to every STAFF member in the
organization.

So: `room-types:read` (STAFF and up — a room's type is front-desk
information) and `room-types:manage` (MANAGER and up). The cost is two new
permission keys and a seed backfill, which is the documented pattern
(`syncSystemRolePermissions`, run for real here — 44450 mappings).

This is the same reasoning that put `staff:manage` above `staff:read`
rather than folding both into one key: a permission should name an
authority someone might plausibly hold *without* the others.

### Decision 2 — deleting a type in use is refused, not cascaded

`Room.roomTypeId` is `onDelete: SetNull`, so the database would happily
delete a type and quietly un-type every room that used it. That is a
silent data loss a PMS must not do, and it is almost never what the
caller meant: "we don't sell this any more" is a retirement, not a
detach.

`DELETE` therefore 409s while `roomCount > 0`, naming the count and
pointing at `isActive: false`. Retiring keeps every existing room's
classification and history intact while removing the type from future
use. Deletion stays available for a type nothing references — a
mistyped entry created a minute ago should not need a tombstone.

The alternative, cascading the null and auditing it, was rejected for the
reason the property-delete entry already records: an action whose blast
radius isn't visible from the request is the wrong default, even audited.

### Decision 3 — codes are upper-cased at the schema boundary

`code` is uniquely constrained per property, and "dlxk" versus "DLXK" is
the same code to anyone reading a rooming list while being two rows to
Postgres. Normalizing in the Zod schema — rather than in the service or
with a case-insensitive index — means every path in and out of the module
sees one canonical form, and the constraint means what it appears to
mean. Verified: creating "DLXK" then "dlxk" is a 409.

### Decision 4 — `roomCount` on the read model

The list and get responses carry `roomCount` from a Prisma `_count`, in
the same query rather than an N+1 per row. It is what makes the delete
rule legible in a UI before the user tries it, and "how many rooms are
this type" is the first question anyone asks of a catalogue entry.

**Verification.** Backend 192/192 across 14 files (12 new: 10 in
`test/room-types-api.test.ts`, 2 cross-organization cases added to the
standing `tenant-isolation.test.ts` per its own charter). Frontend 99/99
unchanged — no frontend file was touched. typecheck/lint/build pass. An
18-assertion live probe against the built server confirmed the behaviour
on the real artifact, including that all four cross-tenant verbs 404 and
that the row is untouched afterwards.

---

## 2026-08-22 — Rooms ↔ RoomType: validation, label derivation, and a corrected test

Task 2c. The rooms API now accepts `roomTypeId`; the free-text `roomType`
keeps working unchanged.

### Decision 1 — the link is validated against the room's own property

`resolveRoomTypeName` reads the type through the *scoped* client with an
explicit `propertyId` filter, inside the caller's transaction. That single
read carries both guarantees: another organization's type is invisible
because the scoping extension reaches RoomType through its property, and
another property's type in the same organization is excluded by the
filter. Both produce the same 404, so a caller learns only that this
property has no such type — the rule the rest of the API follows.

Doing it inside the transaction rather than before it means the type
cannot be deleted between the check and the write.

### Decision 2 — supplying a type fills in the legacy label

`roomType` is still what the rooms list searches and what the audit trail
records. A client that sends only `roomTypeId` would otherwise leave that
column frozen at whatever it said before, and a stale searchable label is
a real bug rather than a cosmetic one. So the service derives it from the
type's name. An explicitly supplied label wins — the caller said what
they meant.

### Decision 3 — a corrected test, and why it is not a weakened one

`room-types.test.ts` asserted, across the whole table, that every linked
room's `roomType` equals its type's name. That failed as soon as this
slice landed, and the failure was correct: the equality was true of the
backfill's output, not a rule of the system.

The alternative was to *make* it a rule — reject a free-text `roomType`
update on a linked room. That was rejected because the backfill linked
**every** existing room, so the rule would break exactly the legacy
clients this transition exists to protect. Backward compatibility is the
whole point of keeping the column.

So the assertion was split rather than deleted. The permanent half — a
room's type must belong to the room's own property — is kept as its own
test and is now the whole-table backstop for the guarantee Decision 1
enforces per request. Label derivation moved to `rooms-room-types.test.ts`
where it is tested against the API that owns the behaviour. The test file
records this inline so the next reader meets it as a decision.

### Decision 4 — the catalogue is a convenience, never a gate

`RoomDialog` renders a picker when the property has types and the original
free-text input when it has none *or when the request fails*. A room must
stay creatable when the catalogue does not come back — a front desk
adding a room at 2am should not be blocked by an unrelated endpoint. A
room linked to a retired type still shows that type rather than silently
resetting to "Other", which would turn opening a dialog into an
accidental edit.

**Verification.** Backend 206/206 across 15 files (14 new), frontend
106/106 across 10 files (7 new; the existing 99 pass unchanged, which is
the backward-compatibility claim). typecheck/lint/build pass. A
16-assertion live probe against the built server confirmed the happy
path, the legacy path, cross-property and cross-tenant rejection with
nothing persisted, the clear-link path, malformed input, the anonymous
401, and that the `roomTypeId` change reaches the audit diff.

## 2026-08-24 — Room-type management screens: retirement over deletion, and a diffed PATCH

**Context.** Task 2d. `features/room-types/` held only the one read
`RoomDialog` needed; the catalogue had a full API and no way for a manager
to reach it. Frontend-only — no file under `backend/` was touched.

### Decision 1 — active/retired is not a field in the dialog

The API accepts `isActive` on create and update, so putting a checkbox in
the form would have been the shorter diff. It is instead an explicit
`Retire` / `Restore` action in the list, with a confirmation that names
how many rooms already carry the type and states that they keep it.

Retiring a type is not the same kind of act as renaming one: it changes
what the property can sell. Offering it as a checkbox among text fields is
how someone retires a catalogue entry they only meant to rename, and a
form has no natural place to explain the consequence to the rooms already
classified under it. One state change, one deliberate control.

### Decision 2 — `Delete` is not offered for a type that rooms use

The service refuses a hard delete while `roomCount > 0` and says to retire
instead. The row could still show a Delete button and surface that 409,
but a control whose only possible outcome is an error is worse than no
control — it teaches the user that the app guesses. So Delete appears only
at `roomCount === 0`, and `Retire` is what a used type offers.

The 409 is still handled. The count on screen can be stale by the time
the button is clicked, and in that case the server's message — which
already names the count and the retirement path — is shown verbatim
rather than paraphrased.

### Decision 3 — the edit PATCH sends a diff, not the form

Three things fall out of the API's own contract. `updateRoomTypeSchema`
requires at least one field, so submitting an untouched form would be a
400; the server upper-cases `code`, so retyping "dlxk" over "DLXK" is not
an edit and sending it as one would record a phantom audit entry; and
`code`/`description` are `.optional()`, **not** `.nullable()`, so `null`
is rejected and a cleared field cannot currently be sent at all.

So the dialog diffs the form against the loaded row, compares `code`
case-insensitively, disables Save when nothing changed, and — when a
previously-set optional field has been blanked — says so inline instead
of sending a payload the server would reject.

**This is a real API gap, deliberately not worked around.** There is no
way to remove a code or a description once set. Making those fields
`.nullable()` is a backend change, outside this task's ownership scope
per `AGENTS.md`, so it is reported rather than reached across. Until then
the UI states the limit honestly rather than silently discarding the
user's edit.

### Decision 4 — `textarea` joined the shared field primitives

A description runs to 1000 characters and is the app's first multi-line
input. `components/ui.css` styled `.field input` and `.field select` only,
so the rule was extended there rather than duplicated in
`room-types.css`: a form control is a shared primitive, and the next
module with a notes field should not have to rediscover it. Constrained to
`resize: vertical`, because a horizontally resizable textarea breaks the
field grid it sits in.

### Decision 5 — a route-wiring test, because the page suites cannot catch that

Every feature suite mounts its page under a route the test declares
itself, which passes whether or not the route exists in `AppRouter`. New
`src/AppRouter.test.tsx` covers what those cannot: that the path is
registered, and that it sits *inside* the authenticated shell — an
anonymous visit lands on the login screen, not the catalogue.

**Verification.** Frontend 132/132 across 12 files, up from 106/10 — 26
new (22 for the page and dialog, 2 for the route, 1 each for the
cross-links added to Properties and Rooms); the pre-existing 106 pass
unchanged. Backend 206/206 untouched, as no backend file was modified.
typecheck, lint and build pass, with the one pre-existing `AuthContext`
fast-refresh warning. **No live probe:** the Docker socket is not
reachable in this sandbox, the same constraint recorded for task 1a, so
this slice is verified by suite and by reading the API contract in
`backend/src/modules/room-types/` — not against a running server.

One real defect was found by these tests rather than in review: the
delete-conflict path set the error banner and then called `load()`, whose
success handler clears it, so a 409 rendered as nothing at all. The
reload now runs first and the message is set after it.

## 2026-09-02 — Clearing a room type's code/description, and why 2e is still blocked

Two board items were picked up this session: the Backend follow-up under
task 2d, and task 2e. The first shipped; the second is deliberately *not*
started, because its own stated precondition is unmet. Both decisions are
recorded here.

### Decision 1 — `code` and `description` become clearable via `null`

2d surfaced that `updateRoomTypeSchema` made both fields `.optional()`
only, so `null` was rejected and there was no way to remove a code or a
description once set — write-once fields the UI had to apologise for. The
DB columns were already nullable (`String?` in `schema.prisma`, unchanged
since 2a), so this was purely the validation half.

`updateRoomTypeSchema` now `.extend()`s `code` and `description` to
`.nullable()` before `.partial()`, so three states are distinguishable
and each means what a caller expects: key omitted → leave unchanged; a
value → set it; `null` → clear it. `create` is untouched — there is
nothing to clear on a new row, so its fields stay `.optional()` only. The
existing diff/audit path already treated a value→null transition as a real
change, so a clear is audited as `{ from: 'CLR', to: null }` with no extra
code. `assertNameAndCodeFree`'s input type widened to `code?: string |
null`; its `if (input.code)` guard already skips a null (falsy) code, which
is correct — a cleared code can't collide with anything.

**Scope discipline.** This touched only `modules/room-types/` and its test
— no rooms, properties, tenancy or audit file was modified, matching the
Backend follow-up's narrow ownership.

**Verification — against real PostgreSQL, not a stand-in.** Unlike 2d
(authored where Docker was unreachable), this session had a live
PostgreSQL 16 on `localhost:5432` with all five migrations already applied
(`prisma migrate status` clean). Backend 207/207 across 15 files, up from
206 — one new test asserting a create-then-clear round-trip: the PATCH
returns null for both fields, a re-read confirms it persisted (not just
echoed), the audit entry records both value→null transitions, and an
omitted key left `name` untouched. typecheck, lint and build all pass.
Frontend re-verified unaffected at 132/132 (no frontend file changed; the
UI already sends the values and can now stop stating the limit — a
follow-up UI polish, not required for correctness).

### Decision 2 — task 2e (drop legacy `Room.roomType`) is NOT started: precondition unmet

2e's board text gates it explicitly: *"Only after 2c and 2d ship and no
code reads it… make `roomTypeId` NOT NULL."* Both halves of that gate are
objectively false today, so running the migration now would be wrong on
two independent grounds — this was checked empirically, not assumed:

1. **Code still reads and writes the legacy column.** The rooms list
   search filters on `roomType` (`rooms/repository.ts` `buildWhere`), both
   room audit entries record it (`rooms/service.ts` create/delete
   metadata), the room diff tracks it, and the entire label-derivation
   layer (`resolveRoomTypeName` / `resolveCreateInput` /
   `resolveUpdateInput`) exists precisely to keep that column in step with
   the relation. Dropping the column is a Backend slice — strip those
   reads, move search onto the relation, decide what audit records instead
   — not a one-file migration.

2. **The data isn't ready for NOT NULL.** A direct count against the live
   DB: 455 of 1,573 rooms have `roomTypeId = NULL` (rooms created via
   free-text `roomType` with no link). `SET NOT NULL` would fail on those
   455 rows. 2e therefore also needs a backfill/reassignment step that
   doesn't exist yet, and a product decision for rooms whose free-text
   type never matched a catalogue entry.

2e is the one destructive, irreversible step in the RoomType sequence
(column drop + NOT NULL). With its precondition unmet, forcing it would be
both premature and unsafe, so it stays `[ ]` with the real blockers named
above and is re-scoped from "run a migration" to its true shape: a Backend
migration-off-legacy-column slice → data backfill → then the destructive
DDL, each sequenced and approved on its own. Recorded here so the next
session doesn't rediscover the 455-row wall the hard way.

## 2026-09-02 — Rooms become catalogue-only (task 2e, executed)

The follow-on to the entry above: the blocked 2e was picked up, researched,
implemented, and its destructive step applied with human approval.

### Decision 1 — catalogue-only, because that is what a PMS is

Benchmarked the leading products before choosing. Stayntouch's own setup
docs, and the Mews/Cloudbeds model, are unanimous: a room is assigned a
room type from a managed catalogue (a dropdown), and rates, availability
and channel-manager distribution all map 1:1 to that type. Free-text room
category does not exist in a serious PMS — it's a foundation crack that
makes rate plans and availability impossible to attach. So the free-text
`Room.roomType` was not just dropped; the model was completed to
catalogue-only, and `roomTypeId` was made **required**. The human approved
this product direction (Plan A of four) before any code was written.

### Decision 2 — the 501-orphan reality, and a deterministic backfill

The working database had 1625 rooms, 501 with `roomTypeId = NULL` — rooms
created through the legacy free-text path (mostly by the integration suite,
which itself used that path). Their labels did *not* match existing types
(491/501, 414 distinct pairs), because creating a room never created a
catalogue entry. The backfill is deterministic and invents nothing: for
each `(property, label)` pair with unlinked rooms and no matching type, it
creates the type, then links the rooms. Casing is preserved — "Suite" and
"suite" stay distinct, matching the `@@unique([property_id, name])` rule.

### Decision 3 — expand→contract, so the irreversible step stands alone

Two migrations, not one. `20260902000100_rooms_backfill_types` is safe and
non-destructive (backfill + link + relax the old NOT NULL); it was applied
and verified first (501 → 0 orphans) against the real Postgres. Only then,
as a separate migration and with explicit human go/no-go,
`20260902000200_rooms_catalogue_only` did the irreversible work:
`roomTypeId` SET NOT NULL, FK switched `SET NULL` → `RESTRICT`, and
`DROP COLUMN room_type`. Splitting them means the destructive DDL is
isolated, ordered last, and the safe half is provable in production before
the point of no return — the pattern any future destructive migration in
this project should copy.

### Decision 4 — FK is RESTRICT, and the response embeds the type

The old FK was `SET NULL` (a room could lose its type). With `roomTypeId`
now required, that is incoherent, so the FK is `ON DELETE RESTRICT`: the
database now *enforces* the rule the room-types service already returned a
409 for (can't delete a type still assigned to rooms) — defence in depth,
not either/or. Retiring the type (`is_active = false`) stays the intended
path. The rooms API response now returns `roomType: { id, name, code }`
embedded rather than a free-text string: it's the shape rates/availability
will consume, and a type rename reflects on every room with no second
write. Audit records the type id *and* its name at the time, so a later
rename doesn't rewrite history.

### Decision 5 — UI blocks room creation when no types exist

`RoomDialog` no longer has a free-text escape hatch. If a property has no
active room types, create is blocked with an empty state linking to the
catalogue ("add at least one room type first"), rather than presenting a
form that can't be submitted — the same setup order (types before rooms)
that Stayntouch and Mews enforce. Editing an existing room always has at
least that room's own type to show, including a retired one, so a room
never silently loses its type when the dialog opens.

**Verification.** Every step ran against the real PostgreSQL 16 on
localhost:5432 (not a WASM stand-in). Backend 208/208 across 15 files;
frontend 131/131; typecheck/lint/build green both workspaces;
`prisma migrate status` clean. The rooms and rooms↔room-types suites were
rewritten for the catalogue-only contract; rooms-creating tests in
properties, authorization, tenant-isolation and audit-transactional were
updated to seed a type first; new standing assertions cover whole-table
FK integrity, zero untyped rooms, and that the legacy column is gone
(scoped to `current_schema()` — the shadow database keeps its own copy).

**One gotcha worth recording.** An unscoped `information_schema.columns`
query counts Prisma's `public_shadow` (migration-diff) schema as well as
`public`, so a "column no longer exists" assertion must filter on
`table_schema = current_schema()` or it reports a false positive.
Likewise, the regenerated client rejects `where: { roomTypeId: null }` at
runtime now that the field is non-null — a whole-table null check has to
drop to raw SQL.


## 2026-09-04 — Booking core Slice A: Rate Plans + Rates

**Context.** Start of the booking core (Phase 2, approved Option B: rates →
reservations → availability, targeting the first real booking). Slice A is
the pricing layer everything downstream quotes from.

**Model.** `RatePlan` (per RoomType) + `RatePlanRate` (per plan, per date).
Benchmarked against Mews/Cloudbeds/Stayntouch: a room type's price is not one
number but a set of *plans* (BAR, Non-Refundable, Advance Purchase), each with
its own per-date price and cancellation policy. Chose per-date rate rows over
a rules engine — an arbitrary seasonal/weekend/demand calendar is
representable directly, and a rules engine is a later optimization, not a
foundation. `isRefundable` is the one policy bit modelled now; deadlines and
penalties are deferred.

**Money.** INR minor units (paise) as `amount_minor Int` — money is never a
float, and INR-only per the initial-release decision means no currency column.

**Scoping.** RatePlan reaches its tenant through `roomType → property`,
RatePlanRate one deeper through `ratePlan → roomType → property`. Two new
relation-scoping helpers in `scoped-prisma.ts` (`scopeByRoomTypeRelation`,
`scopeByRatePlanRelation`), same pattern as the existing property-relation
helper. Verified by the tenant-isolation suite: every verb on another org's
plan (list/get/update/delete/read-rates/set-rates) 404s, not 403 — the parent
property is invisible, so its existence is never disclosed.

**Permissions.** New `rate-plans:read` (STAFF+) and `rate-plans:manage`
(MANAGER+), deliberately not folded into `rooms:*` or `room-types:*`:
repricing the hotel is revenue work, not front-desk work. A front-desk agent
reads a rate to quote it. `db:seed` backfilled the mappings onto existing orgs.

**Bulk rates.** `PUT .../rates` sets/clears many dates in one transaction
(`amountMinor: null` clears a date). Audited as a single `rate_plan.rates_set`
event over the range, not one entry per night — a month's repricing is one
action a manager took, mirroring the room-cascade audit reasoning.

**Verified.** Migration `20260904103803_rate_plans` applied to real
PostgreSQL 16 (`prisma migrate status` clean). Backend 219/219 (was 208 — 11
new: 9 in `rate-plans.test.ts` covering CRUD, bulk rate set/clear/read, window
validation, audit, STAFF read-but-not-manage; 2 cross-org cases in
`tenant-isolation.test.ts`). typecheck/lint/build green. Frontend follows in
the same slice.

## Check-in / check-out + room assignment (2026-09-07)

**Context.** A booking held a room *type* but never a physical room —
`Reservation.roomId` was nullable from the create-slice, which explicitly
deferred assignment as "a check-in-slice concern". This is that slice: the
front desk's daily arrival→departure flow.

**No schema change.** `roomId` already existed (nullable, `onDelete: SetNull`).
The work was three POST actions (`assign-room`, `check-in`, `check-out`), one
read (`assignable-rooms`), and three audit actions — no migration.

**Assignability rules.** A room may hold a booking only if it (1) exists at the
property, (2) is of the booking's own room type — you can't put a Deluxe
booking in a Standard room, (3) is ACTIVE — an INACTIVE/MAINTENANCE room isn't
sellable capacity, and (4) is free for the whole stay: no other *occupying*
reservation (CONFIRMED/CHECKED_IN/CHECKED_OUT with a room assigned) overlaps
the half-open [checkIn, checkOut) window. A cross-property or cross-tenant room
id resolves to nothing through the scoped client and 404s, same "no such thing
here" signal every scoped sub-resource gives. Each other failure is a specific
409 naming the reason.

**Concurrency.** `assignRoom` and `checkIn` run Serializable, same as booking
creation, so two clerks can't hand the same physical room to two overlapping
stays — one commits, the other fails to serialize. The availability check and
the write commit as one.

**Lifecycle guards.** Only CONFIRMED can check in (and a room is required —
already assigned, or supplied inline and assigned in the same transaction, the
standard front-desk flow). Only CHECKED_IN can check out. Assignment is allowed
while the booking still holds inventory (CONFIRMED or CHECKED_IN). Check-out
keeps the room on the record as history rather than nulling it — "where did
they stay" is a real question — and the stay simply leaves the occupying set
for future dates because it's over.

**Picker UX.** `GET .../assignable-rooms` returns every ACTIVE room of the
type flagged `available` for the dates, not just the free ones. The UI shows
the whole floor with occupied rooms visible-but-disabled, so a clerk sees *why*
a room is unavailable rather than a silently short list. The booking's own
current room is always shown selectable to itself.

**Verified** against real PostgreSQL 16 (`prisma migrate status` clean).
Backend 246/246 (was 240 — 6 new in `reservations.test.ts`: assign happy-path
with availability flags, wrong-type/occupied/404 rejections, full
check-in→check-out lifecycle, no-room-on-check-in 400, released-room reuse with
the four-entry audit trail in order, and auth gating). Frontend 153/153 (was
150 — 3 new: lifecycle-correct action buttons per status, check-in through the
room picker asserting the exact POST body, and an occupied room rendered
non-selectable). typecheck/lint/build green both workspaces. `ConfirmDialog`
gained an optional `children` slot (non-breaking) so the check-out and
cancel-reason flows reuse it rather than duplicating the dialog.

## Availability calendar (2026-09-07)

**Context.** With the booking core and check-in/out done, the next screen a
front desk lives in is the availability calendar — "what's free, when" across
room types. Benchmarked Cloudbeds and Mews: both centre daily operations on a
room-type × date grid with per-night free/booked counts and an occupancy
figure. This is that view.

**Read-only, computed — no new state.** No schema, no migration, no audit, and
deliberately **no new permission**: viewing availability is front-desk read
work, so it reuses `reservations:read` rather than minting an `availability:*`
pair nobody would hold independently. The grid is derived, not stored.

**Contract locked before implementation, then built in parallel.** The
orchestrator fixed the request/response contract up front
(`GET /properties/:id/availability?from&to`, half-open window, ≤62 nights, the
exact `{ dates, roomTypes[].days[], totals.days[] }` shape) and dispatched two
isolated agents against it — one for `backend/src/modules/availability/`, one
for `frontend/src/features/availability/`. Their file scopes were disjoint
except for two shared wiring files (`AppRouter.tsx`, `PropertiesPage.tsx`),
which integrated without conflict. Because both built to the same frozen shape,
the frontend's mocked types matched the backend's real output field-for-field
on first integration — no rework.

**Computation.** `booked` for a room type on a night = occupying reservations
(CONFIRMED/CHECKED_IN/CHECKED_OUT) whose stay covers it (`checkIn <= night AND
checkOut > night`, the same half-open rule as the stay). `totalRooms` = ACTIVE
rooms of the type (out-of-service rooms aren't sellable capacity).
`available = max(0, totalRooms - booked)`. `occupancyPct = round(booked /
totalRooms * 100)`, 0 when there are no rooms. The whole grid is built in one
bounded query batch (type list + grouped room counts + overlapping stays), not
a query per cell — it has to stay fast for a 62-night span across many types.

**Verified end-to-end, not just by the agents' self-reports.** typecheck/lint/
build green both workspaces; backend 252/252, frontend 158/158. Beyond that, a
live probe against the *built* server on real PostgreSQL 16 exercised the real
path: 3 rooms, 2 overlapping 3-night bookings → available 1 / 67% occupancy on
the booked nights and 3 / 0% on the shoulder nights, with `checkOut` correctly
excluded (the departure night reads free). The `to<=from` 400, the >62-night
400, and the anonymous 401 were confirmed against the running server too.


## Housekeeping (2026-09-07)

The daily-operations module: room cleaning conditions + a cleaning-task board.
Benchmarked against Cloudbeds, Mews and Stayntouch first.

### Decision 1 — cleanliness is a SEPARATE axis from inventory status

Every commercial PMS models a room's housekeeping condition (dirty → cleaning
→ clean → inspected) as **distinct** from its inventory/service status. A
dirty room is still bookable; only "out of service" removes it from sellable
inventory. So rather than overloading `Room.status` (ACTIVE/INACTIVE/
MAINTENANCE), housekeeping got its own `Room.housekeeping_status` enum
(DIRTY/CLEANING/CLEAN/INSPECTED). The two never interfere: availability and
overbooking math still read `status` only; the housekeeping board reads
`housekeeping_status`. Default is INSPECTED — a freshly created room has not
been slept in, so it's ready to sell with no backfill on migration day.

### Decision 2 — tasks reach tenancy through room, and survive assignee loss

`HousekeepingTask` has no `organization_id`; it's scoped through
`room → property → organization_id`, via a new `scopeByRoomRelation()` helper
matching the existing relation-scoping pattern. `assigned_to_id` is FK → users
with `SET NULL` (not cascade): deactivating a housekeeper must not delete the
history of work they did — the task survives as an unassigned record. Task
lifecycle is PENDING → IN_PROGRESS → DONE (or CANCELLED); a terminal task is
locked to editing except to reopen it, and DONE stamps/clears `completed_at`.

### Decision 3 — check-out marks the room dirty and opens a departure task

The one cross-module hook: checking a guest out (reservations service) now
also — if a physical room was assigned — flips that room to DIRTY and opens a
DEPARTURE task, in the **same transaction** as the status change, with audit
entries for both. This is standard PMS behaviour and is what feeds the board
its daily turnover work. A checkout with no assigned room does nothing extra.

### Decision 4 — permissions at the front-line level

New `housekeeping:read` / `housekeeping:manage`, held by MANAGER **and** STAFF
(running the cleaning board is core daily ops, like taking a booking or
settling a folio), plus OWNER/ADMIN via the full spread. Seed re-run
backfilled the mappings onto existing organizations.

**Verified end-to-end.** typecheck/lint/build green both workspaces; backend
271/271 (+10), frontend 168/168 (+5), migrate status clean on real
PostgreSQL 16. A live probe against the built server exercised the full path:
fresh room INSPECTED/vacant → condition transitions → invalid-condition 400 →
task create/start/complete → terminal-edit 409 → cross-property-room 404 →
check-out auto-marking the room DIRTY and creating a PENDING DEPARTURE task →
cross-tenant board/condition/tasks all 404 → no `passwordHash` in any payload.

### Known documentation debt found en route (not introduced here)

`DATABASE_SCHEMA.md` was already missing the `Reservation`, `ReservationNight`,
`Folio`, `FolioCharge` and `Payment` entities and their migrations — the
reservations and folios slices updated the schema file's Room/enum tables but
not its entity list or migration log. This housekeeping entry added the Room
`housekeeping_status` column, the `HousekeepingTask` entity, and the
`20260907115046_housekeeping` migration; the pre-existing reservations/folios
gaps are flagged here for a Documentation-role pass rather than silently
back-filled by this slice.




## Maintenance work orders (2026-09-07)

The engineering side of daily operations, benchmarked against Cloudbeds, Mews
and the hotel-CMMS category first.

### Decision 1 — a work order can take a room out of service; a housekeeping task never does

The defining difference from housekeeping: a maintenance issue can make a room
unsellable. Rather than a new inventory flag, a work order with
`takeRoomOutOfService` flips the existing `Room.status` to MAINTENANCE — the
same axis availability/overbooking already excludes (countSellableRooms only
counts ACTIVE rooms), so OOS rooms drop out of inventory with zero new wiring.
`takesRoomOutOfService` is stored on the order so resolving it can return the
room to ACTIVE. Housekeeping condition stays completely independent.

### Decision 2 — return-to-service is guarded against multiple holds

Resolving/cancelling an order that held its room out returns the room to
ACTIVE only if no OTHER open order still holds it out (checked in-transaction).
Two burst pipes on the same room: resolving the first leaves it out; resolving
the second returns it. Prevents a premature return that re-sells a room still
under active repair. Reopening a resolved order does NOT auto-re-block the room
(an explicit decision — reopening is for record correction, not re-blocking).

### Decision 3 — roomId is optional; tenancy is the direct property relation

Not all maintenance is room-scoped (lobby lights, pool pumps, lifts), so
`roomId` is nullable and a property-level order is first-class. WorkOrder
carries `propertyId` directly and reuses the existing `scopeByPropertyRelation`
tenancy helper — no new scoping code. room and assignee FKs are SET NULL so an
order survives a room or staff deletion as history.

### Decision 4 — permissions and audit

New `maintenance:read` / `maintenance:manage` (MANAGER+STAFF, like
housekeeping — logging an issue is front-line work). Audit distinguishes the
inventory-affecting transitions (`room.out_of_service` /
`room.returned_to_service`) from plain `work_order.updated`, so the trail shows
exactly when a room left and re-entered sellable inventory and why.

**Verified end-to-end.** typecheck/lint/build green both workspaces; backend
282/282 (+11), frontend 172/172 (+4), migrate status clean on real
PostgreSQL 16. A live probe against the built server exercised the full path:
lifecycle open/start/resolve, property-level order with no room, 400 on
takeRoomOutOfService-without-room, room OUT on open + BACK on resolve, the
multiple-hold guard (room stays out until the last holding order resolves),
terminal-edit 409, cross-property-room 404, cross-tenant 404, no passwordHash
leak.

## DATABASE_SCHEMA.md backfill (2026-09-07)

Cleared the documentation debt flagged by the housekeeping and maintenance
entries above. `DATABASE_SCHEMA.md` had drifted behind the schema: the
reservations and folios slices updated its Room/enum tables but never added
their own entities or migrations. Backfilled, docs-only (no schema or code
touched), now 1:1 with `schema.prisma` (22 models = 22 documented entities):

- Added the six missing entity tables: `Guest`, `Reservation`,
  `ReservationNight`, `Folio`, `FolioCharge`, `Payment`.
- Added the two missing migration log entries: `20260904113021_reservations`
  and `20260907044128_folios_payments`.
- Refreshed the stale `## Scope` section (it still described bookings/payments
  as "future modules") and the `## Relationships` diagram (booking chain,
  folio 1:1, housekeeping/maintenance assignee SET-NULL, the Reservation
  RESTRICT FKs).

Verified by a count check: `grep -c "^model " schema.prisma` == `grep -c
"^### " DATABASE_SCHEMA.md` == 22, and every migration directory now appears
in the migration log. No verification gate run — this touches no code, tests
or schema, only the human-readable mirror doc.
