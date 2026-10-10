/**
 * forge-nk1y.20 — every production reader of a manifest `worktree_path` that
 * reaches the filesystem or git goes through the ONE containment predicate.
 * Each test plants an UNCONTAINED `worktree_path` pointing at a REAL directory
 * and asserts the sink was not reached: the directory (and the git branch) is
 * still there, or the probe was never called.
 *
 * (The band-agent standalone reader is held in
 * `packages/agents/tests/integration/band-agent-run.test.ts`; the bridge and
 * finalize readers by their own containment regressions.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import { getPaths, recover } from '../../queue.ts';
import { cleanupRecoveredWorktrees } from '../../scheduler-sweeps.ts';
import { DEVELOP_FLOW_ID, enqueueFlowRun } from '../../enqueue-flow-run.ts';
import { recoveryInspect } from '../../bridge-recovery.ts';

const ID = 'INIT-2026-10-10-alpha';

type World = { base: string; forgeRoot: string; queueRoot: string; repo: string; outside: string };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function withWorld(fn: (w: World) => void): void {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-sinks-')));
  try {
    const forgeRoot = join(base, 'forge');
    const repo = join(forgeRoot, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });
    mkdirSync(join(base, 'outside'), { recursive: true });
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'init']);
    fn({ base, forgeRoot, queueRoot: join(forgeRoot, '_queue'), repo, outside: join(base, 'outside') });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function manifest(w: World, worktreePath: string, over: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: ID,
    class: 'code',
    acceptance_criteria: [],
    project: 'demo',
    project_repo_path: w.repo,
    created_at: '2026-10-10T00:00:00Z',
    iteration_budget: 5,
    cost_budget_usd: 5,
    phase: 'pending',
    origin: 'architect',
    worktree_path: worktreePath,
    body: '# x',
    ...over,
  };
}

function seed(w: World, state: string, m: InitiativeManifest): void {
  mkdirSync(join(w.queueRoot, 'pending'), { recursive: true });
  const dir = join(w.queueRoot, state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${m.initiative_id}.md`), serializeManifest(m));
}

/** A REAL linked worktree of `w.repo` on branch forge/<ID> at `at`. */
function linkedWorktree(w: World, at: string): void {
  mkdirSync(join(at, '..'), { recursive: true });
  git(w.repo, ['worktree', 'add', '-q', '-b', `forge/${ID}`, at]);
  writeFileSync(join(at, 'SENTINEL'), 'real target');
}

const branchExists = (w: World): boolean => git(w.repo, ['branch', '--list', `forge/${ID}`]).includes(`forge/${ID}`);

// ---------------------------------------------------------------------------
// scheduler-sweeps: cleanupRecoveredWorktrees  (git worktree remove --force + branch -D)
// ---------------------------------------------------------------------------

for (const [label, where] of [
  ['an in-place worktree under projects/', (w: World) => join(w.forgeRoot, 'projects', 'demo-inplace', ID)],
  ['a worktree entirely outside the forge root', (w: World) => join(w.outside, 'wt')],
] as const) {
  test(`cleanupRecoveredWorktrees: a worktree_path naming ${label} is REFUSED — no worktree remove, no branch -D, a named refusal`, (t) => {
    withWorld((w) => {
      const wt = where(w);
      linkedWorktree(w, wt);
      seed(w, 'pending', manifest(w, wt));
      const errors = t.mock.method(console, 'error', () => {});

      cleanupRecoveredWorktrees([`${ID}.md`], getPaths(w.queueRoot));

      assert.ok(existsSync(join(wt, 'SENTINEL')), 'the uncontained directory is untouched');
      assert.ok(branchExists(w), 'the branch was not deleted');
      const logged = errors.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
      assert.match(logged, /worktree-path\.refused/);
      assert.match(logged, new RegExp(ID));
      assert.match(logged, /not-under-forge-worktrees/);
      assert.ok(!logged.includes(w.base), 'the refusal never echoes a resolved path');

      const events = readFileSync(join(w.forgeRoot, '_logs', ID, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const refused = events.filter((e) => e.message === 'worktree-path.refused');
      assert.equal(refused.length, 1, 'exactly one JSONL refusal event for the initiative');
      assert.equal(refused[0].initiative_id, ID);
      assert.equal(refused[0].metadata.reason, 'not-under-forge-worktrees');
      assert.ok(!JSON.stringify(refused[0]).includes(w.base), 'the event never carries a resolved path');
    });
  });
}

test('cleanupRecoveredWorktrees: control — the initiative\'s own _worktrees/<id> IS cleaned up (worktree removed, branch deleted)', () => {
  withWorld((w) => {
    const wt = join(w.forgeRoot, '_worktrees', ID);
    linkedWorktree(w, wt);
    seed(w, 'pending', manifest(w, wt));

    cleanupRecoveredWorktrees([`${ID}.md`], getPaths(w.queueRoot));

    assert.ok(!existsSync(wt), 'the contained worktree was removed');
    assert.ok(!branchExists(w), 'its branch was deleted');
  });
});

// ---------------------------------------------------------------------------
// queue: recover  (existence probe on the manifest's worktree_path)
// ---------------------------------------------------------------------------

test('recover: an uncontained worktree_path is never probed and the manifest goes to failed/ under its own reason — never back to pending (no second dispatch), never labelled missing-worktree', () => {
  withWorld((w) => {
    const foreign = join(w.forgeRoot, 'projects', 'other');
    mkdirSync(foreign, { recursive: true });
    for (const d of ['failed', 'in-flight']) mkdirSync(join(w.queueRoot, d), { recursive: true });
    seed(w, 'in-flight', manifest(w, foreign));
    writeFileSync(join(w.queueRoot, 'in-flight', `${ID}.md.heartbeat`), ''); // FRESH heartbeat: a live-looking claim
    const probed: string[] = [];

    const out = recover({
      paths: getPaths(w.queueRoot),
      staleHeartbeatMs: 60 * 60 * 1000,
      worktreeExists: (p) => (probed.push(p), true),
    });

    assert.deepEqual(probed, [], 'the foreign path never reached the probe');
    assert.deepEqual(out, [{ recovered: [`${ID}.md`], reason: 'worktree-path-refused' }]);
    assert.ok(existsSync(join(w.queueRoot, 'failed', `${ID}.md`)), 'parked in failed/');
    assert.ok(!existsSync(join(w.queueRoot, 'pending', `${ID}.md`)), 'NOT re-dispatchable from pending/');
    assert.ok(!existsSync(join(w.queueRoot, 'in-flight', `${ID}.md.heartbeat`)), 'the heartbeat left with it');
  });
});

test('recover: control — the initiative\'s own _worktrees/<id> IS probed, and a live one keeps the manifest in-flight', () => {
  withWorld((w) => {
    const own = join(w.forgeRoot, '_worktrees', ID);
    mkdirSync(own, { recursive: true });
    seed(w, 'in-flight', manifest(w, own));
    const probed: string[] = [];

    const out = recover({
      paths: getPaths(w.queueRoot),
      staleHeartbeatMs: 60 * 60 * 1000,
      worktreeExists: (p) => (probed.push(p), true),
    });

    assert.deepEqual(probed, [own]);
    assert.deepEqual(out, []);
    assert.ok(existsSync(join(w.queueRoot, 'in-flight', `${ID}.md`)));
  });
});

// ---------------------------------------------------------------------------
// enqueue-flow-run: the develop `not-planned` gate's decomposition evidence
// ---------------------------------------------------------------------------

test('enqueueFlowRun: work items found only in an UNCONTAINED worktree_path do not count as decomposition evidence (not-planned)', () => {
  withWorld((w) => {
    const foreign = join(w.forgeRoot, 'projects', 'other');
    mkdirSync(join(foreign, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(foreign, '.forge', 'work-items', 'WI-1.md'), '# a real work item elsewhere');
    seed(w, 'pending', manifest(w, foreign, { initiative_id: ID }));

    const result = enqueueFlowRun(ID, DEVELOP_FLOW_ID, { queueRoot: w.queueRoot, forgeRoot: w.forgeRoot });

    assert.equal(result.status, 'not-planned');
  });
});

test('enqueueFlowRun: control — work items in the initiative\'s own _worktrees/<id> are evidence (the gate does not refuse everything)', () => {
  withWorld((w) => {
    const own = join(w.forgeRoot, '_worktrees', ID);
    mkdirSync(join(own, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(own, '.forge', 'work-items', 'WI-1.md'), '# own work item');
    seed(w, 'pending', manifest(w, own, { initiative_id: ID }));

    const result = enqueueFlowRun(ID, DEVELOP_FLOW_ID, { queueRoot: w.queueRoot, forgeRoot: w.forgeRoot });

    assert.notEqual(result.status, 'not-planned');
  });
});

// ---------------------------------------------------------------------------
// bridge-recovery inspect: <worktree>/.forge/pr-description.md is read per segment
// ---------------------------------------------------------------------------

test('recoveryInspect: a symlinked .forge inside the accepted worktree does not leak an outside file\'s length (prDraftChars)', () => {
  withWorld((w) => {
    const wt = join(w.forgeRoot, '_worktrees', ID);
    mkdirSync(wt, { recursive: true });
    const outsideForge = join(w.outside, 'their-forge');
    mkdirSync(outsideForge, { recursive: true });
    writeFileSync(join(outsideForge, 'pr-description.md'), 'x'.repeat(777));
    symlinkSync(outsideForge, join(wt, '.forge'), 'dir');
    seed(w, 'ready-for-review', manifest(w, wt));

    const out = recoveryInspect(ID, {
      forgeRoot: w.forgeRoot, queueRoot: w.queueRoot, logsRoot: join(w.forgeRoot, '_logs'),
      projectsRoot: join(w.forgeRoot, 'projects'), readBody: async () => ({}),
    });

    assert.equal(out.worktreeExists, true, 'the worktree itself is accepted');
    assert.equal(out.prDraftChars, 0, 'the outside file\'s length is not reported');
  });
});

test('recoveryInspect: control — a real .forge/pr-description.md is measured', () => {
  withWorld((w) => {
    const wt = join(w.forgeRoot, '_worktrees', ID);
    mkdirSync(join(wt, '.forge'), { recursive: true });
    writeFileSync(join(wt, '.forge', 'pr-description.md'), 'y'.repeat(41));
    seed(w, 'ready-for-review', manifest(w, wt));

    const out = recoveryInspect(ID, {
      forgeRoot: w.forgeRoot, queueRoot: w.queueRoot, logsRoot: join(w.forgeRoot, '_logs'),
      projectsRoot: join(w.forgeRoot, 'projects'), readBody: async () => ({}),
    });

    assert.equal(out.prDraftChars, 41);
  });
});
