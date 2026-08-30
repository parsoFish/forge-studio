/**
 * Acceptance test — redirect preservation for every moved route (R6-03-F3,
 * batch-F ruling 47), AMENDED for R6-07, AMENDED AGAIN for W6-IA-8, AMENDED
 * AGAIN for W6-B10.
 *
 * Immutable-gate, RED-first. `{from:'/', to:'/library'}` was the interim wire
 * redirect covering the window between Library vacating `/` (R6-03-F3) and
 * Home reclaiming it (R6-07): "Home fills `/` in R6-07" was recorded in this
 * file's own comment from the start. R6-07 is that moment — `/` becomes the
 * Home dashboard route directly (apps/studio/app/page.tsx), so that redirect was
 * DELIBERATELY RETIRED, not merely superseded, and MOVED_ROUTES went empty.
 *
 * W6-IA-8 is the first time forge grows genuinely moved (not reclaimed)
 * routes since: 7 legacy client-shim pages (architect x2, instructions,
 * project-brain, review, reflect, recovery) were pure path-shape moves — the
 * destination is knowable from the URL alone, no data lookup required — so
 * policy converts them to wire redirects and deletes the shim page. Each is
 * `permanent: true` (a real, durable route move), unlike the old interim `/`
 * rule, which is why `permanent` is now itself part of the fixture instead of
 * a hardcoded `false` in the assertion.
 *
 * `/demo/[sessionId]` stayed a page at W6-IA-8 — it resolved its owning
 * project via a live `listDemoSessions()` lookup, so the destination was NOT
 * knowable from the URL alone. W6-B10 (the demo-builder entrypoint repair,
 * R1-03-F2 reversed) changed the premise: the DESTINATION,
 * `/sessions/demo/<sid>`, learned to make that same `listDemoSessions()`
 * lookup itself (`refreshSummary`'s `demo` branch,
 * `app/sessions/[kind]/[sessionId]/page.tsx`) — `?project=` on the redirect
 * is now an optional optimization, not a hard requirement — so the move
 * graduates to a pure path-shape one, exactly like its six siblings, and the
 * shim page is deleted.
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
 * reachable at `/` despite the page existing. Also kills: a W6-IA-8 regression
 * that deletes a shim page's redirect rule (or drops its `permanent: true`)
 * while the page itself stays deleted — old bookmarks would 404 outright.
 *
 * RUN: node --test --experimental-strip-types scripts/redirect-preservation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The single source of every CURRENTLY moved-and-redirected route. Add a row
// here the moment a route moves with nowhere else serving the old path.
const MOVED_ROUTES: ReadonlyArray<{ from: string; to: string; permanent: boolean }> = [
  // W6-IA-8: `/interview` listed before its parent so a request never chains
  // through two redirect hops (both land on the same destination anyway).
  { from: '/architect/:sessionId/interview', to: '/sessions/architect/:sessionId', permanent: true },
  // The param EXCLUDES the literal `new`: `/architect/new` is the architect's
  // own live kickoff page (never a session id), and an unscoped `:sessionId`
  // swallowed it — every "Plan with Architect" entry landed on the generic
  // /sessions/architect/new kickoff (wave-6 final gate). Old bookmarks
  // (`/architect/<real-sid>`) still redirect; the live page stays live.
  { from: '/architect/:sessionId((?!new$)[^/]+)', to: '/sessions/architect/:sessionId', permanent: true },
  { from: '/instructions/:sessionId', to: '/sessions/instructions/:sessionId', permanent: true },
  { from: '/project-brain/:sessionId', to: '/sessions/project-brain/:sessionId', permanent: true },
  // W6-B10: /demo/[sessionId] graduates from a data-dependent client shim to
  // a pure wire redirect — see this file's header comment.
  { from: '/demo/:sessionId', to: '/sessions/demo/:sessionId', permanent: true },
  { from: '/review/:cycleId', to: '/artifact?run=:cycleId&type=verdict&mode=gate', permanent: true },
  { from: '/reflect/:cycleId', to: '/artifact?run=:cycleId&type=reflection&mode=view', permanent: true },
  { from: '/recovery', to: '/library', permanent: true },
];

test('next.config redirects() (if present) resolves to an array', async () => {
  const mod = await import('../apps/studio/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<unknown> };
  if (typeof config.redirects !== 'function') return; // no redirects() at all is fine post-R6-07
  const rules = await config.redirects();
  assert.ok(Array.isArray(rules), 'redirects(), if declared, must resolve to an array');
});

test('every currently-moved route has a wire redirect old-path -> new-path', async () => {
  const mod = await import('../apps/studio/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<Array<Record<string, unknown>>> };
  const rules = typeof config.redirects === 'function' ? await config.redirects() : [];

  for (const moved of MOVED_ROUTES) {
    const rule = rules.find((r) => r.source === moved.from && r.destination === moved.to);
    assert.ok(
      rule,
      `missing redirect ${moved.from} -> ${moved.to} (old bookmarks would break); got ${JSON.stringify(rules)}`,
    );
    assert.equal(
      rule.permanent,
      moved.permanent,
      `redirect ${moved.from} -> ${moved.to} must be permanent:${moved.permanent}`,
    );
  }
});

test('W6: /architect/new stays a LIVE page — no redirect source may match it (architect never migrates, ADR-043 §4)', async () => {
  const mod = await import('../apps/studio/next.config.mjs');
  const cfg = (mod.default ?? mod) as { redirects?: () => Promise<Array<{ source: string }>> };
  const redirects = typeof cfg.redirects === 'function' ? await cfg.redirects() : [];
  for (const r of redirects) {
    // Cheap structural guard independent of path-to-regexp availability: any
    // source rooted at /architect/ must not be a bare single param, and if it
    // carries a custom param regex it must exclude `new`.
    if (typeof r.source === 'string' && r.source.startsWith('/architect/')) {
      assert.ok(!/^\/architect\/:[A-Za-z]+$/.test(r.source), `unscoped architect redirect ${r.source} would swallow /architect/new`);
      if (r.source.includes('(')) {
        assert.ok(r.source.includes('(?!new$)'), `architect redirect ${r.source} must exclude the literal 'new' segment`);
      }
    }
  }
});

test('every MOVED_ROUTES shim page is actually deleted (no orphaned client-shim left behind)', async () => {
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const uiRoot = fileURLToPath(new URL('../apps/studio/app', import.meta.url));

  // Wire-redirected source paths, mapped to the shim page file policy deleted
  // for each. `:param` segments become the literal `[param]` Next.js dynamic
  // segment directory name.
  const deletedShims = [
    'architect/[sessionId]/interview/page.tsx',
    'architect/[sessionId]/page.tsx',
    'instructions/[sessionId]/page.tsx',
    'project-brain/[sessionId]/page.tsx',
    // W6-B10: graduated from the data-dependent shim W6-IA-8 deliberately
    // left behind (see this file's header comment) to a pure wire redirect.
    'demo/[sessionId]/page.tsx',
    'review/[cycleId]/page.tsx',
    'reflect/[cycleId]/page.tsx',
    'recovery/page.tsx',
  ];

  for (const rel of deletedShims) {
    assert.equal(
      existsSync(`${uiRoot}/${rel}`),
      false,
      `${rel} should be deleted — its route is now a wire redirect in next.config.mjs, not a client-side shim page`,
    );
  }
});

test('no stale `/` -> `/library` redirect remains (R6-07: `/` is now the Home surface, not a redirect)', async () => {
  // RED at base 7dd423b6: next.config.mjs still declares the interim
  // { source: '/', destination: '/library' } rule from R6-03-F3. It must be
  // GONE once R6-07 lands app/page.tsx — a surviving rule would shadow Home
  // at the wire (redirects run before any page renders) even though the page
  // file exists, exactly the "declared route, unreachable in practice" trap.
  const mod = await import('../apps/studio/next.config.mjs');
  const config = (mod as { default: unknown }).default as { redirects?: () => Promise<Array<Record<string, unknown>>> };
  const rules = typeof config.redirects === 'function' ? await config.redirects() : [];

  const staleRootRedirect = rules.find((r) => r.source === '/');
  assert.equal(
    staleRootRedirect,
    undefined,
    `'/' must not be redirected anywhere — Home now serves it directly; found stale rule: ${JSON.stringify(staleRootRedirect)}`,
  );
});
