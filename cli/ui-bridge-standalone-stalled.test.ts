/**
 * W8-A2 (ON-7 defect 4, WI-1a item 4) — `deriveStandaloneRunState` /
 * `deriveStandaloneStateFromEvents` produced `running | done | failed |
 * suppressed | budget-exceeded | cancelled` with NO time-based staleness
 * anywhere: a standalone dispatch whose process was SIGKILLed (or wedged)
 * with no terminal marker read byte-identical to one that started two
 * seconds ago — 'running' forever. Real leaked zombie run dirs exist on
 * disk today (`_agent-onboarding-agent-*`, `_agent-w7-throwaway-agent-*`).
 *
 * PINNED BEFORE THE FIX (RED at branch base — see the W8-A2 report for the
 * quoted failing output and the revert-and-rerun proof).
 *
 * RUN: node --experimental-strip-types --test cli/ui-bridge-standalone-stalled.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { DEFAULT_STALL_CEILING_MS } from '@forge/sessions/bridge-studio-lifecycle.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let logsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const NOW = Date.now();
const MIN = 60_000;

// Well past DEFAULT_STALL_CEILING_MS (180s) — the same shape a SIGKILLed
// standalone dispatch leaves: events.jsonl exists, has a 'start' but no
// terminal marker, and nothing has touched it in ages.
const STALE_RUN_ID = '_agent-w7-throwaway-agent-2026-08-01T00-00-00';
const FRESH_RUN_ID = '_agent-fresh-agent-2026-08-23T00-00-00';
const DONE_RUN_ID = '_agent-completed-agent-2026-08-23T00-00-01';

function writeRunDir(runId: string, files: Record<string, string>, mtimeMs?: number): void {
  const dir = join(logsRoot, runId);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
    if (mtimeMs !== undefined) utimesSync(join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
  }
}

async function expectJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-standalone-stalled-'));
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  for (const state of ['in-flight', 'done', 'failed', 'pending']) mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'));

  // A run with NO terminal marker, silent well past the stall ceiling, no
  // live turn.pid at all (a dead/absent pid).
  const staleAt = NOW - 10 * MIN;
  writeRunDir(STALE_RUN_ID, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n' }, staleAt);

  // A genuinely fresh run — same shape, but just started (the negative
  // control: must NOT read stalled just because it lacks a terminal marker).
  writeRunDir(FRESH_RUN_ID, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n' }, NOW);

  // A run with a real `end` event (terminal) written a long time ago — must
  // stay 'done', never overridden to 'stalled' by silence (the override
  // only ever narrows 'running').
  writeRunDir(DONE_RUN_ID, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n{"event_type":"end","cost_usd":1.23}\n' }, staleAt);

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  await closeBridge();
  rmSync(forgeRoot, { recursive: true, force: true });
});

test('WI-1a-4: a standalone run with no terminal marker and a STALE events.jsonl (well past the stall ceiling, no live pid) derives "stalled", not "running"', async () => {
  const body = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(STALE_RUN_ID)}`));
  assert.equal(body.state, 'stalled', `a zombie run with no terminal marker must not read 'running' forever; got ${JSON.stringify(body)}`);
});

test('WI-1a-4 (negative control): a genuinely FRESH standalone run still derives "running" — the fix must not slander every live agent', async () => {
  const body = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(FRESH_RUN_ID)}`));
  assert.equal(body.state, 'running', `a run that just started must not be misread as stalled; got ${JSON.stringify(body)}`);
});

test('WI-1a-4: a run with a real terminal marker (`end` event) stays "done" even though it is old — the staleness override only ever narrows "running"', async () => {
  const body = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(DONE_RUN_ID)}`));
  assert.equal(body.state, 'done');
});

test('WI-1a-4: the stall ceiling used is bridge-studio-lifecycle.ts\'s DEFAULT_STALL_CEILING_MS — one ceiling across the product, never a second invented one', async () => {
  // A run silent for exactly the ceiling amount reads running; one ms past
  // it reads stalled. Proves the SAME constant is in force, not a
  // coincidentally-similar independent number.
  const atCeiling = `_agent-at-ceiling-agent-2026-08-23T00-00-02`;
  const pastCeiling = `_agent-past-ceiling-agent-2026-08-23T00-00-03`;
  writeRunDir(atCeiling, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n' }, NOW - DEFAULT_STALL_CEILING_MS + 500);
  writeRunDir(pastCeiling, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n' }, NOW - DEFAULT_STALL_CEILING_MS - 500);
  const atBody = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(atCeiling)}`));
  const pastBody = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(pastCeiling)}`));
  assert.equal(atBody.state, 'running', 'inside the ceiling must still read running');
  assert.equal(pastBody.state, 'stalled', 'past the ceiling must read stalled');
});

test('WI-1a-4: a STALLED run is still cancellable (not treated as terminal) — an operator most wants to cancel exactly this shape', async () => {
  const cancelRunId = '_agent-cancel-me-agent-2026-08-23T00-00-04';
  writeRunDir(cancelRunId, { 'events.jsonl': '{"event_type":"start","message":"agent-run.dispatched"}\n' }, NOW - 10 * MIN);
  const pre = await expectJson<{ state: string }>(await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(cancelRunId)}`));
  assert.equal(pre.state, 'stalled');
  const res = await fetch(`${bridgeUrl}/api/agents/runs/${encodeURIComponent(cancelRunId)}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `a stalled run must remain cancellable, got ${res.status}: ${text}`);
});
