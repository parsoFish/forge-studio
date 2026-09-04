/**
 * Acceptance tests closing the gap `./run-view-client.ts`'s own header
 * documents and this initiative's follow-up round exists to close: with
 * `GET /api/agents/runs/:runId` now 404ing for a genuinely unknown runId
 * (see `apps/forge/ui-bridge-agent-run.test.ts`'s new "no run directory at all"
 * tests), `RunView.tsx`'s `found` prop — pinned thoroughly at the component
 * level in `./run-view-render.test.ts`, including that `found:false`
 * suppresses content even when other data is present — finally has a real
 * signal to key off. This file pins that the CLIENT actually reads that
 * signal.
 *
 * `fetchRunDetail` (the existing exported function) does the real network
 * call — `resolveBridgeUrl()` + `fetch(...)` — and is therefore in the same
 * KNOWN GAP category as `RunPanel.tsx`'s polling `useEffect` (see that
 * file's header, and `./run-view-client.ts`'s own header): not reachable by
 * a unit test without a running bridge or a mocked global `fetch`, neither
 * of which this repo wants added for one seam. So — mirroring the SAME
 * pure-logic-extraction precedent as `./run-panel-view.ts` vs
 * `RunPanel.tsx` — this file pins a NEW pure export,
 * `resolveRunDetailFromResponse(status, body)`, that `fetchRunDetail` must
 * be refactored to call with the real fetch's resolved `status` and parsed
 * JSON `body`. This export does not exist yet on `./run-view-client.ts`
 * today (only `RunDetail` / `materialsFromEvents` / `ceilingFromEvents` /
 * `fetchRunDetail` are exported) — every import below is a legitimate RED
 * until the implementer adds it.
 *
 * ASSUMED NEW EXPORT from `./run-view-client.ts`:
 *
 *   export function resolveRunDetailFromResponse(status: number, body: unknown): RunDetail
 *
 * Must mirror `fetchRunDetail`'s own already-shipped `!res.ok` convention
 * (any non-2xx status, not just 404, means "not found") — this file does
 * not introduce a new convention, it makes the existing one testable and
 * confirms the 404 fix doesn't need a 404-only special case.
 *
 * RUN: npx vitest run lib/run-view-client.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { resolveRunDetailFromResponse, type RunDetail } from './run-view-client.ts';

test('404 -> found:false, and the rest of the shape is the same honest "not found" default RunView already treats as suppress-everything — kills "reads body.state before checking status, so a 404 with a stray body leaks through as found"', () => {
  const detail = resolveRunDetailFromResponse(404, {});
  expect(detail.found).toBe(false);
  expect(detail.resolution).toBe('not-found');
  expect(detail.lines).toEqual([]);
  expect(detail.materials).toEqual([]);
  expect(detail.outputRefs).toEqual([]);
});

test('404 WINS even when the response body carries a plausible-looking run payload — kills "checks body.state === \'running\' as its found signal instead of the HTTP status, so a stray/cached body makes a 404 look like a live run"', () => {
  const detail = resolveRunDetailFromResponse(404, {
    ok: true,
    state: 'running',
    costUsd: 5,
    lines: [{ event_type: 'start', skill: 'issue-triage' }],
  });
  expect(detail.found).toBe(false);
});

test('a non-404 non-2xx status (e.g. 500) maps to resolution "unresolved" carrying the bridge\'s own error — a read failure is NEVER rendered as the authoritative "run not found" (⚑ AMENDED W7-B5, bead forge-irn: the old two-state collapse was the filed defect)', () => {
  const detail = resolveRunDetailFromResponse(500, { error: 'internal error' });
  expect(detail.found).toBe(false);
  expect(detail.resolution).toBe('unresolved');
  expect(detail.readError).toEqual({ message: 'internal error', status: 500 });
});

test('200 with a real body -> found:true, state/costUsd passed through — kills "the new found:false path accidentally short-circuits the existing 200 success path"', () => {
  const detail = resolveRunDetailFromResponse(200, { state: 'done', costUsd: 0.34, lines: [] });
  expect(detail.found).toBe(true);
  expect(detail.state).toBe('done');
  expect(detail.costUsd).toBe(0.34);
});

test('200 with real event lines -> materials + ceiling still derived correctly (REGRESSION on the existing materialsFromEvents/ceilingFromEvents derivation — this new function must not bypass it)', () => {
  const detail = resolveRunDetailFromResponse(200, {
    state: 'done',
    costUsd: 0.5,
    lines: [
      { event_type: 'log', skill: 'issue-triage', message: 'agent-run.materials-staged', metadata: { materials: [{ path: 'materials/notes.md', kind: 'documents' }] } },
      { event_type: 'end', skill: 'issue-triage', metadata: { kickoff_ceiling_usd: 2.5 } },
    ],
  });
  expect(detail.found).toBe(true);
  expect(detail.materials).toEqual([{ path: 'materials/notes.md', kind: 'documents' }]);
  expect(detail.ceilingUsd).toBe(2.5);
});

test('200 with a malformed/missing body does not crash, degrades to honest defaults — kills "throws on an unexpected 200 body shape, taking the whole page load down"', () => {
  expect(() => resolveRunDetailFromResponse(200, null)).not.toThrow();
  expect(() => resolveRunDetailFromResponse(200, 'not an object')).not.toThrow();
  const detail = resolveRunDetailFromResponse(200, {});
  expect(detail.found).toBe(true);
  expect(detail.state).toBe('unknown');
  expect(detail.costUsd).toBe(0);
  expect(detail.lines).toEqual([]);
});

// ---------------------------------------------------------------------------
// TRIGGER PROVENANCE (debt-T trigger plumbing) — `RunDetail` does NOT declare
// a `trigger` field today (see this file's header: `materialsFromEvents` /
// `ceilingFromEvents` / `fetchRunDetail` / `RunDetail` are the only exports
// this file's own header documents), so the returned value is read through a
// widened cast (`as RunDetail & { trigger?: unknown }`) below — matching the
// SAME widened-cast convention used in `./run-view-render.test.ts`'s new
// trigger tests for `RunViewProps`. The RED-ness of the first test below
// comes from `resolveRunDetailFromResponse` (run-view-client.ts:126) itself:
// it destructures only `state`/`costUsd`/`lines` off the body and drops every
// other key, `trigger` included — not from the type cast.
// ---------------------------------------------------------------------------

test('200 with a real trigger on the body -> carried through verbatim onto detail.trigger — kills "resolver silently drops unknown keys, so a run\'s trigger provenance never reaches RunView"', () => {
  const detail = resolveRunDetailFromResponse(200, {
    state: 'done',
    costUsd: 0.5,
    lines: [],
    trigger: { kind: 'merged', source: 'flow:forge-develop', scope: null },
  }) as RunDetail & { trigger?: unknown };

  expect(detail.trigger).toEqual({ kind: 'merged', source: 'flow:forge-develop', scope: null });
});

// COMPANION (not independently RED — today's resolver never sets `trigger`
// at all, so `detail.trigger` is already `undefined` for a body with no
// `trigger` key, before any fix lands). Paired with the RED pin directly
// above: once the resolver carries `trigger` through, a body that never had
// one must still resolve to `undefined` rather than a fabricated default
// (e.g. `{kind: 'manual', ...}` guessed in when the wire data says nothing).
test('companion: 200 with no trigger on the body -> detail.trigger is undefined, never a fabricated default', () => {
  const detail = resolveRunDetailFromResponse(200, {
    state: 'done',
    costUsd: 0.5,
    lines: [],
  }) as RunDetail & { trigger?: unknown };

  expect(detail.trigger).toBeUndefined();
});
