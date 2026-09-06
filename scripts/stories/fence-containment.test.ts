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
import { execFileSync, spawn } from 'node:child_process';

import { fenceBreaches, describeFence, siblingWorktreeEscapes, snapshotSiblingWorktrees, unownedEscapes } from './sweep.mjs';

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

// --- 6.11.28: git COLLAPSES an untracked directory, and the defer missed it ---

test('6.11.28: a collapsed ancestor still defers the ground brain and removes the rest', () => {
  // REPRODUCED, not theorised. `git status --porcelain -z` reports the TOP-MOST
  // untracked directory — `?? brain/`, never `?? brain/projects/gitweave/` — so
  // `'brain/'.startsWith('brain/projects/gitweave/')` was false, the defer never
  // matched, and ruling 308's hold silently did nothing. The ground brain was
  // left behind twice (S1 runs 6 and 7) while the fence reported `clean`, 18-19
  // minutes after the directory was written, which is what ruled out a race.
  //
  // This is the SAME git behaviour #491 found and fixed with `-uall` — for
  // SIBLING worktrees only. The fact was known and applied to one read; this is
  // the other one.
  //
  // Deferring the whole collapsed `brain/` would be wrong in the other
  // direction: it could hold a FOREIGN project's brain the run also created,
  // which is exactly the escape the fence exists to catch. So the collapsed
  // entry is expanded and classified file by file.
  const b = fenceBreaches([], [{ xy: '??', path: 'brain/' }], 'S1', 'gitweave', {
    expand: (p) => (p === 'brain/'
      ? ['brain/projects/gitweave/profile.md', 'brain/projects/gitweave/kb.yaml', 'brain/projects/someone-else/profile.md']
      : [p]),
  });

  assert.deepEqual(
    [...b.defer].sort(),
    ['brain/projects/gitweave/kb.yaml', 'brain/projects/gitweave/profile.md'],
    'the ground brain is held',
  );
  assert.deepEqual(b.remove, ['brain/projects/someone-else/profile.md'], 'a foreign brain is still an escape');
});

test('6.11.28: with no ground declared, a collapsed entry is not expanded at all', () => {
  // The expansion exists only to serve the ground exemption. A story with no
  // ground has nothing to except, so the cheap path stays cheap.
  let expanded = 0;
  const b = fenceBreaches([], [{ xy: '??', path: 'brain/' }], 'S1', null, {
    expand: (p) => { expanded += 1; return [p]; },
  });
  assert.equal(expanded, 0, 'no expansion when nothing could be exempt');
  assert.deepEqual(b.remove, ['brain/']);
});

// --- 6.11.34 / ruling 340: growth in a tree someone else is working in ------
//
// MEASURED INCIDENT, 2026-09-06 (M5-B session 9): a concurrent gate in
// `/home/parso/forge-gate-m5` ran `scripts/check-boundaries.test.ts`, which
// plants `apps/studio/lib/__ws_probe__.ts` in its OWN tree, and this run
// reported `CONTAINMENT FAILURE` over a story whose beats were 2/2 green — the
// `&&` chain then skipped `proof` entirely. `siblingWorktreeEscapes` diffs a
// before/after snapshot per sibling, so it attributes by TIME WINDOW rather
// than by writer, and two things running at once is this campaign's normal
// state.
//
// The pair below is the whole rule: the SAME planted growth, once with a live
// process rooted in that tree and once without.

/** A real sleeper whose cwd is `dir`, so `/proc/<pid>/cwd` genuinely points there. */
function sleeperIn(dir) {
  const child = spawn('sleep', ['30'], { cwd: dir, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

/** The planted growth both cases share, so the only variable is who owns the tree. */
function plantGrowth(main) {
  mkdirSync(join(main, 'apps', 'studio', 'lib'), { recursive: true });
  writeFileSync(join(main, 'apps', 'studio', 'lib', '__ws_probe__.ts'), '// probe\n');
}

test('6.11.34: growth in a tree with a LIVE process rooted in it is UNATTRIBUTABLE — named with the pid, not fatal', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  const sleeper = sleeperIn(main);
  try {
    plantGrowth(main);
    const escapes = siblingWorktreeEscapes(sibling, baseline);

    assert.equal(escapes.length, 1, 'the growth is still SEEN — this rule changes attribution, never visibility');
    assert.equal(escapes[0].root, main);
    assert.ok(escapes[0].paths.some((p) => p.includes('__ws_probe__.ts')), 'the path is still named in full');
    assert.notEqual(escapes[0].live, null, 'a process rooted in that tree means somebody else was working there');
    assert.equal(escapes[0].live.pid, sleeper.pid, 'and the report names WHICH process, so it can be chased');

    const said = describeFence({ removed: [], restored: [], failed: [], defer: [], escapes }, []).join('\n');
    assert.match(said, /UNATTRIBUTABLE/, 'the line says the run cannot be shown to have written it');
    assert.match(said, new RegExp(`pid ${sleeper.pid}`), 'with the pid');
    assert.doesNotMatch(said, /ESCAPED/, 'and does not also call it an escape');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('6.11.34: the SAME growth with NO process rooted there is still an ESCAPE — the guard is not weakened', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  plantGrowth(main);
  const escapes = siblingWorktreeEscapes(sibling, baseline);

  assert.equal(escapes.length, 1);
  assert.equal(escapes[0].live, null, 'nobody else was working there, so the growth is this run\'s');

  const said = describeFence({ removed: [], restored: [], failed: [], defer: [], escapes }, []).join('\n');
  assert.match(said, /ESCAPED/, 'and it is still reported as an escape, which reds the run');
});

test('6.11.34: the classifier is injectable, so the rule is testable without depending on a real /proc', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  plantGrowth(main);

  const asIfOwned = siblingWorktreeEscapes(sibling, baseline, {
    liveRoots: (dirs) => new Map(dirs.map((d) => [d, { pid: 4242, cwd: d }])),
  });
  assert.deepEqual(asIfOwned[0].live, { pid: 4242, cwd: main });

  const asIfQuiet = siblingWorktreeEscapes(sibling, baseline, { liveRoots: () => new Map() });
  assert.equal(asIfQuiet[0].live, null);
});

test('6.11.34: only UNOWNED growth reds the run — the decision that ends a run has its own name and its own test', () => {
  const owned = { root: '/w/gate', paths: ['apps/studio/lib/__ws_probe__.ts'], live: { pid: 4242, cwd: '/w/gate' } };
  const orphan = { root: '/w/other', paths: ['brain/projects/gitweave/profile.md'], live: null };

  assert.deepEqual(unownedEscapes([owned]), [], 'a tree somebody else is working in cannot red a funded run on its own');
  assert.deepEqual(unownedEscapes([owned, orphan]), [orphan], 'and it does not mask the one that can');
  assert.deepEqual(unownedEscapes(undefined), [], 'a run that never looked has nothing to answer for');
});
