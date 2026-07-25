import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  seedStaticUnifierItem,
  readUnifierItems,
  unifierItemsDir,
  pendingUnifierItems,
  hasFailedUnifierItem,
  rearmStaticUnifierItem,
} from './unifier-items.ts';
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

test('pendingUnifierItems returns only not-complete UWIs in dependency order', () => {
  const wt = tmpWorktree();
  try {
    // Empty queue → nothing pending.
    assert.deepEqual(pendingUnifierItems(wt), []);

    const uwi1Path = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    // Fresh seed → UWI-1 pending.
    let pending = pendingUnifierItems(wt);
    assert.deepEqual(pending.map((p) => p.work_item_id), ['UWI-1']);

    // A second WorkItem written directly into the unifier-items dir (ADR 040:
    // the queue only ever holds UWI-1 in production, but pendingUnifierItems
    // itself is a generic dependency-order filter — pin that with a synthetic
    // second item rather than the removed append machinery).
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

test('hasFailedUnifierItem: false on an empty queue and on a pending-only queue', () => {
  const wt = tmpWorktree();
  try {
    assert.equal(hasFailedUnifierItem(wt), false, 'empty queue → false');
    seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    assert.equal(hasFailedUnifierItem(wt), false, 'fresh pending UWI-1 → false');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('hasFailedUnifierItem: true once any UWI is marked failed', () => {
  const wt = tmpWorktree();
  try {
    const p1 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    writeWorkItemStatus(p1, 'failed');
    assert.equal(hasFailedUnifierItem(wt), true);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// rearmStaticUnifierItem — ADR 040: re-arm UWI-1 to `pending` ahead of a
// fix-loop re-entry so the unifier re-authors demo.json + the PR description
// against the fixed branch.
// ---------------------------------------------------------------------------

test('rearmStaticUnifierItem: UWI-1 complete → re-armed to pending, returns true', () => {
  const wt = tmpWorktree();
  try {
    const p1 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    writeWorkItemStatus(p1, 'complete');
    assert.equal(readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-1')!.status, 'complete');

    const rearmed = rearmStaticUnifierItem(wt);
    assert.equal(rearmed, true);
    assert.equal(readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-1')!.status, 'pending');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('rearmStaticUnifierItem: UWI-1 already pending → no-op, returns true', () => {
  const wt = tmpWorktree();
  try {
    const p1 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    const before = readFileSync(p1, 'utf8');

    const rearmed = rearmStaticUnifierItem(wt);
    assert.equal(rearmed, true);
    assert.equal(readFileSync(p1, 'utf8'), before, 'already-pending UWI-1 left untouched');
    assert.equal(readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-1')!.status, 'pending');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('rearmStaticUnifierItem: no UWI-1 in the queue → returns false', () => {
  const wt = tmpWorktree();
  try {
    assert.equal(rearmStaticUnifierItem(wt), false, 'empty queue has nothing to re-arm');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('rearmStaticUnifierItem: idempotent across a double call', () => {
  const wt = tmpWorktree();
  try {
    const p1 = seedStaticUnifierItem(wt, { initiativeId: INIT, estimatedIterations: 8, qualityGateCmd: ['go', 'test', './...'] });
    writeWorkItemStatus(p1, 'complete');

    assert.equal(rearmStaticUnifierItem(wt), true);
    assert.equal(readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-1')!.status, 'pending');
    // Second call on the now-pending UWI-1 is the no-op path — still true,
    // still pending, no throw.
    assert.equal(rearmStaticUnifierItem(wt), true);
    assert.equal(readUnifierItems(wt).items.find((i) => i.work_item_id === 'UWI-1')!.status, 'pending');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Plan 2.5 / N3 — UWI scope + prose resolve the demo path through the SSOT.
// On an artifactRoot project the unifier authors forge/history/<id>/demo/…;
// a UWI whose files_in_scope / AC text says demo/<id>/demo.json points the
// agent (and the scope ceiling) at a path nothing writes to.
// ---------------------------------------------------------------------------

function tmpArtifactRootWorktree(): string {
  const wt = tmpWorktree();
  mkdirSync(join(wt, '.forge'), { recursive: true });
  writeFileSync(join(wt, '.forge', 'project.json'), JSON.stringify({ artifactRoot: 'forge' }));
  return wt;
}

test('seedStaticUnifierItem resolves the demo path via the SSOT on an artifactRoot project', () => {
  const wt = tmpArtifactRootWorktree();
  try {
    const path = seedStaticUnifierItem(wt, {
      initiativeId: INIT,
      estimatedIterations: 8,
      qualityGateCmd: ['go', 'test', './...'],
    });
    const text = readFileSync(path, 'utf8');
    const uwi1 = readUnifierItems(wt).items[0]!;
    const ssotPath = `forge/history/${INIT}/demo/demo.json`;
    assert.ok(uwi1.files_in_scope.includes(ssotPath), `files_in_scope carries ${ssotPath}`);
    assert.ok(!uwi1.files_in_scope.includes(`demo/${INIT}/demo.json`), 'legacy path absent from scope');
    assert.ok(text.includes(ssotPath), 'AC/body prose names the SSOT path');
    assert.ok(!text.includes(`demo/${INIT}/demo.json`), 'AC/body prose does not name the legacy path');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});
