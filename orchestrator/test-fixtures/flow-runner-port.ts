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
import { createProjectGate, defaultRunClosure } from '../phases/executor-deps.ts';
import type { FlowRunnerDeps } from '../phases/executor-deps.ts';
import type { NodeKind } from '@forge/flows/flow-node-kind.ts';

export type { NodeExecutor, FlowRunnerDeps };
export type EnqueueFlowRun = FlowRunArgs['enqueueFlowRun'];
export type TestDeps = FlowRunnerDeps & { enqueueFlowRun?: EnqueueFlowRun };
export type TestDepsPartial = Partial<FlowRunnerDeps> & { enqueueFlowRun?: EnqueueFlowRun };

export function runFlowT({
  deps,
  nodeExecutors,
  ...rest
}: Omit<FlowRunArgs, 'executor' | 'projectGate' | 'runClosure'> & {
  projectGate?: FlowRunArgs['projectGate'];
  runClosure?: FlowRunArgs['runClosure'];
  deps?: TestDepsPartial;
  nodeExecutors?: Partial<Record<NodeKind, NodeExecutor>>;
}): ReturnType<typeof runFlow> {
  const { enqueueFlowRun, ...phaseDeps } = deps ?? {};
  const { projectGate, runClosure, ...args } = rest;
  return runFlow({
    ...args,
    // Defaults resolve AFTER the caller's fields, so an explicit `undefined`
    // cannot silently win against a required argument.
    projectGate: projectGate ?? createProjectGate(),
    runClosure: runClosure ?? phaseDeps.runClosure ?? defaultRunClosure,
    // Hermetic by default: `stageFlowRunRequest` writes claimable run requests
    // into the repo's `_queue/`, which a running `forge serve` would drain, so a
    // suite that does not care about triggers must not reach it by omission.
    enqueueFlowRun: enqueueFlowRun ?? (() => {}),
    executor: createPhaseExecutor({ deps: phaseDeps, overrides: nodeExecutors }),
  });
}
