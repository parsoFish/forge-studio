/**
 * ACCEPTANCE TEST (projects-37, S1) — the onboard → configure loop, end to end
 * through the real bridge.
 *
 * An operator who onboards a brand-new project through "Onboard a project"
 * with NO existing repo path (the default) could never save a single edit
 * afterwards: every "Save project" 500'd and silently discarded the edit,
 * with no in-Studio remedy (save-repo silently no-ops, preflight fix-auto
 * best-effort-swallows the same failure) — only a manual `git commit` from a
 * shell outside Studio, contradicting ADR-031.
 *
 * Chain: `scaffoldContractArtifacts` runs `git init` for the fresh dir but
 * makes no initial commit, so the repo is UNBORN (zero commits) →
 * `defaultBranch()` falls back to the literal 'main' (no such ref) →
 * `ensureStudioBranch()` runs `git checkout -b forge-studio main`, fatal →
 * the throw propagates out of `withStudioWrite` (apps/forge/bridge-studio-writes.ts,
 * the PUT handler) to the route's outer catch → 500, and the file write inside
 * `applyFn` never runs.
 *
 * W7-B6 WI-1 (1d7b0fde, PR #188) is what made this reachable: before it the
 * git-init probe was `rev-parse --is-inside-work-tree`, true for ANY dir
 * nested inside forge's own checkout, so `git init` NEVER actually ran and
 * every onboarded project silently inherited forge's already-committed repo.
 * Its tests (apps/forge/onboard-git-init.test.ts) assert only that `git init` ran and
 * a `.gitignore` was scaffolded — which is exactly why this regression shipped
 * unpinned. This AT asserts the OPERATOR outcome instead: the FIRST
 * `PUT /api/studio/projects/:id` after onboarding returns 200 and the edit is
 * actually on disk.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'projects37-onboard-save-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function call(method: 'POST' | 'PUT', path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

test('AT-projects-37 (RED) the FIRST "Save project" after onboarding a brand-new project (no existing repo) must succeed', async () => {
  const id = 'fresh-onboard-save';
  const projectRoot = join(forgeRoot, 'projects', id);

  // 1. Onboard through the real route, with NO repoPath — the default form
  //    path that creates `projects/<id>` from nothing.
  const onboard = await call('POST', '/api/studio/projects', {
    name: id,
    qualityGateCmd: 'npm test',
    northStar: 'ORIGINAL north star — set at onboarding time',
  });
  assert.ok(onboard.status === 200 || onboard.status === 201, `onboarding must succeed — got ${onboard.status}: ${onboard.text}`);

  // 2. Precondition: the onboarded project really is its own git repo (the
  //    W7-B6 rule). Without this the AT could pass for the wrong reason (an
  //    inherited repo that already has commits).
  assert.ok(existsSync(join(projectRoot, '.git')), 'precondition: the onboarded project must be its own git repo');

  const before = readFileSync(join(projectRoot, '.forge', 'project.json'), 'utf8');
  assert.match(before, /ORIGINAL north star/, 'precondition: onboarding stored the original north star');

  // 3. The decisive step: the operator edits the north star and clicks Save.
  const save = await call('PUT', `/api/studio/projects/${id}`, {
    qualityGateCmd: 'npm test',
    northStar: 'EDITED north star — the operator just typed this',
  });
  assert.equal(save.status, 200, `the first Save project after onboarding must return 200 — got ${save.status}: ${save.text}`);

  // 4. ...and the edit must actually be on disk, not silently discarded.
  const after = readFileSync(join(projectRoot, '.forge', 'project.json'), 'utf8');
  assert.match(after, /EDITED north star/, 'the saved north star must be persisted to .forge/project.json');
});

test('AT-projects-37 (loop) a freshly onboarded project is left on a real branch with the save committed', async () => {
  const id = 'fresh-onboard-loop';
  const projectRoot = join(forgeRoot, 'projects', id);

  const onboard = await call('POST', '/api/studio/projects', {
    name: id,
    qualityGateCmd: 'npm test',
    northStar: 'first',
  });
  assert.ok(onboard.status === 200 || onboard.status === 201, `onboarding must succeed — got ${onboard.status}: ${onboard.text}`);

  const g = (args: string[]): string =>
    execFileSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' }).trim();

  // Two saves in a row — the loop the operator actually runs. Both must 200,
  // and the second must see the first one's value merged/committed rather than
  // wedged on an unborn HEAD.
  for (const value of ['second', 'third']) {
    const r = await call('PUT', `/api/studio/projects/${id}`, { qualityGateCmd: 'npm test', northStar: value });
    assert.equal(r.status, 200, `save "${value}" must return 200 — got ${r.status}: ${r.text}`);
    assert.match(readFileSync(join(projectRoot, '.forge', 'project.json'), 'utf8'), new RegExp(`"${value}"`));
    // The DURABLE save (R1-2): forge-studio really merged into the project's
    // default branch. On an unborn repo `saveProjectRepo` cannot check out a
    // default branch that has no ref, so this reports a swallowed git error
    // instead of a merge — the save "succeeds" while the durable-save contract
    // is quietly broken for every onboarded project.
    const body = JSON.parse(r.text) as { save?: { merged: boolean; detail: string } };
    assert.equal(body.save?.merged, true, `the durable save must merge forge-studio into the default branch — got: ${JSON.stringify(body.save)}`);
  }

  // The repo has real history — no unborn HEAD left behind.
  assert.notEqual(g(['rev-list', '--all', '--count']), '0', 'the project repo must carry commits after onboarding + saves');
  assert.ok(g(['status', '--porcelain']).length >= 0);
});
