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
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

import { fenceBreaches, describeFence, siblingWorktreeEscapes, snapshotSiblingWorktrees, unownedEscapes } from './sweep.mjs';
import { sessionScratchRoots } from './fence-attribution.mjs';

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

/**
 * A real sleeper whose cwd is `dir`, so `/proc/<pid>/cwd` genuinely points
 * there — and OBSERVED to be there before the caller proceeds.
 *
 * The wait is not politeness. `spawn` returns a pid the instant it forks, but
 * the child may not have exec'd yet; under a loaded full-suite run this test
 * scanned `/proc` before the sleeper's cwd was its own, found no owner, and
 * failed on the very assertion it exists to make. A test that asserts a
 * condition it has not established is a flake with a good story.
 */
function sleeperIn(dir) {
  const child = spawn('sleep', ['30'], { cwd: dir, detached: true, stdio: 'ignore' });
  child.unref();
  const want = realpathSync(dir);
  const deadline = Date.now() + 5000;
  for (;;) {
    let cwd = '';
    try { cwd = readlinkSync(join('/proc', String(child.pid), 'cwd')); } catch { /* not visible yet */ }
    if (cwd === want) return child;
    if (Date.now() >= deadline) {
      try { process.kill(child.pid); } catch { /* already gone */ }
      throw new Error(`the sleeper never appeared in /proc with cwd ${want} — this test cannot mean anything without it`);
    }
    execFileSync('sleep', ['0.02']);
  }
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

// --- 6.11.32: an escape into a GITIGNORED path was invisible to the fence ----
//
// MEASURED: `projects/story-s2` sat in the MAIN CHECKOUT from 2026-08-30 — an
// M1-era S2 run, before the fence existed — and every sibling snapshot since
// looked straight past it. `git status --porcelain -uall` does not list
// ignored paths, and this repo ignores `projects/*` (`.gitignore:68`), `_logs/*`
// and `_queue/pending/*`. So the one place a story run creates its GROUND is
// precisely the place the fence could not see.
//
// The pair below is the rule: the same planted directory, once proven
// invisible to git and once named by the fence.

/** A repo whose `projects/` is gitignored, exactly as forge's own is. */
function makeRepoIgnoringProjects() {
  const dir = makeRepo();
  writeFileSync(join(dir, '.gitignore'), 'projects/*\n_logs/*\n', 'utf8');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('add', '.gitignore');
  git('commit', '-qm', 'ignore projects');
  mkdirSync(join(dir, 'projects'), { recursive: true });
  return dir;
}

test('6.11.32: a ground planted in a sibling\'s IGNORED projects/ is NAMED — git status cannot see it, the fence must', () => {
  const main = makeRepoIgnoringProjects();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);

  // The escape: a whole ground appears in a tree this run does not own.
  mkdirSync(join(main, 'projects', 'story-s2', '.forge'), { recursive: true });
  writeFileSync(join(main, 'projects', 'story-s2', '.forge', 'project.json'), '{}\n', 'utf8');

  // THE PREMISE, asserted rather than assumed: git itself reports nothing.
  const porcelain = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: main, encoding: 'utf8' });
  assert.doesNotMatch(porcelain, /story-s2/, 'the incident: git status is blind to an ignored path, so the old fence was too');

  const escapes = siblingWorktreeEscapes(sibling, baseline, { liveRoots: () => new Map() });
  assert.equal(escapes.length, 1, 'the fence sees what git status does not');
  assert.equal(escapes[0].root, main);
  assert.ok(escapes[0].paths.some((p) => p.includes('projects/story-s2')), `the ground is named: ${escapes[0].paths.join(', ')}`);
});

test('6.11.32: a ground that was ALREADY there is not charged to this run', () => {
  const main = makeRepoIgnoringProjects();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  // Pre-existing dirt in someone else's tree — the operator's own ground.
  mkdirSync(join(main, 'projects', 'gitweave'), { recursive: true });
  const baseline = snapshotSiblingWorktrees(sibling);

  const escapes = siblingWorktreeEscapes(sibling, baseline, { liveRoots: () => new Map() });
  assert.deepEqual(escapes, [], 'the baseline covers it, exactly as it does for tracked dirt');
});

// --- 7.5.1: a worktree that APPEARED mid-run is attributed by who owns its path
//
// MEASURED, M6-A S1 run 12 (2026-09-07 12:37:23Z, `_1.0/reports/m6-a-S1-1.log`
// lines 86-95 and 100):
//
//   fence: ESCAPED _queue/done — written into /tmp/claude-1000/
//   -home-parso-forge-m6-b/d7ba5f92-.../scratchpad/base, a worktree this run
//   does not own
//   S1: CONTAINMENT FAILURE — 10 path(s) written into 1 worktree(s) this run
//   does not own. The run is RED regardless of its beats.
//
// and a funded run ($2.89) died on them. What actually happened: lane M6-B cut
// a disposable `git worktree` of main under its own scratchpad, mid-run, for a
// read-only measurement. The ten "written" paths were that checkout's OWN
// tracked skeleton — `_logs/.gitkeep`, `_queue/*`, `projects/*` — put there by
// `git worktree add` itself. Lane m6-a never touched any of it.
//
// The enumeration was RIGHT to see the tree. The escalation is the defect, and
// the same sweep printed both halves of it: nine paths in
// `/home/parso/forge-m6-b` were correctly UNATTRIBUTABLE because pid 2362033
// was live with its cwd there (lines 76-85), while the tree that lane had just
// created escalated to ESCAPED for one reason — `git worktree add`'s process is
// rooted OUTSIDE the tree it creates, so #507's live-cwd rule could not reach it.
//
// THE RULE THIS ADDS, and its exact boundary. A worktree PRESENT at run start
// keeps today's rule unchanged: growth in it with nobody rooted there is an
// escape and reds the run. A worktree that APPEARED during the run is judged by
// whether a live session owns its PATH — its cwd, or the scratch root that cwd
// implies. Nothing owns it, nothing is excused.
//
// Deliberate limit, stated rather than discovered: if the owning session EXITS
// before the sweep, its tree has no live owner and the run reds. That is the
// honest reading — there is nobody left to attribute it to — and it keeps the
// guard from being satisfied by a path pattern alone.

/** A repo carrying the ignored-root skeleton every forge checkout has. */
function makeRepoWithSkeleton() {
  const dir = makeRepo();
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  for (const [rel, body] of [['_logs/.gitkeep', ''], ['_queue/README.md', 'queue\n'], ['projects/.gitkeep', '']]) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body, 'utf8');
  }
  git('add', '-A');
  git('commit', '-qm', 'skeleton');
  return dir;
}

/** `git worktree add` at `at` — the act that created the tree in the incident. */
function addWorktreeAt(main, at, branch) {
  mkdirSync(join(at, '..'), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', '-b', branch, at], { cwd: main, stdio: 'pipe' });
  return at;
}

test('7.5.1: a worktree that APPEARED mid-run under a live session\'s scratch root is UNATTRIBUTABLE — the incident, reproduced', () => {
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');
  const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));

  // The baseline is taken BEFORE the sibling exists — exactly as a run does.
  const baseline = snapshotSiblingWorktrees(runRoot);
  const sleeper = sleeperIn(laneDir);
  try {
    // The owner's cwd is its own worktree, never inside the tree it creates.
    const scratchTree = addWorktreeAt(
      main,
      join(sessionScratchRoots(realpathSync(laneDir))[0], 'd7ba5f92-4581-4280-8fb7-e5486ac9ba61', 'scratchpad', 'base'),
      'scratch-b',
    );
    const escapes = siblingWorktreeEscapes(runRoot, baseline);
    const mine = escapes.filter((e) => e.root === scratchTree);

    assert.equal(mine.length, 1, 'the tree is still SEEN — this rule changes attribution, never visibility');
    assert.ok(mine[0].paths.some((p) => p.startsWith('_queue/')), `the skeleton is still named in full: ${mine[0].paths.join(', ')}`);
    assert.notEqual(mine[0].live, null, 'the session whose scratch root this is was live the whole time');
    assert.equal(mine[0].live.pid, sleeper.pid, 'and the report names WHICH session, so it can be chased');
    assert.equal(mine[0].live.via, 'appeared', 'classified by the rule that actually applies, not by a cwd inside the tree');

    assert.deepEqual(unownedEscapes(escapes), [], 'so it cannot red a funded run on its own');
    const said = describeFence({ removed: [], restored: [], failed: [], defer: [], escapes }, []).join('\n');
    assert.match(said, /UNATTRIBUTABLE/);
    assert.match(said, new RegExp(`pid ${sleeper.pid}`), 'with the pid');
    assert.match(said, /appeared DURING this run/, 'and says WHICH rule classified it — a cwd claim would be false here');
    assert.doesNotMatch(said, /ESCAPED/);
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('7.5.1: a worktree that appeared mid-run under a live session\'s OWN CWD is attributed the same way', () => {
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');
  // The lane dir is a real WORKTREE, not any directory: see the control below
  // for why a bare ancestor must not own what appears beneath it.
  const laneDir = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-laneb-')), 'lane-b'), 'lane-b');

  const baseline = snapshotSiblingWorktrees(runRoot);
  const sleeper = sleeperIn(laneDir);
  try {
    const under = addWorktreeAt(main, join(laneDir, 'scratch', 'base'), 'under-lane');
    const mine = siblingWorktreeEscapes(runRoot, baseline).filter((e) => e.root === under);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].live.pid, sleeper.pid, 'the lane that owns the directory owns what it creates inside it');
    assert.equal(mine[0].live.via, 'appeared');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('7.5.1: POSITIVE CONTROL — a worktree that appeared mid-run that NOBODY owns still ESCAPES', () => {
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');

  const baseline = snapshotSiblingWorktrees(runRoot);
  // No sleeper anywhere near it: appearing mid-run is not on its own an excuse.
  const orphan = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-orphan-')), 'base'), 'orphan');
  const mine = siblingWorktreeEscapes(runRoot, baseline).filter((e) => e.root === orphan);

  assert.equal(mine.length, 1);
  assert.equal(mine[0].live, null, 'a path no live session owns excuses nothing');
  assert.equal(unownedEscapes(mine).length, 1, 'and it still reds the run');
  const said = describeFence({ removed: [], restored: [], failed: [], defer: [], escapes: mine }, []).join('\n');
  assert.match(said, /ESCAPED/);
});

test('7.5.1: POSITIVE CONTROL — a real escape into a worktree that EXISTED at run start still fails', () => {
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');
  const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));

  const baseline = snapshotSiblingWorktrees(runRoot);
  assert.ok(baseline.has(main), 'the premise: this tree WAS there when the run started');
  const sleeper = sleeperIn(laneDir);
  try {
    plantGrowth(main);
    const mine = siblingWorktreeEscapes(runRoot, baseline).filter((e) => e.root === main);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].live, null, 'a live session in an unrelated directory owns nothing here');
    assert.equal(unownedEscapes(mine).length, 1, 'the guard ruling 309(b) bought is not weakened');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('7.5.1: the scratch root is ENCODED from a live cwd, never decoded back out of a path', () => {
  assert.ok(
    sessionScratchRoots('/home/parso/forge-m6-b').includes(`${tmpdir()}/claude-${process.getuid()}/-home-parso-forge-m6-b`),
    'the incident\'s own path shape is derived from the cwd, not guessed',
  );
  // THE ENCODING IS MANY-TO-ONE, asserted rather than assumed away: `/` and `-`
  // both map to `-`, so `/home/parso/forge/m6/b` produces the SAME root as
  // `/home/parso/forge-m6-b`. That is why the fence encodes from a cwd it
  // actually observed in `/proc` and never decodes a lane identity back out of
  // a scratch path — a decode would have to pick one of these and would be
  // guessing, and a guess is how a fence excuses the escape it exists to catch.
  assert.deepEqual(
    sessionScratchRoots('/home/parso/forge/m6/b'),
    sessionScratchRoots('/home/parso/forge-m6-b'),
    'the collision is real; the residual is that a LIVE process sitting at the colliding cwd would own the same root',
  );
});

test('7.5.1: a cwd that cannot own a scratch root yields none — nothing is excused by default', () => {
  assert.deepEqual(sessionScratchRoots(''), []);
  assert.deepEqual(sessionScratchRoots('relative/path'), []);
});

// --- 7.5.1 round 2: a GENERIC ancestor is not an owner -----------------------
//
// MEASURED, and it is a hole in the fix that shipped in #532. Gate pr5's full
// suite failed three of the tests above with `61726 !== 62668` — the report
// named a DIFFERENT pid as the owner than the sleeper the test planted. Cause,
// reproduced deterministically by a probe: `liveSessionOwners` checked each
// live pid's own `cwd` as an ownership root, so a process sitting in `/tmp`
// owned EVERY worktree that appeared anywhere beneath it:
//
//   sleeper pid 93550 (cwd /tmp) => {"pid":93550,"via":"appeared","ownerRoot":"/tmp"}
//
// Under a full suite something is always sitting in a generic directory, which
// is why this passed alone and failed under load. It is not a flake: on a host
// where a shell sits in `$HOME`, a real escape into `~/forge-victim` would have
// been excused — the precise hole T1's ruling and this file's own header said
// must not be opened, arrived at from the other direction.
//
// A LANE is a worktree, not a directory. The cwd arm now requires the cwd to be
// a git worktree root; the scratch-root arm is unchanged, because a scratch root
// already encodes one full cwd and cannot be generic.

test('7.5.1 (RED): a live process in a GENERIC ancestor directory owns nothing beneath it', () => {
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');

  const baseline = snapshotSiblingWorktrees(runRoot);
  // The sleeper sits in the SHARED temp root — an ancestor of the tree below,
  // and of half the host. It is nobody's lane.
  const sleeper = sleeperIn(tmpdir());
  try {
    const orphan = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-orphan-')), 'base'), 'orphan');
    const mine = siblingWorktreeEscapes(runRoot, baseline).filter((e) => e.root === orphan);

    assert.equal(mine.length, 1);
    assert.equal(mine[0].live, null, `a process in ${tmpdir()} is not the owner of what appears under it`);
    assert.equal(unownedEscapes(mine).length, 1, 'so it still reds the run');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('7.5.1 (RED): the same holds for the scratch root of a process in a generic directory', () => {
  // `/tmp` encodes to `-tmp`, so its scratch root is `<tmp>/claude-<uid>/-tmp`.
  // A worktree at `<tmp>/claude-<uid>/-tmp-something/...` is NOT under it — the
  // separator check is what makes that true, and this pins it.
  const roots = sessionScratchRoots(tmpdir());
  assert.ok(roots.length > 0);
  assert.ok(
    !`${roots[0]}-fence-laneb-x/y/base`.startsWith(`${roots[0]}/`),
    'a sibling whose name merely EXTENDS a scratch root must never read as inside it',
  );
});

test('7.5.6: when two live lanes\' roots OVERLAP, the MOST SPECIFIC root wins — not whichever pid /proc listed first', () => {
  // T1 ruling 442's second half. Roots genuinely overlap: a worktree cut inside
  // another lane's worktree is beneath both, and first-match-wins made the
  // answer depend on pid enumeration order — so the same tree could be
  // attributed to either session on two consecutive runs. A report that names a
  // session is a report someone will act on, so a confident wrong owner is
  // worse than an honest ambiguous one.
  const main = makeRepoWithSkeleton();
  const runRoot = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-wt-')), 'lane'), 'runner');
  const outer = addWorktreeAt(main, join(mkdtempSync(join(tmpdir(), 'fence-outer-')), 'outer'), 'outer');
  const inner = addWorktreeAt(main, join(outer, 'nested', 'inner'), 'inner');

  const baseline = snapshotSiblingWorktrees(runRoot);
  const outerSleeper = sleeperIn(outer);
  const innerSleeper = sleeperIn(inner);
  try {
    const appeared = addWorktreeAt(main, join(inner, 'scratch', 'base'), 'appeared');
    const mine = siblingWorktreeEscapes(runRoot, baseline).filter((e) => e.root === appeared);

    assert.equal(mine.length, 1);
    assert.equal(
      mine[0].live.pid, innerSleeper.pid,
      `the tree is inside BOTH lanes; the nearer one owns it (outer=${outerSleeper.pid} inner=${innerSleeper.pid}, ` +
      `named ${mine[0].live.pid} via root ${mine[0].live.ownerRoot})`,
    );
    assert.equal(mine[0].live.ownerRoot, realpathSync(inner), 'and the report names WHICH root won, so the choice is checkable');
  } finally {
    for (const s of [outerSleeper, innerSleeper]) { try { process.kill(s.pid); } catch { /* gone */ } }
  }
});
