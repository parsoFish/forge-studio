/**
 * ACCEPTANCE TESTS (T3, R6-01 WI-2 / F4) — the never-existed-run contract for
 * `GET /api/runs/<id>`, driven at the REAL bridge route (not by calling
 * `findRun` directly).
 *
 * WHY THIS EXISTS: the flow run-detail page (route `/flows/[id]/run/[runId]`)
 * derives its `found` prop from this 404 — see
 * `apps/studio/lib/flow-run-detail-render.test.ts`'s "a run that never existed
 * renders an honest not-found" test, which feeds `found`/`run` in as PROPS.
 * That render test structurally CANNOT catch a server that starts fabricating
 * runs for unknown ids — it never talks to the bridge, so a regression at the
 * wire would sail straight through it. That is "the test is on the wrong
 * surface": the contract this file pins lives in `apps/forge/bridge-studio.ts`
 * (`findRun`, line 254, and the `/api/runs/<id>` route, line 527), and until
 * now nothing exercised it at the HTTP layer. `grep -rn "run not found"
 * --include="*.ts" .` finds exactly ONE hit — the source line itself — so the
 * contract was pinned by NO test anywhere before this file.
 *
 * Measured (by reading `apps/forge/bridge-studio.ts` directly):
 *   findRun(forgeRoot, id) === listRuns(forgeRoot, Date.now()).find(r =>
 *     r.id === id) ?? null                                     (line 254-256)
 *   `!run` → 404 `{ error: 'run not found' }`, no `run` key at all (line 536-538)
 *   a found run → 200 `{ run }`                                  (line 540)
 *
 * This file is GREEN ON ARRIVAL — the contract already holds on HEAD. It owes
 * a MUTATION PROOF, not a red→green proof: see the task report for the exact
 * mutation applied to `findRun`, the resulting RED output, and the
 * byte-for-byte restore proof (the mutation is never committed).
 *
 * Harness pattern copied from `apps/forge/bridge-studio-triggers.test.ts`:
 * `startBridge({ forgeRoot, port: 0 })` — port 0 is an OS-assigned ephemeral
 * port, never 4123/4124 (this test never touches the operator's fixed-port
 * Studio session). Seeds a tmp forge root with a `_queue/done/` manifest plus
 * its `_logs/<cycleId>/events.jsonl`, mirroring
 * `orchestrator/flow-run-detail-serving.test.ts`'s archived-run fixture shape
 * (same `flow_id: forge-develop`, same minimal start/end event pair) so this
 * file pins the SAME contract at the wire that file already pins at the
 * derivation layer.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — mirrors bridge-studio-triggers.test.ts's manifest shape
// ---------------------------------------------------------------------------

const REAL_INIT_ID = 'INIT-flow-run-detail-real-1';
const REAL_CYCLE_ID = '2026-01-01T00-00-00_INIT-flow-run-detail-real-1';
const NEVER_EXISTED_ID = 'never-existed-run-id-r6-01-f4';

function makeRealManifest(): string {
  return [
    '---',
    `initiative_id: ${REAL_INIT_ID}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'origin: architect',
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    `cycle_id: ${REAL_CYCLE_ID}`,
    'flow_id: forge-develop',
    '---',
    '',
    '# A real, archived run — the positive control.',
    '',
    'Seeded once at bridge start; must be found by id.',
  ].join('\n');
}

function makeRealEventsJsonl(): string {
  const baseEvent = { cycle_id: REAL_CYCLE_ID, initiative_id: REAL_INIT_ID, input_refs: [], output_refs: [] };
  const events = [
    { ...baseEvent, event_id: 'EV_001', phase: 'orchestrator', skill: 'cycle', event_type: 'start', started_at: '2026-01-01T00:00:05.000Z', message: 'cycle.start', metadata: { origin: 'architect' } },
    { ...baseEvent, event_id: 'EV_002', phase: 'developer-loop', skill: 'developer-loop', event_type: 'start', started_at: '2026-01-01T00:00:10.000Z' },
    { ...baseEvent, event_id: 'EV_003', phase: 'developer-loop', skill: 'developer-loop', event_type: 'end', started_at: '2026-01-01T00:00:20.000Z', metadata: { cost_usd: 1.0 } },
    { ...baseEvent, event_id: 'EV_004', phase: 'orchestrator', skill: 'cycle', event_type: 'end', started_at: '2026-01-01T00:00:25.000Z', message: 'cycle.end', metadata: { status: 'complete' } },
  ];
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-flow-run-detail-'));

  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'done', `${REAL_INIT_ID}.md`), makeRealManifest());
  mkdirSync(join(forgeRoot, '_logs', REAL_CYCLE_ID), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', REAL_CYCLE_ID, 'events.jsonl'), makeRealEventsJsonl());

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The never-existed run
// ---------------------------------------------------------------------------

test('GET /api/runs/<never-existed-id> -> 404, and the body carries NO `run` key at all', async () => {
  // KILLS: `findRun` (or the route) synthesising a Run object for an unknown
  // id — e.g. a "helpful" default like `{status:'pending', phases:{}}`, or a
  // fix that gets the STATUS CODE right (404) but still ships a fabricated
  // `run` object in the body (a status-only assertion would pass that). The
  // run-detail page's `found` flag is only as honest as this body shape.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(NEVER_EXISTED_ID)}`);
  assert.equal(res.status, 404, `expected 404 for a never-existed run id, got ${res.status}`);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal('run' in body, false, `404 body must carry NO 'run' key at all, got ${JSON.stringify(body)}`);
  assert.equal(typeof body.error, 'string', `expected an { error: string } body, got ${JSON.stringify(body)}`);
});

test('POSITIVE CONTROL on the SAME bridge: GET /api/runs/<the-real-seeded-id> -> 200 with run.id equal to the seeded id', async () => {
  // WITHOUT THIS: a totally broken bridge that 404s every request (e.g. a
  // route wired to the wrong forgeRoot, or a listRuns() call that silently
  // throws and is swallowed) would pass the "never-existed -> 404" test above
  // for the WRONG reason — it 404s everything, not just unknown ids. This
  // proves the bridge can actually resolve a REAL id on the identical route,
  // in the identical process, before the 404 test above is trusted.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(REAL_CYCLE_ID)}`);
  assert.equal(res.status, 200, `expected 200 for the real seeded run id, got ${res.status}`);

  const body = (await res.json()) as { run?: { id?: string } };
  assert.ok(body.run, `expected a 'run' key in the 200 body, got ${JSON.stringify(body)}`);
  assert.equal(body.run!.id, REAL_CYCLE_ID, `expected run.id to equal the seeded cycle id, got ${JSON.stringify(body.run)}`);
});

// ---------------------------------------------------------------------------
// R6-04 precedent — not regressed for the sibling agent-run surface
// ---------------------------------------------------------------------------

test('R6-04 REGRESSION GUARD: GET /api/agents/runs/<never-existed-id> -> 404 (unchanged by this feature)', async () => {
  // KILLS: a change made in service of the flow run-detail surface that
  // accidentally weakens or removes the SIBLING contract R6-04 already
  // established for agent runs (apps/forge/ui-bridge.ts:1146, keyed off run
  // DIRECTORY existence under _logs/). F4 must ADD a contract for flow runs,
  // not touch this one — this test names the mechanism so a shared-helper
  // refactor that widens the 404-avoidance logic gets caught here too.
  const res = await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(NEVER_EXISTED_ID)}`);
  assert.equal(res.status, 404, `expected 404 for a never-dispatched agent run id, got ${res.status}`);
});
