/**
 * projects-index-activity — per-project activity + progress for the projects
 * roster (W8-C3 WI-2; projects-08 / forge-j1e / bead forge-6gv.13.2).
 *
 * The defect: `/projects` showed no last-activity signal and no in-flight-work
 * signal. Home already computed an attention rollup for sessions and KBs;
 * projects had no equivalent on their own index, so the operator could not
 * tell a project forge worked yesterday from one untouched for eighteen days.
 *
 * DERIVED, never stored (exit row 4). Both inputs are themselves derived per
 * request by the server, from the queue and the cycle log:
 *
 *   · `ProjectAttentionItem[]` — `GET /api/studio/projects/attention`, which
 *     `buildProjectAttention` (`apps/forge/bridge-studio.ts:1377`) rebuilds by
 *     re-scanning `_queue/` on EVERY call. No new bridge route was needed for
 *     this WI; the aggregate has existed since R4-11-F4.
 *   · `Cycle[]` — `GET /api/cycles`'s live + recent snapshot.
 *
 * Nothing here caches, and no `Project` gains an activity field: a caller
 * holds the two source arrays and derives at render, so there is nowhere for
 * a stale copy to live.
 *
 * HONEST ABSENCE is load-bearing, not politeness. `queue: null` means the
 * attention aggregate carried no row for this project — UNKNOWN — and is a
 * different fact from `{planned:0,…}`, which means "the aggregate looked and
 * found nothing queued". Collapsing the two is the same fabrication
 * `parseKbLint` refuses for an absent lint summary and `project-cycle-ledger`
 * refuses for an absent cost (`null`, never `$0.00`).
 *
 * See `./projects-index-activity.test.ts` for the acceptance contract.
 */

import type { Cycle, ProjectAttentionItem } from './bridge-client';
import { parseWhenMs } from './history-ledger';
import { cycleIdEmbeddedIso } from './project-cycle-ledger';

/** The four attention-bearing queue states plus the plan-quality flag,
 *  carried verbatim from the server's own aggregate. */
export type ProjectQueueCounts = {
  planned: number;
  inFlight: number;
  gated: number;
  merged: number;
  /** Initiatives whose latest `plan.completeness` event is flagged — a plan
   *  QUALITY signal, not a queue state, which is why `openCount` excludes it. */
  flagged: number;
};

/** Terminal-merged cycles against every cycle this project has. */
export type ProjectProgress = { done: number; total: number };

export type ProjectActivity = {
  projectId: string;
  /**
   * The most recent moment anything happened for this project, or `null` when
   * no cycle carries a usable time. Never a fabricated "now".
   */
  lastActivityIso: string | null;
  /** `null` = the attention aggregate carried no row. UNKNOWN, never zero. */
  queue: ProjectQueueCounts | null;
  /** `null` = no cycles known for this project. Never `0/0`, which reads as
   *  "nothing has ever shipped" rather than "we have no history". */
  progress: ProjectProgress | null;
  /** planned + inFlight + gated + merged, or `null` when `queue` is unknown. */
  openCount: number | null;
};

/**
 * The one timestamp that represents a cycle's most recent activity.
 *
 * `endedAt` outranks `startedAt` (a cycle that finished later IS the later
 * activity), and both outrank the stamp the `cycleId` itself embeds — the
 * fallback `projects-27` added to the project ledger after every row rendered
 * an em dash, because the cycles payload carries no `startedAt`. Validity is
 * judged by `parseWhenMs`, the SAME seam the ledger's sort and `formatWhen`
 * use, so "is this a real time" cannot mean two different things.
 */
function cycleActivityMs(cycle: Cycle): number | null {
  const candidates = [cycle.endedAt, cycle.startedAt, cycleIdEmbeddedIso(cycle.cycleId) ?? undefined];
  for (const candidate of candidates) {
    const ms = parseWhenMs(candidate);
    if (ms !== null) return ms;
  }
  return null;
}

/** Which raw ISO string a chosen epoch-ms came from, so the caller renders the
 *  server's own string rather than a re-serialised one. */
function cycleActivityIso(cycle: Cycle): string | null {
  const candidates = [cycle.endedAt, cycle.startedAt, cycleIdEmbeddedIso(cycle.cycleId) ?? undefined];
  for (const candidate of candidates) {
    if (parseWhenMs(candidate) !== null) return candidate as string;
  }
  return null;
}

/**
 * Derive one project's activity from the two server-derived sources.
 *
 * A cycle with NO `project` anchor is attributed to NO project — never to all
 * of them. That is the shape an unanchored aggregate takes when it fails open,
 * and it would put another project's work on every card.
 */
export function deriveProjectActivity(
  projectId: string,
  attention: readonly ProjectAttentionItem[],
  cycles: readonly Cycle[],
): ProjectActivity {
  const row = attention.find((a) => a.projectId === projectId);
  const queue: ProjectQueueCounts | null = row
    ? { planned: row.planned, inFlight: row.inFlight, gated: row.gated, merged: row.merged, flagged: row.flagged }
    : null;

  const mine = cycles.filter((c) => c.project === projectId);

  let lastActivityIso: string | null = null;
  let bestMs = -Infinity;
  for (const cycle of mine) {
    const ms = cycleActivityMs(cycle);
    if (ms === null || ms <= bestMs) continue;
    bestMs = ms;
    lastActivityIso = cycleActivityIso(cycle);
  }

  // `merged` and `done` both imply the merge happened — the terminal-merge
  // rule `project-cycle-ledger.ts` already states for this exact `Cycle.status`
  // vocabulary (`merged` is the transient pass-through, `done` the settled
  // terminal). Reused rather than restated so the two cannot diverge.
  const progress: ProjectProgress | null = mine.length === 0
    ? null
    : { done: mine.filter((c) => c.status === 'merged' || c.status === 'done').length, total: mine.length };

  return {
    projectId,
    lastActivityIso,
    queue,
    progress,
    openCount: queue === null ? null : queue.planned + queue.inFlight + queue.gated + queue.merged,
  };
}
