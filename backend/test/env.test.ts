/**
 * Regression coverage for config/env.ts's required-variable guard (see
 * the 2026-08-19 Security review finding in DECISIONS.md: the guard was
 * skipped whenever NODE_ENV happened to equal "test", which a
 * misconfigured real deployment could end up with, silently letting it
 * boot on the hardcoded fallback JWT secret committed in this repo).
 *
 * Each scenario runs env.ts in a fresh child process — the guard runs
 * once, at module import time, so testing it in-process would mean
 * mutating the real `process.env` mid-suite and risking leakage into
 * every other test file sharing this worker.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(import.meta.dirname, '..');
const probePath = path.join(backendRoot, 'test/fixtures/env-probe.ts');

// Resolved via Node's own module resolution (not a hardcoded
// node_modules/.bin path) because this is an npm workspaces monorepo —
// tsx is hoisted to the repo root's node_modules, not backend's own.
const require = createRequire(import.meta.url);
const tsxPackageJsonPath = require.resolve('tsx/package.json');
const tsxBinEntry = (require(tsxPackageJsonPath) as { bin: string }).bin;
const tsxCli = path.join(path.dirname(tsxPackageJsonPath), tsxBinEntry);

type ProbeEnv = Partial<Record<'NODE_ENV' | 'VITEST' | 'JWT_SECRET' | 'DATABASE_URL', string>>;

function runProbe(overrides: ProbeEnv) {
  // Inherit the real environment (PATH, HOME, etc. — needed to actually
  // locate and run node/tsx) but scrub the four variables under test so
  // nothing leaks in from this very process's own already-loaded .env,
  // and point dotenv at a file that doesn't exist so env.ts's own
  // `import 'dotenv/config'` can't silently repopulate them either.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['NODE_ENV', 'VITEST', 'JWT_SECRET', 'DATABASE_URL'] as const) {
    delete childEnv[key];
  }
  childEnv.DOTENV_CONFIG_PATH = path.join(backendRoot, 'test/fixtures/__no-such-env-file__');
  Object.assign(childEnv, overrides);

  return spawnSync(process.execPath, [tsxCli, probePath], { cwd: backendRoot, env: childEnv, encoding: 'utf8' });
}

describe('config/env.ts required-variable guard', () => {
  it('throws for JWT_SECRET when NODE_ENV=test but the process is not actually Vitest (the fix)', () => {
    const result = runProbe({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://example/db' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing required environment variable: JWT_SECRET');
    // And never falls through to print the hardcoded fallback.
    expect(result.stdout).not.toContain('test-only-jwt-secret');
  });

  it('still allows the test-only fallback when genuinely running under Vitest', () => {
    const result = runProbe({ NODE_ENV: 'test', VITEST: 'true' });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { jwtSecret: string };
    expect(parsed.jwtSecret).toBe('test-only-jwt-secret-do-not-use-in-production');
  });

  it('uses a real JWT_SECRET when one is configured, regardless of NODE_ENV', () => {
    const result = runProbe({ NODE_ENV: 'production', JWT_SECRET: 'a-real-configured-secret', DATABASE_URL: 'postgresql://example/db' });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { jwtSecret: string };
    expect(parsed.jwtSecret).toBe('a-real-configured-secret');
  });

  it('still throws for a real deployment with no JWT_SECRET at all (pre-existing guard, unaffected by the fix)', () => {
    const result = runProbe({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://example/db' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing required environment variable: JWT_SECRET');
  });
});
