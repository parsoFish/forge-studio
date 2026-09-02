/**
 * Ruling 38 fix (a), M4-projects-reset — an UNKNOWN app type HARD-ERRORS.
 * The shipped PR #289 defect (found by running `forge project reset` against
 * `terraform-provider-betterado`, a Go/Terraform provider): `resolveAppType`
 * used to GUESS a starter (`typescript-cli`, or the first one alphabetically)
 * whenever neither an explicit `--app-type` nor a persisted `appType` was
 * available — silently proposing to rewrite that project's Go test/release
 * contract into a TypeScript one. A no-op that prints a plausible-looking
 * report is the same false-green shape as writing the wrong thing, so this is
 * a THROW, not a degraded report: `computeContractDrift` throws
 * `AppTypeUnresolvedError` (never returns a `DriftReport`), so a programmatic
 * caller (the Studio "Rebuild contract" route this module's own header
 * anticipates) can never mistake "unknown app type" for "no drift" — there is
 * no report object to inspect for that condition, only a distinct, typed
 * exception.
 *
 * The genuinely-no-starters-under-forgeRoot case (a bare/test forgeRoot) is a
 * DIFFERENT, already-fixed case — see `reset-containment.test.ts`'s own note
 * — and stays non-throwing (`appType: null`): there is nothing to compare
 * against, so nothing to guess wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeContractDrift, AppTypeUnresolvedError } from '../../reset.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-apptype-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

/** A Go/Terraform-shaped project — like `terraform-provider-betterado` —
 *  with NO persisted `appType` (the pre-fix (c) / onboarded-project shape). */
function goShapedProjectNoAppType(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-apptype-project-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      {
        name: 'terraform-provider-betterado',
        testProcess: { local: { cmd: ['go', 'test', '-tags', 'all', '-count=1', './...'] } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return dir;
}

test('computeContractDrift throws AppTypeUnresolvedError when starters exist but the project has no persisted appType and none was given', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = goShapedProjectNoAppType();
  try {
    const before = readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8');
    assert.throws(
      () => computeContractDrift(projectDir, { forgeRoot }),
      (err: unknown) => {
        assert.ok(err instanceof AppTypeUnresolvedError, `expected AppTypeUnresolvedError, got ${err}`);
        assert.match((err as Error).message, /--app-type/, 'the message must tell the operator to pass --app-type explicitly');
        assert.deepEqual(
          (err as AppTypeUnresolvedError).availableAppTypes.sort(),
          ['typescript-api', 'typescript-cli', 'typescript-web'],
          'a programmatic caller (Studio) must be able to render the real choices without parsing the message',
        );
        return true;
      },
    );
    assert.equal(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'), before, 'a pure function that throws must not have written anything');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('computeContractDrift resolves cleanly when an explicit opts.appType is given, even with no persisted appType', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = goShapedProjectNoAppType();
  try {
    const drift = computeContractDrift(projectDir, { forgeRoot, appType: 'typescript-cli' });
    assert.equal(drift.appType, 'typescript-cli', 'the explicit --app-type must be used — an informed operator choice, not a guess');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('computeContractDrift resolves cleanly from a PERSISTED config.appType, with no --app-type needed', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-apptype-persisted-'));
  try {
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'scaffolded-thing', appType: 'typescript-api', testProcess: { local: { cmd: ['npm', 'test'] } } }, null, 2)}\n`,
      'utf8',
    );
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.appType, 'typescript-api', 'a persisted appType (ruling 38 fix c) must resolve without an explicit flag');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeContractDrift: an explicit opts.appType overrides a different persisted config.appType', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-apptype-override-'));
  try {
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'migrated-thing', appType: 'typescript-cli', testProcess: { local: { cmd: ['npm', 'test'] } } }, null, 2)}\n`,
      'utf8',
    );
    const drift = computeContractDrift(dir, { forgeRoot, appType: 'typescript-web' });
    assert.equal(drift.appType, 'typescript-web', 'an explicit --app-type must win over a stale persisted value');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeContractDrift: an explicit opts.appType that is not a real starter still throws AppTypeUnresolvedError, naming the available list', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = goShapedProjectNoAppType();
  try {
    assert.throws(
      () => computeContractDrift(projectDir, { forgeRoot, appType: 'golang-provider' }),
      (err: unknown) => {
        assert.ok(err instanceof AppTypeUnresolvedError);
        assert.match((err as Error).message, /unknown appType "golang-provider"/);
        return true;
      },
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('computeContractDrift: zero starters under forgeRoot (the already-fixed case) still resolves appType: null gracefully, never throws', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-apptype-zero-starters-'));
  const projectDir = goShapedProjectNoAppType();
  try {
    const drift = computeContractDrift(projectDir, { forgeRoot });
    assert.equal(drift.appType, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
