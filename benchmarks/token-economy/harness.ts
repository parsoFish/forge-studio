/**
 * Token-economy A/B ratchet harness.
 *
 * S8 / WI-5 / C23-C26. The ratchet protects S8's cost-floor gains from
 * silent regression: every Plan 08 PR must STRICTLY improve cost-per-cycle
 * vs the committed `baseline.json` (delta_pct < 0). C19 stands — this is
 * NOT a hard budget cap, it's an ASCII-art floor that ratchets DOWN as
 * we land more refinements. The bench refuses to let the floor rise.
 *
 * Surface:
 *
 *   loadBaseline(path)         → reads + parses baseline.json
 *   computeDelta(base, cand)   → pure delta arithmetic
 *   ratchet(base, cand)        → full report, includes exit_code 0|1
 *
 * The harness is deliberately SYNTHETIC: it does not invoke the SDK.
 * Running the live e2e bench is the operator's job; this harness ratchets
 * its OUTPUT against the frozen `baseline.json` snapshot.
 *
 * See `S8-DECISIONS.md` D6 for why the baseline is `$2.35 on slugifier-basic`.
 */

import { readFileSync } from 'node:fs';

export type BenchResult = {
  /** Fixture name (e.g. 'slugifier-basic'). */
  fixture: string;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  /** S8 / C23 telemetry. */
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** ISO timestamp; optional on candidate, present on baseline. */
  recorded_at?: string;
  /** Free-form contract tag (e.g. 'C19-baseline', 'C23-cached'). */
  contract?: string;
};

export type Delta = {
  baseline_cost_usd: number;
  candidate_cost_usd: number;
  delta_usd: number;
  /** `(candidate - baseline) / baseline * 100`. Negative = improvement. */
  delta_pct: number;
  improved: boolean;
  cache_read_tokens_delta: number;
  cache_creation_tokens_delta: number;
};

export type RatchetReport = {
  baseline: BenchResult;
  candidate: BenchResult;
  delta: Delta;
  improved: boolean;
  /** 0 = improvement, 1 = regression or tie. Suitable for `process.exit()`. */
  exit_code: 0 | 1;
};

/**
 * Parse a baseline JSON snapshot from disk. The file must contain every
 * `BenchResult` field; missing fields throw (fail-fast — silent
 * defaults are how baseline drift creeps in).
 */
export function loadBaseline(path: string): BenchResult {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<BenchResult>;
  for (const field of [
    'fixture',
    'cost_usd',
    'tokens_in',
    'tokens_out',
    'cache_read_tokens',
    'cache_creation_tokens',
  ] as const) {
    if (parsed[field] === undefined) {
      throw new Error(`baseline.json missing required field: ${field}`);
    }
  }
  return parsed as BenchResult;
}

/**
 * Compute the cost-delta between baseline and candidate. Pure function —
 * no I/O, no exit codes, just arithmetic. The boolean `improved` is
 * STRICT (`delta_pct < 0`); a tie is NOT an improvement.
 */
export function computeDelta(baseline: BenchResult, candidate: BenchResult): Delta {
  const delta_usd = candidate.cost_usd - baseline.cost_usd;
  const delta_pct = baseline.cost_usd === 0
    ? 0
    : (delta_usd / baseline.cost_usd) * 100;
  return {
    baseline_cost_usd: baseline.cost_usd,
    candidate_cost_usd: candidate.cost_usd,
    delta_usd,
    delta_pct,
    improved: delta_pct < 0,
    cache_read_tokens_delta: candidate.cache_read_tokens - baseline.cache_read_tokens,
    cache_creation_tokens_delta:
      candidate.cache_creation_tokens - baseline.cache_creation_tokens,
  };
}

/**
 * Run the ratchet: combine baseline + candidate into a report including
 * an `exit_code` field suitable for `process.exit()`.
 *
 * 0 = strict improvement (cost dropped).
 * 1 = regression OR tie (cost stayed flat or rose) — fail the gate.
 *
 * Surfaces cache_read_tokens delta even when cost is unchanged so the
 * operator can confirm caching landed mechanically (e.g., cost flat but
 * cache_read_tokens jumped from 0 → 80k means the cache wiring works
 * but the cost saving hasn't materialised yet — likely a TTL miss).
 */
export function ratchet(baseline: BenchResult, candidate: BenchResult): RatchetReport {
  const delta = computeDelta(baseline, candidate);
  return {
    baseline,
    candidate,
    delta,
    improved: delta.improved,
    exit_code: delta.improved ? 0 : 1,
  };
}
