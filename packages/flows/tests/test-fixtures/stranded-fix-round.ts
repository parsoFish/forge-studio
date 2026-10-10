/**
 * Bead forge-mfv5.1.27 — the exact shape gitweave I1 was stranded in: a
 * forge-develop manifest parked in `_queue/ready-for-review/` with
 * `resume_from: develop` and `review_rounds: 1`, five delivered WIs plus one
 * pending `origin: gate-fix` WI, a `cycle.dev-close-invariant-ok` recording the
 * delivered branch head, then a red `cycle.merge-gate` and a `cycle.end` that
 * says `ready-for-review`. `withGit` plants the real repo, branch and worktree.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIX_INIT = 'INIT-2026-10-10-stranded-fix-round';
export const FIX_CYCLE = '2026-10-10T01-55-59_INIT-2026-10-10-stranded-fix-round';
export const FIX_PROJECT = 'fix-round-project';
export const FIX_BRANCH = `forge/${FIX_INIT}`;
export const FIX_GATE_CMD = ['python3', '-m', 'pytest', 'tests/'];

export type StrandedFixRound = { manifestPath: string; repo: string; worktree: string; logDir: string; deliveredHead: string };

function wiFile(n: number, status: string, origin?: string): string {
  return ['---', `work_item_id: WI-${n}`, `initiative_id: ${FIX_INIT}`, `status: ${status}`, 'depends_on: []',
    'acceptance_criteria:', '  - given: a fixture', '    when: it runs', '    then: it passes',
    'files_in_scope:', `  - src/wi-${n}.txt`, 'estimated_iterations: 1', 'quality_gate_cmd:',
    ...FIX_GATE_CMD.map((c) => `  - ${c}`), ...(origin ? [`origin: ${origin}`] : []), '---', '', `## WI-${n}`, ''].join('\n');
}

function event(message: string, eventType: string, at: string, metadata?: Record<string, unknown>): string {
  return JSON.stringify({
    initiative_id: FIX_INIT, cycle_id: FIX_CYCLE, phase: 'orchestrator', skill: 'cycle', event_type: eventType,
    input_refs: [], output_refs: [], message, started_at: at, ...(metadata ? { metadata } : {}),
  });
}

function writeWorkItems(dir: string, fixOrigin: string): void {
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= 5; n++) writeFileSync(join(dir, `WI-${n}.md`), wiFile(n, 'complete'));
  writeFileSync(join(dir, 'WI-6.md'), wiFile(6, 'pending', fixOrigin));
}

export function plantStrandedFixRound(forgeRoot: string, opts: { withGit?: boolean; fixOrigin?: 'gate-fix' | 'review-fix' } = {}): StrandedFixRound {
  const fixOrigin = opts.fixOrigin ?? 'gate-fix';
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  const repo = join(forgeRoot, 'projects', FIX_PROJECT);
  const worktree = join(forgeRoot, '_worktrees', FIX_INIT);
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true }); // the manifest guard resolves the worktree under it
  let deliveredHead = 'a'.repeat(40);
  if (opts.withGit === true) {
    const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@forge']);
    git(repo, ['config', 'user.name', 'forge-test']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'base']);
    git(repo, ['branch', FIX_BRANCH]);
    git(repo, ['worktree', 'add', '-q', worktree, FIX_BRANCH]);
    for (let n = 1; n <= 5; n++) {
      writeFileSync(join(worktree, `wi-${n}.txt`), `WI-${n}\n`);
      git(worktree, ['add', `wi-${n}.txt`]);
      git(worktree, ['commit', '-q', '-m', `feat: WI-${n}`]);
    }
    deliveredHead = git(worktree, ['rev-parse', 'HEAD']);
    writeWorkItems(join(worktree, '.forge', 'work-items'), fixOrigin);
  }

  const logDir = join(forgeRoot, '_logs', FIX_CYCLE);
  writeWorkItems(join(logDir, 'work-items-snapshot'), fixOrigin);
  writeFileSync(join(logDir, 'events.jsonl'), [
    event('cycle.start', 'start', '2026-10-10T01:56:00.000Z', { origin: 'architect' }),
    event('cycle.dev-close-invariant-ok', 'log', '2026-10-10T05:06:15.988Z', { branch: FIX_BRANCH, local_head: deliveredHead }),
    event('cycle.merge-gate', 'error', '2026-10-10T05:06:16.649Z', { gate: 'local', ok: false, cmd: FIX_GATE_CMD }),
    event('cycle.end', 'end', '2026-10-10T05:06:16.782Z', { status: 'ready-for-review', reflection_status: 'skipped', lint_status: 'skipped' }),
  ].join('\n') + '\n');

  const manifestPath = join(forgeRoot, '_queue', 'ready-for-review', `${FIX_INIT}.md`);
  writeFileSync(manifestPath, ['---', `initiative_id: ${FIX_INIT}`, `project: ${FIX_PROJECT}`, `project_repo_path: ${repo}`,
    'created_at: 2026-10-10T01:38:09.906Z', 'iteration_budget: 7', 'cost_budget_usd: 5.5', 'phase: pending',
    'origin: architect', 'class: code', `worktree_path: ${worktree}`, `cycle_id: ${FIX_CYCLE}`, 'flow_id: forge-develop',
    'resume_from: develop', 'review_rounds: 1', '---', '', '# Stranded fix round', ''].join('\n'));
  return { manifestPath, repo, worktree, logDir, deliveredHead };
}
