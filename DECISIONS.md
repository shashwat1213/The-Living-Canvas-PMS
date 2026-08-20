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
