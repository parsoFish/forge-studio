/**
 * Benchmark results writer. Universal across phase benchmarks — each writes a
 * timestamped JSON file under `benchmarks/<phase>/results/` with the contract
 * documented in benchmarks/README.md.
 *
 * Returns the absolute path written so callers can log it.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ResultsPayload = {
  phase: string;
  ran_at: string;
  cases: unknown[];
  summary: Record<string, unknown>;
};

export function writeResults(phaseDir: string, payload: ResultsPayload): string {
  const resultsDir = resolve(phaseDir, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const fileName = `${payload.ran_at.replace(/[:.]/g, '-')}.json`;
  const fullPath = join(resultsDir, fileName);
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
  return fullPath;
}
