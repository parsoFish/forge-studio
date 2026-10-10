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
  /** forge-mfv5.1.27: compiled fix WIs (`origin` set) still pending or in progress. */
  pendingFixWorkItems: number;
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

/** A fix round and whether it is being built (`running`) or parked for the drain. */
export type FixRound = { round: number; running: boolean };

/**
 * forge-mfv5.1.27 — the fix round a red merge gate (or a send-back) parked:
 * `reviewRounds` while compiled fix WIs wait for the drain to re-enter develop,
 * else null. forge-nk1y.23: the SAME round, once the drain re-entered it
 * (`in-flight/`, still `resume_from: develop`, a compiled fix WI still open),
 * reads `running: true`. ONE derivation, served beside `isAwaitingKickoff`;
 * never a review.
 */
export function fixRoundOf(f: KickoffFacts): FixRound | null {
  if (f.resumeFrom !== 'develop' || f.pendingFixWorkItems <= 0) return null;
  if (f.queueDir === 'ready-for-review') return { round: f.reviewRounds, running: false };
  return f.queueDir === 'in-flight' ? { round: f.reviewRounds, running: true } : null;
}

/** forge-nk1y.23 — develop is building: in-flight with any work item (dev or fix) still pending or in progress. */
export function developRunningOf(f: KickoffFacts): boolean {
  return f.queueDir === 'in-flight' && f.workItemStatuses.some((s) => s === 'pending' || s === 'in-progress');
}

const SHA40 = /^[0-9a-f]{40}$/;

/**
 * forge-mfv5.1.27 — the head a gate-fix round was parked on: the LAST exact
 * orchestrator/cycle `cycle.dev-close-invariant-ok` (`local_head`) or
 * `merge-gate.fix-loop.compiled` (`head_sha`, after any CI-fixer commit) in the
 * cycle log. A non-40-hex value on that last event fails closed (null).
 */
export function fixRoundDeliveredHead(lines: readonly string[]): string | null {
  let head: string | null = null;
  for (const line of lines) {
    let ev: { message?: unknown; phase?: unknown; skill?: unknown; metadata?: Record<string, unknown> } | null;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.phase !== 'orchestrator' || ev.skill !== 'cycle') continue;
    const key = ev.message === 'cycle.dev-close-invariant-ok' ? 'local_head' : ev.message === 'merge-gate.fix-loop.compiled' ? 'head_sha' : null;
    if (key === null || !(key in (ev.metadata ?? {}))) continue;
    const sha = ev.metadata?.[key];
    head = typeof sha === 'string' && SHA40.test(sha) ? sha : null;
  }
  return head;
}

/** The named refusal when the branch head is not the delivered head, else null. */
export function fixRoundHeadVerdict(delivered: string | null, found: string | null): string | null {
  if (delivered !== null && found === delivered) return null;
  const expected = delivered === null ? 'no 40-hex delivered head recorded' : `expected ${delivered.slice(0, 7)}`;
  return `branch head moved since the last delivered work item (${expected}, found ${found?.slice(0, 7) ?? '(no branch)'}) — not resuming`;
}
