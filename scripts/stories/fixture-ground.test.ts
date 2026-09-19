/**
 * fixture-ground.test.ts — acceptance tests for `scripts/stories/fixture-ground.mjs`,
 * pinned BEFORE it existed (M7-D, bead `forge-1rk5.1`).
 *
 * WHAT THIS EXISTS FOR. Today a costed story can only point at a REAL project
 * under `projects/`, and a real ground is a moving target: the launcher pins a
 * method-C hash and refuses a run whose ground has drifted, so every run that
 * exercises onboarding, a fresh clone or a from-scratch history has to either
 * mutate a real project (and then be trusted to put it back) or go unwritten.
 * A FIXTURE GROUND is forge's own, provisioned from a tracked seed under
 * `tests/stories/grounds/<name>/seed/` and torn down after — so a story can
 * drive real git operations against a ground nobody has to protect.
 *
 * TWO SAFETY PROPERTIES carry all the weight here, and both are namespace
 * guards rather than behavioural ones:
 *
 *   - `project` must be in `storyFixtureNames(storyId)` (`story-<id>` /
 *     `story-<id-lowercased>`) — the same reserved prefix the residue sweep
 *     already trusts. A fixture provisioner that could target `projects/gitpulse`
 *     would DELETE a real ground on its way to writing the seed into it.
 *   - a provision that fails writes NOTHING — a half-provisioned ground is
 *     worse than none, because it would look like a good pin to whatever runs
 *     next.
 *
 * DETERMINISM is the other half of the contract: two provisions of the same
 * seed must commit to the IDENTICAL sha, because a story's beats may assert
 * against that commit. `FIXTURE_COMMIT_ENV` freezes author/committer identity
 * and timestamp, so the commit depends on the seed's tree and the fixture
 * name, never on when or by whom it was made.
 *
 * `realGroundDirs` / `snapshotRealGrounds` / `realGroundEscapes` are the other
 * side of the same coin: proof that provisioning and tearing down a FIXTURE
 * never touches a REAL ground, in this tree or a sibling worktree — the
 * `siblingGroundEscapes` idea in `ground-hash.mjs`, generalised to "every real
 * ground this story does not own", not just the one it declares.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { groundManifest } from './ground-hash.mjs';
import {
  provisionFixtureGround,
  teardownFixtureGround,
  realGroundDirs,
  snapshotRealGrounds,
  realGroundEscapes,
} from './fixture-ground.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fixture-ground-'));

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(join(HERE, 'fixture-ground.mjs')).href;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plant `tests/stories/grounds/<name>/{seed/…, PROVENANCE.md}` under `root`. */
function seedFixture(root: string, name = 'demo-seed'): string {
  const seedDir = join(root, 'tests', 'stories', 'grounds', name, 'seed');
  mkdirSync(join(seedDir, 'src'), { recursive: true });
  writeFileSync(join(seedDir, 'README.md'), '# demo seed\n');
  writeFileSync(join(seedDir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', name, 'PROVENANCE.md'), '# provenance\n');
  return seedDir;
}

/** A plain (non-git) directory of files — enough for `groundManifest`, which
 *  hashes the filesystem directly and needs no git repo. */
function makeGround(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

// ── 1. provisioning ──────────────────────────────────────────────────────

test('provisioning copies the seed into a fresh git repo whose digest matches the seed', () => {
  const root = scratch();
  const seedDir = seedFixture(root);
  const result = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  assert.equal(result.dir, join(root, 'projects', 'story-s8'));
  assert.ok(existsSync(join(result.dir, '.git')), 'the fixture ground must be its own git repository');
  assert.deepEqual(result.files, ['README.md', 'src/a.ts']);

  const seedDigest = groundManifest(seedDir)?.digest;
  assert.equal(result.digest, seedDigest, 'method-C digest of the provisioned dir must equal the seed\'s');
  assert.ok(Object.isFrozen(result), 'the result is frozen — nothing downstream can edit the provisioning record');
});

// ── 2. determinism ───────────────────────────────────────────────────────

test('the same seed always produces the SAME commit sha across provisions', () => {
  const root = scratch();
  seedFixture(root);

  const first = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });
  assert.match(first.commit, /^[0-9a-f]{40}$/, `expected a 40-hex sha, got ${first.commit}`);

  teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });
  const second = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  assert.equal(second.commit, first.commit, 'a story\'s beats may assert against this commit — it cannot move run to run');
});

// ── 3. refuses a real-ground id ──────────────────────────────────────────

test('refuses to provision onto a REAL ground project, naming the story\'s own namespace', () => {
  const root = scratch();
  seedFixture(root);

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'gitpulse', fixture: 'demo-seed' }),
    /story-s8/,
    'a fixture provisioner that could target a real project would delete the repo it is written to prove things about',
  );
  assert.equal(existsSync(join(root, 'projects', 'gitpulse')), false, 'gitpulse must not have been created');
});

// ── 4. refuses when PROVENANCE.md is absent ──────────────────────────────

test('refuses a seed with no PROVENANCE.md, naming it, and writes nothing', () => {
  const root = scratch();
  const seedDir = join(root, 'tests', 'stories', 'grounds', 'no-provenance', 'seed');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(join(seedDir, 'README.md'), '# x\n');
  // deliberately no PROVENANCE.md beside the seed

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'no-provenance' }),
    /PROVENANCE\.md/,
  );
  assert.equal(existsSync(join(root, 'projects', 'story-s8')), false, 'a refused provision must write nothing');
});

// ── 5. refuses an existing destination ───────────────────────────────────

test('refuses when the destination already exists, and leaves it byte-identical', () => {
  const root = scratch();
  seedFixture(root);
  const dest = join(root, 'projects', 'story-s8');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'keep.txt'), 'pre-existing\n');

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
    /story-s8/,
  );
  assert.equal(readFileSync(join(dest, 'keep.txt'), 'utf8'), 'pre-existing\n', 'the pre-existing file must be untouched');
  assert.deepEqual(readdirSync(dest), ['keep.txt'], 'nothing else was added to the existing destination');
});

// ── 6. refuses a bad fixture name ────────────────────────────────────────

test('refuses a fixture name that is not a safe single path segment, naming it', () => {
  const root = scratch();
  for (const bad of ['Bad Name', '../x']) {
    assert.throws(
      () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: bad }),
      new RegExp(escapeRegex(bad)),
      `fixture ${JSON.stringify(bad)} must be refused, naming itself in the error`,
    );
  }
});

// ── 7. teardown ───────────────────────────────────────────────────────────

test('teardown removes the provisioned ground', () => {
  const root = scratch();
  seedFixture(root);
  provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });

  const result = teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });
  assert.equal(result.removed, true);
  assert.ok(Object.isFrozen(result));
  assert.equal(existsSync(join(root, 'projects', 'story-s8')), false);
});

test('teardown of a REAL project id throws — the same namespace guard as provisioning', () => {
  const root = scratch();
  assert.throws(
    () => teardownFixtureGround(root, { storyId: 'S8', project: 'mdtoc' }),
    /story-s8/,
  );
});

// ── 8. realGroundDirs ─────────────────────────────────────────────────────

function makeProjectsEntries(projectsDir: string, entries: string[]) {
  mkdirSync(projectsDir, { recursive: true });
  for (const name of entries) {
    if (name.endsWith('/')) mkdirSync(join(projectsDir, name), { recursive: true });
    else writeFileSync(join(projectsDir, name), '');
  }
}

test('realGroundDirs lists every non-story, non-dot project directory across the root and its worktrees, sorted', () => {
  const root = scratch();
  makeProjectsEntries(join(root, 'projects'), ['gitpulse/', 'mdtoc/', 'story-s8/', '.kb-x/', 'README.md', '.gitkeep']);
  const tree2 = scratch();
  makeProjectsEntries(join(tree2, 'projects'), ['gitweave/']);

  const dirs = realGroundDirs(root, { ownProject: null, worktrees: [tree2] });
  const expected = [
    join(root, 'projects', 'gitpulse'),
    join(root, 'projects', 'mdtoc'),
    join(tree2, 'projects', 'gitweave'),
  ].sort();
  assert.deepEqual(dirs, expected);
});

test('realGroundDirs excludes the run\'s OWN ground project from the root\'s own entries', () => {
  const root = scratch();
  makeProjectsEntries(join(root, 'projects'), ['gitpulse/', 'mdtoc/']);

  const dirs = realGroundDirs(root, { ownProject: 'mdtoc', worktrees: [] });
  assert.deepEqual(dirs, [join(root, 'projects', 'gitpulse')]);
});

// ── realGroundDirs' skip must be ENOENT-only ─────────────────────────────
//
// `realGroundDirs`'s `catch { continue; }` around `readdirSync(projectsDir)`
// today swallows EVERY readdir failure identically, silently skipping the
// tree. That is correct for the common case — a sibling worktree with no
// `projects/` dir at all — but wrong for any OTHER failure: a `projects/`
// dir that exists but cannot be READ (permissions, a broken mount, an I/O
// error) would silently vanish from the fence with nothing said, which is
// exactly the shape a real ground escape could hide behind. Only ENOENT
// (the dir is genuinely absent) may be swallowed; everything else must
// THROW, naming the tree, so the run refuses rather than fencing a ground
// it could not actually see.

test('realGroundDirs skips a tree ONLY when its projects/ dir is ABSENT (ENOENT) — silently, with no throw', () => {
  const root = scratch();
  mkdirSync(join(root, 'projects'), { recursive: true });
  const treeWithoutProjects = scratch(); // no projects/ dir created at all — genuine ENOENT

  assert.doesNotThrow(() => realGroundDirs(root, { ownProject: null, worktrees: [treeWithoutProjects] }));
  const dirs = realGroundDirs(root, { ownProject: null, worktrees: [treeWithoutProjects] });
  assert.deepEqual(dirs, [], 'an absent projects/ dir contributes nothing, and is not an error');
});

test('realGroundDirs THROWS, naming the tree, when projects/ exists but cannot be read for a reason OTHER than absence', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root — permission bits are not enforced, so EACCES never occurs');
    return;
  }
  const root = scratch();
  const projectsDir = join(root, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  chmodSync(projectsDir, 0o000);

  try {
    assert.throws(
      () => realGroundDirs(root, { ownProject: null, worktrees: [] }),
      new RegExp(escapeRegex(root)),
      'a projects/ dir that exists but cannot be read must THROW, naming the tree — silently skipping it would ' +
        'let a real ground go unfenced with nothing said',
    );
  } finally {
    chmodSync(projectsDir, 0o755);
  }
});

// ── 9. realGroundEscapes ───────────────────────────────────────────────────

test('realGroundEscapes reports a MODIFIED, an APPEARED and a VANISHED ground, one line each, naming its dir', () => {
  const root = scratch();
  const projectsDir = join(root, 'projects');
  makeGround(join(projectsDir, 'modified'), { 'a.txt': 'one\n' });
  makeGround(join(projectsDir, 'vanishing'), { 'a.txt': 'one\n' });
  const dirs = [
    join(projectsDir, 'modified'),
    join(projectsDir, 'vanishing'),
    join(projectsDir, 'appearing'),
  ];

  const before = snapshotRealGrounds(dirs);
  writeFileSync(join(projectsDir, 'modified', 'a.txt'), 'two\n');
  rmSync(join(projectsDir, 'vanishing'), { recursive: true, force: true });
  makeGround(join(projectsDir, 'appearing'), { 'a.txt': 'one\n' });
  const after = snapshotRealGrounds(dirs);

  const lines = realGroundEscapes(before, after);
  assert.equal(lines.length, 3, lines.join('\n'));
  for (const dir of dirs) {
    assert.ok(lines.some((l) => l.includes(dir)), `expected a line naming ${dir}. Got:\n${lines.join('\n')}`);
  }
});

test('realGroundEscapes reports nothing for an unchanged snapshot pair', () => {
  const root = scratch();
  const dir = join(root, 'projects', 'stable');
  makeGround(dir, { 'a.txt': 'one\n' });
  const dirs = [dir];

  const before = snapshotRealGrounds(dirs);
  const after = snapshotRealGrounds(dirs);
  assert.deepEqual(realGroundEscapes(before, after), []);
});

// ── A traversal-shaped storyId never reaches a real ground ────────────────
//
// `assertOwnNamespace` (`fixture-ground.mjs`) checks membership in
// `storyFixtureNames(storyId)` but never calls `assertSafeStoryId` first.
// `storyFixtureNames` does no id validation of its own — it just builds
// `story-<id>` / `story-<id-lowercased>` — so a caller that passes an
// UNVALIDATED storyId containing `..` can make `project` and the derived
// name agree with each other while `join(root, 'projects', project)`
// resolves somewhere else entirely. Reproduced below: `storyId: '/../mdtoc', project: 'story-/../mdtoc'` resolves
// to `<root>/projects/mdtoc` — a REAL ground's own path — because
// `join('projects', 'story-/../mdtoc')` normalises the embedded `..` before
// the namespace check ever sees a mismatch.
//
// Both provisioning and teardown are exercised, and each asserts the
// ARTIFACT, not only the throw (a fix that validates AFTER writing or
// deleting would pass a throws-only assertion while still causing the
// damage the guard exists to prevent).

test('teardownFixtureGround must not touch a real ground through a traversal-shaped storyId', () => {
  const root = scratch();
  mkdirSync(join(root, 'projects', 'mdtoc'), { recursive: true });
  writeFileSync(join(root, 'projects', 'mdtoc', 'keep.txt'), 'real ground, do not touch\n');

  try {
    teardownFixtureGround(root, { storyId: '/../mdtoc', project: 'story-/../mdtoc' });
  } catch (e) {
    assert.match(
      String((e as Error)?.message ?? e),
      /unsafe story id/,
      `expected the assertSafeStoryId refusal, got: ${(e as Error)?.message ?? e}`,
    );
  }
  // Whether or not it threw, the artifact must be intact — a namespace guard
  // that lets a half-safe call slip through and only THEN throws is no guard
  // at all. Pre-fix this line itself is the failure: it throws ENOENT,
  // because the traversal already deleted projects/mdtoc.
  assert.equal(
    readFileSync(join(root, 'projects', 'mdtoc', 'keep.txt'), 'utf8'),
    'real ground, do not touch\n',
    'projects/mdtoc must be byte-identical afterwards — the id-shaped bypass must never reach a real ground',
  );
});

test('provisionFixtureGround must not write into a real project name through a traversal-shaped storyId', () => {
  const root = scratch();
  seedFixture(root);

  try {
    provisionFixtureGround(root, { storyId: '/../mdtoc', project: 'story-/../mdtoc', fixture: 'demo-seed' });
  } catch (e) {
    assert.match(
      String((e as Error)?.message ?? e),
      /unsafe story id/,
      `expected the assertSafeStoryId refusal, got: ${(e as Error)?.message ?? e}`,
    );
  }
  assert.equal(
    existsSync(join(root, 'projects', 'mdtoc')),
    false,
    'a traversal-shaped storyId must never resolve into projects/mdtoc — the bypass must never reach a real ground name',
  );
});

// ── Determinism for the right reason ───────────────────────────────────────
//
// The round-1 determinism test provisions twice within about a second, and
// git timestamps have 1-second resolution — so an implementation that
// OMITTED `FIXTURE_COMMIT_ENV` entirely would usually still pass it by
// accident (same wall-clock second, same author/committer identity from the
// ambient git config). This test forces the two provisions to disagree on
// wall-clock time by pinning `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` in the
// AMBIENT environment to a date far from `FIXTURE_COMMIT_ENV`'s own
// `2026-01-01T00:00:00Z` before the second provision — a real
// `FIXTURE_COMMIT_ENV` must override the ambient env (git resolves the LAST
// -c/env value), so the commit is unaffected either way; an implementation
// that forgot to set it, or that merges rather than overrides, would produce
// a DIFFERENT sha the second time.
test('determinism holds even when the ambient GIT_AUTHOR_DATE/GIT_COMMITTER_DATE disagree with FIXTURE_COMMIT_ENV', () => {
  const root = scratch();
  seedFixture(root);

  const first = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });
  teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });

  const savedAuthorDate = process.env.GIT_AUTHOR_DATE;
  const savedCommitterDate = process.env.GIT_COMMITTER_DATE;
  try {
    process.env.GIT_AUTHOR_DATE = '2099-12-31T23:59:59Z';
    process.env.GIT_COMMITTER_DATE = '2099-12-31T23:59:59Z';
    const second = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });
    assert.equal(
      second.commit,
      first.commit,
      'FIXTURE_COMMIT_ENV must override the ambient environment, not merely usually agree with it by ' +
        'landing in the same wall-clock second',
    );
  } finally {
    if (savedAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE; else process.env.GIT_AUTHOR_DATE = savedAuthorDate;
    if (savedCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = savedCommitterDate;
  }
});

// ── An unreadable seed directory ─────────────────────────────────────────
//
// `listFiles` (`fixture-ground.mjs`) swallows a `readdirSync` failure with
// `catch { return []; }`. For an UNREADABLE SUBDIRECTORY that is worse than
// it looks: `readdirSync(dir, { recursive: true })` throws for the whole
// walk (not just the one subtree), so `listFiles` returns an empty file list
// for the ENTIRE seed — and `provisionFixtureGround` does not gate on that;
// it copies the seed with `cpSync` regardless.
//
// THIS IS RUN IN A CHILD PROCESS, DELIBERATELY. Measured on this host and
// this Node version: `cpSync(seedDir, dest, { recursive: true })` walking
// INTO a permission-denied subdirectory does not raise a catchable JS
// exception — it aborts the whole process (`std::filesystem::filesystem_error`,
// SIGABRT), a Node bug independent of this module. Calling
// `provisionFixtureGround` in-process here would take this entire test file
// down with it. Isolating it in a child makes the crash itself part of the
// evidence: `res.signal` is non-null today, and must be null once the fix
// makes `listFiles` throw BEFORE `cpSync` ever runs.
test('a seed containing an unreadable directory makes provisioning THROW naming that path, never crash or provision a partial seed', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root — permission bits are not enforced, so EACCES never occurs');
    return;
  }
  const root = scratch();
  const seedDir = join(root, 'tests', 'stories', 'grounds', 'unreadable-seed', 'seed');
  mkdirSync(join(seedDir, 'locked'), { recursive: true });
  writeFileSync(join(seedDir, 'README.md'), '# x\n');
  writeFileSync(join(seedDir, 'locked', 'secret.txt'), 'nope\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', 'unreadable-seed', 'PROVENANCE.md'), '# provenance\n');
  chmodSync(join(seedDir, 'locked'), 0o000);

  try {
    const script = [
      `import { provisionFixtureGround } from ${JSON.stringify(MODULE_URL)};`,
      'try {',
      `  provisionFixtureGround(${JSON.stringify(root)}, { storyId: 'S8', project: 'story-s8', fixture: 'unreadable-seed' });`,
      "  console.error('DID NOT THROW');",
      '  process.exit(2);',
      '} catch (e) {',
      '  console.error(e && e.message ? e.message : String(e));',
      '  process.exit(1);',
      '}',
    ].join('\n');
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });

    assert.equal(
      res.signal,
      null,
      `provisioning must never CRASH the process — the child died by signal ${res.signal}. stderr:\n${res.stderr}`,
    );
    assert.equal(
      res.status,
      1,
      `provisioning must THROW a catchable error (child exit 1), not silently succeed or crash. ` +
        `Got status ${res.status}, signal ${res.signal}. stderr:\n${res.stderr}`,
    );
    assert.match(res.stderr, /locked/, `the thrown error must name the unreadable path. stderr:\n${res.stderr}`);
    assert.equal(
      existsSync(join(root, 'projects', 'story-s8')),
      false,
      'a refused provision must write nothing — no partially-copied seed left behind',
    );
  } finally {
    chmodSync(join(seedDir, 'locked'), 0o755);
  }
});

// ── A seed holds only regular files and directories ──────────────────────
//
// A tracked seed's own author controls its content, but the PROVISIONER
// does not get to assume that content is innocent: `cpSync` follows a
// symlink's OWN metadata (it does not dereference by default) and would
// copy a seed-planted symlink straight into `projects/<project>` — a
// destination this run then treats as a trusted git worktree. A symlink
// (or a fifo, or a socket — anything that is not a plain file or a plain
// directory) inside a seed is refused outright, before any write, naming
// the offending path.

test('provisioning refuses a seed containing a non-regular entry (a symlink to /etc), naming the path, before writing anything', () => {
  const root = scratch();
  const seedDir = seedFixture(root);
  symlinkSync('/etc', join(seedDir, 'evil'));

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
    /evil/,
    'a symlink inside the seed must be refused, naming it — cpSync would otherwise copy it straight into a ' +
      'destination this run treats as a trusted git worktree',
  );
  assert.equal(
    existsSync(join(root, 'projects', 'story-s8')),
    false,
    'a refused provision must write nothing — not even a partially-copied seed',
  );
});

/**
 * The SAME shape, but hermetic — the target is fully controlled by this test
 * and GUARANTEED readable end-to-end, so the refusal cannot be confused with
 * `/etc` happening to contain a subdirectory this user cannot read on THIS
 * particular host (the sibling test above throws today for exactly that
 * reason: `readdirSync(…, { recursive: true })` follows the symlink and
 * fails trying to recurse into `/etc/credstore`, an ACCIDENT of this host's
 * `/etc`, not a deliberate refusal of the symlink itself — the same generic
 * "could not list" catch, coincidentally triggered).
 *
 * Measured against today's code with a fully readable target: the recursive
 * readdir follows the symlink and lists its target's OWN files as "seed
 * files"; `cpSync` then COPIES them into the destination — a write has
 * already happened — and only THEN does `git add` itself refuse
 * (`fatal: pathspec '…' is beyond a symbolic link`), caught by
 * `provisionFixtureGround`'s own self-cleanup. The end state looks clean,
 * but "refuses before writing anything" was never true for this case; git's
 * own safety net did the refusing, one step too late. This is the test that
 * actually pins the refusal: it is RED until a DEDICATED pre-write check
 * exists, independent of both the readdir catch and git's own pathspec
 * refusal.
 */
test('provisioning refuses a seed containing a non-regular entry (a symlink to a FULLY READABLE target), naming the path — never relying on git\'s own incidental refusal', () => {
  const root = scratch();
  const seedDir = seedFixture(root);
  const readableTarget = join(root, 'readable-target');
  mkdirSync(readableTarget, { recursive: true });
  writeFileSync(join(readableTarget, 'harmless.txt'), 'nothing dangerous here\n');
  symlinkSync(readableTarget, join(seedDir, 'evil'));

  assert.throws(
    () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
    (err: unknown) => {
      const message = String((err as Error)?.message ?? err);
      assert.match(message, /evil/, `expected the refusal to name 'evil', got: ${message}`);
      assert.doesNotMatch(
        message,
        /beyond a symbolic link|git add exited/,
        'the refusal must be OUR OWN pre-write validation, never git\'s own incidental safety net encountered ' +
          `after cpSync has already copied the symlinked content in. Got: ${message}`,
      );
      return true;
    },
  );
  assert.equal(
    existsSync(join(root, 'projects', 'story-s8')),
    false,
    'a refused provision must write nothing — not even a partially-copied seed',
  );
});
