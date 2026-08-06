import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// R6-04 WI-3 (test-writer addition): `resolve.alias` and `oxc.jsx` let a
// small set of tests render the REAL forge-ui components (via react-dom/
// server's renderToStaticMarkup) instead of only unit-testing extracted pure
// logic — see forge-ui/lib/run-panel-render.test.ts's header for the full
// rationale. Neither addition installs a new dependency (react/react-dom are
// already forge-ui dependencies) and neither changes `environment`/`include`
// for the existing `lib/**/*.test.ts` suite, which stays green unchanged.
//
// `oxc.jsx` MUST be an OBJECT (vite's type is `jsx?: 'preserve' |
// JsxOptions`, from rolldown's binding types) — a bare string here (this
// file's own prior `jsx: 'automatic'`) type-checks as an error under
// `next build`'s workspace-wide tsc pass (it happened to still work at
// runtime, since plain JS reads an unrecognized value the same as "not
// preserve", but that is an accident, not a contract). `{ runtime:
// 'automatic' }` is oxc's own already-documented default — spelled out
// explicitly here so intent doesn't depend on that default holding forever.
// The underlying need this config solves is unchanged: without SOME object
// here, vite falls back to forge-ui/tsconfig.json's `"jsx": "preserve"`
// (Next's own convention, meant for the Next/SWC compiler) and errors
// parsing any .tsx file outright — reproduced and confirmed by temporarily
// removing this field entirely before landing this fix.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
