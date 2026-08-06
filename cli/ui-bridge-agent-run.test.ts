/**
 * Tests for the generic `POST /api/agents/<slug>/run` route (R2-01-F3 dispatch
 * half) — the agent-page run surface for a non-interactive roster agent.
 *
 * Validation is exercised against a temp forgeRoot with two fixture studio
 * agents (`test-runnable` unattended, `test-interactive` interactive) under
 * `<root>/skills/`. FORGE_ARCHITECT_NO_SPAWN=1 keeps the happy path from
 * launching a real SDK run — the route still returns the runId.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function studioAgent(slug: string, surface: string): string {
  return `---
name: ${slug}
description: fixture agent for the generic run route test
purpose: exercise the dispatch route
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: ${surface}
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body for ${slug}.
`;
}

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-run-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-runnable'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-interactive'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended'));
  writeFileSync(join(forgeRoot, 'skills', 'test-interactive', 'SKILL.md'), studioAgent('test-interactive', 'interactive'));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/agents/<slug>/run: malformed slug → 400', async () => {
  const res = await fetch(`${url}/api/agents/Bad_Slug/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /invalid agent slug/);
});

test('POST /api/agents/<slug>/run: unknown slug → 400 (no runnable agent)', async () => {
  const res = await fetch(`${url}/api/agents/not-a-real-agent/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /no runnable agent "not-a-real-agent"/);
});

test('POST /api/agents/<slug>/run: an interactive agent is refused → 400', async () => {
  const res = await fetch(`${url}/api/agents/test-interactive/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /is interactive/);
});

test('POST /api/agents/<slug>/run: unknown project → 404', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'nope' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/agents/<slug>/run: non-string input value → 400', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ inputs: { northStar: 42 } }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /must be a string/);
});

test('POST /api/agents/<slug>/run: invalid input KEY → 400 (never silently dropped)', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ inputs: { 'north star': 'x' } }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /invalid input key/);
});

test('POST /api/agents/<slug>/run: dispatchable agent → 200, ok:true, runId returned', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ project: 'gitpulse', inputs: { northStar: 'ship it' } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; runId: string; slug: string };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'test-runnable');
  assert.match(body.runId, /^_agent-test-runnable-/);
});

// ---- GET /api/agents/runs/<runId> (the RunPanel status poll) ----------------

test('GET /api/agents/runs/<runId>: invalid runId → 400', async () => {
  const res = await fetch(`${url}/api/agents/runs/${encodeURIComponent('../escape')}`);
  assert.equal(res.status, 400);
});

test('GET /api/agents/runs/<runId>: no events yet → running', async () => {
  const res = await fetch(`${url}/api/agents/runs/_agent-never-dispatched`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; events: number };
  assert.equal(body.state, 'running');
  assert.equal(body.events, 0);
});

test('GET /api/agents/runs/<runId>: start+end events → done with cost', async () => {
  const runId = '_agent-status-done';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'end', skill: 'test-runnable', cost_usd: 0.42 }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; costUsd: number; events: number };
  assert.equal(body.state, 'done');
  assert.equal(body.costUsd, 0.42);
  assert.equal(body.events, 2);
});

test('GET /api/agents/runs/<runId>: dispatch-failure marker → failed (not perpetual running)', async () => {
  const runId = '_agent-status-failed';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'log', message: 'agent-dispatch.failed', metadata: { error: 'boom' } }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { state: string }).state, 'failed');
});

test('GET /api/agents/runs/<runId>: spawn-suppressed marker → suppressed', async () => {
  const runId = '_agent-status-suppressed';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'log', message: 'run-agent.spawn-suppressed' }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal((await res.json() as { state: string }).state, 'suppressed');
});

// ---- GET /api/agents/runs/<runId>: `lines` (R6-04 WI-4) --------------------
//
// Today's route (cli/ui-bridge.ts ~line 1116) computes `events` as
// `parsed.length` — a COUNT — and never surfaces the parsed records
// themselves. WI-4 adds a `lines` array (the run's own parsed event records,
// capped) so the new standalone run view can render a live log without a
// second endpoint or re-reading the JSONL file client-side. Every test below
// either (a) pins that the THREE EXISTING fields (state/costUsd/events) keep
// their EXACT current meaning now that `lines` exists alongside them — a
// regression pin, since RunPanel.tsx polls this route today and
// cli/ui-bridge-agent-run-ceiling.test.ts already depends on `state` — or
// (b) pins a genuinely NEW behaviour `lines` itself must have.

test('GET /api/agents/runs/<runId>: REGRESSION — state/costUsd/events keep their CURRENT meaning once `lines` is added — kills "repurposed events:count into events:lines, breaking every existing caller of this route"', async () => {
  const runId = '_agent-lines-regression';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'end', skill: 'test-runnable', cost_usd: 0.17 }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; costUsd: number; events: number; lines?: unknown };
  assert.equal(body.state, 'done');
  assert.equal(body.costUsd, 0.17);
  assert.equal(body.events, 2, '`events` must stay the COUNT — it must not be repurposed into carrying the lines array itself');
  assert.ok(Array.isArray(body.lines), '`lines` must be present and be an array');
});

test('GET /api/agents/runs/<runId>: no events yet → lines is an empty array, not absent/null — kills "lines is only present once a run has events"', async () => {
  const res = await fetch(`${url}/api/agents/runs/_agent-lines-never-dispatched`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lines?: unknown };
  assert.deepEqual(body.lines, []);
});

test('GET /api/agents/runs/<runId>: each line carries its own event_type + message, in original order — kills "lines populated but stripped down to something the renderer cannot map, or reordered"', async () => {
  const runId = '_agent-lines-types';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'tool_use', skill: 'test-runnable', message: 'Bash · npm test' }) + '\n' +
    JSON.stringify({ event_type: 'end', skill: 'test-runnable', cost_usd: 0.05 }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  const body = (await res.json()) as { lines: Array<{ event_type?: string; message?: string }> };
  assert.equal(body.lines.length, 3);
  assert.deepEqual(body.lines.map((l) => l.event_type), ['start', 'tool_use', 'end']);
  assert.equal(body.lines[1]!.message, 'Bash · npm test');
});

test('GET /api/agents/runs/<runId>: a materials-staged log line survives into `lines` with its metadata.materials REFERENCES intact — kills "metadata dropped in transit, so the run view has no way to show which materials were attached"', async () => {
  const runId = '_agent-lines-materials';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({
      event_type: 'log', skill: 'test-runnable', message: 'agent-run.materials-staged',
      metadata: { materials: [{ path: 'materials/notes.md', kind: 'documents' }] },
    }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  const body = (await res.json()) as {
    lines: Array<{ message?: string; metadata?: { materials?: Array<{ path: string; kind: string }> } }>;
  };
  const materialsLine = body.lines.find((l) => l.message === 'agent-run.materials-staged');
  assert.ok(materialsLine, 'the materials-staged line must survive into `lines`');
  assert.deepEqual(materialsLine!.metadata?.materials, [{ path: 'materials/notes.md', kind: 'documents' }]);
});

test('GET /api/agents/runs/<runId>: a ceiling-carrying end event survives into `lines` with metadata.kickoff_ceiling_usd intact — kills "ceiling provenance stripped in transit, so the run view cannot show what ceiling was actually in force"', async () => {
  const runId = '_agent-lines-ceiling';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({
      event_type: 'end', skill: 'test-runnable', cost_usd: 0.5,
      metadata: { kickoff_ceiling_usd: 3.5, result_subtype: 'success' },
    }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  const body = (await res.json()) as { lines: Array<{ event_type?: string; metadata?: { kickoff_ceiling_usd?: number } }> };
  const endLine = body.lines.find((l) => l.event_type === 'end');
  assert.equal(endLine?.metadata?.kickoff_ceiling_usd, 3.5);
});

test('GET /api/agents/runs/<runId>: lines is CAPPED at a fixed size regardless of log size — a runaway log is never served whole — kills "returns every line uncapped" AND "cap value silently scales with input size (e.g. half of N)"', async () => {
  const smallerCount = 3000;
  const biggerCount = 6000;
  const dirA = join(forgeRoot, '_logs', '_agent-lines-cap-a');
  const dirB = join(forgeRoot, '_logs', '_agent-lines-cap-b');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  const bodyA = Array.from({ length: smallerCount }, (_, i) => JSON.stringify({ event_type: 'log', skill: 'test-runnable', message: `line-${i}` })).join('\n') + '\n';
  const bodyB = Array.from({ length: biggerCount }, (_, i) => JSON.stringify({ event_type: 'log', skill: 'test-runnable', message: `line-${i}` })).join('\n') + '\n';
  writeFileSync(join(dirA, 'events.jsonl'), bodyA);
  writeFileSync(join(dirB, 'events.jsonl'), bodyB);
  const [resA, resB] = await Promise.all([
    fetch(`${url}/api/agents/runs/_agent-lines-cap-a`),
    fetch(`${url}/api/agents/runs/_agent-lines-cap-b`),
  ]);
  const [parsedA, parsedB] = (await Promise.all([resA.json(), resB.json()])) as Array<{ lines: unknown[]; events: number }>;
  assert.equal(parsedA.events, smallerCount, '`events` (the count) must stay UNCAPPED — only `lines` is capped');
  assert.equal(parsedB.events, biggerCount);
  assert.ok(parsedA.lines.length < smallerCount, 'lines must be capped below the true event count');
  assert.equal(
    parsedA.lines.length,
    parsedB.lines.length,
    'the SAME fixed cap must apply regardless of log size — a proportional/percentage-based cap would make these two differ',
  );
});

test('GET /api/agents/runs/<runId>: capped lines preserve the TAIL (most recently written), not just the head — kills "keeps only the first N lines, so a long-running run\'s log view looks frozen at dispatch"', async () => {
  const runId = '_agent-lines-tail';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  const total = 3000;
  const body = Array.from({ length: total }, (_, i) =>
    JSON.stringify({ event_type: 'log', skill: 'test-runnable', message: i === total - 1 ? 'LAST-LINE-MARKER' : `line-${i}` }),
  ).join('\n') + '\n';
  writeFileSync(join(dir, 'events.jsonl'), body);
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  const parsed = (await res.json()) as { lines: Array<{ message?: string }> };
  assert.ok(parsed.lines.length < total, 'sanity: this log must actually be capped for the tail assertion below to mean anything');
  assert.ok(parsed.lines.some((l) => l.message === 'LAST-LINE-MARKER'), 'the most recently written line must be present in the capped response');
});
