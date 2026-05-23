/**
 * Tests for the token-economy A/B ratchet harness.
 *
 * S8 / WI-5 — the harness measures cost-per-cycle deltas vs a frozen
 * baseline (`baseline.json`). The ratchet is `delta_pct < 0`: every
 * Plan 08 PR must strictly improve. This test suite proves:
 *
 * 1. `loadBaseline()` reads `baseline.json` and returns the frozen snapshot.
 * 2. `computeDelta()` computes `delta_pct` correctly for improvement /
 *    regression / no-change.
 * 3. `ratchet()` exits 0 on improvement, 1 on regression — exactly the
 *    behaviour `score.ts` wraps.
 * 4. A synthetic A/B run proves the harness measures what it claims
 *    (improvement in cache_read_tokens + lower cost_usd => improved=true).
 *
 * The harness is deliberately SYNTHETIC — it does not invoke the SDK.
 * Running the live e2e bench is operator-driven; this harness ratchets
 * its OUTPUT against the locked baseline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeDelta,
  loadBaseline,
  ratchet,
  type BenchResult,
} from './harness.ts';

test('loadBaseline: parses the frozen baseline.json snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-econ-baseline-'));
  try {
    const path = join(dir, 'baseline.json');
    writeFileSync(
      path,
      JSON.stringify({
        fixture: 'slugifier-basic',
        cost_usd: 2.35,
        tokens_in: 100_000,
        tokens_out: 12_000,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        recorded_at: '2026-05-23T00:00:00Z',
        contract: 'C19-baseline',
      }),
    );
    const baseline = loadBaseline(path);
    assert.equal(baseline.fixture, 'slugifier-basic');
    assert.equal(baseline.cost_usd, 2.35);
    assert.equal(baseline.cache_read_tokens, 0);
    assert.equal(baseline.contract, 'C19-baseline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeDelta: negative delta_pct when candidate cheaper than baseline (improvement)', () => {
  const baseline: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 2.35,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  const candidate: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 1.40,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 80_000,
    cache_creation_tokens: 20_000,
  };
  const delta = computeDelta(baseline, candidate);
  // 1.40 vs 2.35 → ~-40.4%
  assert.ok(delta.delta_pct < 0, `expected negative delta, got ${delta.delta_pct}`);
  assert.ok(delta.improved, 'improved=true');
  assert.equal(delta.candidate_cost_usd, 1.40);
  assert.equal(delta.baseline_cost_usd, 2.35);
  // sanity: delta_pct precision
  const expected = ((1.40 - 2.35) / 2.35) * 100;
  assert.ok(
    Math.abs(delta.delta_pct - expected) < 0.001,
    `delta_pct ${delta.delta_pct} should be ${expected}`,
  );
});

test('computeDelta: positive delta_pct when candidate more expensive (regression)', () => {
  const baseline: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 2.35,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  const candidate: BenchResult = {
    ...baseline,
    cost_usd: 2.80,
  };
  const delta = computeDelta(baseline, candidate);
  assert.ok(delta.delta_pct > 0, 'positive delta on regression');
  assert.equal(delta.improved, false, 'improved=false on regression');
});

test('computeDelta: zero delta when costs equal', () => {
  const baseline: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 2.35,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  const candidate: BenchResult = { ...baseline };
  const delta = computeDelta(baseline, candidate);
  assert.equal(delta.delta_pct, 0);
  // No improvement on tie: ratchet is strict (`< 0`), so tie = not improved.
  assert.equal(delta.improved, false);
});

test('ratchet: returns exit code 0 on improvement, 1 on regression / tie', () => {
  const baseline: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 2.35,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  const improved: BenchResult = { ...baseline, cost_usd: 1.40, cache_read_tokens: 80_000 };
  const regressed: BenchResult = { ...baseline, cost_usd: 3.00 };
  const tie: BenchResult = { ...baseline };

  assert.equal(ratchet(baseline, improved).exit_code, 0, 'improvement -> 0');
  assert.equal(ratchet(baseline, regressed).exit_code, 1, 'regression -> 1');
  assert.equal(ratchet(baseline, tie).exit_code, 1, 'tie -> 1 (strict)');
});

test('ratchet: includes cache_read_tokens delta in report (S8 visibility)', () => {
  // Even when the cost is the same, surfacing cache_read_tokens lets the
  // operator confirm the caching mechanism is firing. If cost is equal but
  // cache_read_tokens jumped from 0 -> 80k, caching landed; the operator
  // knows to refresh the baseline.
  const baseline: BenchResult = {
    fixture: 'slugifier-basic',
    cost_usd: 2.35,
    tokens_in: 100_000,
    tokens_out: 12_000,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
  const candidate: BenchResult = {
    ...baseline,
    cost_usd: 1.40,
    cache_read_tokens: 80_000,
    cache_creation_tokens: 20_000,
  };
  const report = ratchet(baseline, candidate);
  assert.equal(report.candidate.cache_read_tokens, 80_000);
  assert.equal(report.delta.cache_read_tokens_delta, 80_000);
  assert.equal(report.delta.cache_creation_tokens_delta, 20_000);
});

test('end-to-end synthetic A/B: harness correctly identifies a winning candidate', () => {
  // Concretely simulates the bench's two-arm run: baseline = today's
  // $2.35 figure; candidate = post-S8 config (caching + Haiku routing
  // should drop cost meaningfully and inflate cache_read_tokens).
  const dir = mkdtempSync(join(tmpdir(), 'tok-econ-ab-'));
  try {
    writeFileSync(
      join(dir, 'baseline.json'),
      JSON.stringify({
        fixture: 'slugifier-basic',
        cost_usd: 2.35,
        tokens_in: 100_000,
        tokens_out: 12_000,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        recorded_at: '2026-05-23T00:00:00Z',
        contract: 'C19-baseline',
      }),
    );
    const baseline = loadBaseline(join(dir, 'baseline.json'));
    const candidate: BenchResult = {
      fixture: 'slugifier-basic',
      cost_usd: 1.20, // ~49% reduction
      tokens_in: 100_000,
      tokens_out: 12_000,
      cache_read_tokens: 75_000,
      cache_creation_tokens: 25_000,
    };
    const report = ratchet(baseline, candidate);
    assert.equal(report.improved, true);
    assert.ok(
      report.delta.delta_pct < -40,
      `expected ≥ 40% improvement, got ${report.delta.delta_pct}`,
    );
    assert.equal(report.exit_code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
