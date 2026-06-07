import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { seedStaticUnifierItem, readUnifierItems, nextUnifierItemId, unifierItemsDir, pendingUnifierItems, appendReviewUnifierItems, UnifierItemsCapError, ReviewConcernInvalidError } from './unifier-items.ts';
import { writeWorkItem, parseWorkItem, writeWorkItemStatus, type WorkItem } from './work-item.ts';

const INIT = 'INIT-2026-06-07-release-folder-data-source';

function tmpWorktree(): string {
  return mkdtempSync(join(tmpdir(), 'forge-uwi-'));
}

test('seedStaticUnifierItem writes a VALID UWI-1 that round-trips', () => {
  const wt = tmpWorktree();
  try {
    const path = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go','test','-tags','all','./...'] });
    assert.ok(existsSync(path), 'UWI-1.md written');
    assert.equal(path, join(unifierItemsDir(wt), 'UWI-1.md'));

    const { items, parseErrors } = readUnifierItems(wt);
    assert.deepEqual(parseErrors, {}, 'no parse errors');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.work_item_id, 'UWI-1');
    assert.equal(items[0]!.initiative_id, INIT);
    assert.ok(items[0]!.acceptance_criteria.length >= 1, 'has >=1 AC');
    // Re-parse the file directly to confirm the serialized form is valid.
    const reparsed = parseWorkItem(readFileSync(path, 'utf8'));
    assert.equal(reparsed.work_item_id, 'UWI-1');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('seedStaticUnifierItem is idempotent (a re-entrant cycle keeps UWI-1)', () => {
  const wt = tmpWorktree();
  try {
    const p1 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go','test','-tags','all','./...'] });
    const before = readFileSync(p1, 'utf8');
    const p2 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 15, qualityGateCmd: ['go','test','-tags','all','./...'] });
    assert.equal(p2, p1);
    assert.equal(readFileSync(p2, 'utf8'), before, 'UWI-1 untouched on re-seed');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('nextUnifierItemId appends (UWI-2 after seeding UWI-1; UWI-3 after a UWI-2)', () => {
  const wt = tmpWorktree();
  try {
    assert.equal(nextUnifierItemId(wt), 'UWI-1', 'empty queue → UWI-1');
    seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go','test','-tags','all','./...'] });
    assert.equal(nextUnifierItemId(wt), 'UWI-2');

    // Append a UWI-2 (the shape a review-feedback concern will take) and confirm next = UWI-3.
    const uwi2: WorkItem = {
      work_item_id: 'UWI-2',
      initiative_id: INIT,
      status: 'pending',
      depends_on: ['UWI-1'],
      acceptance_criteria: [{ given: 'the PR is open', when: 'the operator notes the error message', then: 'the error names both flags' }],
      files_in_scope: ['azuredevops/internal/service/release/data_release_folder.go'],
      quality_gate_cmd: ['go','test','-tags','all','-run','TestDataReleaseFolder','./azuredevops/internal/service/release/...'],
      estimated_iterations: 3,
      body: '# UWI-2 — review concern',
    };
    writeWorkItem(uwi2, wt, { workItemsDir: unifierItemsDir(wt) });
    assert.equal(nextUnifierItemId(wt), 'UWI-3');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('pendingUnifierItems returns only not-complete UWIs in dependency order', () => {
  const wt = tmpWorktree();
  try {
    // Empty queue → nothing pending.
    assert.deepEqual(pendingUnifierItems(wt), []);

    const uwi1Path = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    // Fresh seed → UWI-1 pending.
    let pending = pendingUnifierItems(wt);
    assert.deepEqual(pending.map((p) => p.work_item_id), ['UWI-1']);

    // Append a UWI-2 that depends on UWI-1 (the shape a review concern takes).
    const uwi2: WorkItem = {
      work_item_id: 'UWI-2',
      initiative_id: INIT,
      status: 'pending',
      depends_on: ['UWI-1'],
      acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
      files_in_scope: ['azuredevops/x.go'],
      quality_gate_cmd: ['go', 'test', '-run', 'X', './...'],
      estimated_iterations: 3,
      body: '# UWI-2',
    };
    writeWorkItem(uwi2, wt, { workItemsDir: unifierItemsDir(wt) });
    // Both pending, UWI-1 before UWI-2 (its prerequisite).
    pending = pendingUnifierItems(wt);
    assert.deepEqual(pending.map((p) => p.work_item_id), ['UWI-1', 'UWI-2']);

    // Mark UWI-1 complete — only UWI-2 remains pending (its now-complete
    // prerequisite drops out but UWI-2 still runs as a satisfied root).
    writeWorkItemStatus(uwi1Path, 'complete');
    pending = pendingUnifierItems(wt);
    assert.deepEqual(pending.map((p) => p.work_item_id), ['UWI-2']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

const PROJECT_GATE = ['go', 'test', '-tags', 'all', './...'];

function seededWorktree(): string {
  const wt = tmpWorktree();
  seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: PROJECT_GATE });
  return wt;
}

test('appendReviewUnifierItems: code-fix concern → concern UWI + terminal re-prep UWI', () => {
  const wt = seededWorktree();
  try {
    const { appended } = appendReviewUnifierItems({
      worktreePath: wt,
      initiativeId: INIT,
      concern: {
        rationale: 'the folder path is computed wrong',
        acceptanceCriteria: [{ given: 'a nested folder', when: 'the data source reads it', then: 'the full path is returned' }],
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 6,
    });
    assert.deepEqual(appended, ['UWI-2', 'UWI-3']);

    const { items } = readUnifierItems(wt);
    const u2 = items.find((i) => i.work_item_id === 'UWI-2')!;
    const u3 = items.find((i) => i.work_item_id === 'UWI-3')!;
    assert.equal(u2.kind, 'code-fix', 'concern defaults to code-fix');
    assert.deepEqual(u2.depends_on, ['UWI-1']);
    assert.equal(u2.acceptance_criteria.length, 1);
    assert.ok(u2.files_in_scope.includes('.forge/pr-description.md'));
    assert.equal(u3.kind, 'packaging', 'terminal re-prep is packaging');
    assert.deepEqual(u3.depends_on, ['UWI-2']);

    // The whole queue is pending in dependency order: UWI-1 (complete? no), 2, 3.
    const pendingIds = pendingUnifierItems(wt).map((p) => p.work_item_id);
    assert.deepEqual(pendingIds, ['UWI-1', 'UWI-2', 'UWI-3']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('appendReviewUnifierItems: packaging concern → a single packaging UWI (no re-prep)', () => {
  const wt = seededWorktree();
  try {
    const { appended } = appendReviewUnifierItems({
      worktreePath: wt,
      initiativeId: INIT,
      concern: {
        rationale: 'the demo caption is unclear',
        acceptanceCriteria: [{ given: 'the demo', when: 'a reviewer reads it', then: 'the before/after is obvious' }],
        kind: 'packaging',
      },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 4,
    });
    assert.deepEqual(appended, ['UWI-2']);
    const u2 = readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-2')!;
    assert.equal(u2.kind, 'packaging');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('appendReviewUnifierItems: a sharp concern gate overrides the project gate', () => {
  const wt = seededWorktree();
  try {
    const sharp = ['go', 'test', '-run', 'TestFolderPath', './azuredevops/...'];
    appendReviewUnifierItems({
      worktreePath: wt,
      initiativeId: INIT,
      concern: { rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }], qualityGateCmd: sharp },
      projectGateCmd: PROJECT_GATE,
      estimatedIterations: 6,
    });
    const u2 = readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-2')!;
    assert.deepEqual(u2.quality_gate_cmd, sharp, 'code-fix UWI uses the sharp gate');
    const u3 = readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-3')!;
    assert.deepEqual(u3.quality_gate_cmd, PROJECT_GATE, 're-prep uses the project gate');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('appendReviewUnifierItems: empty/blank ACs throw ReviewConcernInvalidError (queue untouched)', () => {
  const wt = seededWorktree();
  try {
    assert.throws(
      () => appendReviewUnifierItems({
        worktreePath: wt,
        initiativeId: INIT,
        concern: { rationale: 'r', acceptanceCriteria: [{ given: ' ', when: '', then: '' }] },
        projectGateCmd: PROJECT_GATE,
        estimatedIterations: 6,
      }),
      ReviewConcernInvalidError,
    );
    // Nothing appended — only UWI-1 remains.
    assert.deepEqual(readUnifierItems(wt).items.map((i) => i.work_item_id), ['UWI-1']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('appendReviewUnifierItems: the total-UWI cap rejects further rounds', () => {
  const wt = seededWorktree();
  try {
    // maxTotalItems 2 leaves room for only one more UWI; a code-fix needs two.
    assert.throws(
      () => appendReviewUnifierItems({
        worktreePath: wt,
        initiativeId: INIT,
        concern: { rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
        projectGateCmd: PROJECT_GATE,
        estimatedIterations: 6,
        maxTotalItems: 2,
      }),
      UnifierItemsCapError,
    );
    assert.deepEqual(readUnifierItems(wt).items.map((i) => i.work_item_id), ['UWI-1']);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});
