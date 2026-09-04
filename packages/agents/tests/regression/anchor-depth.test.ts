/**
 * The anchor trap, measured at the depth the re-bucket actually creates.
 *
 * WHY THIS FILE EXISTS. Exit row 6 moves ~52 test files from
 * `packages/agents/` into `packages/agents/tests/{unit,integration,contract,
 * regression}/` — two levels deeper. Six of them anchored the repo root by
 * counting `'..'` from their own location, which is correct at one depth and
 * wrong at any other (COMMON §15.14). Those six were re-anchored on kernel's
 * `FORGE_ROOT` in the same commit as this file; this test is the OTHER HALF of
 * that proof — the half that shows what the old form actually does at the real
 * post-move depth, instead of asserting it.
 *
 * A CORRECTION THIS FILE EXISTS TO CARRY. The sweep first recorded the two
 * structural locks — `run-query-marker.enforce.test.ts` and
 * `pinned-sdk-query.enforce.test.ts` — as the dangerous case, on the reasoning
 * that a scanner rooted two levels short walks a tree with nothing in it, finds
 * no offenders and passes vacuously (§15.70). **That was wrong, and running it
 * is what settled it.** Both locks collect files with `readdirSync(join(ROOT,
 * dirName))`, and a directory that is not there does not yield an empty list —
 * it THROWS `ENOENT`. Forced to the post-move root, both fail loudly:
 *
 *     ENOENT: no such file or directory, scandir
 *       '…/packages/agents/orchestrator'
 *
 * So the re-anchor is still required — the files would break after the move —
 * but the failure mode is the good one, and saying otherwise would have
 * overstated the risk of a move this lane still has to make. Worth recording
 * that `pinned-sdk-query.enforce.test.ts` already carries its own "sanity: the
 * wrapper file itself trips the detector (proves it is not vacuous)" test: the
 * §15.70 discipline was there before this sweep looked for it.
 *
 * WHAT THIS ASSERTS, and why it is not arithmetic. Not "`'..'` counting is
 * depth-sensitive" (that is arithmetic). It asserts the CONSEQUENCES: the old
 * anchor lands on a real-but-wrong directory, the scan those locks perform
 * throws from there rather than returning empty, and `FORGE_ROOT` does not
 * move when its reader does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

/** The old anchor form, computed inside a module at whatever depth it sits. */
const PROBE_MODULE = `
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const OLD_FORM = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
`;

/**
 * The directories the two locks scan, copied from their own `SCANNED_DIRS`.
 * Named here rather than invented: the first draft of this file guessed
 * `['packages','cli','orchestrator','apps']` and would have "proved" something
 * about a list neither lock uses (§15.93 — a fixture pointing at nothing).
 */
const LOCK_SCANNED_DIRS = ['orchestrator', 'loops', 'packages', 'apps/forge'] as const;

/** Where `join(dirname, '..', '..')` lands for a file at `<pkg>/tests/<bucket>/`. */
const POST_MOVE_WRONG_ROOT = join(FORGE_ROOT, 'packages', 'agents');

test('the old anchor resolves to a DIFFERENT root once the file is two levels deeper — the premise of the whole sweep', async () => {
  const pkgLike = mkdtempSync(join(tmpdir(), 'forge-anchor-'));
  try {
    const deep = join(pkgLike, 'tests', 'unit');
    mkdirSync(deep, { recursive: true });

    const shallowFile = join(pkgLike, 'probe.mjs');
    writeFileSync(shallowFile, PROBE_MODULE);
    const shallow = await import(pathToFileURL(shallowFile).href);

    const deepFile = join(deep, 'probe.mjs');
    writeFileSync(deepFile, PROBE_MODULE);
    const deeper = await import(pathToFileURL(deepFile).href);

    assert.notEqual(deeper.OLD_FORM, shallow.OLD_FORM);
    // It is not garbage — it is a REAL directory that is simply not the one the
    // file meant. That is what makes this class hard to see by reading.
    assert.equal(deeper.OLD_FORM, pkgLike);
    assert.ok(existsSync(deeper.OLD_FORM));
  } finally {
    rmSync(pkgLike, { recursive: true, force: true });
  }
});

test('at the post-move root every directory the locks scan is ABSENT, and reading one THROWS rather than returning empty — the failure is loud, not vacuous', () => {
  const present = LOCK_SCANNED_DIRS.filter((d) => existsSync(join(POST_MOVE_WRONG_ROOT, d)));
  assert.deepEqual(present, [], 'none of the scanned directories may exist beneath the wrong root');

  // The measured behaviour, and the reason this is a loud break: the locks call
  // `readdirSync(join(ROOT, dirName))`, which throws ENOENT on a missing dir.
  assert.throws(
    () => readdirSync(join(POST_MOVE_WRONG_ROOT, LOCK_SCANNED_DIRS[0]), { withFileTypes: true, recursive: true }),
    (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
    'a lock rooted here must throw, not silently scan nothing',
  );

  // The other half, without which the assertions above would pass on a typo in
  // the directory list: from the REAL anchor, every one of those names exists
  // and has files under it, so the locks have something to find.
  const fromForgeRoot = LOCK_SCANNED_DIRS.filter((d) => existsSync(join(FORGE_ROOT, d)));
  assert.deepEqual(fromForgeRoot, [...LOCK_SCANNED_DIRS]);
  assert.ok(readdirSync(join(FORGE_ROOT, 'packages')).length > 0);
});

test('FORGE_ROOT does not move when its reader does — the entire reason it is the anchor', () => {
  assert.ok(existsSync(join(FORGE_ROOT, 'package.json')));
  assert.ok(existsSync(join(FORGE_ROOT, 'skills')));
  assert.equal(FORGE_ROOT, resolve(FORGE_ROOT));
});
