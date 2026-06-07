import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { seedStaticUnifierItem, readUnifierItems, nextUnifierItemId, unifierItemsDir } from './unifier-items.ts';
import { writeWorkItem, parseWorkItem, type WorkItem } from './work-item.ts';

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
