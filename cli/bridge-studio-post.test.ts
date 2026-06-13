/**
 * Tests for the new POST write endpoints in bridge-studio.ts (M3-4):
 *   POST /api/runs                         — start a planned run
 *   POST /api/runs/:id/resume              — resume a failed run
 *   POST /api/runs/:id/gates/verdict       — review gate (approve / send-back)
 *   POST /api/runs/:id/gates/plan          — plan gate (approve / revise / reject)
 *   POST /api/runs/:id/gates/<unknown>     — 404
 *
 * Also verifies:
 *   - CSRF guard (403 when header absent)
 *   - Alias equivalence: POST /api/verdict still works (old shape)
 *
 * Bridge started via startBridge() — no real `gh` process; mergePr / finalizeAfterMerge injected.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// Disable architect spawn so plan-verdict tests don't try to exec a runner.
process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

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
    'origin: architect',
    '---',
    '',
    '# Test initiative',
  ].join('\n');
}

type Stubs = {
  mergeReturn: boolean;
  mergeCallCount: number;
  finalizeCallCount: number;
};

function makeStubs(): {
  stubs: Stubs;
  mergePr: (wt: string) => boolean;
  finalizeAfterMerge: () => Promise<unknown[]>;
} {
  const stubs: Stubs = { mergeReturn: true, mergeCallCount: 0, finalizeCallCount: 0 };
  return {
    stubs,
    mergePr(wt: string): boolean { void wt; stubs.mergeCallCount++; return stubs.mergeReturn; },
    finalizeAfterMerge(): Promise<unknown[]> { stubs.finalizeCallCount++; return Promise.resolve([]); },
  };
}

async function post(
  base: string,
  path: string,
  body?: Record<string, unknown>,
  nocsrf = false,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!nocsrf) headers['x-forge-csrf'] = '1';
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

// ---------------------------------------------------------------------------
// Shared bridge instance
// ---------------------------------------------------------------------------

let forgeRoot: string;
let worktreeDir: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;
let stubs: Stubs;
let mergePr: (wt: string) => boolean;
let finalizeAfterMerge: () => Promise<unknown[]>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bsp-'));
  worktreeDir = mkdtempSync(join(tmpdir(), 'wt-'));

  // Create all queue dirs
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }

  const s = makeStubs();
  stubs = s.stubs;
  mergePr = s.mergePr;
  finalizeAfterMerge = s.finalizeAfterMerge;

  ({ url: bridgeUrl, close: closeServer } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr,
    finalizeAfterMerge,
  }));
});

after(async () => {
  await closeServer();
  rmSync(forgeRoot, { recursive: true, force: true });
  rmSync(worktreeDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CSRF guard
// ---------------------------------------------------------------------------

test('POST /api/runs without CSRF header → 403', async () => {
  const { status } = await post(bridgeUrl, '/api/runs', { initiativeId: 'INIT-2026-01-01-foo' }, true);
  assert.equal(status, 403);
});

test('POST /api/runs/:id/gates/verdict without CSRF header → 403', async () => {
  const { status } = await post(bridgeUrl, '/api/runs/INIT-2026-01-01-foo/gates/verdict', {}, true);
  assert.equal(status, 403);
});

// ---------------------------------------------------------------------------
// POST /api/runs — start a run
// ---------------------------------------------------------------------------

test('POST /api/runs with invalid initiativeId → 400', async () => {
  const { status, json } = await post(bridgeUrl, '/api/runs', { initiativeId: 'not-valid' });
  assert.equal(status, 400);
  assert.ok((json as Record<string, unknown>).error);
});

test('POST /api/runs with unknown initiativeId → 404', async () => {
  const { status } = await post(bridgeUrl, '/api/runs', { initiativeId: 'INIT-2026-01-01-no-such' });
  assert.equal(status, 404);
});

test('POST /api/runs with initiativeId already in pending → 200 already-pending', async () => {
  const id = 'INIT-2026-01-01-already-pending';
  writeFileSync(join(forgeRoot, '_queue', 'pending', `${id}.md`), makeManifest('/nonexistent', id));

  const { status, json } = await post(bridgeUrl, '/api/runs', { initiativeId: id });
  assert.equal(status, 200);
  const b = json as Record<string, unknown>;
  assert.equal(b.ok, true);
  assert.ok(typeof b.note === 'string' && b.note.includes('pending'));
});

test('POST /api/runs with initiativeId in failed → moves to pending, 200', async () => {
  const id = 'INIT-2026-01-01-from-failed';
  const failedPath = join(forgeRoot, '_queue', 'failed', `${id}.md`);
  writeFileSync(failedPath, makeManifest('/nonexistent', id));

  const { status, json } = await post(bridgeUrl, '/api/runs', { initiativeId: id, origin: 'human-directed' });
  assert.equal(status, 200);
  const b = json as Record<string, unknown>;
  assert.equal(b.ok, true);
  assert.equal(b.runId, id);

  // Manifest must now be in pending, not in failed
  assert.ok(existsSync(join(forgeRoot, '_queue', 'pending', `${id}.md`)));
  assert.ok(!existsSync(failedPath));
});

test('POST /api/runs with initiativeId in-flight → 409', async () => {
  const id = 'INIT-2026-01-01-in-flight';
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', `${id}.md`), makeManifest('/nonexistent', id));

  const { status } = await post(bridgeUrl, '/api/runs', { initiativeId: id });
  assert.equal(status, 409);
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/resume
// ---------------------------------------------------------------------------

test('POST /api/runs/:id/resume with manifest in failed → 200', async () => {
  const id = 'INIT-2026-01-01-resume-ok';
  writeFileSync(join(forgeRoot, '_queue', 'failed', `${id}.md`), makeManifest('/nonexistent', id));

  const { status, json } = await post(bridgeUrl, `/api/runs/${id}/resume`);
  assert.equal(status, 200);
  const b = json as Record<string, unknown>;
  assert.equal(b.ok, true);
  assert.equal(b.runId, id);
  // runRequeue moves the manifest to pending
  assert.ok(existsSync(join(forgeRoot, '_queue', 'pending', `${id}.md`)));
});

test('POST /api/runs/:id/resume with path-traversal id → 4xx (no 200)', async () => {
  const res = await fetch(`${bridgeUrl}/api/runs/../../etc%2Fpasswd/resume`, {
    method: 'POST',
    headers: { 'x-forge-csrf': '1', 'content-type': 'application/json' },
  });
  // URL won't match the resume route regex → 404 (empty body) or 400 from safe-id check.
  assert.ok(res.status >= 400, `expected 4xx, got ${res.status}`);
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/gates/verdict
// ---------------------------------------------------------------------------

test('POST /api/runs/:id/gates/verdict approve → calls mergePr, 200', async () => {
  const id = 'INIT-2026-01-01-gate-approve';
  // H2: worktree must be inside projectsRoot (<forgeRoot>/projects/) or the
  // bounds check rejects it.
  const wt = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'gate-approve');
  mkdirSync(wt, { recursive: true });
  try {
    writeFileSync(join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`), makeManifest(wt, id));
    stubs.mergeCallCount = 0;

    const { status, json } = await post(bridgeUrl, `/api/runs/${id}/gates/verdict`, {
      verdict: 'approve',
      rationale: 'looks good',
    });

    assert.equal(status, 200);
    const b = json as Record<string, unknown>;
    assert.equal(b.ok, true);
    assert.equal(stubs.mergeCallCount, 1);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('POST /api/runs/:id/gates/verdict send-back → dispatches to verdict handler, non-403', async () => {
  const id = 'INIT-2026-01-01-gate-sendback';
  const wt = mkdtempSync(join(tmpdir(), 'gwtb-'));
  try {
    writeFileSync(join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`), makeManifest(wt, id));

    const { status } = await post(bridgeUrl, `/api/runs/${id}/gates/verdict`, {
      verdict: 'send-back',
      rationale: 'needs more work',
      acceptanceCriteria: [{ given: 'a user', when: 'clicking submit', then: 'data is saved' }],
    });

    // CSRF check passes (not 403). The exact outcome (200/409/500) depends on
    // the worktree state — what matters is the gate endpoint was reached.
    assert.notEqual(status, 403, 'CSRF must pass');
    assert.notEqual(status, 404, 'gate route must be found');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('POST /api/runs/:id/gates/verdict with bad id → 4xx (no 200)', async () => {
  // A path with `..` won't match the gate regex (only [A-Za-z0-9_-] allowed in
  // capture groups), so falls through to 404 with an empty body.
  const res = await fetch(`${bridgeUrl}/api/runs/../escape/gates/verdict`, {
    method: 'POST',
    headers: { 'x-forge-csrf': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ verdict: 'approve', rationale: 'x' }),
  });
  assert.ok(res.status >= 400, `expected 4xx, got ${res.status}`);
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/gates/<unknown>
// ---------------------------------------------------------------------------

test('POST /api/runs/:id/gates/unknown-gate → 404', async () => {
  const { status, json } = await post(bridgeUrl, '/api/runs/INIT-2026-01-01-foo/gates/no-such-gate', {
    verdict: 'approve',
  });
  assert.equal(status, 404);
  assert.ok((json as Record<string, unknown>).error);
});

// ---------------------------------------------------------------------------
// Alias equivalence: POST /api/verdict (old shape) still works
// ---------------------------------------------------------------------------

test('POST /api/verdict approve alias → 200 (old shape unchanged)', async () => {
  const id = 'INIT-2026-01-01-alias-approve';
  // H2: worktree must be inside projectsRoot (<forgeRoot>/projects/).
  const wt = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'alias-approve');
  mkdirSync(wt, { recursive: true });
  try {
    writeFileSync(join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`), makeManifest(wt, id));
    stubs.mergeCallCount = 0;

    const { status, json } = await post(bridgeUrl, '/api/verdict', {
      initiativeId: id,
      kind: 'approve',
      rationale: 'alias test',
    });
    assert.equal(status, 200);
    assert.equal((json as Record<string, unknown>).ok, true);
    assert.equal(stubs.mergeCallCount, 1);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Security: C1 — initiativeId path traversal blocked (applyReviewVerdict + alias)
// ---------------------------------------------------------------------------

test('C1: POST /api/verdict with path-traversal initiativeId → 400, no fs write', async () => {
  // Ensure the traversal id does NOT land a file anywhere.
  const { status, json } = await post(bridgeUrl, '/api/verdict', {
    initiativeId: '../../etc/passwd',
    kind: 'approve',
    rationale: 'should be blocked',
  });
  assert.equal(status, 400, `expected 400 from C1 guard, got ${status}`);
  const b = json as Record<string, unknown>;
  assert.ok(typeof b.error === 'string' && b.error.length > 0, 'error message present');
  // Confirm no file was created outside queue (traversal would land in _queue/../..)
  assert.ok(
    !existsSync(join(forgeRoot, '..', 'etc', 'passwd')),
    'no traversal file created',
  );
});

test('C1: POST /api/runs/:id/gates/verdict with path-traversal initiativeId → 400', async () => {
  // The gate route captures [A-Za-z0-9_-]+ so `..` doesn't even reach applyReviewVerdict —
  // but a slug-shaped traversal like `INIT-2026-01-01-x` followed by a forged id
  // must be caught by INIT_ID_RE.  Use a plain invalid id to verify the 400.
  const { status, json } = await post(bridgeUrl, '/api/runs/not-an-init-id/gates/verdict', {
    verdict: 'approve',
    rationale: 'should be blocked',
  });
  assert.equal(status, 400, `expected 400 from C1 guard via gate route, got ${status}`);
  const b = json as Record<string, unknown>;
  assert.ok(typeof b.error === 'string', 'error message present');
});

// ---------------------------------------------------------------------------
// Security: C2 — project + sessionId path traversal blocked (applyPlanVerdict)
// ---------------------------------------------------------------------------

test('C2: POST /api/plan-verdict with path-traversal project → 400', async () => {
  const { status, json } = await post(bridgeUrl, '/api/plan-verdict', {
    project: '../escape',
    sessionId: '2026-01-01T00-00-00',
    kind: 'approve',
  });
  assert.equal(status, 400, `expected 400 from C2 project guard, got ${status}`);
  const b = json as Record<string, unknown>;
  assert.ok(typeof b.error === 'string' && b.error.length > 0);
});

test('C2: POST /api/plan-verdict with path-traversal sessionId → 400', async () => {
  const { status, json } = await post(bridgeUrl, '/api/plan-verdict', {
    project: 'my-project',
    sessionId: '../../../etc/shadow',
    kind: 'approve',
  });
  assert.equal(status, 400, `expected 400 from C2 sessionId guard, got ${status}`);
  const b = json as Record<string, unknown>;
  assert.ok(typeof b.error === 'string' && b.error.length > 0);
});

test('C2: POST /api/plan-verdict with valid slug project + real sessionId format → passes guard (404 session not found)', async () => {
  // Verifies that the C2 guard does NOT block legitimate traffic.
  // A real sessionId like '2026-06-13T14-30-00' must pass SAFE_ID_RE.
  const { status } = await post(bridgeUrl, '/api/plan-verdict', {
    project: 'my-project',
    sessionId: '2026-06-13T14-30-00',
    kind: 'approve',
  });
  // Guard passes → 404 (session dir does not exist) rather than 400.
  assert.equal(status, 404, `expected 404 (session not found), got ${status} — guard may have blocked a valid id`);
});

// ---------------------------------------------------------------------------
// POST /api/studio/kbs/:id/guidance (M5-3)
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs/:id/guidance — writes _guidance file → 200 {ok, file}', async () => {
  // Set up a minimal brain with a kb.yaml so loadKbDescriptors can find it
  const brainDir = join(forgeRoot, 'brain', 'test-kb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: test-kb\nname: Test KB\nscope: flow\ndesc: Test.\n');

  const { status, json } = await post(bridgeUrl, '/api/studio/kbs/test-kb/guidance', {
    text: 'The worktree traps theme should be split.',
  });

  assert.equal(status, 200);
  const b = json as Record<string, unknown>;
  assert.equal(b.ok, true);
  assert.ok(typeof b.file === 'string', 'response should include file path');
  assert.ok((b.file as string).includes('_guidance'), 'file path should reference _guidance');

  // Verify the file was actually written
  const guidanceDir = join(brainDir, '_guidance');
  assert.ok(existsSync(guidanceDir), '_guidance dir should be created');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(guidanceDir);
  assert.equal(files.length, 1, 'should have written 1 guidance file');
});

test('POST /api/studio/kbs/:id/guidance with targetNode — written to frontmatter', async () => {
  const brainDir = join(forgeRoot, 'brain', 'test-kb');
  if (!existsSync(brainDir)) {
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: test-kb\nname: Test KB\nscope: flow\ndesc: Test.\n');
  }

  const { status, json } = await post(bridgeUrl, '/api/studio/kbs/test-kb/guidance', {
    text: 'Add cwd resolution section.',
    targetNode: 'theme-alpha',
  });
  assert.equal(status, 200);
  assert.equal((json as Record<string, unknown>).ok, true);

  // Verify the target_node is in the written file
  const guidanceDir = join(brainDir, '_guidance');
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = readdirSync(guidanceDir).filter((f: string) => f.endsWith('.md'));
  const contents = files.map((f: string) => readFileSync(join(guidanceDir, f), 'utf8'));
  const targetted = contents.find((c: string) => c.includes('target_node'));
  assert.ok(targetted, 'at least one file should have target_node in frontmatter');
  assert.ok(targetted?.includes('theme-alpha'), 'target_node value should be theme-alpha');
});

test('POST /api/studio/kbs/:id/guidance with empty text → 400', async () => {
  const { status, json } = await post(bridgeUrl, '/api/studio/kbs/test-kb/guidance', {
    text: '   ',
  });
  assert.equal(status, 400);
  assert.ok((json as Record<string, unknown>).error);
});

test('POST /api/studio/kbs/:id/guidance with unknown kb → 404', async () => {
  const { status, json } = await post(bridgeUrl, '/api/studio/kbs/no-such-kb-xyz/guidance', {
    text: 'Some guidance text.',
  });
  assert.equal(status, 404);
  assert.ok((json as Record<string, unknown>).error);
});

test('POST /api/studio/kbs/:id/guidance with invalid id (traversal) → 400', async () => {
  const { status } = await post(bridgeUrl, '/api/studio/kbs/..%2Fetc/guidance', {
    text: 'Traversal attempt.',
  });
  // The route won't match (%2F decodes to / which doesn't fit the capture group),
  // or the slug guard returns 400
  assert.ok(status >= 400, `expected 4xx, got ${status}`);
});

test('POST /api/studio/kbs/:id/guidance with invalid targetNode → 400', async () => {
  const { status, json } = await post(bridgeUrl, '/api/studio/kbs/test-kb/guidance', {
    text: 'Valid guidance text.',
    targetNode: '../escape/path',
  });
  assert.equal(status, 400);
  assert.ok((json as Record<string, unknown>).error);
});

test('POST /api/studio/kbs/:id/guidance without CSRF header → 403', async () => {
  const { status } = await post(
    bridgeUrl,
    '/api/studio/kbs/test-kb/guidance',
    { text: 'Some guidance.' },
    true, // nocsrf
  );
  assert.equal(status, 403);
});

// ---------------------------------------------------------------------------
// Security: H2 — worktree_path outside projectsRoot → 409
// ---------------------------------------------------------------------------

test('H2: approve with manifest worktree_path outside projectsRoot → 409', async () => {
  const id = 'INIT-2026-01-01-h2-outside-root';
  // Write a manifest whose worktree_path is in /tmp — outside projectsRoot.
  const outsideWt = mkdtempSync(join(tmpdir(), 'h2-out-'));
  try {
    writeFileSync(
      join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`),
      makeManifest(outsideWt, id),
    );

    const { status, json } = await post(bridgeUrl, '/api/verdict', {
      initiativeId: id,
      kind: 'approve',
      rationale: 'should be blocked by H2',
    });
    assert.equal(status, 409, `expected 409 from H2 guard, got ${status}: ${JSON.stringify(json)}`);
    const b = json as Record<string, unknown>;
    assert.ok(
      typeof b.error === 'string' && b.error.includes('outside allowed root'),
      `expected outside-allowed-root error, got: ${b.error}`,
    );
  } finally {
    rmSync(outsideWt, { recursive: true, force: true });
  }
});
