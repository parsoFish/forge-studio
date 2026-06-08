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
  };
  return {
    stubs,
    mergePr(wt: string): boolean {
      stubs.mergeCallCount++;
      stubs.mergeLastArg = wt;
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
    headers: { 'content-type': 'application/json' },
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
  const worktreePath = mkdtempSync(join(tmpdir(), 'wt-'));
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
    rmSync(worktreePath, { recursive: true, force: true });
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
  const worktreePath = mkdtempSync(join(tmpdir(), 'wt-fail-'));
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
    rmSync(worktreePath, { recursive: true, force: true });
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
