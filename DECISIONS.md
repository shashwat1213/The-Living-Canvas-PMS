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
