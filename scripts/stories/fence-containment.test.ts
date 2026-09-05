/**
 * The fence's two blind spots, both measured in M5-B session 8.
 *
 * (1) IT DELETED A LEGITIMATE PRODUCT ARTIFACT — T1 ruling 308.
 * S1's onboarding really does create the ground project's Brain 3 sub-wiki
 * (`brain/projects/<ground>/`, central, ADR 035). The fence saw a path that
 * was not a run artifact and removed it:
 *
 *   fence: REMOVED brain/projects/gitweave/ — created by the run, not its
 *   artifact — contained kb.yaml (226 B), profile.md (1729 B), themes/README.md (927 B)
 *
 * That is the same shape ruling 275 already settled for starter agents: a
 * DESIGNED write called an escape. Worse here, because preflight clause C4
 * requires exactly that directory, so deleting it made S1's own exit row
 * (`forge preflight gitweave` MET) unreachable — the post-run verdict was
 * `CONTRACT NOT MET — Failing hard clause(s): C4`, `missing
 * brain/projects/gitweave/profile.md`. Timing and attribution change here;
 * the guarantee does not. A foreign path still reds.
 *
 * (2) ITS CONTAINMENT WAS WORKTREE-LOCAL — T1 ruling 309(b).
 * S1 run 5 reported `fence: clean` in the same run that wrote
 * `/home/parso/forge/brain/projects/gitweave/profile.md` into the MAIN
 * CHECKOUT. The fence only ever read its own tree's porcelain, so a write
 * landing in a sibling worktree was invisible BY CONSTRUCTION — the one class
 * of escape that matters most, since it touches a tree the run does not own.
 *
 * Sibling trees are enumerated from `git worktree list`, never a hardcoded
 * path: the guard must cover whatever trees exist on the host, and the tree
 * that got hit happened to be the main checkout only by accident. Nothing is
 * ever REMOVED from a sibling — deleting from a tree the run does not own is
 * not the fence's business. It names it and reds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { fenceBreaches, describeFence, siblingWorktreeEscapes, snapshotSiblingWorktrees } from './sweep.mjs';

// --- 308: the ground's Brain 3 is an expected artifact, held for the verdict --

const before = [];
const after = (paths) => paths.map((p) => ({ xy: '??', path: p }));

test('308: the ground project\'s Brain 3 is EXPECTED — held, not removed', () => {
  const b = fenceBreaches(before, after(['brain/projects/gitweave/']), 'S1', 'gitweave');

  assert.deepEqual(b.remove, [], 'nothing is removed at fence time');
  assert.deepEqual(b.restore, []);
  assert.deepEqual(b.defer, ['brain/projects/gitweave/'], 'held for the verdict');
});

test('308: a DIFFERENT project\'s brain is still an escape', () => {
  // The guarantee that must not weaken: only the ground this story declares
  // gets the exemption. Onboarding a project the story never named is exactly
  // the escape the fence exists to catch.
  const b = fenceBreaches(before, after(['brain/projects/someone-else/']), 'S1', 'gitweave');

  assert.deepEqual(b.remove, ['brain/projects/someone-else/']);
  assert.deepEqual(b.defer, []);
});

test('308: with no declared ground, nothing is exempt', () => {
  const b = fenceBreaches(before, after(['brain/projects/gitweave/']), 'S1', null);

  assert.deepEqual(b.remove, ['brain/projects/gitweave/']);
  assert.deepEqual(b.defer, []);
});

test('308: the report names a held path as EXPECTED and says why it is still there', () => {
  const lines = describeFence(
    { restored: [], removed: [], defer: ['brain/projects/gitweave/'], failed: [] },
    [],
  );
  const line = lines.find((l) => l.includes('brain/projects/gitweave/'));
  assert.ok(line, 'the held path must appear in the report');
  assert.match(line, /EXPECTED/);
  assert.match(line, /C4/, 'the reason names the clause that needs it');
});

test('308: a run that only held its ground brain is NOT reported as clean', () => {
  // "clean" means the run wrote nothing outside its artifacts. A held path IS
  // such a write — sanctioned, still stated. Saying "clean" here would train a
  // reader to skim the one line an escape appears on (§15.92).
  const lines = describeFence(
    { restored: [], removed: [], defer: ['brain/projects/gitweave/'], failed: [] },
    [],
  );
  assert.ok(!lines.some((l) => l.includes('fence: clean')), 'a held write is not a clean run');
});

// --- 309(b): escapes into sibling worktrees ---------------------------------

/** A git repo with a real commit, so `git worktree add` works. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fence-repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# r\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');
  return dir;
}

test('309b: a write into a SIBLING worktree is named — the incident, reproduced', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);

  // The run, from `sibling`, writes into the tree it does not own — exactly
  // what put gitweave's profile.md in the main checkout.
  mkdirSync(join(main, 'brain', 'projects', 'gitweave'), { recursive: true });
  writeFileSync(join(main, 'brain', 'projects', 'gitweave', 'profile.md'), 'stub\n');

  const escapes = siblingWorktreeEscapes(sibling, baseline);

  assert.equal(escapes.length, 1, 'exactly one sibling tree grew a path');
  assert.equal(escapes[0].root, main);
  assert.ok(
    escapes[0].paths.some((p) => p.includes('brain/projects/gitweave')),
    'the escaped path is named',
  );
});

test('309b: a sibling that was ALREADY dirty is not charged to this run', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  // Dirty BEFORE the run — someone else's work in progress.
  writeFileSync(join(main, 'preexisting.txt'), 'not mine\n');

  const baseline = snapshotSiblingWorktrees(sibling);
  const escapes = siblingWorktreeEscapes(sibling, baseline);

  assert.deepEqual(escapes, [], 'pre-existing dirt is never reported as an escape');
});

test('309b: the run\'s OWN tree is not one of its siblings', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  writeFileSync(join(sibling, 'mine.txt'), 'the run\'s own work\n');

  const escapes = siblingWorktreeEscapes(sibling, baseline);
  assert.deepEqual(escapes, [], 'the run owns its own tree — the fence proper judges that');
});
