/**
 * PURE, direct tests for `discoverStagedMaterials` (R6-04-F2 WI-1, round 5 —
 * spawner ruling on the "silently skips a no-kind staged file" finding).
 *
 * Split into its own file from `orchestrator/agent-dispatch.test.ts`
 * deliberately: `discoverStagedMaterials` is module-private at HEAD (no
 * `export` keyword) and this file assumes it becomes exported — the ruling
 * says "keep it free of logging concerns so it stays directly testable",
 * which only makes sense if a test CAN import it directly. If that
 * assumption is wrong, THIS file's whole import goes red as one unit; the
 * wiring-level companion tests in `orchestrator/agent-dispatch.test.ts`
 * (which only need the already-exported `dispatchAgentRun`/
 * `buildStandaloneRunPrompt`) are unaffected either way. Keeping the two
 * concerns in separate files means a wrong guess about ONE export doesn't
 * collateral-damage 20+ already-passing tests that don't depend on it.
 *
 * ASSUMED return shape (not given verbatim by the ruling, inferred from
 * "returns BOTH the usable references and the skipped filenames (e.g.
 * `{materials, skipped}`)"): `discoverStagedMaterials(logsRoot, runId):
 * { materials: MaterialReference[]; skipped: string[] }`. The function
 * itself does NOT log anything — pure data in, data out; the reporting
 * (a typed `log` event) is `dispatchAgentRun`'s job, pinned in the wiring
 * tests in the sibling file.
 *
 * Ruling recap: skip a no-kind file, never throw for it (a stray
 * `.DS_Store`/editor swapfile must never turn into an outage for the whole
 * run), but never silently drop it either (report it).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverStagedMaterials } from './agent-dispatch.ts';

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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: a genuinely ABSENT materials directory (the ordinary case — nothing was ever staged) returns materials:[] and skipped:[] — this is NOT a failure and must not be conflated with the unreadable-directory case below', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-absent-'));
  try {
    const result = discoverStagedMaterials(dir, 'NEVER-STAGED-ANYTHING');
    assert.deepEqual(result.materials, []);
    assert.deepEqual(result.skipped, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverStagedMaterials: an UNREADABLE materials directory (EACCES, distinct from merely absent) still returns materials:[] rather than throwing — LOOSELY pinned: this test asserts only the property the ruling states unconditionally ("still returns []"); it deliberately does NOT assert an exact shape for HOW the read failure is signalled for reporting (a "skipped" entry vs. a separate field vs. something else), since the ruling did not specify one and inventing a rigid shape here risks failing a reasonable compliant implementation — see orchestrator/agent-dispatch.test.ts\'s wiring-level companion test for the OBSERVABLE contract point that matters most: dispatchAgentRun must not crash and must report SOMETHING', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-materials-eacces-'));
  const runId = 'DISCOVER-EACCES';
  const materialsDir = join(dir, runId, 'materials');
  try {
    mkdirSync(materialsDir, { recursive: true });
    chmodSync(materialsDir, 0o000);

    // Arrange-step self-check (mirrors cli/studio-path-guard.test.ts's own
    // established pattern for this exact class of test) — without this, a
    // process running as root (or a filesystem that doesn't enforce the
    // permission bit) would pass vacuously rather than exercise the real
    // EACCES path.
    let arrangeThrew = false;
    try {
      readFileSync(join(materialsDir, 'anything'));
    } catch (err) {
      arrangeThrew = true;
      assert.equal((err as NodeJS.ErrnoException).code, 'EACCES', `expected a read through the mode-000 directory to throw EACCES — got ${(err as NodeJS.ErrnoException).code}`);
    }
    assert.ok(arrangeThrew, 'arrange-step failed: read through the mode-000 directory did not throw at all — this test would be vacuous (running as root?)');

    assert.doesNotThrow(() => discoverStagedMaterials(dir, runId), 'an unreadable materials directory must not crash discovery');
    const result = discoverStagedMaterials(dir, runId);
    assert.deepEqual(result.materials, [], 'no materials can be discovered through an unreadable directory');
  } finally {
    chmodSync(materialsDir, 0o700); // restore before rmSync, or cleanup fails and leaks into /tmp
    rmSync(dir, { recursive: true, force: true });
  }
});
