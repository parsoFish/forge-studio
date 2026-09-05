/**
 * Tests for orchestrator/gate-fix-loop.ts (R4-10-F2) — the merge-boundary
 * full-suite gate's unattended remediation: compile ONE gate-fix WI from the
 * red gate + stamp the manifest send-back, sharing the review/demo-fix caps,
 * reject-then-park on cap exhaustion.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { enqueueGateFixWorkItems } from '../../gate-fix-loop.ts';
import { parseManifest } from '../../manifest.ts';
import { writeWorkItem, readWorkItemsFromDir, type WorkItem } from '../../work-item.ts';
import { reviewCapExhaustedPath } from '../../fix-work-items.ts';

const ID = 'INIT-2026-08-02-gatefix';
const GATE = ['npm', 'test'];

type Fixture = { root: string; wt: string; manifestPath: string; cleanup: () => void };

function setup(opts: { reviewRounds?: number; gateFailure?: string } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'gate-fix-loop-'));
  const wt = join(root, 'wt');
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  const pmWi: WorkItem = {
    work_item_id: 'WI-1',
    initiative_id: ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'a built CLI', when: 'run', then: 'it works' }],
    files_in_scope: ['src/cli.ts'],
    estimated_iterations: 1,
    quality_gate_cmd: GATE,
    body: 'Build the CLI.',
  };
  writeWorkItem(pmWi, wt);
  if (opts.gateFailure !== undefined) {
    writeFileSync(join(wt, '.forge', 'last-gate-failure.md'), opts.gateFailure);
  }

  const manifestPath = join(root, 'manifest.md');
  writeFileSync(
    manifestPath,
    [
      '---',
      `initiative_id: ${ID}`,
      'project: demo',
      `project_repo_path: ${wt}`,
      "created_at: '2026-08-02T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'class: code',
      'phase: in-flight',
      'origin: architect',
      `worktree_path: ${wt}`,
      ...(opts.reviewRounds !== undefined ? [`review_rounds: ${opts.reviewRounds}`] : []),
      '---',
      `# ${ID}`,
      '',
    ].join('\n'),
  );
  return { root, wt, manifestPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function enqueue(fx: Fixture, failedGate: 'local' | 'ci' = 'local') {
  return enqueueGateFixWorkItems({
    worktreePath: fx.wt,
    manifestPath: fx.manifestPath,
    initiativeId: ID,
    failedGate,
    projectGateCmd: GATE,
  });
}

test('enqueue: compiles ONE gate-fix WI (full-suite scope + gate) + stamps the send-back', () => {
  const fx = setup({ reviewRounds: 0, gateFailure: '# gate red\n\n`npm test` failed: 1 test failing (cross-WI break)' });
  try {
    const result = enqueue(fx);
    assert.equal(result.status, 'compiled');
    if (result.status !== 'compiled') return;
    assert.equal(result.appended.length, 1, 'exactly one gate-fix WI');
    assert.equal(result.round, 1);

    const { items } = readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items'));
    const gateFix = items.filter((w) => w.origin === 'gate-fix');
    assert.equal(gateFix.length, 1);
    assert.equal(gateFix[0]!.status, 'pending');
    // The full-suite failure detail rode into the WI body (the fix agent reads it).
    assert.ok(gateFix[0]!.body.includes('cross-WI break'), 'the authoritative gate failure is embedded verbatim');
    // The fix WI's gate is the project full suite (no sharp narrower gate).
    assert.deepEqual(gateFix[0]!.quality_gate_cmd, GATE);

    const m = parseManifest(readFileSync(fx.manifestPath, 'utf8'));
    assert.equal(m.resume_from, 'develop');
    assert.equal(m.review_rounds, 1);
  } finally {
    fx.cleanup();
  }
});

test('enqueue: shares the round cap with review/demo-fix — over the cap parks (marker, nothing enqueued)', () => {
  const prior = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '1';
  const fx = setup({ reviewRounds: 1 }); // currentRound 2 > 1
  try {
    const result = enqueue(fx);
    assert.equal(result.status, 'cap-parked');
    assert.equal(readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items')).items.filter((w) => w.origin === 'gate-fix').length, 0);
    assert.equal(parseManifest(readFileSync(fx.manifestPath, 'utf8')).resume_from, undefined, 'no send-back stamp on a cap park');
    assert.ok(existsSync(reviewCapExhaustedPath(fx.wt)), 'a greppable park marker is dropped');
  } finally {
    fx.cleanup();
    if (prior === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = prior;
  }
});

test('enqueue: shares the TOTAL cap — an existing full queue parks before writing', () => {
  const prior = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = '1';
  const fx = setup({ reviewRounds: 0 });
  try {
    // Seed one existing fix WI so existingFixCount(1) + 1 > 1.
    writeWorkItem(
      {
        work_item_id: 'WI-2',
        initiative_id: ID,
        status: 'complete',
        depends_on: [],
        acceptance_criteria: [{ given: 'x', when: 'y', then: 'z' }],
        files_in_scope: ['src/cli.ts'],
        estimated_iterations: 1,
        quality_gate_cmd: GATE,
        origin: 'review-fix',
        body: 'prior fix',
      },
      fx.wt,
    );
    const result = enqueue(fx);
    assert.equal(result.status, 'cap-parked');
    assert.equal(readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items')).items.filter((w) => w.origin === 'gate-fix').length, 0);
    assert.ok(existsSync(reviewCapExhaustedPath(fx.wt)));
  } finally {
    fx.cleanup();
    if (prior === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = prior;
  }
});

test('enqueue: a missing last-gate-failure.md still compiles (terse fallback rationale)', () => {
  const fx = setup({ reviewRounds: 0 }); // no gateFailure seeded
  try {
    const result = enqueue(fx, 'ci');
    assert.equal(result.status, 'compiled');
    if (result.status !== 'compiled') return;
    const gateFix = readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items')).items.find((w) => w.origin === 'gate-fix');
    assert.ok(gateFix, 'a gate-fix WI is still compiled without the feedback file');
    assert.ok(gateFix!.body.includes('ci'), 'the failing sub-gate is named');
  } finally {
    fx.cleanup();
  }
});
