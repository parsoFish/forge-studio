/**
 * Defect-CLASS fix (forge-8vfn.8.1.25, T1 ruling 1617). The first instance
 * found was `cycle.test.ts`'s `writeManifestWithCeiling`: an `mkdtempSync`
 * with no matching `rmSync` leaks a fresh tmp dir every run — ~8,185 of them
 * had accumulated on one host. T1's standing no-deferrals ruling means every
 * same-class site the fix's own audit turned up gets fixed in the same pass,
 * not listed for later:
 *
 *   - packages/flows/tests/integration/cycle.test.ts
 *       `writeManifestWithCeiling` (`forge-ceiling-*`) — the original.
 *   - packages/flows/tests/integration/pr.postmerge-ci.test.ts
 *       `withGhShim`'s shim dir (`n6-gh-*`) — folded into the restore fn every
 *       caller already ran in `finally`.
 *   - packages/flows/tests/integration/requeue-resume.test.ts
 *       `initRepo`/`makeWorktree`/`makeForgeRoot` (`n7-*`) — 12 call sites,
 *       none of which had ANY cleanup before this fix.
 *   - packages/flows/tests/unit/cost-ceiling-binds.test.ts
 *       `writeManifest`'s dir (`forge-ceiling-binds-*`) — same `{ path, dir }`
 *       return-shape fix as `cycle.test.ts`'s own helper.
 *   - packages/flows/tests/unit/cost-reseed-on-reentry.test.ts
 *       two direct `mkdtempSync` call sites (`forge-cost-reseed-*`,
 *       `forge-cost-reseed-triple-*`).
 *   - packages/flows/tests/unit/synthetic-architect-idempotent.test.ts
 *       `seed()`'s root (`forge-synth-architect-*`) — the helper returned
 *       `logsRoot` but never the `root` a caller would need to remove it.
 *   - packages/flows/tests/integration/planned-initiatives.test.ts
 *       `setup()`'s PARENT dir (`planned-*`) — 3 of the file's own 7 cleanup
 *       sites `rmSync`'d only the `_queue` child `setup()` hands back, leaving
 *       the (now-empty) parent behind; made consistent with the other 4.
 *   - packages/flows/tests/integration/cycle-helpers.test.ts (M6-D pinned path)
 *       one test's sibling `forge-close-push-fail-logs-*` dir, created
 *       alongside the dir its own `finally` already cleaned rather than
 *       nested under it — moved inside so the existing cleanup covers it.
 *   - packages/flows/studio/flow-registry-accepts.test.ts
 *       `tmpFlow`'s dir (`flow-accepts-*`) — found mid-row while verifying the
 *       fix above (a full `packages/flows` run still showed 9 of these left
 *       over); same `{ path, dir }` shape as `cycle.test.ts`'s own helper,
 *       9 call sites. Not on the original list — rolled in per the standing
 *       no-deferrals ruling rather than left for later.
 *
 * This is the CLASS door, not one subprocess per file: every file above runs
 * TOGETHER in ONE `node --test` child against a fresh, private TMPDIR, and the
 * assertion is that TMPDIR is EMPTY afterward — not merely free of one named
 * prefix. A new same-class leak in any of these files, or a regression in an
 * existing fix, fails this test without this file needing to know its prefix.
 *
 * SIBLING FILE (not appended to any one covered file): the property under
 * test is "do these files, run together, leave tmp residue behind", which
 * nothing inside the same process can observe about itself — a test embedded
 * in one of the covered files would need to spawn that file, which would
 * spawn itself recursively.
 *
 * TMPDIR is pointed at a fresh, private dir for the subprocess so the result
 * is exact: unrelated to whatever this host, or another lane running the same
 * suite concurrently, already has lying around in the real `/tmp`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const COVERED_FILES = [
  join(HERE, '..', 'integration', 'cycle.test.ts'),
  join(HERE, '..', 'integration', 'pr.postmerge-ci.test.ts'),
  join(HERE, '..', 'integration', 'requeue-resume.test.ts'),
  join(HERE, '..', 'unit', 'cost-ceiling-binds.test.ts'),
  join(HERE, '..', 'unit', 'cost-reseed-on-reentry.test.ts'),
  join(HERE, '..', 'unit', 'synthetic-architect-idempotent.test.ts'),
  join(HERE, '..', 'integration', 'planned-initiatives.test.ts'),
  join(HERE, '..', 'integration', 'cycle-helpers.test.ts'),
  join(HERE, '..', '..', 'studio', 'flow-registry-accepts.test.ts'),
];

test('forge-8vfn.8.1.25 (T1 1617): the covered files leave TMPDIR fully empty, run together', () => {
  const privateTmp = mkdtempSync(join(tmpdir(), 'forge-tmp-leak-class-check-'));
  try {
    // NODE_TEST_CONTEXT must NOT reach the child: this file itself runs as a
    // `node --test` subprocess, and inheriting that var makes the nested
    // `node --test` below think it's an already-forked test-runner child —
    // it then reports green having run nothing rather than the real suite.
    const childEnv: NodeJS.ProcessEnv = { ...process.env, TMPDIR: privateTmp };
    delete childEnv.NODE_TEST_CONTEXT;

    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      ['--test', '--experimental-strip-types', ...COVERED_FILES],
      { env: childEnv, encoding: 'utf8' },
    );
    const wallMs = Date.now() - startedAt;
    // This subprocess runs inside every gate that runs this file — surface
    // its own cost so a future slowdown here is visible, not just felt.
    console.log(`tmp-dir-leak-class: covered-file child wall time ${wallMs}ms (${COVERED_FILES.length} files)`);

    assert.equal(
      result.status,
      0,
      `covered-file subprocess failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
    const leftover = readdirSync(privateTmp);
    assert.deepEqual(
      leftover,
      [],
      `TMPDIR must be EMPTY after these files run together; left over: ${leftover.join(', ')}`,
    );
  } finally {
    rmSync(privateTmp, { recursive: true, force: true });
  }
});
