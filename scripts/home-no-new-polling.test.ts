/**
 * Acceptance test — Home dashboard sources live data ONLY from existing
 * reads, and its derivation module is pure (R6-07).
 *
 * `/` becomes the Home surface (forge-ui/app/page.tsx), aggregating flows /
 * agents / projects / kbs with live status derived from the run-model. The
 * risk this AT closes: a Home implementation that takes a shortcut around
 * the existing fetch/subscribe surface — spinning its own poll loop, calling
 * a brand-new aggregate endpoint, or hiding a fetch inside the "pure"
 * derivation module — none of which the rest of Studio's live-refresh
 * plumbing (subscribe()-driven SSE) accounts for.
 *
 * Kills:
 *  - a Home that runs `setInterval(...)` to re-poll instead of using the
 *    existing `subscribe()` SSE hookup (a second, uncoordinated polling loop);
 *  - a Home that opens its own `new WebSocket(...)` transport;
 *  - a Home that calls a brand-new `/api/...` aggregate endpoint instead of
 *    composing the existing fetchStudioFlows / fetchRuns / fetchProjectAttention reads;
 *  - a Home that does a raw `fetch(...)` bypassing the bridge-client/studio-client
 *    wrappers entirely;
 *  - a `home-view.ts` derivation that isn't pure — i.e. that itself fetches,
 *    awaits, or subscribes rather than taking already-fetched data as input.
 *
 * RUN: node --test --experimental-strip-types scripts/home-no-new-polling.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME_PAGE = join(ROOT, 'forge-ui', 'app', 'page.tsx');
const LIBRARY_PAGE = join(ROOT, 'forge-ui', 'app', 'library', 'page.tsx');
const HOME_VIEW = join(ROOT, 'forge-ui', 'lib', 'home-view.ts');

// The closed set of data-fetch identifiers Library already uses for this same
// kind of cross-object aggregate. Home is allowed to use a SUBSET of these —
// never a new one — so "new /api endpoint" and "bespoke fetch" are structurally
// ruled out rather than merely discouraged.
const ALLOWED_FETCH_IDENTIFIERS = [
  'fetchStudioFlows',
  'fetchStudioAgents',
  'fetchStudioProjects',
  'fetchStudioKbs',
  'fetchRuns',
  'fetchProjectAttention',
  'subscribe',
] as const;

function readOrFail(path: string, label: string): string {
  assert.ok(existsSync(path), `${label} must exist at ${path.slice(ROOT.length + 1)} (RED at base: R6-07 not yet implemented)`);
  return readFileSync(path, 'utf8');
}

test('forge-ui/app/page.tsx exists (Home fills `/`)', () => {
  readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
});

test('forge-ui/lib/home-view.ts exists (the pure derivation module)', () => {
  readOrFail(HOME_VIEW, 'forge-ui/lib/home-view.ts');
});

test('app/page.tsx imports data reads only from @/lib/studio-client and @/lib/bridge-client', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  const importsStudioClient = /from ['"]@\/lib\/studio-client['"]/.test(src);
  const importsBridgeClient = /from ['"]@\/lib\/bridge-client['"]/.test(src);
  assert.ok(
    importsStudioClient || importsBridgeClient,
    'Home must source data via the existing @/lib/studio-client / @/lib/bridge-client wrappers, not a bespoke client',
  );
});

test("app/page.tsx's fetch identifiers are a SUBSET of app/library/page.tsx's (no new endpoint invented for Home)", () => {
  const homeSrc = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  const librarySrc = readOrFail(LIBRARY_PAGE, 'forge-ui/app/library/page.tsx');

  const usedIn = (src: string) => ALLOWED_FETCH_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(src));

  const homeIds = usedIn(homeSrc);
  const libraryIds = usedIn(librarySrc);

  assert.ok(homeIds.length > 0, 'Home must call at least one of the existing fetch* reads to show live status');

  const notInLibrary = homeIds.filter((id) => !libraryIds.includes(id));
  assert.deepEqual(
    notInLibrary,
    [],
    `Home uses fetch identifiers outside Library's existing set (would imply a new endpoint/read): ${JSON.stringify(notInLibrary)}`,
  );
});

test('app/page.tsx does not run its own setInterval poll loop', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  assert.ok(!src.includes('setInterval('), 'Home must not spin its own polling loop — live refresh comes from subscribe() (SSE)');
});

test('app/page.tsx does not open its own WebSocket transport', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  assert.ok(!src.includes('new WebSocket('), 'Home must not open a bespoke WebSocket — subscribe() is the one live-refresh transport');
});

test('app/page.tsx does not make a raw fetch() call (must go through bridge-client/studio-client wrappers)', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  assert.ok(!/\bfetch\(/.test(src), 'Home must not call raw fetch() — all reads must be through the existing typed wrappers');
});

test('app/page.tsx does not reference a new /api/ literal (no bespoke aggregate endpoint)', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  assert.ok(!src.includes("'/api/"), "Home must not hardcode a new '/api/...' endpoint — compose the existing fetch* reads instead");
});

test('forge-ui/lib/home-view.ts is a pure derivation module: no fetch, no /api/, no await, no subscribe', () => {
  const src = readOrFail(HOME_VIEW, 'forge-ui/lib/home-view.ts');
  assert.ok(!/\bfetch\(/.test(src), 'home-view.ts must not fetch — it derives from data passed in, callers do the fetching');
  assert.ok(!src.includes("/api/"), 'home-view.ts must not reference an API path — it is pure derivation, not a data-access layer');
  assert.ok(!/\bawait\b/.test(src), 'home-view.ts must not await anything — a derivation with async I/O is not pure');
  assert.ok(!/\bsubscribe\(/.test(src), 'home-view.ts must not subscribe — live-refresh wiring belongs to the page, not the derivation');
});
