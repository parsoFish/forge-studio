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

const noopDeps: SessionsRouteDeps = { ensureSessionTail: () => {}, broadcastKindChanged: () => {} };

/** The first entry that claims `url`, by the same rule `dispatchRoute` uses. */
function claimant(method: string, url: string): string | null {
  const hit = sessionsRoutes(noopDeps).find((e) => e.method === method && e.matches(url));
  return hit === undefined ? null : hit.path;
}

test('the table is ordered, and every entry declares method, path, matcher and a dry classification', () => {
  const table = sessionsRoutes(noopDeps);
  assert.equal(table.length, 3, 'a route added or removed without updating this pin');
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
  const a = sessionsRoutes({ ensureSessionTail: () => calls.push('a'), broadcastKindChanged: () => {} });
  const b = sessionsRoutes({ ensureSessionTail: () => calls.push('b'), broadcastKindChanged: () => {} });
  assert.notEqual(a, b, 'each call must return its own table');
  const entryA = a.find((e) => e.path === '/api/studio/sessions/:kind/:sessionId');
  const entryB = b.find((e) => e.path === '/api/studio/sessions/:kind/:sessionId');
  assert.ok(entryA !== undefined && entryB !== undefined);
  assert.notEqual(entryA.handler, entryB.handler, 'a shared handler would mean shared deps');
});
