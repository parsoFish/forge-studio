/**
 * Acceptance test — redirect preservation for every moved route (R6-03-F3,
 * batch-F ruling 47).
 *
 * Immutable-gate, RED-first. Moving Library off `/` onto `/library` MUST keep
 * a working redirect so old bookmarks/deep-links to `/` still resolve to the
 * Library. Ruling 47: the AT is a failing-fixture PER MOVED ROUTE (request old
 * path -> 3xx/rewrite to new), NOT a string-present check, and `ui:deadpaths`
 * green is necessary but not sufficient.
 *
 * This asserts the ACTUAL served redirect DECLARATION Next.js uses — the
 * `redirects()` config the framework turns into a wire 3xx — rather than a
 * client-side `router.replace` that a raw request would never run (the
 * immutable-gates "client-side normalization masks a server-side hole"
 * catalogue entry). The live navigation half (goto `/` -> lands on
 * `data-page="library"`) is covered by e2e-deadpaths.mjs; together they are
 * the per-moved-route fixture.
 *
 * Kills: a Library move that drops the `/` -> `/library` redirect (old
 * bookmarks 404 or land on an empty Home placeholder), or one implemented only
 * client-side where a wire request gets nothing.
 *
 * RUN: node --test --experimental-strip-types scripts/redirect-preservation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The single source of every moved route in this initiative. Add a row here
// the moment another route moves — the test then demands its redirect too.
const MOVED_ROUTES: ReadonlyArray<{ from: string; to: string }> = [
  { from: '/', to: '/library' }, // Library vacated `/` for its own pillar (Home fills `/` in R6-07)
];

test('next.config declares a redirects() function', async () => {
  const mod = await import('../forge-ui/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: unknown };
  assert.equal(
    typeof config.redirects,
    'function',
    'next.config.mjs must export a redirects() so moved routes resolve at the wire, not just client-side',
  );
});

test('every moved route has a wire redirect old-path -> new-path', async () => {
  const mod = await import('../forge-ui/next.config.mjs');
  const config = (mod as { default: { redirects: () => Promise<Array<Record<string, unknown>>> } }).default;
  const rules = await config.redirects();
  assert.ok(Array.isArray(rules), 'redirects() must resolve to an array');

  for (const moved of MOVED_ROUTES) {
    const rule = rules.find((r) => r.source === moved.from && r.destination === moved.to);
    assert.ok(
      rule,
      `missing redirect ${moved.from} -> ${moved.to} (old bookmarks would break); got ${JSON.stringify(rules)}`,
    );
    // A redirect, not a permanent 308 — R6-07 replaces `/` with Home, so the
    // interim hop must not be cached forever by browsers.
    assert.equal(
      rule.permanent,
      false,
      `redirect ${moved.from} -> ${moved.to} must be temporary (permanent:false) so R6-07 can reclaim the slot`,
    );
  }
});
