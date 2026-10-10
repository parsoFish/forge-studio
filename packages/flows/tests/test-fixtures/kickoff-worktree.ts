/**
 * Bead forge-nk1y.12 — the Kickoff gate with the worktree the develop run
 * reuses: `plantStrandedKickoff`, plus full, valid work items written to BOTH
 * `<forgeRoot>/_worktrees/<id>/.forge/work-items/` (what the scheduler's
 * architect→develop hand-off reuses) and the cycle's `work-items-snapshot/`,
 * and a manifest carrying one runnable acceptance criterion (D-47) no existing
 * work item's gate carries, beside one prose criterion.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseManifest, serializeManifest } from '../../manifest.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { plantStrandedKickoff, STRANDED_INIT, STRANDED_WI_COUNT, type StrandedBuilt, type StrandedPaths } from './stranded-kickoff.ts';

/** The runnable criterion's command; the existing WIs' gates never carry it. */
export const RETIRE_GATE = ['node', '--test', 'tests/retire.test.ts'];
export const KICKOFF_ACS = [
  { given: 'the retired specs', when: `\`${RETIRE_GATE.join(' ')}\``, then: 'it passes' },
  { given: 'an operator', when: 'they read the docs', then: 'the retired specs are gone' },
];
/** Existing WIs' estimated_iterations; the median rounded up is 4. */
const ITERATIONS = [2, 3, 4, 5, 8];

export type KickoffWorktreePaths = StrandedPaths & { wiDir: string };

export function existingWorkItem(n: number, status: WorkItem['status'] = 'pending'): WorkItem {
  return {
    work_item_id: `WI-${n}`, initiative_id: STRANDED_INIT, status, depends_on: n > 1 ? [`WI-${n - 1}`] : [],
    acceptance_criteria: [{ given: `part ${n}`, when: 'built', then: 'it works' }],
    files_in_scope: [`src/part-${n}.ts`], quality_gate_cmd: ['node', '--test', `tests/part-${n}.test.ts`],
    estimated_iterations: ITERATIONS[n - 1] ?? 3, body: `## WI-${n}\n`,
  };
}

export function plantKickoffWorktree(forgeRoot: string, built?: StrandedBuilt): KickoffWorktreePaths {
  const paths = plantStrandedKickoff(forgeRoot, built);
  const wiDir = join(forgeRoot, '_worktrees', STRANDED_INIT, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  for (let n = 1; n <= STRANDED_WI_COUNT; n++) {
    const text = serializeWorkItem(existingWorkItem(n, built === 'wi-complete' && n === 1 ? 'complete' : 'pending'));
    writeFileSync(join(wiDir, `WI-${n}.md`), text);
    writeFileSync(join(paths.snapshotDir, `WI-${n}.md`), text);
  }
  const m = parseManifest(readFileSync(paths.manifestPath, 'utf8'));
  writeFileSync(paths.manifestPath, serializeManifest({ ...m, acceptance_criteria: KICKOFF_ACS }));
  return { ...paths, wiDir };
}
