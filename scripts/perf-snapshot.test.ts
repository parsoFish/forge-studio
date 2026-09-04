/**
 * perf-snapshot.test.ts — unit tests for scripts/perf-snapshot.mjs (W6-P0).
 * Named `.test.ts` (not `.test.mjs`) to match this repo's `npm test` glob
 * (`scripts/*.test.ts` in package.json's "test" script — a plain
 * `.test.mjs` file here would silently NOT run). scripts/ is outside
 * tsconfig.json's `include`, so this file is exercised only via
 * `node --test --experimental-strip-types`, never `tsc`.
 *
 * Two groups:
 *   - PURE helpers (arg parsing, stats, largest-log discovery via a
 *     synthetic fixture dir, timestamp formatting, table rendering) —
 *     deterministic, no I/O.
 *   - timeFetch/measureApiEndpoint — impure (real network I/O in
 *     production), but both take an injectable `fetchImpl` (mirrors
 *     apps/forge/forge-watch.ts's `probeBridgeIdentity(url, fetchImpl)`), so they're
 *     exercised here against a STUBBED fetch — no live bridge required (and
 *     none is touched from this lane).
 *
 * Not covered here: probeHealth/probeUi/measurePage (Playwright) and
 * main()'s fs writes — those are exercised for real by an operator running
 * `npm run perf:snapshot` against a live `forge studio`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseArgs,
  computeStats,
  findLargestEventsLog,
  isoTimestampForFilename,
  formatMarkdownTable,
  timeFetch,
  measureApiEndpoint,
} from './perf-snapshot.mjs';

/** Build a stub `fetchImpl`: consumes `responses` in order, one per call.
 *  Each entry is either `{ ok, status, bytes }` (a fake Response with a
 *  working .arrayBuffer()) or `{ throwError }` (the call rejects — models a
 *  network failure/abort-timeout, distinct from an HTTP error status). */
function makeStubFetch(responses) {
  let i = 0;
  return async () => {
    if (i >= responses.length) throw new Error(`stub fetch called more times (${i + 1}) than responses provided (${responses.length})`);
    const spec = responses[i++];
    if (spec.throwError) throw spec.throwError;
    return { ok: spec.ok, status: spec.status, arrayBuffer: async () => new ArrayBuffer(spec.bytes) };
  };
}

// =============================================================================
// parseArgs
// =============================================================================

test('parseArgs: no args — label is null', () => {
  assert.deepEqual(parseArgs([]), { label: null });
});

test('parseArgs: --label <name> is captured', () => {
  assert.deepEqual(parseArgs(['--label', 'baseline']), { label: 'baseline' });
});

test('parseArgs: --label at end of argv with no value is treated as absent', () => {
  assert.deepEqual(parseArgs(['--label']), { label: null });
});

test('parseArgs: --label immediately followed by another flag is treated as absent', () => {
  assert.deepEqual(parseArgs(['--label', '--other']), { label: null });
});

test('parseArgs: unrelated flags are ignored', () => {
  assert.deepEqual(parseArgs(['--verbose', '--label', 'foo', '--extra']), { label: 'foo' });
});

// =============================================================================
// computeStats
// =============================================================================

test('computeStats: odd-length sample — median is the middle value', () => {
  const { minMs, medianMs } = computeStats([30, 10, 20]);
  assert.equal(minMs, 10);
  assert.equal(medianMs, 20);
});

test('computeStats: even-length sample — median is the average of the two middles', () => {
  const { minMs, medianMs } = computeStats([40, 10, 30, 20]);
  assert.equal(minMs, 10);
  assert.equal(medianMs, 25);
});

test('computeStats: single sample — min and median both equal it', () => {
  assert.deepEqual(computeStats([42]), { minMs: 42, medianMs: 42 });
});

test('computeStats: empty input yields nulls, not a throw', () => {
  assert.deepEqual(computeStats([]), { minMs: null, medianMs: null });
});

test('computeStats: does not mutate the input array', () => {
  const samples = [30, 10, 20];
  computeStats(samples);
  assert.deepEqual(samples, [30, 10, 20]);
});

// =============================================================================
// findLargestEventsLog — synthetic fixture dir (never the real repo _logs/)
// =============================================================================

function makeLogsFixture() {
  const root = mkdtempSync(join(tmpdir(), 'perf-snapshot-logs-'));
  mkdirSync(join(root, 'cycle-small'), { recursive: true });
  writeFileSync(join(root, 'cycle-small', 'events.jsonl'), 'a'.repeat(10));
  mkdirSync(join(root, 'cycle-large'), { recursive: true });
  writeFileSync(join(root, 'cycle-large', 'events.jsonl'), 'b'.repeat(500));
  // A cycle dir with no events.jsonl at all — must be skipped, not crash.
  mkdirSync(join(root, 'cycle-no-events'), { recursive: true });
  writeFileSync(join(root, 'cycle-no-events', 'stderr.log'), 'irrelevant');
  // A stray FILE (not a dir) at the top level — must be skipped, not crash.
  writeFileSync(join(root, 'stray.txt'), 'irrelevant');
  return root;
}

test('findLargestEventsLog: picks the cycle dir with the largest events.jsonl', () => {
  const root = makeLogsFixture();
  try {
    const best = findLargestEventsLog(root);
    assert.equal(best.cycleId, 'cycle-large');
    assert.equal(best.bytes, 500);
    assert.equal(best.path, join(root, 'cycle-large', 'events.jsonl'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findLargestEventsLog: returns null when logsRoot does not exist', () => {
  assert.equal(findLargestEventsLog(join(tmpdir(), 'perf-snapshot-does-not-exist-xyz')), null);
});

test('findLargestEventsLog: returns null when logsRoot has no cycle dirs with events.jsonl', () => {
  const root = mkdtempSync(join(tmpdir(), 'perf-snapshot-empty-'));
  try {
    mkdirSync(join(root, 'no-events-here'), { recursive: true });
    assert.equal(findLargestEventsLog(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findLargestEventsLog: returns null (not a throw) when logsRoot exists but is not a directory (ENOTDIR)', () => {
  const root = mkdtempSync(join(tmpdir(), 'perf-snapshot-notdir-'));
  const notADir = join(root, 'actually-a-file');
  try {
    writeFileSync(notADir, 'irrelevant');
    // readdirSync(notADir) throws ENOTDIR — findLargestEventsLog must catch
    // it and return null, matching the adjacent statSync guard's contract,
    // not propagate and crash the whole snapshot.
    assert.equal(findLargestEventsLog(notADir), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================
// timeFetch / measureApiEndpoint — stubbed fetch, no live server
// =============================================================================

test('timeFetch: ok response — status/bytes/ok pass through, ms is a non-negative number', async () => {
  const stub = makeStubFetch([{ ok: true, status: 200, bytes: 37 }]);
  const r = await timeFetch('http://x/api/thing', stub);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.bytes, 37);
  assert.equal(typeof r.ms, 'number');
  assert.ok(r.ms >= 0);
});

test('timeFetch: non-2xx response is returned, not thrown — ok:false, status/bytes still captured', async () => {
  const stub = makeStubFetch([{ ok: false, status: 500, bytes: 12 }]);
  const r = await timeFetch('http://x/api/thing', stub);
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.bytes, 12);
});

test('measureApiEndpoint: all-ok samples — errors:0, min/median computed over all N, bytes from the last response', async () => {
  const stub = makeStubFetch([
    { ok: true, status: 200, bytes: 100 },
    { ok: true, status: 200, bytes: 100 },
    { ok: true, status: 200, bytes: 100 },
  ]);
  const r = await measureApiEndpoint('http://x', '/api/runs', 3, stub);
  assert.equal(r.name, '/api/runs');
  assert.equal(r.errors, 0);
  assert.equal(r.samples.length, 3);
  assert.deepEqual(r.statuses, [200, 200, 200]);
  assert.equal(r.bytes, 100);
  assert.equal(typeof r.minMs, 'number');
  assert.equal(typeof r.medianMs, 'number');
});

test('measureApiEndpoint: a non-2xx sample is recorded but EXCLUDED from min/median, and counted in errors', async () => {
  const stub = makeStubFetch([
    { ok: true, status: 200, bytes: 100 },
    { ok: false, status: 500, bytes: 5 },
    { ok: true, status: 200, bytes: 100 },
  ]);
  const r = await measureApiEndpoint('http://x', '/api/runs', 3, stub);
  assert.equal(r.errors, 1);
  assert.deepEqual(r.statuses, [200, 500, 200]);
  // samples[] keeps the raw per-call ms (including the errored call) for
  // the JSON record, but min/median must come from the two OK calls only —
  // a 500 must never read as a fast sample.
  assert.equal(r.samples.length, 3);
  assert.equal(typeof r.minMs, 'number');
  assert.equal(typeof r.medianMs, 'number');
  // bytes reports the last OK response (100), not the 500's body (5).
  assert.equal(r.bytes, 100);
});

test('measureApiEndpoint: every sample non-2xx — min/median are null (no valid latency data), errors:N, bytes still diagnostic', async () => {
  const stub = makeStubFetch([
    { ok: false, status: 503, bytes: 8 },
    { ok: false, status: 503, bytes: 9 },
    { ok: false, status: 503, bytes: 10 },
  ]);
  const r = await measureApiEndpoint('http://x', '/api/runs', 3, stub);
  assert.equal(r.errors, 3);
  assert.equal(r.minMs, null);
  assert.equal(r.medianMs, null);
  assert.equal(r.bytes, 10); // last response's body size, for diagnosis
});

test('measureApiEndpoint: a thrown fetch (network failure) is caught per-sample, not propagated, and counts as an error', async () => {
  const stub = makeStubFetch([
    { ok: true, status: 200, bytes: 100 },
    { throwError: new Error('ECONNRESET') },
    { ok: true, status: 200, bytes: 100 },
  ]);
  const r = await measureApiEndpoint('http://x', '/api/runs', 3, stub);
  assert.equal(r.errors, 1);
  assert.equal(r.statuses[1], null);
  // The two OK samples' stats must still be present — one thrown sample
  // must not cost the other two already-collected results.
  assert.equal(typeof r.minMs, 'number');
  assert.equal(typeof r.medianMs, 'number');
});

// =============================================================================
// isoTimestampForFilename
// =============================================================================

test('isoTimestampForFilename: replaces colons and dots so it is filename-safe', () => {
  // Date.UTC month is 0-indexed — 7 is August. toISOString() of this instant
  // is '2026-08-15T02:10:33.123Z'; the colons/dot must become dashes.
  const fixed = new Date(Date.UTC(2026, 7, 15, 2, 10, 33, 123));
  const out = isoTimestampForFilename(fixed);
  assert.equal(out, '2026-08-15T02-10-33-123Z');
});

test('isoTimestampForFilename: defaults to now() when no date is passed', () => {
  const before = Date.now();
  const out = isoTimestampForFilename();
  const after = Date.now();
  assert.equal(/[:.]/.test(out), false);
  const reparsed = Date.parse(out.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, 'T$1:$2:$3.$4Z'));
  assert.ok(reparsed >= before && reparsed <= after);
});

// =============================================================================
// formatMarkdownTable
// =============================================================================

test('formatMarkdownTable: renders header, divider, and one row per entry', () => {
  const table = formatMarkdownTable([
    { name: '/api/runs', medianMs: 12.345, bytes: 245 },
    { name: '/ (page)', medianMs: 800, bytes: null },
  ]);
  const lines = table.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '| endpoint/page | median ms | bytes |');
  assert.equal(lines[1], '| --- | --- | --- |');
  assert.equal(lines[2], '| /api/runs | 12.35 | 245 |');
  assert.equal(lines[3], '| / (page) | 800.00 | - |');
});

test('formatMarkdownTable: empty input renders just header + divider', () => {
  assert.equal(formatMarkdownTable([]), '| endpoint/page | median ms | bytes |\n| --- | --- | --- |');
});
