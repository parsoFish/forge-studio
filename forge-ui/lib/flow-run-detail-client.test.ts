/**
 * Acceptance tests for a STATUS-AWARE `found` resolver for the flow
 * run-detail client fetch (R6-01 WI-2 / F4, round 2) —
 * `forge-ui/lib/flow-run-detail-client.ts`, a pure module that does not
 * exist yet. Every assertion below is a legitimate RED against a
 * not-yet-created file.
 *
 * THE DEFECT THIS CLOSES: `studio-client.ts`'s existing `fetchRun` —
 *
 *   const body = await studioGet<{ run: unknown } | null>(`/api/runs/${id}`, null);
 *   if (!body?.run) return null;
 *
 * — and `studioGet` itself (studio-client.ts:428-438) collapse FOUR distinct
 * unhappy paths into one `null`: no bridge configured, ANY `!res.ok` (a 404
 * AND a 500 read identically), and any thrown network/parse error. That
 * convention is correct for `fetchRun`'s existing callers (degrade to empty,
 * never reject a sibling panel's `Promise.all`) and this file does not touch
 * `fetchRun` or `studio-client.ts` — those callers must not change behaviour.
 * It is wrong as the source of `found` for the run-detail PAGE: if the page
 * derived `found: false` from `fetchRun(id) === null`, a transient bridge
 * outage would render `data-component="run-not-found"` — an ERROR state
 * rendered as an authoritative NEGATIVE FACT ("this run never existed").
 * `cli/bridge-studio-flow-run-detail.test.ts` (round 1) proves the SERVER
 * tells the truth (404 only for a genuinely unknown id); this file closes the
 * gap where the CLIENT was about to throw that truth away at the last hop.
 *
 * CONVENTION MATCHED, NOT INVENTED: `./run-view-client.ts`'s
 * `resolveRunDetailFromResponse` (R6-04 WI-4) already established the
 * ORDERING discipline this file reuses verbatim — status decides FIRST,
 * before body is ever inspected for a "found" signal, so a stray/cached body
 * on an error response can never leak through as a live run (see that file's
 * header, lines 28-36, and `./run-view-client.test.ts`'s assertions on it).
 *
 * WHERE THIS FILE DIVERGES, DELIBERATELY: `resolveRunDetailFromResponse`
 * maps EVERY non-2xx status (404 alongside 500, alongside a thrown-fetch
 * sentinel) to the SAME `found: false` — a two-state contract. That is
 * exactly the "error rendered as authoritative negative fact" defect this
 * task exists to close, just relocated from the body layer to the status
 * layer: a two-state contract still cannot distinguish "this run never
 * existed" from "the bridge is having a bad day". So the resolver pinned
 * here is DELIBERATELY THREE-STATE:
 *
 *   status === 404                         -> { kind: 'not-found' }
 *   status in [200, 300)                   -> { kind: 'found', run }
 *     (a 2xx body missing a parseable `run` key is itself an ANOMALY —
 *      the server's OWN contract, pinned in cli/bridge-studio-flow-run-
 *      detail.test.ts, is "200 always carries { run }" — so this does NOT
 *      degrade to `found` with an empty run; it is 'unresolved', same as a
 *      genuine parse/network failure)
 *   anything else (5xx, other 4xx, a       -> { kind: 'unresolved' }
 *     thrown-fetch/network-failure sentinel,
 *     malformed 200 body)
 *
 * `unresolved` is a state a caller must render as NEITHER the timeline NOR
 * the not-found body — the honest "I don't know yet / I couldn't tell"
 * state a two-state contract has no room for.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./flow-run-detail-client.ts` (none exist yet):
 *
 *   export type FlowRunDetailResolution =
 *     | { kind: 'found'; run: Run }
 *     | { kind: 'not-found' }
 *     | { kind: 'unresolved' };
 *
 *   export function resolveFlowRunDetailFromResponse(
 *     status: number,
 *     body: unknown,
 *   ): FlowRunDetailResolution;
 *
 * The implementer will also add an async `fetchFlowRunDetail(id)` wrapper
 * (real `resolveBridgeUrl()` + `fetch(...)`, calling this pure resolver with
 * the real response's `status` and parsed body) — that wrapper is in the SAME
 * untestable category `./run-view-client.ts`'s own `fetchRunDetail` already
 * is (this repo has no jsdom / mocked-`fetch` harness for one seam; see that
 * file's "KNOWN GAP" paragraph), so it is NOT pinned here. The convention the
 * wrapper is expected to follow: no bridge configured, OR a thrown
 * `fetch()`, OR a thrown/failed `res.json()` all resolve via THIS function
 * called with a sentinel `status` of `0` (never a real 2xx/404) and
 * `body: null` — status `0` is the conventional "no real HTTP response"
 * value (no server ever legitimately answers with status 0), which is why
 * the tests below exercise it directly as the "bridge unreachable" case.
 *
 * Run parsing: `parseRun` (`./studio-client.ts`) already coerces a raw wire
 * object into a `Run`, defaulting every missing field rather than throwing
 * (studio-client.ts:538-559) — reused here so a `found` resolution's `run`
 * gets the SAME defaulting discipline every other Run-consuming surface gets,
 * not a second, divergent one.
 */

import { test, expect } from 'vitest';

import { resolveFlowRunDetailFromResponse, type FlowRunDetailResolution } from './flow-run-detail-client.ts';
import { type Run } from './studio-client.ts';

const REAL_RUN_BODY = {
  run: {
    id: '2026-01-01T00-00-00_INIT-done-2',
    flowId: 'forge-develop',
    initiativeId: 'INIT-done-2',
    initiative: 'Archived probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 4.1,
    phases: { dev: 'complete' },
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
  },
};

/** A body that LOOKS like a legitimate, currently-running run — the exact
 *  shape a stale cache or a mis-scoped fake would carry. Used to prove body
 *  content never overrides what the status already decided. */
const PLAUSIBLE_STALE_RUN_BODY = {
  run: {
    id: 'some-other-run-id',
    flowId: 'forge-develop',
    initiativeId: 'INIT-other',
    initiative: 'A DIFFERENT, still-running initiative',
    status: 'active',
    origin: 'architect',
    costUsd: 0.5,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
  },
};

// ---------------------------------------------------------------------------
// 404 -> not-found, regardless of body
// ---------------------------------------------------------------------------

test('404 with an empty body -> { kind: "not-found" }', () => {
  const r = resolveFlowRunDetailFromResponse(404, {});
  expect(r).toEqual({ kind: 'not-found' });
});

test('404 WINS even when the body carries a plausible-looking, currently-running run — kills "reads body.run before checking status, so a 404 with a stale/cached body leaks through as found" (mirrors run-view-client.ts\'s status-first ordering, applied in the direction that protects against a false POSITIVE)', () => {
  const r = resolveFlowRunDetailFromResponse(404, PLAUSIBLE_STALE_RUN_BODY);
  expect(r.kind).toBe('not-found');
  expect(r).not.toHaveProperty('run');
});

// ---------------------------------------------------------------------------
// 2xx with a real body -> found, run parsed via the shared parseRun discipline
// ---------------------------------------------------------------------------

test('200 with a real { run } body -> { kind: "found", run } — the id and status pass through untouched', () => {
  const r = resolveFlowRunDetailFromResponse(200, REAL_RUN_BODY);
  expect(r.kind).toBe('found');
  if (r.kind !== 'found') throw new Error('unreachable — asserted above');
  expect(r.run.id).toBe('2026-01-01T00-00-00_INIT-done-2');
  expect(r.run.status).toBe('complete');
  expect(r.run.costUsd).toBe(4.1);
});

test('201 (any 2xx, not only 200) with a real body -> found — the boundary is the [200,300) RANGE, not the literal value 200', () => {
  const r = resolveFlowRunDetailFromResponse(201, REAL_RUN_BODY);
  expect(r.kind).toBe('found');
});

// ---------------------------------------------------------------------------
// KILL 1 — a resolver keying off the body (`!body?.run -> notFound`, the
// `fetchRun` conflation): a 500 and a bridge-unreachable case must NEITHER
// collapse to not-found (`fetchRun`'s bug) NOR silently read as found.
// ---------------------------------------------------------------------------

test('KILL 1a: a 500 carrying a plausible run body -> unresolved, NEVER not-found and NEVER found — kills the `fetchRun` conflation ("no usable run in the body" -> notFound) applied to a SERVER ERROR, which would tell the operator a live run never existed', () => {
  const r = resolveFlowRunDetailFromResponse(500, PLAUSIBLE_STALE_RUN_BODY);
  expect(r).toEqual({ kind: 'unresolved' });
  expect(r.kind).not.toBe('not-found');
  expect(r.kind).not.toBe('found');
});

test('KILL 1b: the bridge-unreachable sentinel (status 0, no body) -> unresolved, NEVER not-found — kills treating "we could not even reach the server" the same as "the server told us this run does not exist"', () => {
  const r = resolveFlowRunDetailFromResponse(0, null);
  expect(r).toEqual({ kind: 'unresolved' });
  expect(r.kind).not.toBe('not-found');
});

// ---------------------------------------------------------------------------
// KILL 2 — status decides BEFORE body is ever inspected, in BOTH directions
// ---------------------------------------------------------------------------

test('KILL 2a: a 200 with a malformed/absent body does NOT silently become not-found — it is unresolved, since the server\'s own contract guarantees a 2xx always carries a parseable { run }', () => {
  const emptyObject = resolveFlowRunDetailFromResponse(200, {});
  const nullBody = resolveFlowRunDetailFromResponse(200, null);
  const stringBody = resolveFlowRunDetailFromResponse(200, 'not an object');
  const nullRun = resolveFlowRunDetailFromResponse(200, { run: null });
  const nonObjectRun = resolveFlowRunDetailFromResponse(200, { run: 'not an object either' });

  for (const r of [emptyObject, nullBody, stringBody, nullRun, nonObjectRun]) {
    expect(r).toEqual({ kind: 'unresolved' });
    expect(r.kind).not.toBe('not-found');
  }
});

test('KILL 2b: an error response (404) carrying a stale run body never surfaces as found — status decides first, in the direction that protects against a false POSITIVE (companion to the 404-wins test above, phrased as the explicit status-vs-body ordering kill)', () => {
  const r = resolveFlowRunDetailFromResponse(404, REAL_RUN_BODY);
  expect(r.kind).not.toBe('found');
  expect(r.kind).toBe('not-found');
});

// ---------------------------------------------------------------------------
// KILL 3 — unresolved is a THIRD, DISTINCT state, never collapsed into
// not-found by a resolver that still thinks in two states
// ---------------------------------------------------------------------------

test('KILL 3: unresolved is DISTINGUISHABLE from not-found — kills a two-state resolver ported straight from run-view-client.ts\'s convention, where any non-2xx (including 5xx and network failure) maps to the SAME "not found" value', () => {
  const serverError = resolveFlowRunDetailFromResponse(500, {});
  const unreachable = resolveFlowRunDetailFromResponse(0, null);
  const trueNotFound = resolveFlowRunDetailFromResponse(404, {});

  // The literal discriminant must differ — not merely "not found:true" vs
  // some other falsy encoding. A two-state port would make all three equal.
  expect(serverError.kind).toBe('unresolved');
  expect(unreachable.kind).toBe('unresolved');
  expect(trueNotFound.kind).toBe('not-found');
  expect(serverError.kind).not.toBe(trueNotFound.kind);
  expect(unreachable.kind).not.toBe(trueNotFound.kind);
});

// ---------------------------------------------------------------------------
// The not-found trigger is 404 SPECIFICALLY, not "any 4xx" — the point where
// this contract most sharply diverges from run-view-client.ts's `!res.ok`
// ---------------------------------------------------------------------------

test('a non-404 4xx (e.g. 403) is unresolved, NOT not-found — the not-found state is keyed to the literal 404 the server contract documents, not a generic "client error" bucket', () => {
  const r = resolveFlowRunDetailFromResponse(403, {});
  expect(r.kind).toBe('unresolved');
});

// ---------------------------------------------------------------------------
// Determinism — same input, same output (no hidden clock/random dependence)
// ---------------------------------------------------------------------------

test('the resolver is a pure function of (status, body) — same input twice yields deepEqual output', () => {
  const first = resolveFlowRunDetailFromResponse(200, REAL_RUN_BODY);
  const second = resolveFlowRunDetailFromResponse(200, REAL_RUN_BODY);
  expect(second).toEqual(first);
});

// Type-only compile check that the assumed shape round-trips — not a runtime
// assertion, just keeps the header's ASSUMED EXPORTS honest against drift.
function _typeCheck(r: FlowRunDetailResolution): Run | null {
  if (r.kind === 'found') return r.run;
  return null;
}
void _typeCheck;
