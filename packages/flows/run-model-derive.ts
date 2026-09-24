/**
 * Forge Studio — Run Derivation Helpers (M1-1, ADR-027/028)
 *
 * Pure derivation functions extracted from run-model.ts; internal to the run
 * aggregator (aggregateRun / listRuns / buildNodeMapping / Run types live in
 * run-model.ts). THIS FILE IS A DOOR, not the implementation (bead
 * forge-8vfn.15 — 988 lines against the 800-line cap, split by
 * responsibility): status.ts ("what state is this run in" — phase/WI status,
 * gate identity, failure, reflection-loss, stop-on-budget), cost.ts ("what
 * did this cost" — per-node metadata), lineage.ts ("what did it produce" —
 * artifacts, PR link, gate note), node-id.ts (the shared `eventToNodeId`
 * leaf). Re-exported here unchanged so every `from './run-model-derive.ts'`
 * and deep `@forge/flows/run-model-derive.ts` import keeps resolving.
 */

export {
  deriveNodeStatuses,
  endMetaIndicatesFailure,
  deriveWorkItems,
  wiStatusFor,
  lastIndexOfType,
  hasErrorBetween,
  findGateNodeId,
  findFailure,
  findLastErrorNode,
  findReflectionLoss,
  deriveStopOnBudget,
} from './run-model-derive-status.ts';

export {
  PROGRESS_EVENT_TYPES,
  WEDGE_THRESHOLD_MS,
  deriveNodeMeta,
  buildNodeMeta,
  findModel,
  countBrainReads,
  countGateFails,
  computeProgress,
  computeLastEventAt,
  computeIterations,
  findDelivered,
  findGateChecks,
  findFindings,
} from './run-model-derive-cost.ts';

export {
  deriveArtifacts,
  findPrUrl,
  findGateNote,
} from './run-model-derive-lineage.ts';

export { eventToNodeId } from './run-model-derive-node-id.ts';
