/**
 * Standalone probe used by env.test.ts to exercise config/env.ts's
 * module-load-time validation (see the `isTest` guard) in a clean,
 * isolated process. env.ts's checks run once, at import time — testing
 * them in-process would mean mutating the real `process.env` mid-suite,
 * risking leakage into every other test file sharing this worker.
 *
 * Prints the resolved config as JSON on success; a thrown error (from
 * env.ts's own required-variable guard) propagates as a non-zero exit
 * with the error message on stderr, which the spawning test asserts on.
 */
import { env } from '../../src/config/env.js';

process.stdout.write(JSON.stringify({ jwtSecret: env.auth.jwtSecret, databaseUrl: env.databaseUrl }));
