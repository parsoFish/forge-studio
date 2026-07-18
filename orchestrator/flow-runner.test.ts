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

import { runFlow, flowPathForId, resolveNodeKind, type FlowRunnerDeps, type NodeExecutor } from './flow-runner.ts';
import { WedgeKillError, CostCeilingError } from './flow-budgets.ts';
import { loadFlowDefinition } from './studio/registry.ts';
import type { FlowDefinition } from './studio/types.ts';
import type { CycleInput } from './cycle-context.ts';
import type { EventLogger } from './logging.ts';
import type { AgentBudgets, AgentDefinition } from './studio/types.ts';

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
    // These tests mock the node executors and use synthetic paths — no real
    // artifacts land on disk, so they run as dry runs (which skips the ADR-027
    // inbound-artifact guard). Artifact enforcement is covered in
    // flow-artifacts.test.ts against real on-disk layouts.
    dryRun: true,
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
      // Echo the partial back in the return value (merged with event_id), as the
      // real EventLogger does — wrapLoggerForCost reads cost_usd off the RETURN,
      // so a stub that dropped it would silently disable cost accumulation.
      return { ...(event as Record<string, unknown>), event_id: `evt-${events.length}` } as ReturnType<EventLogger['emit']>;
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
    },
    runUnifier: async (_input, _logger) => {
      tracker.calls.push('runUnifier');
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
    promoteMergedToDone: (_input, _logger) => {
      tracker.calls.push('promoteMergedToDone');
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
    // Unifier is now a real node (M8-0): runUnifier appears between dev and review.
    assert.deepEqual(tracker.calls, [
      'runProjectManager',
      'runDeveloperLoop',
      'runUnifier',
      'openPrInline',
      'runClosure',
      'runReflector',
      'promoteMergedToDone',
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
  it('skips runProjectManager; runs the dev node (self-no-ops per-WI) then the unifier; rebase before the dev node', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    await runFlow({ flow, input, logger, deps });

    assert.ok(!tracker.calls.includes('runProjectManager'), 'runProjectManager must NOT be called on unifier resume');
    assert.ok(tracker.calls.includes('runDeveloperLoop'), 'the dev node still runs on resume (self-no-ops per-WI, emits start/end{resumed:true})');
    assert.ok(tracker.calls.includes('runUnifier'), 'runUnifier must be called on unifier resume');

    // Highest-risk resume step: rebase must have been called AND must precede the dev node.
    assert.ok(tracker.calls.includes('rebaseForResume'), 'rebaseForResume must be called on unifier resume');
    assert.ok(
      tracker.calls.indexOf('rebaseForResume') < tracker.calls.indexOf('runDeveloperLoop'),
      'rebaseForResume must execute before the dev node',
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

    assert.ok(tracker.calls.includes('runUnifier'));
    assert.ok(tracker.calls.includes('openPrInline'));
    assert.ok(tracker.calls.includes('runClosure'));
    assert.ok(tracker.calls.includes('runReflector'));
    assert.ok(tracker.calls.includes('promoteMergedToDone'));
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
    assert.ok(
      !tracker.calls.includes('promoteMergedToDone'),
      'promoteMergedToDone must NOT be called when merged:false — nothing landed in merged/ to promote',
    );
    assert.strictEqual(result.cycleOutcome, 'ready-for-review');
    assert.strictEqual(result.reflectionStatus, 'skipped');
    assert.strictEqual(result.lintStatus, 'skipped');
  });
});

// ---------------------------------------------------------------------------
// 2.10: a reflect-node throw records the loss before propagating
// ---------------------------------------------------------------------------

describe('flow-runner reflect throw → cycle.reflection-lost (2.10)', () => {
  it('emits cycle.reflection-lost with a classified cause, then rethrows (behavior unchanged)', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);

    // runReflector's own emission points cover its internal failures; this
    // covers the caller-side throw (e.g. system-prompt/brain-index read dies
    // before runReflector's internal try, or an injected adapter throws).
    deps.runReflector = async (_input, _logger) => {
      throw new Error('ECONNRESET: connection reset by peer');
    };

    const input = makeInput();
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    await assert.rejects(
      () => runFlow({ flow, input, logger, deps }),
      /ECONNRESET/,
      'the throw must still propagate — instrument-only, no swallowed failures',
    );

    const events = logger.events as Array<{ message?: string; event_type?: string; metadata?: Record<string, unknown> }>;
    const lost = events.find((e) => e.message === 'cycle.reflection-lost');
    assert.ok(lost, 'expected cycle.reflection-lost event before the rethrow');
    assert.equal(lost!.event_type, 'error');
    assert.equal(lost!.metadata?.cause, 'crash');
    assert.equal(lost!.metadata?.crash_kind, 'transient', 'ECONNRESET classifies as environment pressure');

    // R4-11-F1: the reflection-lost path must ALSO still reach done/ — closure
    // already moved the manifest to merged/ before reflect ran, and
    // finalize-merged.ts (the other caller) only scans ready-for-review/, so
    // this node's own `finally` is the only thing that can promote it on.
    assert.ok(
      tracker.calls.includes('promoteMergedToDone'),
      'promoteMergedToDone must still be called even though reflect threw',
    );
  });
});

// ---------------------------------------------------------------------------
// (S9 removed the "real full-sequence flow" test that loaded forge-cycle-with-review:
// that monolith seed was retired with the 3-flow split. The full executor sequence is
// covered by the synthetic makeForgeCycleFlow tests above; the real spine seeds —
// forge-architect (architect+pm) and forge-develop (dev→unifier→review) — are loaded
// and asserted in the tests below.)

// ---------------------------------------------------------------------------
// Test 5: forge-architect flow — 2-node (architect + pm), no dev/review/reflect
// ---------------------------------------------------------------------------

describe('flow-runner with real forge-architect.yaml', () => {
  it('loads the forge-architect flow and finalizes after pm — no dev, unifier, review, or reflect', async () => {
    const flowPath = flowPathForId('forge-architect');
    const flow = loadFlowDefinition(flowPath);

    assert.strictEqual(flow.id, 'forge-architect', 'flow id must be forge-architect');
    assert.strictEqual(flow.nodes.length, 2, 'forge-architect must have exactly 2 nodes (architect + pm)');
    assert.ok(
      flow.nodes.some((n) => n.gate === 'plan'),
      'forge-architect must have an architect node with gate:plan',
    );
    assert.ok(
      flow.nodes.some((n) => n.agent === 'project-manager'),
      'forge-architect must have a pm node',
    );
    assert.ok(
      !flow.nodes.some((n) => n.agent === 'developer-ralph'),
      'forge-architect must NOT have a dev node',
    );

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();

    const result = await runFlow({ flow, input, logger, deps });

    // Architect is a silent marker; pm runs; no dev/unifier/review/reflect.
    assert.deepEqual(tracker.calls, ['runProjectManager'],
      'forge-architect: only runProjectManager must be called (architect is a silent marker, no dev/unifier/review/reflect)');

    // Outcome: ready-for-review (the review gate never ran, so the cycle parks here).
    // reflectionStatus + lintStatus are skipped because their nodes are absent.
    assert.strictEqual(result.cycleOutcome, 'ready-for-review',
      'forge-architect must finalize with ready-for-review (no review node ran)');
    assert.strictEqual(result.reflectionStatus, 'skipped',
      'reflectionStatus must be skipped when no reflect node is in the flow');
    assert.strictEqual(result.lintStatus, 'skipped',
      'lintStatus must be skipped when no reflect node is in the flow');
  });
});

// ---------------------------------------------------------------------------
// Test 5b: forge-develop flow — 3-node (dev + unifier + review), no architect/pm/reflect
// ---------------------------------------------------------------------------

describe('flow-runner with real forge-develop.yaml', () => {
  it('loads the forge-develop flow and runs dev → unifier → review — no architect, pm, or reflect', async () => {
    const flowPath = flowPathForId('forge-develop');
    const flow = loadFlowDefinition(flowPath);

    assert.strictEqual(flow.id, 'forge-develop', 'flow id must be forge-develop');
    assert.strictEqual(flow.nodes.length, 3, 'forge-develop must have exactly 3 nodes (dev + unifier + review)');
    assert.ok(
      flow.nodes.some((n) => n.agent === 'developer-ralph'),
      'forge-develop must have a dev node (developer-ralph)',
    );
    assert.ok(
      flow.nodes.some((n) => n.agent === 'developer-unifier' && n.resumable === true),
      'forge-develop must have a resumable unifier node',
    );
    assert.ok(
      flow.nodes.some((n) => n.gate === 'verdict'),
      'forge-develop must have a review node with gate:verdict (the human gate — zero-gate flows are rejected)',
    );
    assert.ok(
      !flow.nodes.some((n) => n.agent === 'project-manager' || n.gate === 'plan' || n.agent === 'reflector'),
      'forge-develop must NOT have pm, architect, or reflect nodes (DEC-3 carve)',
    );

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput();
    const logger = makeLogger();

    const result = await runFlow({ flow, input, logger, deps });

    // Dev-loop + unifier + review (openPr → closure) run; pm/architect/reflect do not.
    assert.deepEqual(tracker.calls, ['runDeveloperLoop', 'runUnifier', 'openPrInline', 'runClosure'],
      'forge-develop: dev → unifier → review(openPr→closure) only — no pm/architect/reflect');

    // Closure confirmed a merge in the mock, but there is no reflect node, so
    // reflection never runs — the develop flow ends at the merged PR (S8 adds reflect).
    assert.strictEqual(result.reflectionStatus, 'skipped',
      'reflectionStatus must be skipped — forge-develop has no reflect node (S8 carves it)');
  });

  it('forge-develop resumes the unifier in place (ADR-026 drain) — skips the per-WI dev work but keeps the spine', async () => {
    const flowPath = flowPathForId('forge-develop');
    const flow = loadFlowDefinition(flowPath);

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    // A send-back drain re-claims the manifest with resumeFrom:'unifier'.
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();

    await runFlow({ flow, input, logger, deps });

    // The dev node still runs (it self-no-ops the per-WI loop on resume but emits
    // the phase-boundary events); the unifier + review spine re-runs in place.
    assert.ok(tracker.calls.includes('runDeveloperLoop'), 'dev node runs (self-no-ops per-WI on resume)');
    assert.ok(tracker.calls.includes('runUnifier'), 'unifier re-runs the pending UWIs on resume');
    assert.ok(tracker.calls.includes('openPrInline'), 'review re-opens/updates the PR on resume');
  });
});

// ---------------------------------------------------------------------------
// Test 6: Wedge-kill race — raceWithWedge integration
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

  it('flow with trigger {on:complete, flow:forge-reflect} → enqueueFlowRun called on terminal success', async () => {
    const flow = makeTriggerFlow([{ on: 'complete', flow: 'forge-reflect' }]);
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
    assert.equal(enqueueCalls[0].flowId, 'forge-reflect');
    assert.equal(enqueueCalls[0].opts.origin, 'trigger');
    assert.equal(enqueueCalls[0].opts.triggeredBy, 'trigger-test');
  });

  it('flow with trigger → enqueueFlowRun NOT called on executor failure (triggers fire only on terminal success)', async () => {
    const flow = makeTriggerFlow([{ on: 'complete', flow: 'forge-reflect' }]);
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
      { on: 'complete', flow: 'forge-reflect' },
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

    assert.deepEqual(enqueueCalls.sort(), ['forge-reflect', 'other-flow'].sort());
  });
});

// ---------------------------------------------------------------------------
// Test 7: a single-node flow with an unknown (non-phase) agent → graceful skip.
// (M3-5 behaviour; previously fixtured on the forge-reflect seed, retired in
// the spine cleanup — now a SYNTHETIC flow so it depends on no shippable flow.)
// ---------------------------------------------------------------------------

describe('single-node flow with an unknown agent — graceful skip', () => {
  /** Synthetic disposable single-node flow whose agent has no roster def at
   *  all — resolveNodeKind() → 'unknown' (the `!def` case) → execUnknown
   *  emits an ERROR-severity event and continues (R2-01-F2 AC #4: execUnknown
   *  now survives ONLY for genuinely unresolvable refs, at error severity —
   *  not a quiet log). A real roster slug with no declared executor (e.g.
   *  brain-ingest) now resolves to 'agent' instead — see the execAgent test
   *  below (AC #1). */
  function makeUnknownAgentFlow(): FlowDefinition {
    return {
      id: 'unknown-agent-flow',
      name: 'Unknown Agent Flow',
      version: 1,
      goal: 'A disposable single-node flow whose agent has no roster definition.',
      project: null,
      kb: null,
      costCeilingUsd: 0,
      origin: 'seed',
      disposable: true,
      nodes: [{ id: 'ingest', agent: 'totally-fake-nonexistent-agent' }],
      edges: [],
      triggers: [],
      path: '/fake/unknown-agent-flow.yaml',
    };
  }

  it('runFlow dispatches the unknown node as an error-severity skip + completes', async () => {
    const flow = makeUnknownAgentFlow();
    // No roster def for "totally-fake-nonexistent-agent" → resolveNodeKind() = 'unknown'
    // → execUnknown logs flow-runner.unknown-node-skipped at error severity and
    // continues; runFlow completes without throwing.
    const input = makeInput();
    const logger = makeLogger();
    const enqueueCalls: string[] = [];

    const deps: Partial<FlowRunnerDeps> = {
      enqueueFlowRun: (flowId, _opts) => { enqueueCalls.push(flowId); },
      // No other deps needed — single node, no cycle executors involved.
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    const result = await runFlow({ flow, input, logger, deps });

    // No gate/closure → cycleOutcome stays at its initial 'ready-for-review'.
    assert.strictEqual(result.cycleOutcome, 'ready-for-review');

    const events = (logger as ReturnType<typeof makeLogger>).events as Array<{
      event_type?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    }>;
    const unknownSkipEvents = events.filter(
      (e) => e.message === 'flow-runner.unknown-node-skipped' && e.metadata?.['node_id'] === 'ingest',
    );
    assert.ok(
      unknownSkipEvents.length >= 1,
      'a genuinely unresolvable agent node must be a flow-runner.unknown-node-skipped',
    );
    assert.ok(
      unknownSkipEvents.every((e) => e.event_type === 'error'),
      'AC #4: execUnknown must log at error severity, not a quiet log',
    );

    // No triggers → enqueue not called.
    assert.deepEqual(enqueueCalls, []);
  });
});

// ---------------------------------------------------------------------------
// Test 7b: a single-node flow with a generic (non-legacy, no-executor) agent
// runs via the generic F1 execAgent path — R2-01-F2 AC #1. Uses a real
// roster def (brain-ingest — surface:unattended, no declared executor) so
// resolveNodeKind() resolves it to 'agent' against the REAL skills/ roster
// runFlow builds internally, proving dispatch reaches execAgent/runAgent
// instead of the old silent skip.
// ---------------------------------------------------------------------------

describe('single-node flow with a generic (non-legacy, no-executor) agent — execAgent (R2-01-F2 AC #1)', () => {
  function makeGenericAgentFlow(): FlowDefinition {
    return {
      id: 'generic-agent-flow',
      name: 'Generic Agent Flow',
      version: 1,
      goal: 'A disposable single-node flow whose agent is a real roster def with no declared executor.',
      project: null,
      kb: null,
      costCeilingUsd: 0,
      origin: 'seed',
      disposable: true,
      nodes: [{ id: 'ingest', agent: 'brain-ingest' }],
      edges: [],
      triggers: [],
      path: '/fake/generic-agent-flow.yaml',
    };
  }

  it('runFlow dispatches the node via execAgent — NOT a silent skip', async () => {
    const flow = makeGenericAgentFlow();
    const input = makeInput();
    const logger = makeLogger();

    const deps: Partial<FlowRunnerDeps> = {
      enqueueFlowRun: () => { /* no-op */ },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };

    // Force spawn suppression ON regardless of ambient env (local `npm test`
    // does not set FORGE_ARCHITECT_NO_SPAWN, CI does — this test must be
    // deterministic either way, and must never hit a real SDK spawn). Cost
    // is necessarily 0 under suppression; the non-zero-cost proof of the
    // ctx.nodeLogger → RunContext.logger cost pipe lives in
    // run-agent.test.ts's injected-logger test (R2-01-F2 step D), which CAN
    // inject a fake-cost queryFn because it calls runAgent directly — a
    // production caller like execAgent must not (queryFn is test-injection
    // only, enforced by pinned-sdk-query.enforce.test.ts).
    const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
    process.env.FORGE_DRY_BRIDGE = '1';
    try {
      const result = await runFlow({ flow, input, logger, deps });

      assert.strictEqual(result.cycleOutcome, 'ready-for-review');

      const events = (logger as ReturnType<typeof makeLogger>).events as Array<{
        event_type?: string;
        skill?: string;
        message?: string;
      }>;

      assert.ok(
        !events.some((e) => e.message === 'flow-runner.unknown-node-skipped'),
        'a real roster agent with no declared executor must NOT be treated as unknown',
      );

      const start = events.find((e) => e.event_type === 'start' && e.skill === 'brain-ingest');
      assert.ok(start, 'expected execAgent to dispatch through runAgent, emitting a start event for brain-ingest');

      const suppressed = events.find((e) => e.message === 'run-agent.spawn-suppressed');
      assert.ok(
        suppressed,
        'expected dispatch to reach the F1 runAgent primitive (spawn-suppressed under FORGE_DRY_BRIDGE)',
      );
    } finally {
      if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
    }
  });
});

// ---------------------------------------------------------------------------
// Test 8: Node-executor registry seam (ADR-028 — "new flow = no orchestrator edit")
// ---------------------------------------------------------------------------

/**
 * Minimal AgentDefinition fixture (R2-01-F2) — mirrors studio/validate.test.ts's
 * makeAgent helper so resolveNodeKind's stub agents map compiles against the
 * full type without repeating every required field at each call site.
 */
function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'my-agent',
    name: 'My Agent',
    description: 'An agent.',
    purpose: 'Do things.',
    composition: { skills: [], tools: [], mcps: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Process body here.',
    path: '/skills/my-agent/SKILL.md',
    ...overrides,
  };
}

describe('flow-runner node-executor registry seam (ADR-028)', () => {
  it('resolveNodeKind maps gate/agent fields to kinds (gate wins over agent, declared executor drives the rest)', () => {
    // Stub roster (R2-01-F2): resolution now reads `def.executor` off the
    // agent definition rather than a hardcoded AGENT_KIND table — build a
    // small agents map covering the four declared phase executors plus a
    // generic (no-executor) library agent and an invalid-executor agent.
    const agents = new Map<string, AgentDefinition>([
      ['architect', makeAgentDef({ slug: 'architect', name: 'Architect' })],
      ['project-manager', makeAgentDef({ slug: 'project-manager', name: 'PM', executor: 'pm' })],
      ['developer-ralph', makeAgentDef({ slug: 'developer-ralph', name: 'Dev', executor: 'dev' })],
      ['developer-unifier', makeAgentDef({ slug: 'developer-unifier', name: 'Unifier', executor: 'unifier' })],
      ['reflector', makeAgentDef({ slug: 'reflector', name: 'Reflector', executor: 'reflect' })],
      ['generic-lib-agent', makeAgentDef({ slug: 'generic-lib-agent', name: 'Generic Lib Agent' })],
      [
        'bad-executor-agent',
        makeAgentDef({ slug: 'bad-executor-agent', name: 'Bad Executor Agent', executor: 'not-a-kind' }),
      ],
    ]);

    assert.equal(resolveNodeKind({ id: 'a', agent: 'architect', gate: 'plan' }, agents), 'architect');
    assert.equal(resolveNodeKind({ id: 'r', gate: 'verdict' }, agents), 'review');
    assert.equal(resolveNodeKind({ id: 'pm', agent: 'project-manager' }, agents), 'pm');
    assert.equal(resolveNodeKind({ id: 'dev', agent: 'developer-ralph' }, agents), 'dev');
    assert.equal(resolveNodeKind({ id: 'u', agent: 'developer-unifier' }, agents), 'unifier');
    assert.equal(resolveNodeKind({ id: 'rf', agent: 'reflector' }, agents), 'reflect');
    assert.equal(
      resolveNodeKind({ id: 'x', agent: 'totally-fake-nonexistent-agent' }, agents),
      'unknown',
      'no roster def at all ⇒ unknown',
    );
    assert.equal(
      resolveNodeKind({ id: 'g', agent: 'generic-lib-agent' }, agents),
      'agent',
      'a real roster def with no declared executor ⇒ the generic F1 execAgent path',
    );
    assert.equal(
      resolveNodeKind({ id: 'bad', agent: 'bad-executor-agent' }, agents),
      'unknown',
      'a declared executor outside PHASE_EXECUTOR_KINDS ⇒ unknown (also caught by lint)',
    );
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
    assert.ok(tracker.calls.includes('runUnifier'), 'default unifier executor must run (real node, not a marker)');
    assert.ok(tracker.calls.includes('runReflector'));
    assert.ok(tracker.calls.includes('promoteMergedToDone'));
    assert.strictEqual(result.cycleOutcome, 'merged');
  });
});

// ---------------------------------------------------------------------------
// Per-run cost-ceiling override (forge-fix: a single initiative may carry a
// higher ceiling than the shared seed flow without mutating the flow file).
// ---------------------------------------------------------------------------

describe('flow-runner per-run cost ceiling override', () => {
  /** pm-only deps whose pm node emits `costUsd`, then no-op close helpers. */
  function depsEmittingCost(costUsd: number): Partial<FlowRunnerDeps> {
    return {
      runProjectManager: async (input, nodeLogger) => {
        nodeLogger.emit({
          initiative_id: input.initiativeId,
          phase: 'project-manager',
          skill: 'project-manager',
          event_type: 'end',
          input_refs: [],
          output_refs: [],
          cost_usd: costUsd,
        } as Parameters<typeof nodeLogger.emit>[0]);
      },
      commitDevLoopBoundary: () => { /* no-op */ },
      enforceDevLoopCloseInvariant: () => { /* no-op */ },
      assertNonEmptyDelivery: () => { /* no-op */ },
      enforceFinalCiGate: () => { /* no-op */ },
      rebaseForResume: () => { /* no-op */ },
    };
  }

  it('flow ceiling stops the run when no override is supplied ($8 spent ≥ $5 flow ceiling)', async () => {
    const flow = { ...makePmOnlyFlow(), costCeilingUsd: 5 };
    await assert.rejects(
      () => runFlow({ flow, input: makeInput(), logger: makeLogger(), deps: depsEmittingCost(8) }),
      (err: unknown) => err instanceof CostCeilingError && err.ceilingUsd === 5,
    );
  });

  it('per-run costCeilingUsd override raises the effective ceiling and prevents the stop', async () => {
    const flow = { ...makePmOnlyFlow(), costCeilingUsd: 5 };
    const logger = makeLogger();
    // $8 spent; flow ceiling $5 would stop, but the $1000 override wins → completes.
    await runFlow({ flow, input: makeInput(), logger, deps: depsEmittingCost(8), costCeilingUsd: 1000 });
    const stops = logger.events.filter((e) => (e as { message?: string }).message === 'flow.cost-ceiling-stop');
    assert.strictEqual(stops.length, 0, 'no cost-ceiling-stop when the override raises the ceiling above spend');
  });
});

// ---------------------------------------------------------------------------
// Fan-out truth (G6): `forge studio lint` rejects a node whose `fanOut`
// declaration has no matching inbound edge — an entry node (zero inbound
// edges) can never satisfy this, so fanOut on an entry node is always
// illegal. The runtime must honor the SAME predicate the lint rule uses
// (orchestrator/studio/validate.ts::findFanOutViolations) and reject at flow
// start, before any node executes — never mid-run.
// ---------------------------------------------------------------------------

describe('flow-runner fan-out enforcement (G6)', () => {
  it('rejects at flow start when the entry node declares an unsatisfiable fanOut', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const logger = makeLogger();
    const flow: FlowDefinition = {
      ...makeForgeCycleFlow(),
      // 'dev' is the entry node here — it has zero inbound edges, so its
      // fanOut:'work-items' declaration can never be satisfied.
      nodes: [
        { id: 'dev', agent: 'developer-ralph', fanOut: 'work-items' },
        { id: 'unifier', agent: 'developer-unifier', resumable: true },
      ],
      edges: [{ from: 'dev', to: 'unifier', artifact: 'wi-branches' }],
    };

    await assert.rejects(
      () => runFlow({ flow, input: makeInput(), logger, deps }),
      /fanOut/,
    );

    assert.deepEqual(
      tracker.calls,
      [],
      'no node executor should run — the illegal fanOut must be caught before any node executes, not mid-run',
    );
  });

  it('does not reject a fanOut node whose inbound edge carries the matching artifact', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const logger = makeLogger();
    const flow = makeForgeCycleFlow(); // 'dev' fanOut:'work-items' is fed by pm→dev artifact:'work-items'

    await runFlow({ flow, input: makeInput(), logger, deps });

    assert.ok(tracker.calls.includes('runDeveloperLoop'), 'a legally-fed fanOut node must still run');
  });
});
