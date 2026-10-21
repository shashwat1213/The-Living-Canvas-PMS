import { PrismaClient } from '@prisma/client';

// Reuse a single PrismaClient instance across the app (and across hot
// reloads in dev) to avoid exhausting the database connection pool.
declare global {
  var __prisma: PrismaClient | undefined;
}

// Serverless + remote Postgres (Neon) adds per-query network latency, so the
// 5s default interactive-transaction timeout is too tight for multi-statement
// writes (e.g. bulk rate upserts + audit). Give transactions more headroom.
export const prisma =
  globalThis.__prisma ??
  new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 30_000 } });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
