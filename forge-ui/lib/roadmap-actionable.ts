/**
 * "Actionable now" derivation (W7-B6, projects-18) — the PURE half of the
 * Roadmap tab's work list. A 50-node pan/zoom canvas is the WRONG surface
 * for "what needs me": the only path to an initiative's actions was finding
 * and clicking its node. This lists the three actionable buckets alongside
 * the canvas, with the SAME actions the per-node drawer offers:
 *
 *   - plan   → pending + dependency-ready + NOT decomposed (Plan);
 *   - start  → pending + dependency-ready + decomposed (Start development);
 *   - failed → failed initiatives, each with its latest cycle's run link
 *              (recovery itself stays in the drawer — one implementation).
 */

import type { RoadmapInitiative } from './bridge-client';
import type { InitiativeGroup } from './cycle-grouping';

export type ActionableRow =
  | { kind: 'plan'; initiativeId: string; title: string }
  | { kind: 'start'; initiativeId: string; title: string }
  | { kind: 'failed'; initiativeId: string; title: string; runHref: string | null };

export function deriveActionableNow(
  initiatives: RoadmapInitiative[],
  cycleGroups: InitiativeGroup[],
): ActionableRow[] {
  const groupByInitiative = new Map(cycleGroups.map((g) => [g.initiativeId, g]));
  const rows: ActionableRow[] = [];
  for (const i of initiatives) {
    if (i.status === 'pending' && i.ready && i.workItems === undefined) {
      rows.push({ kind: 'plan', initiativeId: i.initiativeId, title: i.title });
    } else if (i.status === 'pending' && i.ready && i.workItems !== undefined) {
      rows.push({ kind: 'start', initiativeId: i.initiativeId, title: i.title });
    } else if (i.status === 'failed') {
      const group = groupByInitiative.get(i.initiativeId);
      rows.push({
        kind: 'failed',
        initiativeId: i.initiativeId,
        title: i.title,
        // The run link carries the CYCLE id (a run handle), never the bare
        // initiative id — honest absence when no cycle was ever observed.
        runHref: group ? `/flows/forge-develop/run/${encodeURIComponent(group.activeCycleId)}` : null,
      });
    }
  }
  // Failed first (needs a human), then plan, then start — a stable, honest
  // "what needs me now" ordering.
  const rank = { failed: 0, plan: 1, start: 2 } as const;
  return rows.sort((a, b) => rank[a.kind] - rank[b.kind] || a.initiativeId.localeCompare(b.initiativeId));
}
