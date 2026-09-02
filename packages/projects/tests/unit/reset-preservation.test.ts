/**
 * S3 (1.0.md §3) — preservation contract for `applyContractReset`: the three
 * fields a rebuild has NO RIGHT to touch (`northStar`, `instructions`, and a
 * live-acceptance secret's NAME) survive byte-for-byte, while the
 * mechanisms forge owns (`testProcess.local`, `demoProcess`, `releaseProcess`)
 * regenerate from the matched app-type starter. Ground: a fixture shaped
 * exactly like `terraform-provider-betterado` (S3's own story ground) — a
 * drifted `<artifactRoot>/skills/<id>/` layout, a `testProcess.acceptance`
 * declaring `AZDO_PERSONAL_ACCESS_TOKEN` (the value S3 beat 7 pins) as a
 * required secret NAME.
 *
 * THE CALL-RECORD ASSERTION. The spec (`_1.0/plans/M4-projects-reset-spec.md`
 * Q3) proposes `mock.method(fs, 'readFileSync', ...)` to prove
 * `secrets.env` is never opened. Empirically verified NOT to work in this
 * repo/runtime before writing this file (see the two precedents this test
 * follows: `cli/instructions-start-read-guard.test.ts` and
 * `packages/factory/demo-builder-start-read-guard.test.ts`, both of which
 * document the same finding for `node:child_process`'s `spawn`) — a
 * throwaway probe against BOTH `node:fs`'s `readFileSync` and an ordinary
 * userland named export reproduces the identical
 * `TypeError: Cannot redefine property` `node:test`'s `mock.method` throws
 * for any cross-module ESM named import in this Node version; the call
 * genuinely never reaches the mock. So this file substitutes the SAME
 * structural technique those two precedents use for the identical reason:
 * a static scan of `reset.ts`'s own source text asserting the literal
 * `secrets.env` NEVER appears anywhere in it — the property that "no
 * function in this file opens a file so named" reduces to (no function CAN
 * construct that literal path segment if the string is nowhere in the
 * source). This is proof-by-construction of the call record ("which files
 * were opened" can never include `secrets.env` if the file contains no way
 * to spell it), not an outcome inference, and it fails the moment a future
 * edit types the string anywhere in the module — exactly what the spec asks
 * for. It is backed by a genuine runtime corroboration below: a REAL
 * `secrets.env` carrying a canary value is planted in the fixture, and
 * every artifact the reset produces (the written `.forge/project.json`, the
 * `DriftReport`, the `ResetResult`) is scanned for the canary string.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

const RESET_SRC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reset.ts');

const NORTH_STAR =
  'Feature complete ADO provider that has data and resources defined for all resources available in the ADO API';
const INSTRUCTIONS = 'See AGENTS.md for project-specific rules (this project keeps its own conventions there).';
const SECRET_NAME = 'AZDO_PERSONAL_ACCESS_TOKEN';
const SECRET_CANARY = 'LEAK-CANARY-9f3a1c7d0e21';

/** An isolated forgeRoot carrying the real typescript-cli starter — the same
 *  pattern `project-create.test.ts`'s `isolatedForgeRoot()` uses. */
function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-preserve-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

/** A betterado-shaped fixture project: a drifted `<artifactRoot>/skills/`
 *  layout, a stale (non-starter) local test cmd + demoProcess + releaseProcess,
 *  a preserved acceptance secret NAME, and a REAL secrets.env with a canary
 *  value that must never surface anywhere the reset writes or returns. */
function betteradoShapedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-preserve-project-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      {
        name: 'terraform-provider-betterado',
        northStar: NORTH_STAR,
        instructions: INSTRUCTIONS,
        artifactRoot: 'forge',
        testProcess: {
          local: { cmd: ['go', 'test', '-tags', 'all', '-count=1', './...'] },
          acceptance: { match: 'TF_ACC', required: true, requiresEnv: [SECRET_NAME] },
        },
        demoProcess: [{ kind: 'capture', text: 'a stale, pre-current-template demo step' }],
        releaseProcess: { steps: [{ kind: 'docs', phase: 'pre-merge', text: 'a stale release step' }] },
        skills: ['ado-api-explorer'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  // The drifted skill layout: `<artifactRoot>/skills/<id>/SKILL.md`, NOT
  // `.forge/skills/<id>/SKILL.md` — the resolver's one hardcoded scan path.
  mkdirSync(join(dir, 'forge', 'skills', 'ado-api-explorer'), { recursive: true });
  writeFileSync(join(dir, 'forge', 'skills', 'ado-api-explorer', 'SKILL.md'), '# ado-api-explorer\n', 'utf8');
  // The real secret VALUE — must never be read or written by the reset.
  writeFileSync(join(dir, 'secrets.env'), `${SECRET_NAME}=${SECRET_CANARY}\n`, 'utf8');
  return dir;
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

/** Strip `/** ... *\/` and `// ...` comments so a documentation mention of
 *  "secrets.env" (this file's own module header explains the D3 rule by
 *  naming the file it must never open) doesn't false-positive the scan below
 *  — only a mention reachable from executable code (a string/template
 *  literal a path could actually be built from) counts. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('reset.ts source never spells "secrets.env" in executable code — the structural call-record proof', () => {
  const src = readFileSync(RESET_SRC_PATH, 'utf8');
  assert.ok(src.includes('secrets.env'), 'sanity: the module header documents the D3 rule by naming the file (comment-only)');
  assert.equal(
    stripComments(src).includes('secrets.env'),
    false,
    'reset.ts must never reference secrets.env by name in executable code — no function in this file may construct that path segment',
  );
});

test('applyContractReset preserves northStar/instructions/secret-name byte-identical; regenerates testProcess.local/demoProcess from the starter; PRESERVES releaseProcess (the starter has no opinion); never leaks the secret VALUE', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = betteradoShapedProject();
  try {
    const secretsEnvBefore = readFileSync(join(projectDir, 'secrets.env'), 'utf8');

    // RULING 38 fix (a), M4-projects-reset: this fixture (deliberately shaped
    // like terraform-provider-betterado — a Go/Terraform provider) has no
    // persisted `appType`, and NONE of the three shipped starters is actually
    // a Go template. Before the fix, `computeContractDrift` GUESSED
    // 'typescript-cli' here and silently rewrote the Go contract into a
    // TypeScript one — the exact shipped PR #289 defect. It now throws
    // (`AppTypeUnresolvedError`, see reset-app-type-required.test.ts) unless
    // the operator explicitly says so via `--app-type` / `opts.appType` — so
    // this test supplies that explicit, informed choice itself, then asserts
    // what a CORRECT reset does even so: it must never silently clear a
    // hand-authored value the matched starter simply has no opinion on
    // (ruling 38 fix b, below).
    const drift = computeContractDrift(projectDir, { forgeRoot, appType: 'typescript-cli' });
    assert.equal(drift.appType, 'typescript-cli', 'the explicitly requested appType is used — never guessed');

    // RULING 38 fix (b) — row-level invariant: no DriftReport row may carry
    // action:'regenerate' with an `after` of `undefined` (a delete wearing a
    // regenerate label). Asserted generically over every row so a FUTURE
    // section added to the regenerate set is covered automatically, not just
    // the three fields this fixture happens to exercise today.
    for (const row of drift.rows) {
      assert.ok(
        !(row.action === 'regenerate' && row.after === undefined),
        `row "${row.section}" carries action:'regenerate' with after:undefined — a delete wearing a regenerate label`,
      );
    }

    // The canary must never appear in the drift report itself.
    assert.equal(JSON.stringify(drift).includes(SECRET_CANARY), false, 'the drift report must never carry the secret VALUE');

    const result = applyContractReset(projectDir, drift);

    // --- Preservation: byte-identical -------------------------------------
    const rawAfter = JSON.parse(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(rawAfter.northStar, NORTH_STAR, 'northStar must survive byte-identical');
    assert.equal(rawAfter.instructions, INSTRUCTIONS, 'instructions must survive byte-identical');
    const tp = rawAfter.testProcess as { local?: { cmd?: string[] }; acceptance?: { requiresEnv?: string[] } };
    assert.deepEqual(
      tp.acceptance?.requiresEnv,
      [SECRET_NAME],
      'the secret NAME must survive byte-identical in testProcess.acceptance.requiresEnv',
    );

    // --- Regeneration: testProcess.local / demoProcess ---------------------
    assert.deepEqual(tp.local, { cmd: ['npm', 'test'] }, 'testProcess.local must regenerate to the typescript-cli starter value');
    assert.deepEqual(
      rawAfter.demoProcess,
      [
        { kind: 'capture', text: 'Build the CLI (npm run build) and note the before state.' },
        { kind: 'verify', text: 'Run npm run acceptance — the built binary vs a checked-in fixture.' },
      ],
      'demoProcess must regenerate to the typescript-cli starter steps',
    );

    // --- PRESERVATION (ruling 38 fix b): releaseProcess ---------------------
    // typescript-cli declares no releaseProcess at all — the starter has NO
    // OPINION here, so the project's own hand-authored value must survive
    // verbatim, never be cleared for want of a template section. This is
    // exactly the S3-beat scenario the shipped defect broke.
    const releaseRow = drift.rows.find((r) => r.section === 'releaseProcess');
    assert.ok(releaseRow, 'expected a releaseProcess row');
    assert.equal(releaseRow!.action, 'preserve', 'a section the matched starter simply lacks degrades to preserve, not regenerate');
    assert.deepEqual(
      rawAfter.releaseProcess,
      { steps: [{ kind: 'docs', phase: 'pre-merge', text: 'a stale release step' }] },
      'releaseProcess must survive byte-identical — the starter has no opinion, so its silence must never clear a hand-authored value',
    );

    // --- The secret VALUE never leaked anywhere the reset writes/returns --
    const projectJsonText = readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8');
    assert.equal(projectJsonText.includes(SECRET_CANARY), false, 'the written project.json must never carry the secret VALUE');
    assert.equal(JSON.stringify(result).includes(SECRET_CANARY), false, 'the ResetResult must never carry the secret VALUE');
    assert.equal(readFileSync(join(projectDir, 'secrets.env'), 'utf8'), secretsEnvBefore, 'secrets.env itself must be byte-identical — never written to');

    // --- Skills relocated (Q1) ---------------------------------------------
    assert.equal(existsSync(join(projectDir, '.forge', 'skills', 'ado-api-explorer', 'SKILL.md')), true, 'the skill must have moved to the resolver-scanned location');
    assert.equal(existsSync(join(projectDir, 'forge', 'skills', 'ado-api-explorer')), false, 'the drifted source directory must be gone');
    assert.equal(result.skillMovesApplied.length, 1);
    assert.equal(result.skillMovesApplied[0]?.id, 'ado-api-explorer');
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});
