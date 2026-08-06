/**
 * Acceptance tests for WI-2 (R6-04): the per-kickoff cost ceiling on
 * `POST /api/agents/<slug>/run`, and its downstream surfacing.
 *
 * ============================================================================
 * HONESTY BOUND (read before trusting a green run of this file)
 * ============================================================================
 * Forge does NOT enforce the ceiling in-process — the Claude Agent SDK stops
 * an over-budget run, exactly as it already does for an agent's own declared
 * budget. This file only pins what IS real and observable from this route:
 *   (B) fail-closed request validation — an invalid ceiling never mints a
 *       runId and never reaches the dispatch call (a 400, not a "the SDK
 *       would have stopped it anyway" claim);
 *   (C) that a ceiling-stop is surfaced through GET /api/agents/runs/:runId
 *       as a state DISTINCT from an ordinary successful `done`, with the
 *       real (non-zero) runaway cost — the SDK's stop is *simulated* here via
 *       an injected `queryFn` on a direct `runAgent()` call that writes into
 *       the SAME `_logs/` directory this bridge instance reads from; no HTTP
 *       route in forge actually halts a spend mid-flight;
 *   (D) that the kickoff UI's pre-filled default ceiling is read from
 *       `forge.config.json`'s `runs.defaultCostCeilingUsd` (not hardcoded),
 *       falling back to a NAMED EXPORTED constant when absent.
 * No assertion here is or should be read as "forge halts spend" — only "the
 * ceiling value and its stop are recorded and surfaced honestly".
 * ============================================================================
 *
 * Route contract pinned:
 *   - POST /api/agents/<slug>/run accepts an optional body field
 *     `costCeilingUsd?: number`.
 *   - Non-number / string / <=0 / above `MAX_KICKOFF_COST_CEILING_USD` → 400,
 *     and — because validation must run BEFORE this route mints a runId or
 *     calls the dispatch spawn (mirrors the existing `inputs` validation
 *     tier, which already runs before runId generation in ui-bridge.ts) — the
 *     response body carries neither `ok` nor `runId`. That absence is the
 *     call-record proxy this suite uses: nothing was dispatched, not merely
 *     "the status code was 4xx".
 *   - Exactly-at-`MAX_KICKOFF_COST_CEILING_USD` is accepted; one unit over is
 *     refused (boundary, not just "some large value fails").
 *
 * PLACEMENT JUDGMENT CALLS (flagged in the test-writer's report — the WI text
 * did not name these locations explicitly):
 *   - `MAX_KICKOFF_COST_CEILING_USD` is imported from `../orchestrator/run-agent.ts`
 *     (same reasoning as the sibling orchestrator/run-agent-ceiling.test.ts).
 *   - Part D (the config-served default) is pinned against the EXISTING
 *     `GET /api/studio/agents` route (cli/bridge-studio.ts), the only bridge
 *     route that already both serves agent data to the run-kickoff UI
 *     (`fetchStudioAgents()`, forge-ui/lib/studio-client.ts) AND already
 *     imports `loadConfig`/`defaultConfigPath` for sibling routes in that
 *     same file. A served top-level `defaultCostCeilingUsd` field is the
 *     minimal-diff fit. If the implementer instead serves this from a
 *     different route, these two Part-D tests need a one-line URL fix.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { runAgent, MAX_KICKOFF_COST_CEILING_USD } from '../orchestrator/run-agent.ts';
import { DEFAULT_KICKOFF_COST_CEILING_USD } from '../orchestrator/config.ts';
import { listAgentDefinitions } from '../orchestrator/studio/registry.ts';
import type { StreamQueryFn } from '../orchestrator/pinned-sdk-query.ts';
import type { AgentDefinition } from '../orchestrator/studio/types.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function studioAgent(slug: string, surface: string): string {
  return `---
name: ${slug}
description: fixture agent for the kickoff cost-ceiling test
purpose: exercise the /run route's ceiling validation
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

function scaffoldForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-ceiling-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-runnable'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended'));
  return forgeRoot;
}

// ---------------------------------------------------------------------------
// Shared bridge for (B) validation + the (C) success-control case.
// ---------------------------------------------------------------------------

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = scaffoldForgeRoot();
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (B) Validation, fail-closed. Every case asserts BOTH the status AND the
// absence of ok/runId in the body — the call-record proxy described in the
// file header (no runId minted ⇒ the dispatch call site at ui-bridge.ts,
// which runs strictly after runId generation, is provably unreached).
// ---------------------------------------------------------------------------

async function postRun(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test('POST /api/agents/<slug>/run: no costCeilingUsd ⇒ 200, ok:true, runId present (baseline — today\'s unchanged behaviour)', async () => {
  const { status, body } = await postRun({ project: 'gitpulse' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.runId as string, /^_agent-test-runnable-/);
});

test('POST /api/agents/<slug>/run: a valid numeric costCeilingUsd ⇒ 200, ok:true, runId present', async () => {
  const { status, body } = await postRun({ project: 'gitpulse', costCeilingUsd: 2.5 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(typeof body.runId === 'string');
});

test('POST /api/agents/<slug>/run: costCeilingUsd exactly at MAX_KICKOFF_COST_CEILING_USD ⇒ accepted (boundary, inclusive)', async () => {
  const { status, body } = await postRun({ costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD });
  assert.equal(status, 200, `expected the max itself to be accepted (got ${JSON.stringify(body)})`);
  assert.equal(body.ok, true);
});

test('POST /api/agents/<slug>/run: costCeilingUsd one unit over MAX_KICKOFF_COST_CEILING_USD ⇒ 400, no runId minted (boundary, exclusive)', async () => {
  const { status, body } = await postRun({ costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD + 1 });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined, 'a rejected ceiling must never mint a runId — nothing was dispatched');
  assert.equal(body.ok, undefined);
});

test('POST /api/agents/<slug>/run: costCeilingUsd = 0 ⇒ 400, no runId minted', async () => {
  const { status, body } = await postRun({ costCeilingUsd: 0 });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined);
});

test('POST /api/agents/<slug>/run: costCeilingUsd negative ⇒ 400, no runId minted', async () => {
  const { status, body } = await postRun({ costCeilingUsd: -3 });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined);
});

test('POST /api/agents/<slug>/run: costCeilingUsd as a string ⇒ 400, no runId minted', async () => {
  const { status, body } = await postRun({ costCeilingUsd: '5' });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined);
});

test('POST /api/agents/<slug>/run: costCeilingUsd as a boolean ⇒ 400, no runId minted (non-number, general case)', async () => {
  const { status, body } = await postRun({ costCeilingUsd: true });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined);
});

// Standard JSON has no numeric literal for IEEE NaN/Infinity — JSON.stringify
// coerces both to `null`, and a raw body containing the bare tokens `NaN` /
// `Infinity` is not valid JSON at all (the request would fail to parse for a
// reason unrelated to ceiling validation, which would be characterization,
// not a pin — see the file-level placement-judgment note). The only
// wire-representable form of "the operator typed NaN/Infinity" is therefore
// the STRING form, which collapses into the general non-number/string case
// already covered above. Pinned explicitly here so the intent is on record.
test('POST /api/agents/<slug>/run: costCeilingUsd as the STRING "Infinity" ⇒ 400 (the only wire-representable form of a non-finite ceiling — JSON has no Infinity/NaN number literal)', async () => {
  const { status, body } = await postRun({ costCeilingUsd: 'Infinity' });
  assert.equal(status, 400);
  assert.equal(body.runId, undefined);
});

test('POST /api/agents/<slug>/run: an agent declaring its own budget AND an operator ceiling in the same request ⇒ still 200 (the route itself does not reject a coexisting declared budget — precedence is runAgent\'s job, pinned in orchestrator/run-agent-ceiling.test.ts)', async () => {
  const { status } = await postRun({ project: 'gitpulse', costCeilingUsd: 1.5, inputs: { northStar: 'ship it' } });
  assert.equal(status, 200);
});

// ---------------------------------------------------------------------------
// (C) A ceiling-stopped run surfaces as a DISTINCT terminal state via
// GET /api/agents/runs/:runId — never the same state a clean success reports.
// Both the success case and the ceiling-stop case are driven through a REAL
// `runAgent()` call (not a hand-typed events.jsonl fixture) with an injected
// queryFn, writing into this bridge's own `_logs/` — so the GET route is
// exercised against genuinely-produced output, not a guessed shape.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the real roster`);
  return def;
}

function oneShotClone(def: AgentDefinition): AgentDefinition {
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' }, budgets: {} };
}

function successQueryFn(costUsd: number): StreamQueryFn {
  return (() => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: costUsd, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function ceilingStopQueryFn(costUsd: number): StreamQueryFn {
  return (() => {
    async function* gen() {
      yield {
        type: 'result',
        subtype: 'error_max_budget_usd',
        total_cost_usd: costUsd,
        usage: { input_tokens: 50, output_tokens: 50 },
      };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

test('GET /api/agents/runs/<runId>: an ordinary successful run reports state "done" (control, established BEFORE the ceiling-stop case below so the two cannot silently collapse into the same value)', async () => {
  const defs = listAgentDefinitions(join(ROOT, 'skills'));
  const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
  const runId = '_agent-ceiling-bridge-success';
  const workdir = mkdtempSync(join(forgeRoot, 'wd-success-'));

  await runAgent(def, {
    runId,
    workdir,
    prompt: 'p',
    logsRoot: join(forgeRoot, '_logs'),
    queryFn: successQueryFn(0.02),
  });

  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; costUsd: number };
  assert.equal(body.state, 'done');
  assert.equal(body.costUsd, 0.02);
});

test('GET /api/agents/runs/<runId>: a ceiling-stopped run reports a state DISTINCT from "done", with the real runaway cost (not zero) — kills "a budget-stopped run is reported as a clean success"', async () => {
  const defs = listAgentDefinitions(join(ROOT, 'skills'));
  const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
  const runId = '_agent-ceiling-bridge-stopped';
  const workdir = mkdtempSync(join(forgeRoot, 'wd-stopped-'));
  const RUNAWAY_COST = 0.5713;

  await runAgent(def, {
    runId,
    workdir,
    prompt: 'p',
    logsRoot: join(forgeRoot, '_logs'),
    kickoffCeilingUsd: 0.3,
    queryFn: ceilingStopQueryFn(RUNAWAY_COST),
  });

  const res = await fetch(`${url}/api/agents/runs/${runId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: string; costUsd: number };
  assert.notEqual(body.state, 'done', 'a ceiling-stop must be surfaced as a DEDICATED terminal token, not collapsed into ordinary success');
  assert.ok(body.state.length > 0, 'expected some non-empty terminal state token');
  assert.notEqual(body.state, 'running', 'the run has terminated (an end event exists) — it must not still read as in-flight');
  assert.equal(body.costUsd, RUNAWAY_COST, 'the reported cost must be the real runaway cost, not zero');
});

// ---------------------------------------------------------------------------
// (D) Config default — GET /api/studio/agents serves `defaultCostCeilingUsd`,
// read from forge.config.json's `runs.defaultCostCeilingUsd`, falling back to
// the named exported `DEFAULT_KICKOFF_COST_CEILING_USD` constant when absent.
// Each test spins its own forgeRoot/bridge for config-file isolation.
// ---------------------------------------------------------------------------

test('GET /api/studio/agents: runs.defaultCostCeilingUsd from forge.config.json is read (not hardcoded) and served to clients', async () => {
  const root = scaffoldForgeRoot();
  const CONFIGURED_VALUE = 12.5; // deliberately far from any plausible hardcoded default
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ runs: { defaultCostCeilingUsd: CONFIGURED_VALUE } }));
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const res = await fetch(`${bridge.url}/api/studio/agents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { defaultCostCeilingUsd: number };
    assert.equal(
      body.defaultCostCeilingUsd,
      CONFIGURED_VALUE,
      'the served default must come from forge.config.json, not a hardcoded literal',
    );
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/studio/agents: no runs config ⇒ falls back to the named exported DEFAULT_KICKOFF_COST_CEILING_USD constant (imported here — never hardcoded)', async () => {
  const root = scaffoldForgeRoot(); // no forge.config.json written at all
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const res = await fetch(`${bridge.url}/api/studio/agents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { defaultCostCeilingUsd: number };
    assert.equal(body.defaultCostCeilingUsd, DEFAULT_KICKOFF_COST_CEILING_USD);
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});
