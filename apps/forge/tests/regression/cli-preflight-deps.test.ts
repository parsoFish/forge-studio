/**
 * Row 174 (forge-8vfn.8.5.9): `forge preflight` must judge the same hard
 * clauses the scheduler's claim does, so CONTRACT MET means claimable.
 *
 * Measured on the M7-E stranger run (attempt 1, Q13): a freshly cloned
 * `projects/gitpulse` with no `npm ci` read CONTRACT MET from
 * `forge preflight gitpulse` — no DEPS line at all — and the scheduler then
 * refused the claim with "failing hard clause(s): DEPS". The initiative sat in
 * pending for ~12 minutes with the refusal visible only in serve.log.
 *
 * `runPreflight`'s DEPS clause is opt-in (`requireRunnableGate`) because a
 * project is BORN contract-green before anyone installs its dependencies
 * (`apps/forge/tests/regression/onboard-born-green.test.ts`); the claim
 * (`packages/flows/claim-validator.ts`) opts in. The operator's
 * `forge preflight` is asked before kickoff, which is claim time, so it opts
 * in too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRATCH_PATHS } from '../../../../packages/projects/preflight.ts';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLI = join(FORGE_ROOT, 'apps', 'forge', 'cli.ts');

test('`forge preflight` on an unprovisioned ground prints a FAILING DEPS line and exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-preflight-deps-'));
  try {
    const name = dir.split('/').pop()!;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run' } }));
    writeFileSync(join(dir, '.gitignore'), ['node_modules/', ...SCRATCH_PATHS].join('\n'));
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['vitest', 'run'] } } }));

    const r = spawnSync(process.execPath, ['--experimental-strip-types', CLI, 'preflight', dir], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    assert.match(out, /FAIL {2}DEPS /, `the claim's DEPS verdict must be printed, and failing:\n${out}`);
    assert.equal(r.status, 1, `a ground the claim would refuse must not exit 0:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
