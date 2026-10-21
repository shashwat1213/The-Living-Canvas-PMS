// Vercel Function entry: the whole Express API (see backend/src/serverless.ts).
// Every /api/* and /health request is rewritten here by vercel.json, so the
// SPA and the API share one origin (first-party cookies, no CORS).
export { default } from '../backend/dist/serverless.js';

export const config = { maxDuration: 60 };
