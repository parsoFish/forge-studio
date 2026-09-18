/**
 * `isRunnableSource` — the ONE rule for "would enqueueFlowRun claim this
 * manifest for that flow". `forge-8vfn.7.6.132`.
 *
 * The rationale — why its own module, why `packages/contracts`, why importless
 * — is in `packages/contracts/design.md`. Prose moves rather than being charged
 * against the package cap (QUARRY's `knowledge` precedent).
 */

/** The develop flow's id — the single definition; re-exported by `enqueue-flow-run.ts`. */
export const DEVELOP_FLOW_ID = 'forge-develop';
/**
 * Would `enqueueFlowRun` claim this manifest for that flow? The ONE definition —
 * see `packages/contracts/design.md` for why it exists and what it deliberately
 * does not decide. An unreadable `flow_id` resolves to NOT runnable (§15.504).
 */
export function isRunnableSource(
  queueState: 'pending' | 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed',
  manifestFlowId: string | null | undefined,
  targetFlowId: string,
): boolean {
  // A cycle is running or finalizing — never disturb it.
  if (queueState === 'in-flight' || queueState === 'merged') return false;
  // Parked at a gate: a SIBLING of the same flow must not be enqueued beside it;
  // a DIFFERENT flow's manifest there is the hand-off and is claimable.
  if (queueState === 'ready-for-review') {
    if (typeof manifestFlowId !== 'string' || manifestFlowId === '') return false;
    return manifestFlowId !== targetFlowId;
  }
  // pending / done / failed — a run source regardless of which flow wrote it.
  return true;
}

