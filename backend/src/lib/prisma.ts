import { PrismaClient } from '@prisma/client';

// Reuse a single PrismaClient instance across the app (and across hot
// reloads in dev) to avoid exhausting the database connection pool.
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
