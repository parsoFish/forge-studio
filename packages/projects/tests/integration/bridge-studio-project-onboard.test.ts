/**
 * project-onboard.test.ts — drives `makeOnboardHandlers`'s three handlers
 * (create, onboard, PUT :id) directly with a fake req/res/ctx (ruling 5: no
 * bridge is booted).
 *
 * `OnboardDeps` (`seedBrain`, `checkBrainSeedContainment`, `readArtifactRoot`,
 * `isContainedProjectRepoPath`) are FAKED, not the real `@forge/knowledge`/
 * `@forge/flows` implementations — this package cannot import either
 * directly (see `bridge-studio-project-onboard.ts`'s header for the boundary reasoning),
 * and re-testing knowledge's/flows' own containment logic here would just be
 * a slower copy of tests those packages already own. The fakes are
 * structurally faithful (same call shape, same thrown error TYPE on
 * rejection) so the WIRING — does the handler call the right dep with the
 * right arguments, and does it react correctly to a rejection — is what is
 * actually under test.
 *
 * CARRIED ACROSS from `cli/bridge-studio-project-create-containment.test.ts`
 * (this task's brief: report which containment ATs moved here): Defect 2
 * (sibling-project clobber — an application-level, route-owned check, not a
 * path-identity one) and the SEC-03 round-3/4 error-routing shape
 * (`PathGuardContainmentError` from the brain-seed containment check → 400,
 * not 500) are reproduced below as `handleProjectsOnboard` ATs, since both
 * live in the ROUTE handler this file now owns. Defect 1 (the real
 * `isContainedProjectRepoPath` escape shapes), Finding A (`seedProjectBrain`'s
 * own containment), and the two GET-listing positive controls stay with
 * their owning packages (flows/knowledge) — not reproduced here, since this
 * package cannot exercise the real functions without the forbidden import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { makeOnboardHandlers, demoProcessChanged, type OnboardDeps } from '../../bridge-studio-project-onboard.ts';
import { projectStartersDir } from '../../project-create.ts';
import { PathGuardContainmentError, FORGE_ROOT, type RouteContext } from '@forge/kernel';

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

type FakeDeps = OnboardDeps & {
  seedBrainCalls: Array<{ forgeRoot: string; projectId: string; name: string }>;
  checkBrainSeedContainmentCalls: Array<{ forgeRoot: string; projectId: string }>;
};

/** Structurally faithful fakes for the three cross-package dependencies —
 *  see this file's header for why they are fakes, not the real functions. */
function fakeDeps(overrides: Partial<OnboardDeps> = {}): FakeDeps {
  const seedBrainCalls: FakeDeps['seedBrainCalls'] = [];
  const checkBrainSeedContainmentCalls: FakeDeps['checkBrainSeedContainmentCalls'] = [];
  const deps: OnboardDeps = {
    seedBrain: (forgeRoot, projectId, name) => {
      seedBrainCalls.push({ forgeRoot, projectId, name });
      const brainDir = join(forgeRoot, 'brain', 'projects', projectId);
      mkdirSync(brainDir, { recursive: true });
      writeFileSync(join(brainDir, 'kb.yaml'), `id: ${projectId}\n`);
      writeFileSync(join(brainDir, 'profile.md'), `# ${name}\n`);
      return {
        projectId,
        brainDir,
        files: [
          { path: `brain/projects/${projectId}/kb.yaml`, action: 'created' },
          { path: `brain/projects/${projectId}/profile.md`, action: 'created' },
        ],
      };
    },
    checkBrainSeedContainment: (forgeRoot, projectId) => {
      checkBrainSeedContainmentCalls.push({ forgeRoot, projectId });
    },
    readArtifactRoot: () => '.',
    // A lexical stand-in for @forge/flows's real (realpath-identity) guard —
    // sufficient to test the ROUTE's reaction to true/false, not to
    // re-prove flows' own escape-shape coverage (out of scope here).
    isContainedProjectRepoPath: (p, opts) => {
      const root = resolve(opts.projectsRoot ?? join(opts.forgeRoot, 'projects'));
      const resolved = resolve(p);
      return resolved === root || resolved.startsWith(root + sep);
    },
    ...overrides,
  };
  return Object.assign(deps, { seedBrainCalls, checkBrainSeedContainmentCalls });
}

function baseForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  return forgeRoot;
}

// ---------------------------------------------------------------------------
// handleProjectsCreate — POST /api/studio/projects/create (greenfield)
// ---------------------------------------------------------------------------

function isolatedForgeRootWithStarters(): string {
  const forgeRoot = baseForgeRoot();
  const startersDest = join(forgeRoot, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return forgeRoot;
}

test('create: a non-matching url is declined', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsCreate } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsCreate(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects', 'POST');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('create: missing appType/northStar is refused 400', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsCreate } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsCreate(mockReq(), res, ctx(forgeRoot, { name: 'My Tool' }), '/api/studio/projects/create', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('create: a valid greenfield request scaffolds the project and answers 200', async () => {
  const forgeRoot = isolatedForgeRootWithStarters();
  try {
    const { handleProjectsCreate } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, { name: 'My Tool', appType: 'typescript-cli', northStar: 'ship the thing' }),
      '/api/studio/projects/create', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
    assert.equal(body.id, 'my-tool');
    assert.ok(existsSync(join(forgeRoot, 'projects', 'my-tool', 'package.json')));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// handleProjectsOnboard — POST /api/studio/projects (onboard an existing dir)
// ---------------------------------------------------------------------------

test('onboard: a non-matching url is declined', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/create', 'POST');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: missing name is refused 400', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: the reserved id "new" is refused 400', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(mockReq(), res, ctx(forgeRoot, { name: 'new', qualityGateCmd: 'echo ok' }), '/api/studio/projects', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
    assert.match(JSON.parse(captured.body).error, /reserved/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: missing qualityGateCmd is refused 400', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(mockReq(), res, ctx(forgeRoot, { name: 'demoproj' }), '/api/studio/projects', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: repoPath outside the projects root is refused 400 (isContainedProjectRepoPath wiring)', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'escapee', qualityGateCmd: 'echo ok', repoPath: '../outside-projects' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
    assert.match(JSON.parse(captured.body).error, /forge projects directory/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('[Defect 2, carried] onboard: repoPath aimed at an ALREADY-ONBOARDED sibling project is refused 400 — never clobbers its .forge/project.json', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const victimDir = join(forgeRoot, 'projects', 'victim');
    mkdirSync(join(victimDir, '.forge'), { recursive: true });
    writeFileSync(join(victimDir, '.forge', 'project.json'), JSON.stringify({ name: 'victim', testProcess: { local: { cmd: ['echo', 'victim-real-cmd'] } } }, null, 2));

    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    // A FRESH, non-colliding name (so the id-collision 409 never fires) whose
    // repoPath points at the victim's directory.
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'totally-different-name', qualityGateCmd: 'echo ok', repoPath: 'projects/victim' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400, `expected 400, got ${captured.status} body=${captured.body}`);
    const victimCfg = JSON.parse(readFileSync(join(victimDir, '.forge', 'project.json'), 'utf8'));
    assert.deepEqual(victimCfg.testProcess.local.cmd, ['echo', 'victim-real-cmd'], 'the victim config must be byte-identical — never overwritten');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('[SEC-03 round 3/4, carried] onboard: a checkBrainSeedContainment rejection (PathGuardContainmentError) is reported as 400, not 500, and leaves no project.json behind', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const deps = fakeDeps({
      checkBrainSeedContainment: () => { throw new PathGuardContainmentError('simulated brain-seed containment rejection'); },
    });
    const { handleProjectsOnboard } = makeOnboardHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'rejectme', qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400, `expected 400, got ${captured.status} body=${captured.body}`);
    assert.equal(existsSync(join(forgeRoot, 'projects', 'rejectme', '.forge', 'project.json')), false, 'a rejected brain-seed containment check must leave no project.json behind');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: a scaffold containment rejection is reported as 400 (project-contract-scaffold.ts wiring)', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    // Force checkContractArtifactContainment to reject by planting the
    // project dir itself with a roadmap.md symlinked outside it. The
    // directory must ALREADY exist for the symlink to be planted — so, same
    // trick as the "[Defect 2, carried]" test above, `name` is deliberately
    // DIFFERENT from the pre-existing directory's basename: `id` derives
    // from `name`, and the duplicate-id 409 scan (discoverProjects) only
    // matches on `id`, not on `repoPath` — a fresh `id` with a `repoPath`
    // aimed at the pre-planted directory reaches Phase 1's containment check
    // instead of tripping the (unrelated) 409/sibling-clobber checks first.
    const projectRoot = join(forgeRoot, 'projects', 'guarded');
    const outside = mkdtempSync(join(tmpdir(), 'onboard-scaffold-outside-'));
    mkdirSync(projectRoot, { recursive: true });
    const { symlinkSync } = await import('node:fs');
    try {
      symlinkSync(join(outside, 'ESCAPED.md'), join(projectRoot, 'roadmap.md'));
    } catch {
      rmSync(forgeRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return; // symlinks unavailable in this environment — nothing to assert
    }
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'freshname', repoPath: 'projects/guarded', qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400, `expected 400, got ${captured.status} body=${captured.body}`);
    assert.equal(existsSync(join(outside, 'ESCAPED.md')), false);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('onboard: a full success wires seedBrain/readArtifactRoot correctly and answers 200 with a bound kb', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const deps = fakeDeps();
    const { handleProjectsOnboard } = makeOnboardHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'demoproj', qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
    assert.equal(body.id, 'demoproj');
    assert.ok(existsSync(join(forgeRoot, 'projects', 'demoproj', '.forge', 'project.json')));
    assert.ok(existsSync(join(forgeRoot, 'projects', 'demoproj', 'roadmap.md')));
    assert.equal(deps.seedBrainCalls.length, 1);
    assert.equal(deps.seedBrainCalls[0]!.projectId, 'demoproj');
    assert.equal(deps.checkBrainSeedContainmentCalls.length, 1);
    const cfg = JSON.parse(readFileSync(join(forgeRoot, 'projects', 'demoproj', '.forge', 'project.json'), 'utf8'));
    assert.equal(cfg.kb, 'demoproj', 'the project must bind to the seeded kb');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('[forge-8vfn.5.3] onboard: a directory already DISCOVERED on disk with no .forge/ is onboardable, not a 409 (S1 beat 3)', async () => {
  const forgeRoot = baseForgeRoot();
  // Discovered-but-unonboarded: a bare directory on disk, no .forge/project.json —
  // exactly what discoverProjects() reports as hasConfig: false, and exactly
  // what the onboarding form exists to close.
  mkdirSync(join(forgeRoot, 'projects', 'gitweave'), { recursive: true });
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'gitweave', qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    assert.ok(existsSync(join(forgeRoot, 'projects', 'gitweave', '.forge', 'project.json')));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('[forge-8vfn.5.3] onboard: an id collision with an ALREADY-ONBOARDED project (has .forge/project.json) still 409s', async () => {
  const forgeRoot = baseForgeRoot();
  const dir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'demoproj', testProcess: { local: { cmd: ['echo', 'ok'] } } }, null, 2));
  try {
    const { handleProjectsOnboard } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectsOnboard(
      mockReq(), res, ctx(forgeRoot, { name: 'demoproj', qualityGateCmd: 'echo ok' }),
      '/api/studio/projects', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 409, `expected 409, got ${captured.status} body=${captured.body}`);
    assert.match(JSON.parse(captured.body).error, /already exists/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// handleProjectPut — PUT and POST /api/studio/projects/:id (never DELETE)
// ---------------------------------------------------------------------------

function projectWithConfig(forgeRoot: string, id: string, cfg: Record<string, unknown>): string {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

test('PUT: a non-matching url is declined', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects', 'PUT');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('PUT: a DELETE on a matching url is declined, never enters the write logic (W7-B4)', async () => {
  const forgeRoot = baseForgeRoot();
  projectWithConfig(forgeRoot, 'demoproj', { name: 'demoproj', testProcess: { local: { cmd: ['echo', 'ok'] } } });
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj', 'DELETE');
    assert.equal(answered, false, 'projects have no DELETE surface — must fall through as unhandled');
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

for (const method of ['PUT', 'POST']) {
  test(`PUT: answers ${method} identically (the legacy entry gate is "method !== DELETE", not "method === PUT")`, async () => {
    const forgeRoot = baseForgeRoot();
    projectWithConfig(forgeRoot, 'demoproj', { name: 'demoproj', testProcess: { local: { cmd: ['echo', 'ok'] } } });
    try {
      const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
      const { res, captured } = mockRes();
      const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, { northStar: 'updated north star' }), '/api/studio/projects/demoproj', method);
      assert.equal(answered, true, `${method} must be claimed and answered`);
      assert.equal(captured.status, 200, `expected 200 for ${method}, got ${captured.status} body=${captured.body}`);
      const cfg = JSON.parse(readFileSync(join(forgeRoot, 'projects', 'demoproj', '.forge', 'project.json'), 'utf8'));
      assert.equal(cfg.northStar, 'updated north star');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
}

test('PUT: an invalid project id is refused 400', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/..', 'PUT');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('PUT: an unknown project 404s', async () => {
  const forgeRoot = baseForgeRoot();
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/ghost', 'PUT');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('PUT: under FORGE_DRY_BRIDGE=1 refuses with the typed dry-bridge shape', async () => {
  const forgeRoot = baseForgeRoot();
  projectWithConfig(forgeRoot, 'demoproj', { name: 'demoproj', testProcess: { local: { cmd: ['echo', 'ok'] } } });
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FORGE_DRY_BRIDGE');
  const prev = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj', 'PUT');
    assert.equal(answered, true);
    assert.equal(captured.status, 409);
    assert.equal(JSON.parse(captured.body).error, 'dry-bridge');
  } finally {
    if (had) process.env.FORGE_DRY_BRIDGE = prev; else delete process.env.FORGE_DRY_BRIDGE;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('PUT: an AGENTS.md file is the single source of instructions — a body instructions field is ignored when one is present', async () => {
  const forgeRoot = baseForgeRoot();
  const dir = projectWithConfig(forgeRoot, 'demoproj', { name: 'demoproj', instructions: 'original', testProcess: { local: { cmd: ['echo', 'ok'] } } });
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nReal instructions live here.\n');
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPut(mockReq(), res, ctx(forgeRoot, { instructions: 'attempted override' }), '/api/studio/projects/demoproj', 'PUT');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const cfg = JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8'));
    assert.equal(cfg.instructions, 'original', 'AGENTS.md present ⇒ the body instructions field must be ignored');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('PUT: demoDesignNeeded is signalled only on a genuine demoProcess CHANGE, not on every save (W7-B6 projects-28)', async () => {
  const forgeRoot = baseForgeRoot();
  const steps = [{ kind: 'capture', text: 'before' }, { kind: 'verify', text: 'gate' }];
  projectWithConfig(forgeRoot, 'demoproj', { name: 'demoproj', demoProcess: steps, testProcess: { local: { cmd: ['echo', 'ok'] } } });
  try {
    const { handleProjectPut } = makeOnboardHandlers(fakeDeps());
    // An unchanged echo of the same steps must NOT trip the banner.
    {
      const { res, captured } = mockRes();
      await handleProjectPut(mockReq(), res, ctx(forgeRoot, { demoProcess: structuredClone(steps) }), '/api/studio/projects/demoproj', 'PUT');
      assert.equal(JSON.parse(captured.body).demoDesignNeeded, undefined, 'byte-equal echo must not trip the banner');
    }
    // A genuinely different demoProcess must trip it.
    {
      const { res, captured } = mockRes();
      await handleProjectPut(mockReq(), res, ctx(forgeRoot, { demoProcess: [...steps, { kind: 'present', text: 'ship it' }] }), '/api/studio/projects/demoproj', 'PUT');
      assert.equal(JSON.parse(captured.body).demoDesignNeeded, true);
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// demoProcessChanged — the plain exported pure function
// ---------------------------------------------------------------------------

test('demoProcessChanged: pure decision rule smoke test', () => {
  const steps = [{ kind: 'capture', text: 'x' }];
  assert.equal(demoProcessChanged(structuredClone(steps), steps), false);
  assert.equal(demoProcessChanged([...steps, { kind: 'verify', text: 'y' }], steps), true);
  assert.equal(demoProcessChanged(steps, undefined), true, 'first-ever demoProcess IS a change');
  assert.equal(demoProcessChanged(undefined, steps), false, 'a save without the field never signals');
  assert.equal(demoProcessChanged('not-an-array', steps), false);
});
