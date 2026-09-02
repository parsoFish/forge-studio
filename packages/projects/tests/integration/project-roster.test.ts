/**
 * project-roster.test.ts — drive the carved roster handlers directly.
 *
 * M4 §4 (projects routes carve). Package tests never boot the bridge (0 such
 * tests in this package today, kept 0): `startBridge` resolves config, runs a
 * reflect-reconcile startup pass and wires every route family, none of which
 * is under test here. Each handler is called directly with a mock req/res —
 * the whole point of carving the dispatch out of `cli/bridge-studio.ts`.
 *
 * Coverage carried from the bridge-level tests the routes moved out of:
 *   - `cli/bridge-studio.test.ts`'s "GET /api/studio/projects returns
 *     projects array" / "tolerates project without project.json" /
 *     "sources instructions from AGENTS.md" family.
 *   - `cli/id-rule.test.ts`'s "roster: GET /api/studio/projects lists
 *     'trafficGame' verbatim and auto-binds the KB whose binding.ref names
 *     it" — reproduced here via the injected `projectKbBindings` dependency
 *     rather than a real `@forge/knowledge` KB descriptor, since this
 *     package cannot import `@forge/knowledge` (see project-roster.ts's
 *     header, dependency-injection note 1). The injection point itself is
 *     new surface this carve introduced, so it gets its own direct test
 *     (`createProjectsListHandler` deps below) rather than only an indirect
 *     one through `loadProjectsWithMeta`.
 *   - `cli/bridge-studio-writes.test.ts`'s starters coverage, reproduced via
 *     the injected `StudioStartersDeps` (dependency-injection note 2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { StudioContext } from '@forge/kernel';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import {
  handleProjectsStarters,
  createStudioStartersHandler,
  createProjectsListHandler,
  loadProjectsWithMeta,
} from '../../project-roster.ts';

type Captured = { status: number | null; body: string };

/** The smallest `res` `sendJson` needs: `writeHead(status, headers)` + `end(payload)`. */
function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

/** `allowedOrigin` reads `req.headers.origin` and nothing else. */
const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function makeForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-projects-roster-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return root;
}

function ctxFor(forgeRoot: string): StudioContext {
  return { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
}

// ---------------------------------------------------------------------------
// GET /api/studio/projects/starters (row 2 — no injected dependency)
// ---------------------------------------------------------------------------

test('handleProjectsStarters: GET /api/studio/projects/starters answers 200 with an appTypes array', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectsStarters(
      mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/starters', 'GET',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { appTypes: unknown };
    assert.ok(Array.isArray(body.appTypes), 'appTypes must be an array (possibly empty on a bare fixture)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectsStarters: a non-matching url/method declines (returns false, sends nothing)', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectsStarters(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null, 'declining is silent — an entry that answers AND returns false double-sends');

    const { res: res2, captured: c2 } = mockRes();
    const wrongMethod = await handleProjectsStarters(mockReq(), res2, ctxFor(forgeRoot), '/api/studio/projects/starters', 'POST');
    assert.equal(wrongMethod, false, 'POST is not a route this handler answers');
    assert.equal(c2.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/studio/starters (row 1 — injected listStarterAgents/loadStarterFlow/
// agentCapabilityDescriptor)
// ---------------------------------------------------------------------------

const stubAgent: AgentDefinition = {
  slug: 'stub-starter',
  name: 'Stub Starter',
  description: 'test fixture',
} as unknown as AgentDefinition;

const stubFlow: FlowDefinition = { id: 'basic', name: 'Basic' } as unknown as FlowDefinition;

test('createStudioStartersHandler: GET /api/studio/starters threads each dependency through to the response', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const calls: string[] = [];
    const handler = createStudioStartersHandler({
      listStarterAgents: (root) => { calls.push(`listStarterAgents(${root})`); return [stubAgent]; },
      loadStarterFlow: (root) => { calls.push(`loadStarterFlow(${root})`); return stubFlow; },
      agentCapabilityDescriptor: (def) => { calls.push(`agentCapabilityDescriptor(${def.slug})`); return { fake: true }; },
    });
    const { res, captured } = mockRes();
    const answered = await handler(mockReq(), res, ctxFor(forgeRoot), '/api/studio/starters', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { starters: Array<{ slug: string; capability: unknown }>; flow: unknown };
    assert.equal(body.starters.length, 1);
    assert.equal(body.starters[0].slug, 'stub-starter');
    assert.deepEqual(body.starters[0].capability, { fake: true }, 'capability must be the injected descriptor, not a bridge-local reimplementation');
    assert.deepEqual(body.flow, stubFlow);
    assert.deepEqual(calls, [`listStarterAgents(${forgeRoot})`, `loadStarterFlow(${forgeRoot})`, 'agentCapabilityDescriptor(stub-starter)']);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('createStudioStartersHandler: a non-matching url/method declines without calling any injected dependency', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const handler = createStudioStartersHandler({
      listStarterAgents: () => { throw new Error('must not be called'); },
      loadStarterFlow: () => { throw new Error('must not be called'); },
      agentCapabilityDescriptor: () => { throw new Error('must not be called'); },
    });
    const { res, captured } = mockRes();
    const answered = await handler(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/starters', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/studio/projects (row 3 — injected projectKbBindings)
// ---------------------------------------------------------------------------

function writeProject(forgeRoot: string, id: string, projectJson?: Record<string, unknown>): void {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  if (projectJson !== undefined) {
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify(projectJson), 'utf8');
  }
}

test('createProjectsListHandler: GET /api/studio/projects lists every discovered project and applies the injected KB binding', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    writeProject(forgeRoot, 'trafficGame', { testProcess: { local: { cmd: ['npm', 'test'] } } });
    writeProject(forgeRoot, 'half-onboarded'); // no project.json — still listed (B1)

    const handler = createProjectsListHandler({
      projectKbBindings: (root) => {
        assert.equal(root, forgeRoot, 'the injected fn must receive the SAME forgeRoot the handler was given');
        return new Map([['trafficGame', 'trafficGame']]);
      },
    });
    const { res, captured } = mockRes();
    const answered = await handler(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { projects: Array<{ id: string; kb?: string; configHealth: { state: string } }> };
    const byId = new Map(body.projects.map((p) => [p.id, p]));
    assert.equal(byId.size, 2);
    assert.equal(byId.get('trafficGame')?.kb, 'trafficGame', 'the derived KB binding must be threaded onto the roster entry');
    assert.equal(byId.get('trafficGame')?.configHealth.state, 'ok');
    assert.equal(byId.get('half-onboarded')?.configHealth.state, 'unconfigured', 'a project.json-less dir stays visible (B1), health honestly unconfigured');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('createProjectsListHandler: a malformed project.json is reported invalid, never sinks the whole roster', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const dir = join(forgeRoot, 'projects', 'brokenproj');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'project.json'), '{ not valid json [[[', 'utf8');

    const handler = createProjectsListHandler({ projectKbBindings: () => new Map() });
    const { res, captured } = mockRes();
    await handler(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects', 'GET');
    assert.equal(captured.status, 200, 'one bad config must not 500 the whole roster');
    const body = JSON.parse(captured.body) as { projects: Array<{ id: string; configHealth: { state: string } }> };
    assert.equal(body.projects[0].configHealth.state, 'invalid');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('createProjectsListHandler: a non-matching url/method declines without calling the injected dependency', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const handler = createProjectsListHandler({ projectKbBindings: () => { throw new Error('must not be called'); } });
    const { res, captured } = mockRes();
    const answered = await handler(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/attention', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadProjectsWithMeta — the direct-call coverage the handler above wraps
// ---------------------------------------------------------------------------

test('loadProjectsWithMeta: an explicit kb:null in project.json UNBINDS a derived KB (W7-FIX-A4) rather than re-deriving it', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    writeProject(forgeRoot, 'trafficGame', { kb: null });
    const projects = loadProjectsWithMeta(forgeRoot, () => new Map([['trafficGame', 'trafficGame']]));
    assert.equal(projects[0].kb, undefined, 'an explicit null must UNBIND, not fall back to the derived binding');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
