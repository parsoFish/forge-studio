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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

// mirrors cli/bridge-studio-affordances.test.ts's own REPO_ROOT derivation.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
  // W6-CR-3 (bead forge-eip): the REAL, checked-in community-refresh
  // SKILL.md — copied verbatim, not a synthetic fixture, so this suite
  // proves the boundary against the actual shipped agent (the FIRST
  // `library: true` interactive agent in the roster — see
  // orchestrator/agent-dispatch.test.ts's COMPLEMENT PIN for why that
  // matters: it is now genuinely reachable through listAgentDefinitions,
  // unlike creation-agent/brain-maintenance, which the pre-existing
  // synthetic "test-interactive" fixture above already covers generically).
  mkdirSync(join(forgeRoot, 'skills', 'community-refresh'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', 'community-refresh', 'SKILL.md'),
    readFileSync(join(REPO_ROOT, 'skills', 'community-refresh', 'SKILL.md'), 'utf8'),
  );

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

// W6-CR-3 (bead forge-eip, LOW item 3): community-refresh is a real,
// turnSpec-driven interactive session-kind agent — it runs EXCLUSIVELY
// through runInteractiveTurn (its own session-kickoff route + the generic
// affordance write route), never through this one-shot generic run host.
// Proves the REAL shipped agent — not just the synthetic "test-interactive"
// fixture above — is refused here, closing the same class as that test for
// the one agent in the roster this initiative made newly reachable.
test('POST /api/agents/community-refresh/run: the REAL community-refresh agent is refused → 4xx (interactive session-kind agents run only through their own kickoff route)', async () => {
  const res = await fetch(`${url}/api/agents/community-refresh/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx refusal, got ${res.status}`);
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

// AMENDED (R6-04 WI-4 follow-up round, re-pinned by the test-writer): this
// test previously asserted 200/running for a runId with NO run directory at
// all — the exact "never dispatched" case the follow-up round's fix
// disambiguates. It now asserts the NEW, correct behaviour (404); the
// "directory exists, no events yet" case this test's ORIGINAL name/intent
// was actually reaching for is covered separately, with a real directory
// fixture, by "POSITIVE CONTROL — run directory exists but events.jsonl has
// not landed yet" further down this file.
test('GET /api/agents/runs/<runId>: a runId with no run directory at all (never dispatched) → 404, not a fabricated "running" — kills "always 200, reports a run that never existed as state:running"', async () => {
  const res = await fetch(`${url}/api/agents/runs/_agent-never-dispatched`);
  assert.equal(res.status, 404);
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

// AMENDED (R6-04 WI-4 follow-up round, re-pinned by the test-writer): this
// test previously fetched a runId with NO run directory at all — under the
// follow-up round's fix that now 404s (see the "no run directory at all"
// test above), which would make this fixture assert the wrong status for
// what it actually means to pin. The fixture now creates a real run
// directory (dispatched, no events landed yet) so this test keeps pinning
// the fact it always intended to: `lines` is `[]`, not absent/null, on a
// real in-flight run.
test('GET /api/agents/runs/<runId>: a dispatched run with no events yet -> lines is an empty array, not absent/null — kills "lines is only present once a run has events"', async () => {
  const runId = '_agent-lines-dispatched-no-events';
  mkdirSync(join(forgeRoot, '_logs', runId), { recursive: true });
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
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

// ---- GET /api/agents/runs/<runId>: 404 for a genuinely unknown run --------
//
// Found post-WI-4: the route ALWAYS answers 200. A syntactically-valid runId
// that was never dispatched — no `_logs/<runId>` directory at all — takes
// the `!existsSync(eventsPath)` early return and reports `state: 'running'`,
// identically to a real, freshly-dispatched run. That makes
// `RunView.tsx`'s `found` prop (pinned thoroughly at the component level in
// `../forge-ui/lib/run-view-render.test.ts`, including that `found:false`
// suppresses content) UNREACHABLE in production — the exact
// "typed, surfaced, pinned, and unreachable" shape this initiative has
// closed everywhere else. The fix distinguishes "no run directory at all"
// (404, genuinely unknown) from "run directory exists, events.jsonl has not
// landed yet" (200, `state: 'running'`, `lines: []` — a real just-dispatched
// run, which must keep working). The 404 decision must key off the RUN
// DIRECTORY, not `events.jsonl` — checking the events file would 404 the
// exact freshly-dispatched run this route exists to report on.

test('GET /api/agents/runs/<runId>: no run directory at all → 404, body carries no fabricated run state — kills "always 200, reports a run that never existed as state:running"', async () => {
  const res = await fetch(`${url}/api/agents/runs/_agent-404-truly-unknown`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body['state'], undefined, 'a 404 body must not carry a fabricated run state (e.g. "running") for a run that never existed');
  assert.equal(typeof body['error'], 'string');
});

test('GET /api/agents/runs/<runId>: POSITIVE CONTROL — run directory exists but events.jsonl has not landed yet → 200, state "running", lines [] — without this, a lazy "no events file -> 404" fix would pass the test above and silently 404 every just-dispatched run', async () => {
  const runId = '_agent-404-dir-only-no-events';
  mkdirSync(join(forgeRoot, '_logs', runId), { recursive: true });
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; lines: unknown[] };
  assert.equal(body.state, 'running');
  assert.deepEqual(body.lines, []);
});

test('GET /api/agents/runs/<runId>: REGRESSION — a run WITH real events still returns 200 unchanged now that the directory-existence 404 exists (the three branches — no dir, dir-only, dir+events — must not collapse into each other)', async () => {
  const runId = '_agent-404-regression-with-events';
  const dir = join(forgeRoot, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'),
    JSON.stringify({ event_type: 'start', skill: 'test-runnable' }) + '\n' +
    JSON.stringify({ event_type: 'end', skill: 'test-runnable', cost_usd: 0.42 }) + '\n');
  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; costUsd: number; events: number; lines: unknown[] };
  assert.equal(body.state, 'done');
  assert.equal(body.costUsd, 0.42);
  assert.equal(body.events, 2);
  assert.equal(body.lines.length, 2);
});

test('GET /api/agents/runs/<runId>: an INVALID runId (path-traversal shape) still 400s before any 404/directory check runs — isSafeRunId stays ahead of the new existence check', async () => {
  const res = await fetch(`${url}/api/agents/runs/${encodeURIComponent('../still-escaping')}`);
  assert.equal(res.status, 400);
});
