/**
 * VOLUME CASE-BEHAVIOUR DETECTION acceptance tests for
 * `cli/materials-staging.ts` (bead forge-qn8, P2).
 *
 * The defect: `stageMaterials`'s within-one-call duplicate-target guard
 * keys `seenTargets` by the LITERAL `realPath` string. On a case-folding
 * volume (macOS APFS default, Windows NTFS, some SMB/NTFS mounts — and this
 * matters because forge stages materials into operator-chosen project
 * dirs), two entries whose targets differ only by letter case (`Notes.md`,
 * `notes.md`) resolve to the SAME on-disk file, but the literal string
 * comparison sees two distinct keys, so the duplicate slips through Phase 1
 * and the second `writeFileSync` in Phase 2 silently clobbers the first.
 *
 * THE HONEST CONSTRAINT THIS FILE WORKS AROUND: this dev machine is
 * WSL2/ext4 — case-SENSITIVE — so the real bug cannot be reproduced by
 * writing two case-variant files and observing a real on-disk clobber; on
 * ext4, `Notes.md` and `notes.md` are always two distinct real files, full
 * stop. `stageMaterials` therefore accepts a THIRD, optional
 * `options.probeCaseFolding` parameter (a `CaseFoldingProbe`) — the
 * injectable seam that lets the folding CODE PATH be driven deterministically
 * regardless of the underlying disk. Injecting a probe only changes what
 * `stageMaterials`'s OWN dedupe-key logic believes about the volume; it does
 * not (and cannot, without reshaping the whole fs layer, which is out of
 * scope for this fix) make ext4 itself fold case. So the load-bearing
 * assertion in the FOLDING tests below is not "the disk physically
 * clobbered" (impossible to observe here) but "the ALL-OR-NOTHING refusal
 * fired BEFORE Phase 2 ever ran, so NEITHER spelling landed on disk at all"
 * — checked via `existsSync`/`readFileSync`, not merely `assert.throws`, so
 * the test cannot pass on the throw alone while secretly having written
 * something.
 *
 * The genuinely-real, un-injected default probe (`detectVolumeCaseFolding`)
 * IS exercised directly against a real temp dir on this real, case-sensitive
 * machine — the POSITIVE CONTROL below — proving the probe measures a real
 * filesystem property rather than always returning a canned answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, existsSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stageMaterials, MaterialsStagingError, detectVolumeCaseFolding } from '../../materials-staging.ts';
import type { CaseFoldingProbe } from '../../materials-staging.ts';

function freshRunDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `materials-staging-case-${prefix}-`));
}

// =============================================================================
// POSITIVE CONTROL — the REAL, un-injected default probe against a real
// temp dir on THIS machine (WSL2/ext4), asserting it correctly reports
// case-SENSITIVE. Without this, every other test in this file that injects
// a fake probe would prove nothing about whether the real probe actually
// measures anything.
// =============================================================================

test('POSITIVE CONTROL: the REAL detectVolumeCaseFolding probe reports case-SENSITIVE against a real temp dir on this (ext4) machine', () => {
  const dir = freshRunDir('real-probe');
  try {
    const folds = detectVolumeCaseFolding(dir);
    assert.equal(folds, false, 'ext4 (this dev machine) is case-sensitive — the real probe must say so, not assume it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: the REAL probe cleans up its own marker entry (no stray .forge-case-probe-* file left in the probed dir)', () => {
  const dir = freshRunDir('real-probe-cleanup');
  try {
    detectVolumeCaseFolding(dir);
    const leftover = readdirSync(dir);
    assert.deepEqual(leftover, [], `expected the probe to leave nothing behind, found: ${JSON.stringify(leftover)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// FOLDING BRANCH — injected probe forces `stageMaterials` to believe the
// volume folds case, deterministically exercising the branch this real
// ext4 machine cannot produce naturally.
// =============================================================================

const FORCE_FOLDS: CaseFoldingProbe = () => true;
const FORCE_SENSITIVE: CaseFoldingProbe = () => false;

test('FOLDING (injected): two entries differing only by case ("Notes.md", "notes.md") in ONE call are refused as duplicates when the probe reports folding', () => {
  const runDir = freshRunDir('folding-dup');
  try {
    assert.throws(
      () => stageMaterials(
        runDir,
        [
          { filename: 'Notes.md', bytes: Buffer.from('FIRST-VERSION') },
          { filename: 'notes.md', bytes: Buffer.from('SECOND-VERSION-WOULD-SILENTLY-WIN-ON-A-REAL-FOLDING-VOLUME') },
        ],
        { probeCaseFolding: FORCE_FOLDS },
      ),
      MaterialsStagingError,
      'expected a MaterialsStagingError once the probe reports this volume folds case',
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('FOLDING (injected): the artifact, not just the throw — after the folding-duplicate refusal above, NEITHER spelling (nor any other content) landed on disk', () => {
  const runDir = freshRunDir('folding-dup-artifact');
  try {
    assert.throws(() => stageMaterials(
      runDir,
      [
        { filename: 'Notes.md', bytes: Buffer.from('FIRST-VERSION') },
        { filename: 'notes.md', bytes: Buffer.from('SECOND-VERSION') },
      ],
      { probeCaseFolding: FORCE_FOLDS },
    ), MaterialsStagingError);

    // Zero partial/full writes: this call must be refused entirely BEFORE
    // Phase 2 ever runs, so neither literal spelling was ever written —
    // this is the artifact check that a bare `assert.throws` would miss (an
    // implementation that threw AFTER writing both would still pass a
    // throw-only test).
    assert.equal(existsSync(join(runDir, 'materials', 'Notes.md')), false, 'the first spelling must not exist on disk after a refused call');
    assert.equal(existsSync(join(runDir, 'materials', 'notes.md')), false, 'the second spelling must not exist on disk after a refused call');
    assert.equal(existsSync(join(runDir, 'materials')), false, 'materials/ itself must not have been created for an entirely-refused call');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('FOLDING (injected): a folding duplicate that is NOT adjacent (entries 1 and 3 of 3, case-flipped) is still caught', () => {
  const runDir = freshRunDir('folding-dup-nonadjacent');
  try {
    assert.throws(
      () => stageMaterials(
        runDir,
        [
          { filename: 'Report.PDF', bytes: Buffer.from('A') },
          { filename: 'other.txt', bytes: Buffer.from('B') },
          { filename: 'report.pdf', bytes: Buffer.from('A-AGAIN-DIFFERENT-CASE') },
        ],
        { probeCaseFolding: FORCE_FOLDS },
      ),
      MaterialsStagingError,
    );
    assert.equal(existsSync(join(runDir, 'materials')), false, 'the whole call must be refused before ANY entry lands, including the non-duplicate "other.txt"');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// =============================================================================
// NEGATIVE SPACE — the fix must NOT widen the guard into a false rejection
// on a genuinely case-sensitive volume. Two real, legitimately distinct
// files must both stage successfully.
// =============================================================================

test('NEGATIVE: on a case-SENSITIVE volume (forced via injection), "Notes.md" and "notes.md" are two legitimate distinct targets and BOTH stage successfully, byte-exact', () => {
  const runDir = freshRunDir('sensitive-both-ok');
  try {
    const bytesA = Buffer.from('CONTENT-FOR-UPPER-N');
    const bytesB = Buffer.from('CONTENT-FOR-LOWER-n');
    assert.doesNotThrow(() => stageMaterials(
      runDir,
      [
        { filename: 'Notes.md', bytes: bytesA },
        { filename: 'notes.md', bytes: bytesB },
      ],
      { probeCaseFolding: FORCE_SENSITIVE },
    ));
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'Notes.md')), bytesA, '"Notes.md" must hold its own distinct content');
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'notes.md')), bytesB, '"notes.md" must hold its own distinct content, not have been refused or clobbered');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('NEGATIVE: on THIS real machine (ext4, no injection, using the real default probe), "Notes.md" and "notes.md" both stage successfully, byte-exact', () => {
  const runDir = freshRunDir('sensitive-real-both-ok');
  try {
    const bytesA = Buffer.from('REAL-UPPER-N');
    const bytesB = Buffer.from('REAL-lower-n');
    assert.doesNotThrow(() => stageMaterials(runDir, [
      { filename: 'Notes.md', bytes: bytesA },
      { filename: 'notes.md', bytes: bytesB },
    ]));
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'Notes.md')), bytesA);
    assert.deepEqual(readFileSync(join(runDir, 'materials', 'notes.md')), bytesB);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// =============================================================================
// PROBE COST — once per call, not once per entry.
// =============================================================================

test('PROBE COST: the injected probe is called exactly ONCE for a call with THREE non-duplicate entries, not three times', () => {
  const runDir = freshRunDir('probe-once');
  try {
    let calls = 0;
    const countingProbe: CaseFoldingProbe = () => { calls += 1; return false; };
    assert.doesNotThrow(() => stageMaterials(
      runDir,
      [
        { filename: 'a.png', bytes: Buffer.from('A') },
        { filename: 'b.png', bytes: Buffer.from('B') },
        { filename: 'c.png', bytes: Buffer.from('C') },
      ],
      { probeCaseFolding: countingProbe },
    ));
    assert.equal(calls, 1, `expected the probe to run exactly once per stageMaterials call, ran ${calls} times`);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('PROBE COST: an empty entries array short-circuits before the probe ever runs', () => {
  const runDir = freshRunDir('probe-empty');
  try {
    let calls = 0;
    const countingProbe: CaseFoldingProbe = () => { calls += 1; return false; };
    assert.doesNotThrow(() => stageMaterials(runDir, [], { probeCaseFolding: countingProbe }));
    assert.equal(calls, 0, 'an empty entries array must return before paying any probe cost at all');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// =============================================================================
// PROBE FAILURE — surfaced loudly, never silently degraded to the old
// literal (buggy) comparison.
// =============================================================================

test('PROBE FAILURE: a probe that throws propagates loudly rather than being silently swallowed into the old literal-comparison fallback', () => {
  const runDir = freshRunDir('probe-throws');
  try {
    const explodingProbe: CaseFoldingProbe = () => { throw new Error('PROBE-BLEW-UP-DELIBERATELY'); };
    assert.throws(
      () => stageMaterials(runDir, [{ filename: 'x.txt', bytes: Buffer.from('X') }], { probeCaseFolding: explodingProbe }),
      /PROBE-BLEW-UP-DELIBERATELY/,
      'a probe failure must be surfaced, not silently caught and treated as "assume case-sensitive"',
    );
    assert.equal(existsSync(join(runDir, 'materials')), false, 'nothing may be written when the probe itself fails before Phase 1 even starts comparing targets');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
