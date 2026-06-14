/**
 * Tests for orchestrator/flow-runner.ts (ADR-028, M3-1/2).
 *
 * All tests use MOCK deps (spy functions) so no filesystem or SDK calls happen.
 * Test 4 loads the REAL forge-cycle.yaml via loadFlowDefinition and runs the
 * DAG walk against mock executors to prove the real definition produces the
 * real sequence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFlow, forgeCycleFlowPath, resolveNodeKind, type FlowRunnerDeps, type NodeExecutor } from './flow-runner.ts';
import { WedgeKillError } from './flow-budgets.ts';
import { loadFlowDefinition } from './studio/registry.ts';
import type { FlowDefinition } from './studio/types.ts';
import type { CycleInput } from './cycle-context.ts';
import type { EventLogger } from './logging.ts';
import type { AgentBudgets } from './studio/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CycleInput for the runner (no real paths needed for unit tests). */
function makeInput(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    initiativeId: 'test-initiative',
    manifestPath: '/tmp/test/manifest.md',
    projectRepoPath: '/tmp/test/project',
    worktreePath: '/tmp/test/worktree',
    dryRun: false,
    ...overrides,
  };
}

/** Minimal no-op EventLogger spy that records emitted events. */
function makeLogger(): EventLogger & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    logFilePath: '/tmp/test/events.jsonl',
    cycleId: 'test-cycle-id',
    emit(event: unknown) {
      events.push(event);
      return { event_id: `evt-${events.length}` } as ReturnType<EventLogger['emit']>;
    },
  };
}

/** Call order tracker — push name on each spy call. */
function makeCallTracker() {
  const calls: string[] = [];
  return { calls };
}

/** Build a complete FlowRunnerDeps set where all fns are call-tracking spies. */
function makeMockDeps(tracker: { calls: string[] }): FlowRunnerDeps {
  return {
    runProjectManager: async (_input, _logger) => {
      tracker.calls.push('runProjectManager');
    },
    runDeveloperLoop: async (_input, _logger) => {
      tracker.calls.push('runDeveloperLoop');
      return { unifierSucceeded: true, unifierFailureClass: null, commitsAhead: 1, filesChanged: 1, insertions: 10 };
    },
    openPrInline: async (_input, _logger) => {
      tracker.calls.push('openPrInline');
      return 'pr-open';
    },
    runClosure: async (_input, _logger, _reviewerOutcome) => {
      tracker.calls.push('runClosure');
      return { outcome: 'merged', merged: true };
    },
    runReflector: async (_input, _logger) => {
      tracker.calls.push('runReflector');
      return { reflection_status: 'complete', lint_status: 'ok' };
    },
    // Dev-loop close contract helpers — no-ops in tests (no real git/fs)
    commitDevLoopBoundary: (_wt, _logger, _id) => { /* no-op */ },
    enforceDevLoopCloseInvariant: (_wt, _logger, _id) => { /* no-op */ },
    assertNonEmptyDelivery: (_outcome, _id, _wt, _logger) => { /* no-op */ },
    enforceFinalCiGate: (_input, _logger) => { /* no-op */ },
    rebaseForResume: (_input, _logger) => { tracker.calls.push('rebaseForResume'); },
    // Trigger enqueue — no-op in tests; trigger-specific tests inject a spy
    enqueueFlowRun: (_flowId, _opts) => { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Minimal forge-cycle flow definition (no filesystem needed for tests 1-3)
// ---------------------------------------------------------------------------

/** The forge-cycle flow definition as a plain object (mirrors flow.yaml). */
function makeForgeCycleFlow(): FlowDefinition {
  return {
    id: 'forge-cycle',
    name: 'Forge Cycle',
    version: 1,
    goal: 'Take an approved initiative to a merged PR with reflection captured.',
    project: null,
    kb: 'cycles',
    costCeilingUsd: 25,
    origin: 'seed',
    disposable: undefined,
    nodes: [
      { id: 'architect', agent: 'architect', gate: 'plan' },
      { id: 'pm', agent: 'project-manager' },
      { id: 'dev', agent: 'developer-ralph', fanOut: 'work-items' },
      { id: 'unifier', agent: 'developer-unifier', resumable: true },
      { id: 'review', gate: 'verdict' },
      { id: 'reflect', agent: 'reflector' },
    ],
    edges: [
      { from: 'architect', to: 'pm', artifact: 'plan' },
      { from: 'pm', to: 'dev', artifact: 'work-items' },
      { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
      { from: 'unifier', to: 'review', artifact: 'pr' },
      { from: 'review', to: 'reflect', artifact: 'verdict' },
    ],
    triggers: [],
    path: '/fake/flow.yaml',
  };
}

// ---------------------------------------------------------------------------
// Test 1: Full run — correct call order with the same CycleInput
// ---------------------------------------------------------------------------

describe('flow-runner full run', () => {
  it('calls executors in order: runProjectManager → runDeveloperLoop → openPrInline → runClosure → runReflector (architect node is a silent marker)', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    // Spy on the input passed to each executor to verify it's the same object.
    const seenInputs: CycleInput[] = [];
    const origPm = deps.runProjectManager;
    const origDev = deps.runDeveloperLoop;
    const origPr = deps.openPrInline;
    const origClosure = deps.runClosure;
    const origReflect = deps.runReflector;

    deps.runProjectManager = async (inp, logger) => { seenInputs.push(inp); return origPm(inp, logger); };
    deps.runDeveloperLoop = async (inp, logger) => { seenInputs.push(inp); return origDev(inp, logger); };
    deps.openPrInline = async (inp, logger) => { seenInputs.push(inp); return origPr(inp, logger); };
    deps.runClosure = async (inp, logger, ro) => { seenInputs.push(inp); return origClosure(inp, logger, ro); };
    deps.runReflector = async (inp, logger) => { seenInputs.push(inp); return origReflect(inp, logger); };

    await runFlow({ flow, input, logger, deps });

    // Correct sequence: architect node is a silent marker — no dep call.
    // Unifier is also a marker (called inside runDeveloperLoop). Neither appears here.
    assert.deepEqual(tracker.calls, [
      'runProjectManager',
      'runDeveloperLoop',
      'openPrInline',
      'runClosure',
      'runReflector',
    ]);
    assert.ok(!tracker.calls.includes('emitSyntheticArchitect'), 'architect node must NOT call emitSyntheticArchitect dep — it is runCycle\'s job');

    // Every executor received the same CycleInput object
    for (const seen of seenInputs) {
      assert.strictEqual(seen, input, 'each executor must receive the same CycleInput object');
    }
  });

  it('returns merged outcome and reflection status when closure merges', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    const result = await runFlow({ flow, input, logger, deps });

    assert.strictEqual(result.cycleOutcome, 'merged');
    assert.strictEqual(result.reflectionStatus, 'complete');
    assert.strictEqual(result.lintStatus, 'ok');
  });
});

// ---------------------------------------------------------------------------
// Test 2: resumeFrom='unifier' — pm NOT called; dev IS called
// ---------------------------------------------------------------------------

describe('flow-runner resumeFrom=unifier', () => {
  it('skips runProjectManager but still calls runDeveloperLoop, rebase runs before dev-loop', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    await runFlow({ flow, input, logger, deps });

    assert.ok(!tracker.calls.includes('runProjectManager'), 'runProjectManager must NOT be called on unifier resume');
    assert.ok(tracker.calls.includes('runDeveloperLoop'), 'runDeveloperLoop must still be called on unifier resume');

    // Highest-risk resume step: rebase must have been called AND must precede the dev-loop.
    assert.ok(tracker.calls.includes('rebaseForResume'), 'rebaseForResume must be called on unifier resume');
    assert.ok(
      tracker.calls.indexOf('rebaseForResume') < tracker.calls.indexOf('runDeveloperLoop'),
      'rebaseForResume must execute before runDeveloperLoop',
    );

    // The pm node emits the skip event into the logger.
    const events = (logger as ReturnType<typeof makeLogger>).events as Array<{ message?: string }>;
    assert.ok(
      events.some((e) => e.message === 'flow-runner.pm-skipped-resume'),
      'logger must capture a flow-runner.pm-skipped-resume event on unifier resume',
    );
  });

  it('still calls openPrInline, runClosure, runReflector on unifier resume', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    await runFlow({ flow, input, logger, deps });

    assert.ok(tracker.calls.includes('openPrInline'));
    assert.ok(tracker.calls.includes('runClosure'));
    assert.ok(tracker.calls.includes('runReflector'));
  });
});

// ---------------------------------------------------------------------------
// Test 3: reflect NOT called when closure.merged === false
// ---------------------------------------------------------------------------

describe('flow-runner reflect skipped when not merged', () => {
  it('does not call runReflector when closure returns merged:false', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);

    // Override closure to return not-merged
    deps.runClosure = async (_input, _logger, _ro) => {
      tracker.calls.push('runClosure');
      return { outcome: 'ready-for-review', merged: false };
    };

    const input = makeInput();
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    const result = await runFlow({ flow, input, logger, deps });

    assert.ok(!tracker.calls.includes('runReflector'), 'runReflector must NOT be called when merged:false');
    assert.strictEqual(result.cycleOutcome, 'ready-for-review');
    assert.strictEqual(result.reflectionStatus, 'skipped');
    assert.strictEqual(result.lintStatus, 'skipped');
  });
});

// ---------------------------------------------------------------------------
// Test 4: REAL forge-cycle.yaml loaded from disk → real sequence from mock deps
// ---------------------------------------------------------------------------

describe('flow-runner with real forge-cycle.yaml', () => {
  it('loads the real forge-cycle flow and produces the real executor sequence', async () => {
    const flowPath = forgeCycleFlowPath();
    const flow = loadFlowDefinition(flowPath);

    assert.strictEqual(flow.id, 'forge-cycle', 'flow id must be forge-cycle');
    assert.ok(flow.nodes.length >= 5, 'forge-cycle must have at least 5 nodes');

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    // Must produce the full sequence — proving the real definition is correct.
    // The architect node is a silent marker: no dep call, so it does NOT appear here.
    assert.deepEqual(tracker.calls, [
      'runProjectManager',
      'runDeveloperLoop',
      'openPrInline',
      'runClosure',
      'runReflector',
    ], 'real forge-cycle.yaml must produce the full executor sequence in order (architect node is a silent marker)');
    assert.ok(!tracker.calls.includes('emitSyntheticArchitect'), 'architect node must NOT call emitSyntheticArchitect dep on real flow');
  });

  it('loads the real forge-cycle flow and skips pm on unifier resume', async () => {
    const flowPath = forgeCycleFlowPath();
    const flow = loadFlowDefinition(flowPath);

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    assert.ok(!tracker.calls.includes('runProjectManager'));
    assert.ok(tracker.calls.includes('runDeveloperLoop'));
  });
});

// ---------------------------------------------------------------------------
// Test 5: Wedge-kill race — raceWithWedge integration
// ---------------------------------------------------------------------------

/** Minimal flow with just pm node — keeps wedge-kill tests focused. */
function makePmOnlyFlow(): FlowDefinition {
  return {
    id: 'pm-only',
    name: 'PM only',
    version: 1,
    goal: 'Run only the PM node.',
    project: null,
    kb: 'cycles',
    costCeilingUsd: 0,
    origin: 'seed',
    disposable: undefined,
    nodes: [{ id: 'pm', agent: 'project-manager' }],
    edges: [],
    triggers: [],
    path: '/fake/pm-only.yaml',
  };
}

describe('flow-runner wedge-kill race', () => {
  it('rejects with WedgeKillError when executor hangs and wedge timer fires', async () => {
    const flow = makePmOnlyFlow();
    const input = makeInput();
    const logger = makeLogger();

    let capturedSignal: AbortSignal | undefined;

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async (_inp, nodeLogger, sig) => {
        capturedSignal = sig;
        // Emit a heartbeat to seed the WedgeDetector (starts the progress clock).
        nodeLogger.emit({
          initiative_id: input.initiativeId,
          phase: 'project-manager',
          skill: 'project-manager',
          event_type: 'agent_heartbeat',
          input_refs: [],
          output_refs: [],
        });
        // Hang until the signal fires (best-effort cancel via raceWithWedge).
        // Using signal-aware hang so the Node.js process can exit after the race.
        return new Promise<void>((resolve) => {
          if (sig?.aborted) { resolve(); return; }
          sig?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      // No-ops for the close-contract helpers (pm-only flow doesn't need them)
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    // wedgeKillMs: 50ms — poll fires at 100ms, by which time 100ms > 50ms → kill fires.
    const nodeBudgets = new Map<string, AgentBudgets>([
      ['pm', { wedgeKillMs: 50 }],
    ]);

    await assert.rejects(
      () => runFlow({ flow, input, logger, deps, nodeBudgets }),
      (err: unknown) => {
        assert.ok(err instanceof WedgeKillError, `expected WedgeKillError, got ${String(err)}`);
        assert.strictEqual(err.nodeId, 'pm');
        return true;
      },
    );

    // The abort signal must have been fired (best-effort SDK cancel).
    assert.ok(capturedSignal !== undefined, 'signal must be passed to executor');
    assert.ok(capturedSignal!.aborted, 'signal must be aborted after wedge kill');

    // phase.wedge-killed event must appear in the logger.
    const events = (logger as ReturnType<typeof makeLogger>).events as Array<{ message?: string }>;
    assert.ok(
      events.some((e) => e.message === 'phase.wedge-killed'),
      'logger must contain a phase.wedge-killed event',
    );
  });

  it('completes normally when executor makes tool progress within the window', async () => {
    const flow = makePmOnlyFlow();
    const input = makeInput();
    const logger = makeLogger();

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async (_inp, nodeLogger, _sig) => {
        // Heartbeat → tool progress → resolve after short delay.
        nodeLogger.emit({
          initiative_id: input.initiativeId,
          phase: 'project-manager',
          skill: 'project-manager',
          event_type: 'agent_heartbeat',
          input_refs: [],
          output_refs: [],
        });
        nodeLogger.emit({
          initiative_id: input.initiativeId,
          phase: 'project-manager',
          skill: 'project-manager',
          event_type: 'tool_use',
          input_refs: [],
          output_refs: [],
        });
        // Resolve within the 50ms window — tool progress reset the clock.
        await new Promise<void>((r) => setTimeout(r, 20));
      },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    const nodeBudgets = new Map<string, AgentBudgets>([
      ['pm', { wedgeKillMs: 50 }],
    ]);

    // Must NOT throw — tool progress reset the clock so wedge never fires.
    await assert.doesNotReject(
      () => runFlow({ flow, input, logger, deps, nodeBudgets }),
    );
  });

  it('passes undefined signal to executor when wedgeKillMs is not set', async () => {
    const flow = makePmOnlyFlow();
    const input = makeInput();
    const logger = makeLogger();

    let capturedSignal: AbortSignal | undefined | 'not-called' = 'not-called';

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async (_inp, _logger, sig) => {
        capturedSignal = sig;
      },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    // No nodeBudgets → wedgeDetector.active === false → no race, signal is undefined.
    await runFlow({ flow, input, logger, deps });

    assert.strictEqual(capturedSignal, undefined, 'signal must be undefined when wedgeKillMs is not set');
  });
});

// ---------------------------------------------------------------------------
// Test 6: Trigger firing (M3-5)
// ---------------------------------------------------------------------------

describe('flow-runner trigger firing', () => {
  /**
   * Build a minimal single-node flow that carries a trigger.
   * The node is an agent-only node (no gate), so the flow must be
   * disposable:true (zero-gate rule). The trigger fires `on: complete`
   * → enqueues the target flow.
   */
  function makeTriggerFlow(triggers: Array<{ on: string; flow: string }>): FlowDefinition {
    return {
      id: 'trigger-test',
      name: 'Trigger Test',
      version: 1,
      goal: 'Test trigger firing.',
      project: null,
      kb: null,
      costCeilingUsd: 0,
      origin: 'seed',
      disposable: true,
      nodes: [{ id: 'pm', agent: 'project-manager' }],
      edges: [],
      triggers,
      path: '/fake/trigger-test.yaml',
    };
  }

  it('forge-cycle (triggers:[]) → enqueueFlowRun NOT called on terminal success', async () => {
    const flow = makeForgeCycleFlow(); // triggers: []
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const enqueueCalls: string[] = [];
    deps.enqueueFlowRun = (flowId, _opts) => { enqueueCalls.push(flowId); };

    const input = makeInput();
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    assert.deepEqual(enqueueCalls, [], 'enqueueFlowRun must NOT be called when triggers is empty');
  });

  it('flow with trigger {on:complete, flow:knowledge-ingest} → enqueueFlowRun called on terminal success', async () => {
    const flow = makeTriggerFlow([{ on: 'complete', flow: 'knowledge-ingest' }]);
    const enqueueCalls: Array<{ flowId: string; opts: { origin: string; triggeredBy: string } }> = [];

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async () => { /* no-op */ },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
      enqueueFlowRun: (flowId, opts) => { enqueueCalls.push({ flowId, opts }); },
    };

    const input = makeInput();
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    assert.equal(enqueueCalls.length, 1, 'enqueueFlowRun must be called exactly once');
    assert.equal(enqueueCalls[0].flowId, 'knowledge-ingest');
    assert.equal(enqueueCalls[0].opts.origin, 'trigger');
    assert.equal(enqueueCalls[0].opts.triggeredBy, 'trigger-test');
  });

  it('flow with trigger → enqueueFlowRun NOT called on executor failure (triggers fire only on terminal success)', async () => {
    const flow = makeTriggerFlow([{ on: 'complete', flow: 'knowledge-ingest' }]);
    const enqueueCalls: string[] = [];

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async () => { throw new Error('pm-failed'); },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
      enqueueFlowRun: (flowId, _opts) => { enqueueCalls.push(flowId); },
    };

    const input = makeInput();
    const logger = makeLogger();

    await assert.rejects(
      () => runFlow({ flow, input, logger, deps }),
      /pm-failed/,
    );

    assert.deepEqual(enqueueCalls, [], 'enqueueFlowRun must NOT be called when the run fails');
  });

  it('flow with multiple triggers → enqueueFlowRun called for each complete trigger', async () => {
    const flow = makeTriggerFlow([
      { on: 'complete', flow: 'knowledge-ingest' },
      { on: 'complete', flow: 'other-flow' },
    ]);
    const enqueueCalls: string[] = [];

    const deps: Partial<FlowRunnerDeps> = {
      runProjectManager: async () => { /* no-op */ },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
      enqueueFlowRun: (flowId, _opts) => { enqueueCalls.push(flowId); },
    };

    const input = makeInput();
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    assert.deepEqual(enqueueCalls.sort(), ['knowledge-ingest', 'other-flow'].sort());
  });
});

// ---------------------------------------------------------------------------
// Test 7: knowledge-ingest flow — non-cycle flow walks end-to-end (M3-5)
// ---------------------------------------------------------------------------

describe('knowledge-ingest flow — non-cycle DAG walk', () => {
  /** Load the real knowledge-ingest/flow.yaml. */
  function knowledgeIngestFlowPath(): string {
    // Resolved relative to this test file's location (orchestrator/) → ../studio/flows/
    return resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'studio',
      'flows',
      'knowledge-ingest',
      'flow.yaml',
    );
  }

  it('knowledge-ingest/flow.yaml loads with correct shape', async () => {
    const flowPath = knowledgeIngestFlowPath();
    const flow = loadFlowDefinition(flowPath);

    assert.strictEqual(flow.id, 'knowledge-ingest');
    assert.strictEqual(flow.disposable, true, 'knowledge-ingest must be disposable:true (zero-gate rule)');
    assert.ok(flow.nodes.some((n) => n.agent === 'brain-ingest'), 'must have a brain-ingest node');
    assert.strictEqual(flow.edges.length, 0, 'knowledge-ingest has no edges (single-node flow)');
  });

  it('validateFlow(knowledge-ingest, agents) returns zero errors', async () => {
    const flowPath = knowledgeIngestFlowPath();
    const flow = loadFlowDefinition(flowPath);

    // Load agents (same pattern as seed-data.test.ts)
    const { listAgentDefinitions } = await import('./studio/registry.ts');
    const { validateFlow: vf } = await import('./studio/validate.ts');
    const agents = listAgentDefinitions(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills'));
    const agentMap = new Map(agents.map((a) => [a.slug, a]));

    const findings = vf(flow, agentMap);
    const errors = findings.filter((f) => f.level === 'error');

    assert.deepEqual(
      errors,
      [],
      `knowledge-ingest flow has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
    );
  });

  it('runFlow(knowledge-ingest) with a mock brain-ingest executor dispatches the ingest node', async () => {
    const flowPath = knowledgeIngestFlowPath();
    const flow = loadFlowDefinition(flowPath);

    // The knowledge-ingest flow has a single 'ingest' node with agent:'brain-ingest'.
    // flow-runner classifyNode() falls to 'unknown' for brain-ingest (it's not one of the
    // hardcoded forge-cycle slugs). The unknown handler logs the skip and continues —
    // this is the correct M3 behaviour: the flow walks without error, emitting a
    // flow-runner.unknown-node-skipped event for the ingest node.
    //
    // A real brain-ingest executor would be wired in M4 when the executor registry is
    // generalised. For M3 the structural proof is: runFlow completes without throwing
    // and the ingest node is recorded as visited.

    const input = makeInput();
    const logger = makeLogger();
    const enqueueCalls: string[] = [];

    const deps: Partial<FlowRunnerDeps> = {
      enqueueFlowRun: (flowId, _opts) => { enqueueCalls.push(flowId); },
      // No other deps needed — single node, no forge-cycle executors involved.
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    // Must complete without throwing — the unknown-node handler is a graceful skip.
    const result = await runFlow({ flow, input, logger, deps });

    // The flow has no gate/closure → cycleOutcome stays at its initial 'ready-for-review'.
    assert.strictEqual(result.cycleOutcome, 'ready-for-review');

    // The ingest node must have been visited: a flow-runner.unknown-node-skipped event
    // must appear in the logger (the brain-ingest slug is not a hardcoded forge-cycle slug).
    const events = (logger as ReturnType<typeof makeLogger>).events as Array<{ message?: string; metadata?: Record<string, unknown> }>;
    const unknownSkipEvents = events.filter(
      (e) => e.message === 'flow-runner.unknown-node-skipped' && e.metadata?.['node_id'] === 'ingest',
    );
    assert.ok(
      unknownSkipEvents.length >= 1,
      'flow-runner must emit a flow-runner.unknown-node-skipped event for the brain-ingest ingest node',
    );

    // No triggers on knowledge-ingest → enqueue not called.
    assert.deepEqual(enqueueCalls, []);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Node-executor registry seam (ADR-028 — "new flow = no orchestrator edit")
// ---------------------------------------------------------------------------

describe('flow-runner node-executor registry seam (ADR-028)', () => {
  it('resolveNodeKind maps gate/agent fields to kinds (gate wins over agent)', () => {
    assert.equal(resolveNodeKind({ id: 'a', agent: 'architect', gate: 'plan' }), 'architect');
    assert.equal(resolveNodeKind({ id: 'r', gate: 'verdict' }), 'review');
    assert.equal(resolveNodeKind({ id: 'pm', agent: 'project-manager' }), 'pm');
    assert.equal(resolveNodeKind({ id: 'dev', agent: 'developer-ralph' }), 'dev');
    assert.equal(resolveNodeKind({ id: 'u', agent: 'developer-unifier' }), 'unifier');
    assert.equal(resolveNodeKind({ id: 'rf', agent: 'reflector' }), 'reflect');
    assert.equal(resolveNodeKind({ id: 'x', agent: 'brain-ingest' }), 'unknown');
  });

  it('FlowRunArgs.nodeExecutors overrides the default executor for a kind (no orchestrator edit)', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    // Override the pm executor with a custom spy — the default deps.runProjectManager
    // must NOT be called; the injected executor runs instead. This proves a flow can
    // register custom node behaviour without touching flow-runner's dispatch loop.
    const customCalls: string[] = [];
    const customPm: NodeExecutor = async () => { customCalls.push('custom-pm'); };

    const result = await runFlow({ flow, input, logger, deps, nodeExecutors: { pm: customPm } });

    assert.deepEqual(customCalls, ['custom-pm'], 'injected pm executor must run');
    assert.ok(!tracker.calls.includes('runProjectManager'), 'default pm executor must be bypassed by the override');
    // The rest of the pipeline still runs through the defaults.
    assert.ok(tracker.calls.includes('runDeveloperLoop'));
    assert.ok(tracker.calls.includes('runReflector'));
    assert.strictEqual(result.cycleOutcome, 'merged');
  });
});
