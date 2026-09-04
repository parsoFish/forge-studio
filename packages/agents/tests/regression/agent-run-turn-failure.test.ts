/**
 * Tests for bead forge-poc (WI-2b, defect 1) — "a runner throw wedges a
 * session at its pre-turn phase forever".
 *
 * `cmdAgentRun` (`packages/agents/agent-run.ts`) used to await a runner's turn (either
 * the ADR-043 §3 turnSpec road's `runInteractiveTurn`, or one of the 4
 * legacy `AGENT_RUNNERS`' own `runTurn`) with NO try/catch anywhere between
 * it and the top-level `orchestrator/cli.ts` catch-all, which only prints to
 * stderr and calls `process.exit(1)` — invisible to `apps/forge/ui-bridge.ts`'s
 * `spawnAgentTurn`, which launches `forge agent run …` as a DETACHED,
 * unref'd child with stdio ignored except stderr→logfile. A throw during a
 * turn therefore left the session's `status.json` at its pre-turn phase
 * forever: the operator UI polls status and shows silence.
 *
 * The fix wraps the actual turn-invoking call on BOTH roads in a try/catch
 * that writes a terminal `phase: 'failed'` (carrying the real error text as
 * `error`) via the SAME `writeSessionTerminalPhase` seam `cmdAgentDispatch`
 * already used, then RETHROWS — the process exit code still reflects the
 * failure; only the OBSERVABLE (status.json) state is what changes.
 *
 * Both roads are driven WITHOUT the SDK: each scenario below is engineered
 * to make the REAL production runner throw synchronously, before any SDK
 * call — never a mocked/injected failure — so these tests exercise the
 * genuine code path bead forge-poc names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdAgentRun } from '../../agent-run.ts';
import { writeSessionStatus, readSessionStatus } from '@forge/sessions/interactive-session.ts';

// ---------------------------------------------------------------------------
// chdir helper — cmdAgentRun's legacy road resolves `--project` cwd-relative
// (`resolve('projects', projectArg)`); mirrors cli/agent-run.test.ts's own
// `withCwd` precedent for exactly this reason.
// ---------------------------------------------------------------------------

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

type Status = { phase?: string; error?: string; [k: string]: unknown };

function readStatusJson(sessionDir: string): Status {
  const raw = readFileSync(join(sessionDir, 'status.json'), 'utf8');
  return JSON.parse(raw) as Status;
}

// ---------------------------------------------------------------------------
// turnSpec-road fixture — a session-kinds.yaml with a SINGLE known phase
// (`step: noop`, mirrors cli/agent-run.test.ts's own zero-SDK-calls
// precedent). Any status.json phase NOT in this table makes
// `runInteractiveTurn` throw synchronously: "turnSpec.phases has no row for
// phase …" — a REAL, deterministic, SDK-free throw from the production spine.
// ---------------------------------------------------------------------------

const TURNSPEC_ID = 'forge-poc-fixture-kind';
const TURNSPEC_KIND_DIR = '_forgepocfixture';

const SESSION_KINDS_YAML = `
- id: ${TURNSPEC_ID}
  agent: project-brain-builder
  title: Fixture turnSpec kind (bead forge-poc)
  legacyRoutes: []
  stages: [contract]
  defaultStage: contract
  artifact:
    kind: markdown-draft
    label: Fixture artifact
  turnSpec:
    kindDir: ${TURNSPEC_KIND_DIR}
    style: agent
    phases:
      - { phase: known-phase, step: noop }
`;

function setupTurnspecFixture(): { forgeRoot: string; projectArg: string; projectRoot: string; sessionId: string; sessionDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-poc-turnspec-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), SESSION_KINDS_YAML);

  const projectArg = 'fixtureproj';
  const projectRoot = join(forgeRoot, 'projects', projectArg);
  const sessionId = '2026-08-23T00-00-00-forgepoc';
  const sessionDir = join(projectRoot, TURNSPEC_KIND_DIR, sessionId);
  mkdirSync(sessionDir, { recursive: true });

  return { forgeRoot, projectArg, projectRoot, sessionId, sessionDir };
}

// ---------------------------------------------------------------------------
// Test 1 — turnSpec road: a turn that throws leaves status.json at a
// terminal 'failed' phase CARRYING the real error text, and the throw still
// propagates out of cmdAgentRun.
//
// Kills: no try/catch at all (status.json would stay at 'unknown-phase'
// forever — this is literally the pre-fix bug); a catch that swallows the
// error (process would exit 0 / cmdAgentRun would resolve instead of
// reject); a catch that writes phase:'failed' but no `error` text (fails the
// "carry the real error text" assertion below).
// ---------------------------------------------------------------------------

test('forge-poc AT-1 (turnSpec road): a runInteractiveTurn throw → status.json ends at phase:"failed" carrying the real error text, AND the throw still propagates', async () => {
  const { forgeRoot, projectArg, sessionId, sessionDir } = setupTurnspecFixture();
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'unknown-phase' });

  await withCwd(forgeRoot, async () => {
    await assert.rejects(
      () => cmdAgentRun([TURNSPEC_ID, sessionId, '--project', projectArg], forgeRoot),
      /turnSpec\.phases has no row for phase "unknown-phase"/,
      'cmdAgentRun must REJECT (rethrow) — the exit code must still reflect the failure',
    );
  });

  const status = readStatusJson(sessionDir);
  assert.equal(status.phase, 'failed', `expected a terminal failed phase, got status.json: ${JSON.stringify(status)}`);
  assert.ok(
    typeof status.error === 'string' && /turnSpec\.phases has no row for phase "unknown-phase"/.test(status.error),
    `expected status.json.error to carry the real runner error text, got: ${JSON.stringify(status)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2 — sticky-cancel: a session already at phase:'cancelled' when its
// turn throws must NOT be resurrected to 'failed' — the reserved terminal
// phase wins (guardedWriteSessionStatus's cancelledPhaseWins, reused
// verbatim via writeSessionTerminalPhase). The throw must still propagate.
//
// Kills: a fix that writes status.json directly (bypassing
// guardedWriteSessionStatus / the sticky-cancel rule) — the classic "operator
// cancelled mid-turn, then the turn's own failure resurrects the session"
// regression this rule exists to prevent.
// ---------------------------------------------------------------------------

test('forge-poc AT-2 (turnSpec road, sticky-cancel): a CANCELLED session whose turn then throws stays "cancelled" — never rewritten to "failed" — and the throw still propagates', async () => {
  const { forgeRoot, projectArg, sessionId, sessionDir } = setupTurnspecFixture();
  // 'cancelled' is not a row in the fixture's turnSpec.phases table, so
  // runInteractiveTurn throws on it too — one seed serves both purposes:
  // it forces the SDK-free throw AND it IS the on-disk cancelled fact this
  // test is pinning.
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'cancelled' });

  await withCwd(forgeRoot, async () => {
    await assert.rejects(
      () => cmdAgentRun([TURNSPEC_ID, sessionId, '--project', projectArg], forgeRoot),
      /turnSpec\.phases has no row for phase "cancelled"/,
    );
  });

  const status = readStatusJson(sessionDir);
  assert.equal(status.phase, 'cancelled', `a cancelled session must NEVER be resurrected to "failed" — got status.json: ${JSON.stringify(status)}`);
  assert.equal(status.error, undefined, 'a refused sticky-cancel write must not smuggle the error text in some other way');
});

// ---------------------------------------------------------------------------
// Test 3 — negative control: a SUCCESSFUL turn does not write a failed
// phase (proves the try/catch is scoped to the throw path only, not firing
// on every call).
// ---------------------------------------------------------------------------

test('forge-poc AT-3 (turnSpec road, negative control): a successful turn does NOT write a failed phase', async () => {
  const { forgeRoot, projectArg, sessionId, sessionDir } = setupTurnspecFixture();
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'known-phase' });

  await withCwd(forgeRoot, async () => {
    await cmdAgentRun([TURNSPEC_ID, sessionId, '--project', projectArg], forgeRoot);
  });

  const status = readStatusJson(sessionDir);
  assert.notEqual(status.phase, 'failed', `a successful turn must never write phase:"failed" — got status.json: ${JSON.stringify(status)}`);
  assert.equal(status.error, undefined, 'a successful turn must never write an error field');
});

// ---------------------------------------------------------------------------
// Test 4 — legacy AGENT_RUNNERS road parity: the exact same defect, exact
// same fix, on the `architect` entry — proving the fix is NOT scoped only to
// the new turnSpec road (the "enumeration miss" failure mode this WI warns
// about). Uses architect's own real cost-ceiling refusal
// (orchestrator/architect-runner.ts) as a deterministic, SDK-free throw: a
// status.json declaring a tiny costCeilingUsd, with a pre-seeded event log
// already over that ceiling, makes runArchitectTurn throw synchronously
// before any SDK call.
// ---------------------------------------------------------------------------

test('forge-poc AT-4 (legacy AGENT_RUNNERS road, architect): a runArchitectTurn throw (real cost-ceiling refusal) → status.json ends at phase:"failed" carrying the real error text, AND the throw still propagates', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-poc-legacy-'));
  const projectArg = 'legacyproj';
  const projectRoot = join(forgeRoot, 'projects', projectArg);
  const sessionId = '2026-08-23T00-01-00-forgepoc-legacy';
  const sessionDir = join(projectRoot, '_architect', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, {
    session_id: sessionId,
    project: projectArg,
    project_repo_path: projectRoot,
    phase: 'drafting',
    round: 1,
    idea: 'fixture idea',
    costCeilingUsd: 0.01,
  });

  // Pre-seed the session's own event log with spend already over the
  // ceiling — readArchitectSessionStats sums cost_usd across every line.
  const logsRoot = join(forgeRoot, '_logs');
  const logDir = join(logsRoot, `_architect-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    JSON.stringify({
      event_id: 'EV_seed', cycle_id: `_architect-${sessionId}`, initiative_id: `architect-session-${sessionId}`,
      phase: 'architect', skill: 'architect-runner', event_type: 'end', cost_usd: 1.0,
      input_refs: [], output_refs: [], started_at: new Date(0).toISOString(),
    }) + '\n',
  );

  await withCwd(forgeRoot, async () => {
    await assert.rejects(
      () => cmdAgentRun(['architect', sessionId, '--project', projectArg], forgeRoot),
      /architect session cost ceiling reached/,
      'cmdAgentRun must REJECT (rethrow) — the exit code must still reflect the failure',
    );
  });

  const status = readSessionStatus<Status>(sessionDir) ?? {};
  assert.equal(status.phase, 'failed', `expected a terminal failed phase, got status.json: ${JSON.stringify(status)}`);
  assert.ok(
    typeof status.error === 'string' && /architect session cost ceiling reached/.test(status.error),
    `expected status.json.error to carry the real runner error text, got: ${JSON.stringify(status)}`,
  );
});

// Enumeration note (not a separate test): architect / instructions /
// demo-builder / project-brain all share the EXACT SAME cmdAgentRun call
// site (`const runTurn = await entry.loadRunTurn(); try { result = await
// runTurn(...) } catch {...}` — packages/agents/agent-run.ts) — there is only ONE
// try/catch for all four AGENT_RUNNERS entries, not one per runner, so AT-4
// above (architect) exercises the identical mechanism every other
// AGENT_RUNNERS entry rides.
