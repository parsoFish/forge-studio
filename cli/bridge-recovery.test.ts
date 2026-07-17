/**
 * Tests for cli/bridge-recovery.ts — the DEC-6 operator recovery routes that
 * replace `forge review --inspect/--abandon`, `forge requeue`, `forge enqueue`.
 *
 * The recovery LOGIC (recoveryInspect / recoveryAbandon) is exercised directly on a
 * tmp queue; the route handler's id-validation + routing guards are exercised with a
 * minimal mock req/res. The git side effects of abandon are tested against a real
 * throwaway repo so the worktree/branch cleanup is genuinely run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recoveryInspect, recoveryAbandon, handleRecoveryRoutes } from './bridge-recovery.ts';

const ID = 'INIT-2026-06-21-recovery-spec';

function manifestText(initiativeId: string, extra: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    initiative_id: initiativeId,
    project: 'gitpulse',
    project_repo_path: '/tmp/gitpulse',
    created_at: "'2026-06-21T00:00:00Z'",
    iteration_budget: '4',
    cost_budget_usd: '6',
    phase: 'ready-for-review',
    origin: 'architect',
    flow_id: 'forge-develop',
    ...extra, // extra overrides base (no duplicate YAML keys)
  };
  return ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '', '# Spec', '', 'Body.'].join('\n');
}

function seed(queueRoot: string, state: string, initiativeId: string, extra: Record<string, string> = {}): void {
  const dir = join(queueRoot, state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${initiativeId}.md`), manifestText(initiativeId, extra));
}

function withTmp(fn: (root: string, queueRoot: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-recovery-'));
  try { fn(root, join(root, '_queue')); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

/** Minimal mock req/res. */
function mockReq(method: string, url: string, body?: unknown) {
  const req = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as import('node:http').IncomingMessage;
  (req as { method?: string }).method = method;
  (req as { url?: string }).url = url;
  (req as { headers?: Record<string, string> }).headers = {};
  return req;
}
function mockRes() {
  const captured: { status: number; body: unknown } = { status: 0, body: null };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    setHeader() { return res; },
    end(payload?: string) { try { captured.body = payload ? JSON.parse(payload) : null; } catch { captured.body = payload; } },
  } as unknown as import('node:http').ServerResponse;
  return { res, captured };
}

test('recoveryInspect: a manifest with a preserved worktree reports its branch + commits', () => {
  withTmp((root, queueRoot) => {
    // Real throwaway repo + worktree so the git reads run.
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
    writeFileSync(join(repo, 'README.md'), '# r\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    const wt = join(root, 'wt');
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', `forge/${ID}`, wt]);
    writeFileSync(join(wt, 'feature.txt'), 'work\n');
    execFileSync('git', ['-C', wt, 'add', '-A']);
    execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'feat: the work']);

    seed(queueRoot, 'ready-for-review', ID, { worktree_path: wt, project_repo_path: repo });
    const got = recoveryInspect(ID, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') });
    assert.equal(got.found, true);
    assert.equal(got.state, 'ready-for-review');
    assert.equal(got.branch, `forge/${ID}`);
    assert.equal(got.worktreeExists, true);
    assert.ok((got.commits ?? []).some((c) => c.includes('the work')), 'commits include the worktree commit');
  });
});

test('recoveryInspect: an unknown initiative returns found:false', () => {
  withTmp((root, queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    assert.deepEqual(recoveryInspect('INIT-2026-06-21-nope', { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') }), {
      found: false, initiativeId: 'INIT-2026-06-21-nope',
    });
  });
});

test('recoveryAbandon: moves the manifest to failed/', () => {
  withTmp((root, queueRoot) => {
    seed(queueRoot, 'ready-for-review', ID);
    const got = recoveryAbandon(ID, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') });
    assert.equal(got.ok, true);
    assert.ok(existsSync(join(queueRoot, 'failed', `${ID}.md`)), 'manifest now in failed/');
    assert.ok(!existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), 'removed from ready-for-review/');
  });
});

test('handleRecoveryRoutes: GET /api/recovery/<traversal> → 400 (id guard, no path escape)', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const { res, captured } = mockRes();
    const handled = await handleRecoveryRoutes(mockReq('GET', '/api/recovery/..%2f..%2fetc'), res, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') }, '/api/recovery/..%2f..%2fetc', 'GET');
    assert.equal(handled, true);
    assert.equal(captured.status, 400);
  });
});

test('handleRecoveryRoutes: POST /api/initiatives with an invalid manifest → 400', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const { res, captured } = mockRes();
    const handled = await handleRecoveryRoutes(mockReq('POST', '/api/initiatives', { manifest: 'not a manifest' }), res, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') }, '/api/initiatives', 'POST');
    assert.equal(handled, true);
    assert.equal(captured.status, 400);
  });
});

test('handleRecoveryRoutes: POST /api/initiatives with a valid manifest → 201 + writes pending', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const { res, captured } = mockRes();
    const handled = await handleRecoveryRoutes(mockReq('POST', '/api/initiatives', { manifest: manifestText(ID) }), res, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') }, '/api/initiatives', 'POST');
    assert.equal(handled, true);
    assert.equal(captured.status, 201);
    assert.ok(existsSync(join(queueRoot, 'pending', `${ID}.md`)), 'manifest written to pending/');
  });
});

test('handleRecoveryRoutes: an unrelated url returns false (not handled)', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const { res } = mockRes();
    const handled = await handleRecoveryRoutes(mockReq('GET', '/api/cycles'), res, { forgeRoot: root, queueRoot, logsRoot: join(root, '_logs') }, '/api/cycles', 'GET');
    assert.equal(handled, false);
  });
});

test('R5-01-F1: FORGE_DRY_BRIDGE=1 refuses recovery abandon/requeue with the typed 409', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const prior = process.env.FORGE_DRY_BRIDGE;
    process.env.FORGE_DRY_BRIDGE = '1';
    try {
      const logsRoot = join(root, '_logs');
      const abandonRes = mockRes();
      const abandonHandled = await handleRecoveryRoutes(
        mockReq('POST', `/api/recovery/${ID}/abandon`), abandonRes.res,
        { forgeRoot: root, queueRoot, logsRoot }, `/api/recovery/${ID}/abandon`, 'POST',
      );
      assert.equal(abandonHandled, true);
      assert.equal(abandonRes.captured.status, 409);
      assert.deepEqual(abandonRes.captured.body, {
        error: 'dry-bridge', route: '/api/recovery/:id/abandon', method: 'POST', action: 'git-remote',
      });

      const requeueRes = mockRes();
      const requeueHandled = await handleRecoveryRoutes(
        mockReq('POST', `/api/recovery/${ID}/requeue`), requeueRes.res,
        { forgeRoot: root, queueRoot, logsRoot }, `/api/recovery/${ID}/requeue`, 'POST',
      );
      assert.equal(requeueHandled, true);
      assert.equal(requeueRes.captured.status, 409);
      assert.deepEqual(requeueRes.captured.body, {
        error: 'dry-bridge', route: '/api/recovery/:id/requeue', method: 'POST', action: 'git-remote',
      });
    } finally {
      if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = prior;
    }
  });
});

async function withTmpAsync(fn: (root: string, queueRoot: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-recovery-'));
  try { await fn(root, join(root, '_queue')); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
