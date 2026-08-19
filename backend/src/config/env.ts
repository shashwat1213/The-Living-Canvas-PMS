import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';

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
    // real .env — never used outside NODE_ENV=test (see the throw above).
    jwtSecret: process.env.JWT_SECRET ?? 'test-only-jwt-secret-do-not-use-in-production',
    accessTokenTtlMinutes: Number(process.env.JWT_ACCESS_TOKEN_TTL_MINUTES ?? 15),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
};
