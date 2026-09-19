/**
 * fixture-ground-trees.test.ts — the real-ground fence judges a ground only
 * inside a tree present at BOTH snapshots, and every way it could look at
 * fewer trees than it says is refused rather than silent (M7-D, bead
 * `forge-1rk5.1`).
 *
 * `projects/mdtoc` is tracked, so every new worktree of this repo arrives
 * with a real ground in it. A lane adding or pruning a worktree while a
 * fixture run is in progress must not red that run — nothing the story did
 * moved a ground — so `realGroundFenceVerdict` names such a tree on its own
 * line (`treeLines`) and does not judge it. A ground that appears, vanishes,
 * changes or cannot be hashed inside a tree that was there both times still
 * reds the run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { realGroundDirs, snapshotRealGrounds, realGroundFenceVerdict } from './fixture-ground.mjs';
import { siblingDirs } from './ground-hash.mjs';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'fixture-ground-trees-')));
const ground = (tree: string, name: string) => join(tree, 'projects', name);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROOT = '/root';
const LANE = '/lane-x';

// ── the verdict, over hand-built snapshots ─────────────────────────────────

test('a tree only in `after` — a worktree added during the run — is named APPEARED and never judged', () => {
  const before = new Map([[ground(ROOT, 'gitpulse'), 'a1']]);
  const after = new Map([[ground(ROOT, 'gitpulse'), 'a1'], [ground(LANE, 'mdtoc'), 'm1']]);

  const v = realGroundFenceVerdict(before, after, { before: [ROOT], after: [ROOT, LANE] });
  assert.equal(v.ok, true, `a worktree appearing is not this run moving a ground. moved: ${v.moved.join('; ')}`);
  assert.deepEqual(v.moved, []);
  assert.deepEqual(v.treeLines, [`real grounds: tree ${LANE} APPEARED during the run — not this run's ground, not red`]);
});

test('a tree only in `before` — a worktree removed during the run — is named VANISHED and never judged', () => {
  const before = new Map([[ground(ROOT, 'gitpulse'), 'a1'], [ground(LANE, 'mdtoc'), 'm1']]);
  const after = new Map([[ground(ROOT, 'gitpulse'), 'a1']]);

  const v = realGroundFenceVerdict(before, after, { before: [ROOT, LANE], after: [ROOT] });
  assert.equal(v.ok, true, `a worktree vanishing is not this run moving a ground. moved: ${v.moved.join('; ')}`);
  assert.deepEqual(v.moved, []);
  assert.deepEqual(v.treeLines, [`real grounds: tree ${LANE} VANISHED during the run — not this run's ground, not red`]);
});

test('a ground APPEARING inside a tree present at both snapshots is still RED', () => {
  const before = new Map([[ground(ROOT, 'gitpulse'), 'a1']]);
  const after = new Map([[ground(ROOT, 'gitpulse'), 'a1'], [ground(LANE, 'newground'), 'n1']]);

  const v = realGroundFenceVerdict(before, after, { before: [ROOT, LANE], after: [ROOT, LANE] });
  assert.equal(v.ok, false, 'a ground that appeared inside a persisting tree is a move');
  assert.equal(v.moved.length, 1, v.moved.join('\n'));
  assert.match(v.moved[0], new RegExp(`^APPEARED ${escapeRegex(ground(LANE, 'newground'))}`));
  assert.deepEqual(v.treeLines, [], 'no tree came or went');
});

test('a ground VANISHING or CHANGING inside a persisting tree is still RED', () => {
  const before = new Map([[ground(LANE, 'gone'), 'g1'], [ground(LANE, 'edited'), 'e1']]);
  const after = new Map([[ground(LANE, 'edited'), 'e2']]);

  const v = realGroundFenceVerdict(before, after, { before: [ROOT, LANE], after: [ROOT, LANE] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.moved.map((l) => l.split(' ')[0]), ['MODIFIED', 'VANISHED'], v.moved.join('\n'));
});

test('an unreadable ground that APPEARS inside a persisting tree is named and RED — absent and unreadable never compare equal', () => {
  const dir = ground(ROOT, 'newground');
  const v = realGroundFenceVerdict(new Map(), new Map([[dir, null]]), { before: [ROOT], after: [ROOT] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.unreadable, [dir]);
  assert.equal(v.summary, 'real grounds: 0 hashed in 0 tree(s), 0 moved, 1 unreadable');
});

test('an unreadable ground inside a tree that APPEARED during the run is not judged either', () => {
  const v = realGroundFenceVerdict(new Map(), new Map([[ground(LANE, 'mdtoc'), null]]), { before: [ROOT], after: [ROOT, LANE] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.unreadable, []);
});

// ── end to end, on a real repository ───────────────────────────────────────

function git(cwd: string, ...args: string[]) {
  const res = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid',
    },
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** What `run-story.mjs` takes at each end of a fixture run. */
function snapshot(root: string) {
  const worktrees = siblingDirs(root);
  return { trees: [root, ...worktrees], grounds: snapshotRealGrounds(realGroundDirs(root, { worktrees })) };
}

test('end to end: `git worktree add` and `git worktree remove` between the snapshots never red the fence — and would without the tree listings', () => {
  const root = scratch();
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'projects', 'mdtoc'), { recursive: true });
  writeFileSync(join(root, 'projects', 'mdtoc', 'README.md'), '# tracked real ground\n');
  git(root, 'add', 'projects/mdtoc/README.md');
  git(root, 'commit', '-q', '-m', 'tracked real ground');
  const lane = join(scratch(), 'lane-x');

  const beforeAdd = snapshot(root);
  git(root, 'worktree', 'add', '-q', lane);
  const afterAdd = snapshot(root);

  const added = realGroundFenceVerdict(beforeAdd.grounds, afterAdd.grounds, { before: beforeAdd.trees, after: afterAdd.trees });
  assert.equal(added.ok, true, `a worktree added mid-run must not red the fence. moved: ${added.moved.join('; ')}`);
  assert.deepEqual(added.treeLines, [`real grounds: tree ${lane} APPEARED during the run — not this run's ground, not red`]);
  assert.equal(
    realGroundFenceVerdict(beforeAdd.grounds, afterAdd.grounds).ok,
    false,
    'control: judged without the tree listings, the new worktree\'s tracked ground reads as APPEARED — the false red',
  );

  git(root, 'worktree', 'remove', lane);
  const afterRemove = snapshot(root);
  const removed = realGroundFenceVerdict(afterAdd.grounds, afterRemove.grounds, { before: afterAdd.trees, after: afterRemove.trees });
  assert.equal(removed.ok, true, `a worktree removed mid-run must not red the fence. moved: ${removed.moved.join('; ')}`);
  assert.deepEqual(removed.treeLines, [`real grounds: tree ${lane} VANISHED during the run — not this run's ground, not red`]);
});

// ── the fence never looks at fewer trees than it says ──────────────────────

test('siblingDirs THROWS, naming the tree, when git cannot list its worktrees — an empty list would read as "no siblings"', () => {
  const notARepo = scratch();
  assert.throws(() => siblingDirs(notARepo), new RegExp(escapeRegex(notARepo)));
});

test('realGroundDirs refuses a call with no `worktrees` — a default would fence the root alone and say nothing', () => {
  const root = scratch();
  assert.throws(() => realGroundDirs(root), /worktrees/);
  assert.throws(() => realGroundDirs(root, {}), /worktrees/);
});
