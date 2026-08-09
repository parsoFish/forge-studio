/**
 * GUARD-LEVEL ACCEPTANCE TESTS for cli/skill-staging.ts's `stageSkillPackage`
 * (SEC-05 q80, d1 — the RULED inline-upload folded staging path).
 *
 * NEW MODULE — cli/skill-staging.ts does not exist at branch base. To keep this
 * file COLLECTING (so each AT reports its OWN per-test red rather than one
 * import-time collection failure), the module is loaded through a guarded
 * dynamic `import()` inside each test (`loadStaging()` below). At base every
 * test therefore fails with ERR_MODULE_NOT_FOUND at that `await` — an honest
 * "feature not implemented yet" red, one per assertion group; once the verbatim
 * mirror of cli/materials-staging.ts lands, each passes for its own reason.
 * (`npm run build`/tsc is separately red at base for the same missing module —
 * expected TDD-first, greens when the impl lands.)
 *
 * WHY THIS FILE EXISTS (mirrors cli/materials-staging.test.ts's framing):
 * `stageSkillPackage(stagingRoot, sourceId, entries)` is the focused write-path
 * the ruled `POST /api/studio/skills/install` fix calls — it stages each
 * inline-uploaded `{ path, contentBase64 }` entry under
 * `<stagingRoot>/<sourceId>/` through the shared realpath containment guard
 * (cli/studio-path-guard.ts's `resolveGuardedPath`), returns the staged dir's
 * realpath for `installSkillPackage` to copy, and is rm'd by the route in a
 * `finally`. The symlink-at-`<sourceId>` shape below is NOT wire-reachable
 * through the live route (the route mints its own unpredictable server-derived
 * sourceId, so a black-box caller cannot plant a symlink at that exact future
 * path in advance) — but factoring the write-path into its own module makes the
 * shape testable HERE, where this file fully controls `stagingRoot` + `sourceId`.
 *
 * CONTRACT under test (the verbatim mirror of `stageMaterials`):
 *   stageSkillPackage(
 *     stagingRoot: string, sourceId: string,
 *     entries: ReadonlyArray<{ path: string; contentBase64: string }>,
 *   ): string   // returns the staged <stagingRoot>/<sourceId> realpath
 *   Phase 1 resolves EVERY entry through
 *     resolveGuardedPath(stagingRoot, [sourceId, ...entry.path.split('/')])
 *   with zero side effects, refusing on the first `!ok` AND on a duplicate
 *   resolved realPath; only then does Phase 2 write each
 *   `Buffer.from(contentBase64, 'base64')`. Refusal throws `SkillStagingError`
 *   (the mirror of `MaterialsStagingError`) — no separate error channel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync,
  symlinkSync, lstatSync, realpathSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type SkillEntry = { path: string; contentBase64: string };
type StageFn = (stagingRoot: string, sourceId: string, entries: ReadonlyArray<SkillEntry>) => string;
type ErrCtor = new (...args: unknown[]) => Error;

/**
 * Guarded dynamic import — keeps the file collectible so each test reports its
 * OWN red (a static `import` of the absent module would fail the whole file at
 * collection). At base this rejects with ERR_MODULE_NOT_FOUND; on the candidate
 * it resolves the verbatim mirror. Cast through `unknown` so the module's
 * not-yet-existing type never blocks this file's own type-check.
 */
async function loadStaging(): Promise<{ stageSkillPackage: StageFn; SkillStagingError: ErrCtor }> {
  const mod = await import('./skill-staging.ts');
  return mod as unknown as { stageSkillPackage: StageFn; SkillStagingError: ErrCtor };
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

function freshStagingRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `skill-staging-${prefix}-`));
}
function freshOutsideDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `skill-staging-outside-${prefix}-`));
}

// A well-formed server-minted sourceId (isSafeSegment-clean); the real route
// mints its own — this file exercises the write-path directly.
const SOURCE_ID = 'srv-stamp-1';

// =============================================================================
// POSITIVE CONTROL (the VALID case) — proves the refusal tests below aren't
// just "always throws", and proves the guard does not over-reject valid input.
// =============================================================================

test('POSITIVE CONTROL (VALID): stageSkillPackage writes every entry under <stagingRoot>/<sourceId>/ byte-exact (nested path preserved) and returns that staged dir realpath', async () => {
  const { stageSkillPackage } = await loadStaging();
  const stagingRoot = freshStagingRoot('valid');
  try {
    const skillMd = 'name: Collector\ndescription: collects things\n---\n\n# Collector\n\nBody.\n';
    const script = '#!/bin/sh\necho collecting\n';

    const staged = stageSkillPackage(stagingRoot, SOURCE_ID, [
      { path: 'SKILL.md', contentBase64: b64(skillMd) },
      { path: 'scripts/collect.sh', contentBase64: b64(script) },
    ]);

    // Returns the staged <stagingRoot>/<sourceId> dir. realpath-normalised on
    // BOTH sides so this holds whether the impl returns a realpath or a plain
    // join, and across a symlinked tmpdir.
    assert.equal(
      realpathSync(staged),
      realpathSync(join(stagingRoot, SOURCE_ID)),
      'must return the <stagingRoot>/<sourceId> staged directory path',
    );
    // Both entries land under <sourceId>/, byte-exact, nested subdir created.
    assert.equal(readFileSync(join(stagingRoot, SOURCE_ID, 'SKILL.md'), 'utf8'), skillMd);
    assert.equal(readFileSync(join(stagingRoot, SOURCE_ID, 'scripts', 'collect.sh'), 'utf8'), script);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// TRAVERSAL entry paths — an entry.path that escapes <sourceId>/ must be
// REFUSED, with ZERO side effects. Kills a stage step that writes to
// join(stagingRoot, sourceId, entry.path) without a per-entry resolveGuardedPath.
// =============================================================================

test('TRAVERSAL: an entry.path escaping <sourceId>/ ("../evil", "/etc/x", "a/../../../../tmp/OUT/x") is REFUSED with SkillStagingError — the whole stage throws and NOTHING is written (kills a naive per-entry join)', async () => {
  const { stageSkillPackage, SkillStagingError } = await loadStaging();

  for (const evilPath of ['../evil', '/etc/x', 'a/../../../../tmp/OUT/x']) {
    const stagingRoot = freshStagingRoot('traversal');
    try {
      assert.throws(
        () => stageSkillPackage(stagingRoot, SOURCE_ID, [{ path: evilPath, contentBase64: b64('ATTACK') }]),
        SkillStagingError,
        `entry.path "${evilPath}" must be refused with SkillStagingError`,
      );

      // ARTIFACT (not just the throw): zero side effects. The <sourceId> dir is
      // never created — a correct impl rejects in phase 1 before any write; a
      // naive join(stagingRoot, sourceId, "/etc/x") would create it, so this
      // fails on that naive impl.
      assert.equal(
        existsSync(join(stagingRoot, SOURCE_ID)),
        false,
        `no <sourceId>/ dir may be created for a refused "${evilPath}" stage`,
      );
      // The specific out-of-<sourceId> target a naive join lands at for
      // "../evil" (== <stagingRoot>/evil, independent of sourceId) must be
      // byte-ABSENT.
      assert.equal(
        existsSync(join(stagingRoot, 'evil')),
        false,
        `nothing may be written to the out-of-<sourceId> sibling target for "${evilPath}"`,
      );
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
});

// =============================================================================
// SYMLINK pre-plant — <stagingRoot>/<sourceId> is a DIRECTORY SYMLINK pointing
// outside the staging root. Phase-1's per-segment IDENTITY check must reject it
// (realpath(<sourceId>) != its expected in-root location). Kills an impl that
// writes to join(stagingRoot, sourceId, ...) without resolveGuardedPath.
// =============================================================================

test('SYMLINK: <stagingRoot>/<sourceId> pre-planted as a DIRECTORY SYMLINK to an outside dir — phase-1 guard rejects (identity mismatch), nothing written THROUGH the link', async () => {
  const { stageSkillPackage, SkillStagingError } = await loadStaging();
  const stagingRoot = freshStagingRoot('symlink');
  const outsideDir = freshOutsideDir('symlink');
  try {
    writeFileSync(join(outsideDir, 'secret.txt'), 'ORIGINAL-OUTSIDE-CONTENT');
    symlinkSync(outsideDir, join(stagingRoot, SOURCE_ID), 'dir');

    // Precondition asserted BEFORE the verdict — the target must genuinely be a
    // symlink, else the containment assertions below pass vacuously.
    assert.ok(
      lstatSync(join(stagingRoot, SOURCE_ID)).isSymbolicLink(),
      'arrange-step failed: <stagingRoot>/<sourceId> is not actually a symlink',
    );

    assert.throws(
      () => stageSkillPackage(stagingRoot, SOURCE_ID, [{ path: 'SKILL.md', contentBase64: b64('ATTACK-THROUGH-SYMLINK') }]),
      SkillStagingError,
      'a symlinked <sourceId> escaping the staging root must be refused',
    );

    // ARTIFACT: nothing written through the link into the outside dir.
    assert.equal(
      readFileSync(join(outsideDir, 'secret.txt'), 'utf8'),
      'ORIGINAL-OUTSIDE-CONTENT',
      "the outside dir's pre-existing file must be byte-unchanged",
    );
    assert.equal(
      existsSync(join(outsideDir, 'SKILL.md')),
      false,
      'no file may be written through the symlink into the outside directory',
    );
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// =============================================================================
// PER-ELEMENT ISOLATION / atomicity — one valid entry + one bad entry in the
// SAME stage rejects the WHOLE stage, with no partial write. Kills a per-entry
// write-as-you-go loop (which would leave the individually-valid SKILL.md).
// =============================================================================

test('PER-ELEMENT ISOLATION: one valid entry + one traversal entry in the SAME stage → the whole call is refused and NEITHER lands (no partial write)', async () => {
  const { stageSkillPackage, SkillStagingError } = await loadStaging();
  const stagingRoot = freshStagingRoot('isolation');
  try {
    assert.throws(
      () => stageSkillPackage(stagingRoot, SOURCE_ID, [
        { path: 'SKILL.md', contentBase64: b64('name: X\ndescription: y\n---\n\nbody\n') },
        { path: '../evil', contentBase64: b64('ATTACK') },
      ]),
      SkillStagingError,
    );
    assert.equal(
      existsSync(join(stagingRoot, SOURCE_ID)),
      false,
      'the whole stage must be refused before ANY entry is written — the individually-valid SKILL.md must NOT be left behind',
    );
    assert.equal(existsSync(join(stagingRoot, 'evil')), false, 'the traversal sibling target must be byte-absent');
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// DUPLICATE TARGET — two entries resolving to the same path within one stage
// (mirrors stageMaterials' phase-1 dedup on resolved realPaths). Kills a
// phase-2 second-write silent clobber.
// =============================================================================

test('DUPLICATE TARGET: two entries with the SAME path in one stage → refused with SkillStagingError, nothing written (a refusal, not last-write-wins)', async () => {
  const { stageSkillPackage, SkillStagingError } = await loadStaging();
  const stagingRoot = freshStagingRoot('dup');
  try {
    assert.throws(
      () => stageSkillPackage(stagingRoot, SOURCE_ID, [
        { path: 'SKILL.md', contentBase64: b64('FIRST') },
        { path: 'SKILL.md', contentBase64: b64('SECOND-WOULD-SILENTLY-WIN') },
      ]),
      SkillStagingError,
    );
    assert.equal(
      existsSync(join(stagingRoot, SOURCE_ID, 'SKILL.md')),
      false,
      'neither copy may land on disk',
    );
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// CONTROL-CHAR / NUL entry paths (SEC-05 q80 extension — GAP 2 hardening). An
// entry.path segment carrying ANY C0 control char (0x00-0x1f) must be REFUSED by
// the module's OWN typed error (SkillStagingError), with ZERO side effects.
//
// Before the isSafeSegment hardening, `isSafeSegment` rejected only '/', '\\',
// sep, '.', '..', and the empty string — a control char slipped straight
// through. Because the route mints a FRESH sourceId, resolveGuardedPath's walk
// breaks into create-mode at that not-yet-existing sourceId and reassembles the
// (unchecked) leaf tail literally, returning {ok:true} for a control-char path
// (proven directly in studio-path-guard.test.ts's control-char unit). The two
// downstream failure modes this closes:
//   - NUL (0x00): stageSkillPackage's Phase-2 `writeFileSync` throws a RAW,
//     UNTYPED OS TypeError ("path must be ... without null bytes") — NOT the
//     module's SkillStagingError — and that OS message even LEAKS an absolute
//     filesystem path (violating this module's "names no absolute path" rule).
//   - other C0 controls (0x01/0x09/0x0a/0x1f): no throw at all — a
//     control-char-NAMED file is SILENTLY materialised on disk.
// Rejecting the segment in isSafeSegment is strictly MORE restrictive (no legit
// slug or fixed literal carries a control char), so the whole call fails closed
// in Phase 1 before any mkdir/write. RED today (TypeError for NUL, silent write
// for the rest); GREEN once isSafeSegment rejects the 0x00-0x1f range.
// =============================================================================

test('CONTROL-CHAR / NUL: an entry.path segment carrying any C0 control char (0x00 NUL / 0x01 / 0x09 / 0x0a / 0x1f) is REFUSED with the module\'s OWN SkillStagingError and NOTHING is written — not a raw OS TypeError (NUL) and not a silent control-char-named file (others)', async () => {
  const { stageSkillPackage, SkillStagingError } = await loadStaging();

  // Constructed via char codes so the test SOURCE carries no raw control bytes.
  const cases: ReadonlyArray<[string, number]> = [
    ['NUL(0x00)', 0], ['SOH(0x01)', 1], ['TAB(0x09)', 9], ['LF(0x0a)', 10], ['US(0x1f)', 31],
  ];

  for (const [label, code] of cases) {
    const evilPath = `a${String.fromCharCode(code)}b`;
    const stagingRoot = freshStagingRoot('ctrlchar');
    try {
      assert.throws(
        () => stageSkillPackage(stagingRoot, SOURCE_ID, [{ path: evilPath, contentBase64: b64('ATTACK') }]),
        // Predicate (not the class shorthand) so the discriminator is the ERROR
        // TYPE: today NUL throws a TypeError (fails this predicate → RED) and the
        // other controls throw nothing at all (assert.throws → RED). Only the
        // module's own typed error satisfies this.
        (err: unknown) => err instanceof SkillStagingError,
        `a control-char (${label}) entry.path must be refused with the module's OWN SkillStagingError — never a raw OS TypeError, never a silent write`,
      );
      // ARTIFACT: zero side effects — no <sourceId>/ dir, no control-char file.
      assert.equal(
        existsSync(join(stagingRoot, SOURCE_ID)),
        false,
        `no <sourceId>/ dir may be created for a refused control-char (${label}) stage`,
      );
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
});
