/**
 * PURE, direct tests for `discoverStagedMaterials` (R6-04-F2 WI-1, rounds 5-6
 * — spawner rulings on "silently skips a no-kind staged file" (round 5) and
 * "the bare `catch {}` conflates ENOENT with every other errno" (round 6).
 *
 * Split into its own file from `orchestrator/agent-dispatch.test.ts`
 * deliberately: `discoverStagedMaterials` is module-private at HEAD (no
 * `export` keyword) and this file assumes it becomes exported — round 6
 * confirmed this assumption correct (ruling A) and the split itself was
 * endorsed ("keeping blast radius isolated when betting on an unbuilt
 * signature is exactly right"). Kept as-is.
 *
 * ROUND 6 return shape (this time given close to verbatim — "returns
 * `{materials, skipped, unreadable?}` where `unreadable` carries the errno
 * code string... when and only when readdirSync failed for a non-ENOENT
 * reason. ENOENT ⇒ unreadable absent"):
 * `discoverStagedMaterials(logsRoot, runId):
 * { materials: MaterialReference[]; skipped: string[]; unreadable?: string }`.
 *
 * The defect being closed here is structurally the SAME one this campaign
 * already paid for once (the R2-09 `lexists` probe swallowing EACCES and
 * ENOTDIR into "definitively absent") — a bare `catch {}` at
 * agent-dispatch.ts:160 today conflates the NORMAL case (ENOENT: no
 * materials directory, virtually every dispatch) with a GENUINE failure
 * (EACCES/ENOTDIR/ELOOP/...: a materials directory plausibly exists and
 * could not be read) into one identical `{materials:[], skipped:[]}`
 * outcome. Those are not the same fact and must not report identically:
 * ENOENT must stay silent (reporting it would fire a deviation event on
 * nearly every ordinary dispatch and train the operator to ignore the
 * channel); any other errno must be surfaced via `unreadable`.
 *
 * The function itself does NOT log anything — pure data in, data out; the
 * reporting (typed `log` events, `agent-dispatch.material-skipped` per
 * skipped filename and `agent-dispatch.materials-unreadable` carrying the
 * errno) is `dispatchAgentRun`'s job, pinned in the wiring tests in the
 * sibling file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverStagedMaterials } from '../../agent-dispatch.ts';

/** True when this process cannot have file permissions meaningfully denied
 *  to it (root, or a filesystem/container that doesn't enforce the
 *  permission bit) — used to SKIP (not fail, not vacuously pass) the two
 *  EACCES-dependent tests below, per the round-6 ruling: "skip the test
 *  gracefully... and say so in a comment rather than letting it silently
 *  pass for the wrong reason." */
function eaccesUnenforceable(dir: string): boolean {
  const probe = join(dir, `eacces-probe-${process.pid}`);
  mkdirSync(probe, { recursive: true });
  try {
    chmodSync(probe, 0o000);
    try {
      readFileSync(join(probe, 'anything'));
      return true; // no throw at all through a mode-000 dir ⇒ unenforced (root, or similar)
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== 'EACCES'; // threw, but not the expected code ⇒ can't trust this environment either
    }
  } finally {
    chmodSync(probe, 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}

// ---- discoverStagedMaterials — pure, direct ---------------------------------

test('discoverStagedMaterials: a mixed staged directory (one valid file, one no-kind file) returns the valid one in "materials" and the no-kind one in "skipped"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-mixed-'));
  try {
    const runId = 'DISCOVER-MIXED';
    const materialsDir = join(dir, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'notes.md'), 'valid content');
    writeFileSync(join(materialsDir, 'stray.xyz'), 'no-kind content');

    const result = discoverStagedMaterials(dir, runId);
    assert.deepEqual(result.materials, [{ path: 'materials/notes.md', kind: 'documents' }]);
    assert.deepEqual(result.skipped, ['stray.xyz']);
    assert.equal(result.unreadable, undefined, 'a genuinely readable directory must never carry an "unreadable" errno');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: ".DS_Store" specifically is skipped-and-reported, not fatal — the case that would otherwise bite a real operator on a Mac (Finder writes this file into any folder it has opened, unprompted, and it derives no material kind under the round-2 extension table)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-dsstore-'));
  try {
    const runId = 'DISCOVER-DSSTORE';
    const materialsDir = join(dir, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'photo.png'), 'real image');
    writeFileSync(join(materialsDir, '.DS_Store'), 'macOS Finder metadata, not a material');

    assert.doesNotThrow(() => discoverStagedMaterials(dir, runId), 'a ".DS_Store" in the staged directory must never be fatal to discovery');
    const result = discoverStagedMaterials(dir, runId);
    assert.deepEqual(result.materials, [{ path: 'materials/photo.png', kind: 'images' }]);
    assert.deepEqual(result.skipped, ['.DS_Store']);
    assert.equal(result.unreadable, undefined, 'a genuinely readable directory must never carry an "unreadable" errno, even one holding an odd file like .DS_Store');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: a directory containing ONLY no-kind files returns materials:[] and reports every one of them in "skipped" — none silently vanish', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-onlyunknown-'));
  try {
    const runId = 'DISCOVER-ONLY-UNKNOWN';
    const materialsDir = join(dir, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'stray1.xyz'), 'a');
    writeFileSync(join(materialsDir, 'stray2.abc'), 'b');

    const result = discoverStagedMaterials(dir, runId);
    assert.deepEqual(result.materials, []);
    assert.deepEqual(result.skipped.sort(), ['stray1.xyz', 'stray2.abc']);
    assert.equal(result.unreadable, undefined, 'a genuinely readable directory must never carry an "unreadable" errno, even when everything in it is skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: ENOENT — a genuinely ABSENT materials directory (the ordinary case — nothing was ever staged) returns materials:[], skipped:[], AND "unreadable" ABSENT — this is the contract\'s sharpest line: ENOENT must be indistinguishable from success, never conflated with a genuine read failure (round 6, contract point 1 — "this is the one that must not regress; it is the path every existing dispatch takes")', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-absent-'));
  try {
    const result = discoverStagedMaterials(dir, 'NEVER-STAGED-ANYTHING');
    assert.deepEqual(result.materials, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.unreadable, undefined, 'ENOENT (no materials directory at all) must NEVER populate "unreadable" — that field exists specifically to distinguish this ordinary case from a genuine EACCES/ENOTDIR failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: EACCES (unreadable materials directory, distinct from merely absent) returns materials:[] and unreadable==="EACCES" EXACTLY — TIGHTENED from round 5\'s loose pin now that the ruling specifies the errno-carrying shape. Gracefully SKIPPED (not failed, not vacuously passed) when the permission bit is unenforceable in this environment (root, certain containers/filesystems) — see the comment at the skip site', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-eacces-'));
  try {
    if (eaccesUnenforceable(dir)) {
      t.skip('this process/filesystem does not enforce mode-000 (running as root, or a permission-transparent filesystem) — EACCES cannot be genuinely produced here, so this test is skipped rather than left to pass vacuously or fail confusingly');
      return;
    }

    const runId = 'DISCOVER-EACCES';
    const materialsDir = join(dir, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    chmodSync(materialsDir, 0o000);
    try {
      assert.doesNotThrow(() => discoverStagedMaterials(dir, runId), 'an unreadable materials directory must not crash discovery');
      const result = discoverStagedMaterials(dir, runId);
      assert.deepEqual(result.materials, [], 'no materials can be discovered through an unreadable directory');
      assert.deepEqual(result.skipped, [], 'no per-FILENAME skips either — the directory could not even be listed');
      assert.equal(result.unreadable, 'EACCES', 'must carry the EXACT errno code string, distinguishing this genuine failure from the ordinary ENOENT (absent) case pinned above');
    } finally {
      chmodSync(materialsDir, 0o700); // restore before rmSync, or cleanup fails and leaks into /tmp
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: ENOTDIR — a regular FILE occupies the path where the materials directory would be — returns materials:[] and unreadable==="ENOTDIR" EXACTLY. This is the R2-09 lesson applied here: a bare catch{} cannot tell "nothing there" from "something there that is not a directory", and the two must not report identically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-enotdir-'));
  try {
    const runId = 'DISCOVER-ENOTDIR';
    const runDir = join(dir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'materials'), 'a regular file, not a directory, occupying the materials/ path');

    assert.doesNotThrow(() => discoverStagedMaterials(dir, runId), 'a file occupying the materials/ path must not crash discovery');
    const result = discoverStagedMaterials(dir, runId);
    assert.deepEqual(result.materials, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.unreadable, 'ENOTDIR', 'must carry the EXACT errno code string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
