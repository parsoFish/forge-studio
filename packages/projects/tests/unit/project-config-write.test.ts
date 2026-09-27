/**
 * `writeProjectConfigPatch` — the one `.forge/project.json` merge-writer (the
 * Studio project PUT and the demo-builder lock both write through it, bead
 * forge-mfv5.2.8) — and `validateDemoDeclaration`, the lock's gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectConfigWriteError, writeProjectConfigPatch } from '../../project-config-write.ts';
import { validateDemoDeclaration } from '../../preflight-demo.ts';

function project(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'project-config-write-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify(config));
  return dir;
}

const readConfig = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8')) as Record<string, unknown>;

const DECLARATION = [
  { kind: 'capture', text: 'Run `node bin/cli.js --help` on both trees.' },
  { kind: 'verify', text: 'The new flag is listed.' },
];

test('a patch replaces only the keys it names — every other key survives unchanged', () => {
  const before = {
    testProcess: { local: { cmd: ['npm', 'test'] }, ci: { cmd: ['npm', 'run', 'ci'] } },
    northStar: 'Ship it.',
    name: 'kept',
    skills: ['demo-design'],
    demoProcess: [{ kind: 'capture', text: 'old' }],
  };
  const dir = project(before);
  const { previous } = writeProjectConfigPatch(dir, () => ({ demoProcess: DECLARATION }), 'test: write');
  assert.deepEqual(previous, before, 'the caller is handed what was on disk before the write');
  assert.deepEqual(readConfig(dir), { ...before, demoProcess: DECLARATION });
});

test('a sidecar-sourced gate validates but is never written into project.json', () => {
  const dir = project({ testProcess: { local: { timeoutMs: 1000 } } });
  writeFileSync(join(dir, '.forge', 'quality_gate_cmd'), 'npm test\n');
  writeProjectConfigPatch(dir, () => ({ demoProcess: DECLARATION }), 'test: write');
  assert.deepEqual(readConfig(dir).testProcess, { local: { timeoutMs: 1000 } });
});

test('a merged config that fails validation throws and writes nothing', () => {
  const before = { testProcess: { local: { cmd: ['npm', 'test'] } } };
  const dir = project(before);
  assert.throws(
    () => writeProjectConfigPatch(dir, () => ({ demoProcess: [{ kind: 'nonsense', text: 'x' }] }), 'test: write'),
    (err: unknown) => err instanceof ProjectConfigWriteError && err.reason === 'invalid' && /demoProcess\[0\]\.kind/.test(err.message),
  );
  assert.deepEqual(readConfig(dir), before);
});

test('validateDemoDeclaration: a drivable declaration passes with its parsed steps', () => {
  assert.deepEqual(validateDemoDeclaration(DECLARATION), { ok: true, steps: DECLARATION });
});

test('validateDemoDeclaration: a malformed declaration is refused with the schema reason', () => {
  const result = validateDemoDeclaration({ steps: [] });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /demoProcess must be an array/);
});

test('validateDemoDeclaration: a well-formed but undrivable declaration is refused with the drive rule reason', () => {
  const result = validateDemoDeclaration([{ kind: 'capture', text: 'Show it somehow.' }]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /no inline-code span to run/);
});
