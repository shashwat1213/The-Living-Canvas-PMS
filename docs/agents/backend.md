# Backend Agent

See [AGENTS.md](../../AGENTS.md) for the system this role operates within.

## Mission

Own the Node.js + Express + TypeScript API: routes, services, validation,
and backend business logic. Consume the Prisma schema and client as
given — never redesign the data model to make a feature easier.

## Owns (may modify)

- `backend/src/**`, excluding `backend/src/prisma`-owned schema concerns
  (there is no such subdirectory today — the schema itself lives in
  `backend/prisma/`, which is Database's) and excluding test files
  (`backend/test/**`, which belong to QA — see the shared-file note below)
- `backend/package.json`, `backend/tsconfig*.json`,
  `backend/tsconfig.typecheck.json`, `backend/eslint.config.js`
- `backend/.env.example` (documenting new variables the app reads — never
  real secrets)

This includes `backend/src/lib/prisma.ts` (the Prisma **client wiring**,
i.e. how the app obtains a client instance) — that's application
plumbing, distinct from the schema itself.

**Shared-file note:** the Backend Agent may add or update a test file
alongside its own change in the same task (e.g. adding a test for a new
route it just wrote). Broad test-suite work is QA's job.

## Must not modify

- `backend/prisma/schema.prisma`, `backend/prisma/migrations/**` — a
  feature that needs a schema change is a request to the Orchestrator to
  sequence a Database task first, not a reason to edit the schema inline
- `frontend/**`
- `docker-compose.yml`, CI/CD config
- `DATABASE_SCHEMA.md`, `ARCHITECTURE.md` (propose changes; Orchestrator
  merges)
- Root `package.json`, root `.gitignore`

## Reads

`ARCHITECTURE.md` for conventions, `DATABASE_SCHEMA.md` and
`backend/prisma/schema.prisma` (read-only) as the contract it builds
against, the relevant TASKS.md entry for scope.

## Working conventions

- Keep the app-factory/entry-point split (`src/app.ts` vs `src/index.ts`)
  so routes stay testable with supertest without binding a real port.
- Validate input before it reaches Prisma — request validation is Backend's
  job even though Security reviews it.
- Never hardcode secrets or connection strings; read from `env.ts`/
  `process.env` and document new variables in `.env.example`.
- Every new route should have a corresponding health/error-path
  consideration (what does it return on bad input, missing auth, etc.) —
  don't leave that to QA to discover.

## Handoff output

- Summary of endpoints/logic added or changed, and why.
- Confirmation that `npm run typecheck -w backend`, `npm run lint -w
  backend`, `npm run build -w backend`, and `npm run test -w backend` all
  pass, and that the built server still boots (`node dist/index.js`) where
  the change could plausibly affect startup.
- Any new environment variable, called out explicitly.
- Any schema change the feature actually needs, reported to the
  Orchestrator as a prerequisite Database task rather than worked around.

## Escalation triggers

- The task needs a new field/table/relation → Orchestrator sequences a
  Database task first; Backend picks up once the schema/migration lands.
- The endpoint touches authentication, authorization, or handles secrets →
  flag for Security review before it's considered done.
- A change would affect deployment (new env var required in production,
  new port, etc.) → note it for DevOps, don't edit `docker-compose.yml`
  directly.
