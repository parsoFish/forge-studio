/**
 * Unit tests for orchestrator/reviewer-stage2.ts. Pure-function tests +
 * tempdir-based fix_plan.md / AGENT.md mutation tests. No SDK calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendSendBackFeedback,
  buildVerdictContext,
  countOpenSendBackItems,
  makeReviewerQualityGate,
  type GetVerdict,
  type ReviewerGateContext,
  type ReviewerGateState,
  type Verdict,
  type VerdictContext,
} from './reviewer-stage2.ts';
import type { WorkItem } from './work-item.ts';

function workItem(): WorkItem {
  return {
    work_item_id: 'WI-1',
    feature_id: 'FEAT-1',
    initiative_id: 'INIT-2026-05-09-test',
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['src/foo.ts'],
    estimated_iterations: 2,
    body: '',
  };
}

function setupWorktree(): { worktree: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-stage2-test-'));
  mkdirSync(join(dir, '.forge', 'demos', 'INIT-2026-05-09-test'), { recursive: true });
  writeFileSync(join(dir, 'fix_plan.md'), '# Fix Plan\n\n_(populate from acceptance criteria)_\n');
  writeFileSync(join(dir, 'AGENT.md'), '# Agent Memory\n');
  return { worktree: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------- appendSendBackFeedback ----------

test('appendSendBackFeedback: writes a Round N section with rationale + ACs', () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    const fp = join(worktree, 'fix_plan.md');
    appendSendBackFeedback(
      fp,
      2,
      [
        { given: 'an empty input', when: 'slugify("") is called', then: 'an empty string is returned' },
        { given: 'an emoji input', when: 'slugify("🎉")', then: '"" is returned (emoji dropped)' },
      ],
      'Edge cases not covered',
    );
    const text = readFileSync(fp, 'utf8');
    assert.match(text, /## Round 2 send-back/);
    assert.match(text, /Edge cases not covered/);
    assert.match(text, /- \[ \] AC: GIVEN an empty input/);
    assert.match(text, /- \[ \] AC: GIVEN an emoji input/);
  } finally {
    cleanup();
  }
});

test('appendSendBackFeedback: empty feedback array is a no-op', () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    const fp = join(worktree, 'fix_plan.md');
    const before = readFileSync(fp, 'utf8');
    appendSendBackFeedback(fp, 2, [], 'no feedback');
    assert.equal(readFileSync(fp, 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('appendSendBackFeedback: multiple rounds chronologically appended', () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    const fp = join(worktree, 'fix_plan.md');
    appendSendBackFeedback(fp, 1, [{ given: 'x', when: 'y', then: 'z' }], 'first');
    appendSendBackFeedback(fp, 2, [{ given: 'a', when: 'b', then: 'c' }], 'second');
    const text = readFileSync(fp, 'utf8');
    const r1 = text.indexOf('## Round 1 send-back');
    const r2 = text.indexOf('## Round 2 send-back');
    assert.ok(r1 > 0 && r2 > r1, 'rounds appear in chronological order');
  } finally {
    cleanup();
  }
});

// ---------- buildVerdictContext ----------

test('buildVerdictContext: assembles paths and copies workItems', () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    const ctx = buildVerdictContext({
      initiativeId: 'INIT-2026-05-09-test',
      worktreePath: worktree,
      manifestPath: '/tmp/manifest.md',
      workItems: [workItem()],
      roundNumber: 1,
    });
    assert.equal(ctx.initiativeId, 'INIT-2026-05-09-test');
    assert.equal(ctx.workItems.length, 1);
    assert.match(ctx.prDescriptionPath, /\.forge\/pr-description\.md$/);
    assert.match(ctx.demoBundleDir, /\.forge\/demos\/INIT-2026-05-09-test$/);
    assert.equal(ctx.roundNumber, 1);
    // Diff summary falls back to a placeholder when no git
    assert.match(ctx.diffSummary, /no git diff available|^.*$/);
  } finally {
    cleanup();
  }
});

// ---------- countOpenSendBackItems ----------

test('countOpenSendBackItems: counts unchecked items under send-back headers', () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    const fp = join(worktree, 'fix_plan.md');
    appendSendBackFeedback(
      fp,
      1,
      [
        { given: 'x', when: 'y', then: 'z' },
        { given: 'a', when: 'b', then: 'c' },
      ],
      'first',
    );
    appendSendBackFeedback(
      fp,
      2,
      [{ given: 'p', when: 'q', then: 'r' }],
      'second',
    );
    assert.equal(countOpenSendBackItems(fp, 1), 3);
    assert.equal(countOpenSendBackItems(fp, 2), 1);
    assert.equal(countOpenSendBackItems(fp, 3), 0);
  } finally {
    cleanup();
  }
});

test('countOpenSendBackItems: missing fix_plan.md returns 0', () => {
  assert.equal(countOpenSendBackItems('/nonexistent/path'), 0);
});

// ---------- makeReviewerQualityGate ----------

function ctxWith(worktree: string): ReviewerGateContext {
  return {
    initiativeId: 'INIT-2026-05-09-test',
    worktreePath: worktree,
    manifestPath: '/tmp/manifest.md',
    workItems: [workItem()],
    fixPlanPath: join(worktree, 'fix_plan.md'),
    agentMdPath: join(worktree, 'AGENT.md'),
    qualityGateCmd: ['true'], // always passes
  };
}

function makeState(): ReviewerGateState {
  return { invocations: 0, verdicts: [], qualityGateResults: [] };
}

function fakeArtifacts(worktree: string): void {
  // Drop a non-empty pr-description.md and a demos/ dir so the gate can reach the verdict step.
  writeFileSync(
    join(worktree, '.forge', 'pr-description.md'),
    '## Why\nbecause\n## What\nx\n## How\ny\n## Demo\n[link](.forge/demos/INIT/recording.mp4)',
  );
}

test('makeReviewerQualityGate: returns true on approve verdict', async () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    fakeArtifacts(worktree);
    const ctx = ctxWith(worktree);
    const state = makeState();
    const getVerdict: GetVerdict = async () => ({ kind: 'approve', rationale: 'lgtm' });
    const gate = makeReviewerQualityGate(ctx, getVerdict, state);
    const result = await gate();
    assert.equal(result, true);
    assert.equal(state.invocations, 1);
    assert.equal(state.verdicts[0].kind, 'approve');
    // AGENT.md should now mention the verdict.
    const agentMd = readFileSync(ctx.agentMdPath, 'utf8');
    assert.match(agentMd, /APPROVED/);
  } finally {
    cleanup();
  }
});

test('makeReviewerQualityGate: returns false on send-back, appends feedback to fix_plan.md', async () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    fakeArtifacts(worktree);
    const ctx = ctxWith(worktree);
    const state = makeState();
    const getVerdict: GetVerdict = async () => ({
      kind: 'send-back',
      feedback: [{ given: 'a', when: 'b', then: 'c' }],
      rationale: 'missing test',
    });
    const gate = makeReviewerQualityGate(ctx, getVerdict, state);
    const r1 = await gate();
    assert.equal(r1, false);
    assert.equal(state.invocations, 1);
    const fp = readFileSync(ctx.fixPlanPath, 'utf8');
    assert.match(fp, /Round 1 send-back/);
    assert.match(fp, /missing test/);
    assert.match(fp, /AC: GIVEN a/);
  } finally {
    cleanup();
  }
});

test('makeReviewerQualityGate: increments roundNumber across calls', async () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    fakeArtifacts(worktree);
    const ctx = ctxWith(worktree);
    const state = makeState();
    const verdicts: Verdict[] = [
      { kind: 'send-back', feedback: [{ given: 'g1', when: 'w1', then: 't1' }], rationale: 'r1' },
      { kind: 'send-back', feedback: [{ given: 'g2', when: 'w2', then: 't2' }], rationale: 'r2' },
      { kind: 'approve', rationale: 'finally good' },
    ];
    let i = 0;
    const observed: number[] = [];
    const getVerdict: GetVerdict = async (vctx: VerdictContext) => {
      observed.push(vctx.roundNumber);
      return verdicts[i++];
    };
    const gate = makeReviewerQualityGate(ctx, getVerdict, state);
    assert.equal(await gate(), false);
    assert.equal(await gate(), false);
    assert.equal(await gate(), true);
    assert.deepEqual(observed, [1, 2, 3]);
    assert.equal(state.invocations, 3);
    assert.equal(state.verdicts.length, 3);
    const fp = readFileSync(ctx.fixPlanPath, 'utf8');
    assert.match(fp, /Round 1 send-back/);
    assert.match(fp, /Round 2 send-back/);
    assert.equal(/Round 3 send-back/.test(fp), false, 'approve does not append send-back');
  } finally {
    cleanup();
  }
});

test('makeReviewerQualityGate: project quality gate red → returns false without calling getVerdict', async () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    fakeArtifacts(worktree);
    const ctx: ReviewerGateContext = { ...ctxWith(worktree), qualityGateCmd: ['false'] };
    const state = makeState();
    let verdictCalled = false;
    const getVerdict: GetVerdict = async () => {
      verdictCalled = true;
      return { kind: 'approve', rationale: 'unused' };
    };
    const gate = makeReviewerQualityGate(ctx, getVerdict, state);
    const r = await gate();
    assert.equal(r, false);
    assert.equal(verdictCalled, false, 'getVerdict not called when gates red');
    assert.equal(state.qualityGateResults[0], false);
    const fp = readFileSync(ctx.fixPlanPath, 'utf8');
    assert.match(fp, /quality gate FAILED/);
  } finally {
    cleanup();
  }
});

test('makeReviewerQualityGate: missing pr-description.md → returns false without calling getVerdict', async () => {
  const { worktree, cleanup } = setupWorktree();
  try {
    // No pr-description written.
    const ctx = ctxWith(worktree);
    const state = makeState();
    let verdictCalled = false;
    const getVerdict: GetVerdict = async () => {
      verdictCalled = true;
      return { kind: 'approve', rationale: 'unused' };
    };
    const gate = makeReviewerQualityGate(ctx, getVerdict, state);
    const r = await gate();
    assert.equal(r, false);
    assert.equal(verdictCalled, false);
    const fp = readFileSync(ctx.fixPlanPath, 'utf8');
    assert.match(fp, /artifacts missing/);
  } finally {
    cleanup();
  }
});
