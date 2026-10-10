/**
 * Bead forge-mfv5.1.25 — the exact stranded shape a forge-architect cycle left
 * before the Kickoff gate existed: manifest in `_queue/ready-for-review/`
 * (`flow_id: forge-architect`), a `cycle.end` that says `ready-for-review`,
 * five pending work items in the cycle's snapshot, and the plan mirrored into
 * `artifacts/PLAN.html`. `built` plants one "already built" signal instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STRANDED_INIT = 'INIT-2026-10-09-stranded-kickoff';
export const STRANDED_CYCLE = '2026-10-09T10-00-00_INIT-2026-10-09-stranded-kickoff';
export const STRANDED_PROJECT = 'stranded-project';
export const STRANDED_WI_COUNT = 5;

export type StrandedBuilt = 'wi-complete' | 'review-rounds' | 'resume-from' | { branchRepo: string };

export type StrandedPaths = { manifestPath: string; snapshotDir: string; planPath: string; logDir: string };

function event(message: string, phase: string, eventType: string, at: string, metadata?: Record<string, unknown>): string {
  return JSON.stringify({
    initiative_id: STRANDED_INIT, phase, skill: phase === 'orchestrator' ? 'cycle' : phase, event_type: eventType,
    input_refs: [], output_refs: [], message, started_at: at, ...(metadata ? { metadata } : {}),
  });
}

export function plantStrandedKickoff(forgeRoot: string, built?: StrandedBuilt): StrandedPaths {
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  const logDir = join(forgeRoot, '_logs', STRANDED_CYCLE);
  const snapshotDir = join(logDir, 'work-items-snapshot');
  mkdirSync(snapshotDir, { recursive: true });
  mkdirSync(join(logDir, 'artifacts'), { recursive: true });

  const repoPath = typeof built === 'object' ? built.branchRepo : join(forgeRoot, 'no-repo');
  const manifestPath = join(rfr, `${STRANDED_INIT}.md`);
  writeFileSync(manifestPath, [
    '---',
    `initiative_id: ${STRANDED_INIT}`,
    `project: ${STRANDED_PROJECT}`,
    `project_repo_path: ${repoPath}`,
    'created_at: 2026-10-09T09:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    'class: code',
    'phase: pending',
    'origin: architect',
    'flow_id: forge-architect',
    `cycle_id: ${STRANDED_CYCLE}`,
    ...(built === 'review-rounds' ? ['review_rounds: 1'] : []),
    ...(built === 'resume-from' ? ['resume_from: develop'] : []),
    '---',
    '',
    '# Stranded kickoff',
    '',
  ].join('\n'));

  for (let n = 1; n <= STRANDED_WI_COUNT; n++) {
    const status = built === 'wi-complete' && n === 1 ? 'complete' : 'pending';
    writeFileSync(join(snapshotDir, `WI-${n}.md`),
      `---\nwork_item_id: WI-${n}\ninitiative_id: ${STRANDED_INIT}\nstatus: ${status}\n---\n\n## WI-${n}\n`);
  }
  const planPath = join(logDir, 'artifacts', 'PLAN.html');
  writeFileSync(planPath, '<html><body>plan</body></html>');

  writeFileSync(join(logDir, 'events.jsonl'), [
    event('cycle.start', 'orchestrator', 'start', '2026-10-09T10:00:00.000Z', { origin: 'architect' }),
    event('architect done', 'architect', 'end', '2026-10-09T10:05:00.000Z'),
    event('pm done', 'project-manager', 'end', '2026-10-09T10:10:00.000Z'),
    event('cycle.end', 'orchestrator', 'end', '2026-10-09T10:11:00.000Z', { status: 'ready-for-review', reflection_status: 'skipped', lint_status: 'skipped' }),
  ].join('\n') + '\n');

  return { manifestPath, snapshotDir, planPath, logDir };
}

export const STRANDED_BUILT_CASES: readonly Exclude<StrandedBuilt, { branchRepo: string }>[] = ['wi-complete', 'review-rounds', 'resume-from'];
