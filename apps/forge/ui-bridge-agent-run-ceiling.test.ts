/**
 * Acceptance tests for WI-2 (R6-04): the per-kickoff cost ceiling on
 * `POST /api/agents/<slug>/run`, its CLI-argv dispatch seam, and its
 * downstream surfacing.
 *
 * RUN COMMAND — the standard invocation, no extra flags:
 *
 *   node --test --experimental-strip-types cli/ui-bridge-agent-run-ceiling.test.ts
 *
 * (Round 2 used `node:test`'s `mock.module` for the CLI-argv seam section
 * below, which needs `--experimental-test-module-mocks` — a real Node
 * experimental flag with no other user anywhere in this repo, and `npm test`
 * does not pass it. Round 3 replaced that with a PURE PARSE FUNCTION
 * (`parseAgentDispatchArgs`, mirroring `buildAgentDispatchArgs`) so the seam
 * is pinned as ordinary function composition — no mock, no flag, no
 * import-cache ordering to reason about. See section (E) below.)
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
 *       (`buildAgentDispatchArgs`) and the parse on the other end
 *       (`parseAgentDispatchArgs`) are pinned SEPARATELY as pure functions
 *       and then ROUND-TRIPPED by composing them directly, closing the exact
 *       gap a detached-subprocess boundary would otherwise hide from every
 *       other test in this WI — with NO spawn, NO mock, and NO real
 *       execution of `cmdAgentDispatch`/`dispatchAgentRun` needed at all for
 *       the round-trip itself.
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
 *     apps/studio/lib/studio-client.ts) AND already imports
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
 *     helper's output). This is what lets the ROUND-TRIP test below compose
 *     it directly with `parseAgentDispatchArgs` with zero transformation —
 *     if the implementer instead returns the full array, every test in the
 *     buildAgentDispatchArgs + ROUND-TRIP section needs a one-line
 *     `.slice(4)` adjustment, noted here so that's a quick fix, not a
 *     rediscovery.
 *   - New CLI flag name: `--cost-ceiling-usd <value>`.
 *   - `parseAgentDispatchArgs` (round 3, replacing round 2's `mock.module`
 *     approach) — a NEW pure exported helper the implementer extracts from
 *     `cmdAgentDispatch`'s existing inline flag-parsing (`cli/agent-run.ts`):
 *     slug/`--run-id`/`--project`/`--input`/`--session-dir` extraction, PLUS
 *     the new `--cost-ceiling-usd`. Assumed exported from `./agent-run.ts`
 *     (same file `cmdAgentDispatch` already lives in) with signature
 *       `parseAgentDispatchArgs(rest: string[]): { slug: string; runId: string;
 *        project?: string; inputs: Record<string, string>; sessionDir?: string;
 *        costCeilingUsd?: number }`
 *     PINNED PRECISELY (per the round-3 ruling that a refusal shape must be
 *     specified, not left for the implementer to guess): THROWS a
 *     JS `Error` synchronously for a missing slug, a missing `--run-id`, a
 *     malformed `--input` (no `=`), or a `--cost-ceiling-usd` value that does
 *     not parse to a finite number — mirroring the throw-based idiom already
 *     used elsewhere on this call path (`resolveDispatchableAgent`,
 *     `dispatchAgentRun`'s slug/runId guards). `costCeilingUsd` is ABSENT
 *     (not present-as-`undefined`) from the result when the flag is not
 *     given — the same "key absent, not undefined" discipline pinned
 *     throughout this WI (`orchestrator/run-agent-ceiling.test.ts`'s
 *     equivalent test). `inputs` is always a (possibly empty) object, never
 *     absent — it is NOT marked optional in the signature above, unlike
 *     `project`/`sessionDir`/`costCeilingUsd`. NOTE: `parseAgentDispatchArgs`
 *     does NOT apply the `SAFE_INPUT_KEY_RE` filter — that filter belongs to
 *     `buildAgentDispatchArgs`'s OUTBOUND construction (what forge itself
 *     sends); the INBOUND parser's only `--input` validation, mirroring
 *     `cmdAgentDispatch`'s existing behaviour today, is rejecting a pair with
 *     no `=`. This function does NOT re-validate `costCeilingUsd`'s business
 *     bounds (`<= 0`, above `MAX_KICKOFF_COST_CEILING_USD`) — those are
 *     independently owned and already pinned at the bridge-route layer (B,
 *     above); the CLI parser's job is narrower: "is this string a valid
 *     finite number at all".
 *
 * ROUND 4 — the residual gap round 3 disclosed (the one-line glue inside
 * `cmdAgentDispatch` that maps `parseAgentDispatchArgs(...).costCeilingUsd`
 * onto `dispatchAgentRun({kickoffCeilingUsd})`) is now CLOSED, not merely
 * disclosed: a peer orchestrator overruled accepting it, for a concrete
 * reason worth recording — the orchestrator sibling file's `dispatchAgentRun`
 * threading test constructs its call args DIRECTLY; it cannot observe a
 * defect in `cmdAgentDispatch`'s own glue, because that glue never runs in
 * that test at all. An implementer who writes
 * `dispatchAgentRun(slug, { project, inputs })` — silently dropping the
 * parsed ceiling — passes every other test in this WI while shipping a
 * feature dead on the one path an operator actually drives.
 *
 * Closed the same way `orchestrator/run-agent.ts` already lets tests observe
 * behaviour without a real spawn: an INJECTED DEPENDENCY, mirroring
 * `RunContext.queryFn`/`ctx.probeConnection`'s existing pattern exactly.
 * `cmdAgentDispatch` gains an optional third parameter:
 *
 *   export async function cmdAgentDispatch(
 *     rest: string[],
 *     forgeRoot: string,
 *     deps?: { dispatch?: typeof dispatchAgentRun },
 *   ): Promise<void>
 *
 * defaulting to the real `dispatchAgentRun` when omitted (production
 * behaviour unchanged — every OTHER test in this file, and
 * `cli/agent-run-dispatch.test.ts`, calls `cmdAgentDispatch` with no third
 * argument and must keep passing byte-identically). The two tests at the end
 * of section (E) below drive `cmdAgentDispatch` with REAL argv, inject a
 * capturing fake in place of `dispatchAgentRun`, and assert the CALL RECORD
 * (the fake's captured `opts`) — not merely an exit code or console line —
 * because the defect shape here is exactly "this was invoked without the
 * value", which only the arguments can show. No mock, no
 * `--experimental-test-module-mocks`, no real spawn: the injected fake
 * fully replaces the real call, so nothing downstream of it ever executes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge, buildAgentDispatchArgs } from './ui-bridge.ts';
import { cmdAgentDispatch, parseAgentDispatchArgs } from '@forge/agents/agent-dispatch-cmd.ts';
import { DRY_BRIDGE_LOG_BUCKET } from './dry-bridge.ts';
import { runAgent } from '@forge/agents/run-agent.ts';
import { MAX_KICKOFF_COST_CEILING_USD, DEFAULT_KICKOFF_COST_CEILING_USD } from '@forge/kernel';
import { listAgentDefinitions } from '../../orchestrator/studio/registry.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { DispatchAgentRunOpts, DispatchAgentRunResult } from '@forge/agents/agent-dispatch.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function studioAgent(slug: string, surface: string, loopStrategy?: string): string {
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
${loopStrategy !== undefined ? `  loopStrategy: ${loopStrategy}\n` : ''}allowed-tools: [Read]
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
  // R6-04 WI-2 ROUND 7 — declares loopStrategy: 'one-shot' explicitly (it
  // did not before). This is a deliberate fixture change, not incidental:
  // the round-7 ruling makes the ceiling refused-not-threaded for any agent
  // that ISN'T one-shot, and every EXISTING "costCeilingUsd ⇒ 200" test in
  // this file already uses `test-runnable` — those tests were always meant
  // to pin the ACCEPTED path, which only remains meaningful now if the
  // fixture is genuinely enforceable. Verified safe: `studioAgent`/
  // `scaffoldForgeRoot` have exactly one other caller family (the
  // GET /api/studio/agents defaultCostCeilingUsd tests), which don't touch
  // loopStrategy/spawn-path behaviour at all.
  writeFileSync(join(root, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended', 'one-shot'));
  // NEW — the round-7 counterpart: NO loopStrategy declared (mirrors 14 of
  // 19 real dispatchable roster agents, and `test-runnable`'s OWN original
  // shape before this round). This is the fixture the new refusal +
  // negative-twin tests below drive.
  mkdirSync(join(root, 'skills', 'test-legacy'), { recursive: true });
  writeFileSync(join(root, 'skills', 'test-legacy', 'SKILL.md'), studioAgent('test-legacy', 'unattended'));
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
  return postRunAs('test-runnable', body);
}

/** Round 7 — generalized so the new refusal/negative-twin tests can drive
 *  "test-legacy" (no loopStrategy) while every existing test keeps calling
 *  the unchanged `postRun` against "test-runnable" (now one-shot). */
async function postRunAs(slug: string, body: unknown): Promise<{ status: number; body: RunBody }> {
  const res = await fetch(`${url}/api/agents/${slug}/run`, {
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
// R6-04 WI-2 ROUND 7 — spawner ruling, fail-closed guard, BRIDGE-ROUTE layer.
// See orchestrator/run-agent-ceiling.test.ts's own round-7 header for the
// full finding (14 of 19 dispatchable roster agents take the legacy path,
// which has no budget concept — an operator ceiling against one of them
// would be validated, recorded, shown in the UI, and silently unenforced).
// This is the OTHER of the two required enforcement layers: the route must
// refuse before ever reaching the spawn point, using the SAME pinned message
// substrings as the runAgent-level guard (two substring matches, not a full-
// string template — the ruling gave an example wording, not a verbatim one,
// unlike WI-1's gate-refusal messages).
// ---------------------------------------------------------------------------

test('POST /api/agents/<slug>/run: costCeilingUsd against "test-legacy" (no loopStrategy declared) ⇒ ACCEPTED and recorded on the t0 dispatched event. ⚑ AMENDED W7-B5 (agents-21): the legacy invocation path now ENFORCES the ceiling (adapter maxBudgetUsdPerIteration — run-agent-w7b5.test.ts pins the SDK call record), so the R6-04 refusal would leave the six no-loopStrategy roster agents permanently uncappable', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRunAs('test-legacy', { project: 'gitpulse', costCeilingUsd: 2.5 });
  assertAccepted(status, body, skipsBefore);
  assert.match(body.runId as string, /^_agent-test-legacy-/);
  // The ceiling is durable from t0 (agents-31): the run detail serves it
  // before any start/end event exists.
  const detail = await fetch(`${url}/api/agents/runs/${encodeURIComponent(body.runId as string)}`);
  const detailBody = await detail.json() as Record<string, unknown>;
  assert.equal(detailBody.ceilingUsd, 2.5, 'the accepted ceiling must be readable off the run detail at t0');
});

test('POST /api/agents/<slug>/run: NEGATIVE TWIN, load-bearing — no costCeilingUsd at all against "test-legacy" ⇒ still 200, completely unaffected by the new guard. This is the path every ordinary dispatch of the 14 non-one-shot roster agents takes; if the refusal leaked into this case, most of the roster would break to add a limit feature', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRunAs('test-legacy', { project: 'gitpulse' });
  assertAccepted(status, body, skipsBefore);
  assert.match(body.runId as string, /^_agent-test-legacy-/);
});

// ---------------------------------------------------------------------------
// ROUND 8 — precedence ruling. `[exec]` found the route's enforceability
// check sits INSIDE the `costCeilingUsd !== undefined` block AFTER the
// bounds check — so an out-of-bounds value against a legacy-path agent
// today gets the BOUNDS message ("exceeds max"), which is actively
// misleading: it implies "use a smaller number" as a remedy, but for a
// legacy-path agent NO value is acceptable at all. Ruling: three ordered
// stages — (1) shape/type, unchanged; (2) ENFORCEABILITY, now wins over (3)
// bounds. Each test below asserts on MESSAGE CONTENT, not just the 400 —
// an unpinned ordering is exactly the kind of thing a later refactor
// silently flips, and a bare status-code check cannot catch that.
//
// (the fourth cell of the 2x2 — in-bounds + legacy-path ⇒ enforceability —
// is already pinned above, "costCeilingUsd against test-legacy... ⇒ 400,
// fail-closed"; not duplicated here.)
// ---------------------------------------------------------------------------

test('PRECEDENCE: an OUT-OF-BOUNDS ceiling against a LEGACY-PATH agent ⇒ the BOUNDS message. ⚑ AMENDED W7-B5 (agents-21): the legacy path is now ENFORCEABLE, so "use a smaller number" is once again a remedy that genuinely works for this agent — the R6-04 enforceability-wins ordering only ever applied because no value was acceptable then', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRunAs('test-legacy', { costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD + 1 });
  assertRefused(status, body, skipsBefore, 'out-of-bounds-legacy-path');
  assert.match(body.error ?? '', /invalid costCeilingUsd/, `expected the BOUNDS message (the legacy path is enforceable since W7-B5) — got: ${JSON.stringify(body.error)}`);
  assert.doesNotMatch(body.error ?? '', /ceiling not enforceable for this agent's loop strategy/, `the enforceability message must not appear for an agent that IS enforceable — got: ${JSON.stringify(body.error)}`);
});

test('PRECEDENCE: POSITIVE CONTROL — an OUT-OF-BOUNDS ceiling against a ONE-SHOT agent ⇒ the BOUNDS message, unchanged. Without this pair, the test above could pass for the trivial (wrong) reason that enforceability swallows EVERY refusal regardless of agent — this proves bounds still fires, and fires with its own message, for the class that can actually use it', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRun({ costCeilingUsd: MAX_KICKOFF_COST_CEILING_USD + 1 });
  assertRefused(status, body, skipsBefore, 'out-of-bounds-one-shot');
  assert.match(body.error ?? '', /invalid costCeilingUsd/, `expected the BOUNDS message for a one-shot agent (enforceability doesn't even apply here) — got: ${JSON.stringify(body.error)}`);
  assert.doesNotMatch(body.error ?? '', /ceiling not enforceable for this agent's loop strategy/, `the enforceability message must not appear for an agent that IS enforceable — got: ${JSON.stringify(body.error)}`);
});

test('PRECEDENCE: a MALFORMED ceiling ("abc", not a number) against a LEGACY-PATH agent ⇒ the shape/type message, NOT the enforceability message — stage 1 (shape) must still precede stage 2 (enforceability); we should never reason about whether a non-numeric value is "enforceable"', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRunAs('test-legacy', { costCeilingUsd: 'abc' });
  assertRefused(status, body, skipsBefore, 'malformed-string-legacy-path');
  assert.match(body.error ?? '', /invalid costCeilingUsd/, `expected the shape/type message to win over enforceability — got: ${JSON.stringify(body.error)}`);
  assert.doesNotMatch(body.error ?? '', /ceiling not enforceable for this agent's loop strategy/, `enforceability reasoning must never be reached for a malformed value — got: ${JSON.stringify(body.error)}`);
});

test('PRECEDENCE: a NaN-shaped ceiling (the string "NaN", the only wire-representable form) against a LEGACY-PATH agent ⇒ the shape/type message, NOT the enforceability message — same stage-1-before-stage-2 property, distinct malformed shape from the plain non-numeric-string case above', async () => {
  const skipsBefore = runRouteSkipCount();
  const { status, body } = await postRunAs('test-legacy', { costCeilingUsd: 'NaN' });
  assertRefused(status, body, skipsBefore, 'nan-string-legacy-path');
  assert.match(body.error ?? '', /invalid costCeilingUsd/, `expected the shape/type message to win over enforceability — got: ${JSON.stringify(body.error)}`);
  assert.doesNotMatch(body.error ?? '', /ceiling not enforceable for this agent's loop strategy/, `enforceability reasoning must never be reached for a malformed value — got: ${JSON.stringify(body.error)}`);
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
// above) — but `runAgent`'s self-lifecycle path checks
// `FORGE_DRY_BRIDGE`/`FORGE_ARCHITECT_NO_SPAWN` UNCONDITIONALLY, even with an
// injected queryFn, and would short-circuit BEFORE ever calling it. BOTH
// vars, not just the one this file happens to set itself — CI
// (`.github/workflows/ci.yml`) sets `FORGE_ARCHITECT_NO_SPAWN=1` for the
// whole test job, independently of anything this file does. A helper that
// only unset `FORGE_DRY_BRIDGE` (this file's pre-existing local var) would
// pass on a developer machine, where NO_SPAWN is not ambient, and fail in
// CI, where it is — exactly the failure mode this file's own header warns
// against, and exactly what happened on the first real CI run. Each direct
// `runAgent()` call below therefore unsets BOTH vars for the duration of
// that one call, restoring in a `finally` — mirrors
// `orchestrator/run-agent-ceiling.test.ts`'s identical
// `withoutSpawnSuppressionEnv()` helper (same name, redefined locally since
// that file does not export it).
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
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
  const restore = withoutSpawnSuppressionEnv();
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
  const restore = withoutSpawnSuppressionEnv();
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
// unpinnable, WITHOUT `node:test`'s `mock.module` (round 2's approach; round
// 3 replaced it — see the RESIDUAL GAP note in the file header for exactly
// what that trade costs). `spawnAgentDispatch` never actually spawns in this
// test process (harness-suppressed, and even unsuppressed it would hit the
// real SDK) — so this section pins the seam as PURE FUNCTION COMPOSITION:
//   1. `buildAgentDispatchArgs` — pure, no execution needed at all.
//   2. `parseAgentDispatchArgs` — pure, no execution needed at all.
//   3. ROUND-TRIP: `parseAgentDispatchArgs(buildAgentDispatchArgs(...))`,
//      composed directly — the one test that would have caught "the CLI arg
//      is parsed but the value never reaches the parsed result" across a
//      real subprocess-argv boundary, with NO spawn/mock/flag required.
// A single `cmdAgentDispatch`-level integration test (E5, real static
// import, no mock — plain `process.exit`/console stub, matching
// `cli/agent-run-dispatch.test.ts`'s own established pattern) additionally
// pins that `cmdAgentDispatch` actually WIRES `parseAgentDispatchArgs` in
// (not just defines it unused) by observing the CLI-level exit code on a
// malformed ceiling — that malformed-input path never reaches any spawn
// point regardless (the parse throws first), so no suppression env is
// needed for it either.
// =============================================================================

function containsFlagPair(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === value) return true;
  }
  return false;
}

// ---- E1: buildAgentDispatchArgs — pure, no execution needed --------------

test('buildAgentDispatchArgs: bare minimum (slug + runId only) ⇒ exactly [slug, "--run-id", runId] — the shape parseAgentDispatchArgs\'s rest parameter expects with zero transformation (the ROUND-TRIP contract)', () => {
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

test('buildAgentDispatchArgs: costCeilingUsd present ⇒ emits --cost-ceiling-usd <value> (kills "the flag is parsed but the builder never emits it")', () => {
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

// ---- E2: parseAgentDispatchArgs — pure, no execution needed ---------------

test('parseAgentDispatchArgs: bare minimum (slug + runId only) ⇒ { slug, runId, inputs: {} } — project/sessionDir/costCeilingUsd all ABSENT (not undefined-valued)', () => {
  const parsed = parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1']);
  assert.equal(parsed.slug, 'my-slug');
  assert.equal(parsed.runId, 'run-1');
  assert.deepEqual(parsed.inputs, {});
  assert.equal('project' in parsed, false);
  assert.equal('sessionDir' in parsed, false);
  assert.equal('costCeilingUsd' in parsed, false);
});

test('parseAgentDispatchArgs: --project extraction', () => {
  const parsed = parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--project', 'gitpulse']);
  assert.equal(parsed.project, 'gitpulse');
});

test('parseAgentDispatchArgs: --input extraction (k=v), and a malformed pair (no "=") throws — mirrors cmdAgentDispatch\'s existing "--input expects k=v" behaviour today', () => {
  const parsed = parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--input', 'northStar=ship it']);
  assert.deepEqual(parsed.inputs, { northStar: 'ship it' });

  assert.throws(
    () => parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--input', 'novalue']),
    'a malformed --input pair (no "=") must throw, not silently drop the flag or produce a garbage key',
  );
});

test('parseAgentDispatchArgs: --session-dir extraction', () => {
  const parsed = parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--session-dir', '/abs/session/dir']);
  assert.equal(parsed.sessionDir, '/abs/session/dir');
});

test('parseAgentDispatchArgs: --cost-ceiling-usd <valid number> ⇒ costCeilingUsd is the parsed NUMBER (not the raw string) — kills "the CLI arg is parsed but stays a string, breaking downstream numeric comparisons"', () => {
  const parsed = parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--cost-ceiling-usd', '2.5']);
  assert.equal(parsed.costCeilingUsd, 2.5);
  assert.equal(typeof parsed.costCeilingUsd, 'number');
});

test('parseAgentDispatchArgs: --cost-ceiling-usd not-a-number ⇒ throws (fail-closed) — kills "malformed ceiling silently dropped, dispatch proceeds anyway"', () => {
  assert.throws(
    () => parseAgentDispatchArgs(['my-slug', '--run-id', 'run-1', '--cost-ceiling-usd', 'not-a-number']),
    'a --cost-ceiling-usd value that does not parse to a finite number must throw, not silently fall through with costCeilingUsd absent/NaN',
  );
});

test('parseAgentDispatchArgs: missing slug ⇒ throws', () => {
  assert.throws(() => parseAgentDispatchArgs(['--run-id', 'run-1']));
});

test('parseAgentDispatchArgs: missing --run-id ⇒ throws', () => {
  assert.throws(() => parseAgentDispatchArgs(['my-slug']));
});

// ---- E3: THE ROUND-TRIP — the real-client-path AT, as pure composition ---

test('ROUND-TRIP (the real-client-path AT this WI is really about): parseAgentDispatchArgs(buildAgentDispatchArgs(...)) — the operator\'s cost ceiling AND every other field survive the CLI-argv seam unchanged, composed directly with no spawn/mock/flag needed. This is the one test that would have caught "field parsed+surfaced but never reaches the other side" across a real subprocess-argv boundary', () => {
  const CEILING = 17.5;
  const args = buildAgentDispatchArgs('project-scoped-review', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', CEILING);
  const parsed = parseAgentDispatchArgs(args);

  assert.equal(parsed.slug, 'project-scoped-review');
  assert.equal(parsed.runId, 'run-1');
  assert.equal(parsed.project, 'gitpulse');
  assert.deepEqual(parsed.inputs, { northStar: 'ship it' });
  assert.equal(parsed.sessionDir, '/abs/session/dir');
  assert.equal(
    parsed.costCeilingUsd,
    CEILING,
    'the operator ceiling encoded by buildAgentDispatchArgs must survive parseAgentDispatchArgs\'s parse unchanged, as a number, across the round trip',
  );
});

test('ROUND-TRIP, absence direction: no costCeilingUsd given to buildAgentDispatchArgs ⇒ parseAgentDispatchArgs\'s result has NO costCeilingUsd key either (today\'s behaviour, unchanged, proven end-to-end through both pure functions together)', () => {
  const args = buildAgentDispatchArgs('project-scoped-review', 'run-1');
  const parsed = parseAgentDispatchArgs(args);
  assert.equal('costCeilingUsd' in parsed, false);
});

// ---- E4: cmdAgentDispatch actually WIRES parseAgentDispatchArgs in -------

/** Shape of `cmdAgentDispatch`'s NEW optional third parameter (round 4) — not
 *  yet declared on the real function, hence the cast at the one call site
 *  below rather than scattering `as unknown` casts across every test.
 *  Mirrors `RunContext.queryFn`/`ctx.probeConnection`'s existing
 *  test-injection pattern (`orchestrator/run-agent.ts`): production code
 *  defaults to the real `dispatchAgentRun` when `deps`/`deps.dispatch` is
 *  omitted, so every OTHER call site (including every other test in this
 *  file and `cli/agent-run-dispatch.test.ts`) is byte-identical. */
type InjectedDispatch = (opts: DispatchAgentRunOpts) => Promise<DispatchAgentRunResult>;
type CmdAgentDispatchDeps = { dispatch?: InjectedDispatch };
type CmdAgentDispatchWithDeps = (rest: string[], forgeRoot: string, deps?: CmdAgentDispatchDeps) => Promise<void>;

/** Stub process.exit/console around one `cmdAgentDispatch` invocation, so an
 *  exit-2 validation refusal is observable without tearing down the test
 *  runner. Mirrors `cli/agent-run-dispatch.test.ts`'s identical helper. No
 *  mock needed here (round 3 removed `node:test`'s `mock.module` entirely):
 *  a malformed `--cost-ceiling-usd` must make `parseAgentDispatchArgs` throw
 *  BEFORE `cmdAgentDispatch` ever reaches a dispatch/spawn call, so this is
 *  safe to run with a plain static `cmdAgentDispatch` import and no
 *  suppression env — and the round-4 `deps` param (when supplied) fully
 *  replaces the real dispatch call, so nothing downstream of it executes
 *  either. */
async function runCli(
  args: string[],
  forgeRootArg: string = ROOT,
  deps?: CmdAgentDispatchDeps,
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
    await (cmdAgentDispatch as unknown as CmdAgentDispatchWithDeps)(args, forgeRootArg, deps);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

test('cmdAgentDispatch: --cost-ceiling-usd not-a-number ⇒ exit 2 (fail-closed), matching every other pre-dispatch validation failure already established for this command (missing slug/--run-id, malformed --input) — proves cmdAgentDispatch actually calls parseAgentDispatchArgs, not merely defines it unused', async () => {
  const r = await runCli(['project-scoped-review', '--run-id', '_agent-cli-badceiling', '--cost-ceiling-usd', 'not-a-number']);
  assert.equal(r.exitCode, 2, `expected a fail-closed exit 2 for a malformed --cost-ceiling-usd, got ${JSON.stringify(r)}`);
});

// ---- E5: the CLOSING pin — injected deps.dispatch captures the CALL RECORD

test('cmdAgentDispatch: injected deps.dispatch captures the CALL RECORD — the operator\'s --cost-ceiling-usd reaches the dispatch call\'s opts.kickoffCeilingUsd with its EXACT value. Closes argv → parseAgentDispatchArgs → dispatch end-to-end with no mock and no real spawn (an injected dependency, mirroring runAgent\'s ctx.queryFn/ctx.probeConnection seam). Kills the one defect no other test in this WI can see: a cmdAgentDispatch that parses the flag correctly and calls dispatchAgentRun WITHOUT ever forwarding kickoffCeilingUsd', async () => {
  const calls: Record<string, unknown>[] = [];
  const fakeDispatch: InjectedDispatch = async (opts) => {
    calls.push(opts as unknown as Record<string, unknown>);
    return {
      runId: opts.runId,
      slug: opts.slug,
      result: { costUsd: 0, outputRefs: [], tokensIn: 0, tokensOut: 0, suppressed: true },
    };
  };
  const CEILING = 17.5;
  const r = await runCli(
    ['project-scoped-review', '--run-id', '_agent-cli-deps-ceiling', '--cost-ceiling-usd', String(CEILING)],
    ROOT,
    { dispatch: fakeDispatch },
  );
  assert.equal(r.exitCode, null, `expected a clean dispatch, got ${JSON.stringify(r)}`);
  assert.equal(calls.length, 1, 'the injected dispatch must be called exactly once');
  assert.equal(
    calls[0]?.kickoffCeilingUsd,
    CEILING,
    'the operator ceiling parsed from --cost-ceiling-usd must reach the dispatch call\'s opts.kickoffCeilingUsd with its exact value',
  );
});

test('cmdAgentDispatch: injected deps.dispatch — NEGATIVE TWIN: no --cost-ceiling-usd flag ⇒ kickoffCeilingUsd is ABSENT from the dispatch call\'s opts (not present-as-undefined, not silently defaulted)', async () => {
  const calls: Record<string, unknown>[] = [];
  const fakeDispatch: InjectedDispatch = async (opts) => {
    calls.push(opts as unknown as Record<string, unknown>);
    return {
      runId: opts.runId,
      slug: opts.slug,
      result: { costUsd: 0, outputRefs: [], tokensIn: 0, tokensOut: 0, suppressed: true },
    };
  };
  const r = await runCli(
    ['project-scoped-review', '--run-id', '_agent-cli-deps-noceiling'],
    ROOT,
    { dispatch: fakeDispatch },
  );
  assert.equal(r.exitCode, null, `expected a clean dispatch, got ${JSON.stringify(r)}`);
  assert.equal(calls.length, 1);
  assert.equal(
    'kickoffCeilingUsd' in calls[0],
    false,
    'no --cost-ceiling-usd flag must mean no kickoffCeilingUsd key reaches the dispatch call\'s opts at all',
  );
});
