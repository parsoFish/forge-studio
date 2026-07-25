import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  compileFixWorkItems,
  devWorkItemsDir,
  fixWorkItemCount,
  hasFailedFixWorkItem,
  hasReviewCapExhaustedMarker,
  nextDevWorkItemId,
  pendingFixWorkItems,
  reviewCapExhaustedPath,
  writeReviewCapExhaustedMarker,
  FixConcernInvalidError,
  FixLoopCapError,
  type FixLoopCaps,
} from './fix-work-items.ts';
import { worktreeDemoJsonRelPath } from './demo-paths.ts';
import { writeWorkItem, readWorkItemsFromDir, type WorkItem } from './work-item.ts';

const INIT = 'INIT-2026-07-25-sendback-loop';
const PROJECT_GATE = ['npm', 'test'];
const DEFAULT_CAPS: FixLoopCaps = { maxSendBackRounds: 6, maxTotalFixWorkItems: 24 };

function tmpWorktree(): string {
  return mkdtempSync(join(tmpdir(), 'forge-fixwi-'));
}

/** Seed a work item (PM- or fix-authored) directly onto the initiative's dev queue. */
function seedWorkItem(
  wt: string,
  id: string,
  overrides: Partial<WorkItem> = {},
): string {
  const wi: WorkItem = {
    work_item_id: id,
    initiative_id: overrides.initiative_id ?? INIT,
    status: overrides.status ?? 'complete',
    depends_on: overrides.depends_on ?? [],
    acceptance_criteria: overrides.acceptance_criteria ?? [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: overrides.files_in_scope ?? [`src/${id.toLowerCase()}.ts`],
    estimated_iterations: overrides.estimated_iterations ?? 3,
    quality_gate_cmd: overrides.quality_gate_cmd ?? PROJECT_GATE,
    body: overrides.body ?? `# ${id}`,
    ...(overrides.origin !== undefined ? { origin: overrides.origin } : {}),
    ...(overrides.kind !== undefined ? { kind: overrides.kind } : {}),
    ...(overrides.behavior_preserving !== undefined
      ? { behavior_preserving: overrides.behavior_preserving }
      : {}),
  };
  return writeWorkItem(wi, wt, { workItemsDir: devWorkItemsDir(wt) });
}

function queueIds(wt: string): string[] {
  return readWorkItemsFromDir(devWorkItemsDir(wt))
    .items.map((w) => w.work_item_id)
    .sort();
}

// ---------------------------------------------------------------------------
// 1. compileFixWorkItems happy path (code-fix default)
// ---------------------------------------------------------------------------

test('compileFixWorkItems: code-fix default happy path', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete', files_in_scope: ['src/foo.ts'] });
    seedWorkItem(wt, 'WI-2', { status: 'complete', files_in_scope: ['src/bar.ts'] });

    const rationale = 'the counter increments twice on a single click';
    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: {
        origin: 'review-fix',
        rationale,
        acceptanceCriteria: [
          { given: 'a single click', when: 'the handler fires once', then: 'the counter increments by exactly 1' },
        ],
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 4,
      caps: DEFAULT_CAPS,
      currentRound: 1,
    });

    assert.deepEqual(appended, ['WI-3']);

    const { items } = readWorkItemsFromDir(devWorkItemsDir(wt));
    const wi3 = items.find((w) => w.work_item_id === 'WI-3')!;
    assert.ok(wi3, 'WI-3 written to disk');
    assert.equal(wi3.origin, 'review-fix');
    assert.equal(wi3.status, 'pending');
    assert.deepEqual(wi3.depends_on, []);
    assert.ok(!('kind' in wi3), 'no kind key on a compiled dev fix WI');
    assert.ok(!('behavior_preserving' in wi3), 'no behavior_preserving key for a code-fix concern');
    assert.deepEqual(wi3.quality_gate_cmd, PROJECT_GATE);

    const demoJsonRel = worktreeDemoJsonRelPath(wt, INIT);
    const expectedSubset = ['src/foo.ts', 'src/bar.ts', '.forge/pr-description.md', demoJsonRel];
    for (const f of expectedSubset) {
      assert.ok(wi3.files_in_scope.includes(f), `files_in_scope includes ${f}`);
    }

    assert.ok(wi3.body.includes(rationale), 'body carries the rationale verbatim');
    assert.ok(wi3.body.includes('failing test FIRST'), 'body directs fail-first-test discipline');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. packaging concern
// ---------------------------------------------------------------------------

test('compileFixWorkItems: packaging concern sets behavior_preserving true', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });

    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: {
        origin: 'review-fix',
        rationale: 'the demo caption is confusing',
        acceptanceCriteria: [{ given: 'the demo', when: 'a reviewer reads it', then: 'the before/after is obvious' }],
        concernKind: 'packaging',
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 2,
      caps: DEFAULT_CAPS,
      currentRound: 1,
    });

    const wi = readWorkItemsFromDir(devWorkItemsDir(wt)).items.find((w) => w.work_item_id === appended[0])!;
    assert.equal(wi.behavior_preserving, true, 'behavior_preserving stamped true on disk');
    assert.equal(wi.origin, 'review-fix', 'still origin-marked');
    assert.ok(wi.body.includes('packaging'), 'body names the packaging classification');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. sharp gate override + H1 shell-pipeline rejection
// ---------------------------------------------------------------------------

test('compileFixWorkItems: qualityGateCmd override is stamped verbatim', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const sharp = ['npm', 'run', 'test:unit', '--', '-t', 'CounterHandler'];

    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: {
        origin: 'review-fix',
        rationale: 'r',
        acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
        qualityGateCmd: sharp,
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 3,
      caps: DEFAULT_CAPS,
      currentRound: 1,
    });

    const wi = readWorkItemsFromDir(devWorkItemsDir(wt)).items.find((w) => w.work_item_id === appended[0])!;
    assert.deepEqual(wi.quality_gate_cmd, sharp, 'sharp gate stamped verbatim, not the project gate');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('H1: compileFixWorkItems rejects a shell-pipeline qualityGateCmd; queue untouched', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const before = queueIds(wt);

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: {
            origin: 'review-fix',
            rationale: 'r',
            acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
            qualityGateCmd: ['bash', '-c', 'a | b'],
          },
          projectGateCmd: PROJECT_GATE,
          estimatedIterations: 3,
          caps: DEFAULT_CAPS,
          currentRound: 1,
        }),
      FixConcernInvalidError,
    );

    assert.deepEqual(queueIds(wt), before, 'queue directory listing unchanged');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. filesInScope override
// ---------------------------------------------------------------------------

test('compileFixWorkItems: filesInScope override is used verbatim (not the union)', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete', files_in_scope: ['src/foo.ts'] });
    seedWorkItem(wt, 'WI-2', { status: 'complete', files_in_scope: ['src/bar.ts'] });
    const explicitScope = ['src/only-this.ts'];

    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: {
        origin: 'demo-fix',
        rationale: 'r',
        acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
        filesInScope: explicitScope,
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 3,
      caps: DEFAULT_CAPS,
      currentRound: 1,
    });

    const wi = readWorkItemsFromDir(devWorkItemsDir(wt)).items.find((w) => w.work_item_id === appended[0])!;
    assert.deepEqual(wi.files_in_scope, explicitScope, 'scope is exactly the override, no union added');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. validation rejects malformed concerns; queue untouched in each case
// ---------------------------------------------------------------------------

test('compileFixWorkItems: empty acceptanceCriteria throws FixConcernInvalidError; queue untouched', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const before = queueIds(wt);

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [] },
          projectGateCmd: PROJECT_GATE,
          estimatedIterations: 3,
          caps: DEFAULT_CAPS,
          currentRound: 1,
        }),
      FixConcernInvalidError,
    );
    assert.deepEqual(queueIds(wt), before);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('compileFixWorkItems: blank-field ACs throw FixConcernInvalidError; queue untouched', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const before = queueIds(wt);

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: {
            origin: 'review-fix',
            rationale: 'r',
            acceptanceCriteria: [{ given: ' ', when: '', then: '' }],
          },
          projectGateCmd: PROJECT_GATE,
          estimatedIterations: 3,
          caps: DEFAULT_CAPS,
          currentRound: 1,
        }),
      FixConcernInvalidError,
    );
    assert.deepEqual(queueIds(wt), before);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('compileFixWorkItems: empty projectGateCmd throws FixConcernInvalidError; queue untouched', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const before = queueIds(wt);

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
          projectGateCmd: [],
          estimatedIterations: 3,
          caps: DEFAULT_CAPS,
          currentRound: 1,
        }),
      FixConcernInvalidError,
    );
    assert.deepEqual(queueIds(wt), before);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. caps: rounds, totals, and the cap-1 boundary
// ---------------------------------------------------------------------------

test('compileFixWorkItems: currentRound > maxSendBackRounds throws FixLoopCapError naming rounds', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    const caps: FixLoopCaps = { maxSendBackRounds: 2, maxTotalFixWorkItems: 24 };

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
          projectGateCmd: PROJECT_GATE,
          estimatedIterations: 3,
          caps,
          currentRound: 3,
        }),
      (err: unknown) => err instanceof FixLoopCapError && /round/i.test((err as Error).message),
    );
    assert.deepEqual(queueIds(wt), ['WI-1'], 'queue untouched on round-cap rejection');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('compileFixWorkItems: existing fix WIs at maxTotalFixWorkItems throws FixLoopCapError naming totals', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'pending', origin: 'review-fix' });
    seedWorkItem(wt, 'WI-2', { status: 'pending', origin: 'review-fix' });
    const caps: FixLoopCaps = { maxSendBackRounds: 6, maxTotalFixWorkItems: 2 };

    assert.throws(
      () =>
        compileFixWorkItems({
          worktreePath: wt,
          initiativeId: INIT,
          source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
          projectGateCmd: PROJECT_GATE,
          estimatedIterations: 3,
          caps,
          currentRound: 1,
        }),
      (err: unknown) => err instanceof FixLoopCapError && /total/i.test((err as Error).message),
    );
    assert.deepEqual(queueIds(wt), ['WI-1', 'WI-2'], 'queue untouched on total-cap rejection');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('compileFixWorkItems: boundary — existing count at cap-1 still succeeds', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'pending', origin: 'review-fix' });
    const caps: FixLoopCaps = { maxSendBackRounds: 6, maxTotalFixWorkItems: 2 };

    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 3,
      caps,
      currentRound: 1,
    });
    assert.deepEqual(appended, ['WI-2'], 'appends right at the cap boundary');
    assert.deepEqual(queueIds(wt), ['WI-1', 'WI-2']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. append-only ids
// ---------------------------------------------------------------------------

test('compileFixWorkItems: append-only ids — WI-1,WI-2,WI-7 present → next compiled id is WI-8', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' });
    seedWorkItem(wt, 'WI-2', { status: 'complete' });
    seedWorkItem(wt, 'WI-7', { status: 'complete' });
    assert.equal(nextDevWorkItemId(wt), 'WI-8', 'nextDevWorkItemId skips the gap and goes past the max');

    const { appended } = compileFixWorkItems({
      worktreePath: wt,
      initiativeId: INIT,
      source: { origin: 'review-fix', rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 3,
      caps: DEFAULT_CAPS,
      currentRound: 1,
    });
    assert.deepEqual(appended, ['WI-8']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. predicates: pendingFixWorkItems / hasFailedFixWorkItem / fixWorkItemCount
// ---------------------------------------------------------------------------

test('pendingFixWorkItems: only origin-set pending|in-progress WIs, topo order, PM WIs excluded', () => {
  const wt = tmpWorktree();
  try {
    // PM WIs (no origin) — pending and failed, both must be excluded regardless of status.
    seedWorkItem(wt, 'WI-1', { status: 'pending' });
    seedWorkItem(wt, 'WI-2', { status: 'complete' });
    // Fix WIs.
    seedWorkItem(wt, 'WI-3', { status: 'pending', origin: 'review-fix' });
    seedWorkItem(wt, 'WI-4', { status: 'in-progress', origin: 'demo-fix' });
    seedWorkItem(wt, 'WI-5', { status: 'complete', origin: 'gate-fix' });
    seedWorkItem(wt, 'WI-6', { status: 'failed', origin: 'review-fix' });

    const pending = pendingFixWorkItems(wt);
    assert.deepEqual(
      pending.map((w) => w.work_item_id),
      ['WI-3', 'WI-4'],
      'only pending/in-progress origin-set WIs, in topo order; PM WI-1 (pending, no origin) excluded',
    );
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('hasFailedFixWorkItem: true only for a failed origin-set WI, not a failed PM WI', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'failed' }); // PM WI, no origin
    assert.equal(hasFailedFixWorkItem(wt), false, 'a failed PM WI does not count');

    seedWorkItem(wt, 'WI-2', { status: 'failed', origin: 'review-fix' });
    assert.equal(hasFailedFixWorkItem(wt), true, 'a failed origin-set WI does count');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('fixWorkItemCount: counts all origin-set WIs regardless of status', () => {
  const wt = tmpWorktree();
  try {
    seedWorkItem(wt, 'WI-1', { status: 'complete' }); // PM WI, excluded
    seedWorkItem(wt, 'WI-2', { status: 'pending', origin: 'review-fix' });
    seedWorkItem(wt, 'WI-3', { status: 'in-progress', origin: 'demo-fix' });
    seedWorkItem(wt, 'WI-4', { status: 'complete', origin: 'gate-fix' });
    seedWorkItem(wt, 'WI-5', { status: 'failed', origin: 'review-fix' });

    assert.equal(fixWorkItemCount(wt), 4);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 9. review-cap-exhausted marker
// ---------------------------------------------------------------------------

test('writeReviewCapExhaustedMarker / hasReviewCapExhaustedMarker round-trip', () => {
  const wt = tmpWorktree();
  try {
    assert.equal(hasReviewCapExhaustedMarker(wt), false, 'no marker before writing');

    const detail = 'send-back round cap reached (round 7 > 6).';
    writeReviewCapExhaustedMarker(wt, detail);

    assert.equal(hasReviewCapExhaustedMarker(wt), true, 'marker present after writing');
    const content = readFileSync(reviewCapExhaustedPath(wt), 'utf8');
    assert.ok(content.includes(detail), 'marker file contains the detail verbatim');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

