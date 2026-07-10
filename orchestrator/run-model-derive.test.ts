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
import { buildNodeMeta, deriveWorkItems } from './run-model-derive.ts';
import type { EventLogEntry, Phase } from './logging.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let seq = 0;
function ev(
  phase: Phase | string,
  event_type: string,
  opts: { cost_usd?: number; message?: string; work_item_id?: string; status?: string } = {},
): EventLogEntry {
  seq += 1;
  const metadata: Record<string, unknown> = {};
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
