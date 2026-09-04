/**
 * phase-wiring.ts — the three things a cycle needs from whatever factory is
 * installed, declared in flows' own vocabulary.
 *
 * WHY it is a port rather than an import is [ADR 048](../../docs/decisions/048-deletable-example-factory.md):
 * no package imports `@forge/factory`, so deleting the example package leaves
 * the platform running. The assembly binds it once, in
 * `apps/forge/factory-wiring.ts`.
 *
 * WHY it is one value and not three parameters: a cycle needs all of them or
 * none. WHY it is not a field on `CycleInput`: `CycleInput` is the data a cycle
 * runs ON, threaded unchanged to every executor, so putting the executor inside
 * what the executor receives is a knot — and it would make `cycle-context.ts`
 * import `NodeExecContext` from `flow-node-context.ts`, which already imports
 * `CycleInput` back.
 *
 * No default and no fallback (CLAUDE.md): a caller that cannot name its factory
 * has no business starting a cycle.
 */
import type { EventLogger, PhaseExecutor, ProjectGate } from '@forge/kernel';

import type { ClosureResult, CycleInput, ReviewerOutcome } from './cycle-context.ts';
import type { NodeExecContext } from './flow-node-context.ts';

export type PhaseWiring = {
  /** Runs one flow node. `@forge/factory`'s `createPhaseExecutor()` builds the shipped one. */
  executor: PhaseExecutor<NodeExecContext>;
  /** The project contract's preflight. `@forge/factory`'s `createProjectGate()` builds the shipped one. */
  projectGate: ProjectGate;
  /**
   * Close the run when a node asks to terminate early (R4-10-F2) — the RUNNER's
   * act, not a station's, which is why it sits beside the executor rather than
   * inside it. `@forge/factory`'s `defaultRunClosure` is the shipped one.
   */
  runClosure: (
    input: CycleInput,
    logger: EventLogger,
    reviewerOutcome: ReviewerOutcome,
  ) => Promise<ClosureResult>;
  /**
   * The post-merge reflection turn. `finalize-merged.ts` dispatches it for an
   * `on: merged` trigger whose band guard is `reflection-close`; it is a phase,
   * so it belongs to the factory and arrives here rather than by import.
   * `@forge/factory`'s `runReflector` is the shipped one.
   */
  runReflector: (input: CycleInput, logger: EventLogger) => Promise<unknown>;
};
