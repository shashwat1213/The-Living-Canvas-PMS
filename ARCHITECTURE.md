# Architecture — The Living Canvas PMS

## Stack

| Layer     | Choice                                   |
|-----------|-------------------------------------------|
| Frontend  | React 19 + TypeScript, Vite               |
| Backend   | Node.js + TypeScript, Express             |
| Database  | PostgreSQL, accessed via Prisma ORM       |
| Testing   | Vitest (both workspaces)                  |
| Linting   | oxlint (frontend), ESLint (backend)       |
| Monorepo  | npm workspaces                            |

See [DECISIONS.md](DECISIONS.md) for the reasoning behind each choice.

## Repository layout

```
The-Living-Canvas-PMS/
├── backend/                 Node/Express API
│   ├── prisma/
│   │   ├── schema.prisma    Source of truth for the DB schema
│   │   └── migrations/      Generated SQL migrations
│   ├── src/
│   │   ├── config/          Environment/config loading
│   │   ├── lib/             Shared infra (Prisma client singleton)
│   │   ├── routes/          Express route handlers
│   │   ├── app.ts           Express app factory (used by tests)
│   │   └── index.ts         Process entry point
│   └── test/                Vitest tests
├── frontend/                React/Vite SPA
│   └── src/
├── docker-compose.yml       Local PostgreSQL for development
├── package.json             Workspace root (scripts fan out to both apps)
└── *.md                     Project docs (this file and siblings)
```

## Backend

- **Express app factory** (`src/app.ts`) is separated from the process
  entry point (`src/index.ts`) so tests can exercise the app with
  supertest without binding a real port.
- **Prisma** is the single data-access layer. `src/lib/prisma.ts` exports
  one shared `PrismaClient` instance (reused across hot reloads in dev to
  avoid exhausting Postgres connections).
- **No authentication yet.** The `User` model has a nullable
  `passwordHash` field reserved for a future auth task; there is currently
  no login, session, or token handling.
- `GET /health` is the only route so far — used to verify the server is up
  and to let the frontend show live API connectivity.

## Frontend

- Plain Vite + React SPA, no router or state library yet — there's
  nothing to route to until the next feature task adds real screens.
- Talks to the backend only via `VITE_API_URL` (defaults to
  `http://localhost:4000`), never a hardcoded origin.

## Multi-tenancy model

Every domain row is scoped under `Organization` (directly, or transitively
through `Property`). There is no cross-organization data access — enforcing
that at the query layer is a concern for the task that adds real API
endpoints beyond `/health`.

## Local development

```bash
npm install                  # installs both workspaces
docker compose up -d         # starts local Postgres
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:migrate           # applies Prisma migrations
npm run dev:backend          # http://localhost:4000
npm run dev:frontend         # http://localhost:5173
```
