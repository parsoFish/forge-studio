/**
 * forge-mfv5.1.32 — the project page authors `demoMeans` and `testProcess.acceptance` through the
 * ONE durable Save. gitweave I2 had to hand-edit both into `.forge/project.json` in the ground
 * (Studio had no surface for either). The values below are gitweave's own declarations, copied.
 * Real git project, the real bridge, no network.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

const PROJECT = 'gitweave';
const LOCAL = { cmd: ['python3', '-m', 'pytest', 'tests/test_structure.py'] };
const DEMO_MEANS = {
  commands: ['gw plan'],
  api: { commands: ['gw apply --json', 'gw org show --json', 'gw org repos --json'], ignoreKeys: ['default_branch_sha'] },
};
const ACCEPTANCE = { match: 'tests/acceptance', requiresEnv: ['GW_ORG', 'GW_APP_ID', 'GW_APP_INSTALLATION_ID', 'GW_APP_PRIVATE_KEY_PATH'] };

let forgeRoot: string;
let projectDir: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

const g = (dir: string, args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const onMain = (): Record<string, unknown> => JSON.parse(g(projectDir, ['show', 'main:.forge/project.json'])) as Record<string, unknown>;
async function put(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}/api/studio/projects/${PROJECT}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'project-declarations-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: LOCAL }, northStar: 'n' }));
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

test('Save writes demoMeans and testProcess.acceptance to project.json on main, keeping testProcess.local', async () => {
  const r = await put({ demoMeans: DEMO_MEANS, acceptance: ACCEPTANCE });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cfg = onMain();
  assert.deepEqual(cfg.demoMeans, DEMO_MEANS);
  assert.deepEqual((cfg.testProcess as Record<string, unknown>).acceptance, ACCEPTANCE);
  assert.deepEqual((cfg.testProcess as Record<string, unknown>).local, LOCAL);
});

test('the roster serves both back to the project page', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`);
  const body = (await res.json()) as { projects?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const list = Array.isArray(body) ? body : body.projects ?? [];
  const p = list.find((x) => x.id === PROJECT)!;
  assert.deepEqual(p.demoMeans, DEMO_MEANS);
  assert.deepEqual(p.acceptance, ACCEPTANCE);
});

test('refusal: an acceptance tier without a match is refused by name; project.json is untouched', async () => {
  const before = readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8');
  const r = await put({ acceptance: { requiresEnv: ['GW_ORG'] } });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /testProcess\.acceptance\.match` must be a non-empty string/);
  assert.equal(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'), before);
});

test('refusal: a demo means command with shell metacharacters is refused by name', async () => {
  const r = await put({ demoMeans: { commands: ['gw plan | tee out'] } });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /demoMeans\.commands\[0\].*shell metacharacters/);
});

test('refusal: an acceptance tier carrying any key beyond match/requiresEnv is refused by name', async () => {
  const r = await put({ acceptance: { ...ACCEPTANCE, required: true } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'acceptance carries required — only match and requiresEnv are edited here');
});

test('null clears either declaration; a Save that omits both leaves them alone', async () => {
  assert.equal((await put({ northStar: 'still n' })).status, 200);
  assert.deepEqual(onMain().demoMeans, DEMO_MEANS, 'omitted ⇒ untouched');
  assert.equal((await put({ demoMeans: null, acceptance: null })).status, 200);
  const cfg = onMain();
  assert.equal('demoMeans' in cfg, false);
  assert.equal('acceptance' in (cfg.testProcess as Record<string, unknown>), false);
  assert.deepEqual((cfg.testProcess as Record<string, unknown>).local, LOCAL);
});
