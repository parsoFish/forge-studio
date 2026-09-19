/**
 * fixture-ground-fix1.test.ts — two `fixture-ground.mjs` exports
 * (`realGroundFenceVerdict`, `provisionFixtureGrounds`), in their own file
 * rather than appended to `fixture-ground.test.ts` — the
 * `story-file-fixture.test.ts` precedent, cut by SUBJECT. They were pinned
 * before they existed, and a static import of a name the module does not
 * export fails at LINK time, taking every test in the file down with it; a
 * separate file kept `fixture-ground.test.ts` from being collaterally red.
 *
 * `realGroundFenceVerdict` exists because no test covered the requirement
 * that actually makes a fixture run's containment escape RED: deleting the
 * inline `return 1` block in `run-story.mjs`, its unconditional summary line,
 * or the `keepProjects` spread that keeps the fence's own subject alive long
 * enough to be judged all kept every pinned test green. A hand-rolled inline
 * check has no seam a test can hold; a pure function does.
 *
 * `provisionFixtureGrounds` exists because the batch had no atomicity:
 * `run.mjs`'s loop provisioned every fixture story regardless of an earlier
 * refusal, and nothing tore down what a refusal-after-provisioning had
 * already written. "A refusal here writes nothing" was true for ONE story and
 * false for a batch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { realGroundFenceVerdict, provisionFixtureGrounds } from './fixture-ground.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fixture-ground-fix1-'));

// ── realGroundFenceVerdict(before, after) ──────────────────────────────────
//
// `-> frozen { ok, moved, unreadable, hashed, trees, summary }`: `moved` =
// the grounds that appeared, vanished or changed; `unreadable` = the listed
// dirs with a null digest; `hashed` = dirs in `before` with a NON-null digest
// (so a ground `groundManifest` could not read never inflates the count);
// `trees` = distinct `<tree>` roots among the keys, a key being
// `<tree>/projects/<name>`; `ok` = nothing moved and nothing unreadable;
// `summary` is the exact sentence the run logs.

test('realGroundFenceVerdict: unchanged grounds are ok, with a summary naming 0 moved and 0 unreadable', () => {
  const before = new Map([
    [join('/root', 'projects', 'gitpulse'), 'abc123'],
    [join('/root', 'projects', 'mdtoc'), 'def456'],
  ]);
  const after = new Map(before);

  const v = realGroundFenceVerdict(before, after);
  assert.equal(v.ok, true);
  assert.deepEqual(v.moved, []);
  assert.deepEqual(v.unreadable, []);
  assert.equal(v.hashed, 2);
  assert.equal(v.trees, 1);
  assert.equal(v.summary, 'real grounds: 2 hashed in 1 tree(s), 0 moved, 0 unreadable');
  assert.ok(Object.isFrozen(v), 'the verdict is frozen — nothing downstream can edit the record that gates the run');
});

test('realGroundFenceVerdict: one MODIFIED ground is NOT ok, and moved names it', () => {
  const dir = join('/root', 'projects', 'gitpulse');
  const before = new Map([[dir, 'abc123']]);
  const after = new Map([[dir, 'zzz999']]);

  const v = realGroundFenceVerdict(before, after);
  assert.equal(v.ok, false, 'a moved real ground must never read as ok');
  assert.equal(v.moved.length, 1);
  assert.ok(v.moved[0].includes(dir), `expected the moved line to name ${dir}. Got: ${v.moved[0]}`);
  assert.match(v.summary, /1 moved/, v.summary);
});

/**
 * `realGroundFenceVerdict` must never call an UNHASHABLE real ground clean.
 * `hashed`'s own exclusion of a null-digest dir only kept the COUNT honest; it said nothing
 * about `ok`, which was once driven by `moved.length === 0`
 * alone — so a real ground `groundManifest` could not read at all (an
 * unreadable file, output past the 64 MiB bound, a broken mount) compared
 * `null` against `null` on both sides of `realGroundEscapes`, produced NO
 * `moved` line, and the run sailed through believing the fence had looked.
 * `unreadable` names every dir a snapshot LISTED (so it was meant to be
 * fenced) but could not hash; `ok` is now false on EITHER `moved.length > 0`
 * OR `unreadable.length > 0`.
 */
test('realGroundFenceVerdict: a dir with a NULL digest in `before` is excluded from `hashed`, reported in `unreadable`, and alone makes `ok` false', () => {
  const hashedDir = join('/root', 'projects', 'gitpulse');
  const unreadableDir = join('/root', 'projects', 'mdtoc');
  const before = new Map([[hashedDir, 'abc123'], [unreadableDir, null]]);
  const after = new Map(before);

  const v = realGroundFenceVerdict(before, after);
  assert.equal(v.hashed, 1, 'a null-digest dir must not count toward hashed');
  assert.equal(v.trees, 1);
  assert.deepEqual(v.unreadable, [unreadableDir], 'a dir before LISTED with a null digest is unreadable, named');
  assert.equal(v.moved.length, 0, 'the ground did not MOVE — it was simply never readable, a different fact');
  assert.equal(
    v.ok,
    false,
    'realGroundFenceVerdict must never call an unhashable real ground clean, even with moved.length === 0',
  );
  assert.equal(v.summary, 'real grounds: 1 hashed in 1 tree(s), 0 moved, 1 unreadable');
});

test('realGroundFenceVerdict: trees counts DISTINCT <tree> roots among the keys, not the number of dirs', () => {
  const before = new Map([
    [join('/root', 'projects', 'gitpulse'), 'a'],
    [join('/root', 'projects', 'mdtoc'), 'b'],
    [join('/tree2', 'projects', 'gitweave'), 'c'],
  ]);
  const after = new Map(before);

  const v = realGroundFenceVerdict(before, after);
  assert.equal(v.hashed, 3);
  assert.equal(v.trees, 2, 'two roots — /root and /tree2 — must count as 2, never as 3 (one per dir)');
  assert.equal(v.summary, 'real grounds: 3 hashed in 2 tree(s), 0 moved, 0 unreadable');
});

// ── provisionFixtureGrounds(root, stories) ─────────────────────────────────
//
// `-> frozen { provisioned: Array<{storyId, project, digest, commit}>, refused:
// {storyId, message} | null }`. Provisions IN ORDER, STOPS at the first
// refusal, and on a refusal tears down every ground it ALREADY provisioned in
// THIS call — "a refusal here writes nothing" restated at the batch's own
// level, not just a single story's.

test('provisionFixtureGrounds stops at the first refusal and tears down everything it already provisioned in this call', () => {
  const root = scratch();

  // The FIRST story's seed is entirely valid.
  const goodSeedDir = join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'seed');
  mkdirSync(goodSeedDir, { recursive: true });
  writeFileSync(join(goodSeedDir, 'README.md'), '# demo seed\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'PROVENANCE.md'), '# provenance\n');

  // The SECOND story's seed deliberately has no PROVENANCE.md.
  const badSeedDir = join(root, 'tests', 'stories', 'grounds', 'no-provenance', 'seed');
  mkdirSync(badSeedDir, { recursive: true });
  writeFileSync(join(badSeedDir, 'README.md'), '# x\n');

  const stories = [
    { id: 'S8', ground: { project: 'story-s8', fixture: 'demo-seed' } },
    { id: 'S9', ground: { project: 'story-s9', fixture: 'no-provenance' } },
  ];

  const result = provisionFixtureGrounds(root, stories);

  assert.deepEqual(result.provisioned, [], 'nothing survives a refusal anywhere in the batch');
  assert.ok(result.refused !== null, 'the batch must report which story refused');
  assert.equal(result.refused.storyId, 'S9', 'the refusal must name the SECOND story — the one that actually failed');
  assert.match(result.refused.message, /PROVENANCE\.md/, result.refused.message);
  assert.equal(
    existsSync(join(root, 'projects', 'story-s8')),
    false,
    "the FIRST story's ground — already provisioned before the second refused — must be torn down too",
  );
  assert.ok(Object.isFrozen(result), 'the batch result is frozen');
});

test('provisionFixtureGrounds: rollbackFailures is empty on a clean rollback', () => {
  // The SAME two-story refusal as above, unmodified — the default, common
  // case, pinned so the field's ABSENCE of failures is as much a contract as
  // its presence.
  const root = scratch();
  const goodSeedDir = join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'seed');
  mkdirSync(goodSeedDir, { recursive: true });
  writeFileSync(join(goodSeedDir, 'README.md'), '# demo seed\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'PROVENANCE.md'), '# provenance\n');
  const badSeedDir = join(root, 'tests', 'stories', 'grounds', 'no-provenance', 'seed');
  mkdirSync(badSeedDir, { recursive: true });
  writeFileSync(join(badSeedDir, 'README.md'), '# x\n');

  const stories = [
    { id: 'S8', ground: { project: 'story-s8', fixture: 'demo-seed' } },
    { id: 'S9', ground: { project: 'story-s9', fixture: 'no-provenance' } },
  ];
  const result = provisionFixtureGrounds(root, stories) as any;
  assert.deepEqual(result.rollbackFailures, []);
});

/**
 * A rollback that could not undo its own write must NAME it, not swallow it. `provisionFixtureGrounds`'s rollback loop
 * today calls `teardownFixtureGround` for each already-provisioned entry and
 * discards the result entirely — a `try { teardownFixtureGround(...) } catch
 * {}` that never even reads the return value, so a failed removal leaves a
 * ground neither the caller nor `run.mjs`'s abort backstop knows about, and
 * nothing is printed.
 *
 * FORCING A REAL REMOVAL FAILURE, DETERMINISTICALLY, WITH NO TIMING WINDOW.
 * `provisionFixtureGrounds` is fully synchronous (`spawnSync` throughout, no
 * `await` anywhere in it) — there is no point at which a test running
 * alongside it can act BETWEEN the first story succeeding and the second
 * failing, so `chmod`ing `projects/` from OUTSIDE the call cannot land in
 * that narrow window without a race. Instead, the FIRST story's OWN SEED
 * carries a hand-written `.git/hooks/post-commit` hook (`chmod 555
 * "$(dirname "$(pwd)")"`). `cpSync` copies it into the fresh git repo before
 * `git init` reinitialises that same `.git` in place (preserving, not
 * replacing, an existing `hooks/`), and `--no-verify` does not suppress
 * `post-commit` (only `pre-commit`/`commit-msg`). So the chmod runs
 * SYNCHRONOUSLY, inside the SAME `git commit` child process the real
 * `provisionFixtureGround` already spawns for the first story — deterministic
 * by construction, not by timing luck. Verified directly against the real
 * `provisionFixtureGround`/`teardownFixtureGround` before writing this test:
 * provisioning still succeeds (the digest check excludes `.git/*`, so the
 * hook is invisible to it), and a subsequent teardown then fails with
 * `EACCES: permission denied, rmdir '.../projects/story-s8'`.
 */
test('provisionFixtureGrounds: rollbackFailures NAMES a teardown it could not undo, rather than swallowing it', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root — permission bits are not enforced, so the forced EACCES never occurs');
    return;
  }
  const root = scratch();

  // The FIRST story's seed: valid, PLUS the post-commit hook that locks
  // `projects/` the instant its own provisioning finishes.
  const goodSeedDir = join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'seed');
  mkdirSync(join(goodSeedDir, '.git', 'hooks'), { recursive: true });
  writeFileSync(
    join(goodSeedDir, '.git', 'hooks', 'post-commit'),
    '#!/bin/sh\nchmod 555 "$(dirname "$(pwd)")"\n',
    { mode: 0o755 },
  );
  writeFileSync(join(goodSeedDir, 'README.md'), '# demo seed\n');
  writeFileSync(join(root, 'tests', 'stories', 'grounds', 'demo-seed', 'PROVENANCE.md'), '# provenance\n');

  // The SECOND story's seed: deliberately missing PROVENANCE.md, so it
  // refuses AFTER the first has already succeeded and locked projects/.
  const badSeedDir = join(root, 'tests', 'stories', 'grounds', 'no-provenance', 'seed');
  mkdirSync(badSeedDir, { recursive: true });
  writeFileSync(join(badSeedDir, 'README.md'), '# x\n');

  const stories = [
    { id: 'S8', ground: { project: 'story-s8', fixture: 'demo-seed' } },
    { id: 'S9', ground: { project: 'story-s9', fixture: 'no-provenance' } },
  ];

  try {
    const result = provisionFixtureGrounds(root, stories) as any;

    assert.ok(result.refused !== null, 'S9 must still refuse — this test is about the RESULTING rollback, not S9 itself');
    assert.equal(
      existsSync(join(root, 'projects', 'story-s8')),
      true,
      'the rollback of story-s8 must have FAILED (projects/ is locked) — if this is false, the hook did not ' +
        'fire before the rollback attempt and the test is not exercising what it claims to',
    );
    assert.ok(Array.isArray(result.rollbackFailures), 'provisionFixtureGrounds never returns a rollbackFailures array — a failed rollback is still swallowed silently');
    assert.equal(result.rollbackFailures.length, 1, `expected exactly one rollback failure. Got: ${JSON.stringify(result.rollbackFailures)}`);
    assert.equal(result.rollbackFailures[0].project, 'story-s8', JSON.stringify(result.rollbackFailures[0]));
    assert.match(
      String(result.rollbackFailures[0].error),
      /EACCES|permission denied/i,
      `expected a named permission error, got: ${JSON.stringify(result.rollbackFailures[0])}`,
    );
  } finally {
    // Unlock before the harness's own temp-dir cleanup runs.
    chmodSync(join(root, 'projects'), 0o755);
  }
});
