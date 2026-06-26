/**
 * Stage D — bridge integration tests for the preflight resolution routes
 * (fix-auto / fix-agent / fix-agent status). FORGE_ARCHITECT_NO_SPAWN=1 pins the
 * USER-tier route so it returns a runId without launching a real SDK agent.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let projectId: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

async function post(path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'pf-resolve-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  // A non-git typescript project that fails C2/ARTIFACTS/C4 (auto), C5/C8 (user/agent).
  projectId = 'demoproj';
  const projectDir = join(forgeRoot, 'projects', projectId);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"name":"demoproj"}');
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST preflight/fix-auto applies deterministic fixes + returns updated clauses', async () => {
  const { status, json } = await post(`/api/studio/projects/${projectId}/preflight/fix-auto`);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  const applied = json.applied as Array<{ clause: string; cleared: boolean }>;
  assert.ok(applied.some((a) => a.clause === 'C4' && a.cleared), 'C4 scaffolded + cleared');
  assert.ok(existsSync(join(forgeRoot, 'projects', projectId, 'roadmap.md')), 'roadmap scaffolded');
  const clauses = json.clauses as Array<{ id: string; pass: boolean }>;
  assert.equal(clauses.find((c) => c.id === 'C4')?.pass, true, 'C4 now passes in returned clauses');
});

test('POST preflight/fix-agent on a USER-tier clause spawns preflight-fix → runId', async () => {
  const { status, json } = await post(`/api/studio/projects/${projectId}/preflight/fix-agent`, {
    clauseId: 'C5',
    instruction: 'forge honours git ownership; never edit tests.',
  });
  assert.equal(status, 200);
  assert.equal(json.resolution, 'user');
  assert.equal(json.route, 'preflight-fix');
  assert.ok(typeof json.runId === 'string' && (json.runId as string).includes('C5'));
});

test('POST preflight/fix-agent on an AGENT-tier clause returns a route (no spawn)', async () => {
  const { status, json } = await post(`/api/studio/projects/${projectId}/preflight/fix-agent`, { clauseId: 'C8' });
  assert.equal(status, 200);
  assert.equal(json.resolution, 'agent');
  assert.equal(json.route, 'instructions');
});

test('POST preflight/fix-agent on an AUTO-tier clause → 400 (use fix-auto)', async () => {
  const { status } = await post(`/api/studio/projects/${projectId}/preflight/fix-agent`, { clauseId: 'C2' });
  assert.equal(status, 400);
});

test('GET preflight/fix-agent/:runId returns a state', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects/${projectId}/preflight/fix-agent/demoproj-C5-abc`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.ok, true);
  assert.ok(['running', 'cleared', 'not-cleared', 'failed'].includes(json.state as string));
});
