/**
 * routes-table.test.ts — the ORDER and the CLAIMS of this package's route table.
 *
 * A route table is not a set. `dispatchRoute` is first-match-wins, and the arms
 * being carved have genuinely overlapping shapes, so the defect this file exists
 * to make impossible is **the wrong entry claiming a URL and answering it** —
 * which returns a plausible 200 and leaves nothing red. Asserting that both
 * entries exist would not catch it; asserting WHICH ONE claims a colliding URL
 * does.
 *
 * The second defect it pins is the one measured across the whole bridge during
 * this carve: the host takes `req.url` RAW (`cli/ui-bridge.ts`) and never
 * normalises, so 33 of the 38 session routes 404 today on any appended query
 * string. Every matcher here calls `pathOnly` for itself; the query-string cases
 * below fail against a matcher that does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sessionsRoutes, type SessionsRouteDeps } from '../../routes.ts';

/**
 * A complete inert deps object.
 *
 * Written as a factory taking overrides rather than a literal per call site: the
 * carve grew `SessionsRouteDeps` from two members to ten, and a test that spells
 * the whole shape out at every construction becomes a place where adding a dep
 * means editing unrelated assertions.
 */
function stubDeps(over: Partial<SessionsRouteDeps> = {}): SessionsRouteDeps {
  return {
    ensureSessionTail: () => {},
    broadcastKindChanged: () => {},
    broadcastArchitectChanged: () => {},
    broadcastInstructionsChanged: () => {},
    listInstructionsSessions: () => [],
    broadcastProjectBrainChanged: () => {},
    listProjectBrainSessions: () => [],
    spawnAgentDispatch: () => {},
    newRunStamp: () => 'stamp',
    safeInputKeyRe: /^[A-Za-z0-9_-]+$/,
    broadcastDemoChanged: () => {},
    listDemoSessions: () => [],
    projectsRoot: '/home/parso/forge/projects',
    spawnAgentTurn: () => ({ ok: true }),
    spawnAgentSpecs: {},
    safeParseJson: () => null,
    servedFileHeaders: () => ({}),
    dryBridgeAgentTurnMarker: () => ({}),
    isContainedProjectRepoPath: () => true,
    ...over,
  };
}

const noopDeps: SessionsRouteDeps = stubDeps();

/** The first entry that claims `url`, by the same rule `dispatchRoute` uses. */
function claimant(method: string, url: string): string | null {
  const hit = sessionsRoutes(noopDeps).find((e) => e.method === method && e.matches(url));
  return hit === undefined ? null : hit.path;
}

test('the table is ordered, and every entry declares method, path, matcher and a dry classification', () => {
  const table = sessionsRoutes(noopDeps);
  assert.equal(table.length, 35, 'a route added or removed without updating this pin');
  for (const e of table) {
    assert.ok(e.method.length > 0 && e.path.startsWith('/api/'), `${e.path}: method + /api path`);
    assert.equal(typeof e.matches, 'function');
    assert.ok(typeof e.dryClassification === 'string' && e.dryClassification.length > 0, `${e.path}: dry classification`);
  }
});

// ---------------------------------------------------------------------------
// The collision. `/api/studio/sessions/:kind/:sessionId/cancel` is three
// segments; `/api/studio/sessions/:kind/:sessionId` is two. They do not overlap
// each other — but the affordance route (still a host arm, joining this table
// in a later PR) is a bare three-segment wildcard that WOULD swallow the
// literal `cancel` as an affordance id. These cases pin the invariant now, so
// the entry that must come first is already pinned when it arrives.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The architect family, carved from `cli/ui-bridge.ts`. One entry per URL — not
// one entry for the family — so `dry-bridge-coverage` keeps a classification per
// route, and so the query-string bug the host arms carried (`url === '/api/…'`
// against a raw url, which 404s on `?x=1`) cannot come back: every matcher here
// normalises for itself.
// ---------------------------------------------------------------------------

const ARCHITECT_ROUTES = [
  ['GET', '/api/architect/sessions', '/api/architect/sessions'],
  ['GET', '/api/architect/file/mdtoc/s1/PLAN.md', '/api/architect/file/:project/:sessionId/*name'],
  ['POST', '/api/architect/start', '/api/architect/start'],
  ['POST', '/api/architect/answer', '/api/architect/answer'],
  ['POST', '/api/architect/rerun', '/api/architect/rerun'],
] as const;

for (const [method, url, path] of ARCHITECT_ROUTES) {
  test(`${method} ${url} is claimed by ${path}`, () => {
    assert.equal(claimant(method, url), path);
  });

  test(`${method} ${url} is still claimed WITH a query string`, () => {
    // The host arms compared against a raw `req.url` and answered 404 for any
    // appended query — a live bug the carve fixes by normalising per matcher.
    assert.equal(claimant(method, `${url}?x=1`), path, 'a matcher that does not call pathOnly fails exactly here');
  });
}

const INSTRUCTIONS_ROUTES = [
  ['GET', '/api/instructions/sessions', '/api/instructions/sessions'],
  ['GET', '/api/instructions/file/mdtoc/s1/AGENTS.md', '/api/instructions/file/:project/:sessionId/*name'],
  ['POST', '/api/instructions/start', '/api/instructions/start'],
  ['POST', '/api/instructions/brief', '/api/instructions/brief'],
  ['POST', '/api/instructions/answer', '/api/instructions/answer'],
  ['POST', '/api/instructions/verdict', '/api/instructions/verdict'],
] as const;

for (const [method, url, path] of INSTRUCTIONS_ROUTES) {
  test(`${method} ${url} is claimed by ${path}`, () => {
    assert.equal(claimant(method, url), path);
  });

  test(`${method} ${url} is still claimed WITH a query string`, () => {
    assert.equal(claimant(method, `${url}?x=1`), path, 'a matcher that does not call pathOnly fails exactly here');
  });
}

const PROJECT_BRAIN_ROUTES = [
  ['GET', '/api/project-brain/sessions', '/api/project-brain/sessions'],
  ['GET', '/api/project-brain/themes/mdtoc/s1', '/api/project-brain/themes/:project/:sessionId'],
  ['POST', '/api/project-brain/start', '/api/project-brain/start'],
  ['POST', '/api/project-brain/brief', '/api/project-brain/brief'],
  ['POST', '/api/project-brain/approve', '/api/project-brain/approve'],
  ['POST', '/api/project-brain/abandon', '/api/project-brain/abandon'],
] as const;

for (const [method, url, path] of PROJECT_BRAIN_ROUTES) {
  test(`${method} ${url} is claimed by ${path}`, () => {
    assert.equal(claimant(method, url), path);
  });

  test(`${method} ${url} is still claimed WITH a query string`, () => {
    assert.equal(claimant(method, `${url}?x=1`), path, 'a matcher that does not call pathOnly fails exactly here');
  });
}

test('approve and abandon are SEPARATE entries with different dry classifications', () => {
  // They share one host arm and one handler, but approve spawns and abandon
  // does not. A single entry would have to claim one classification for both,
  // and dry-bridge-coverage would then be wrong about one of them.
  const table = sessionsRoutes(noopDeps);
  const approve = table.find((e) => e.path === '/api/project-brain/approve');
  const abandon = table.find((e) => e.path === '/api/project-brain/abandon');
  assert.ok(approve && abandon, 'both entries exist');
  assert.equal(approve.dryClassification, 'stub-actions', 'approve spawns a turn');
  assert.equal(abandon.dryClassification, 'exempt-local', 'abandon does not spawn');
  assert.notEqual(approve.dryClassification, abandon.dryClassification, 'the split exists BECAUSE they differ');
});

const KICKOFF_ROUTES = [
  ['POST', '/api/studio/onboarding/start', '/api/studio/onboarding/start'],
  ['GET', '/api/studio/projects/mdtoc/onboarding/active', '/api/studio/projects/:project/onboarding/active'],
  ['POST', '/api/studio/authoring/start', '/api/studio/authoring/start'],
  ['POST', '/api/studio/kbs/kb1/cleanup/start', '/api/studio/kbs/:kbId/cleanup/start'],
] as const;

for (const [method, url, path] of KICKOFF_ROUTES) {
  test(`${method} ${url} is claimed by ${path}`, () => {
    assert.equal(claimant(method, url), path);
  });

  test(`${method} ${url} is still claimed WITH a query string`, () => {
    assert.equal(claimant(method, `${url}?x=1`), path, 'a matcher that does not call pathOnly fails exactly here');
  });
}

test('the two carried-over handoff routes are claimed by THIS table, not their URL pillar', () => {
  // L12 wears library's /api/studio/authoring prefix and K10 wears knowledge's
  // /api/studio/kbs prefix, but both MINT a session, which ruling 17 makes a
  // sessions route. This is the assertion that says the handoff actually closed
  // rather than the route merely having moved file.
  assert.equal(claimant('POST', '/api/studio/authoring/start'), '/api/studio/authoring/start');
  assert.equal(claimant('POST', '/api/studio/kbs/kb1/cleanup/start'), '/api/studio/kbs/:kbId/cleanup/start');
});

test('K10 does not swallow the KB routes that belong to knowledge', () => {
  // Disjointness is a property of the SIBLING table's current patterns, so it is
  // pinned, never assumed. K10 is anchored at exactly `/cleanup/start`; a KB
  // route with a different tail or segment count must fall through to knowledge.
  assert.equal(claimant('POST', '/api/studio/kbs/kb1/maintenance'), null);
  assert.equal(claimant('GET', '/api/studio/kbs/kb1'), null);
  assert.equal(claimant('POST', '/api/studio/kbs/kb1/cleanup/start/extra'), null);
});

test('the onboarding-active route does not swallow projects\' own :id routes', () => {
  assert.equal(claimant('GET', '/api/studio/projects/mdtoc'), null);
  assert.equal(claimant('GET', '/api/studio/projects/mdtoc/onboarding'), null);
});

test('the architect and instructions families do not claim each other\'s URLs', () => {
  // Both families have a `/sessions` list, a `/file/` server and a `/start`.
  // First-match-wins means a matcher that forgot its own prefix would silently
  // answer for the other kind — with a plausible 200, which is the carve defect
  // that leaves nothing red.
  assert.equal(claimant('GET', '/api/architect/sessions'), '/api/architect/sessions');
  assert.equal(claimant('GET', '/api/instructions/sessions'), '/api/instructions/sessions');
  assert.equal(claimant('POST', '/api/architect/start'), '/api/architect/start');
  assert.equal(claimant('POST', '/api/instructions/start'), '/api/instructions/start');
});

test('/api/plan-verdict is NOT claimed by this table — it is flows-owned', () => {
  // It sat inside the same host function as the five arms above. Ownership was
  // settled by measurement: ctx.mergePr, ctx.finalizeAfterMerge and
  // ctx.queueRoot appear in that function only inside that one arm.
  assert.equal(claimant('POST', '/api/plan-verdict'), null);
});

test('POST …/:kind/:sessionId/cancel is claimed by the cancel entry — not by a two-segment read matcher', () => {
  assert.equal(claimant('POST', '/api/studio/sessions/authoring/abc123/cancel'), '/api/studio/sessions/:kind/:sessionId/cancel');
});

test('the session-READ entry does not claim the cancel URL — the segment counts are what separate them', () => {
  // Kills a matcher written as a prefix test (`startsWith`), which would claim
  // every deeper URL in the family including cancel and every affordance.
  const read = sessionsRoutes(noopDeps).find((e) => e.path === '/api/studio/sessions/:kind/:sessionId');
  assert.ok(read !== undefined);
  assert.equal(read.matches('/api/studio/sessions/authoring/abc123/cancel'), false);
  assert.equal(read.matches('/api/studio/sessions/authoring/abc123/revise'), false);
  assert.equal(read.matches('/api/studio/sessions/authoring/abc123'), true);
});

test('a GET is never claimed by the POST entry and vice versa', () => {
  assert.equal(claimant('GET', '/api/studio/sessions/authoring/abc123/cancel'), null);
  assert.equal(claimant('POST', '/api/studio/sessions/authoring/abc123'), null);
});

// ---------------------------------------------------------------------------
// Query strings. THE POSITIVE CONTROL for this file: put a matcher back that
// tests the raw url (`SESSION_READ_RE.test(url)` instead of
// `SESSION_READ_RE.test(pathOnly(url))`) and exactly these cases fail, because
// the anchored `$` cannot match past a `?`.
// ---------------------------------------------------------------------------

test('every entry claims its URL with a query string appended — the matcher normalises for itself', () => {
  assert.equal(claimant('GET', '/api/studio/sessions/authoring/abc123?tail=1'), '/api/studio/sessions/:kind/:sessionId');
  assert.equal(claimant('POST', '/api/studio/sessions/authoring/abc123/cancel?force=1'), '/api/studio/sessions/:kind/:sessionId/cancel');
  assert.equal(claimant('GET', '/api/studio/agents/creation-agent/capability?x=1'), '/api/studio/agents/:slug/capability');
});

test('a neighbouring URL in the same family is claimed by nobody', () => {
  // The aggregate index (`/api/studio/sessions`, no segments) is still a host
  // arm; if a matcher here ever claimed it, the index would 404 with the wrong
  // handler answering. Kills a `:kind` matcher written with `*` or `?`.
  assert.equal(claimant('GET', '/api/studio/sessions'), null);
  assert.equal(claimant('GET', '/api/studio/agents'), null);
  assert.equal(claimant('GET', '/api/studio/agents/creation-agent'), null);
});

// ---------------------------------------------------------------------------
// The deps are per-table, not per-module (T1 ruling 59 §3). The assembly-level
// twin of this — two bridges in one process — is `apps/forge/routes-assembly.test.ts`.
// ---------------------------------------------------------------------------

test('two tables built from different deps call their OWN closures', () => {
  const calls: string[] = [];
  const a = sessionsRoutes(stubDeps({ ensureSessionTail: () => void calls.push('a') }));
  const b = sessionsRoutes(stubDeps({ ensureSessionTail: () => void calls.push('b') }));
  assert.notEqual(a, b, 'each call must return its own table');
  const entryA = a.find((e) => e.path === '/api/studio/sessions/:kind/:sessionId');
  const entryB = b.find((e) => e.path === '/api/studio/sessions/:kind/:sessionId');
  assert.ok(entryA !== undefined && entryB !== undefined);
  assert.notEqual(entryA.handler, entryB.handler, 'a shared handler would mean shared deps');
});
