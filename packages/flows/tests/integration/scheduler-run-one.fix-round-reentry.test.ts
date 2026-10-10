/**
 * Bead forge-mfv5.1.27 (P1 capstone blocker) — a compiled fix-loop WI never ran.
 *
 * Live (gitweave I1): the merge gate went red, the integrate node compiled
 * gate-fix WI-6 and terminated to ready-for-review — and re-entry waited on
 * the drain sweep's 5-minute timer. Serve stopped inside that window, so WI-6
 * never ran. Now `runOne` re-enters the parked fix round through the SAME D-20
 * drain, immediately, for this manifest only. The timer is never involved:
 * nothing here runs the scheduler loop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOne } from '../../scheduler-run-one.ts';
import { getPaths } from '../../queue.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import { enqueueGateFixWorkItems } from '../../gate-fix-loop.ts';
import { readWorkItemsFromDir, writeWorkItem, type WorkItem } from '../../work-item.ts';

const INIT = 'INIT-2026-10-10-fix-round-reentry';
const GATE = ['npm', 'run', 'test:full'];

function sh(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function wi(id: string, status: WorkItem['status'], origin?: WorkItem['origin']): WorkItem {
  return {
    work_item_id: id, initiative_id: INIT, status, depends_on: [], files_in_scope: ['src/a.ts'], estimated_iterations: 1,
    acceptance_criteria: [{ given: 'a', when: 'b', then: 'c' }], quality_gate_cmd: ['true'], body: `# ${id}`,
    ...(origin ? { origin } : {}),
  };
}

type Scenario = { integrate: 'gate-fix' | 'cyclic'; isStopping?: () => boolean };
type Outcome = { passes: Array<{ node: string; resumeFrom: string | null; claimed: boolean }>; closures: number; root: string; paths: ReturnType<typeof getPaths>; file: string };

async function scenario(sc: Scenario, check: (o: Outcome) => void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-fix-reentry-'));
  const prevSkip = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  try {
    const repo = join(root, 'projects', 'fixproj');
    mkdirSync(repo, { recursive: true });
    sh(repo, ['init', '-q', '-b', 'main']);
    sh(repo, ['config', 'user.email', 't@forge']);
    sh(repo, ['config', 'user.name', 'forge-test']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    sh(repo, ['add', '.']);
    sh(repo, ['commit', '-q', '-m', 'base']);
    const origin = join(root, 'origin.git');
    sh(root, ['init', '-q', '--bare', origin]);
    sh(repo, ['remote', 'add', 'origin', origin]);
    sh(repo, ['push', '-q', 'origin', 'main']);

    const queueRoot = join(root, '_queue');
    const paths = getPaths(queueRoot);
    for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) mkdirSync(p, { recursive: true });
    const file = `${INIT}.md`;
    const manifestPath = join(paths.inFlight, file);
    writeFileSync(manifestPath, ['---', `initiative_id: ${INIT}`, 'project: fixproj', `project_repo_path: ${repo}`,
      'created_at: 2026-10-10T00:00:00Z', 'iteration_budget: 5', 'cost_budget_usd: 5', 'class: code', 'phase: in-flight',
      'flow_id: forge-develop', '---', '', `# ${INIT}`, ''].join('\n'));

    const passes: Outcome['passes'] = [];
    let closures = 0;
    const wiring = {
      executor: {
        run: async (nodeId: string, ctx: { input: { worktreePath: string; manifestPath: string; resumeFrom?: string }; state: { terminateEarly: boolean }; nodeLogger: { emit: (e: Record<string, unknown>) => unknown } }) => {
          const wt = ctx.input.worktreePath;
          passes.push({ node: nodeId, resumeFrom: ctx.input.resumeFrom ?? null, claimed: existsSync(join(paths.inFlight, file)) });
          if (ctx.input.resumeFrom === 'develop') {
            writeWorkItem(wi('WI-2', 'complete', 'gate-fix'), wt);
            ctx.state.terminateEarly = true;
            return 'ready-for-review';
          }
          if (nodeId === 'dev') {
            writeWorkItem(wi('WI-1', 'complete'), wt);
            writeFileSync(join(wt, 'a.txt'), 'built\n');
            sh(wt, ['add', 'a.txt']);
            sh(wt, ['commit', '-q', '-m', 'feat: WI-1']);
            sh(wt, ['push', '-q', 'origin', 'HEAD']); // this attempt OWNS the pushed branch
          }
          if (nodeId === 'integrate') {
            if (sc.integrate === 'gate-fix') {
              const r = enqueueGateFixWorkItems({ worktreePath: wt, manifestPath: ctx.input.manifestPath, initiativeId: INIT, failedGate: 'local', projectGateCmd: GATE });
              assert.equal(r.status, 'compiled');
              // What executor-table emits on a compile: the head the round was parked on.
              const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
              ctx.nodeLogger.emit({ initiative_id: INIT, phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [], output_refs: [], message: 'merge-gate.fix-loop.compiled', metadata: { head_sha: head } });
            } else {
              // An unreadable fix-WI queue: two pending gate-fix WIs in a dependency cycle.
              writeWorkItem({ ...wi('WI-2', 'pending', 'gate-fix'), depends_on: ['WI-3'] }, wt);
              writeWorkItem({ ...wi('WI-3', 'pending', 'gate-fix'), depends_on: ['WI-2'] }, wt);
            }
            ctx.state.terminateEarly = true;
          }
          return 'ready-for-review';
        },
      },
      projectGate: { runPreflight: () => { throw new Error('UNEXPECTED preflight'); } },
      runClosure: async () => { closures += 1; return { outcome: 'ready-for-review', merged: false }; },
      runReflector: async () => { throw new Error('UNEXPECTED reflect'); },
    } as unknown as PhaseWiring;

    await runOne(manifestPath, file, {
      queueRoot, worktreesRoot: join(root, '_worktrees'), maxConcurrentInitiatives: 1, heartbeatIntervalMs: 60_000,
      staleHeartbeatMs: 300_000, pollIntervalMs: 5_000, recoverIntervalMs: 300_000,
      notify: { desktop: false, webhook_url: null }, logsRoot: join(root, '_logs'),
    }, undefined, wiring, sc.isStopping);
    check({ passes, closures, root, paths, file });
  } finally {
    if (prevSkip === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prevSkip;
    rmSync(root, { recursive: true, force: true });
  }
}

test('runOne: a red merge gate parks a fix round, and the drain re-enters develop for it immediately', () => scenario({ integrate: 'gate-fix' }, ({ passes, closures, root, paths, file }) => {
  const reentry = passes.filter((p) => p.resumeFrom === 'develop');
  assert.deepEqual(passes.slice(0, 2).map((p) => p.node), ['dev', 'integrate'], JSON.stringify(passes));
  assert.equal(reentry.length, 1, `the drain re-entered develop once, in this runOne call: ${JSON.stringify(passes)}`);
  assert.equal(reentry[0]!.node, 'dev');
  assert.equal(reentry[0]!.claimed, true, 'the re-entry runs under the drain\'s in-flight claim');
  assert.equal(closures, 2, 'both rounds closed to ready-for-review');
  const items = readWorkItemsFromDir(join(root, '_worktrees', INIT, '.forge', 'work-items')).items;
  assert.equal(items.find((w) => w.origin === 'gate-fix')?.status, 'complete', 'the compiled fix WI ran');
  assert.ok(existsSync(join(paths.readyForReview, file)), 'the drained round returns to ready-for-review');
  const events = readFileSync(join(root, '_logs', readdirCycle(root), 'events.jsonl'), 'utf8');
  assert.match(events, /"sendback\.loop-completed"/, 'the drain logged the round into the SAME cycle log');
}));

test('runOne (sec 4): a stopping scheduler (SIGTERM) skips the immediate drain', () => scenario({ integrate: 'gate-fix', isStopping: () => true }, ({ passes, paths, file }) => {
  assert.equal(passes.filter((p) => p.resumeFrom === 'develop').length, 0, JSON.stringify(passes));
  assert.ok(existsSync(join(paths.readyForReview, file)), 'parked for the next serve start\'s drain');
}));

test('runOne (sec 5): an unreadable fix-WI queue never fails the attempt or reaches the branch-deleting cleanup', () => scenario({ integrate: 'cyclic' }, ({ passes, root, paths, file }) => {
  assert.equal(passes.filter((p) => p.resumeFrom === 'develop').length, 0, 'no re-entry on an unreadable queue');
  assert.ok(existsSync(join(paths.readyForReview, file)), 'still parked in ready-for-review');
  const own = join(root, '_logs', INIT, 'events.jsonl');
  const stale = existsSync(own) ? readFileSync(own, 'utf8') : '';
  assert.doesNotMatch(stale, /stale-remote-branch\./, 'the attempt was never treated as failed (no branch cleanup ran)');
}));

function readdirCycle(root: string): string {
  const m = /cycle_id:\s*(\S+)/.exec(readFileSync(join(root, '_queue', 'ready-for-review', `${INIT}.md`), 'utf8'));
  assert.ok(m, 'the manifest carries its cycle_id');
  return m[1]!.replace(/^['"]|['"]$/g, '');
}
