/**
 * Tests for orchestrator/demo-fix-loop.ts (R4-10-F1) — the demo-agent's AC-miss
 * judgment compiled into the shared post-develop fix loop: mapping proposals →
 * `demo-fix` WIs, stamping the manifest send-back, sharing the review-fix caps,
 * and reject-then-park on cap exhaustion.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { enqueueDemoFixWorkItems, demoFixProposalToConcern } from './demo-fix-loop.ts';
import { parseManifest } from './manifest.ts';
import { writeWorkItem, readWorkItemsFromDir, type WorkItem } from './work-item.ts';
import { reviewCapExhaustedPath } from './fix-work-items.ts';
import type { DemoFixProposal, DemoFixSpecRecord } from './flow-artifacts.ts';

const ID = 'INIT-2026-08-02-demofix';
const GATE = ['npm', 'test'];

type Fixture = { root: string; wt: string; manifestPath: string; fixSpecPath: string; cleanup: () => void };

function setup(opts: { reviewRounds?: number } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'demo-fix-loop-'));
  const wt = join(root, 'wt');
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  // A completed PM work item so the queue is a valid set the fix WI appends to.
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
      'phase: in-flight',
      'origin: architect',
      `worktree_path: ${wt}`,
      ...(opts.reviewRounds !== undefined ? [`review_rounds: ${opts.reviewRounds}`] : []),
      '---',
      `# ${ID}`,
      '',
    ].join('\n'),
  );

  const fixSpecPath = join(root, 'demo-fix-spec.json');
  return { root, wt, manifestPath, fixSpecPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function proposal(overrides: Partial<DemoFixProposal> & Pick<DemoFixProposal, 'id' | 'criterion'>): DemoFixProposal {
  return {
    verdict: 'missed',
    evidence: 'the after run prints nothing',
    title: 'Print usage on bare invocation',
    acceptance_criteria: [{ given: 'a built CLI', when: 'run bare', then: 'usage on stdout' }],
    files_in_scope: ['src/cli.ts'],
    rationale: 'behaviour absent, not an evidence-capture failure',
    ...overrides,
  };
}

function writeFixSpec(fixSpecPath: string, proposals: DemoFixProposal[]): void {
  const record: DemoFixSpecRecord = {
    initiative_id: ID,
    cycleId: 'CYCLE-1',
    demoJsonPath: `demo/${ID}/demo.json`,
    authoredAt: '2026-08-02T00:00:00.000Z',
    proposals,
  };
  writeFileSync(fixSpecPath, JSON.stringify(record, null, 2));
}

test('demoFixProposalToConcern maps a proposal to a code-fix demo-fix concern (verbatim ACs + scope)', () => {
  const p = proposal({ id: 'FIX-1', criterion: 'C1' });
  const concern = demoFixProposalToConcern(p);
  assert.equal(concern.origin, 'demo-fix');
  assert.equal(concern.concernKind, 'code-fix');
  assert.deepEqual(concern.acceptanceCriteria, p.acceptance_criteria);
  assert.deepEqual(concern.filesInScope, p.files_in_scope);
  assert.ok(concern.rationale.includes(p.evidence), 'the miss evidence rides into the WI rationale');
});

test('enqueue: compiles one demo-fix WI per proposal + stamps the send-back (resume_from:develop, round++)', () => {
  const fx = setup({ reviewRounds: 0 });
  try {
    writeFixSpec(fx.fixSpecPath, [
      proposal({ id: 'FIX-1', criterion: 'C1' }),
      proposal({ id: 'FIX-2', criterion: 'C2' }),
    ]);
    const result = enqueueDemoFixWorkItems({
      worktreePath: fx.wt,
      manifestPath: fx.manifestPath,
      initiativeId: ID,
      fixSpecPath: fx.fixSpecPath,
      projectGateCmd: GATE,
    });
    assert.equal(result.status, 'compiled');
    if (result.status !== 'compiled') return;
    assert.equal(result.appended.length, 2, 'one demo-fix WI per proposal');
    assert.equal(result.round, 1, 'the shared round counter advanced to 1');

    // The WIs landed on the initiative queue, marked origin:demo-fix.
    const { items } = readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items'));
    const demoFix = items.filter((w) => w.origin === 'demo-fix');
    assert.equal(demoFix.length, 2);
    assert.ok(demoFix.every((w) => w.status === 'pending'));

    // The manifest carries the send-back stamp so the drain re-enters + crash-recovers.
    const m = parseManifest(readFileSync(fx.manifestPath, 'utf8'));
    assert.equal(m.resume_from, 'develop');
    assert.equal(m.review_rounds, 1);
    assert.ok((m.specs ?? []).includes(result.appended[0]!), 'appended WI ids are back-referenced on the manifest');
  } finally {
    fx.cleanup();
  }
});

test('enqueue: shares the round cap with review-fix — round over the cap parks (marker written, nothing enqueued)', () => {
  const prior = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '1';
  const fx = setup({ reviewRounds: 1 }); // currentRound would be 2 > 1
  try {
    writeFixSpec(fx.fixSpecPath, [proposal({ id: 'FIX-1', criterion: 'C1' })]);
    const result = enqueueDemoFixWorkItems({
      worktreePath: fx.wt,
      manifestPath: fx.manifestPath,
      initiativeId: ID,
      fixSpecPath: fx.fixSpecPath,
      projectGateCmd: GATE,
    });
    assert.equal(result.status, 'cap-parked');
    // Nothing enqueued, and the manifest is NOT stamped (accepting would enqueue undrainable work).
    const { items } = readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items'));
    assert.equal(items.filter((w) => w.origin === 'demo-fix').length, 0, 'no WIs written on a cap park');
    assert.equal(parseManifest(readFileSync(fx.manifestPath, 'utf8')).resume_from, undefined, 'no send-back stamp on a cap park');
    assert.ok(existsSync(reviewCapExhaustedPath(fx.wt)), 'a greppable park marker is dropped');
  } finally {
    fx.cleanup();
    if (prior === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = prior;
  }
});

test('enqueue: shares the TOTAL cap with review-fix — proposals overflowing the total park before any write', () => {
  const prior = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = '1';
  const fx = setup({ reviewRounds: 0 });
  try {
    writeFixSpec(fx.fixSpecPath, [
      proposal({ id: 'FIX-1', criterion: 'C1' }),
      proposal({ id: 'FIX-2', criterion: 'C2' }),
    ]);
    const result = enqueueDemoFixWorkItems({
      worktreePath: fx.wt,
      manifestPath: fx.manifestPath,
      initiativeId: ID,
      fixSpecPath: fx.fixSpecPath,
      projectGateCmd: GATE,
    });
    assert.equal(result.status, 'cap-parked');
    assert.equal(readWorkItemsFromDir(join(fx.wt, '.forge', 'work-items')).items.filter((w) => w.origin === 'demo-fix').length, 0);
    assert.ok(existsSync(reviewCapExhaustedPath(fx.wt)));
  } finally {
    fx.cleanup();
    if (prior === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = prior;
  }
});

test('enqueue: a missing/invalid demo-fix-spec is spec-unreadable (never silently enqueues)', () => {
  const fx = setup();
  try {
    const missing = enqueueDemoFixWorkItems({
      worktreePath: fx.wt,
      manifestPath: fx.manifestPath,
      initiativeId: ID,
      fixSpecPath: join(fx.root, 'nope.json'),
      projectGateCmd: GATE,
    });
    assert.equal(missing.status, 'spec-unreadable');

    writeFileSync(fx.fixSpecPath, '{ not json');
    const bad = enqueueDemoFixWorkItems({
      worktreePath: fx.wt,
      manifestPath: fx.manifestPath,
      initiativeId: ID,
      fixSpecPath: fx.fixSpecPath,
      projectGateCmd: GATE,
    });
    assert.equal(bad.status, 'spec-unreadable');
  } finally {
    fx.cleanup();
  }
});
