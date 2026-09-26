/**
 * ground-hash-unknown.test.ts — ROW 102b finding 8 (M7-COMMON §6.15, T1
 * 1512): `groundManifest`'s catch folds EVERY failure (absent, unreadable, a
 * `sh`/`find`/`xargs` spawn error) into `null`, so a transient hash failure
 * reads identically to "this ground never existed" — the sibling-ground fence
 * compares two `null`s as unchanged, and the own-ground check skips its
 * entire containment block on the very first read.
 *
 * SPLIT OUT of `ground-hash.test.ts` (787/800, no room) rather than grown
 * into it — same reasoning as every other `-unknown.test.ts` file this row
 * added.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { groundManifest, groundChanges, siblingGroundEscapes } from './ground-hash.mjs';
import { GROUND_MANIFEST_UNKNOWN } from './ground-minted.mjs';

/** A path that EXISTS but is not a directory — `cwd` pointed at it fails
 *  `sh`'s spawn with `ENOTDIR`, a real, reproducible non-ENOENT failure
 *  (the ENOENT case needs the path absent, which is a different, already-
 *  covered control). */
function fileNotDir(): string {
  const p = join(mkdtempSync(join(tmpdir(), 'ground-hash-unknown-')), 'not-a-dir');
  writeFileSync(p, 'a file where a ground directory was expected\n');
  return p;
}

test('ROW 102b (RED) finding 8: groundManifest on a non-ENOENT failure returns the UNKNOWN sentinel, never null', () => {
  const p = fileNotDir();
  try {
    const got = groundManifest(p);
    assert.equal(got, GROUND_MANIFEST_UNKNOWN, `expected the UNKNOWN sentinel, not ${JSON.stringify(got)}`);
  } finally {
    rmSync(p, { force: true });
  }
});

test('control: groundManifest on a genuinely absent directory (real ENOENT) is still null, as before', () => {
  assert.equal(groundManifest(join(tmpdir(), 'ground-hash-unknown-does-not-exist-xyz')), null);
});

test('ROW 102b (RED) finding 8: groundChanges with either side UNKNOWN reports ONE named path, never "unchanged"', () => {
  const real = groundManifest(mkdtempSync(join(tmpdir(), 'ground-hash-unknown-real-')));
  const unknownVsUnknown = groundChanges(GROUND_MANIFEST_UNKNOWN, GROUND_MANIFEST_UNKNOWN);
  assert.equal(unknownVsUnknown.added.length, 1);
  assert.match(unknownVsUnknown.added[0], /GROUND STATE UNKNOWN/);
  assert.deepEqual(unknownVsUnknown.removed, []);
  assert.deepEqual(unknownVsUnknown.modified, []);

  const realVsUnknown = groundChanges(real, GROUND_MANIFEST_UNKNOWN);
  assert.match(realVsUnknown.added[0], /GROUND STATE UNKNOWN/);
});

test('control: groundChanges with two real, identical manifests is unchanged, as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ground-hash-unknown-stable-'));
  writeFileSync(join(dir, 'a.txt'), 'stable\n');
  const before = groundManifest(dir);
  const after = groundManifest(dir);
  assert.deepEqual(groundChanges(before, after), { added: [], removed: [], modified: [] });
});

test('ROW 102b (RED) finding 8: siblingGroundEscapes reports a sibling whose CURRENT ground read is UNKNOWN, never silently unchanged', () => {
  // `before` is a genuine "never observed" (null); `after` (computed inside
  // siblingGroundEscapes via groundManifest) is forced UNKNOWN by making
  // `<dir>/projects/proj` a file instead of a directory. `null === null`
  // would have been the pre-fix bug's exact shape (both sides read as
  // "absent" via `?.digest ?? null`); UNKNOWN must never take that path.
  const dir = mkdtempSync(join(tmpdir(), 'ground-hash-unknown-sibling-'));
  mkdirSync(join(dir, 'projects'), { recursive: true });
  writeFileSync(join(dir, 'projects', 'proj'), 'not a directory\n');
  const baseline = new Map([[dir, null]]);
  try {
    const found = siblingGroundEscapes('proj', baseline, { dirs: () => [dir] });
    assert.equal(found.length, 1, `expected one UNVERIFIED/UNKNOWN escape entry: ${JSON.stringify(found)}`);
    assert.equal(found[0].after, 'UNKNOWN');
    assert.match(found[0].changes.added[0], /GROUND STATE UNKNOWN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('control: siblingGroundEscapes with a genuinely absent sibling ground on both sides reports nothing, as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ground-hash-unknown-sibling-ctrl-'));
  const baseline = new Map([[dir, null]]); // never had the ground — real ENOENT under the hood
  try {
    assert.deepEqual(siblingGroundEscapes('proj', baseline, { dirs: () => [dir] }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
