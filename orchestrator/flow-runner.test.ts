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
import { loadFlowDefinition } from './studio/registry.ts';
import type { FlowDefinition } from './studio/types.ts';
import type { CycleInput } from './cycle-context.ts';
import type { EventLogger } from './logging.ts';

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
    emitSyntheticArchitect: (_input, _logger) => {
      tracker.calls.push('emitSyntheticArchitect');
    },
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
  it('calls executors in order: emitSyntheticArchitect → runProjectManager → runDeveloperLoop → openPrInline → runClosure → runReflector', async () => {
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

    // Correct sequence (unifier is a marker, not in call list)
    assert.deepEqual(tracker.calls, [
      'emitSyntheticArchitect',
      'runProjectManager',
      'runDeveloperLoop',
      'openPrInline',
      'runClosure',
      'runReflector',
    ]);

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
  it('skips runProjectManager but still calls runDeveloperLoop', async () => {
    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    const input = makeInput({ resumeFrom: 'unifier' });
    const logger = makeLogger();
    const flow = makeForgeCycleFlow();

    await runFlow({ flow, input, logger, deps });

    assert.ok(!tracker.calls.includes('runProjectManager'), 'runProjectManager must NOT be called on unifier resume');
    assert.ok(tracker.calls.includes('runDeveloperLoop'), 'runDeveloperLoop must still be called on unifier resume');
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

    // Must produce the full sequence — proving the real definition is correct
    assert.deepEqual(tracker.calls, [
      'emitSyntheticArchitect',
      'runProjectManager',
      'runDeveloperLoop',
      'openPrInline',
      'runClosure',
      'runReflector',
    ], 'real forge-cycle.yaml must produce the full executor sequence in order');
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
