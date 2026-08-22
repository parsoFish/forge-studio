/**
 * kickoff-candidates — the pure derivation behind the generic Start-Run
 * initiative picker on the flow monitor (W7-FIX-A3, A3-01).
 *
 * The picker offers ONLY genuinely startable initiatives: runs still queued
 * (`planned`). Finished (`complete`), `failed`, `active` and `gated` runs are
 * never candidates — the generic kickoff used to list every complete/failed
 * initiative from every flow, and one click yanked a shipped manifest out of
 * `_queue/done` and re-ran it (the bridge now refuses that too, 409
 * `already-done`; this is the UI half of the same guard). Re-running a
 * failed run is the monitor's own Resume affordance, not the picker.
 *
 * W8-A3 / `flows-37` (S1, data-corruption). A queued initiative carries the
 * flow that produced it, and starting it here MOVES it off that flow. The
 * picker used to render `{initiativeId}{· project}` and nothing else, so an
 * initiative queued under `forge-architect` was visually indistinguishable
 * from one of this flow's own, and one click silently took it. Every candidate
 * now carries the flow it is queued under and whether selecting it is a
 * repoint — both DERIVED from the run's own `flowId` against the flow being
 * viewed, so there is no field a writer can leave stale.
 *
 * `canStartFlow` used to live here; it is now `lib/kickoff-surface.ts`, in the
 * same table the monitor's launch UI dispatches on (see `flows-25`).
 */
import type { Run } from './studio-client';

/** An initiative the generic kickoff can enqueue onto a flow — derived from
 *  the runs list (one run per queued manifest), never invented. */
export type KickoffCandidate = {
  initiativeId: string;
  project: string | null;
  /** The flow this initiative is queued under today — `null` when the run
   *  reports none. Straight off the run; nothing stores a copy. */
  currentFlowId: string | null;
  /** True when starting this candidate would move it off another flow. */
  isRepoint: boolean;
};

/**
 * @param runs   every run in the queue (the flows page fetches unfiltered).
 * @param flowId the flow whose monitor is being viewed — what a candidate's
 *               own flow is compared against to decide `isRepoint`.
 */
export function deriveKickoffCandidates(runs: Run[], flowId: string): KickoffCandidate[] {
  const seen = new Set<string>();
  const out: KickoffCandidate[] = [];
  for (const r of runs) {
    if (r.status !== 'planned') continue;
    if (!r.initiativeId || seen.has(r.initiativeId)) continue;
    seen.add(r.initiativeId);
    const currentFlowId = r.flowId || null;
    out.push({
      initiativeId: r.initiativeId,
      project: r.project ?? null,
      currentFlowId,
      isRepoint: currentFlowId !== null && currentFlowId !== flowId,
    });
  }
  return out;
}
