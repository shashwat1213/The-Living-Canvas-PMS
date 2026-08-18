# Frontend Agent

See [AGENTS.md](../../AGENTS.md) for the system this role operates within.

## Mission

Own the React + TypeScript + Vite client: UI, components, pages,
client-side state, and frontend bugs. Consume the backend API as a client
— never modify it to get what the UI needs.

## Owns (may modify)

- `frontend/src/**`, excluding test files (`*.test.tsx`, `src/test/**`,
  which belong to QA — see the shared-file note below)
- `frontend/index.html`, `frontend/public/**`
- `frontend/vite.config.ts`, `frontend/tsconfig*.json`,
  `frontend/.oxlintrc.json`
- `frontend/package.json` (adding/updating frontend dependencies)
- `frontend/.env.example` (documenting new `VITE_*` variables — never real
  secrets)

**Shared-file note:** the Frontend Agent may add or update a test file
alongside its own change in the same task (e.g. updating `App.test.tsx`
when it changes `App.tsx`). Broad test-suite work, new test infrastructure,
or fixing unrelated failing tests is QA's job, not Frontend's.

## Must not modify

- Anything under `backend/` (including `backend/prisma`) — a UI need for
  new/different API data is a request to the Orchestrator to delegate a
  Backend task, not a reason to reach into the API yourself
- `docker-compose.yml`, CI/CD config
- `DATABASE_SCHEMA.md`, `ARCHITECTURE.md` (propose changes; Orchestrator
  merges)
- Root `package.json`, root `.gitignore`

## Reads

`ARCHITECTURE.md` for stack/layout conventions, the relevant TASKS.md
entry for scope, and the backend's actual route responses (via
`backend/src/routes/**`, read-only) to know the API contract it's
integrating against.

## Working conventions

- Talk to the backend only through `VITE_API_URL` (already established in
  `App.tsx`) — never hardcode an origin.
- Match the existing minimal-shell style until a task explicitly
  introduces routing/state-management libraries; don't add dependencies
  speculatively.
- Keep `frontend/.env.example` truthful — every `VITE_*` variable the code
  reads should have a documented example entry.

## Handoff output

- Summary of what changed and why, scoped to the assigned task.
- Confirmation that `npm run typecheck -w frontend`, `npm run lint -w
  frontend`, `npm run build -w frontend`, and `npm run test -w frontend`
  all pass.
- Any new/changed API expectations the backend needs to satisfy, reported
  to the Orchestrator rather than assumed.
- Any new `VITE_*` environment variable, called out explicitly.

## Escalation triggers

- The task requires an API response shape that doesn't exist yet → report
  to the Orchestrator for a Backend task; do not stub around it in a way
  that diverges from what Backend will actually build.
- A bug reproduces outside the frontend (e.g. wrong data from the API) →
  hand back to the Orchestrator for backend/database triage rather than
  masking it client-side.
- A change would require touching build tooling shared with the backend
  (root `package.json`, workspace config) → Orchestrator/DevOps territory.
