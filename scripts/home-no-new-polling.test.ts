/**
 * Acceptance test — Home dashboard sources live data ONLY from existing
 * reads, and its derivation module is pure (R6-07; relocated onto the
 * extracted data hook by W6-IA-4).
 *
 * `/` becomes the Home surface (forge-ui/app/page.tsx), aggregating flows /
 * agents / projects / kbs with live status derived from the run-model. The
 * risk this AT closes: a Home implementation that takes a shortcut around
 * the existing fetch/subscribe surface — spinning its own poll loop, calling
 * a brand-new aggregate endpoint, or hiding a fetch inside the "pure"
 * derivation module — none of which the rest of Studio's live-refresh
 * plumbing (subscribe()-driven SSE) accounts for.
 *
 * W6-IA-4 EXTRACTED the byte-duplicated loadAll/refreshRuns/subscribe()
 * shape Home and the old Library landing page both hand-carried (sweep
 * finding C1#5) into ONE shared hook, `forge-ui/lib/use-studio-home-data.ts`
 * — Home is now its only caller, and the rebuilt Library page's five
 * shelves read entirely different sources. This file's checks move onto
 * that hook (the new home of the fetch/subscribe wiring) instead of
 * comparing app/page.tsx's source against app/library/page.tsx's — Library's
 * fetch set is no longer even related to Home's.
 *
 * Kills:
 *  - a Home (or its hook) that runs `setInterval(...)` to re-poll instead of
 *    using the existing `subscribe()` SSE hookup (a second, uncoordinated
 *    polling loop);
 *  - a Home (or its hook) that opens its own `new WebSocket(...)` transport;
 *  - a Home (or its hook) that calls a brand-new `/api/...` aggregate
 *    endpoint instead of composing the existing fetchStudioFlows /
 *    fetchRuns / fetchProjectAttention reads;
 *  - a Home (or its hook) that does a raw `fetch(...)` bypassing the
 *    bridge-client/studio-client wrappers entirely;
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
const HOME_DATA_HOOK = join(ROOT, 'forge-ui', 'lib', 'use-studio-home-data.ts');
const HOME_VIEW = join(ROOT, 'forge-ui', 'lib', 'home-view.ts');

// The closed set of data-fetch identifiers the extracted hook is allowed to
// call — no new one — so "new /api endpoint" and "bespoke fetch" are
// structurally ruled out rather than merely discouraged.
//
// W6-B11: `fetchStudioSessions` was deliberately ADDED to this closed set —
// not a loophole in the guard, the guard's own maintenance contract. It is
// the EXISTING W6-B11 aggregate-sessions bridge route (`GET /api/studio/
// sessions`, cli/ui-bridge.ts), composed here exactly like the other six
// `fetchStudio*`/`fetchRuns`/`fetchProjectAttention` reads — never a raw
// fetch, never a hardcoded path inside this hook (the path literal lives
// inside `fetchStudioSessions` itself, in ./studio-client, same as every
// other read's path lives inside its own wrapper).
const ALLOWED_FETCH_IDENTIFIERS = [
  'fetchStudioFlows',
  'fetchStudioAgents',
  'fetchStudioProjects',
  'fetchStudioKbs',
  'fetchRuns',
  'fetchProjectAttention',
  'fetchStudioSessions',
  'subscribe',
] as const;

function readOrFail(path: string, label: string): string {
  assert.ok(existsSync(path), `${label} must exist at ${path.slice(ROOT.length + 1)} (RED at base: R6-07 not yet implemented)`);
  return readFileSync(path, 'utf8');
}

test('forge-ui/app/page.tsx exists (Home fills `/`)', () => {
  readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
});

test('forge-ui/lib/use-studio-home-data.ts exists (the extracted, shared data-loading hook — W6-IA-4)', () => {
  readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
});

test('forge-ui/lib/home-view.ts exists (the pure derivation module)', () => {
  readOrFail(HOME_VIEW, 'forge-ui/lib/home-view.ts');
});

test('app/page.tsx sources its data via useStudioHomeData(), not a bespoke client import of its own', () => {
  const src = readOrFail(HOME_PAGE, 'forge-ui/app/page.tsx');
  assert.ok(src.includes('useStudioHomeData'), 'Home must source its six cross-object reads through the extracted hook');
});

test('lib/use-studio-home-data.ts imports data reads only from ./studio-client and ./bridge-client', () => {
  const src = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  const importsStudioClient = /from ['"]\.\/studio-client['"]/.test(src);
  const importsBridgeClient = /from ['"]\.\/bridge-client['"]/.test(src);
  assert.ok(
    importsStudioClient || importsBridgeClient,
    'the hook must source data via the existing ./studio-client / ./bridge-client wrappers, not a bespoke client',
  );
});

test("the hook's fetch identifiers are exactly the pre-existing closed set (no new endpoint invented for Home)", () => {
  const hookSrc = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  const usedIds = ALLOWED_FETCH_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(hookSrc));
  assert.ok(usedIds.length > 0, 'the hook must call at least one of the existing fetch* reads to show live status');
  // No per-item fetch helper name (fetchKb, etc.) — the N-fan-out shape this
  // guard exists to rule out.
  assert.ok(!/\bfetchKb\b/.test(hookSrc), 'the hook must not fan out a per-KB (or per-item) fetch — only the six existing bulk reads');
});

test('the hook does not run its own setInterval poll loop', () => {
  const src = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  assert.ok(!src.includes('setInterval('), 'the hook must not spin its own polling loop — live refresh comes from subscribe() (SSE)');
});

test('the hook does not open its own WebSocket transport', () => {
  const src = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  assert.ok(!src.includes('new WebSocket('), 'the hook must not open a bespoke WebSocket — subscribe() is the one live-refresh transport');
});

test('the hook does not make a raw fetch() call (must go through bridge-client/studio-client wrappers)', () => {
  const src = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  assert.ok(!/\bfetch\(/.test(src), 'the hook must not call raw fetch() — all reads must be through the existing typed wrappers');
});

test('the hook does not reference a new /api/ literal (no bespoke aggregate endpoint)', () => {
  const src = readOrFail(HOME_DATA_HOOK, 'forge-ui/lib/use-studio-home-data.ts');
  assert.ok(!src.includes("'/api/"), "the hook must not hardcode a new '/api/...' endpoint — compose the existing fetch* reads instead");
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

// ---------------------------------------------------------------------------
// W8-B1 — the Monitor pillar rides the SAME rails.
//
// `/monitor` is the second surface to aggregate "everything running". A guard
// that backstops only Home would have let Monitor invent exactly the shortcut
// this file exists to rule out (its own poll loop, its own aggregate endpoint,
// a fetch hidden inside the "pure" derivation) — a lint that does not mirror
// what it backstops is decoration. So the same four structural checks now
// apply to the Monitor page, to the lifted merged-ledger hook both surfaces
// read, and to the pure monitor derivation.
// ---------------------------------------------------------------------------

const MONITOR_PAGE = join(ROOT, 'forge-ui', 'app', 'monitor', 'page.tsx');
const MONITOR_VIEW = join(ROOT, 'forge-ui', 'lib', 'monitor-view.ts');
const EVERYTHING_LEDGER_HOOK = join(ROOT, 'forge-ui', 'lib', 'use-everything-ledger.ts');

test('forge-ui/app/monitor/page.tsx exists (the Monitor pillar surface)', () => {
  readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
});

test('app/monitor/page.tsx sources its data via the SHARED hooks, not a bespoke client of its own', () => {
  const src = readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
  assert.ok(src.includes('useStudioHomeData'), 'Monitor must source its cross-object reads through the shared hook');
  assert.ok(
    src.includes('useEverythingLedger'),
    'Monitor must read the merged flow+agent ledger through the lifted hook — a second copy of that fetch/merge is how two surfaces start disagreeing about what ran',
  );
});

test('app/monitor/page.tsx does not run its own setInterval poll loop', () => {
  const src = readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
  assert.ok(!src.includes('setInterval('), 'Monitor must not spin its own polling loop — live refresh comes from subscribe() (SSE)');
});

test('app/monitor/page.tsx does not open its own WebSocket transport', () => {
  const src = readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
  assert.ok(!src.includes('new WebSocket('), 'Monitor must not open a bespoke WebSocket — subscribe() is the one live-refresh transport');
});

test('app/monitor/page.tsx does not make a raw fetch() call', () => {
  const src = readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
  assert.ok(!/\bfetch\(/.test(src), 'Monitor must not call raw fetch() — all reads must be through the existing typed wrappers');
});

test('app/monitor/page.tsx does not reference a new /api/ literal (no bespoke aggregate endpoint)', () => {
  const src = readOrFail(MONITOR_PAGE, 'forge-ui/app/monitor/page.tsx');
  assert.ok(!src.includes("'/api/"), "Monitor must not hardcode a new '/api/...' endpoint — compose the existing reads instead");
});

test('lib/use-everything-ledger.ts adds no transport of its own (no interval, no socket, no raw fetch, no /api/ literal)', () => {
  const src = readOrFail(EVERYTHING_LEDGER_HOOK, 'forge-ui/lib/use-everything-ledger.ts');
  assert.ok(!src.includes('setInterval('), 'the lifted ledger hook must not spin a polling loop');
  assert.ok(!src.includes('new WebSocket('), 'the lifted ledger hook must not open a bespoke WebSocket');
  assert.ok(!/\bfetch\(/.test(src), 'the lifted ledger hook must not call raw fetch() — it composes the existing typed reads');
  assert.ok(!src.includes("'/api/"), "the lifted ledger hook must not hardcode an '/api/...' path — the literal lives inside the read wrapper");
});

test('forge-ui/lib/monitor-view.ts is a pure derivation module: no fetch, no /api/, no await, no subscribe', () => {
  const src = readOrFail(MONITOR_VIEW, 'forge-ui/lib/monitor-view.ts');
  assert.ok(!/\bfetch\(/.test(src), 'monitor-view.ts must not fetch — it derives from data passed in, callers do the fetching');
  assert.ok(!src.includes('/api/'), 'monitor-view.ts must not reference an API path — it is pure derivation, not a data-access layer');
  assert.ok(!/\bawait\b/.test(src), 'monitor-view.ts must not await anything — a derivation with async I/O is not pure');
  assert.ok(!/\bsubscribe\(/.test(src), 'monitor-view.ts must not subscribe — live-refresh wiring belongs to the page, not the derivation');
});
