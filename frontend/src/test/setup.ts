import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library's auto-cleanup registers itself against the global
// `afterEach` when the test runner exposes one via `globals: true`; this
// project doesn't enable that (tests import `describe`/`it`/`expect`
// explicitly), so cleanup is wired up here instead — without it, each
// test's rendered DOM accumulates across tests within the same file.
afterEach(() => {
  cleanup();
});
