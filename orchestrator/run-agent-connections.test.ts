/**
 * Acceptance tests for the R3-04-F3 / D9.1 pre-spawn connection-readiness
 * block on `runAgent` (`orchestrator/run-agent.ts`) — DOES NOT EXIST YET.
 * The seam under test (a new `ctx.probeConnection` check, D9.1) does not
 * exist on `run-agent.ts` at branch base, so every "blocked" test below is
 * RED at the ASSERTION level (the module and `runAgent` itself already
 * exist and import cleanly — this is a legitimate case where red comes from
 * a failing behavioural assertion, not a missing module, exactly as the T3
 * brief anticipates for a seam added to an existing file).
 *
 * Style mirrors `orchestrator/run-agent.test.ts` exactly: a REAL shipped
 * roster def (`project-scoped-review`, loaded via `listAgentDefinitions`),
 * cloned in-memory with `runtime.loopStrategy: 'one-shot'` (`oneShotClone`)
 * so `deriveAgentSpec` still reads real allowedTools/model off disk, and a
 * `capturingQueryFn` so no real SDK call is ever made.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED (ratify or redirect —
 * full list in the T3 final report):
 *
 *  D-A. `RunContext` gains an optional field `probeConnection?: (id: string,
 *       kind: 'tool' | 'mcp') => ProbeResult` — TEST-INJECTION ONLY, mirrors
 *       the ALREADY-SHIPPED `ctx.queryFn` seam exactly (`ctx.queryFn ??
 *       pinnedStreamQuery`). Production omits it; the default is the REAL
 *       per-connection prober (`probeConnection` from
 *       `./studio/connection-probe.ts`) against `FORGE_ROOT`'s catalog. This
 *       file injects a fake for every "blocked/unblocked" scenario so no
 *       test here ever spawns a real probe child (that is
 *       `connection-probe.test.ts`'s job, per D4) — EXCEPT the "no bound
 *       connections" test, which deliberately omits the injection to prove
 *       the production default path is a true no-op fast path (an agent
 *       with empty `composition.tools`/`composition.mcps` never probes
 *       anything, so it is safe to exercise for real, no mocking needed).
 *  D-B. AMENDED by T2 ruling (round 2, item 4 — the "out of scope" read in
 *       D-B's original text below was REJECTED): the gate covers BOTH
 *       lifecycles, uniform semantics — "no real spawn ⇒ no environment
 *       gate":
 *         - lifecycle 'self': gate runs AFTER the dry-bridge /
 *           `FORGE_ARCHITECT_NO_SPAWN` suppression early-return (unchanged
 *           from the original D9.1 placement) — proven by the "suppressed
 *           run is NOT blocked" tests below, under EITHER suppression env
 *           var independently.
 *         - lifecycle 'caller': gate runs at the TOP of the caller branch,
 *           but is SKIPPED when `FORGE_DRY_BRIDGE=1` OR
 *           `FORGE_ARCHITECT_NO_SPAWN=1`. Skipping the gate does NOT change
 *           whether the underlying one-shot spawn itself proceeds — caller
 *           lifecycle has ALWAYS unconditionally called `queryFn` regardless
 *           of these env vars.
 *
 *           RATIFIED by T2 (round 2, follow-up ruling, binding): "under
 *           FORGE_DRY_BRIDGE=1 / FORGE_ARCHITECT_NO_SPAWN=1 the
 *           caller-lifecycle path skips ONLY the new connection-readiness
 *           gate; the underlying spawn behaviour is left exactly as it is
 *           today." Rationale (T2, verbatim): runAgent's own contract
 *           already says "In caller mode the caller also owns
 *           harness-safety" — the phase pipelines suppress at their own
 *           level, and runAgent deliberately does not suppress for them.
 *           Making caller-lifecycle also skip the real spawn would be a
 *           behaviour change to four shipped phase bindings (PM/reflector/
 *           demo-agent/adversarial-review), smuggled in under an unrelated
 *           feature — out of scope, and exactly the kind of silent semantic
 *           drift this campaign rejects. So: does-not-throw AND
 *           queryFn-still-called-once (asserted below) is the CORRECT,
 *           LOCKED pin — not a placeholder pending a stronger
 *           implementation.
 *  D-C. Thrown error message MUST name the component id AND its state
 *       (D9's literal AC: "Agent not ready" is a failure of this AC) —
 *       asserted via substring matches on both, not a generic pattern.
 *  D-D. T2-mandated AT (round 2, item 2): a test that supplies NO
 *       `probeConnection` override at all, using the REAL production
 *       default prober against a REAL curated connection id ("sqlite" — a
 *       shipped MCP entry once WI-1 lands) that is genuinely not installed
 *       in THIS test environment (no `@modelcontextprotocol/server-sqlite`
 *       under any connections root here) — proving the default wiring
 *       itself, not just the injection seam. This is deliberately the
 *       SLOWEST/most "real" test in this file; every other test here
 *       injects a fake specifically so it does not have to be.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';
import type { ProbeResult } from './studio/connection-probe.ts';

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
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def!;
}

/** Mirrors run-agent.test.ts's oneShotClone, plus a composition override so
 *  this file can bind arbitrary tools/mcps ids without touching the real
 *  SKILL.md fixture on disk. */
function oneShotCloneWithConnections(
  def: AgentDefinition,
  opts: { tools?: string[]; mcps?: string[]; budgets?: AgentDefinition['budgets'] } = {},
): AgentDefinition {
  return {
    ...def,
    runtime: { ...def.runtime, loopStrategy: 'one-shot' },
    composition: { ...def.composition, tools: opts.tools ?? [], mcps: opts.mcps ?? [] },
    budgets: opts.budgets ?? {},
  };
}

function capturingQueryFn(calls: Array<{ prompt: string; options: Record<string, unknown> }>): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 10, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

const NOT_INSTALLED: ProbeResult = { state: 'not-installed' };
const MISCONFIGURED: ProbeResult = { state: 'misconfigured', exitCode: 1, missingConfig: ['GITHUB_TOKEN'] };
const AVAILABLE: ProbeResult = { state: 'available' };

// ---------------------------------------------------------------------------

test('runAgent pre-spawn block: refuses when a bound tool connection is not-installed, naming the component and its state', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-block-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { tools: ['git'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '_agent-conn-block-test',
          workdir,
          prompt: 'p',
          logsRoot,
          queryFn: capturingQueryFn(calls),
          probeConnection: (id: string) => (id === 'git' ? NOT_INSTALLED : AVAILABLE),
        } as Parameters<typeof runAgent>[1]),
      (err: Error) => {
        assert.match(err.message, /git/, 'the thrown error must NAME the unready component');
        assert.match(err.message, /not-installed/, 'the thrown error must NAME the component\'s state (D9 — "Agent not ready" alone is a failure)');
        return true;
      },
    );
    assert.equal(calls.length, 0, 'the SDK must NEVER be invoked when a bound connection is not ready — this is a PRE-spawn block');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent pre-spawn block: refuses when a bound mcp connection is misconfigured, naming the component and its state', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-block-2-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { mcps: ['github'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '_agent-conn-block-2-test',
          workdir,
          prompt: 'p',
          logsRoot,
          queryFn: capturingQueryFn(calls),
          probeConnection: () => MISCONFIGURED,
        } as Parameters<typeof runAgent>[1]),
      (err: Error) => {
        assert.match(err.message, /github/);
        assert.match(err.message, /misconfigured/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent pre-spawn block: an agent whose bound connections are ALL available is NOT blocked', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-ok-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { tools: ['git'], mcps: ['sqlite'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId: '_agent-conn-ok-test',
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: capturingQueryFn(calls),
      probeConnection: () => AVAILABLE,
    } as Parameters<typeof runAgent>[1]);

    assert.equal(calls.length, 1, 'the SDK must be invoked once every bound connection is available');
    assert.equal(result.suppressed, false);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent pre-spawn block: an agent with NO bound tools/mcps is never blocked, and never probes anything (real production default, no injection)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-empty-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    // no tools/mcps overrides ⇒ empty composition.tools/mcps ⇒ the fast path
    // must never even consult a prober, real or injected — safe to run with
    // NO probeConnection override, exercising the true production default.
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'));
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId: '_agent-conn-empty-test',
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: capturingQueryFn(calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(result.suppressed, false);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Self-lifecycle suppression, BOTH env vars independently (T2 ruling round 2,
// item 3b/4: honour FORGE_DRY_BRIDGE=1 as well as FORGE_ARCHITECT_NO_SPAWN=1
// — "same as orchestrator/run-agent.ts does" for its own existing dry-bridge
// check).
// ---------------------------------------------------------------------------

async function assertSelfLifecycleSuppressedNotBlocked(envVar: 'FORGE_ARCHITECT_NO_SPAWN' | 'FORGE_DRY_BRIDGE'): Promise<void> {
  const scratchRoot = mkdtempSync(join(tmpdir(), `forge-run-agent-conn-suppressed-${envVar}-`));
  const prior = process.env[envVar];
  try {
    process.env[envVar] = '1';
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { tools: ['git'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const throwingQueryFn: StreamQueryFn = ((() => {
      throw new Error('the SDK must never be invoked under suppression regardless of connection readiness');
    }) as unknown) as StreamQueryFn;

    const result = await runAgent(def, {
      runId: `_agent-conn-suppressed-${envVar}-test`,
      workdir,
      prompt: 'p',
      logsRoot,
      queryFn: throwingQueryFn,
      // Deliberately reports the bound connection as UNREADY — proving the
      // suppression early-return happens BEFORE the connection check runs
      // at all (D9.1's literal placement instruction), not merely that
      // suppression "wins" by some other coincidence.
      probeConnection: () => NOT_INSTALLED,
    } as Parameters<typeof runAgent>[1]);

    assert.equal(result.suppressed, true, `a ${envVar}=1 suppressed run must resolve normally, never throw, regardless of connection readiness`);
  } finally {
    if (prior === undefined) delete process.env[envVar];
    else process.env[envVar] = prior;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

test('runAgent pre-spawn block (self lifecycle): a FORGE_ARCHITECT_NO_SPAWN=1 SUPPRESSED run is NOT blocked, even with an unready bound connection (D9.1 ordering)', async () => {
  await assertSelfLifecycleSuppressedNotBlocked('FORGE_ARCHITECT_NO_SPAWN');
});

test('runAgent pre-spawn block (self lifecycle): a FORGE_DRY_BRIDGE=1 SUPPRESSED run is NOT blocked, even with an unready bound connection (D9.1 ordering, T2 ruling 3b)', async () => {
  await assertSelfLifecycleSuppressedNotBlocked('FORGE_DRY_BRIDGE');
});

// ---------------------------------------------------------------------------
// T2 ruling round 2, item 4 (REJECTED as scoped): the gate covers BOTH
// lifecycles. lifecycle:'caller' gets the SAME connection-readiness gate.
//
// AMENDED round 6, item 1 — T2's own round-2/round-4 ruling was WRONG, and
// this file used to pin the wrong behaviour as correct (the campaign's
// `AT-pins-the-defect` pattern, caught by adversarial review): the premise
// "no real spawn ⇒ no environment gate" does NOT hold for the 'caller'
// lifecycle. On that branch `runOneShotSpawn` is called UNCONDITIONALLY —
// `FORGE_DRY_BRIDGE`/`FORGE_ARCHITECT_NO_SPAWN` never suppress it there (the
// module's own doc: "In caller mode the caller also owns harness-safety" —
// runAgent never suppresses FOR that path; the phase pipelines that use
// 'caller' lifecycle are responsible for their own suppression, at their own
// level, before ever calling runAgent). So on 'caller', unlike 'self',
// nothing is ever actually suppressed by these env vars — which means the
// readiness gate must apply UNCONDITIONALLY on 'caller': skipping it under
// an env var that does not actually stop the spawn would let a REAL spawn
// through with an unready bound connection, silently. The correct, uniform
// rule (restated so nobody re-derives the round-2/4 mistake): **the gate is
// skipped exactly when the spawn is actually suppressed — and on the caller
// branch, it never is.**
// ---------------------------------------------------------------------------

test('runAgent pre-spawn block (caller lifecycle): refuses when a bound connection is not ready, naming the component and its state (no suppression env set)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-caller-block-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { mcps: ['sqlite'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '',
          workdir,
          prompt: 'p',
          lifecycle: 'caller',
          queryFn: capturingQueryFn(calls),
          probeConnection: () => NOT_INSTALLED,
        } as Parameters<typeof runAgent>[1]),
      (err: Error) => {
        assert.match(err.message, /sqlite/);
        assert.match(err.message, /not-installed/);
        return true;
      },
    );
    assert.equal(calls.length, 0, 'caller lifecycle must also be gated PRE-spawn — the SDK must never be invoked when a bound connection is not ready');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

async function assertCallerLifecycleStillBlockedUnderEnv(envVar: 'FORGE_ARCHITECT_NO_SPAWN' | 'FORGE_DRY_BRIDGE'): Promise<void> {
  const scratchRoot = mkdtempSync(join(tmpdir(), `forge-run-agent-conn-caller-still-blocked-${envVar}-`));
  const prior = process.env[envVar];
  try {
    process.env[envVar] = '1';
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { mcps: ['sqlite'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '',
          workdir,
          prompt: 'p',
          lifecycle: 'caller',
          queryFn: capturingQueryFn(calls),
          probeConnection: () => NOT_INSTALLED,
        } as Parameters<typeof runAgent>[1]),
      (err: Error) => {
        assert.match(err.message, /sqlite/, 'the caller-lifecycle refusal must still name the component even under a suppression env var');
        assert.match(err.message, /not-installed/);
        return true;
      },
      `${envVar}=1 must NOT skip the caller-lifecycle gate — that env var does not actually suppress anything on this branch (runOneShotSpawn is unconditional here), so skipping the gate would let a real spawn through unready`,
    );
    assert.equal(calls.length, 0, `the SDK must never be invoked — ${envVar}=1 does not suppress the caller-lifecycle spawn, so the gate must still catch it PRE-spawn`);
  } finally {
    if (prior === undefined) delete process.env[envVar];
    else process.env[envVar] = prior;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

test('runAgent pre-spawn block (caller lifecycle): STILL BLOCKED under FORGE_ARCHITECT_NO_SPAWN=1 — nothing is actually suppressed on this branch (round-6 fix: round-2/4 had this backwards)', async () => {
  await assertCallerLifecycleStillBlockedUnderEnv('FORGE_ARCHITECT_NO_SPAWN');
});

test('runAgent pre-spawn block (caller lifecycle): STILL BLOCKED under FORGE_DRY_BRIDGE=1 — nothing is actually suppressed on this branch (round-6 fix: round-2/4 had this backwards)', async () => {
  await assertCallerLifecycleStillBlockedUnderEnv('FORGE_DRY_BRIDGE');
});

test('runAgent pre-spawn block (caller lifecycle): a READY agent (all bound connections available) is NOT blocked — still spawns for real', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-caller-ready-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { mcps: ['sqlite'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      queryFn: capturingQueryFn(calls),
      probeConnection: () => AVAILABLE,
    } as Parameters<typeof runAgent>[1]);

    assert.equal(calls.length, 1, 'a ready caller-lifecycle agent must still spawn — the gate must never produce a false positive');
    assert.equal(result.suppressed, false);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T2-mandated AT (round 2, item 2 — D-D above): NO probeConnection override
// at all. Drives the REAL production default prober against a REAL curated
// connection id ("sqlite") that is genuinely not-installed in this test
// environment. If the real default prober is never wired to runAgent (an
// optional injection point nobody calls in production is this campaign's
// single most repeated defect, per T2), this test fails to reject at all —
// unlike every other "blocked" test in this file, it cannot be satisfied by
// merely wiring the injection seam.
// ---------------------------------------------------------------------------

test('runAgent pre-spawn block: REAL production default (no probeConnection injection) refuses for a real curated MCP id genuinely not installed in this environment', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-conn-real-default-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotCloneWithConnections(getFixtureDef(defs, 'project-scoped-review'), { mcps: ['sqlite'] });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      () =>
        runAgent(def, {
          runId: '_agent-conn-real-default-test',
          workdir,
          prompt: 'p',
          logsRoot,
          queryFn: capturingQueryFn(calls),
          // NO probeConnection here — this is the whole point of the AT.
        }),
      (err: Error) => {
        assert.match(err.message, /sqlite/, 'the real default prober must name the real curated connection id');
        assert.match(err.message, /not-installed/, 'sqlite is not installed under any connections root in this test environment — the real prober must report it honestly');
        return true;
      },
    );
    assert.equal(calls.length, 0, 'the SDK must never be invoked when the REAL default prober reports the bound connection not-installed');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
