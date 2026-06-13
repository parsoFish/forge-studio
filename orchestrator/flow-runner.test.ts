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

import { runFlow, forgeCycleFlowPath, type FlowRunnerDeps } from './flow-runner.ts';
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
