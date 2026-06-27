/**
 * R1-3b — bridge integration test for the project-brain builder ops. With
 * FORGE_ARCHITECT_NO_SPAWN=1 the runner isn't actually spawned, so the test
 * drives the session-state transitions through the bridge.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
const PROJECT = 'demoproj';
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

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

before(async () => {
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-bridge-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  const projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ quality_gate_cmd: ['npm', 'test'] }));
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('start → briefing; brief → analyzing; session is listed', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const sessionId = started.json.sessionId as string;
  assert.ok(sessionId);

  let sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string }>;
  let mine = sessions.find((s) => s.session_id === sessionId);
  assert.equal(mine?.phase, 'briefing');

  const briefed = await post('/api/project-brain/brief', { project: PROJECT, sessionId, brief: 'focus on conventions' });
  assert.equal(briefed.status, 200);
  sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string; prompt: string }>;
  mine = sessions.find((s) => s.session_id === sessionId);
  assert.equal(mine?.phase, 'analyzing', 'brief transitions to analyzing (agent spawn suppressed in test)');

  // No staged themes yet (no real agent ran).
  const themes = (await getJson(`/api/project-brain/themes/${PROJECT}/${sessionId}`)).themes as unknown[];
  assert.deepEqual(themes, []);
});

test('abandon transitions the session to abandoned', async () => {
  const started = await post('/api/project-brain/start', { project: PROJECT });
  const sessionId = started.json.sessionId as string;
  const r = await post('/api/project-brain/abandon', { project: PROJECT, sessionId });
  assert.equal(r.status, 200);
  const sessions = (await getJson('/api/project-brain/sessions')).sessions as Array<{ session_id: string; phase: string }>;
  assert.equal(sessions.find((s) => s.session_id === sessionId)?.phase, 'abandoned');
});

test('start without project → 400', async () => {
  const r = await post('/api/project-brain/start', {});
  assert.equal(r.status, 400);
});
