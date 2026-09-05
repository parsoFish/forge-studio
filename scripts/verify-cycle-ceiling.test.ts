/**
 * Bead forge-8vfn.6.10.23, half 1 — `--cost-ceiling` must BIND the run.
 *
 * Measured during G2 (2026-09-05): the operator authorised $20, the harness was
 * given `--cost-ceiling 20`, and the flag reached exactly one place —
 * `verify-cycle.mjs`'s post-run assertion, which sums `totalCost` after the
 * money is spent and reports failure. Nothing was threaded into the run, so the
 * ceiling the CostTracker actually enforced was the manifest's derivation ($58
 * at the time). The flag reported an overspend it had no power to prevent.
 *
 * Tested here rather than only through a funded run (§15.163): the decision is a
 * pure function of argv, so it is exercised by the suite instead of costing $20
 * to observe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { harnessCeilingEnv } from './verify-cycle-ceiling.mjs';

const DEFAULT = 35;

test('an explicit --cost-ceiling BINDS the run: it is threaded as FORGE_COST_CEILING_USD, not merely asserted afterwards', () => {
  const r = harnessCeilingEnv(['--project', 'gitpulse', '--cost-ceiling', '20'], DEFAULT);
  assert.equal(r.ceilingUsd, 20);
  assert.equal(r.bound, true);
  assert.deepEqual(r.env, { FORGE_COST_CEILING_USD: '20' }, 'the flag must reach the run through the env var resolveCostCeilingOverride reads');
});

test('a fractional ceiling survives the round trip through the env var', () => {
  const r = harnessCeilingEnv(['--cost-ceiling', '12.5'], DEFAULT);
  assert.equal(r.ceilingUsd, 12.5);
  assert.deepEqual(r.env, { FORGE_COST_CEILING_USD: '12.5' });
});

test('NO flag leaves the run bound by its manifest — the harness default is a gate assertion, never a silent override of the operator\'s ceiling', () => {
  const r = harnessCeilingEnv(['--project', 'gitpulse'], DEFAULT);
  assert.equal(r.ceilingUsd, DEFAULT, 'the post-run assertion still uses the default');
  assert.equal(r.bound, false);
  assert.deepEqual(r.env, {}, 'threading the DEFAULT would override a manifest cost_ceiling_usd nobody asked to override — env beats manifest');
});

test('a malformed --cost-ceiling FAILS LOUD instead of falling back to a ceiling nobody chose', () => {
  // The whole defect this bead closes is a ceiling silently not being the one
  // the operator set. A typo'd flag that fell back to the default would be the
  // same failure wearing a different hat.
  assert.throws(() => harnessCeilingEnv(['--cost-ceiling', 'twenty'], DEFAULT), /--cost-ceiling/);
  assert.throws(() => harnessCeilingEnv(['--cost-ceiling', '0'], DEFAULT), /--cost-ceiling/);
  assert.throws(() => harnessCeilingEnv(['--cost-ceiling', '-5'], DEFAULT), /--cost-ceiling/);
  assert.throws(() => harnessCeilingEnv(['--cost-ceiling'], DEFAULT), /--cost-ceiling/);
  assert.throws(() => harnessCeilingEnv(['--cost-ceiling', '--project'], DEFAULT), /--cost-ceiling/);
});
