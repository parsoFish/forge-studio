/**
 * Tests for POST /api/verdict 'approve' path (supersedes G9).
 *
 * Verifies that the UI approve handler:
 *   1. calls mergePr(worktreePath)
 *   2. fires finalizeAfterMerge on success
 *   3. returns 200 { ok: true, note includes 'merged' }
 *   4. returns 409 when worktree is missing
 *   5. returns 409 when mergePr returns false
 *
 * The bridge's mergePr / finalizeAfterMerge are injected via BridgeOptions so
 * no real `gh` process is spawned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(worktreePath: string, initiativeId: string): string {
  return [
    '---',
    `initiative_id: ${initiativeId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    `worktree_path: ${worktreePath}`,
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    '---',
    '',
    '# Test initiative',
  ].join('\n');
}

type Stubs = {
  mergeReturn: boolean;
  mergeCallCount: number;
  mergeLastArg: string;
  finalizeCallCount: number;
  /** WS-A: ordered call log so we can assert release-finalize runs BEFORE merge. */
  callOrder: string[];
};

function makeStubs(): {
  stubs: Stubs;
  mergePr: (wt: string) => boolean;
  finalizeAfterMerge: () => Promise<unknown[]>;
} {
  const stubs: Stubs = {
    mergeReturn: true,
    mergeCallCount: 0,
    mergeLastArg: '',
    finalizeCallCount: 0,
    callOrder: [],
  };
  return {
    stubs,
    mergePr(wt: string): boolean {
      stubs.mergeCallCount++;
      stubs.mergeLastArg = wt;
      stubs.callOrder.push('merge');
      return stubs.mergeReturn;
    },
    finalizeAfterMerge(): Promise<unknown[]> {
      stubs.finalizeCallCount++;
      return Promise.resolve([]);
    },
  };
}

async function postVerdict(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('approve: 200, calls mergePr once with worktreePath, fires finalizeAfterMerge once', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  // H2: worktree must be inside projectsRoot (<forgeRoot>/projects/) or the
  // bounds check rejects it.  Use a subdir inside projects/ so the guard passes.
  const worktreePath = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'test-approve');
  mkdirSync(worktreePath, { recursive: true });
  const initiativeId = 'INIT-2026-01-01-test-approve';
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), makeManifest(worktreePath, initiativeId));

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'approve',
      rationale: 'looks good',
    });

    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
    const body = json as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.kind, 'approve');
    assert.ok(
      typeof body.note === 'string' && body.note.includes('merged'),
      `note should mention merged, got: ${body.note}`,
    );
    assert.equal(s.stubs.mergeCallCount, 1, 'mergePr should be called once');
    assert.equal(s.stubs.mergeLastArg, worktreePath, 'mergePr called with correct worktreePath');
    assert.equal(s.stubs.finalizeCallCount, 1, 'finalizeAfterMerge should be called once');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('approve with missing worktree: 409 worktree-gone, mergePr not called', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  const initiativeId = 'INIT-2026-01-01-test-missing-wt';
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(
    join(rfr, `${initiativeId}.md`),
    makeManifest('/nonexistent/does/not/exist', initiativeId),
  );

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'approve',
      rationale: 'looks good',
    });

    assert.equal(status, 409, `expected 409, got ${status}`);
    const body = json as Record<string, unknown>;
    assert.ok(
      typeof body.error === 'string' && body.error.includes('worktree gone'),
      `expected worktree-gone error, got: ${body.error}`,
    );
    assert.equal(s.stubs.mergeCallCount, 0, 'mergePr must NOT be called when worktree is missing');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('approve when mergePr returns false: 409 gh-pr-merge-failed, finalize not called', async () => {
  const s = makeStubs();
  s.stubs.mergeReturn = false;

  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  // H2: worktree must be inside projectsRoot (<forgeRoot>/projects/).
  const worktreePath = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'test-merge-fail');
  mkdirSync(worktreePath, { recursive: true });
  const initiativeId = 'INIT-2026-01-01-test-merge-fail';
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), makeManifest(worktreePath, initiativeId));

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'approve',
      rationale: 'looks good',
    });

    assert.equal(status, 409, `expected 409, got ${status}`);
    const body = json as Record<string, unknown>;
    assert.ok(
      typeof body.error === 'string' && body.error.includes('gh pr merge failed'),
      `expected gh-pr-merge-failed error, got: ${body.error}`,
    );
    assert.equal(
      s.stubs.finalizeCallCount,
      0,
      'finalizeAfterMerge must NOT fire when merge fails',
    );
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('approve with no manifest: 409 no-manifest error', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId: 'INIT-2026-01-01-no-such-initiative',
      kind: 'approve',
      rationale: 'looks good',
    });

    assert.equal(status, 409, `expected 409, got ${status}`);
    const body = json as Record<string, unknown>;
    assert.ok(
      typeof body.error === 'string' && body.error.includes('no manifest'),
      `expected no-manifest error, got: ${body.error}`,
    );
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WS-A — release-finalize hook (runs immediately BEFORE mergePr on approve)
// ---------------------------------------------------------------------------

/** Shared scaffold: a ready-for-review manifest whose worktree is inside the
 *  allowed projectsRoot, so the approve path reaches the merge. */
function seedApprovableCycle(forgeRoot: string, initiativeId: string): { worktreePath: string } {
  const worktreePath = join(forgeRoot, 'projects', 'test-project', 'worktrees', initiativeId);
  mkdirSync(worktreePath, { recursive: true });
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), makeManifest(worktreePath, initiativeId));
  return { worktreePath };
}

test('approve with releaseProcess hook present: finalise runs BEFORE merge, both fire', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  const initiativeId = 'INIT-2026-01-01-release-present';
  const { worktreePath } = seedApprovableCycle(forgeRoot, initiativeId);

  let finalizeCallCount = 0;
  let finalizeWorktree = '';
  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
    runReleaseFinalize: async (input) => {
      finalizeCallCount++;
      finalizeWorktree = input.worktreePath;
      s.stubs.callOrder.push('finalize');
      return { release_status: 'finalized' };
    },
  });
  try {
    const { status } = await postVerdict(url, { initiativeId, kind: 'approve', rationale: 'ship it' });
    assert.equal(status, 200);
    assert.equal(finalizeCallCount, 1, 'runReleaseFinalize called once');
    assert.equal(finalizeWorktree, worktreePath, 'finalise given the approve worktree');
    assert.equal(s.stubs.mergeCallCount, 1, 'merge still fires');
    assert.deepEqual(s.stubs.callOrder, ['finalize', 'merge'], 'finalise must precede merge');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('approve with hook absent: straight-to-merge (no finalise injected)', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  const initiativeId = 'INIT-2026-01-01-release-absent';
  seedApprovableCycle(forgeRoot, initiativeId);

  // No runReleaseFinalize injected — the default skips cleanly (the test
  // manifest's project_repo_path declares no releaseProcess) and merge fires.
  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
  });
  try {
    const { status } = await postVerdict(url, { initiativeId, kind: 'approve', rationale: 'ship it' });
    assert.equal(status, 200);
    assert.equal(s.stubs.mergeCallCount, 1, 'merge fires even with no release process');
    assert.deepEqual(s.stubs.callOrder, ['merge']);
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('approve when release finalisation fails: merge STILL fires (log-and-continue)', async () => {
  const s = makeStubs();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-'));
  const initiativeId = 'INIT-2026-01-01-release-fail';
  seedApprovableCycle(forgeRoot, initiativeId);

  let finalizeCallCount = 0;
  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: s.mergePr,
    finalizeAfterMerge: s.finalizeAfterMerge,
    // A hook-level throw must NOT block the merge (defence in depth around the
    // phase's own log-and-continue).
    runReleaseFinalize: async () => {
      finalizeCallCount++;
      throw new Error('finaliser exploded');
    },
  });
  try {
    const { status } = await postVerdict(url, { initiativeId, kind: 'approve', rationale: 'ship it' });
    assert.equal(status, 200, 'approve still succeeds despite a finalise throw');
    assert.equal(finalizeCallCount, 1, 'finalise was attempted');
    assert.equal(s.stubs.mergeCallCount, 1, 'merge STILL fires (the DRAFT changelog is the fallback)');
    assert.equal(s.stubs.finalizeCallCount, 1, 'post-merge finalize still fires');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
