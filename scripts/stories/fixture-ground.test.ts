/**
 * fixture-ground.test.ts — acceptance tests for `scripts/stories/fixture-ground.mjs`,
 * pinned BEFORE it exists (M7-D, D1).
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
 * and timestamp so the commit is a pure function of the seed's tree, not of
 * when or by whom it was made.
 *
 * `realGroundDirs` / `snapshotRealGrounds` / `realGroundEscapes` are the other
 * side of the same coin: proof that provisioning and tearing down a FIXTURE
 * never touches a REAL ground, in this tree or a sibling worktree — the
 * `siblingGroundEscapes` idea in `ground-hash.mjs`, generalised to "every real
 * ground this story does not own", not just the one it declares.
 *
 * Every test below is expected RED right now: the module does not exist yet.
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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { groundManifest } from './ground-hash.mjs';
import {
  provisionFixtureGround,
  teardownFixtureGround,
  realGroundDirs,
  snapshotRealGrounds,
  realGroundEscapes,
} from './fixture-ground.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fixture-ground-'));

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
