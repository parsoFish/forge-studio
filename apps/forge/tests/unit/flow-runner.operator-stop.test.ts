/**
 * M7 row 150 (bead forge-8vfn.8.1.39, rulings 1771 + 1774) — ADR 028's
 * amendment: the operator-stop flag file is a SECOND trigger on the SAME
 * clean-boundary halt the cost ceiling already uses. Mirrors this file's
 * sibling `flow-runner.test.ts`'s own cost-ceiling / wedge-kill test style
 * (kept in a separate file: `flow-runner.test.ts` is baselined at its exact
 * current line count by `scripts/baselines/file-size.json` and must not
 * grow — see `docs/roadmaps/1.0.md`'s 800-line file cap; a NEW file, never a
 * bigger one).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runFlowT, type TestDepsPartial } from '../test-fixtures/flow-runner-port.ts';
import { OperatorStopError, operatorStopPath } from '@forge/flows';
import type { FlowDefinition, AgentBudgets } from '@forge/contracts';
import type { CycleInput } from '@forge/flows';
import type { EventLogger } from '@forge/kernel';

/** A REAL directory standing in for `_queue/in-flight/` — the flag file's
 *  path is `dirname(manifestPath)/<initiativeId>.stop` (flow-runner.ts), so
 *  the test needs a real dir to write into, unlike the sibling file's fixed
 *  (never-read) `/tmp/test/manifest.md`. */
function withInFlightDir(fn: (manifestPath: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'forge-flow-runner-stop-'));
  const manifestPath = join(dir, 'INIT-stop-spec.md');
  return Promise.resolve(fn(manifestPath)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function makeInput(manifestPath: string, overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    initiativeId: 'INIT-stop-spec',
    manifestPath,
    projectRepoPath: '/tmp/test/project',
    worktreePath: '/tmp/test/worktree',
    dryRun: true,
    ...overrides,
  };
}

function makeLogger(): EventLogger & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    logFilePath: '/tmp/test/events.jsonl',
    cycleId: 'test-cycle-id',
    emit(event: unknown) {
      events.push(event);
      return {
        ...(event as Record<string, unknown>),
        event_id: `evt-${events.length}`,
      } as ReturnType<EventLogger['emit']>;
    },
  };
}

function makePmOnlyFlow(): FlowDefinition {
  return {
    id: 'pm-only', name: 'PM only', version: 1, goal: 'Run only the PM node.', project: null, kb: 'cycles',
    costCeilingUsd: 0, origin: 'seed', accepts: ['code'], disposable: undefined,
    nodes: [{ id: 'pm', agent: 'project-manager' }], edges: [], triggers: [], path: '/fake/pm-only.yaml',
  };
}

/** DEV-ONLY (no pm before it): the node-boundary check fires only AFTER a
 *  node completes — a pm-then-dev flow would trip that check right after pm
 *  finishes (the stop flag is already present) and never REACH dev at all,
 *  which is not what this describe block is testing. Isolating the WI
 *  boundary means giving the walk nothing to stop at before dev runs. No
 *  `fanOut` declared: G6 (`findFanOutViolations`) rejects a fanOut node with
 *  no inbound edge carrying that artifact, and dispatch to `execDev` keys off
 *  the agent def's `runtime.loopStrategy === 'ralph'`, not the node's `fanOut`. */
function makeDevOnlyFlow(): FlowDefinition {
  return {
    id: 'dev-only', name: 'Dev only', version: 1, goal: 'Run only the dev node.', project: null, kb: 'cycles',
    costCeilingUsd: 0, origin: 'seed', accepts: ['code'], disposable: undefined,
    nodes: [{ id: 'dev', agent: 'developer-ralph' }], edges: [], triggers: [], path: '/fake/dev-only.yaml',
  };
}

/** No-op close-contract helpers — the pm-only/pm-dev fixtures never reach them,
 *  but `createPhaseExecutor` merges partial deps over REAL defaults, and the
 *  real ones touch a filesystem this test has none of. Mirrors
 *  `flow-runner.test.ts`'s own wedge-kill tests. */
const NOOP_CLOSE_DEPS: TestDepsPartial = {
  commitDevLoopBoundary: () => { /* no-op */ },
  enforceDevLoopCloseInvariant: () => { /* no-op */ },
  assertNonEmptyDelivery: () => { /* no-op */ },
  enforceFinalCiGate: () => { /* no-op */ },
  rebaseForResume: () => { /* no-op */ },
};

describe('flow-runner operator-stop — node boundary (ADR 028 amendment)', () => {
  it(
    'a stop flag present when the pm node finishes throws OperatorStopError and logs ' +
      'flow.operator-stop',
    () =>
      withInFlightDir(async (manifestPath) => {
      const flow = makePmOnlyFlow();
      const input = makeInput(manifestPath);
      const logger = makeLogger();
      writeFileSync(
        operatorStopPath(dirname(manifestPath), input.initiativeId),
        JSON.stringify({ reason: 'operator-stop', ts: new Date().toISOString(), actor: 'operator' }),
      );
      const deps: TestDepsPartial = {
        runProjectManager: async () => { /* completes cleanly */ },
        ...NOOP_CLOSE_DEPS,
      };

      await assert.rejects(
        () => runFlowT({ flow, input, logger, deps }),
        (err: unknown) => err instanceof OperatorStopError,
      );

      type LoggedEvent = { message?: string; metadata?: Record<string, unknown> };
      const events = (logger as ReturnType<typeof makeLogger>).events as LoggedEvent[];
      const stop = events.find((e) => e.message === 'flow.operator-stop');
      assert.ok(stop, 'a flow.operator-stop event must be logged at the boundary');
      assert.equal(stop!.metadata?.stoppedBeforeNode, null, 'pm is the only node — nothing comes after it');
    }));

  it('with no stop flag present, the SAME flow completes normally (negative control)', () =>
    withInFlightDir(async (manifestPath) => {
      const flow = makePmOnlyFlow();
      const input = makeInput(manifestPath);
      const logger = makeLogger();
      const deps: TestDepsPartial = {
        runProjectManager: async () => { /* completes cleanly */ },
        ...NOOP_CLOSE_DEPS,
      };

      await assert.doesNotReject(() => runFlowT({ flow, input, logger, deps }));
    }));
});

describe('flow-runner operator-stop — work-item boundary (CycleInput.shouldStopBeforeWorkItem)', () => {
  it(
    'a stop flag makes shouldStopBeforeWorkItem return a non-null operator-stop: reason ' +
      'before the dev node dispatches a WI',
    () =>
      withInFlightDir(async (manifestPath) => {
      const flow = makeDevOnlyFlow();
      const input = makeInput(manifestPath);
      const logger = makeLogger();
      writeFileSync(
        operatorStopPath(dirname(manifestPath), input.initiativeId),
        JSON.stringify({ reason: 'operator-stop', ts: new Date().toISOString(), actor: 'operator' }),
      );
      let observedReason: string | null | undefined;
      const deps: TestDepsPartial = {
        runDeveloperLoop: async (devInput) => {
          observedReason = devInput.shouldStopBeforeWorkItem?.('WI-1');
        },
        ...NOOP_CLOSE_DEPS,
      };

      // The dev node itself resolves (this fake never dispatches a real WI),
      // then the NODE-boundary check (same mechanism) throws once dev returns —
      // both boundaries are exercised in one run, exactly as a real cycle would.
      await assert.rejects(
        () => runFlowT({ flow, input, logger, deps }),
        (err: unknown) => err instanceof OperatorStopError,
      );
      assert.equal(
        typeof observedReason,
        'string',
        'shouldStopBeforeWorkItem must return a reason string, not null',
      );
      assert.match(observedReason as string, /^operator-stop:/);
    }));

  it('with no stop flag, shouldStopBeforeWorkItem returns null (negative control)', () =>
    withInFlightDir(async (manifestPath) => {
      const flow = makeDevOnlyFlow();
      const input = makeInput(manifestPath);
      const logger = makeLogger();
      let observedReason: string | null | undefined = 'not-called';
      const deps: TestDepsPartial = {
        runDeveloperLoop: async (devInput) => {
          observedReason = devInput.shouldStopBeforeWorkItem?.('WI-1') ?? null;
        },
        ...NOOP_CLOSE_DEPS,
      };
      await assert.doesNotReject(() => runFlowT({ flow, input, logger, deps }));
      assert.equal(observedReason, null);
    }));
});

describe('flow-runner operator-stop — a LIVE turn is aborted (wedge budget configured)', () => {
  it(
    'an operator stop written mid-turn aborts the live dev-loop turn through the SAME ' +
      'externalSignal chain the wedge-kill uses',
    () =>
      withInFlightDir(async (manifestPath) => {
      const flow = makeDevOnlyFlow();
      const input = makeInput(manifestPath);
      const logger = makeLogger();
      // wedgeKillMs is deliberately LONG (never fires within this test's
      // lifetime) — isolates the operator-stop path from the wedge-kill path,
      // which shares the same 100ms poll and would otherwise race it.
      const nodeBudgets = new Map<string, AgentBudgets>([['dev', { wedgeKillMs: 60_000 }]]);

      let capturedSignal: AbortSignal | undefined;
      const deps: TestDepsPartial = {
        runDeveloperLoop: async (devInput, nodeLogger, _def, sig) => {
          capturedSignal = sig;
          // Seed a heartbeat so the wedge detector's clock is running (it must
          // NOT be what fires here — only the operator stop should).
          nodeLogger.emit({
            initiative_id: devInput.initiativeId, phase: 'developer-loop', skill: 'developer-ralph',
            event_type: 'agent_heartbeat', input_refs: [], output_refs: [],
          });
          // The "live turn": hangs until the shared signal aborts — exactly the
          // fake-SDK-turn shape `flow-runner.test.ts`'s own wedge-kill tests use.
          await new Promise<void>((resolve) => {
            if (sig?.aborted) { resolve(); return; }
            sig?.addEventListener('abort', () => resolve(), { once: true });
          });
          // Write the stop flag AFTER the turn has started, mid-flight — proves
          // this is a LIVE abort, not the boundary check that already ran
          // before this executor was even called.
        },
        ...NOOP_CLOSE_DEPS,
      };

      // Write the stop flag shortly after the run starts, simulating an
      // operator clicking Stop while the turn is already in flight.
      setTimeout(() => {
        writeFileSync(
          operatorStopPath(dirname(manifestPath), input.initiativeId),
          JSON.stringify({ reason: 'operator-stop', ts: new Date().toISOString(), actor: 'operator' }),
        );
      }, 20);

      await assert.rejects(
        () => runFlowT({ flow, input, logger, nodeBudgets, deps }),
        (err: unknown) => err instanceof OperatorStopError,
      );
      assert.ok(
        capturedSignal !== undefined,
        'a signal must be threaded to the dev-loop turn when a wedge budget is configured',
      );
      assert.ok(capturedSignal!.aborted, 'the live turn\'s signal must be aborted by the operator stop');
    }));
});
