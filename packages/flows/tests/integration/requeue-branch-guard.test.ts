/**
 * forge-mfv5.1.54 row 2 (D-06: committed work is never discarded) — a FRESH
 * re-run Requeue refuses BY NAME, before any mutation, when the initiative
 * branch carries commits not on origin/main, unless the operator passes
 * `discardBranch: true`. The "origin" is a bare repo in the tmp root, so even a
 * broken guard cannot reach the network or a real ground (M7-COMMON §6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BranchDiscardRefusedError, runRequeue } from '../../forge-requeue.ts';
import { handleRecoveryRoutes } from '../../bridge-recovery.ts';

const ID = 'INIT-2026-10-17-branch-guard';
const CYCLE = `2026-10-17T00-00-00_${ID}`;
const BRANCH = `forge/${ID}`;

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const refExists = (cwd: string, ref: string): boolean => {
  try { git(cwd, ['rev-parse', '--verify', '--quiet', ref]); return true; } catch { return false; }
};

type Fx = { root: string; repo: string; origin: string; wt: string; tip: string };

/** A failed manifest whose prior failure is a genuine terminal one, so the Requeue takes the fresh path. */
function fixture(opts: { remote: boolean; branch: 'ahead' | 'merged' | 'none' }): Fx {
  const root = mkdtempSync(join(tmpdir(), 'forge-branch-guard-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) mkdirSync(join(root, '_queue', d), { recursive: true });
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  const repo = join(root, 'projects', 'p');
  const origin = join(root, 'origin.git');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'base']);
  if (opts.remote) {
    git(root, ['init', '-q', '--bare', origin]);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '-q', 'origin', 'main']);
  }
  const wt = join(root, '_worktrees', ID);
  if (opts.branch !== 'none') {
    git(repo, ['branch', BRANCH]);
    git(repo, ['worktree', 'add', '-q', wt, BRANCH]);
    if (opts.branch === 'ahead') git(wt, ['commit', '-q', '--allow-empty', '-m', 'Merge WI-1: the salvaged work']);
    if (opts.remote) git(repo, ['push', '-q', 'origin', BRANCH]);
  }
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  writeFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), JSON.stringify({ message: 'failure_classification', metadata: { failure_kind: 'terminal', environment: false, cleanBoundaryHalt: false } }) + '\n');
  writeFileSync(join(root, '_queue', 'failed', `${ID}.md`), [
    '---', `initiative_id: ${ID}`, 'project: p', `project_repo_path: ${repo}`, "created_at: '2026-10-17T00:00:00Z'",
    'iteration_budget: 5', 'cost_budget_usd: 1', 'class: code', `worktree_path: ${wt}`, `cycle_id: ${CYCLE}`, '---', 'body', '',
  ].join('\n'));
  return { root, repo, origin, wt, tip: opts.branch === 'none' ? '' : git(repo, ['rev-parse', BRANCH]) };
}

function assertUntouched(f: Fx, remote: boolean): void {
  assert.ok(existsSync(join(f.root, '_queue', 'failed', `${ID}.md`)), 'the manifest is still in failed/');
  assert.equal(existsSync(join(f.root, '_queue', 'pending', `${ID}.md`)), false, 'nothing was requeued');
  assert.equal(git(f.repo, ['rev-parse', BRANCH]), f.tip, 'the local branch is untouched');
  assert.ok(existsSync(f.wt), 'the worktree is untouched');
  if (remote) assert.equal(git(f.origin, ['rev-parse', BRANCH]), f.tip, 'the remote branch is untouched');
}

test('fresh Requeue, branch ahead of origin/main → refused by name before any mutation; nothing moved or deleted', () => {
  const f = fixture({ remote: true, branch: 'ahead' });
  try {
    assert.throws(() => runRequeue(ID, { forgeRoot: f.root }), (e: unknown) => {
      assert.ok(e instanceof BranchDiscardRefusedError);
      assert.equal(e.branch, BRANCH);
      assert.equal(e.unmergedCommits.length, 1);
      assert.match(e.unmergedCommits[0]!, new RegExp(`^${f.tip.slice(0, 7)}\\w* Merge WI-1: the salvaged work$`));
      assert.match(e.message, /1 commit\(s\) not on origin\/main/);
      assert.match(e.message, /discardBranch/);
      return true;
    });
    assertUntouched(f, true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('fresh Requeue with discardBranch:true → proceeds: worktree wiped, branch deleted local + remote', () => {
  const f = fixture({ remote: true, branch: 'ahead' });
  try {
    const r = runRequeue(ID, { forgeRoot: f.root, discardBranch: true });
    assert.equal(r.branchDeleted, true);
    assert.equal(refExists(f.repo, BRANCH), false);
    assert.equal(refExists(f.origin, BRANCH), false);
    assert.ok(existsSync(join(f.root, '_queue', 'pending', `${ID}.md`)));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a branch with nothing beyond origin/main (all merged) needs no flag', () => {
  const f = fixture({ remote: true, branch: 'merged' });
  try {
    assert.equal(runRequeue(ID, { forgeRoot: f.root }).branchDeleted, true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('no branch at all → nothing to discard, proceeds', () => {
  const f = fixture({ remote: true, branch: 'none' });
  try {
    assert.equal(runRequeue(ID, { forgeRoot: f.root }).toQueueDir, 'pending');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('origin/main cannot be read → UNKNOWN fails closed: refused by name, branch kept (§6.15)', () => {
  const f = fixture({ remote: false, branch: 'merged' });
  try {
    assert.throws(() => runRequeue(ID, { forgeRoot: f.root }), (e: unknown) => {
      assert.ok(e instanceof BranchDiscardRefusedError);
      assert.equal(e.unmergedCommits, 'UNKNOWN');
      assert.match(e.message, /cannot compare .* against origin\/main/);
      return true;
    });
    assertUntouched(f, false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

function mockReq(url: string): import('node:http').IncomingMessage {
  const req = Readable.from([]) as unknown as import('node:http').IncomingMessage;
  Object.assign(req, { method: 'POST', url, headers: {} });
  return req;
}
function mockRes(): { res: import('node:http').ServerResponse; captured: { status: number; body: Record<string, unknown> } } {
  const captured = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    setHeader() { return res; },
    end(payload?: string) { captured.body = payload ? JSON.parse(payload) : {}; },
  } as unknown as import('node:http').ServerResponse;
  return { res, captured };
}

async function postRequeue(f: Fx, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `/api/recovery/${ID}/requeue`;
  const { res, captured } = mockRes();
  const ctx = { forgeRoot: f.root, queueRoot: join(f.root, '_queue'), logsRoot: join(f.root, '_logs'), projectsRoot: join(f.root, 'projects'), readBody: async () => body };
  assert.equal(await handleRecoveryRoutes(mockReq(url), res, ctx, url, 'POST'), true);
  return captured;
}

test('door: POST /api/recovery/:id/requeue on a branch ahead → 400 branch-discard-refused naming the commits; branch untouched', async () => {
  const f = fixture({ remote: true, branch: 'ahead' });
  try {
    const r = await postRequeue(f, { resetRetries: true });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'branch-discard-refused');
    assert.equal(r.body.branch, BRANCH);
    assert.equal((r.body.unmergedCommits as string[]).length, 1);
    assert.match(String(r.body.error), /not on origin\/main/);
    assertUntouched(f, true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('door: the same POST with discardBranch:true → 200 and the branch is gone', async () => {
  const f = fixture({ remote: true, branch: 'ahead' });
  try {
    const r = await postRequeue(f, { resetRetries: true, discardBranch: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.branchDeleted, true);
    assert.equal(refExists(f.origin, BRANCH), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
