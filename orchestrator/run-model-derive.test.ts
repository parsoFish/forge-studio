/**
 * Tests for run-model-derive.ts cost derivation (plan item 1.8 + 1.4).
 *
 * Pins the cost-summation rule shared with cli/metrics.ts aggregate()
 * (orchestrator/event-cost.ts): iteration-loop phases restate their
 * iteration spend on per-WI 'end' + phase-level 'end' rollup events, so
 * naively summing every event double/triple-counts. buildNodeMeta feeds
 * Studio's phase-hex cost badges (data-phase-cost-usd) — it must not
 * overstate. deriveWorkItems carries per-WI cost (data-wi-cost-usd).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeMeta, deriveWorkItems, findDelivered } from './run-model-derive.ts';
import type { EventLogEntry, Phase } from './logging.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let seq = 0;
function ev(
  phase: Phase | string,
  event_type: string,
  opts: {
    cost_usd?: number;
    message?: string;
    work_item_id?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  } = {},
): EventLogEntry {
  seq += 1;
  const metadata: Record<string, unknown> = { ...opts.metadata };
  if (opts.work_item_id !== undefined) metadata.work_item_id = opts.work_item_id;
  if (opts.status !== undefined) metadata.status = opts.status;
  return {
    event_id: `e-${seq}`,
    cycle_id: 'CYCLE-test',
    initiative_id: 'INIT-test',
    phase: phase as Phase,
    skill: phase as string,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    ...(opts.cost_usd !== undefined ? { cost_usd: opts.cost_usd } : {}),
    ...(opts.message !== undefined ? { message: opts.message } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  } as EventLogEntry;
}

// ---------------------------------------------------------------------------
// buildNodeMeta cost (1.8 — the double-count defect)
// ---------------------------------------------------------------------------

test('buildNodeMeta: iteration-loop node counts only iteration cost (no 3x restatement)', () => {
  // Real pattern: each WI emits iteration + a restating per-WI ralph.end,
  // then the phase emits a rollup end restating the per-WI sum. True spend
  // is the iteration sum alone.
  const events = [
    ev('developer-loop', 'iteration', { cost_usd: 1.027781, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.027781, message: 'ralph.end', work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.439271, work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 0.439271, message: 'ralph.end', work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 1.467052 }), // phase-level rollup
  ];
  const meta = buildNodeMeta('dev', events, 8, Date.now());
  assert.ok(
    Math.abs(meta.costUsd - 1.467052) < 0.000001,
    `dev node cost should be ~1.467052 (iterations only), got ${meta.costUsd}`,
  );
});

test('buildNodeMeta: unifier node counts only iteration cost (no 2x restatement)', () => {
  const events = [
    ev('unifier', 'iteration', { cost_usd: 0.665096, work_item_id: 'UWI-1' }),
    ev('unifier', 'end', { cost_usd: 0.665096, message: 'unifier.end' }),
  ];
  const meta = buildNodeMeta('unifier', events, 8, Date.now());
  assert.ok(
    Math.abs(meta.costUsd - 0.665096) < 0.000001,
    `unifier node cost should be ~0.665096 (1x), got ${meta.costUsd}`,
  );
});

test('buildNodeMeta: single-call node keeps end-event cost (not zeroed)', () => {
  const events = [
    ev('project-manager', 'start'),
    ev('project-manager', 'end', { cost_usd: 0.700842 }),
  ];
  const meta = buildNodeMeta('pm', events, 8, Date.now());
  assert.ok(
    Math.abs(meta.costUsd - 0.700842) < 0.000001,
    `pm node cost should be ~0.700842, got ${meta.costUsd}`,
  );
});

test('buildNodeMeta: non-loop node keeps terminal error-event cost', () => {
  // A phase rejected before completing carries its spend on the terminal
  // 'error' event (cost-autopsy §4.1) — a non-looping phase must count it.
  const events = [
    ev('project-manager', 'start'),
    ev('project-manager', 'error', { cost_usd: 0.31 }),
  ];
  const meta = buildNodeMeta('pm', events, 8, Date.now());
  assert.ok(
    Math.abs(meta.costUsd - 0.31) < 0.000001,
    `pm node cost should keep error-event cost 0.31, got ${meta.costUsd}`,
  );
});

// ---------------------------------------------------------------------------
// deriveWorkItems per-WI cost (1.4 — per-WI attribution)
// ---------------------------------------------------------------------------

const DEV_MAPPING = new Map<string, string | null>([
  ['developer-loop', 'dev'],
  ['project-manager', 'pm'],
  ['unifier', 'unifier'],
  ['orchestrator', null],
]);

test('deriveWorkItems: per-WI costUsd from WI-scoped iteration events (restating ends excluded)', () => {
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.6, work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.4, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.0, message: 'ralph.end', work_item_id: 'WI-1', status: 'complete' }),
    ev('developer-loop', 'start', { work_item_id: 'WI-2' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.25, work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 0.25, message: 'ralph.end', work_item_id: 'WI-2', status: 'complete' }),
    ev('developer-loop', 'end', { cost_usd: 1.25 }), // phase rollup (no WI id)
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  assert.equal(wis.length, 2);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  const wi2 = wis.find((w) => w.id === 'WI-2');
  assert.ok(wi1 && Math.abs(wi1.costUsd - 1.0) < 0.000001,
    `WI-1 cost should be ~1.0 (its iterations only), got ${wi1?.costUsd}`);
  assert.ok(wi2 && Math.abs(wi2.costUsd - 0.25) < 0.000001,
    `WI-2 cost should be ~0.25, got ${wi2?.costUsd}`);
});

test('deriveWorkItems: per-WI costs stay consistent with the phase rule when the phase looped', () => {
  // WI-2 crashed before its first iteration; its 'end' carries a cost figure.
  // Because the dev phase DID loop (WI-1 iterated), only iteration events are
  // authoritative — the same rule that keeps the phase badge honest — so WI-2
  // attributes 0 rather than restated/rolled-up dollars.
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.5, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 0.5, message: 'ralph.end', work_item_id: 'WI-1', status: 'complete' }),
    ev('developer-loop', 'start', { work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 0.2, message: 'ralph.end', work_item_id: 'WI-2', status: 'failed' }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  const wi2 = wis.find((w) => w.id === 'WI-2');
  assert.ok(wi1 && Math.abs(wi1.costUsd - 0.5) < 0.000001, `WI-1 cost ~0.5, got ${wi1?.costUsd}`);
  assert.ok(wi2 && wi2.costUsd === 0, `WI-2 cost should be 0 (no iterations), got ${wi2?.costUsd}`);
});

test('deriveWorkItems: a non-looping dev stream keeps per-WI end cost (nothing to restate)', () => {
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 0.3, message: 'ralph.end', work_item_id: 'WI-1', status: 'complete' }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  assert.ok(wi1 && Math.abs(wi1.costUsd - 0.3) < 0.000001,
    `WI-1 cost should be ~0.3 (end cost, no iterations in phase), got ${wi1?.costUsd}`);
});

// ---------------------------------------------------------------------------
// deriveWorkItems crash-retry override — Phase 4/2 regression
// brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-failed-wi.md
// ---------------------------------------------------------------------------

test('deriveWorkItems: a failed WI with a dev-loop.discarded event carrying commits reads as retrying, not failed', () => {
  // A WI that auto-committed real work then crashed is recoverable — status
  // must still flip to 'retrying' even though its diff-stat now lives on
  // dev-loop.discarded (message mismatch alone would otherwise hide it from
  // the override, since findDelivered is honest/success-only).
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { message: 'ralph.end', work_item_id: 'WI-1', status: 'failed' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 3, insertions: 40, deletions: 1, commits: 2, outcome: 'failed' },
    }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  assert.equal(wi1?.status, 'retrying', 'a WI that committed real work before crashing must not read as a hard failure');
  assert.equal(wi1?.delivered, undefined, 'delivered stays honest/undefined — the WI did not ship, it is retrying');
});

test('deriveWorkItems: a failed WI with a zero-commit dev-loop.discarded event stays failed (no override)', () => {
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { message: 'ralph.end', work_item_id: 'WI-1', status: 'failed' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 0, insertions: 0, deletions: 0, commits: 0, outcome: 'failed' },
    }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  assert.equal(wi1?.status, 'failed', 'nothing recoverable was committed — must stay a hard failure');
});

test('deriveWorkItems: a failed WI whose only earlier delivered attempt was superseded by a later discarded attempt is not treated as delivered', () => {
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 2, insertions: 30, deletions: 0, commits: 1, outcome: 'complete' },
    }),
    ev('developer-loop', 'end', { message: 'ralph.end', work_item_id: 'WI-1', status: 'failed' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 5, insertions: 12, deletions: 3, commits: 1, outcome: 'failed' },
    }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  assert.equal(wi1?.status, 'retrying', 'the later discarded attempt still carries commits, so the crash-retry override applies');
  assert.equal(wi1?.delivered, undefined, 'the stale earlier delivered event must not resurface once superseded');
});

test('deriveWorkItems: a shipped WI followed by a harmless duplicate-dev-loop-after-PR-open zero-diff delivered re-run keeps its real delivered stat', () => {
  // brain/cycles/themes/2026-07-03-duplicate-dev-loop-after-pr-open.md — a
  // dev-loop re-run after the PR is already open can emit a second, trivial
  // all-zero dev-loop.delivered event for a WI that already shipped real
  // work. FIX ROUND 2 regression: the round-1 fix's findLatestWiVerdict
  // (single-event, no zero-diff skip) made findDelivered return undefined
  // for this exact sequence, erasing the real earlier diff-stat.
  const events = [
    ev('developer-loop', 'start', { work_item_id: 'WI-1' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 5, insertions: 90, deletions: 1, commits: 2, outcome: 'complete' },
    }),
    ev('developer-loop', 'end', { message: 'ralph.end', work_item_id: 'WI-1', status: 'complete' }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 0, insertions: 0, deletions: 0, commits: 0, outcome: 'complete' },
    }),
    ev('developer-loop', 'end', { message: 'ralph.end', work_item_id: 'WI-1', status: 'complete' }),
  ];
  const wis = deriveWorkItems(events, DEV_MAPPING);
  const wi1 = wis.find((w) => w.id === 'WI-1');
  assert.equal(wi1?.status, 'complete');
  assert.deepEqual(
    wi1?.delivered,
    { files: 5, insertions: 90, commits: 2 },
    'the real delivered stat must survive a trivial zero-diff duplicate re-run',
  );
});

// ---------------------------------------------------------------------------
// findDelivered — Phase 4/2 honest delivery events (delivered is success-only)
// brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-failed-wi.md
// ---------------------------------------------------------------------------

test('findDelivered: a WI-scoped dev-loop.delivered event (outcome complete) is returned', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 4, insertions: 182, deletions: 2, commits: 1, outcome: 'complete' },
    }),
  ];
  assert.deepEqual(findDelivered(events, 'WI-1'), { files: 4, insertions: 182, commits: 1 });
});

test('findDelivered: a dev-loop.discarded event for the same WI is never matched (message mismatch)', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 4, insertions: 182, deletions: 2, commits: 1, outcome: 'failed' },
    }),
  ];
  assert.equal(findDelivered(events, 'WI-1'), undefined, 'a failed WI must never read as delivered');
});

test('findDelivered: an explicit outcome other than complete is never matched, even under the dev-loop.delivered message (defense-in-depth)', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 4, insertions: 182, commits: 1, outcome: 'failed' },
    }),
  ];
  assert.equal(findDelivered(events, 'WI-1'), undefined);
});

test('findDelivered: the cycle-level aggregate (no work_item_id, no outcome field) still matches as before', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { files_changed: 7, insertions: 120, commits: 4 },
    }),
  ];
  assert.deepEqual(findDelivered(events), { files: 7, insertions: 120, commits: 4 });
});

test('findDelivered: a resumed WI with an earlier discarded attempt and a later delivered attempt returns only the delivered stat', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 0, insertions: 0, deletions: 0, commits: 0, outcome: 'failed' },
    }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 2, insertions: 426, deletions: 0, commits: 1, outcome: 'complete' },
    }),
  ];
  assert.deepEqual(findDelivered(events, 'WI-1'), { files: 2, insertions: 426, commits: 1 });
});

test('findDelivered: a WI with an earlier delivered attempt and a LATER discarded attempt (rework failed) returns undefined, not the stale delivered stats', () => {
  // Regression: findDelivered used to match strictly on message name, so a
  // backward scan would skip the newer dev-loop.discarded (message
  // mismatch) and fall through to the older dev-loop.delivered — resurfacing
  // stale success stats for a WI whose rework attempt actually failed.
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 2, insertions: 30, deletions: 0, commits: 1, outcome: 'complete' },
    }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.discarded',
      metadata: { work_item_id: 'WI-1', files_changed: 5, insertions: 12, deletions: 3, commits: 1, outcome: 'failed' },
    }),
  ];
  assert.equal(findDelivered(events, 'WI-1'), undefined, 'the later discarded attempt must supersede the earlier delivered one');
});

// ---------------------------------------------------------------------------
// findDelivered — FIX ROUND 2 regression: a trivial all-zero dev-loop.delivered
// re-run (duplicate-dev-loop-after-PR-open,
// brain/cycles/themes/2026-07-03-duplicate-dev-loop-after-pr-open.md) must
// not erase an earlier, genuinely non-zero delivered stat for the same WI.
// ---------------------------------------------------------------------------

test('findDelivered: a real delivered diff followed by a later trivial all-zero delivered re-run still returns the real diff', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 5, insertions: 90, deletions: 1, commits: 2, outcome: 'complete' },
    }),
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 0, insertions: 0, deletions: 0, commits: 0, outcome: 'complete' },
    }),
  ];
  assert.deepEqual(
    findDelivered(events, 'WI-1'),
    { files: 5, insertions: 90, commits: 2 },
    'the trivial zero-diff re-run carries no information and must not shadow the earlier real delivery',
  );
});

test('findDelivered: a trivial all-zero delivered event with no earlier meaningful delivery still returns undefined', () => {
  const events = [
    ev('developer-loop', 'log', {
      message: 'dev-loop.delivered',
      metadata: { work_item_id: 'WI-1', files_changed: 0, insertions: 0, deletions: 0, commits: 0, outcome: 'complete' },
    }),
  ];
  assert.equal(findDelivered(events, 'WI-1'), undefined, 'a genuinely empty delivery has nothing meaningful to surface');
});
