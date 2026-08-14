/**
 * Acceptance test — redirect preservation for every moved route (R6-03-F3,
 * batch-F ruling 47), AMENDED for R6-07.
 *
 * Immutable-gate, RED-first. `{from:'/', to:'/library'}` was the interim wire
 * redirect covering the window between Library vacating `/` (R6-03-F3) and
 * Home reclaiming it (R6-07): "Home fills `/` in R6-07" was recorded in this
 * file's own comment from the start. R6-07 is that moment — `/` becomes the
 * Home dashboard route directly (forge-ui/app/page.tsx), so the redirect is
 * now DELIBERATELY RETIRED, not merely superseded. `/` is no longer a "moved
 * route" with somewhere else to redirect to; it is its own first-class
 * surface. MOVED_ROUTES is kept empty rather than deleted so it remains the
 * single source the moment forge grows a genuinely moved (not reclaimed) route.
 *
 * This still asserts the ACTUAL served redirect DECLARATION Next.js uses (the
 * `redirects()` config the framework turns into a wire 3xx) rather than a
 * client-side check — the immutable-gates "client-side normalization masks a
 * server-side hole" catalogue entry applies just as much to a STALE redirect
 * surviving as to a missing one.
 *
 * Kills: an R6-07 Home implementation that adds `app/page.tsx` but leaves the
 * old `/` -> `/library` redirect in `next.config.mjs` — the redirect would win
 * at the wire (redirects run before page render) and Home would never be
 * reachable at `/` despite the page existing.
 *
 * RUN: node --test --experimental-strip-types scripts/redirect-preservation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The single source of every CURRENTLY moved-and-redirected route. Add a row
// here the moment a route moves with nowhere else serving the old path; R6-07
// reclaimed `/` for Home so nothing is presently in this state.
const MOVED_ROUTES: ReadonlyArray<{ from: string; to: string }> = [];

test('next.config redirects() (if present) resolves to an array', async () => {
  const mod = await import('../forge-ui/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<unknown> };
  if (typeof config.redirects !== 'function') return; // no redirects() at all is fine post-R6-07
  const rules = await config.redirects();
  assert.ok(Array.isArray(rules), 'redirects(), if declared, must resolve to an array');
});

test('every currently-moved route has a wire redirect old-path -> new-path', async () => {
  const mod = await import('../forge-ui/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<Array<Record<string, unknown>>> };
  const rules = typeof config.redirects === 'function' ? await config.redirects() : [];

  for (const moved of MOVED_ROUTES) {
    const rule = rules.find((r) => r.source === moved.from && r.destination === moved.to);
    assert.ok(
      rule,
      `missing redirect ${moved.from} -> ${moved.to} (old bookmarks would break); got ${JSON.stringify(rules)}`,
    );
    assert.equal(rule.permanent, false, `redirect ${moved.from} -> ${moved.to} must be temporary (permanent:false)`);
  }
});

test('no stale `/` -> `/library` redirect remains (R6-07: `/` is now the Home surface, not a redirect)', async () => {
  // RED at base 7dd423b6: next.config.mjs still declares the interim
  // { source: '/', destination: '/library' } rule from R6-03-F3. It must be
  // GONE once R6-07 lands app/page.tsx — a surviving rule would shadow Home
  // at the wire (redirects run before any page renders) even though the page
  // file exists, exactly the "declared route, unreachable in practice" trap.
  const mod = await import('../forge-ui/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<Array<Record<string, unknown>>> };
  const rules = typeof config.redirects === 'function' ? await config.redirects() : [];

  const staleRootRedirect = rules.find((r) => r.source === '/');
  assert.equal(
    staleRootRedirect,
    undefined,
    `'/' must not be redirected anywhere — Home now serves it directly; found stale rule: ${JSON.stringify(staleRootRedirect)}`,
  );
});
