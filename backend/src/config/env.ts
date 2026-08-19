import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
// NODE_ENV=test alone is not trusted as "safe to skip required secrets" —
// a real deployment could end up with that value by misconfiguration
// (e.g. a copy-pasted staging config) and must still be forced to set
// its own JWT_SECRET rather than silently falling back to the hardcoded
// one below. Vitest additionally sets VITEST=true for the whole test
// process, which a real running server never has, so requiring both is
// what actually identifies "this is the test runner."
const isTest = nodeEnv === 'test' && process.env.VITEST === 'true';

// DATABASE_URL and JWT_SECRET are required outside of tests so
// misconfiguration fails fast at boot rather than on the first request.
if (!isTest && !process.env.DATABASE_URL) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}
if (!isTest && !process.env.JWT_SECRET) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  auth: {
    // Test-only fallback so `npm run test -w backend` doesn't require a
    // real .env — only reachable when isTest is true (see above), i.e.
    // only under the actual Vitest process, never a real deployment.
    jwtSecret: process.env.JWT_SECRET ?? 'test-only-jwt-secret-do-not-use-in-production',
    accessTokenTtlMinutes: Number(process.env.JWT_ACCESS_TOKEN_TTL_MINUTES ?? 15),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
};
