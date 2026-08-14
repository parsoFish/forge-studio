/**
 * perf-snapshot.test.ts — unit tests for the PURE helpers in
 * scripts/perf-snapshot.mjs (W6-P0). Named `.test.ts` (not `.test.mjs`) to
 * match this repo's `npm test` glob (`scripts/*.test.ts` in package.json's
 * "test" script — a plain `.test.mjs` file here would silently NOT run).
 * scripts/ is outside tsconfig.json's `include`, so this file is exercised
 * only via `node --test --experimental-strip-types`, never `tsc`.
 *
 * Covers the impure I/O paths (bridge-health probe, fetch timing, Playwright
 * page loads, fs writes) are exercised for real by an operator running
 * `npm run perf:snapshot` against a live `forge studio` — that requires a
 * running bridge and is explicitly out of scope for an automated unit test
 * (and for this lane, which must not touch a live bridge). This file only
 * covers the deterministic, dependency-free helpers: arg parsing, stats,
 * largest-log discovery (via a synthetic fixture dir), timestamp formatting,
 * and table rendering.
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
} from './perf-snapshot.mjs';

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
