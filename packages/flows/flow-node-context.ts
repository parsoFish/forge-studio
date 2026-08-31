/**
 * The per-node context the flow runner builds and the `PhaseExecutor` port
 * receives, plus the mutable outcome state threaded through one run.
 *
 * Its own module so the runner and the factory-side executor table share it
 * without either importing the other, and so the runner keeps no import of a
 * phase (`docs/roadmaps/1.0.md` §4 M2 Lane B, SPEC.md §2 Station).
 */

import type { EventLogger } from '@forge/kernel';
import { type ClosureResult, type CycleInput, type CycleOutcome, type ReviewerOutcome } from './cycle-context.ts';
import type { FlowNode, AgentBudgets, AgentDefinition } from '@forge/contracts/studio/types.ts';
import { WedgeDetector } from './flow-budgets.ts';
import type { NodeKind } from './flow-node-kind.ts';
import type { ProjectGate } from '@forge/kernel';

/** Mutable cross-node outcome state, threaded through every executor. */
export type NodeRunState = {
  cycleOutcome: CycleOutcome;
  reflectionStatus: string;
  lintStatus: string;
  reviewerOutcome: ReviewerOutcome;
  closure: ClosureResult | null;
  /**
   * R4-10-F2: set by execDemo when the merge-boundary full-suite gate is RED —
   * the branch is not shippable, so the DAG walk stops here and runFlow routes
   * the manifest to `ready-for-review` (no PR opened; the preserved invariant).
   * The fix-loop drain re-enters `resume_from:'develop'` off the compiled
   * gate-fix WIs.
   */
  terminateEarly: boolean;
};

/** Everything a node executor needs. Built fresh per node by runFlow. */
export type NodeExecContext = {
  node: FlowNode;
  nodeId: string;
  /** Resolved once by the runner (flow-node-kind.ts); the executor reads it. */
  kind: NodeKind;
  /** The injected project-contract preflight (SPEC.md §6); flows never import it. */
  projectGate: ProjectGate;
  input: CycleInput;
  /** Per-node logger (cost + wedge wrapped). Executors emit here. */
  nodeLogger: EventLogger;
  /** Cost-only logger — used for out-of-band events (e.g. wedge-kill). */
  costLogger: EventLogger;
  wedgeDetector: WedgeDetector;
  nodeBudget: AgentBudgets | undefined;
  state: NodeRunState;
  /** The run's agent roster (R2-01-F2), slug → definition. Built once per run. */
  agents: ReadonlyMap<string, AgentDefinition>;
  /** Artifact names produced by this node's inbound edges (R2-01-F2, execAgent's prompt context). */
  inboundArtifacts: string[];
};
