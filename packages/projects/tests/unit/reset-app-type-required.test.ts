/**
 * Ruling 38 fix (a), M4-projects-reset — an UNKNOWN app type HARD-ERRORS.
 * The shipped PR #289 defect (found by running `forge project reset` against
 * `terraform-provider-betterado`, a Go/Terraform provider): `resolveAppType`
 * used to GUESS a starter (`cli`, or the first one alphabetically)
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeContractDrift } from '../../reset.ts';
import { AppTypeUnresolvedError } from '../../reset-report.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel';

// bead forge-mfv5.3.2's own fixture: the S3 ground (a hand-authored Go/
// Terraform provider). Fixture seeds are provenance-pinned — read-only, copied
// to a tmp dir, never edited in place.
const S3_FIXTURE_SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'stories', 'grounds', 'go-provider-old-contract', 'seed');

function copyS3Fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-s3-fixture-'));
  cpSync(S3_FIXTURE_SEED, dir, { recursive: true });
  return dir;
}

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
          ['api', 'cli', 'webapp'],
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
    const drift = computeContractDrift(projectDir, { forgeRoot, appType: 'cli' });
    assert.equal(drift.appType, 'cli', 'the explicit --app-type must be used — an informed operator choice, not a guess');
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
      `${JSON.stringify({ name: 'scaffolded-thing', appType: 'api', testProcess: { local: { cmd: ['npm', 'test'] } } }, null, 2)}\n`,
      'utf8',
    );
    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.appType, 'api', 'a persisted appType (ruling 38 fix c) must resolve without an explicit flag');
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
      `${JSON.stringify({ name: 'migrated-thing', appType: 'cli', testProcess: { local: { cmd: ['npm', 'test'] } } }, null, 2)}\n`,
      'utf8',
    );
    const drift = computeContractDrift(dir, { forgeRoot, appType: 'webapp' });
    assert.equal(drift.appType, 'webapp', 'an explicit --app-type must win over a stale persisted value');
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

// ── bead forge-mfv5.3.2: an app type is required ONLY when some section ────
// would actually be regenerated FROM a starter — never merely because none
// was given while starters exist (that was fix (a)'s own over-broad net).

test('computeContractDrift on the S3 hand-authored ground succeeds with NO appType: "no app type needed", and no contract section is touched', () => {
  const dir = copyS3Fixture();
  try {
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT });
    assert.equal(drift.appType, null, 'a hand-authored ground names no starter');
    assert.equal(drift.appTypeNote, 'no app type needed: every section is hand-authored');
    for (const row of drift.rows) {
      if (row.section === 'skills') continue; // a filesystem relocation, independent of appType
      assert.ok(
        row.action === 'preserve' || row.action === 'unchanged',
        `section "${row.section}" is "${row.action}" with no appType given — a contract section would be regenerated FROM a starter with no operator choice behind it`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeContractDrift on the S3 ground still REFUSES with no appType when a section (here, demoProcess) would come from a starter', () => {
  const dir = copyS3Fixture();
  try {
    // Strip the ground's own hand-authored demoProcess: every shipped starter
    // DOES declare one, so this section can no longer resolve without picking
    // a specific starter to fill it — the ambiguity fix (a) still refuses.
    const configPath = join(dir, '.forge', 'project.json');
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    delete raw.demoProcess;
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);

    assert.throws(
      () => computeContractDrift(dir, { forgeRoot: FORGE_ROOT }),
      (err: unknown) => {
        assert.ok(err instanceof AppTypeUnresolvedError, `expected AppTypeUnresolvedError, got ${err}`);
        assert.match((err as Error).message, /--app-type/, 'today\'s message — unchanged by forge-mfv5.3.2');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
