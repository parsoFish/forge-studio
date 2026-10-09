/**
 * forge-mfv5.1.12 — onboarding writes land on `forge-studio`, never loose in the ground.
 *
 * Found on gitweave (capstone A, 2026-10-09): `POST /api/studio/projects` wrote
 * `.forge/project.json` (and scaffold stubs) into an existing clone and committed
 * nothing, so the contract lived only in the working tree and a later Save pushed
 * main without it. After onboarding the ground's working tree is clean and
 * `forge-studio` holds the contract.
 *
 * The cross-package deps are minimal fakes (the same reason as
 * bridge-studio-project-onboard.test.ts's header: this package cannot import
 * `@forge/knowledge` / `@forge/flows`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { makeOnboardHandlers, type OnboardDeps } from '../../bridge-studio-project-onboard.ts';
import { STUDIO_BRANCH } from '../../project-repo-tx.ts';
import type { RouteContext } from '@forge/kernel';

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function deps(): OnboardDeps {
  return {
    seedBrain: (forgeRoot, projectId) => {
      const brainDir = join(forgeRoot, 'brain', 'projects', projectId);
      mkdirSync(brainDir, { recursive: true });
      writeFileSync(join(brainDir, 'kb.yaml'), `id: ${projectId}\n`);
      return { projectId, brainDir, files: [{ path: `brain/projects/${projectId}/kb.yaml`, action: 'created' }] };
    },
    checkBrainSeedContainment: () => {},
    readArtifactRoot: () => '.',
    isContainedProjectRepoPath: (p, opts) => {
      const root = resolve(opts.projectsRoot ?? join(opts.forgeRoot, 'projects'));
      return resolve(p).startsWith(root + sep);
    },
  };
}

async function onboard(forgeRoot: string, name: string): Promise<{ status: number | null; body: Record<string, unknown> }> {
  let status: number | null = null;
  let payload = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(p?: string) { if (p !== undefined) payload = p; return res; },
  } as unknown as ServerResponse;
  const ctx: RouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => ({ name, qualityGateCmd: 'pytest -q' }) };
  await makeOnboardHandlers(deps()).handleProjectsOnboard({ headers: {} } as IncomingMessage, res, ctx, '/api/studio/projects', 'POST');
  return { status, body: JSON.parse(payload) as Record<string, unknown> };
}

/** A forge root holding an existing clone (its own repo, one commit) — the gitweave shape. */
function forgeRootWithClone(id: string): { forgeRoot: string; ground: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-tx-'));
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  const ground = join(forgeRoot, 'projects', id);
  mkdirSync(ground, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', ground]);
  g(ground, ['config', 'user.email', 't@forge.dev']);
  g(ground, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(ground, 'README.md'), '# clone\n');
  g(ground, ['add', 'README.md']);
  g(ground, ['commit', '-q', '-m', 'init']);
  return { forgeRoot, ground };
}

test('onboarding an existing clone leaves its working tree clean, the contract committed on forge-studio, main untouched', async () => {
  const { forgeRoot, ground } = forgeRootWithClone('weave');
  try {
    // The operator hand-wrote the roadmap before onboarding (capstone 14:01) — onboarding adopts it.
    writeFileSync(join(ground, 'roadmap.md'), '# weave — Roadmap\n\n- I1\n');
    const mainBefore = g(ground, ['rev-parse', 'main']);

    const r = await onboard(forgeRoot, 'weave');

    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(g(ground, ['status', '--porcelain', '--untracked-files=all']), '', 'onboarding leaves nothing uncommitted');
    assert.equal(g(ground, ['rev-parse', '--abbrev-ref', 'HEAD']), STUDIO_BRANCH);
    const onStudio = g(ground, ['ls-tree', '-r', '--name-only', STUDIO_BRANCH]).split('\n');
    assert.ok(onStudio.includes('.forge/project.json'), onStudio.join(','));
    assert.ok(onStudio.includes('roadmap.md'), onStudio.join(','));
    assert.equal(g(ground, ['rev-parse', 'main']), mainBefore, 'main moves only on Save');
    assert.match(g(ground, ['log', '-1', '--pretty=%s', STUDIO_BRANCH]), /^chore\(forge\): onboard weave contract$/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboarding a bare directory (repo created by the scaffold) also ends clean, with project.json committed', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-tx-'));
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  try {
    const r = await onboard(forgeRoot, 'fresh');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ground = join(forgeRoot, 'projects', 'fresh');
    assert.equal(g(ground, ['status', '--porcelain', '--untracked-files=all']), '');
    assert.ok(g(ground, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').includes('.forge/project.json'));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
