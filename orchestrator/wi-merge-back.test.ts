/**
 * Phase 4 step 5 — per-WI merge-back fan-in.
 *
 * `mergeWiIntoCycle` is pure git plumbing tested against real tmp repos (the
 * repo pattern `pr.test.ts` / `wi-worktree.test.ts` already use); the loop
 * itself lives in `developer-loop.ts` and is exercised end-to-end by
 * `developer-loop.wi-worktree-fanin.test.ts`. `createMergeQueue` is tested
 * standalone — pure ordering logic, no filesystem involved. `mergeAndPublish`
 * (Phase 4 step 6 review fix) is tested here against real git repos + a real
 * bare "origin" remote — it is the function that actually runs inside the
 * dev-loop's merge queue, so its merge+status+push atomicity is exercised
 * directly rather than only inferred from the generic queue-ordering tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMergeQueue, mergeAndPublish, mergeWiIntoCycle } from './wi-merge-back.ts';
import { writeWorkItem, type WorkItem } from './work-item.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/**
 * A repo with `main` (base commit) checked out as the "cycle" branch, plus a
 * sibling `wi-branch` created from the same tip. Mirrors the shape a real
 * cycle worktree + per-WI worktree share (same object DB, different
 * branches) without needing an actual second worktree — `git merge` only
 * needs the WI branch ref to resolve, not a live worktree checked out on it.
 */
function setup(): { proj: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-merge-back-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);
  sh(proj, ['checkout', '-q', '-b', 'cycle-branch']);
  return { proj, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A bare "origin" remote, tracked from `cycle-branch` — mirrors the shape
 * `pushInitiativeBranch` expects (mergeAndPublish pushes through it). */
function addOrigin(proj: string): { origin: string; cleanup: () => void } {
  const originRoot = mkdtempSync(join(tmpdir(), 'forge-merge-back-origin-'));
  const origin = join(originRoot, 'origin.git');
  sh(originRoot, ['init', '-q', '--bare', origin]);
  sh(proj, ['remote', 'add', 'origin', origin]);
  sh(proj, ['push', '-q', '-u', 'origin', 'cycle-branch']);
  return { origin, cleanup: () => rmSync(originRoot, { recursive: true, force: true }) };
}

/** A minimal valid WI spec file `mergeAndPublish` can update the status of. */
function writeWiSpec(proj: string, id: string): string {
  const w: WorkItem = {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-11-merge-publish-test',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['fixture.txt'],
    quality_gate_cmd: ['true'],
    estimated_iterations: 1,
    body: '',
  };
  return writeWorkItem(w, proj);
}

function remoteHeadOf(proj: string, origin: string, branch: string): string | undefined {
  const line = sh(proj, ['ls-remote', origin, branch]).trim();
  return line.length > 0 ? line.split(/\s+/)[0] : undefined;
}

/**
 * A REAL second `git worktree` checked out on `branch` — mirrors the actual
 * shape a per-WI Ralph loop's own worktree has at merge time (still alive;
 * `developer-loop.ts`'s `runWiDispatchTask` only removes it in a `finally`
 * AFTER the merge/publish turn completes). Needed (unlike `setup()`'s
 * single-worktree shortcut) for the scratch-strip tests below, which must
 * commit ONTO the WI branch while it's checked out somewhere.
 */
function addWiWorktree(proj: string, branch: string): { path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-merge-back-wi-'));
  const path = join(root, 'wi');
  sh(proj, ['worktree', 'add', '-q', path, branch]);
  return {
    path,
    cleanup: () => {
      try {
        sh(proj, ['worktree', 'remove', '--force', path]);
      } catch {
        /* best-effort */
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('mergeWiIntoCycle: merges a clean WI branch into the cycle branch with --no-ff', () => {
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: work']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-1' });

    assert.deepEqual(result, { merged: true });
    assert.equal(readFileSync(join(proj, 'wi-1.txt'), 'utf8'), 'wi work\n');

    // --no-ff: the merge commit has TWO parents even though a fast-forward
    // was possible (cycle-branch had no divergent commits of its own).
    const parents = sh(proj, ['log', '-1', '--pretty=%P']).trim().split(/\s+/);
    assert.equal(parents.length, 2, 'merge commit must have two parents (--no-ff, not a fast-forward)');

    const log = sh(proj, ['log', '-1', '--pretty=%s']).trim();
    assert.equal(log, 'wi(WI-1): merge');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: merge commit carries forge-orchestrator identity, not the local gitconfig', () => {
  // G8 wave 2 (2026-07-12): mergeWiIntoCycle is orchestrator-issued (no agent
  // in the loop) — the merge commit must carry ORCHESTRATOR_GIT_IDENTITY via
  // explicit -c flags. `setup()` configures `t@forge`/`forge-test` locally,
  // deliberately distinct so this proves the override, not a passive match.
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: work']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-1' });
    assert.deepEqual(result, { merged: true });

    const authorName = sh(proj, ['log', '-1', '--pretty=%an']).trim();
    const authorEmail = sh(proj, ['log', '-1', '--pretty=%ae']).trim();
    assert.equal(authorName, 'forge-orchestrator');
    assert.equal(authorEmail, 'forge-orchestrator@forge.local');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a content conflict aborts cleanly — merged:false, working tree clean', () => {
  const { proj, cleanup } = setup();
  try {
    // Diverge: cycle-branch changes README.md...
    writeFileSync(join(proj, 'README.md'), 'cycle change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: change readme']);

    // ...and wi-branch, forked from the ORIGINAL base tip, changes the SAME
    // line differently.
    sh(proj, ['checkout', '-q', '-b', 'wi-branch', 'main']);
    writeFileSync(join(proj, 'README.md'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: change readme']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-2' });

    assert.equal(result.merged, false);
    if (!result.merged) {
      assert.ok(result.detail.length > 0, 'a diagnostic detail is carried');
    }

    // The abort must leave the working tree clean — no MERGE_HEAD, no
    // conflict markers, no staged/unstaged changes left behind.
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'working tree must be clean after merge --abort');
    assert.throws(
      () => sh(proj, ['rev-parse', '--verify', 'MERGE_HEAD']),
      'MERGE_HEAD must not linger after abort',
    );
    // cycle-branch itself must be unmoved (still at its own change, not the WI's).
    assert.equal(readFileSync(join(proj, 'README.md'), 'utf8'), 'cycle change\n');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a nonexistent WI branch fails without leaving a mid-merge state', () => {
  const { proj, cleanup } = setup();
  try {
    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'does-not-exist', workItemId: 'WI-3' });
    assert.equal(result.merged, false);
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'working tree must be clean');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Forge-scratch handling at fan-in (2026-07-12, live cycle 2026-07-11T16-18-59,
// gitpulse): a WI branch that leaked a COMMITTED `.forge/last-gate-failure.md`
// (ralph scratch leak) collided with the cycle worktree's own UNTRACKED copy
// of the same path (unifier-level gate feedback), and git's "untracked
// working tree files would be overwritten by merge" refusal was misclassified
// as a merge conflict — burning the bounded requeue twice before terminal
// failure. Two independent layers close this: (1) strip the WI branch's own
// forge scratch BEFORE merging (root cause), (2) remediate an untracked-
// overwrite refusal in place when every named file is forge scratch (defense).
// ---------------------------------------------------------------------------

test('mergeWiIntoCycle: strips committed .forge/ scratch from the WI branch before merging (layer 1, root cause)', () => {
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    mkdirSync(join(proj, '.forge'), { recursive: true });
    writeFileSync(join(proj, '.forge', 'last-gate-failure.md'), 'wi-side gate feedback\n');
    writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: work (incl scratch leak)']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const { path: wiWorktreePath, cleanup: cleanupWi } = addWiWorktree(proj, 'wi-branch');
    try {
      const result = mergeWiIntoCycle({
        cycleWorktreePath: proj,
        wiBranch: 'wi-branch',
        workItemId: 'WI-2',
        wiWorktreePath,
      });

      assert.equal(result.merged, true);
      assert.deepEqual(result.merged && result.scratchStripped, ['.forge/last-gate-failure.md']);
      assert.equal(
        sh(proj, ['ls-files', '--', '.forge/last-gate-failure.md']).trim(),
        '',
        'scratch must never land on the cycle branch',
      );
      assert.equal(readFileSync(join(proj, 'wi-1.txt'), 'utf8'), 'wi work\n');
    } finally {
      cleanupWi();
    }
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a WI branch with no forge scratch gets no strip commit (tree untouched)', () => {
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: work']);
    const wiTipBefore = sh(proj, ['rev-parse', 'wi-branch']).trim();
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const { path: wiWorktreePath, cleanup: cleanupWi } = addWiWorktree(proj, 'wi-branch');
    try {
      const result = mergeWiIntoCycle({
        cycleWorktreePath: proj,
        wiBranch: 'wi-branch',
        workItemId: 'WI-4',
        wiWorktreePath,
      });

      assert.equal(result.merged, true);
      assert.equal(result.merged && result.scratchStripped, undefined, 'no scratch → key omitted, no strip attempted');
      assert.equal(
        sh(proj, ['rev-parse', 'wi-branch']).trim(),
        wiTipBefore,
        'wi-branch tip must be unchanged — no strip commit added',
      );
    } finally {
      cleanupWi();
    }
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: an untracked forge-scratch collision is remediated in place — no requeue (layer 2, defense)', () => {
  const { proj, cleanup } = setup();
  try {
    // The WI branch "somehow still carries" committed scratch (layer 1 not
    // exercised here — no wiWorktreePath passed — isolating layer 2).
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    mkdirSync(join(proj, '.forge'), { recursive: true });
    writeFileSync(join(proj, '.forge', 'last-gate-failure.md'), 'wi-side committed copy\n');
    sh(proj, ['add', '.forge/last-gate-failure.md']);
    sh(proj, ['commit', '-q', '-m', 'wi: work (still carries scratch)']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    // The cycle worktree independently holds an UNTRACKED copy at the same
    // path (unifier-level gate feedback) — the exact live-cycle collision.
    mkdirSync(join(proj, '.forge'), { recursive: true });
    writeFileSync(join(proj, '.forge', 'last-gate-failure.md'), 'unifier-side untracked feedback\n');

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-2' });

    assert.equal(result.merged, true, 'the untracked-overwrite refusal must be remediated, not treated as a conflict');
    assert.deepEqual(result.merged && result.untrackedRemediated, ['.forge/last-gate-failure.md']);
    assert.equal(
      readFileSync(join(proj, '.forge', 'last-gate-failure.md'), 'utf8'),
      'wi-side committed copy\n',
      'the WI branch content wins post-merge (the untracked copy was regenerable feedback, deleted then overwritten by the merge)',
    );
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'working tree must be clean after the in-place retry');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a non-scratch untracked-overwrite collision is a real failure — nothing deleted', () => {
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(proj, 'config.json'), '{"wi":"value"}\n');
    sh(proj, ['add', 'config.json']);
    sh(proj, ['commit', '-q', '-m', 'wi: adds config.json']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    // An untracked, NON-forge-scratch file collides at the same path — never
    // a candidate for deletion, regardless of the merge outcome.
    writeFileSync(join(proj, 'config.json'), 'unrelated untracked content\n');

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-3' });

    assert.equal(result.merged, false);
    if (!result.merged) {
      assert.match(result.detail, /config\.json/, 'the failure detail names the offending file');
    }
    assert.equal(existsSync(join(proj, 'config.json')), true, 'the untracked project file must never be deleted');
    assert.equal(
      readFileSync(join(proj, 'config.json'), 'utf8'),
      'unrelated untracked content\n',
      'untouched content',
    );
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.notEqual(status, '', 'the untracked collision is still sitting there — nothing was silently cleaned up');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a real content conflict is still classified merge-conflict, untouched by the untracked-overwrite path', () => {
  // Guards the existing conflict-classification path (diff --diff-filter=U)
  // against regression from the new untracked-overwrite branch added above —
  // a genuine conflict must never be misrouted into scratch remediation.
  const { proj, cleanup } = setup();
  try {
    writeFileSync(join(proj, 'README.md'), 'cycle change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: change readme']);
    sh(proj, ['checkout', '-q', '-b', 'wi-branch', 'main']);
    writeFileSync(join(proj, 'README.md'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: change readme']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-5' });

    assert.equal(result.merged, false);
    if (!result.merged) {
      assert.deepEqual(result.conflict.conflictingFiles, ['README.md']);
      assert.equal(result.untrackedRemediated, undefined, 'a real conflict is never routed through remediation');
    }
  } finally {
    cleanup();
  }
});

test('mergeAndPublish: strips WI-branch scratch before merging so it never reaches the pushed cycle branch', () => {
  const { proj, cleanup } = setup();
  try {
    const { origin, cleanup: cleanupOrigin } = addOrigin(proj);
    try {
      sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
      mkdirSync(join(proj, '.forge'), { recursive: true });
      writeFileSync(join(proj, '.forge', 'last-gate-failure.md'), 'wi-side gate feedback\n');
      writeFileSync(join(proj, 'wi-6.txt'), 'wi work\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'wi: work (incl scratch leak)']);
      sh(proj, ['checkout', '-q', 'cycle-branch']);

      // The WI spec file belongs to the CYCLE worktree's `.forge/work-items/`
      // (real dev-loop shape) — written here, AFTER the wi-branch checkout
      // above, so it's never sitting in the shared working directory while
      // `wi-branch`'s `git add .` runs (which would sweep it onto the WI
      // branch and then have it stripped alongside the deliberate scratch).
      const specPath = writeWiSpec(proj, 'WI-6');

      const { path: wiWorktreePath, cleanup: cleanupWi } = addWiWorktree(proj, 'wi-branch');
      try {
        const result = mergeAndPublish({
          cycleWorktreePath: proj,
          wiBranch: 'wi-branch',
          workItemId: 'WI-6',
          specPath,
          wiWorktreePath,
        });

        assert.equal(result.merged, true);
        assert.deepEqual(result.merged && result.scratchStripped, ['.forge/last-gate-failure.md']);

        const localHead = sh(proj, ['rev-parse', 'HEAD']).trim();
        assert.equal(remoteHeadOf(proj, origin, 'cycle-branch'), localHead, 'the stripped merge commit must reach origin');
        assert.equal(
          sh(origin, ['ls-tree', '-r', '--name-only', 'cycle-branch']).includes('.forge/last-gate-failure.md'),
          false,
          'the scratch file must never appear on origin',
        );
      } finally {
        cleanupWi();
      }
    } finally {
      cleanupOrigin();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// createMergeQueue
// ---------------------------------------------------------------------------

test('createMergeQueue: serializes calls in enqueue order, even when the first is slower', async () => {
  const queue = createMergeQueue();
  const order: string[] = [];

  const slow = queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('slow');
    return 'slow-result';
  });
  const fast = queue.enqueue(async () => {
    order.push('fast');
    return 'fast-result';
  });

  const results = await Promise.all([slow, fast]);
  assert.deepEqual(order, ['slow', 'fast'], 'fast must not run before slow, despite finishing sooner if unserialized');
  assert.deepEqual(results, ['slow-result', 'fast-result']);
});

test('createMergeQueue: a rejected task does not stall subsequent tasks', async () => {
  const queue = createMergeQueue();

  const failing = queue.enqueue(async () => {
    throw new Error('boom');
  });
  const following = queue.enqueue(async () => 'ok');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'ok', 'a later task must still run after an earlier one rejects');
});

test('createMergeQueue: supports synchronous functions', async () => {
  const queue = createMergeQueue();
  const result = await queue.enqueue(() => 42);
  assert.equal(result, 42);
});

// ---------------------------------------------------------------------------
// mergeAndPublish (Phase 4 step 6 review fix — merge + status write + push
// folded into one call, so the merge queue's serialization covers all three)
// ---------------------------------------------------------------------------

test('mergeAndPublish: a clean merge writes the WI status to complete and publishes the merge commit to origin', () => {
  const { proj, cleanup } = setup();
  try {
    const { origin, cleanup: cleanupOrigin } = addOrigin(proj);
    try {
      const specPath = writeWiSpec(proj, 'WI-1');

      sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
      writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'wi: work']);
      sh(proj, ['checkout', '-q', 'cycle-branch']);

      const result = mergeAndPublish({
        cycleWorktreePath: proj,
        wiBranch: 'wi-branch',
        workItemId: 'WI-1',
        specPath,
      });

      assert.equal(result.merged, true);
      assert.equal(result.merged && result.push.pushed, true);

      assert.match(readFileSync(specPath, 'utf8'), /status:\s*complete/);

      const localHead = sh(proj, ['rev-parse', 'HEAD']).trim();
      assert.equal(
        remoteHeadOf(proj, origin, 'cycle-branch'),
        localHead,
        'the merge commit must already be on origin — the push ran inside mergeAndPublish',
      );
    } finally {
      cleanupOrigin();
    }
  } finally {
    cleanup();
  }
});

test('mergeAndPublish: a merge conflict neither writes the WI status nor pushes anything', () => {
  const { proj, cleanup } = setup();
  try {
    const { origin, cleanup: cleanupOrigin } = addOrigin(proj);
    try {
      const specPath = writeWiSpec(proj, 'WI-2');
      const specBefore = readFileSync(specPath, 'utf8');

      // Diverge: cycle-branch and wi-branch both change README.md.
      writeFileSync(join(proj, 'README.md'), 'cycle change\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'cycle: change readme']);
      sh(proj, ['checkout', '-q', '-b', 'wi-branch', 'main']);
      writeFileSync(join(proj, 'README.md'), 'wi change\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'wi: change readme']);
      sh(proj, ['checkout', '-q', 'cycle-branch']);

      const localHeadBefore = sh(proj, ['rev-parse', 'HEAD']).trim();
      // The cycle-branch diverge commit above was never pushed — capture
      // origin's actual head (still the pre-diverge commit from `addOrigin`)
      // so the post-assertion proves origin is untouched, not merely equal
      // to a local ref that also never reached it.
      const originHeadBefore = remoteHeadOf(proj, origin, 'cycle-branch');

      const result = mergeAndPublish({
        cycleWorktreePath: proj,
        wiBranch: 'wi-branch',
        workItemId: 'WI-2',
        specPath,
      });

      assert.equal(result.merged, false);
      assert.equal(readFileSync(specPath, 'utf8'), specBefore, 'status file must be untouched on a merge conflict');
      assert.equal(sh(proj, ['rev-parse', 'HEAD']).trim(), localHeadBefore, 'cycle-branch HEAD must be unmoved');
      assert.equal(
        remoteHeadOf(proj, origin, 'cycle-branch'),
        originHeadBefore,
        'origin must be unchanged — a failed merge never reaches the push',
      );
    } finally {
      cleanupOrigin();
    }
  } finally {
    cleanup();
  }
});

test('mergeAndPublish: two WIs queued through the same merge queue land fully in enqueue order, never interleaved', async () => {
  const { proj, cleanup } = setup();
  try {
    const { origin, cleanup: cleanupOrigin } = addOrigin(proj);
    try {
      const spec1 = writeWiSpec(proj, 'WI-1');
      const spec2 = writeWiSpec(proj, 'WI-2');

      // Two independent WI branches, both forked from the same cycle-branch
      // tip, so ordering (not conflict handling, covered above) is what's
      // under test here.
      sh(proj, ['checkout', '-q', '-b', 'wi-branch-1']);
      writeFileSync(join(proj, 'wi-1.txt'), 'wi 1\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'wi: 1']);
      sh(proj, ['checkout', '-q', '-b', 'wi-branch-2', 'cycle-branch']);
      writeFileSync(join(proj, 'wi-2.txt'), 'wi 2\n');
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', 'wi: 2']);
      sh(proj, ['checkout', '-q', 'cycle-branch']);

      const queue = createMergeQueue();
      const order: string[] = [];

      const land = (workItemId: string, wiBranch: string, specPath: string) =>
        queue.enqueue(() => {
          order.push(`${workItemId}:start`);
          const outcome = mergeAndPublish({ cycleWorktreePath: proj, wiBranch, workItemId, specPath });
          order.push(`${workItemId}:published`);
          return outcome;
        });

      // Dispatched "concurrently" (no await between the two enqueue calls,
      // mirroring how `dispatchWi` fires each WI's dispatch task under
      // cap>1) — the queue must still fully serialize them.
      const [r1, r2] = await Promise.all([
        land('WI-1', 'wi-branch-1', spec1),
        land('WI-2', 'wi-branch-2', spec2),
      ]);

      assert.equal(r1.merged, true);
      assert.equal(r2.merged, true);
      // Each WI's start/published pair must never interleave with the
      // other's — proves the FULL merge+status+push sequence for one WI
      // completes before the next WI's merge is even attempted.
      assert.deepEqual(order, ['WI-1:start', 'WI-1:published', 'WI-2:start', 'WI-2:published']);

      assert.match(readFileSync(spec1, 'utf8'), /status:\s*complete/);
      assert.match(readFileSync(spec2, 'utf8'), /status:\s*complete/);

      const localHead = sh(proj, ['rev-parse', 'HEAD']).trim();
      assert.equal(
        remoteHeadOf(proj, origin, 'cycle-branch'),
        localHead,
        'origin must carry both merges once the queue drains',
      );
    } finally {
      cleanupOrigin();
    }
  } finally {
    cleanup();
  }
});
