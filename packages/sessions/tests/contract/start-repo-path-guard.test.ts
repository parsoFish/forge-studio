/**
 * start-repo-path-guard.test.ts — the ONE guard, proven identical at all four
 * `/start` routes.
 *
 * Before the carve, `invalidProjectRepoPath(body.projectRepoPath, …)` appeared
 * as four byte-identical lines in four different host arms. The carve replaced
 * them with one exported guard (`rejectStartProjectRepoPath`) whose raw
 * predicate stays module-private, because that predicate's own comment makes a
 * closed value space part of its contract.
 *
 * Four copies collapsing into one is only an improvement if all four routes
 * still refuse the same things. A unit test of the guard cannot show that — it
 * would pass just as well if a route stopped CALLING it. So this drives the
 * real handlers through the real table and asserts the refusal at each.
 *
 * The positive control is the traversal itself: a `projectRepoPath` that walks
 * out of `projectsRoot` must be refused with 400 at every one of the four, and
 * a contained one must NOT be refused there (it fails later, on a missing
 * project, which is a different answer and proves the guard is not simply
 * rejecting everything).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sessionsRoutes, type SessionsRouteDeps } from '../../routes.ts';

const START_ROUTES = [
  '/api/architect/start',
  '/api/instructions/start',
  '/api/project-brain/start',
  '/api/demo-builder/start',
] as const;

/** The shipped containment guard's contract, resolving before comparing. */
const contained = (candidate: string, roots: { projectsRoot: string }) => {
  const real = resolve(candidate);
  return real === roots.projectsRoot || real.startsWith(`${roots.projectsRoot}/`);
};

function deps(projectsRoot: string): SessionsRouteDeps {
  return {
    ensureSessionTail: () => {},
    broadcastKindChanged: () => {},
    broadcastArchitectChanged: () => {},
    broadcastInstructionsChanged: () => {},
    broadcastProjectBrainChanged: () => {},
    broadcastDemoChanged: () => {},
    projectsRoot,
    spawnAgentTurn: () => ({ ok: true }),
    spawnAgentDispatch: () => {},
    spawnAgentSpecs: {},
    safeParseJson: () => null,
    servedFileHeaders: () => ({}),
    dryBridgeAgentTurnMarker: () => ({}),
    isContainedProjectRepoPath: contained,
    newRunStamp: () => 'stamp',
    safeInputKeyRe: /^[A-Za-z0-9_-]+$/,
  };
}

/** Drive one route through the assembled table and capture its answer. */
async function post(projectsRoot: string, forgeRoot: string, path: string, body: unknown) {
  const entry = sessionsRoutes(deps(projectsRoot)).find((e) => e.method === 'POST' && e.matches(path));
  assert.ok(entry, `no entry claims POST ${path} — the table lost a /start route`);
  let status = 0;
  let payload: Record<string, unknown> = {};
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string' && chunk.length > 0) {
        try {
          payload = JSON.parse(chunk) as Record<string, unknown>;
        } catch {
          payload = { raw: chunk };
        }
      }
    },
    setHeader() {},
  };
  await entry.handler(
    { headers: {}, method: 'POST', url: path } as never,
    res as never,
    { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body } as never,
    path,
    'POST',
  );
  return { status, payload };
}

const ESCAPES = [
  { name: 'a traversal out of projectsRoot', value: '/tmp/PROJECTS/../../etc' },
  { name: 'an unrelated absolute path', value: '/etc' },
  { name: 'a sibling sharing a prefix', value: '/tmp/PROJECTS-evil/x' },
  { name: 'a non-string (untrusted JSON)', value: 0 },
];

for (const route of START_ROUTES) {
  for (const esc of ESCAPES) {
    test(`POST ${route} refuses ${esc.name}`, async (t) => {
      const forgeRoot = mkdtempSync(join(tmpdir(), 'start-guard-'));
      const projectsRoot = join(forgeRoot, 'projects');
      // A REAL project, because the roster check runs BEFORE the repo-path
      // guard: without it every route answers 404 and the test would be
      // asserting the wrong refusal.
      mkdirSync(join(projectsRoot, 'mdtoc'), { recursive: true });
      t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));
      const value = typeof esc.value === 'string' ? esc.value.replace('/tmp/PROJECTS', projectsRoot) : esc.value;
      const { status, payload } = await post(projectsRoot, forgeRoot, route, {
        project: 'mdtoc',
        projectRepoPath: value,
        idea: 'x',
        brief: 'x',
      });
      assert.equal(status, 400, `expected a 400 refusal, got ${status} with ${JSON.stringify(payload)}`);
      assert.match(
        String(payload['error'] ?? ''),
        /projectRepoPath/i,
        `the 400 must name the field it refused: ${JSON.stringify(payload)}`,
      );
    });
  }

  test(`POST ${route} does NOT refuse a contained projectRepoPath on the repo-path guard`, async (t) => {
    // The negative half: if the guard rejected everything, the tests above would
    // pass for the wrong reason. A contained path must get PAST this guard — it
    // then fails on the unknown project, which is a different answer.
    const forgeRoot = mkdtempSync(join(tmpdir(), 'start-guard-ok-'));
    const projectsRoot = join(forgeRoot, 'projects');
    mkdirSync(join(projectsRoot, 'mdtoc'), { recursive: true });
    t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));
    const { status, payload } = await post(projectsRoot, forgeRoot, route, {
      project: 'mdtoc',
      projectRepoPath: join(projectsRoot, 'mdtoc'),
      idea: 'x',
      brief: 'x',
    });
    assert.ok(
      !/projectRepoPath/i.test(String(payload['error'] ?? '')),
      `a contained path must not be refused by the repo-path guard; got ${status} ${JSON.stringify(payload)}`,
    );
  });
}
