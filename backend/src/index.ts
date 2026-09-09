import { createApp } from './app.js';
import { env } from './config/env.js';
import { startJobWorker } from './platform/jobs/worker.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`[backend] listening on port ${env.port} (${env.nodeEnv})`);
  // Start the in-process background-job worker (DB-backed queue). It polls
  // for ready jobs and drains them; safe to run in every app instance —
  // `FOR UPDATE SKIP LOCKED` guarantees no job is processed twice.
  startJobWorker();
  console.log('[backend] background job worker started');
});
