# The Living Canvas PMS

Multi-property hospitality Property Management System.

- **Planning & architecture:** Claude Desktop (project context,
  requirements, decisions, task breakdown)
- **Implementation:** this repository

## Docs

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — what this project is and how
  planning/implementation are split
- [ARCHITECTURE.md](ARCHITECTURE.md) — stack, repo layout, local dev setup
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — data model
- [DECISIONS.md](DECISIONS.md) — technical decision log
- [TASKS.md](TASKS.md) — task breakdown and status

## Quick start

```bash
npm install
docker compose up -d
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:migrate

npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173
```

## Verify

```bash
npm run typecheck
npm run lint
npm run build
npm run test
```
