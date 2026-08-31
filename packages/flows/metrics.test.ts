/**
 * Tests for cli/metrics.ts aggregate() — guards the per-phase cost
 * de-duplication logic so developer-loop and unifier costs are never
 * double/triple-counted via restating 'end' events.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './metrics.ts';
import type { EventLogEntry, Phase } from '../orchestrator/logging.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let seq = 0;
function ev(
  phase: Phase | string,
  event_type: string,
  opts: { cost_usd?: number; duration_ms?: number; message?: string; tokens_in?: number; tokens_out?: number; work_item_id?: string; skill?: string } = {},
): EventLogEntry {
  seq += 1;
  return {
    event_id: `e-${seq}`,
    initiative_id: 'INIT-test',
    cycle_id: 'CYCLE-test',
    started_at: new Date().toISOString(),
    phase: phase as Phase,
    skill: opts.skill ?? (phase as string),
    event_type,
    message: opts.message ?? '',
    cost_usd: opts.cost_usd,
    duration_ms: opts.duration_ms,
    tokens_in: opts.tokens_in,
    tokens_out: opts.tokens_out,
    metadata: opts.work_item_id ? { work_item_id: opts.work_item_id } : undefined,
  } as unknown as EventLogEntry;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('aggregate: developer-loop 3x → 1x (only iteration events counted)', () => {
  // Mirrors the real pattern: WI-1 and WI-2 each emit iteration + ralph.end,
  // then the phase emits a phase-level end that re-sums all WIs.
  const events = [
    ev('developer-loop', 'iteration', { cost_usd: 1.027781, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.027781, message: 'ralph.end', work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.439271, work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 0.439271, message: 'ralph.end', work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 1.467052 }), // phase-level rollup
  ];
  const m = aggregate('CYCLE-test', events);
  // True spend = WI-1 + WI-2 = 1.467052
  assert.ok(
    Math.abs(m.per_phase['developer-loop']!.cost_usd - 1.467052) < 0.000001,
    `developer-loop cost should be ~1.467052 (1x), got ${m.per_phase['developer-loop']!.cost_usd}`,
  );
  assert.ok(
    Math.abs(m.total_cost_usd - 1.467052) < 0.000001,
    `total_cost_usd should equal developer-loop cost (only phase), got ${m.total_cost_usd}`,
  );
});

test('aggregate: unifier 2x → 1x (iteration+end → only iteration)', () => {
  const events = [
    ev('unifier', 'iteration', { cost_usd: 0.665096, work_item_id: 'UWI-1' }),
    ev('unifier', 'end', { cost_usd: 0.665096, message: 'unifier.end' }),
  ];
  const m = aggregate('CYCLE-test', events);
  assert.ok(
    Math.abs(m.per_phase['unifier']!.cost_usd - 0.665096) < 0.000001,
    `unifier cost should be ~0.665096 (1x), got ${m.per_phase['unifier']!.cost_usd}`,
  );
});

test('aggregate: single-call phases (PM, reflection, closure) use end cost (no iteration events → not zeroed)', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.700842 }),
    ev('reflection', 'end', { cost_usd: 0.866460, message: 'reflector.end' }),
  ];
  const m = aggregate('CYCLE-test', events);
  assert.ok(
    Math.abs(m.per_phase['project-manager']!.cost_usd - 0.700842) < 0.000001,
    `PM cost should be ~0.700842, got ${m.per_phase['project-manager']!.cost_usd}`,
  );
  assert.ok(
    Math.abs(m.per_phase['reflection']!.cost_usd - 0.866460) < 0.000001,
    `reflection cost should be ~0.866460, got ${m.per_phase['reflection']!.cost_usd}`,
  );
});

test('aggregate: full cycle matches real evidence (dev 1x + unifier 1x + PM + reflection)', () => {
  // Mirrors the 2026-06-08 schema-audit cycle events exactly.
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.700842 }),
    ev('developer-loop', 'iteration', { cost_usd: 1.027781, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.027781, message: 'ralph.end', work_item_id: 'WI-1' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.439271, work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 0.439271, message: 'ralph.end', work_item_id: 'WI-2' }),
    ev('developer-loop', 'end', { cost_usd: 1.467051 }),
    ev('unifier', 'iteration', { cost_usd: 0.665096, work_item_id: 'UWI-1' }),
    ev('unifier', 'end', { cost_usd: 0.665096, message: 'unifier.end' }),
    ev('reflection', 'end', { cost_usd: 0.866460, message: 'reflector.end' }),
  ];
  const m = aggregate('CYCLE-test', events);
  // developer-loop: only 2 iteration events = 1.027781 + 0.439271 = 1.467052
  assert.ok(Math.abs(m.per_phase['developer-loop']!.cost_usd - 1.467052) < 0.000001,
    `dev-loop got ${m.per_phase['developer-loop']!.cost_usd}`);
  // unifier: 1 iteration event = 0.665096
  assert.ok(Math.abs(m.per_phase['unifier']!.cost_usd - 0.665096) < 0.000001,
    `unifier got ${m.per_phase['unifier']!.cost_usd}`);
  // PM + reflection unchanged
  assert.ok(Math.abs(m.per_phase['project-manager']!.cost_usd - 0.700842) < 0.000001,
    `PM got ${m.per_phase['project-manager']!.cost_usd}`);
  assert.ok(Math.abs(m.per_phase['reflection']!.cost_usd - 0.866460) < 0.000001,
    `reflection got ${m.per_phase['reflection']!.cost_usd}`);
  // total = 0.700842 + 1.467052 + 0.665096 + 0.866460 = 3.699450
  const expectedTotal = 0.700842 + 1.467052 + 0.665096 + 0.866460;
  assert.ok(Math.abs(m.total_cost_usd - expectedTotal) < 0.000001,
    `total got ${m.total_cost_usd}, expected ${expectedTotal}`);
});

test('aggregate: per_skill does not restate iteration-loop cost (developer-ralph 3x → 1x)', () => {
  // Plan item 1.8: per_skill summed cost_usd across ALL events unconditionally,
  // so an iteration-loop skill (developer-ralph, developer-unifier) was
  // double/triple-counted via the per-WI 'ralph.end' + phase-level 'end'
  // restatements. per_skill must follow the same rule as per_phase.
  const events = [
    ev('developer-loop', 'iteration', { cost_usd: 1.027781, work_item_id: 'WI-1', skill: 'developer-ralph' }),
    ev('developer-loop', 'end', { cost_usd: 1.027781, message: 'ralph.end', work_item_id: 'WI-1', skill: 'developer-ralph' }),
    ev('developer-loop', 'iteration', { cost_usd: 0.439271, work_item_id: 'WI-2', skill: 'developer-ralph' }),
    ev('developer-loop', 'end', { cost_usd: 0.439271, message: 'ralph.end', work_item_id: 'WI-2', skill: 'developer-ralph' }),
    ev('developer-loop', 'end', { cost_usd: 1.467052, skill: 'developer-ralph' }), // phase-level rollup
    ev('unifier', 'iteration', { cost_usd: 0.665096, work_item_id: 'UWI-1', skill: 'developer-unifier' }),
    ev('unifier', 'end', { cost_usd: 0.665096, message: 'unifier.end', skill: 'developer-unifier' }),
  ];
  const m = aggregate('CYCLE-test', events);
  assert.ok(
    Math.abs(m.per_skill['developer-ralph']!.cost_usd - 1.467052) < 0.000001,
    `developer-ralph cost should be ~1.467052 (1x), got ${m.per_skill['developer-ralph']!.cost_usd}`,
  );
  assert.ok(
    Math.abs(m.per_skill['developer-unifier']!.cost_usd - 0.665096) < 0.000001,
    `developer-unifier cost should be ~0.665096 (1x), got ${m.per_skill['developer-unifier']!.cost_usd}`,
  );
});

test('aggregate: per_skill keeps end-event cost for single-call skills', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.700842, skill: 'project-manager' }),
    ev('reflection', 'end', { cost_usd: 0.866460, message: 'reflector.end', skill: 'reflector' }),
  ];
  const m = aggregate('CYCLE-test', events);
  assert.ok(
    Math.abs(m.per_skill['project-manager']!.cost_usd - 0.700842) < 0.000001,
    `project-manager skill cost should be ~0.700842, got ${m.per_skill['project-manager']!.cost_usd}`,
  );
  assert.ok(
    Math.abs(m.per_skill['reflector']!.cost_usd - 0.866460) < 0.000001,
    `reflector skill cost should be ~0.866460, got ${m.per_skill['reflector']!.cost_usd}`,
  );
});

test('aggregate: sum of per_skill costs equals total_cost_usd (mixed loop + single-call)', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.5, skill: 'project-manager' }),
    ev('developer-loop', 'iteration', { cost_usd: 1.0, work_item_id: 'WI-1', skill: 'developer-ralph' }),
    ev('developer-loop', 'end', { cost_usd: 1.0, message: 'ralph.end', work_item_id: 'WI-1', skill: 'developer-ralph' }),
    ev('developer-loop', 'end', { cost_usd: 1.0, skill: 'developer-ralph' }),
    ev('unifier', 'iteration', { cost_usd: 0.25, work_item_id: 'UWI-1', skill: 'developer-unifier' }),
    ev('unifier', 'end', { cost_usd: 0.25, message: 'unifier.end', skill: 'developer-unifier' }),
  ];
  const m = aggregate('CYCLE-test', events);
  const skillSum = Object.values(m.per_skill).reduce((s, p) => s + p.cost_usd, 0);
  assert.ok(
    Math.abs(m.total_cost_usd - skillSum) < 0.000001,
    `total_cost_usd ${m.total_cost_usd} should equal sum of per_skill costs ${skillSum}`,
  );
});

test('aggregate: total_cost_usd equals sum of per_phase costs', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.5 }),
    ev('developer-loop', 'iteration', { cost_usd: 1.0, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.0, message: 'ralph.end', work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.0 }),
  ];
  const m = aggregate('CYCLE-test', events);
  const phaseSum = Object.values(m.per_phase).reduce((s, p) => s + p.cost_usd, 0);
  assert.ok(
    Math.abs(m.total_cost_usd - phaseSum) < 0.000001,
    `total_cost_usd ${m.total_cost_usd} should equal sum of per_phase costs ${phaseSum}`,
  );
});
