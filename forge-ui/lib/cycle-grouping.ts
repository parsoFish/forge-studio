/**
 * Pure grouping utilities over raw `Cycle` records (forge-refinement plan
 * 1.6 — "roadmap page rework: initiative-centric, not cycle-centric").
 *
 * `GET /api/cycles` already collapses to the latest log dir per initiative
 * server-side (`cli/ui-bridge.ts::scanCycles`'s `latestPerInit` map), but any
 * consumer working from a wider cycle history — or a future endpoint that
 * surfaces every attempt — can still see more than one `Cycle` per
 * `initiativeId`: a resume/requeue after a crash or send-back produces a new
 * cycle log dir without erasing the prior one. These functions make that
 * collapse a pure, tested operation (one card per initiative, prior attempts
 * kept as a compact count) instead of leaving it inline and untested in
 * whichever page happens to render cycles.
 */
import type { Cycle } from './bridge-client';

export type InitiativeGroup = {
  initiativeId: string;
  project?: string;
  status: Cycle['status'];
  /** cycleId of the most recent attempt — what the card's status/links reflect. */
  activeCycleId: string;
  dependsOnInitiatives?: string[];
  /** Total distinct cycles observed for this initiative (always >= 1). */
  attemptCount: number;
  /** cycleIds of earlier attempts, most-recent-first, excluding the active one. */
  priorCycleIds: string[];
};

export type ProjectTrack = {
  project: string;
  initiatives: InitiativeGroup[];
};

const UNASSIGNED_PROJECT = 'unassigned';

/**
 * Collapse a raw cycle list to one group per initiative.
 *
 * The "active" cycle for a given initiative is the one with the
 * lexicographically-greatest `cycleId`: cycle IDs are formatted
 * `<ISO-ish-timestamp>_<initiativeId>` (see `cli/ui-bridge.ts`), so string
 * comparison is a correct recency ordering without relying on the caller
 * having pre-sorted `cycles`.
 *
 * Groups are returned newest-active-cycle-first.
 */
export function groupCyclesByInitiative(cycles: Cycle[]): InitiativeGroup[] {
  const byInitiative = new Map<string, Cycle[]>();
  for (const cycle of cycles) {
    const bucket = byInitiative.get(cycle.initiativeId);
    if (bucket) {
      bucket.push(cycle);
    } else {
      byInitiative.set(cycle.initiativeId, [cycle]);
    }
  }

  const groups: InitiativeGroup[] = [];
  for (const [initiativeId, attempts] of byInitiative) {
    const ordered = [...attempts].sort((a, b) => b.cycleId.localeCompare(a.cycleId));
    const [active, ...prior] = ordered;
    groups.push({
      initiativeId,
      project: active.project,
      status: active.status,
      activeCycleId: active.cycleId,
      dependsOnInitiatives: active.dependsOnInitiatives,
      attemptCount: ordered.length,
      priorCycleIds: prior.map((c) => c.cycleId),
    });
  }

  return groups.sort((a, b) => b.activeCycleId.localeCompare(a.activeCycleId));
}

/**
 * Bucket initiative groups into per-project tracks, alpha-sorted by project
 * name. Groups with no `project` fall into a shared "unassigned" track
 * rather than being dropped.
 */
export function groupInitiativesByProject(groups: InitiativeGroup[]): ProjectTrack[] {
  const byProject = new Map<string, InitiativeGroup[]>();
  for (const group of groups) {
    const project = group.project ?? UNASSIGNED_PROJECT;
    const bucket = byProject.get(project);
    if (bucket) {
      bucket.push(group);
    } else {
      byProject.set(project, [group]);
    }
  }

  return [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, initiatives]) => ({ project, initiatives }));
}
