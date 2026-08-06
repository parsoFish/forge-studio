/**
 * Acceptance tests for WI-2 (R6-04): the per-kickoff cost ceiling on
 * `POST /api/agents/<slug>/run`, its CLI-argv dispatch seam, and its
 * downstream surfacing.
 *
 * RUN COMMAND — this file needs ONE extra flag beyond the standard
 * `node --test --experimental-strip-types <file>`:
 *
 *   node --test --experimental-strip-types --experimental-test-module-mocks \
 *     cli/ui-bridge-agent-run-ceiling.test.ts
 *
 * `--experimental-test-module-mocks` is required for the CLI round-trip
 * section below (`node:test`'s `mock.module`) — see that section's header
 * for why a real subprocess spawn is not an option here. The orchestrator
 * sibling file (`orchestrator/run-agent-ceiling.test.ts`) does not need it.
 *
 * ============================================================================
 * HONESTY BOUND (read before trusting a green run of this file)
 * ============================================================================
 * Forge does NOT enforce the ceiling in-process — the Claude Agent SDK stops
 * an over-budget run, exactly as it already does for an agent's own declared
 * budget. This file only pins what IS real and observable from this route:
 *   (B) fail-closed request validation — proven with a MECHANISM-GROUNDED
 *       no-spawn record (see below), not a response-shape proxy alone;
 *   (C) that a ceiling-stop is surfaced through GET /api/agents/runs/:runId
 *       as a state DISTINCT from an ordinary successful `done`, with the
 *       real (non-zero) runaway cost — the SDK's stop is *simulated* here via
 *       an injected `queryFn` on a direct `runAgent()` call that writes into
 *       the SAME `_logs/` directory this bridge instance reads from; no HTTP
 *       route in forge actually halts a spend mid-flight;
 *   (D) that the kickoff UI's pre-filled default ceiling is read from
 *       `forge.config.json`'s `runs.defaultCostCeilingUsd` (not hardcoded),
 *       falling back to a NAMED EXPORTED constant when absent, served as
 *       run-level policy (never nested per-agent);
 *   (E) the CLI-argv dispatch seam: `spawnAgentDispatch` never actually runs
 *       in this test process (harness-suppressed), so the argv it would build
 *       and the parse on the other end are pinned SEPARATELY and then
 *       ROUND-TRIPPED, closing the exact gap a detached-subprocess boundary
 *       would otherwise hide from every other test in this WI.
 * No assertion here is or should be read as "forge halts spend" — only "the
 * ceiling value and its stop are recorded and surfaced honestly".
 * ============================================================================
 *
 * (B) MECHANISM-GROUNDED NO-SPAWN PROOF — chosen deliberately over a bare
 * response-shape proxy (round 1's approach), because a proxy on `runId`
 * absence alone cannot distinguish "the route refused before dispatching"
 * from "the route dispatched but the harness silently ate it" — exactly what
 * immutable-gates forbids ("assert the suppression/no-spawn record rather
 * than trusting absence"). This suite runs under `FORGE_DRY_BRIDGE=1` (not
 * `FORGE_ARCHITECT_NO_SPAWN`), because NO_SPAWN-only suppression is silent
 * (`dryBridgeAgentTurnMarker` returns `{}` and emits nothing —
 * cli/dry-bridge.ts), whereas under DRY_BRIDGE a genuine dispatch attempt is
 * a REAL, checkable artifact: the response carries
 * `dryBridge:{skipped:['agent-turn']}` and a `dry-bridge.skip` event lands in
 * `_logs/_dry-bridge/events.jsonl` (mirrors the sibling
 * cli/ui-bridge-agent-run-materials.test.ts's identical technique — reused
 * here, not imported, since the two files are independently owned). Every
 * refusal test below snapshots the skip-count BEFORE and asserts it did NOT
 * grow; the first (accepted) test establishes the POSITIVE control the
 * negatives stand on.
 *
 * Route contract pinned:
 *   - POST /api/agents/<slug>/run accepts an optional body field
 *     `costCeilingUsd?: number`.
 *   - Non-number / string / <=0 / above `MAX_KICKOFF_COST_CEILING_USD` → 400,
 *     never reaching the dispatch spawn point.
 *   - Exactly-at-`MAX_KICKOFF_COST_CEILING_USD` is accepted; one unit over is
 *     refused (boundary, not just "some large value fails").
 *
 * PLACEMENT — ratified round 2 (a peer orchestrator reviewed round 1's
 * judgment calls):
 *   - `MAX_KICKOFF_COST_CEILING_USD` AND `DEFAULT_KICKOFF_COST_CEILING_USD`
 *     both live in `../orchestrator/config.ts` (round 1 guessed
 *     `run-agent.ts` for the max) — both are run-level policy bounds, not
 *     runAgent's own concern.
 *   - Part D is pinned against the EXISTING `GET /api/studio/agents` route
 *     (cli/bridge-studio.ts) — the only bridge route that already both serves
 *     agent data to the run-kickoff UI (`fetchStudioAgents()`,
 *     forge-ui/lib/studio-client.ts) AND already imports
 *     `loadConfig`/`defaultConfigPath` for sibling routes in that same file.
 *     RATIFIED CONSTRAINT: `defaultCostCeilingUsd` must be served as a
 *     TOP-LEVEL SIBLING of `agents` (`{ agents: [...], defaultCostCeilingUsd }`),
 *     never nested onto a per-agent object — it is run-level policy, not an
 *     agent property. A dedicated negative test below pins this directly.
 *   - `buildAgentDispatchArgs` — a NEW pure exported helper the implementer
 *     extracts from `spawnAgentDispatch`'s existing `const args = [...]`
 *     construction (argv-building moves above the dry-bridge/no-spawn
 *     suppression check; no behaviour change to the existing flags). Assumed
 *     exported from `./ui-bridge.ts` (same file `spawnAgentDispatch` already
 *     lives in) with signature
 *     `(slug, runId, project?, inputs?, sessionDir?, costCeilingUsd?) => string[]`,
 *     returning EXACTLY the array `cmdAgentDispatch`'s `rest` parameter
 *     expects (`[slug, '--run-id', runId, ...optional flags]`) — NOT the
 *     full node-invocation array (`--experimental-strip-types`,
 *     `orchestrator/cli.ts`, `agent`, `dispatch` are process-invocation
 *     boilerplate `spawnAgentDispatch` still owns, prepended around this
 *     helper's output). This is what lets the ROUND-TRIP test below feed the
 *     helper's output STRAIGHT into `cmdAgentDispatch` with zero
 *     transformation — if the implementer instead returns the full array,
 *     every test in the buildAgentDispatchArgs + ROUND-TRIP section needs a
 *     one-line `.slice(4)` adjustment, noted here so that's a quick fix, not
 *     a rediscovery.
 *   - New CLI flag name: `--cost-ceiling-usd <value>`.
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge, buildAgentDispatchArgs } from './ui-bridge.ts';
import { DRY_BRIDGE_LOG_BUCKET } from './dry-bridge.ts';
import { runAgent } from '../orchestrator/run-agent.ts';
import { MAX_KICKOFF_COST_CEILING_USD, DEFAULT_KICKOFF_COST_CEILING_USD } from '../orchestrator/config.ts';
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
  const root = mkdtempSync(join(tmpdir(), 'bridge-ceiling-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  mkdirSync(join(root, 'projects', 'gitpulse'), { recursive: true });
  mkdirSync(join(root, 'skills', 'test-runnable'), { recursive: true });
  writeFileSync(join(root, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended'));
  return root;
}

// ---------------------------------------------------------------------------
// Shared bridge for (B) validation + the (C) success-control case.
// ---------------------------------------------------------------------------

let forgeRoot: string;
let logsRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = scaffoldForgeRoot();
  logsRoot = join(forgeRoot, '_logs');
  process.env.FORGE_DRY_BRIDGE = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (B) Validation, fail-closed — mechanism-grounded no-spawn proof.
// ---------------------------------------------------------------------------

function readDryBridgeSkipEvents(): Array<Record<string, unknown>> {
  const p = join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Count of `dry-bridge.skip`/`agent-turn` events logged for THIS route — the
 *  mechanism-grounded proxy for "a dispatch attempt reached the spawn point"
 *  (see the file header; mirrors ui-bridge-agent-run-materials.test.ts's
 *  identical technique, reimplemented locally since the two files are
 *  independently owned). */
function runRouteSkipCount(): number {
  return readDryBridgeSkipEvents().filter((e) => {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    return e['message'] === 'dry-bridge.skip' && meta?.['action'] === 'agent-turn' && meta?.['route'] === '/api/agents/:slug/run';
  }).length;
}

type RunBody = { ok?: boolean; runId?: string; slug?: string; error?: string; dryBridge?: { skipped: string[] } };

async function postRun(body: unknown): Promise<{ status: number; body: RunBody }> {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as RunBody };
}

function assertAccepted(status: number, body: RunBody, skipsBefore: number): void {
  assert.equal(status, 200, `expected 200, got ${status} (body: ${JSON.stringify(body)})`);
  assert.equal(body.ok, true);
  assert.ok(typeof body.runId === 'string');
  assert.deepEqual(body.dryBridge?.skipped, ['agent-turn'], 'a genuinely-accepted dispatch must carry the dry-bridge agent-turn marker');
  assert.equal(runRouteSkipCount(), skipsBefore + 1, 'a genuinely-accepted dispatch must append exactly one agent-turn skip event for this route');
}

function assertRefused(status: number, body: RunBody, skipsBefore: number, label: string): void {
  assert.equal(status, 400, `${label}: expected 400, got ${status} (body: ${JSON.stringify(body)})`);
  assert.equal(body.runId, undefined, `${label}: a refused request must never mint a runId`);
  assert.equal(body.dryBridge, undefined, `${label}: a refused request must never carry a dryBridge marker — that marker only appears on the branch that actually reached the spawn point`);
  assert.equal(runRouteSkipCount(), skipsBefore, `${label}: no new agent-turn dry-bridge.skip event may appear for this route — a refusal must never reach the spawn point`);
}

test('POST /api/agents/<slug>/run: no costCeilingUsd ⇒ 200 with a genuine (mechanism-proven) dispatch attempt — POSITIVE CONTROL every refusal test below stands on', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ project: 'gitpulse' });
  assertAccepted(status, body, skipsBefore);
  assert.match(body.runId as string, /^_agent-test-runnable-/);
});

test('POST /api/agents/<slug>/run: a valid numeric costCeilingUsd ⇒ 200, genuine dispatch attempt', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ project: 'gitpulse', costCeilingUsd: 2.5 });
  assertAccepted(status, body, skipsBefore);
});

test('POST /api/agents/<slug>/run: costCeilingUsd exactly at MAX_KICKOFF_COST_CEILING_USD ⇒ accepted (boundary, inclusive)', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD });
  assertAccepted(status, body, skipsBefore);
});

test('POST /api/agents/<slug>/run: costCeilingUsd one unit over MAX_KICKOFF_COST_CEILING_USD ⇒ 400, no dispatch attempt reaches the spawn point (boundary, exclusive)', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD + 1 });
  assertRefused(status, body, skipsBefore, 'one-over-max');
});

test('POST /api/agents/<slug>/run: costCeilingUsd = 0 ⇒ 400, no dispatch attempt', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: 0 });
  assertRefused(status, body, skipsBefore, 'zero');
});

test('POST /api/agents/<slug>/run: costCeilingUsd negative ⇒ 400, no dispatch attempt', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: -3 });
  assertRefused(status, body, skipsBefore, 'negative');
});

test('POST /api/agents/<slug>/run: costCeilingUsd as a string ⇒ 400, no dispatch attempt', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: '5' });
  assertRefused(status, body, skipsBefore, 'string');
});

test('POST /api/agents/<slug>/run: costCeilingUsd as a boolean ⇒ 400, no dispatch attempt (non-number, general case)', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: true });
  assertRefused(status, body, skipsBefore, 'boolean');
});

// Standard JSON has no numeric literal for IEEE NaN/Infinity — JSON.stringify
// coerces both to `null`, and a raw body containing the bare tokens `NaN` /
// `Infinity` is not valid JSON at all (the request would fail to parse for a
// reason unrelated to ceiling validation, which would be characterization,
// not a pin). The only wire-representable form of "the operator typed
// NaN/Infinity" is therefore the STRING form, which collapses into the
// general non-number/string case already covered above. Pinned explicitly
// here so the intent is on record.
test('POST /api/agents/<slug>/run: costCeilingUsd as the STRING "Infinity" ⇒ 400 (the only wire-representable form of a non-finite ceiling — JSON has no Infinity/NaN number literal)', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: 'Infinity' });
  assertRefused(status, body, skipsBefore, 'Infinity-as-string');
});

test('POST /api/agents/<slug>/run: an agent declaring its own budget AND an operator ceiling in the same request ⇒ still 200 (the route itself does not reject a coexisting declared budget — precedence is runAgent\'s job, pinned in orchestrator/run-agent-ceiling.test.ts)', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ project: 'gitpulse', costCeilingUsd: 1.5, inputs: { northStar: 'ship it' } });
  assertAccepted(status, body, skipsBefore);
});

// ---------------------------------------------------------------------------
// (C) A ceiling-stopped run surfaces as a DISTINCT terminal state via
// GET /api/agents/runs/:runId — never the same state a clean success reports.
// Both the success case and the ceiling-stop case are driven through a REAL
// `runAgent()` call (not a hand-typed events.jsonl fixture) with an injected
// queryFn, writing into this bridge's own `_logs/` — so the GET route is
// exercised against genuinely-produced output, not a guessed shape.
//
// `FORGE_DRY_BRIDGE=1` is set globally for this shared bridge (see (B)
// above) — but `runAgent`'s self-lifecycle path checks that var
// UNCONDITIONALLY, even with an injected queryFn, and would short-circuit
// BEFORE ever calling it. Each direct `runAgent()` call below therefore
// temporarily unsets it for the duration of that one call.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

function withoutDryBridgeEnv(): () => void {
  const prior = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  };
}

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
  const restore = withoutDryBridgeEnv();
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
    const runId = '_agent-ceiling-bridge-success';
    const workdir = mkdtempSync(join(forgeRoot, 'wd-success-'));

    await runAgent(def, {
      runId,
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: successQueryFn(0.02),
    });

    const res = await fetch(`${url}/api/agents/runs/${runId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string; costUsd: number };
    assert.equal(body.state, 'done');
    assert.equal(body.costUsd, 0.02);
  } finally {
    restore();
  }
});

test('GET /api/agents/runs/<runId>: a ceiling-stopped run reports a state DISTINCT from "done", with the real runaway cost (not zero) — kills "a budget-stopped run is reported as a clean success"', async () => {
  const restore = withoutDryBridgeEnv();
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));
    const runId = '_agent-ceiling-bridge-stopped';
    const workdir = mkdtempSync(join(forgeRoot, 'wd-stopped-'));
    const RUNAWAY_COST = 0.5713;

    await runAgent(def, {
      runId,
      workdir,
      prompt: 'p',
      logsRoot,
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
  } finally {
    restore();
  }
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

test('GET /api/studio/agents: defaultCostCeilingUsd is a TOP-LEVEL sibling of agents, never nested per-agent — it is run-level policy, not an agent property (kills "declared data that means something it doesn\'t")', async () => {
  const root = scaffoldForgeRoot();
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ runs: { defaultCostCeilingUsd: 9.75 } }));
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const res = await fetch(`${bridge.url}/api/studio/agents`);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>>; defaultCostCeilingUsd: number };
    assert.equal(body.defaultCostCeilingUsd, 9.75, 'sanity: the top-level field must still be present');
    assert.ok(body.agents.length > 0, 'sanity: the fixture roster must have at least one agent to inspect');
    for (const agent of body.agents) {
      assert.equal(
        'defaultCostCeilingUsd' in agent,
        false,
        `agent ${JSON.stringify(agent.slug)} must NOT carry a per-agent defaultCostCeilingUsd field — a per-agent placement would assert the default is agent-specific, which is false`,
      );
    }
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================
// (E) The CLI-argv dispatch seam — closing the gap round 1 flagged as
// unpinnable: bridge → `spawnAgentDispatch` (detached subprocess argv) →
// `forge agent dispatch` → `cmdAgentDispatch`'s parse → `dispatchAgentRun`.
// `spawnAgentDispatch` never actually spawns in this test process (harness-
// suppressed, and even unsuppressed it would hit the real SDK) — so this
// section pins the TWO HALVES that ARE directly drivable without a real
// subprocess, per the pattern `cli/agent-run-dispatch.test.ts` already
// establishes for `cmdAgentDispatch`:
//   1. `buildAgentDispatchArgs` — pure, no execution needed at all.
//   2. `cmdAgentDispatch`'s parse — driven with REAL argv, `dispatchAgentRun`
//      intercepted via `node:test`'s `mock.module` (NOT suppressed — the mock
//      replaces the real call entirely, so nothing downstream ever executes,
//      no SDK risk).
// Then ROUND-TRIPPED: part 1's output fed straight into part 2, unchanged —
// the one test that would have caught "the CLI arg is parsed but the value
// never reaches the dispatch call" across a real subprocess-argv boundary,
// which is exactly the shape of this campaign's most expensive prior lesson
// (a headline feature dead on the product's real path while a fully-green
// unit suite exercised only the direct in-process call).
//
// MOCK-ORDERING NOTE: `mock.module('../orchestrator/agent-dispatch.ts', ...)`
// only intercepts modules that import that specifier AFTER the mock is
// registered. `./ui-bridge.ts` (statically imported at the top of this file)
// already imports `orchestrator/agent-dispatch.ts` for `resolveDispatchableAgent`
// — by the time any test body runs, that module is already cached with its
// REAL bindings. `./agent-run.ts` (home of `cmdAgentDispatch`), however, is
// NOT imported anywhere else in this file's module graph — verified by
// inspection (cli/ui-bridge.ts never imports cli/agent-run.ts). Each test
// below therefore dynamically `import('./agent-run.ts')` for the FIRST time
// AFTER registering its mock, which is what makes the interception work
// (confirmed against this exact "already-cached dependency, fresh
// importer" shape with a standalone smoke test before writing these).
// =============================================================================

function containsFlagPair(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === value) return true;
  }
  return false;
}

// ---- E1: buildAgentDispatchArgs — pure, no execution, no mock needed ------

test('buildAgentDispatchArgs: bare minimum (slug + runId only) ⇒ exactly [slug, "--run-id", runId] — the shape cmdAgentDispatch\'s rest parameter expects with zero transformation (the ROUND-TRIP contract)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1');
  assert.deepEqual(args, ['my-slug', '--run-id', 'run-1']);
});

test('buildAgentDispatchArgs: --project regression (kills a refactor that drops the existing project flag while adding the new ceiling flag)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', 'gitpulse');
  assert.equal(args[0], 'my-slug');
  assert.ok(containsFlagPair(args, '--run-id', 'run-1'));
  assert.ok(containsFlagPair(args, '--project', 'gitpulse'));
});

test('buildAgentDispatchArgs: --input regression, including the existing SAFE_INPUT_KEY_RE skip of an invalid key (kills a refactor that drops that filter)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', undefined, { northStar: 'ship it', 'north star': 'x' });
  assert.ok(containsFlagPair(args, '--input', 'northStar=ship it'), `expected the valid key to survive, got ${JSON.stringify(args)}`);
  assert.ok(
    !args.some((a: string, i: number) => a === '--input' && (args[i + 1] ?? '').startsWith('north star=')),
    `the invalid key ("north star", contains a space) must still be skipped, exactly as spawnAgentDispatch does today — got ${JSON.stringify(args)}`,
  );
});

test('buildAgentDispatchArgs: --session-dir regression', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', undefined, undefined, '/abs/session/dir');
  assert.ok(containsFlagPair(args, '--session-dir', '/abs/session/dir'));
});

test('buildAgentDispatchArgs: costCeilingUsd present ⇒ emits --cost-ceiling-usd <value> (kills "the flag is parsed by cmdAgentDispatch but the builder never emits it")', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', undefined, undefined, undefined, 2.5);
  assert.ok(containsFlagPair(args, '--cost-ceiling-usd', '2.5'), `expected --cost-ceiling-usd 2.5, got ${JSON.stringify(args)}`);
});

test('buildAgentDispatchArgs: costCeilingUsd absent ⇒ no --cost-ceiling-usd flag at all (today\'s behaviour for every OTHER existing dispatch call, unchanged)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1');
  assert.ok(!args.includes('--cost-ceiling-usd'));
});

test('buildAgentDispatchArgs: ALL optional args together — comprehensive regression (project + input + session-dir + cost-ceiling coexist without clobbering each other)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', 9.99);
  assert.equal(args[0], 'my-slug');
  assert.ok(containsFlagPair(args, '--run-id', 'run-1'));
  assert.ok(containsFlagPair(args, '--project', 'gitpulse'));
  assert.ok(containsFlagPair(args, '--input', 'northStar=ship it'));
  assert.ok(containsFlagPair(args, '--session-dir', '/abs/session/dir'));
  assert.ok(containsFlagPair(args, '--cost-ceiling-usd', '9.99'));
});

// ---- E2/E3: cmdAgentDispatch's parse, mocked at the dispatchAgentRun call -

/** Stub process.exit/console around one `cmdAgentDispatch` invocation, so an
 *  exit-2 validation refusal is observable without tearing down the test
 *  runner. Mirrors `cli/agent-run-dispatch.test.ts`'s identical helper,
 *  generalised to accept the function reference (needed here because each
 *  call site dynamically imports a FRESH `cmdAgentDispatch` — see the
 *  mock-ordering note above — rather than a single module-level static
 *  import). */
async function runCli(
  fn: (args: string[], forgeRoot: string) => Promise<void>,
  args: string[],
  forgeRoot: string = ROOT,
): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit__${exitCode}`);
  }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await fn(args, forgeRoot);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

type MockDispatchCall = Record<string, unknown>;

function mockDispatchAgentRun(calls: MockDispatchCall[]) {
  return mock.module('../orchestrator/agent-dispatch.ts', {
    namedExports: {
      dispatchAgentRun: async (opts: MockDispatchCall) => {
        calls.push(opts);
        return {
          runId: opts.runId,
          slug: opts.slug,
          result: { costUsd: 0, outputRefs: [], tokensIn: 0, tokensOut: 0, suppressed: true },
        };
      },
    },
  });
}

test('cmdAgentDispatch: --cost-ceiling-usd not-a-number ⇒ exit 2 (fail-closed), dispatchAgentRun never called — kills "malformed ceiling silently dropped, dispatch proceeds anyway"', async () => {
  const calls: MockDispatchCall[] = [];
  const mocked = mockDispatchAgentRun(calls);
  try {
    const { cmdAgentDispatch } = await import('./agent-run.ts');
    const r = await runCli(cmdAgentDispatch, [
      'project-scoped-review', '--run-id', '_agent-cli-badceiling', '--cost-ceiling-usd', 'not-a-number',
    ]);
    assert.equal(r.exitCode, 2, `expected a fail-closed exit 2 for a malformed --cost-ceiling-usd, got ${JSON.stringify(r)}`);
    assert.equal(calls.length, 0, 'dispatchAgentRun must never be called when the ceiling flag is malformed — refused, not silently dropped');
  } finally {
    mocked.restore();
  }
});

test('cmdAgentDispatch: no --cost-ceiling-usd flag ⇒ dispatchAgentRun receives no kickoffCeilingUsd key at all (today\'s behaviour, unchanged)', async () => {
  const calls: MockDispatchCall[] = [];
  const mocked = mockDispatchAgentRun(calls);
  try {
    const { cmdAgentDispatch } = await import('./agent-run.ts');
    const r = await runCli(cmdAgentDispatch, ['project-scoped-review', '--run-id', '_agent-cli-noceiling']);
    assert.equal(r.exitCode, null, `expected a clean dispatch, got ${JSON.stringify(r)}`);
    assert.equal(calls.length, 1);
    assert.equal('kickoffCeilingUsd' in calls[0], false, 'no --cost-ceiling-usd flag must mean no kickoffCeilingUsd key reaches dispatchAgentRun\'s opts at all');
  } finally {
    mocked.restore();
  }
});

// ---- E4: THE ROUND-TRIP — the real-client-path AT ------------------------

test('ROUND-TRIP (the real-client-path AT this WI is really about): buildAgentDispatchArgs(...) output fed STRAIGHT into cmdAgentDispatch\'s parse — the operator\'s cost ceiling survives the CLI-argv seam unchanged. This is the one test that would have caught "field parsed+surfaced but never reaches enforcement" across a real subprocess-argv boundary, which no direct dispatchAgentRun/runAgent call (this file\'s (C) section, or the orchestrator sibling file) can exercise', async () => {
  const calls: MockDispatchCall[] = [];
  const mocked = mockDispatchAgentRun(calls);
  try {
    const { cmdAgentDispatch } = await import('./agent-run.ts');
    const runId = '_agent-cli-roundtrip-ceiling';
    const CEILING = 17.5;
    const args = buildAgentDispatchArgs('project-scoped-review', runId, undefined, undefined, undefined, CEILING);
    const r = await runCli(cmdAgentDispatch, args);
    assert.equal(r.exitCode, null, `expected a clean dispatch, got ${JSON.stringify(r)}`);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.kickoffCeilingUsd,
      CEILING,
      'the operator ceiling encoded by buildAgentDispatchArgs must survive cmdAgentDispatch\'s argv parse and reach the dispatchAgentRun call unchanged',
    );
  } finally {
    mocked.restore();
  }
});
