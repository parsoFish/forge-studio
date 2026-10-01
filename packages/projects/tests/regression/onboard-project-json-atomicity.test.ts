/**
 * G4 (bead forge-8vfn.8.5.4) — split out of
 * ../integration/bridge-studio-project-onboard.test.ts (which grew past the
 * 800-line baseline cap — see scripts/baselines/file-size.json /
 * check-file-size.mjs) when this case landed.
 *
 * Onboard writes sequentially into the FINAL project dir with no staging:
 * mkdir -> scaffoldContractArtifacts -> seedBrain -> .forge/project.json (now
 * written via tmp-file + rename, the atomic-write fix). `.forge/project.json`'s
 * presence is the ONLY thing that makes `discoverProjects`/`hasConfig` call
 * this dir "managed", so a crash anywhere BEFORE it leaves a dir a retry must
 * tolerate and complete. Injects the failure at `seedBrain` (the step right
 * before the project.json write) via the already-injected `OnboardDeps` port
 * — no monkeypatching needed.
 *
 * Uses a MINIMAL hand-rolled `OnboardDeps`, not the sibling integration
 * file's full `fakeDeps()` — this one test needs only a toggled `seedBrain`
 * plus just-enough-to-pass-containment stand-ins for the other three ports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { makeOnboardHandlers, type OnboardDeps } from '../../bridge-studio-project-onboard.ts';
import { discoverProjects, type RouteContext } from '@forge/kernel';

type Captured = { status: number | null; body: string };

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function ctx(forgeRoot: string, body?: unknown): RouteContext {
  return {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    readBody: async () => {
      if (body === undefined) throw new Error('readBody() called by a handler this test gave no body');
      return body;
    },
  };
}

function baseForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-atomic-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  return forgeRoot;
}

/** Just enough `OnboardDeps` for this one onboard call to reach `seedBrain`:
 *  a no-op containment check, a trivial artifact root, and a lexical
 *  containment stand-in for `isContainedProjectRepoPath` (mirrors the
 *  integration suite's own fake — see that file's header for why a lexical
 *  check is sufficient here, not a re-proof of flows' own escape coverage). */
function minimalDeps(seedBrain: OnboardDeps['seedBrain']): OnboardDeps {
  return {
    seedBrain,
    checkBrainSeedContainment: () => {},
    readArtifactRoot: () => '.',
    isContainedProjectRepoPath: (p, opts) => {
      const root = resolve(opts.projectsRoot ?? join(opts.forgeRoot, 'projects'));
      const resolved = resolve(p);
      return resolved === root || resolved.startsWith(root + sep);
    },
  };
}

test('G4 (forge-8vfn.8.5.4) onboard: a crash AFTER scaffold but BEFORE project.json leaves a dir the REAL discovery function does not treat as managed, and a re-run succeeds', async () => {
  const forgeRoot = baseForgeRoot();
  const id = 'crashmid';
  try {
    let seedBrainCalls = 0;
    const deps = minimalDeps((fr, projectId, name, opts?: { dirName?: string }) => {
      seedBrainCalls++;
      if (seedBrainCalls === 1) {
        throw new Error('G4 injected: seedBrain fails after scaffoldContractArtifacts, before .forge/project.json is written');
      }
      const dirName = opts?.dirName ?? projectId;
      const brainDir = join(fr, 'brain', 'projects', dirName);
      mkdirSync(brainDir, { recursive: true });
      writeFileSync(join(brainDir, 'kb.yaml'), `id: ${projectId}\n`);
      writeFileSync(join(brainDir, 'profile.md'), `# ${name}\n`);
      return {
        projectId,
        brainDir,
        files: [
          { path: `brain/projects/${dirName}/kb.yaml`, action: 'created' as const },
          { path: `brain/projects/${dirName}/profile.md`, action: 'created' as const },
        ],
      };
    });
    const { handleProjectsOnboard } = makeOnboardHandlers(deps);

    const first = mockRes();
    const firstAnswered = await handleProjectsOnboard(
      mockReq(), first.res, ctx(forgeRoot, { name: id, qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(firstAnswered, true);
    assert.equal(first.captured.status, 500, `the injected failure must surface as an error, got ${first.captured.status} body=${first.captured.body}`);

    const projectDir = join(forgeRoot, 'projects', id);
    assert.ok(existsSync(projectDir), 'precondition: the partial scaffold landed on disk (mkdir + scaffoldContractArtifacts already ran)');
    assert.ok(!existsSync(join(projectDir, '.forge', 'project.json')), 'precondition: no project.json yet — the crash landed before it');

    const beforeRetry = discoverProjects(join(forgeRoot, 'projects'), forgeRoot).find((p) => p.id === id);
    assert.ok(
      beforeRetry === undefined || beforeRetry.hasConfig === false,
      'a crash before project.json must NOT read as a managed project to the REAL discovery function',
    );

    // Re-run — must tolerate the files it wrote itself (mkdir/scaffold are
    // idempotent) and succeed this time (seedBrainCalls is now 2).
    const retry = mockRes();
    const retryAnswered = await handleProjectsOnboard(
      mockReq(), retry.res, ctx(forgeRoot, { name: id, qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(retryAnswered, true);
    assert.equal(retry.captured.status, 200, `the retry must succeed, got ${retry.captured.status} body=${retry.captured.body}`);
    assert.ok(existsSync(join(projectDir, '.forge', 'project.json')), 'the retry must complete the onboard');

    const afterRetry = discoverProjects(join(forgeRoot, 'projects'), forgeRoot).find((p) => p.id === id);
    assert.ok(afterRetry?.hasConfig === true, 'after the retry, the REAL discovery function must report this project as managed');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
