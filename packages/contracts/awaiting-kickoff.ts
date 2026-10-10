/**
 * The Kickoff gate (bead forge-mfv5.1.25): a decomposition-only flow
 * (forge-architect) finished, its work items wait in `_queue/ready-for-review/`,
 * and nothing is built yet. The operator's next act is Start development.
 *
 * ONE derivation. The bridge's roadmap, the run model and the develop enqueue
 * all call it; Studio reads the served result and never recomputes it. It keys
 * on manifest and work-item facts, not the `cycle.end` word, so a cycle that
 * ended `ready-for-review` before this gate existed is covered too.
 */

/** The decomposition-only flow whose finished, unbuilt output is a kickoff. */
export const KICKOFF_SOURCE_FLOW_ID = 'forge-architect';

export type KickoffFacts = {
  /** The queue dir the manifest sits in (`ready-for-review`, `pending`, …). */
  queueDir: string;
  flowId: string | null;
  /** One entry per decomposed work item; empty when none exist. */
  workItemStatuses: readonly string[];
  /** Lazy: a git probe, run only when every cheaper fact already says kickoff. */
  branchHasCommits: () => boolean;
  resumeFrom: string | null;
  reviewRounds: number;
};

/** Why the work items count as built, or null when nothing is built. */
export function kickoffBuiltReason(f: KickoffFacts): string | null {
  const built = f.workItemStatuses.find((s) => s !== 'pending');
  if (built !== undefined) return `a work item is ${built}`;
  if (f.resumeFrom) return `the manifest resumes from ${f.resumeFrom}`;
  if (f.reviewRounds > 0) return `${f.reviewRounds} review round(s) ran`;
  if (f.branchHasCommits()) return 'the forge branch has commits';
  return null;
}

export function isAwaitingKickoff(f: KickoffFacts): boolean {
  return f.queueDir === 'ready-for-review'
    && f.flowId === KICKOFF_SOURCE_FLOW_ID
    && f.workItemStatuses.length > 0
    && kickoffBuiltReason(f) === null;
}
