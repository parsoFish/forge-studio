/**
 * F5 (R4-05 / T3) — shared-pipeline proof.
 *
 * Two entry paths dispatch decomposition:
 *  - batch (exists): an approved architect PLAN gate -> runFinalizeStep ->
 *    `promoteManifests` writes each draft to `_queue/pending/` with
 *    `flow_id: 'forge-architect'`, `phase: 'pending'`.
 *  - standalone (F4, new): the roadmap's per-initiative "Plan" trigger ->
 *    `enqueuePlanRun` repoints an existing initiative onto the SAME flow_id +
 *    phase.
 *
 * Both are then claimed identically by the scheduler and run the identical
 * `execPm` -> `runProjectManager` pipeline (flow-runner.ts:608-629 — the
 * `gate: plan` architect node is a no-op marker; `execArchitect` does nothing).
 * This file proves that convergence two ways:
 *
 *  1. State-equivalence: both entry paths write manifests whose
 *     decompose-relevant fields (`flow_id`, `phase`) are identical.
 *  2. Byte-identical output: feeding each entry path's produced manifest
 *     through the SAME `runProjectManager` pass (identical stubbed PM
 *     session, run sequentially against the SAME worktree so no absolute-path
 *     variance can leak in) produces byte-identical compiled
 *     `.forge/work-items/*.md` files.
 *
 * No `runPlanAgent` wrapper is introduced — the shared pipeline already IS
 * `runProjectManager`; both entry paths reach it via the scheduler, not via
 * anything this test constructs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { createLogger } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { parseManifest, serializeManifest, type InitiativeManifest } from './manifest.ts';
import { promoteManifests } from './promote-manifests.ts';
import { enqueuePlanRun, PLAN_FLOW_ID } from './enqueue-plan-run.ts';
import { getPaths } from './queue.ts';

const INITIATIVE_ID = 'INIT-2026-07-18-shared-pipeline';

const DRAFT_BODY = `---
initiative_id: ${INITIATIVE_ID}
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-07-18T00:00:00Z
iteration_budget: 5
cost_budget_usd: 3
phase: pending
origin: architect
flow_id: forge-architect
---

# Shared pipeline fixture

## Acceptance criteria

Given the resource, when applied, then it persists.
`;

/** A single, fully deterministic canned PM session — same content every call. */
function makeStubQueryFn(initiativeId: string): PmQueryFn {
  return ({ options }) => {
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      writeFileSync(
        join(wiDir, 'WI-1.md'),
        `---
work_item_id: WI-1
initiative_id: ${initiativeId}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - src/thing.ts
creates:
  - src/thing.ts
quality_gate_cmd: ["node", "--test", "tests/thing.test.ts"]
estimated_iterations: 1
---

Body for WI-1.
`,
      );
      writeFileSync(join(wiDir, '_graph.md'), ['```mermaid', 'graph TD', '  WI-1["WI-1"]', '```'].join('\n'));
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
}

function readWiDirSnapshot(worktree: string): Record<string, string> {
  const wiDir = join(worktree, '.forge', 'work-items');
  const out: Record<string, string> = {};
  for (const f of readdirSync(wiDir).sort()) {
    out[f] = readFileSync(join(wiDir, f), 'utf8');
  }
  return out;
}

test('F5: enqueuePlanRun and promoteManifests write state-equivalent decompose-triggering manifests', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'forge-shared-pipeline-state-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'forge-shared-pipeline-state-b-'));
  try {
    // Entry path 1 (batch): an architect draft manifest promoted via
    // promoteManifests — exactly what runFinalizeStep does on PLAN-gate approve.
    const manifestsDir = join(rootA, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, `${INITIATIVE_ID}.md`), DRAFT_BODY);
    const queueRootA = join(rootA, '_queue');
    promoteManifests(manifestsDir, { queueRoot: queueRootA });
    const manifestA = parseManifest(
      readFileSync(join(getPaths(queueRootA).pending, `${INITIATIVE_ID}.md`), 'utf8'),
    );

    // Entry path 2 (standalone F4): the same initiative, previously done, is
    // re-planned through the per-initiative "Plan" trigger.
    const queueRootB = join(rootB, '_queue');
    mkdirSync(join(queueRootB, 'done'), { recursive: true });
    const doneManifest: InitiativeManifest = parseManifest(DRAFT_BODY);
    writeFileSync(
      join(queueRootB, 'done', `${INITIATIVE_ID}.md`),
      serializeManifest({ ...doneManifest, flow_id: 'forge-develop', phase: 'done' }),
    );
    const planResult = enqueuePlanRun(INITIATIVE_ID, { queueRoot: queueRootB });
    assert.equal(planResult.status, 'enqueued');
    const manifestB = parseManifest(
      readFileSync(join(getPaths(queueRootB).pending, `${INITIATIVE_ID}.md`), 'utf8'),
    );

    // The decompose-relevant fields the scheduler + runFlow act on: identical
    // flow_id + phase means the scheduler claims BOTH manifests the same way,
    // and BOTH fall straight through to execPm -> runProjectManager
    // (flow-runner.ts:608-629 — the architect node is a no-op marker).
    assert.equal(manifestA.flow_id, PLAN_FLOW_ID);
    assert.equal(manifestB.flow_id, PLAN_FLOW_ID);
    assert.equal(manifestA.phase, 'pending');
    assert.equal(manifestB.phase, 'pending');
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test('F5: the SAME runProjectManager pass over each entry path\'s manifest produces byte-identical compiled work items', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-shared-pipeline-bytes-'));
  const sourcesRoot = mkdtempSync(join(tmpdir(), 'forge-shared-pipeline-sources-'));
  try {
    // ONE shared worktree — both entry paths' PM pass run against the exact
    // same absolute path, sequentially, so no incidental absolute-path
    // variance between two different tmp dirs can masquerade as a real
    // divergence. project-manager wipes any stale .forge/work-items itself
    // at the start of each pass (F-21), so the second run starts clean.
    const worktree = join(root, 'projects', 'testproj');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(
      join(worktree, 'package.json'),
      JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }),
    );
    const logsDir = join(root, '_logs');
    mkdirSync(logsDir, { recursive: true });

    // Entry path 1 (batch): promoteManifests.
    const manifestsDir = join(root, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, `${INITIATIVE_ID}.md`), DRAFT_BODY);
    const queueRootA = join(root, '_queue-a');
    promoteManifests(manifestsDir, { queueRoot: queueRootA });
    const manifestPathA = join(getPaths(queueRootA).pending, `${INITIATIVE_ID}.md`);

    const inputA: CycleInput = {
      initiativeId: INITIATIVE_ID,
      manifestPath: manifestPathA,
      projectRepoPath: worktree,
      worktreePath: worktree,
    };
    await runProjectManager(inputA, createLogger('TEST-shared-pipeline-a', logsDir), {
      queryFn: makeStubQueryFn(INITIATIVE_ID),
      constraintSourcesRoot: sourcesRoot,
    });
    const snapshotA = readWiDirSnapshot(worktree);
    assert.ok(Object.keys(snapshotA).length > 0, 'sanity: entry path 1 produced compiled work items');

    // Entry path 2 (standalone F4): enqueuePlanRun, re-planning a done initiative.
    const queueRootB = join(root, '_queue-b');
    mkdirSync(join(queueRootB, 'done'), { recursive: true });
    const doneManifest: InitiativeManifest = parseManifest(DRAFT_BODY);
    writeFileSync(
      join(queueRootB, 'done', `${INITIATIVE_ID}.md`),
      serializeManifest({ ...doneManifest, flow_id: 'forge-develop', phase: 'done' }),
    );
    enqueuePlanRun(INITIATIVE_ID, { queueRoot: queueRootB });
    const manifestPathB = join(getPaths(queueRootB).pending, `${INITIATIVE_ID}.md`);

    const inputB: CycleInput = {
      initiativeId: INITIATIVE_ID,
      manifestPath: manifestPathB,
      projectRepoPath: worktree,
      worktreePath: worktree,
    };
    await runProjectManager(inputB, createLogger('TEST-shared-pipeline-b', logsDir), {
      queryFn: makeStubQueryFn(INITIATIVE_ID),
      constraintSourcesRoot: sourcesRoot,
    });
    const snapshotB = readWiDirSnapshot(worktree);

    assert.deepEqual(
      Object.keys(snapshotA).sort(),
      Object.keys(snapshotB).sort(),
      'the same set of compiled work-item files is produced by both entry paths',
    );
    for (const file of Object.keys(snapshotA)) {
      assert.equal(snapshotA[file], snapshotB[file], `${file} is byte-identical across both entry paths`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  }
});
