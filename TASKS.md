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

## Next up (not started)

- [ ] **Staff authentication** — login, session/token handling, wire up
  `User.passwordHash`. Blocks any endpoint that needs to know who's
  calling it.
- [ ] **Organizations & properties CRUD API** — authenticated endpoints to
  create/read/update organizations, properties, and rooms, scoped to the
  caller's organization.
- [ ] **Admin UI shell** — authenticated frontend routes/layout for
  managing properties and rooms once the CRUD API exists.

Each of the above will be delegated per [AGENTS.md](AGENTS.md) once
started — expect them to appear as sequenced Database → Backend → Frontend
sub-tasks rather than one task per bullet.

## Explicitly out of scope for now

Bookings/reservations, OTA integrations, reviews, payments, marketing —
do not start these until a task here explicitly calls for them.
