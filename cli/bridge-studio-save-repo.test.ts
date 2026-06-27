/**
 * R1-2 — bridge integration test for the project-repo write transaction: a
 * forge-UI write (PUT project.json) commits to forge-studio; save-repo merges it
 * into main. Project is a real git repo so the tx is exercised end-to-end.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let projectDir: string;
const PROJECT = 'demoproj';
let bridgeUrl: string;
let closeServer: () => Promise<void>;

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

async function put(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

before(async () => {
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'save-repo-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ quality_gate_cmd: ['npm', 'test'], northStar: 'old' }));
  // Make it a git repo with a main branch + initial commit.
  execFileSync('git', ['-C', projectDir, 'init', '-b', 'main'], { stdio: 'ignore' });
  g(projectDir, ['config', 'user.email', 'test@forge.dev']);
  g(projectDir, ['config', 'user.name', 'Forge Test']);
  g(projectDir, ['add', '-A']);
  g(projectDir, ['commit', '-m', 'init']);
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('PUT project.json is one durable save — written + merged to main + on main', async () => {
  const upd = await put(`/api/studio/projects/${PROJECT}`, { northStar: 'a new north star' });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  // The single "Save project" merges forge-studio → main (no remote → local) and
  // rests on main, branch removed.
  assert.equal((upd.json.save as { merged: boolean }).merged, true);
  assert.equal(g(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.match(g(projectDir, ['show', 'main:.forge/project.json']), /a new north star/);
  const after = await getJson(`/api/studio/projects/${PROJECT}/repo-status`);
  assert.equal(after.pending, false);
});

test('save succeeds when quality_gate_cmd lives in the sidecar, not project.json', async () => {
  // betterado's shape: project.json omits quality_gate_cmd; the gate is in the
  // .forge/quality_gate_cmd sidecar. The save must validate via the sidecar.
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ northStar: 'sidecar project' }));
  writeFileSync(join(projectDir, '.forge', 'quality_gate_cmd'), 'go test -tags all ./pkg/...');
  g(projectDir, ['add', '-A']);
  g(projectDir, ['commit', '-m', 'switch to sidecar gate']);

  const upd = await put(`/api/studio/projects/${PROJECT}`, { kb: `${PROJECT}-brain` });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.match(g(projectDir, ['show', 'main:.forge/project.json']), /sidecar project/);
  // project.json still does NOT mirror the gate (single source preserved).
  assert.equal(g(projectDir, ['show', 'main:.forge/project.json']).includes('quality_gate_cmd'), false);
});
