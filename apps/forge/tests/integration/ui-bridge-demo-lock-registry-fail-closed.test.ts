/**
 * Row 206 (forge-8vfn.8.5.56) — `POST /api/demo-builder/lock`'s phase gate
 * FAILS CLOSED when the session-kinds registry cannot load: a 500 naming
 * the load error, never a silent allow and never a silent 409 refusal that
 * would read as an ordinary phase mismatch. Split into its own file rather
 * than grown onto `ui-bridge-demo-generations.test.ts` (at the 800-line cap).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import { FORGE_ROOT } from '@forge/kernel';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

function repoDir(): string {
  return join(forgeRoot, 'projects', 'demo');
}

function demoSessionDirFor(sid: string): string {
  return join(repoDir(), '_demo', sid);
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function readDemoStatus(sid: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(demoSessionDirFor(sid), 'status.json'), 'utf8'));
}

function patchDemoStatus(sid: string, patch: Record<string, unknown>): void {
  const current = readDemoStatus(sid);
  writeFileSync(join(demoSessionDirFor(sid), 'status.json'), JSON.stringify({ ...current, ...patch }, null, 2));
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-demo-lock-registry-'));
  mkdirSync(repoDir(), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), readFileSync(join(FORGE_ROOT, 'studio', 'session-kinds.yaml'), 'utf8'));
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('row 206: POST /lock FAILS CLOSED (500, naming the load error) when the session-kinds registry cannot load', async () => {
  const started = await post('/api/demo-builder/start', { project: 'demo' });
  const sid = started.json.sessionId as string;
  patchDemoStatus(sid, { phase: 'awaiting-review' });

  const yamlPath = join(forgeRoot, 'studio', 'session-kinds.yaml');
  const realYaml = readFileSync(yamlPath, 'utf8');
  try {
    writeFileSync(yamlPath, 'not: [valid, yaml, {{{');
    const { status, json } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid, generation: 1 });
    assert.equal(status, 500, `an unloadable registry must refuse 500, got ${status}: ${JSON.stringify(json)}`);
    assert.match(String(json.error), /session-kinds registry failed to load/, 'the 500 must name the registry load failure, not a generic error');
    assert.ok(!('selectedGeneration' in readDemoStatus(sid)), 'a failed-closed refusal must not mutate status.json');
  } finally {
    writeFileSync(yamlPath, realYaml);
  }
});

test('row 206: positive control — once the registry is restored, the SAME session still locks (200)', async () => {
  const started = await post('/api/demo-builder/start', { project: 'demo' });
  const sid = started.json.sessionId as string;
  patchDemoStatus(sid, { phase: 'awaiting-review' });
  const { status, json } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid, generation: 1 });
  assert.equal(status, 200, `a real registry must still allow a well-phased lock, got ${status}: ${JSON.stringify(json)}`);
});
