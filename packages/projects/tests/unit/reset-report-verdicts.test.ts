/**
 * bead forge-mfv5.3.1 — the drift report gains, per row, a `purpose` (one
 * sentence, from `reset-report.ts`'s ONE `SECTION_PURPOSE` table) and, for
 * exactly two element kinds, a `verdict`: 'skills' (skills-resolve — each
 * declared skill resolves to a real SKILL.md, reusing
 * `resolveDeclaredSkillPath`) and 'demoProcess' (demo-capture — the
 * declaration drives at least one checkpoint, reusing `checkDemoSkill`'s own
 * `extractDrivableCommand` rule). Every other section carries `purpose` only.
 *
 * Fixture: the S3 ground (a hand-authored Go/Terraform provider) — its own
 * seed is provenance-pinned, read-only; every test below copies it to a tmp
 * dir first, and only ever edits the copy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeContractDrift } from '../../reset.ts';
import { FORGE_ROOT } from '@forge/kernel';

const S3_FIXTURE_SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'stories', 'grounds', 'go-provider-old-contract', 'seed');

function copyS3Fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-report-fixture-'));
  cpSync(S3_FIXTURE_SEED, dir, { recursive: true });
  return dir;
}

function rewriteDemoProcess(dir: string, demoProcess: unknown): void {
  const configPath = join(dir, '.forge', 'project.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  raw.demoProcess = demoProcess;
  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

test('every row in the drift report carries a non-empty purpose', () => {
  const dir = copyS3Fixture();
  try {
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    assert.ok(drift.rows.length > 0, 'sanity: the report has rows at all');
    for (const row of drift.rows) {
      assert.equal(typeof row.purpose, 'string', `row "${row.section}" has no purpose string`);
      assert.ok(row.purpose.length > 0, `row "${row.section}"'s purpose must not be empty`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only skills and demoProcess rows carry a verdict; every other row carries purpose only', () => {
  const dir = copyS3Fixture();
  try {
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    for (const row of drift.rows) {
      if (row.section === 'skills' || row.section === 'demoProcess') {
        assert.ok(row.verdict, `row "${row.section}" must carry a verdict`);
      } else {
        assert.equal(row.verdict, undefined, `row "${row.section}" must NOT carry a verdict`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills-resolve verdict PASSES on the fixture\'s real (all-resolving) skills', () => {
  const dir = copyS3Fixture();
  try {
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.ok(skillsRow, 'expected a skills row');
    assert.equal(skillsRow!.verdict?.pass, true, `expected pass, got: ${skillsRow!.verdict?.detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills-resolve verdict FAILS and NAMES the missing path when one declared skill\'s SKILL.md is removed', () => {
  const dir = copyS3Fixture();
  try {
    // This ground's skills live under `forge/skills/<id>/` (artifactRoot:
    // "forge") — remove one entirely so it resolves nowhere at all.
    unlinkSync(join(dir, 'forge', 'skills', 'ado-api-explorer', 'SKILL.md'));
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.ok(skillsRow, 'expected a skills row');
    assert.equal(skillsRow!.verdict?.pass, false);
    assert.match(skillsRow!.verdict?.detail ?? '', /ado-api-explorer/, 'the verdict must name the missing skill id');
    assert.match(skillsRow!.verdict?.detail ?? '', /\.forge\/skills\/ado-api-explorer\/SKILL\.md/, 'the verdict must name the missing path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo-capture verdict PASSES on a declaration whose capture step names a runnable bare-argv command', () => {
  const dir = copyS3Fixture();
  try {
    rewriteDemoProcess(dir, [{ kind: 'capture', text: 'Run `npm test` to capture the checkpoint.' }, { kind: 'verify', text: 'Assert the output.' }]);
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    const demoRow = drift.rows.find((r) => r.section === 'demoProcess');
    assert.ok(demoRow, 'expected a demoProcess row');
    assert.equal(demoRow!.verdict?.pass, true, `expected pass, got: ${demoRow!.verdict?.detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo-capture verdict FAILS, carrying the shared rule\'s reason, when the capture command uses a shell metacharacter', () => {
  const dir = copyS3Fixture();
  try {
    rewriteDemoProcess(dir, [{ kind: 'capture', text: 'Run `npm run demo | tee out.txt` to capture the checkpoint.' }, { kind: 'verify', text: 'Assert the output.' }]);
    const drift = computeContractDrift(dir, { forgeRoot: FORGE_ROOT, appType: 'cli' });
    const demoRow = drift.rows.find((r) => r.section === 'demoProcess');
    assert.ok(demoRow, 'expected a demoProcess row');
    assert.equal(demoRow!.verdict?.pass, false);
    assert.match(demoRow!.verdict?.detail ?? '', /shell metacharacters/, 'the verdict must carry extractDrivableCommand\'s own reason');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
