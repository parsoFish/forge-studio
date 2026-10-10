/**
 * Bead forge-mfv5.1.25 — the state machine half of the Kickoff gate. A
 * decomposition-only flow run (no closure, no early stop, work items written)
 * ends `awaiting-kickoff`, and the scheduler leaves its manifest in
 * `_queue/ready-for-review/` exactly as before. No new queue dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import type { PhaseExecutor } from '@forge/kernel';
import type { FlowDefinition } from '@forge/contracts';

import { runFlow } from '../../flow-runner.ts';
import type { NodeExecContext } from '../../flow-node-context.ts';
import type { CycleInput } from '../../cycle-context.ts';
import { serializeManifest } from '../../manifest.ts';
import { dispatchTerminalStatus } from '../../scheduler.ts';
import { getPaths } from '../../queue.ts';

const INIT = 'INIT-2026-10-10-kickoff-outcome';

function flow(): FlowDefinition {
  return {
    id: 'test-decompose-only', name: 'Decompose only', version: 1, goal: 'fixture',
    project: null, kb: null, costCeilingUsd: 0, origin: 'seed', accepts: ['code'],
    nodes: [{ id: 'pm' }], edges: [], triggers: [], path: '',
  };
}

function never(name: string): () => never {
  return () => { throw new Error(`UNEXPECTED CALL: ${name}`); };
}

async function run(writeWorkItems: boolean): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-kickoff-outcome-'));
  try {
    const manifestPath = join(tmp, 'manifest.md');
    writeFileSync(manifestPath, serializeManifest({
      initiative_id: INIT, class: 'code', acceptance_criteria: [], project: 'p',
      project_repo_path: tmp, created_at: '2026-10-10T00:00:00Z', iteration_budget: 5,
      cost_budget_usd: 1, phase: 'pending', origin: 'architect', body: '# fixture',
    }));
    const executor: PhaseExecutor<NodeExecContext> = {
      run: async () => {
        if (writeWorkItems) {
          const wiDir = join(tmp, '.forge', 'work-items');
          mkdirSync(wiDir, { recursive: true });
          writeFileSync(join(wiDir, 'WI-1.md'), '---\nwork_item_id: WI-1\nstatus: pending\n---\n# one\n');
        }
        return 'ready-for-review';
      },
    };
    const input: CycleInput = { initiativeId: INIT, manifestPath, projectRepoPath: tmp, worktreePath: tmp, cycleId: 'cyc-kickoff' };
    const out = await runFlow({
      flow: flow(), input, logger: createLogger('cyc-kickoff', join(tmp, '_logs')), executor,
      projectGate: { runPreflight: never('runPreflight') }, runClosure: never('runClosure'), rebaseForResume: never('rebaseForResume'),
      enqueueFlowRun: () => ({ status: 'enqueued', initiativeId: INIT }),
    });
    return out.cycleOutcome;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('a decomposition-only run that wrote work items ends awaiting-kickoff', async () => {
  assert.equal(await run(true), 'awaiting-kickoff');
});

test('CONTROL: a closure-less run that wrote no work items keeps ready-for-review', async () => {
  assert.equal(await run(false), 'ready-for-review');
});

test('dispatchTerminalStatus: awaiting-kickoff moves the in-flight manifest to ready-for-review/, no new dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-kickoff-dispatch-'));
  try {
    const paths = getPaths(join(dir, '_queue'));
    for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
      mkdirSync(p, { recursive: true });
    }
    writeFileSync(join(paths.inFlight, `${INIT}.md`), 'manifest');
    const notified: string[] = [];
    const out = await dispatchTerminalStatus(
      { filename: `${INIT}.md`, manifest: { initiativeId: INIT, project: 'p' }, result: { status: 'awaiting-kickoff', log_path: 'x' } },
      { paths, notifyFn: async (e) => { notified.push(e.type); } },
    );
    assert.equal(out.moved, 'ready-for-review');
    assert.ok(existsSync(join(paths.readyForReview, `${INIT}.md`)));
    assert.ok(!existsSync(join(paths.inFlight, `${INIT}.md`)));
    assert.deepEqual(notified, ['review-ready']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
