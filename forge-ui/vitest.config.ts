import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// R6-04 WI-3 (test-writer addition): `resolve.alias` and `oxc.jsx` let a
// small set of tests render the REAL forge-ui components (via react-dom/
// server's renderToStaticMarkup) instead of only unit-testing extracted pure
// logic — see forge-ui/lib/run-panel-render.test.ts's header for the full
// rationale. Neither addition installs a new dependency (react/react-dom are
// already forge-ui dependencies) and neither changes `environment`/`include`
// for the existing `lib/**/*.test.ts` suite, which stays green unchanged.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  oxc: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
