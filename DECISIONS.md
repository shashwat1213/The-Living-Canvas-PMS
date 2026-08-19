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

