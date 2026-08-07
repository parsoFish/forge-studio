/**
 * ACCEPTANCE TESTS (T3, R6-01 WI-3 / F5) — the RAW per-node event data path
 * a run-detail node click-through needs, driven at the REAL bridge route
 * (never by calling `classifyEvent`/`eventToNodeId` directly).
 *
 * MEASURED [exec], against the REAL bridge handler, before writing a line of
 * this file (full trace in the task report):
 *
 *   (a) `GET /api/runs/<id>/phases/<node>/log` (`cli/bridge-studio.ts:459`)
 *       returns `{lines: LogLine[]}` where `LogLine = {at, kind, text,
 *       detail?}` — `kind` is the DRAWER's OWN 6-value vocabulary
 *       (`info|tool|cost|stderr|retry|reasoning`, `classifyEvent`,
 *       bridge-studio.ts:208), computed server-side from the raw
 *       `EventLogEntry`. Live probe: an `architect` node emitting `start`,
 *       `tool_use`, `log`(reasoning), `error`, `agent_heartbeat`, `end` comes
 *       back as `{kind:"info"|"tool"|"reasoning"|"stderr"|"cost"|"info", ...}`
 *       — the response carries NO `event_type` field anywhere in the body.
 *   (b) `forge-ui/lib/run-log-line.ts`'s `deriveLogLine(event: EventLogEntry)`
 *       — the SHARED think|tool|out mapper F5 must reuse (this initiative's
 *       own substrate note: "F5 renderer... Extension point is the INPUT,
 *       not the component") — reads `event.event_type` directly (`kindFor`)
 *       plus `event.message`/`event.skill`/`event.cost_usd` (`textFor`).
 *       None of those survive (a)'s endpoint.
 *   (c) No other per-node RAW-event path exists for a FLOW run. The only
 *       analogous RAW path in this codebase, `GET /api/agents/runs/:runId`
 *       (`cli/ui-bridge.ts:1139`), returns UNCLASSIFIED `JSON.parse`'d
 *       records (`lines: parsed.slice(-RUN_LOG_LINES_MAX)`, ui-bridge.ts
 *       :1181) — but for the WHOLE standalone-agent run it backs, never
 *       filtered to one flow node. `grep -rn "phases/.*log" cli/ forge-ui/`
 *       finds exactly the ONE route in (a).
 *
 * CONCLUSION: this file pins a NEW `raw=1` mode on the EXISTING route —
 * mirroring that SAME route's own existing `stderr=1` query-param
 * convention exactly (bridge-studio.ts:471, `qs.get('stderr') === '1'`)
 * rather than inventing a new URL — that returns the node's OWN raw,
 * unclassified events (the SAME `nodeEvents` array the route already
 * computes at line 501, BEFORE `classifyEvent` is ever called). D2 (F1 does
 * NOT converge PhaseDrawer's renderer) stays intact: PhaseDrawer never
 * passes `raw=1`, so its existing `{kind,text,at,detail}` contract must stay
 * provably unchanged (pinned below as a regression guard).
 *
 * ASSUMED NEW BEHAVIOUR on the existing route (none of it exists yet — every
 * test below is a legitimate RED against the unmodified route):
 *
 *   GET /api/runs/<id>/phases/<node>/log?raw=1
 *     -> 200 { lines: <node's own raw event records, `event_type` preserved,
 *              capped to the last 200 exactly as the classified path is> }
 *
 * Harness pattern copied from `cli/bridge-studio-flow-run-detail.test.ts`:
 * `startBridge({ forgeRoot, port: 0 })` — port 0 only, never 4123/4124.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const INIT_ID = 'INIT-r6-01-f5-raw-1';
const CYCLE_ID = '2026-01-01T00-00-00_INIT-r6-01-f5-raw-1';

function manifest(): string {
  return [
    '---',
    `initiative_id: ${INIT_ID}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    'origin: architect',
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    `cycle_id: ${CYCLE_ID}`,
    'flow_id: forge-develop',
    '---',
    '',
    '# R6-01 WI-3 (F5) raw-per-node-log fixture',
  ].join('\n');
}

// architect -> node 'architect'; developer-loop -> node 'dev'
// (orchestrator/run-model.ts FALLBACK_PHASE_TO_NODE, lines 202/204) — both
// measured [exec] against the real buildNodeMapping() in the task report.
function eventsJsonl(): string {
  const base = { cycle_id: CYCLE_ID, initiative_id: INIT_ID, input_refs: [], output_refs: [] };
  const events = [
    { ...base, event_id: 'EV_A1', phase: 'architect', skill: 'architect', event_type: 'start', started_at: '2026-01-01T00:00:01.000Z', message: 'architect.start' },
    { ...base, event_id: 'EV_A2', phase: 'architect', skill: 'architect', event_type: 'tool_use', started_at: '2026-01-01T00:00:02.000Z', message: 'ARCHITECT-ONLY-TOOL-MARKER', metadata: { tool_name: 'Read' } },
    { ...base, event_id: 'EV_A3', phase: 'architect', skill: 'architect', event_type: 'phase_transition', started_at: '2026-01-01T00:00:03.000Z', metadata: { from: 'architect', to: 'pm', reason: 'handoff' } },
    { ...base, event_id: 'EV_A4', phase: 'architect', skill: 'architect', event_type: 'error', started_at: '2026-01-01T00:00:04.000Z', message: 'ARCHITECT-ONLY-ERROR-MARKER' },
    { ...base, event_id: 'EV_A5', phase: 'architect', skill: 'architect', event_type: 'end', started_at: '2026-01-01T00:00:05.000Z', cost_usd: 0.5 },
    { ...base, event_id: 'EV_D1', phase: 'developer-loop', skill: 'developer-loop', event_type: 'start', started_at: '2026-01-01T00:00:10.000Z', message: 'DEV-ONLY-START-MARKER' },
    { ...base, event_id: 'EV_D2', phase: 'developer-loop', skill: 'developer-loop', event_type: 'iteration', started_at: '2026-01-01T00:00:11.000Z', iteration: 1 },
    { ...base, event_id: 'EV_D3', phase: 'developer-loop', skill: 'developer-loop', event_type: 'end', started_at: '2026-01-01T00:00:20.000Z', metadata: { cost_usd: 1.0 } },
  ];
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-phase-log-raw-'));
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'done', `${INIT_ID}.md`), manifest());
  mkdirSync(join(forgeRoot, '_logs', CYCLE_ID), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', CYCLE_ID, 'events.jsonl'), eventsJsonl());

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
// raw=1 — the node's own raw events, event_type preserved
// ---------------------------------------------------------------------------

test('raw=1 returns the node\'s raw event_type per line, in order — never the classified 6-kind vocabulary', async () => {
  // KILLS: an implementation that ignores `raw=1` and keeps returning the
  // SAME classified {kind,text,at,detail} shape regardless (ships nothing
  // new for F5); also kills one that returns the CLASSIFIED `kind` string
  // ('tool') in place of the real `event_type` ('tool_use').
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log?raw=1`);
  assert.equal(res.status, 200);
  const body = await res.json() as { lines: Array<{ event_type?: string }> };
  assert.ok(Array.isArray(body.lines), 'body.lines is an array');
  const eventTypes = body.lines.map((l) => l.event_type);
  assert.deepEqual(eventTypes, ['start', 'tool_use', 'phase_transition', 'error', 'end']);
});

test('raw=1 preserves the message/skill/cost_usd fields deriveLogLine\'s textFor needs — not just event_type', async () => {
  // KILLS: an implementation that strips the line down to `{event_type}`
  // only, which would make deriveLogLine's textFor() fall through to the
  // generic `${event_type} (${skill})` fallback for every line instead of
  // rendering the agent's ACTUAL message/skill/cost — silently discarding
  // the real content this feature exists to surface.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log?raw=1`);
  const body = await res.json() as { lines: Array<Record<string, unknown>> };
  const start = body.lines.find((l) => l.event_type === 'start');
  assert.equal(start?.message, 'architect.start');
  assert.equal(start?.skill, 'architect');
  const end = body.lines.find((l) => l.event_type === 'end');
  assert.equal(end?.cost_usd, 0.5);
  const toolLine = body.lines.find((l) => l.event_type === 'tool_use');
  assert.equal(toolLine?.message, 'ARCHITECT-ONLY-TOOL-MARKER');
});

// ---------------------------------------------------------------------------
// Node scoping — a node's raw lines are THAT node's own, never a neighbour's
// ---------------------------------------------------------------------------

test('raw=1 scopes to the requested node ONLY — the architect node never leaks dev\'s events', async () => {
  // KILLS: a `raw=1` implementation that forgets the existing node filter and
  // returns the WHOLE run's raw events regardless of which node was asked
  // for — "a node's log lines are that node's own, never the whole run's".
  // Also guards against a WEAKER, accidental pass: the `event_type`
  // assertion forces this test to be evaluated against the RAW shape
  // specifically (the classified shape has no `.message` field at all, so a
  // message-absence check alone would pass identically whether raw mode
  // exists or not — that would be characterization, not acceptance).
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log?raw=1`);
  const body = await res.json() as { lines: Array<Record<string, unknown>> };
  assert.equal(body.lines.length, 5, `expected exactly the 5 architect events, got ${body.lines.length}`);
  assert.ok(body.lines.every((l) => typeof l.event_type === 'string'), 'every raw line must carry a real event_type string');
  const messages = body.lines.map((l) => l.message).filter(Boolean);
  assert.ok(!messages.includes('DEV-ONLY-START-MARKER'), 'dev marker must not appear in the architect node\'s raw log');
});

test('raw=1 scopes to the requested node ONLY — the dev node never leaks architect\'s events', async () => {
  // KILLS: the same defect as above, checked from the other node — a filter
  // that accidentally unions both nodes' events (e.g. an `||` where a `&&`
  // belongs) can pass a single-direction check while still leaking.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/dev/log?raw=1`);
  const body = await res.json() as { lines: Array<Record<string, unknown>> };
  assert.equal(body.lines.length, 3, `expected exactly the 3 dev events, got ${body.lines.length}`);
  const eventTypes = body.lines.map((l) => l.event_type);
  assert.deepEqual(eventTypes, ['start', 'iteration', 'end']);
  const messages = body.lines.map((l) => l.message).filter(Boolean);
  assert.ok(!messages.includes('ARCHITECT-ONLY-TOOL-MARKER'), 'architect marker must not appear in the dev node\'s raw log');
  assert.ok(!messages.includes('ARCHITECT-ONLY-ERROR-MARKER'), 'architect marker must not appear in the dev node\'s raw log');
});

test('raw=1 on a node the run never touched honestly 200s with an empty array, never an error', async () => {
  // KILLS: a raw-mode implementation that 404s or 500s for a real, but
  // idle, node — matches the ALREADY-CORRECT behaviour of the classified
  // (non-raw) path today (measured [exec]: an unknown node returns
  // `200 {lines: []}`, never an error) — raw mode must not regress that.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/demo/log?raw=1`);
  assert.equal(res.status, 200);
  const body = await res.json() as { lines: unknown[] };
  assert.deepEqual(body.lines, []);
});

// ---------------------------------------------------------------------------
// Regression guard — D2: the CLASSIFIED (non-raw) path is unperturbed
// ---------------------------------------------------------------------------

test('WITHOUT raw=1, the SAME route still returns ONLY the classified 6-kind vocabulary — PhaseDrawer\'s contract is untouched (D2)', async () => {
  // KILLS: an implementation that, while adding raw=1 support, starts
  // returning `deriveLogLine`-shaped kind values (think|tool|out) on the
  // DEFAULT path too. PhaseDrawer.tsx switches on the literal kind string
  // (`colorMap[line.kind]`, `line.kind === 'reasoning'`, `line.kind ===
  // 'retry'`) — a `kind: 'think'`/`'out'` line would silently mis-render
  // there (wrong badge, lost reasoning/retry special-casing). GREEN ON
  // ARRIVAL (this is already true on HEAD) — see the task report for the
  // mutation proof.
  const res = await fetch(`${bridgeUrl}/api/runs/${encodeURIComponent(CYCLE_ID)}/phases/architect/log`);
  assert.equal(res.status, 200);
  const body = await res.json() as { lines: Array<{ kind: string; event_type?: string }> };
  const CLASSIFIED_KINDS = new Set(['info', 'tool', 'cost', 'stderr', 'retry', 'reasoning']);
  for (const line of body.lines) {
    assert.ok(CLASSIFIED_KINDS.has(line.kind), `unexpected kind "${line.kind}" outside the classified 6-value vocabulary`);
    assert.equal(line.event_type, undefined, 'the classified (non-raw) path must not carry a raw event_type field');
  }
});
