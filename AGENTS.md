# Multi-Agent Development System — The Living Canvas PMS

This document defines the **controlled multi-agent system** used to
implement The Living Canvas PMS from here on. It is process/tooling
documentation, not product documentation — for what the product is, see
[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md); for how the codebase is built,
see [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

This system governs **how work gets done**, not **what gets built**. It
does not introduce a new tech stack, and it does not authorize any agent
to implement business features on its own initiative — feature work still
comes from [TASKS.md](TASKS.md).

## Why this exists

As more work happens through specialized agents, uncoordinated edits risk
two failure modes: an agent modifying files outside its domain (e.g. a
frontend change touching the Prisma schema), and two agents clobbering
each other's concurrent work. This document exists to prevent both by
fixing, in writing, who owns what and how work hands off.

## The eight roles

| # | Agent | Mission | Detail |
|---|-------|---------|--------|
| 1 | Orchestrator / Project Manager | Coordinates work, assigns tasks, never edits app code | [docs/agents/orchestrator.md](docs/agents/orchestrator.md) |
| 2 | Frontend | React + TypeScript + Vite UI | [docs/agents/frontend.md](docs/agents/frontend.md) |
| 3 | Backend | Node.js + Express + TypeScript APIs | [docs/agents/backend.md](docs/agents/backend.md) |
| 4 | Database | PostgreSQL + Prisma schema, migrations, data integrity | [docs/agents/database.md](docs/agents/database.md) |
| 5 | QA/Test | Unit/integration/E2E tests, bug repro, fix verification | [docs/agents/qa.md](docs/agents/qa.md) |
| 6 | Security | Reviews auth, validation, secrets, vulnerabilities | [docs/agents/security.md](docs/agents/security.md) |
| 7 | DevOps | Docker, env config, CI/CD, deployment config | [docs/agents/devops.md](docs/agents/devops.md) |
| 8 | Documentation | Keeps README/architecture docs accurate as the codebase grows | [docs/agents/documentation.md](docs/agents/documentation.md) |

Added 2026-08-19 (see [DECISIONS.md](DECISIONS.md)): the Documentation role
was folded in once feature work moved past the foundation stage, so doc
upkeep has an explicit owner rather than riding on whichever agent
touched a file last.

Each role file uses the same structure: **Mission**, **Owns** (may
modify), **Must not modify**, **Reads**, **Handoff output**, **Escalation
triggers**. Ownership is enforced by convention and by the Orchestrator's
delegation, not by filesystem permissions — every agent is technically
capable of editing any file, and is expected not to.

## Ownership map (quick reference)

| Path | Owner | Notes |
|------|-------|-------|
| `frontend/src/**` (excluding test files) | Frontend | components, pages, hooks, client state |
| `frontend/index.html`, `frontend/public/**` | Frontend | |
| `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/.oxlintrc.json`, `frontend/package.json` | Frontend | |
| `frontend/**/*.test.tsx`, `frontend/src/test/**`, `frontend/vitest.config.ts` | QA | Frontend may add tests alongside its own fix in the same task |
| `backend/src/**` (excluding `prisma/` and test files) | Backend | routes, services, middleware wiring, config |
| `backend/package.json`, `backend/tsconfig*.json`, `backend/eslint.config.js` | Backend | |
| `backend/test/**`, `backend/vitest.config.ts` | QA | Backend may add tests alongside its own fix in the same task |
| `backend/prisma/schema.prisma`, `backend/prisma/migrations/**` | Database | schema is the source of truth for data shape |
| `DATABASE_SCHEMA.md` | Database | must stay in sync with `schema.prisma` |
| `docker-compose.yml`, future `Dockerfile*`, future `.github/workflows/**`, deployment config | DevOps | |
| root `package.json` (workspaces/scripts), root `.gitignore` | DevOps proposes, Orchestrator approves | shared infra, affects every agent |
| `AGENTS.md`, `docs/agents/**`, `TASKS.md` | Orchestrator | this process documentation itself |
| `PROJECT_CONTEXT.md`, `ARCHITECTURE.md` | Orchestrator maintains | any agent may propose a change; Orchestrator merges to avoid conflicting edits |
| `DECISIONS.md` | Any agent appends an entry for its own decision; Orchestrator never edits another agent's entry | append-only log |
| `README.md`, module-level `README.md` files | Documentation | see [docs/agents/documentation.md](docs/agents/documentation.md); drafts content changes to `PROJECT_CONTEXT.md`/`ARCHITECTURE.md` for Orchestrator to merge, same as any agent |

Security has no directory ownership by default — see
[docs/agents/security.md](docs/agents/security.md) for its narrow,
flagged-only write exception.

Anything not listed here (i.e. any future path not yet covered) has no
implicit owner — the Orchestrator assigns it explicitly before work
starts, and updates this table.

## How agents communicate

There is no shared runtime mailbox between agents — communication is
**written artifacts**, so a human (or the Orchestrator) can always see
what happened without replaying a conversation:

1. **Task assignment** — the Orchestrator opens or updates an entry in
   [TASKS.md](TASKS.md) describing the task, its owning agent, and its
   file-scope boundary (copied from the ownership map above, narrowed if
   the task doesn't need the agent's full territory).
2. **Handoff report** — every agent ends its work with a short written
   report (in its final message to the Orchestrator, or in the task's
   entry in TASKS.md): what changed, why, what was verified, and any open
   questions. Role files specify what a complete report contains.
3. **Findings** — QA and Security report problems as structured findings
   (file, line, concrete failure scenario), not vague prose, so the
   receiving agent doesn't have to reverse-engineer the problem.
4. **Decisions** — any non-obvious technical choice gets one entry
   appended to [DECISIONS.md](DECISIONS.md) by the agent that made it.

Agents do not message each other directly mid-task. A Frontend Agent that
discovers it needs a backend change stops, reports the need to the
Orchestrator, and waits for the Orchestrator to delegate it to the Backend
Agent — it does not reach into `backend/` itself.

## How the Orchestrator delegates

1. Take the next task from [TASKS.md](TASKS.md) (or a bug from the flow
   below).
2. Identify the owning agent from the ownership map. If a task spans
   multiple owners (e.g. "add a room-status field" touches Database,
   Backend, and Frontend), split it into sequential sub-tasks in
   dependency order (schema → API → UI) rather than assigning one task to
   multiple agents at once.
3. State the task's file-scope boundary explicitly when delegating — the
   specific paths this task may touch, which may be narrower than the
   agent's full ownership.
4. Dispatch the agent (see **Isolation** below for how its work is
   sandboxed).
5. On handoff, check the report against the task's boundary: did it stay
   in scope? If an agent touched files outside its assigned boundary
   without flagging why, the Orchestrator rejects the change and sends it
   back rather than passing it downstream.
6. Route the result to whatever comes next in the bug/task flow (QA,
   Security, or straight to approval).

The Orchestrator itself never edits application code, tests, schema, or
deployment config. Its writable surface is `AGENTS.md`, `docs/agents/**`,
and `TASKS.md`, plus merging agent-proposed edits to
`PROJECT_CONTEXT.md`/`ARCHITECTURE.md` and appending its own delegation
decisions to `DECISIONS.md`.

## Isolation: git worktrees per agent

To prevent two agents' concurrent edits from clobbering each other, each
delegated task runs in its own **git worktree** — an isolated checkout
with its own working directory, so one agent's uncommitted changes are
physically invisible to another agent working at the same time. This
project's tooling supports this directly: dispatching an agent with
worktree isolation gives it a private copy of the repo on its own branch.

- **Branch naming:** `agent/<role>/<short-task-slug>`, e.g.
  `agent/backend/room-status-field`, `agent/qa/repro-room-capacity-bug`.
  Branch from `main` (or from the upstream task branch, for a chained
  sub-task like schema → API).
- **One branch, one task, one agent.** Do not reuse a branch across
  unrelated tasks, and do not let two agents share a branch.
- **No agent pushes to or commits on `main` directly.** `main` only
  advances through the approval process below.
- **Merging back:** once a task's changes are approved (see below), they
  are merged into `main`. Delete the task branch after merge; don't let
  stale `agent/*` branches accumulate.
- If a task is small and low-risk enough that spinning up a worktree is
  pure overhead (e.g. a one-line doc fix), the Orchestrator may skip
  isolation — but anything touching `backend/src`, `frontend/src`, or
  `backend/prisma` gets a worktree.

## Bug flow

1. **Report** — bug is described with enough detail to act on (what
   happened, what was expected, how to reproduce if known).
2. **Triage (Orchestrator)** — classify which layer the bug lives in
   (Frontend/Backend/Database/DevOps) and whether it's security-sensitive.
3. **Reproduce (QA)** — QA writes a failing test that captures the bug
   before anyone attempts a fix. No test, no confirmed bug — "I couldn't
   reproduce it" is a valid, and useful, QA outcome.
4. **Fix (owning agent)** — the agent that owns the affected files (per
   the ownership map) implements the fix. QA's failing test must now pass,
   and QA's test file is not modified by the fixing agent — if the test
   itself was wrong, that goes back to QA to correct.
5. **Verify (QA)** — QA re-runs the full relevant test suite (not just the
   one new test) to catch regressions, and confirms in its report.
6. **Security check (conditional)** — if the bug touched auth,
   authorization, input validation, or secret handling, Security reviews
   the fix before it proceeds. Skipped otherwise.
7. **Approval (human)** — see below. Nothing merges to `main` without it.

## Testing and verification rules

- Every task, regardless of owning agent, must leave the repo passing the
  root verification commands before handoff:
  `npm run typecheck && npm run lint && npm run build && npm run test`
  (see [README.md](README.md)). An agent reporting a task "done" without
  having run these is an incomplete handoff.
- An agent fixes failures in files it owns. A failure surfacing in a file
  outside its ownership (e.g. a backend change breaks a frontend type) is
  reported back to the Orchestrator for reassignment, not silently patched
  across the boundary.
- QA owns the test suite's overall health: new tests for new behavior,
  regression tests for fixed bugs, and — as the project grows — E2E
  coverage for cross-layer flows. Other agents may add narrow tests
  alongside their own change (a Backend Agent adding a unit test for the
  endpoint it just wrote) but broad test-suite work is QA's.
- Database migrations are verified per
  [docs/agents/database.md](docs/agents/database.md) — a migration isn't
  "done" until it's been applied to a real database, not just validated
  against the schema file.

## Approval process before committing

No agent commits or pushes on its own authority — this mirrors the
standing rule that Claude only commits or pushes when the human asks.
Before any task branch merges to `main`:

1. All verification commands above pass.
2. The change stayed within its assigned file-scope boundary (or any
   deviation was flagged and accepted by the Orchestrator).
3. QA has verified the fix/feature (bug flow) or the task's own tests pass
   (new work).
4. Security has signed off, if the change was in a security-sensitive
   area. Sign-off is **mandatory, regardless of diff size**, for: schema
   changes to `User`/session/permission/property-access models, any
   change to the tenant-scoping enforcement layer once it exists, any
   code path handling a payment-gateway or AI-provider credential, and
   any change to session/token issuance or revocation. A one-line diff in
   one of these areas still waits for Security — size is not a substitute
   for review here.
5. The Orchestrator presents a summary to the human: what changed, which
   agent(s) did it, what was verified, and any open follow-ups (mirroring
   the pattern already used for this project's foundational commit).
6. The human explicitly approves. Only then does the merge/commit happen.

A task with unresolved findings (QA regressions, open Security items) does
not reach step 5 — it goes back to the owning agent first.
