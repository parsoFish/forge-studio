/**
 * W7-B6 WI-2 — `forge project migrate` pins (projects-01).
 *
 * The fixture is the REAL gitpulse shape (flat quality_gate_cmd +
 * acceptance_gate with requires_env + $comment keys + unknown legacy blocks) —
 * the exact config that 409'd contract-stages on the canonical verify-cycle
 * ground. Killed implementations: a migrate that drops unknown/$comment keys;
 * one that writes before validating; one that "merges" when testProcess
 * already exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateProjectConfig } from './project-migrate.ts';
import { loadProjectConfig } from './project-config.ts';

function plantProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'pmigrate-'));
  mkdirSync(join(root, '.forge'), { recursive: true });
  writeFileSync(join(root, '.forge', 'project.json'), JSON.stringify(config, null, 2), 'utf8');
  return root;
}

const GITPULSE_SHAPE: Record<string, unknown> = {
  name: 'gitpulse',
  $comment: 'contract config — mirrors the real gitpulse file',
  northStar: 'honest engineering analytics',
  quality_gate_cmd: ['npm', 'test'],
  $acceptance_gate_comment: 'creds-free acceptance tier',
  acceptance_gate: { match: 'acceptance', required: true, requires_env: [] },
  standing_work_item_acs: ['Acceptance read-back holds.'],
  demo: { shape: 'cli-diff', command: ['npm', 'run', 'demo'], baseline: 'main' },
  skills: ['git-log-analysis'],
  kb: 'gitpulse',
  artifactRoot: 'forge',
};

test('AT-B6-7 migrate: the gitpulse shape → typed testProcess; unknown + $comment keys preserved; loader accepts the result', () => {
  const root = plantProject(GITPULSE_SHAPE);
  try {
    const out = migrateProjectConfig(root);
    assert.ok(out.ok, `expected ok — got ${JSON.stringify(out)}`);
    assert.ok(out.ok && out.moved.some((m) => m.startsWith('quality_gate_cmd')), 'quality_gate_cmd must be reported moved');
    assert.ok(out.ok && out.moved.some((m) => m.startsWith('acceptance_gate')), 'acceptance_gate must be reported moved');

    const after = JSON.parse(readFileSync(join(root, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(after['quality_gate_cmd'], undefined, 'flat key removed');
    assert.equal(after['acceptance_gate'], undefined, 'flat key removed');
    const tp = after['testProcess'] as Record<string, unknown>;
    assert.deepEqual(tp['local'], { cmd: ['npm', 'test'] });
    assert.deepEqual(tp['acceptance'], { match: 'acceptance', required: true, requiresEnv: [] }, 'requires_env renamed to requiresEnv');
    // Preservation: unknown/legacy/$comment keys survive byte-for-value.
    assert.equal(after['$comment'], GITPULSE_SHAPE['$comment']);
    assert.deepEqual(after['demo'], GITPULSE_SHAPE['demo']);
    assert.deepEqual(after['skills'], ['git-log-analysis']);
    assert.equal(after['artifactRoot'], 'forge');

    // The REAL consumer accepts the migrated file (not just our own validator
    // call): loadProjectConfig no longer throws the R1-03 migration error.
    const loaded = loadProjectConfig(root);
    assert.ok(loaded !== null);
    assert.deepEqual(loaded?.quality_gate_cmd, ['npm', 'test'], 'derived flat accessor reads through testProcess');
    assert.equal(loaded?.acceptance_gate?.match, 'acceptance');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-8 migrate: idempotent — a second run reports nothing-to-migrate and leaves the file byte-unchanged', () => {
  const root = plantProject(GITPULSE_SHAPE);
  try {
    assert.ok(migrateProjectConfig(root).ok);
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const second = migrateProjectConfig(root);
    assert.ok(!second.ok && second.reason === 'nothing-to-migrate', `got ${JSON.stringify(second)}`);
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'no second write');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-9 migrate: flat keys ALONGSIDE testProcess → conflict refusal, file untouched', () => {
  const root = plantProject({ name: 'x', testProcess: { local: { cmd: ['npm', 'test'] } }, quality_gate_cmd: ['make', 'check'] });
  try {
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const out = migrateProjectConfig(root);
    assert.ok(!out.ok && out.reason === 'conflict', `got ${JSON.stringify(out)}`);
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'a conflict must not write');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-16 (RED, review F3) migrate: a present-but-unmappable flat key (string ci_gate) is REFUSED, never silently deleted', () => {
  // The mapping loops only handled Array shapes, but the FLAT_KEYS delete
  // loop removed every flat key unconditionally — a string ci_gate (a
  // plausible hand-edit) was deleted, validation still passed, and an
  // ok:true write silently lost the operator's CI gate.
  const root = plantProject({ name: 'x', quality_gate_cmd: ['npm', 'test'], ci_gate: 'npm run ci' });
  try {
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const out = migrateProjectConfig(root);
    assert.ok(!out.ok, `an unmappable flat key must refuse — got ${JSON.stringify(out)}`);
    assert.ok(!out.ok && out.reason === 'unmappable', `reason must be 'unmappable' — got ${JSON.stringify(out)}`);
    assert.ok(!out.ok && out.message.includes('ci_gate'), 'the refusal must NAME the unmappable key');
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'an unmappable config must not be written');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-17 (RED, review F3) migrate: acceptance_gate subkeys beyond match/required/requires_env are REFUSED, never silently dropped', () => {
  // The acceptance_gate mapper kept only match/required/requiresEnv — a
  // $comment or timeoutMs INSIDE the gate object vanished from an ok:true
  // write. The tool's contract is preserve-byte-for-value; anything it cannot
  // carry over must refuse, not delete.
  const root = plantProject({
    name: 'x',
    quality_gate_cmd: ['npm', 'test'],
    acceptance_gate: { match: 'acceptance', required: true, requires_env: [], $comment: 'live tier', timeoutMs: 60000 },
  });
  try {
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const out = migrateProjectConfig(root);
    assert.ok(!out.ok && out.reason === 'unmappable', `extra acceptance_gate keys must refuse — got ${JSON.stringify(out)}`);
    assert.ok(!out.ok && out.message.includes('$comment') && out.message.includes('timeoutMs'), 'the refusal must NAME the unmappable subkeys');
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'file untouched on refusal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-18 (RED, review F3) migrate: a non-object acceptance_gate (string) is REFUSED, never deleted', () => {
  const root = plantProject({ name: 'x', quality_gate_cmd: ['npm', 'test'], acceptance_gate: 'acceptance' });
  try {
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const out = migrateProjectConfig(root);
    assert.ok(!out.ok && out.reason === 'unmappable', `a non-object acceptance_gate must refuse — got ${JSON.stringify(out)}`);
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'file untouched on refusal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-10 migrate: a migration that would fail validation writes NOTHING (validate-before-write)', () => {
  // acceptance_gate with a non-string match — mapping it produces an invalid
  // testProcess.acceptance; the migrate must refuse and leave the file as-is.
  const root = plantProject({ name: 'x', quality_gate_cmd: ['npm', 'test'], acceptance_gate: { match: 42, required: true } });
  try {
    const bytes = readFileSync(join(root, '.forge', 'project.json'), 'utf8');
    const out = migrateProjectConfig(root);
    assert.ok(!out.ok && out.reason === 'validation-failed', `got ${JSON.stringify(out)}`);
    assert.equal(readFileSync(join(root, '.forge', 'project.json'), 'utf8'), bytes, 'an invalid migration must not write');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
