import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';

// DATABASE_URL is required outside of tests so misconfiguration fails fast
// at boot rather than on the first query.
if (nodeEnv !== 'test' && !process.env.DATABASE_URL) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
};
