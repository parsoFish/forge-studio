/**
 * Tests for `recoveryStop` / `POST /api/recovery/:id/stop` — the
 * non-destructive `stop-run` control (bead `forge-8vfn.8.1.39`, rulings 1771
 * + 1774). Mirrors `bridge-recovery.test.ts`'s own tmp-queue harness.
 *
 * ACTIVE (in-flight): writes `_queue/in-flight/<id>.stop` — never touches the
 * manifest, the worktree or the branch (unlike abandon).
 * GATED (ready-for-review): moves the manifest straight to `failed/`, keeping
 * the worktree/branch fields untouched (no git op — unlike abandon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recoveryStop, handleRecoveryRoutes, moveGatedManifestToFailed } from '../../bridge-recovery.ts';
import { operatorStopPath } from '../../operator-stop.ts';

const ID = 'INIT-2026-09-27-stop-spec';

function manifestText(initiativeId: string, extra: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    initiative_id: initiativeId,
    project: 'gitpulse',
    project_repo_path: '/tmp/gitpulse',
    created_at: "'2026-09-27T00:00:00Z'",
    iteration_budget: '4',
    cost_budget_usd: '6',
    class: 'code',
    phase: 'in-flight',
    origin: 'architect',
    flow_id: 'forge-develop',
    ...extra,
  };
  return [
    '---',
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    '# Spec',
    '',
    'Body.',
  ].join('\n');
}

function seed(
  queueRoot: string,
  state: string,
  initiativeId: string,
  extra: Record<string, string> = {},
): void {
  const dir = join(queueRoot, state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${initiativeId}.md`), manifestText(initiativeId, extra));
}

function withTmp(fn: (root: string, queueRoot: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-recovery-stop-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  try { fn(root, join(root, '_queue')); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

async function withTmpAsync(fn: (root: string, queueRoot: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-recovery-stop-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  try { await fn(root, join(root, '_queue')); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function ctxFor(root: string, queueRoot: string) {
  return {
    forgeRoot: root,
    queueRoot,
    logsRoot: join(root, '_logs'),
    projectsRoot: join(root, 'projects'),
    readBody: async () => ({}),
  };
}

function mockReq(method: string, url: string) {
  const req = Readable.from([]) as unknown as import('node:http').IncomingMessage;
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
    end(payload?: string) {
      try {
        captured.body = payload ? JSON.parse(payload) : null;
      } catch {
        captured.body = payload;
      }
    },
  } as unknown as import('node:http').ServerResponse;
  return { res, captured };
}

test('recoveryStop: ACTIVE (in-flight) writes the stop flag file — manifest untouched', () => {
  withTmp((root, queueRoot) => {
    seed(queueRoot, 'in-flight', ID, { project_repo_path: join(root, 'projects', 'gitpulse') });
    const got = recoveryStop(ID, ctxFor(root, queueRoot));
    assert.equal(got.ok, true);
    assert.equal(got.mode, 'active');
    assert.ok(
      existsSync(join(queueRoot, 'in-flight', `${ID}.md`)),
      'manifest STAYS in in-flight/ — no live process to move it',
    );
    const flagPath = operatorStopPath(join(queueRoot, 'in-flight'), ID);
    assert.ok(existsSync(flagPath), 'the stop flag file was written');
    const flag = JSON.parse(readFileSync(flagPath, 'utf8'));
    assert.equal(flag.reason, 'operator-stop');
    assert.equal(typeof flag.ts, 'string');
    assert.ok(flag.ts.length > 0);
    assert.equal(flag.actor, 'operator');
  });
});

test(
  'recoveryStop: GATED (ready-for-review) moves the manifest to failed/, no worktree/branch ' +
    'git op',
  () => {
  withTmp((root, queueRoot) => {
    const projectRepoPath = join(root, 'projects', 'gitpulse');
    seed(queueRoot, 'ready-for-review', ID, {
      project_repo_path: projectRepoPath,
      worktree_path: join(root, '_worktrees', ID),
    });
    const got = recoveryStop(ID, ctxFor(root, queueRoot));
    assert.equal(got.ok, true);
    assert.equal(got.mode, 'gated');
    assert.equal(got.movedTo, `failed/${ID}.md`);
    assert.ok(existsSync(join(queueRoot, 'failed', `${ID}.md`)), 'manifest now in failed/');
    assert.ok(!existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), 'removed from ready-for-review/');
    // Unlike abandon: no worktree directory was ever created here, and
    // recoveryStop must not attempt to touch one — this only proves it didn't
    // throw trying to (the worktree_path in the manifest is fictional in this
    // test — real preservation is proven by the ABSENCE of any git call, since
    // no git repo exists at projectRepoPath at all and the call still succeeds).
  });
});

test('recoveryStop: an initiative that is pending/done/merged/failed refuses (not active or gated)', () => {
  withTmp((root, queueRoot) => {
    seed(queueRoot, 'done', ID, { project_repo_path: join(root, 'projects', 'gitpulse') });
    const got = recoveryStop(ID, ctxFor(root, queueRoot));
    assert.equal(got.ok, false);
    assert.match(got.detail ?? '', /done/);
    assert.ok(existsSync(join(queueRoot, 'done', `${ID}.md`)), 'manifest untouched');
  });
});

test('recoveryStop: an unknown initiative reports no manifest found', () => {
  withTmp((root, queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    const got = recoveryStop('INIT-2026-09-27-nope', ctxFor(root, queueRoot));
    assert.equal(got.ok, false);
    assert.equal(got.detail, 'no manifest found');
  });
});

test(
  'moveGatedManifestToFailed: a manifest gone by rename-time (TOCTOU — an approve won the ' +
    'race) reports already-resolved, never throws',
  () => {
    withTmp((root, queueRoot) => {
      // A REAL ENOENT, no mock: this path was never created, reproducing
      // exactly what renameSync sees once a concurrent approve has already
      // moved the manifest out of ready-for-review/ (round 4 finding).
      const gonePath = join(queueRoot, 'ready-for-review', `${ID}.md`);
      const failedDir = join(queueRoot, 'failed');
      const got = moveGatedManifestToFailed(gonePath, ID, failedDir, join(root, '_logs'));
      assert.equal(got.ok, false);
      assert.equal(
        got.detail,
        'the run left ready-for-review before the stop landed (already resolved)',
      );
      assert.equal((got as { mode?: string }).mode, undefined);
      assert.ok(!existsSync(join(failedDir, `${ID}.md`)), 'nothing was moved');
    });
  },
);

test('handleRecoveryRoutes: POST stop on an already-resolved (non-active/gated) run → 409', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    // A REAL "already resolved" state — no mock: stop it once (moves to
    // failed/), then stop it again. The second call's locate() finds it in
    // failed/, which is neither active nor gated — the SAME "not ok, and not
    // 'no manifest found'" shape the TOCTOU race also produces, so this
    // proves the route's 409 mapping without needing to reproduce the race.
    seed(queueRoot, 'ready-for-review', ID, { project_repo_path: join(root, 'projects', 'gitpulse') });
    const first = recoveryStop(ID, ctxFor(root, queueRoot));
    assert.equal(first.ok, true, 'precondition: the first stop succeeds');

    const { res, captured } = mockRes();
    const url = `/api/recovery/${ID}/stop`;
    const handled = await handleRecoveryRoutes(
      mockReq('POST', url),
      res,
      ctxFor(root, queueRoot),
      url,
      'POST',
    );

    assert.equal(handled, true);
    assert.equal(captured.status, 409);
    assert.equal((captured.body as { ok: boolean }).ok, false);
  });
});

test('handleRecoveryRoutes: POST /api/recovery/:id/stop wires the route (active)', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    seed(queueRoot, 'in-flight', ID, { project_repo_path: join(root, 'projects', 'gitpulse') });
    const { res, captured } = mockRes();
    const url = `/api/recovery/${ID}/stop`;
    const handled = await handleRecoveryRoutes(
      mockReq('POST', url),
      res,
      ctxFor(root, queueRoot),
      url,
      'POST',
    );
    assert.equal(handled, true);
    assert.equal(captured.status, 200);
    assert.deepEqual(captured.body, { ok: true, mode: 'active' });
  });
});

test('handleRecoveryRoutes: POST /api/recovery/<traversal>/stop → 400 (id guard)', async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const { res, captured } = mockRes();
    const url = '/api/recovery/..%2f..%2fetc/stop';
    const handled = await handleRecoveryRoutes(
      mockReq('POST', url),
      res,
      ctxFor(root, queueRoot),
      url,
      'POST',
    );
    assert.equal(handled, true);
    assert.equal(captured.status, 400);
  });
});

// dry-bridge classification (point 7c): `stop` never spawns/touches git in
// EITHER mode, so it is classified `exempt-local` and must run identically
// whether or not FORGE_DRY_BRIDGE is set — unlike abandon/requeue, which
// `dry-bridge.test.ts` proves REFUSE under it.
test(
  'recoveryStop runs the SAME under FORGE_DRY_BRIDGE=1 — it is filesystem work, not a ' +
    'refused action',
  async () => {
  await withTmpAsync(async (root, queueRoot) => {
    const prior = process.env.FORGE_DRY_BRIDGE;
    process.env.FORGE_DRY_BRIDGE = '1';
    try {
      seed(queueRoot, 'in-flight', ID, { project_repo_path: join(root, 'projects', 'gitpulse') });
      const { res, captured } = mockRes();
      const url = `/api/recovery/${ID}/stop`;
      const handled = await handleRecoveryRoutes(
        mockReq('POST', url),
        res,
        ctxFor(root, queueRoot),
        url,
        'POST',
      );
      assert.equal(handled, true);
      assert.equal(captured.status, 200, 'never the dry-bridge 409');
      assert.ok(
        existsSync(operatorStopPath(join(queueRoot, 'in-flight'), ID)),
        'the stop flag file was still written under dry-bridge',
      );
    } finally {
      if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = prior;
    }
  });
});
