/**
 * Hot-path entry point for the cycle's report.md.
 *
 * The rendering logic (buildCycleReport + ~700 LOC of section renderers) was
 * moved to [`packages/flows/forge-metrics.ts`](../packages/flows/forge-metrics.ts) as part of the
 * rebuild-review Move 1 (2026-05-24, REVIEW §3 #4). This file stays in
 * `orchestrator/` because `cycle.ts` calls `writeCycleReport` at the end of
 * every cycle — the WRITE is hot path, the markdown formatting is not.
 *
 * Consumers that just want the markdown body should import `buildCycleReport`
 * from `packages/flows/forge-metrics.ts` directly; this module re-exports it for the
 * one or two callers (test + CLI subcommand) that legacy-import from here.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';

import { buildCycleReport, type CycleReportInput } from './forge-metrics.ts';

export { buildCycleReport, type CycleReportInput };

/** Build the report and write it to `_logs/<cycleId>/report.md`. */
export function writeCycleReport(input: CycleReportInput): string {
  const forgeRoot = resolve(input.forgeRoot ?? FORGE_ROOT);
  const logsRoot = resolve(input.logsRoot ?? join(forgeRoot, '_logs')); // forge-8vfn.8.1.10
  const md = buildCycleReport(input);
  const outPath = resolve(logsRoot, input.cycleId, 'report.md');
  writeFileSync(outPath, md);
  return outPath;
}
