#!/usr/bin/env node
/**
 * Token-economy ratchet scorer — CI-style entry point.
 *
 * Usage:
 *
 *   node --experimental-strip-types benchmarks/token-economy/score.ts \
 *     [--baseline=path/to/baseline.json] \
 *     [--candidate=path/to/candidate.json]
 *
 * Defaults:
 *   --baseline=benchmarks/token-economy/baseline.json
 *   --candidate=benchmarks/token-economy/candidate.json
 *
 * Exits 0 on strict improvement (`delta_pct < 0` on `cost_usd`).
 * Exits 1 on regression or tie.
 *
 * The `candidate.json` is produced by the live e2e bench (operator
 * runs `npm run bench:chained` and pipes the result here, or constructs
 * it by hand). S8's automated CI surface is the test suite
 * (`harness.test.ts`); this script is the wake-up gate the operator
 * runs after a live bench.
 *
 * See `S8-DECISIONS.md` D7 for the harness-vs-bench split rationale.
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { loadBaseline, ratchet, type BenchResult } from './harness.ts';

function parseArgs(argv: string[]): { baseline: string; candidate: string } {
  const get = (flag: string, fallback: string): string => {
    const found = argv.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(`--${flag}=`.length) : fallback;
  };
  return {
    baseline: resolve(
      get('baseline', 'benchmarks/token-economy/baseline.json'),
    ),
    candidate: resolve(
      get('candidate', 'benchmarks/token-economy/candidate.json'),
    ),
  };
}

function main(): number {
  const { baseline: baselinePath, candidate: candidatePath } = parseArgs(process.argv.slice(2));
  if (!existsSync(candidatePath)) {
    process.stderr.write(
      `[token-economy] no candidate.json at ${candidatePath} — nothing to ratchet.\n`,
    );
    process.stderr.write(
      '[token-economy] tip: run the live e2e bench and write its result there.\n',
    );
    // Absence of candidate is NOT a regression — just a no-op.
    return 0;
  }
  const baseline = loadBaseline(baselinePath);
  const candidate = loadBaseline(candidatePath) as BenchResult;
  const report = ratchet(baseline, candidate);

  process.stdout.write(
    JSON.stringify(
      {
        baseline_cost_usd: report.delta.baseline_cost_usd,
        candidate_cost_usd: report.delta.candidate_cost_usd,
        delta_usd: report.delta.delta_usd.toFixed(4),
        delta_pct: report.delta.delta_pct.toFixed(2) + '%',
        cache_read_delta: report.delta.cache_read_tokens_delta,
        cache_creation_delta: report.delta.cache_creation_tokens_delta,
        improved: report.improved,
        exit_code: report.exit_code,
      },
      null,
      2,
    ) + '\n',
  );
  return report.exit_code;
}

process.exit(main());
