/**
 * GUARD-LEVEL ACCEPTANCE TESTS for cli/materials-staging.ts's `stageMaterials`
 * (R6-04-F2 WI-1, round 2 — spawner-directed pin).
 *
 * NEW MODULE — cli/materials-staging.ts does not exist at HEAD, so importing
 * `stageMaterials` below is itself part of this file's RED proof (a genuine
 * "feature not implemented yet" red).
 *
 * WHY THIS FILE EXISTS: cli/ui-bridge-agent-run-materials.test.ts (this WI's
 * route-level acceptance tests) honestly disclosed that three containment
 * shapes — a pre-existing directory symlink at `<runDir>/materials`, a
 * pre-existing file symlink at `<runDir>/materials/notes.md`, and a
 * pre-existing hardlink at the same leaf — are NOT wire-reachable through
 * `POST /api/agents/:slug/run`: that route always mints a fresh, unpredictable
 * `runId` server-side (`_agent-<slug>-<ISO-timestamp>-<4-char-random>`), so a
 * black-box HTTP caller can never know the run directory's name before the
 * very request that both creates and writes into it — there is no way to
 * plant a symlink/hardlink at that exact future path in advance.
 *
 * `stageMaterials(runDir, entries)` is the focused write-path the route's
 * materials handling is expected to call. Factoring it into its own module
 * makes the three shapes testable at all: HERE, this file fully controls
 * `runDir` (a temp directory it creates itself, synchronously, before ever
 * calling the function under test), so planting a symlink/hardlink at the
 * exact path `stageMaterials` is about to write through is straightforward.
 *
 * HONEST FRAMING (restated per the round-2 ruling, kept here deliberately):
 * the shape pinned by this file is NOT wire-reachable through the live route
 * today. The precondition that WOULD make it live is a route accepting (or
 * reusing) a caller-supplied run/session identifier for the materials
 * target — this WI's route does not do that.
 *
 * Assumed signature (per the round-2 spawner ruling):
 *   stageMaterials(runDir: string, entries: ReadonlyArray<{filename: string; bytes: Buffer}>): void
 * Refusal is assumed to be signalled by throwing (the codebase's established
 * pattern — see parseMaterials, resolveDispatchableAgent — for a function
 * with no separate result/error channel). No test here asserts a SPECIFIC
 * error message for these three shapes (unlike the route-level gate/kind
 * messages, no wording was specified for this internal function) — only that
 * it throws, and that nothing partial lands on disk either way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync,
  symlinkSync, linkSync, lstatSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stageMaterials, MaterialsStagingError } from '../../materials-staging.ts';

function freshRunDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `materials-staging-${prefix}-`));
}

function freshOutsideDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `materials-staging-outside-${prefix}-`));
}

// =============================================================================
// Positive controls — proves refusal tests below aren't just "always throws".
// =============================================================================

test('POSITIVE CONTROL: a fresh runDir (materials/ does not exist yet) — stageMaterials creates it and writes the entry byte-exact, without throwing', () => {
  const runDir = freshRunDir('fresh');
  try {
    const bytes = Buffer.from('MATERIALS-STAGING-POSITIVE-CONTROL-A');
    assert.doesNotThrow(() => stageMaterials(runDir, [{ filename: 'evidence.png', bytes }]));
    const target = join(runDir, 'materials', 'evidence.png');
    assert.ok(existsSync(target), `expected ${target} to exist after a legitimate stage`);
    assert.deepEqual(readFileSync(target), bytes, 'staged content must be byte-exact');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: materials/ already exists as a REAL directory with an unrelated file in it — stageMaterials adds the new entry without disturbing the existing one', () => {
  const runDir = freshRunDir('existing-dir');
  try {
    mkdirSync(join(runDir, 'materials'), { recursive: true });
    writeFileSync(join(runDir, 'materials', 'existing.txt'), 'PRE-EXISTING-SIBLING-CONTENT');

    const bytes = Buffer.from('MATERIALS-STAGING-POSITIVE-CONTROL-B');
    assert.doesNotThrow(() => stageMaterials(runDir, [{ filename: 'new.png', bytes }]));

    assert.deepEqual(readFileSync(join(runDir, 'materials', 'new.png')), bytes);
    assert.equal(readFileSync(join(runDir, 'materials', 'existing.txt'), 'utf8'), 'PRE-EXISTING-SIBLING-CONTENT', 'an unrelated pre-existing sibling file must survive untouched');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: multiple legitimate entries in one call are all written byte-exact', () => {
  const runDir = freshRunDir('multi');
  try {
    const bytesA = Buffer.from('MULTI-A');
    const bytesB = Buffer.from('MULTI-B');
    assert.doesNotThrow(() => stageMaterials(runDir, [
      { filename: 'a.png', bytes: bytesA },
      { filename: 'b.mp3', bytes: bytesB },
    ]));
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'a.png')), bytesA);
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'b.mp3')), bytesB);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Containment shape 1 — directory symlink at <runDir>/materials
// =============================================================================

test('CONTAINMENT: <runDir>/materials pre-planted as a DIRECTORY SYMLINK pointing outside runDir — refused, outside directory left untouched', () => {
  const runDir = freshRunDir('dirsymlink');
  const outsideDir = freshOutsideDir('dirsymlink');
  try {
    writeFileSync(join(outsideDir, 'secret.txt'), 'ORIGINAL-OUTSIDE-DIR-CONTENT');
    symlinkSync(outsideDir, join(runDir, 'materials'), 'dir');

    // Arrange-step self-check — the escape target must genuinely be a
    // symlink, or the rest of this test would pass vacuously.
    assert.ok(lstatSync(join(runDir, 'materials')).isSymbolicLink(), 'arrange-step failed: <runDir>/materials is not actually a symlink');

    assert.throws(() => stageMaterials(runDir, [{ filename: 'evidence.png', bytes: Buffer.from('ATTACK') }]), MaterialsStagingError);

    assert.equal(readFileSync(join(outsideDir, 'secret.txt'), 'utf8'), 'ORIGINAL-OUTSIDE-DIR-CONTENT', 'the outside directory\'s pre-existing file must be byte-unchanged');
    assert.equal(existsSync(join(outsideDir, 'evidence.png')), false, 'no new file may appear in the directory the symlink points to');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Containment shape 2 — file symlink at <runDir>/materials/notes.md
// =============================================================================

test('CONTAINMENT: <runDir>/materials/notes.md pre-planted as a FILE SYMLINK to an outside file (materials/ itself a real directory) — refused, outside file left untouched', () => {
  const runDir = freshRunDir('filesymlink');
  const outsideDir = freshOutsideDir('filesymlink');
  try {
    mkdirSync(join(runDir, 'materials'), { recursive: true });
    const outsideFile = join(outsideDir, 'target.md');
    writeFileSync(outsideFile, 'ORIGINAL-OUTSIDE-FILE-CONTENT');
    symlinkSync(outsideFile, join(runDir, 'materials', 'notes.md'));

    assert.ok(lstatSync(join(runDir, 'materials', 'notes.md')).isSymbolicLink(), 'arrange-step failed: notes.md is not actually a symlink');

    assert.throws(() => stageMaterials(runDir, [{ filename: 'notes.md', bytes: Buffer.from('ATTACK') }]), MaterialsStagingError);

    assert.equal(readFileSync(outsideFile, 'utf8'), 'ORIGINAL-OUTSIDE-FILE-CONTENT', 'the outside file must be byte-unchanged after a refused write through a file symlink');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Containment shape 3 — hardlink at <runDir>/materials/notes.md
// =============================================================================

test('CONTAINMENT: <runDir>/materials/notes.md pre-planted as a HARDLINK (nlink>1) to an outside file — refused, outside file left untouched (realpath is structurally blind to this; only an nlink===1 check catches it)', () => {
  const runDir = freshRunDir('hardlink');
  const outsideDir = freshOutsideDir('hardlink');
  try {
    mkdirSync(join(runDir, 'materials'), { recursive: true });
    const outsideFile = join(outsideDir, 'target.md');
    writeFileSync(outsideFile, 'ORIGINAL-OUTSIDE-HARDLINK-CONTENT');
    linkSync(outsideFile, join(runDir, 'materials', 'notes.md'));

    // Arrange-step self-check: prove the link genuinely shares an inode
    // (nlink > 1) for this filesystem/process — without this, a filesystem
    // that silently copy-on-linked (unusual, but not asserted away) would
    // make the rest of this test pass vacuously rather than for the right
    // reason.
    const st = lstatSync(join(runDir, 'materials', 'notes.md'));
    assert.ok(st.nlink > 1, `arrange-step failed: expected nlink > 1 on the hardlinked leaf, got ${st.nlink} — linkSync may not have produced a genuine hardlink on this filesystem`);

    // The matcher must be the ERROR CLASS, not a string: `assert.throws(fn,
    // '<text>')` treats the string as the failure MESSAGE, so it asserts only
    // "threw something" — which is exactly what this case must not settle for.
    // A naive realpath-only containment check is structurally blind to a
    // hardlink (there is no symlink anywhere to resolve), so this is the test
    // that FORCES an nlink===1 check to exist; it has to hold the real error.
    assert.throws(
      () => stageMaterials(runDir, [{ filename: 'notes.md', bytes: Buffer.from('ATTACK-VIA-SHARED-INODE') }]),
      MaterialsStagingError,
    );

    assert.equal(readFileSync(outsideFile, 'utf8'), 'ORIGINAL-OUTSIDE-HARDLINK-CONTENT', 'the outside file (sharing an inode with the hardlinked leaf) must be byte-unchanged — a write through the leaf would corrupt it via the shared inode even without following any symlink');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Atomicity — a refusal anywhere in the call must leave NOTHING partially
// written, including entries that individually would have been fine.
// =============================================================================

test('ATOMICITY: one legitimate entry + one entry hitting a containment trap in the SAME call — the whole call is refused, and the legitimate entry is NOT left on disk either (no partial write)', () => {
  const runDir = freshRunDir('atomicity');
  const outsideDir = freshOutsideDir('atomicity');
  try {
    mkdirSync(join(runDir, 'materials'), { recursive: true });
    const outsideFile = join(outsideDir, 'target.md');
    writeFileSync(outsideFile, 'ORIGINAL-ATOMICITY-OUTSIDE-CONTENT');
    symlinkSync(outsideFile, join(runDir, 'materials', 'trap.md'));

    assert.throws(() => stageMaterials(runDir, [
      { filename: 'legitimate.png', bytes: Buffer.from('SHOULD-NEVER-LAND') },
      { filename: 'trap.md', bytes: Buffer.from('ATTACK') },
    ]), MaterialsStagingError);

    assert.equal(existsSync(join(runDir, 'materials', 'legitimate.png')), false, 'a call that is refused overall must not leave an EARLIER, individually-legitimate entry written to disk — all-or-nothing, not partial');
    assert.equal(readFileSync(outsideFile, 'utf8'), 'ORIGINAL-ATOMICITY-OUTSIDE-CONTENT', 'the outside file must remain byte-unchanged');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Negative space, generalized across all three containment tests above: after
// ANY refusal, <runDir>/materials must hold nothing beyond what pre-existed.
// =============================================================================

test('NEGATIVE SPACE: after a refused file-symlink write, <runDir>/materials contains exactly the pre-existing symlink entry and nothing else', () => {
  const runDir = freshRunDir('negspace');
  const outsideDir = freshOutsideDir('negspace');
  try {
    mkdirSync(join(runDir, 'materials'), { recursive: true });
    const outsideFile = join(outsideDir, 'target.md');
    writeFileSync(outsideFile, 'ORIGINAL-NEGSPACE-CONTENT');
    symlinkSync(outsideFile, join(runDir, 'materials', 'notes.md'));

    assert.throws(() => stageMaterials(runDir, [{ filename: 'notes.md', bytes: Buffer.from('ATTACK') }]), MaterialsStagingError);

    const entries = readdirSync(join(runDir, 'materials'));
    assert.deepEqual(entries, ['notes.md'], `expected only the pre-existing "notes.md" entry to remain — got ${JSON.stringify(entries)} (a stray temp/partial file would indicate a non-atomic write)`);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// R6-04-F2 ROUND 3 amendment 2 — stageMaterials must refuse duplicate targets
// ITSELF, not trust the route to have deduped. `[exec]`-confirmed by review:
// calling stageMaterials directly with two entries sharing one filename does
// NOT throw today — Phase 1 has zero side effects, so each entry's
// resolveGuardedPath call succeeds independently (neither sees the other),
// and Phase 2 then writes both, the SECOND silently clobbering the first.
// This is a guard-symmetry gap: the module's own docstring promises "ZERO
// partial writes on refusal", but a silent full overwrite is a different,
// undocumented, unguarded failure mode — a full write is not a partial one.
// The route happens to dedupe today (cli/ui-bridge.ts's
// validateMaterialsField, contract point 8), but "the caller already checks
// this" is exactly the guard-symmetry gap this codebase just closed for
// isSafeRunId — the module must not trust its caller.
// =============================================================================

test('DUPLICATE TARGET: two entries with the SAME filename in one stageMaterials call throws MaterialsStagingError, and writes NOTHING (not even one copy) — kills the current silent-clobber behaviour (confirmed live: today this does not throw at all)', () => {
  const runDir = freshRunDir('dup-adjacent');
  try {
    assert.throws(
      () => stageMaterials(runDir, [
        { filename: 'dup.txt', bytes: Buffer.from('FIRST-VERSION') },
        { filename: 'dup.txt', bytes: Buffer.from('SECOND-VERSION-WOULD-SILENTLY-WIN') },
      ]),
      MaterialsStagingError,
      'expected a MaterialsStagingError for a duplicate target filename within one call',
    );
    assert.equal(existsSync(join(runDir, 'materials', 'dup.txt')), false, 'NEITHER version may land on disk — this is a refusal, not "last write wins"');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('DUPLICATE TARGET: a duplicate that is NOT adjacent (entries 1 and 3 of 3) is still caught — kills an implementation that only compares consecutive entries', () => {
  const runDir = freshRunDir('dup-nonadjacent');
  try {
    assert.throws(
      () => stageMaterials(runDir, [
        { filename: 'a.png', bytes: Buffer.from('A') },
        { filename: 'b.png', bytes: Buffer.from('B') },
        { filename: 'a.png', bytes: Buffer.from('A-AGAIN') },
      ]),
      MaterialsStagingError,
    );
    assert.equal(existsSync(join(runDir, 'materials')), false, 'the whole call must be refused before ANY entry is written — including the non-duplicate "b.png" — all-or-nothing, matching the existing atomicity contract');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('DUPLICATE TARGET: a duplicate against an ALREADY-STAGED file from a PRIOR call is not itself required to throw (this pins the boundary precisely: the guard is WITHIN one call\'s entries, matching the route\'s own contract point 8 wording "duplicate filename in one request") — but the prior file must survive byte-unchanged if the second call also fails for its own reasons, and must be legitimately overwritten if the second call is independently valid (re-staging the same filename is a normal edit, not an attack)', () => {
  const runDir = freshRunDir('dup-across-calls');
  try {
    assert.doesNotThrow(() => stageMaterials(runDir, [{ filename: 'a.png', bytes: Buffer.from('FIRST-CALL') }]));
    assert.doesNotThrow(() => stageMaterials(runDir, [{ filename: 'a.png', bytes: Buffer.from('SECOND-CALL-LEGITIMATE-RE-STAGE') }]));
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'a.png')), Buffer.from('SECOND-CALL-LEGITIMATE-RE-STAGE'), 'a second, independent call re-staging the same filename is an ordinary edit — the WITHIN-one-call guard must not be widened into a cross-call guard that would make a run\'s materials write-once');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
