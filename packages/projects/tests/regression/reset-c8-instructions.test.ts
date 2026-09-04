/**
 * Ruling 4 (T1/operator, binding) — `applyContractReset` NEVER generates an
 * agent-instruction file. C8 (`docs/forge-project-contract.md`) requires a
 * HUMAN-authored `AGENTS.md`/`CLAUDE.md` to be present and nothing more; the
 * precedent is the `hasAgentFile` guard at
 * `apps/forge/bridge-studio-writes.ts:2105-2112`. Two grounds, both regression-pinned
 * against a future "helpful" regeneration:
 *
 *   1. A project WITH an `AGENTS.md` — the file must survive byte-identical
 *      (never created, overwritten, or deleted), and the `instructions` FIELD
 *      in `.forge/project.json` — which `reset.ts` never references at all —
 *      must survive byte-identical too, even though `loadProjectConfig`
 *      overrides the LOADED VIEW of `instructions` from `AGENTS.md`'s content
 *      (a load-time projection, not a write).
 *   2. A project WITHOUT an `AGENTS.md`/`CLAUDE.md` — the reset must not
 *      create one (the `project-create.ts` `copyTemplate` shape this module
 *      deliberately does not reuse, per ruling 4), and the JSON `instructions`
 *      field survives byte-identical as the sole fallback source.
 *
 * RULING 38, M4-projects-reset (finding, not a chore): both fixtures have no
 * persisted `appType`, and neither `computeContractDrift` call passed one —
 * before fix (a) that silently guessed a starter; it now throws
 * `AppTypeUnresolvedError` instead (`reset-app-type-required.test.ts`). This
 * file's concern (AGENTS.md/instructions preservation, C8) is orthogonal to
 * which starter gets matched, so both calls now pass an explicit
 * `appType: 'typescript-cli'`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-c8-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

function writeConfig(dir: string, instructions: string): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      { name: 'c8-fixture', instructions, testProcess: { local: { cmd: ['echo', 'ok'] } } },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

test('a project WITH AGENTS.md: the file survives byte-identical and the JSON instructions field is untouched', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-c8-with-agents-'));
  try {
    const AGENTS_CONTENT = '# Project conventions\n\nThis file is human-authored. Do not regenerate it.\n';
    const JSON_INSTRUCTIONS = 'a stale fallback string, superseded by AGENTS.md at load time';
    writeFileSync(join(dir, 'AGENTS.md'), AGENTS_CONTENT, 'utf8');
    writeConfig(dir, JSON_INSTRUCTIONS);

    const drift = computeContractDrift(dir, { forgeRoot, appType: 'typescript-cli' });
    applyContractReset(dir, drift);

    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), AGENTS_CONTENT, 'AGENTS.md must survive byte-identical — never overwritten');
    assert.equal(existsSync(join(dir, 'CLAUDE.md')), false, 'no CLAUDE.md must be created alongside an existing AGENTS.md');

    const rawAfter = JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(rawAfter.instructions, JSON_INSTRUCTIONS, 'the JSON instructions field must survive byte-identical — reset.ts never references it');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a project WITHOUT an agent-instruction file: none is created by the reset, and the JSON instructions field is the untouched fallback', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-c8-without-agents-'));
  try {
    const JSON_INSTRUCTIONS = 'the only source of instructions this project has ever declared';
    writeConfig(dir, JSON_INSTRUCTIONS);
    assert.equal(existsSync(join(dir, 'AGENTS.md')), false, 'arrange: no AGENTS.md');
    assert.equal(existsSync(join(dir, 'CLAUDE.md')), false, 'arrange: no CLAUDE.md');

    const drift = computeContractDrift(dir, { forgeRoot, appType: 'typescript-cli' });
    applyContractReset(dir, drift);

    assert.equal(existsSync(join(dir, 'AGENTS.md')), false, 'the reset must never generate AGENTS.md — C8 stays human-authored');
    assert.equal(existsSync(join(dir, 'CLAUDE.md')), false, 'the reset must never generate CLAUDE.md either');

    const rawAfter = JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(rawAfter.instructions, JSON_INSTRUCTIONS, 'the JSON instructions field must survive byte-identical');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
