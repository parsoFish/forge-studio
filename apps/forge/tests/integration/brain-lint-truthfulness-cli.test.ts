/**
 * I3 (D14 review, bead forge-mfv5.3.4) — a REGRESSION LOCK for the operator's
 * own `forge brain lint` CLI: the pinned unit suite
 * (`packages/knowledge/tests/unit/brain-lint-truth.test.ts`) only ever spawns
 * the STANDALONE `packages/knowledge/brain-lint.ts --cwd <root>` entry (the
 * only one that accepts a root override), never `apps/forge/cli-brain-lint.ts`'s
 * `cmdBrainLint` — the command operators actually run as `forge brain lint`.
 * That left a structural coverage gap: a future refactor could silently drop
 * `cli-brain-lint.ts`'s `formatTruthfulnessLines` call and the whole pinned
 * suite would stay green. This test drives the real `apps/forge/cli.ts brain
 * lint` command end to end, against THIS worktree (cwd = FORGE_ROOT, no
 * fixture — `cmdBrainLint` hardcodes FORGE_ROOT and has no `--cwd`/root
 * override, confirmed in `apps/forge/cli-brain-lint.ts`), so it can only pass
 * against the real repo. `mdtoc` is the one project checked out in every
 * worktree and in CI (`projects/mdtoc/`, tracked — see `projects/README.md`),
 * so its `truthfulness:` row is always present to assert on.
 *
 * Spawn pattern copied from `packages/projects/tests/integration/create-cli.test.ts`
 * / `preflight-converge-cli.test.ts` (the house `spawnSync` + `FORGE_ROOT` shape
 * for driving `apps/forge/cli.ts` as a real subprocess).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function brainLint(args: string[]): { code: number | null; out: string } {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'apps/forge/cli.ts', 'brain', 'lint', ...args],
    { cwd: FORGE_ROOT, encoding: 'utf8' },
  );
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('`forge brain lint` prints a "truthfulness: mdtoc — " line and exits 0 (regression lock: the pinned unit suite never drives THIS CLI entry — see file header)', () => {
  const r = brainLint([]);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. Output:\n${r.out}`);
  assert.match(
    r.out,
    /^truthfulness: mdtoc — /m,
    `expected a "truthfulness: mdtoc — " line in stdout, got:\n${r.out}`,
  );
});
