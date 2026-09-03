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
    // M4 ruling 86: the real fix turn is injected by the assembly, so a route
    // test declares one. It THROWS — no case here expects a brain-fix dispatch,
    // and a stub returning a plausible result would let a future change
    // dispatch one unnoticed.
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    spawnAgentTurn: () => ({ ok: true, spawned: false }),
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

// ---------------------------------------------------------------------------
// Bead forge-8vfn.5.52 — a supplied projectRepoPath must belong to the project
// the request NAMES, not merely live under projectsRoot.
//
// The containment guard's contract is "is this under projectsRoot", which lets a
// request naming project A point at project B: the session is labelled A and
// every write lands in B's real working tree, with nothing red. Measured before
// the tightening was written: no project declares a repo path, and all 17
// session status files on disk carry project_repo_path exactly
// <projectsRoot>/<project>, every one matching its own project field.
// ---------------------------------------------------------------------------

for (const route of START_ROUTES) {
  test(`POST ${route} refuses a repo path belonging to ANOTHER project`, async (t) => {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'start-xproj-'));
    const projectsRoot = join(forgeRoot, 'projects');
    mkdirSync(join(projectsRoot, 'mdtoc'), { recursive: true });
    mkdirSync(join(projectsRoot, 'othergitproj'), { recursive: true });
    t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));

    const { status, payload } = await post(projectsRoot, forgeRoot, route, {
      project: 'mdtoc',
      projectRepoPath: join(projectsRoot, 'othergitproj'),
      idea: 'x',
      brief: 'x',
    });
    assert.equal(status, 400, `a cross-project repo path must be refused, got ${status}`);
    const reason = String(payload['error'] ?? '');
    // The refusal names BOTH, so an operator relying on the old looseness is told
    // what changed rather than meeting a bare 400.
    assert.match(reason, /othergitproj/, `the reason must name the offending path: ${reason}`);
    assert.match(reason, /mdtoc/, `the reason must name the project it was checked against: ${reason}`);
  });

  test(`POST ${route} still ACCEPTS the project's own repo path`, async (t) => {
    // The control that keeps the tightening honest: if it rejected everything,
    // the test above would pass for the wrong reason.
    const forgeRoot = mkdtempSync(join(tmpdir(), 'start-ownproj-'));
    const projectsRoot = join(forgeRoot, 'projects');
    mkdirSync(join(projectsRoot, 'mdtoc'), { recursive: true });
    t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));

    const { payload } = await post(projectsRoot, forgeRoot, route, {
      project: 'mdtoc',
      projectRepoPath: join(projectsRoot, 'mdtoc'),
      idea: 'x',
      brief: 'x',
    });
    assert.ok(
      !/not inside project/.test(String(payload['error'] ?? '')),
      `a project's own repo path must pass: ${JSON.stringify(payload)}`,
    );
  });

  test(`POST ${route} accepts a path BENEATH the project's own root`, async (t) => {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'start-subdir-'));
    const projectsRoot = join(forgeRoot, 'projects');
    mkdirSync(join(projectsRoot, 'mdtoc', 'nested'), { recursive: true });
    t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));

    const { payload } = await post(projectsRoot, forgeRoot, route, {
      project: 'mdtoc',
      projectRepoPath: join(projectsRoot, 'mdtoc', 'nested'),
      idea: 'x',
      brief: 'x',
    });
    assert.ok(
      !/not inside project/.test(String(payload['error'] ?? '')),
      `a subdirectory of the project must pass: ${JSON.stringify(payload)}`,
    );
  });

  test(`POST ${route} does NOT accept a sibling that merely shares the project's prefix`, async (t) => {
    // `<projectsRoot>/mdtoc-evil` starts with `<projectsRoot>/mdtoc` as a STRING
    // but is a different project. The same lexical trap the containment guard
    // itself has a test for, one level down.
    const forgeRoot = mkdtempSync(join(tmpdir(), 'start-prefix-'));
    const projectsRoot = join(forgeRoot, 'projects');
    mkdirSync(join(projectsRoot, 'mdtoc'), { recursive: true });
    mkdirSync(join(projectsRoot, 'mdtocevil'), { recursive: true });
    t.after(() => rmSync(forgeRoot, { recursive: true, force: true }));

    const { status, payload } = await post(projectsRoot, forgeRoot, route, {
      project: 'mdtoc',
      projectRepoPath: join(projectsRoot, 'mdtocevil'),
      idea: 'x',
      brief: 'x',
    });
    assert.equal(status, 400, `a prefix-sharing sibling must be refused, got ${status} ${JSON.stringify(payload)}`);
  });
}
