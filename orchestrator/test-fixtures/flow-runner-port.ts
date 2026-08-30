/**
 * Test-side construction of the `PhaseExecutor` port (M2-B).
 *
 * `runFlow` takes the port, not a phase set: `docs/roadmaps/1.0.md` §4 M2 Lane B
 * removed the runner's ten phase imports, and SPEC.md §2 Station makes the port
 * the only way a station executes. The suites below it were written against the
 * old `deps` argument, and their ASSERTIONS are what those suites are for — so
 * this builds the port from the same `deps` object each test already declares,
 * leaving every assertion untouched.
 *
 * `enqueueFlowRun` is hoisted out of `deps` because it moved to the runner's own
 * arguments: staging a triggered run is the runner's act, and the port carries
 * phases only.
 *
 * The port itself — a stub executor that touches no phase — is exercised
 * directly by `orchestrator/flow-runner.port-conformance.test.ts`.
 */
import { runFlow, type FlowRunArgs } from '../flow-runner.ts';
import { createPhaseExecutor, type NodeExecutor } from '../phases/executor-table.ts';
import { createProjectGate } from '../phases/executor-deps.ts';
import type { FlowRunnerDeps } from '../phases/executor-deps.ts';
import type { NodeKind } from '../flow-node-kind.ts';

export type { NodeExecutor, FlowRunnerDeps };
export type EnqueueFlowRun = FlowRunArgs['enqueueFlowRun'];
export type TestDeps = FlowRunnerDeps & { enqueueFlowRun?: EnqueueFlowRun };
export type TestDepsPartial = Partial<FlowRunnerDeps> & { enqueueFlowRun?: EnqueueFlowRun };

export function runFlowT({
  deps,
  nodeExecutors,
  ...rest
}: Omit<FlowRunArgs, 'executor' | 'projectGate'> & {
  projectGate?: FlowRunArgs['projectGate'];
  deps?: TestDepsPartial;
  nodeExecutors?: Partial<Record<NodeKind, NodeExecutor>>;
}): ReturnType<typeof runFlow> {
  const { enqueueFlowRun, ...phaseDeps } = deps ?? {};
  return runFlow({
    projectGate: createProjectGate(),
    ...rest,
    ...(enqueueFlowRun ? { enqueueFlowRun } : {}),
    executor: createPhaseExecutor({ deps: phaseDeps, overrides: nodeExecutors }),
  });
}
