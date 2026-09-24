/**
 * Forge Studio — Run Derivation Helpers (M1-1, ADR-027/028). A DOOR, not the
 * implementation (bead forge-8vfn.15 size split — see design.md): re-exports
 * status/cost/lineage/node-id.ts unchanged so every existing import resolves.
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
