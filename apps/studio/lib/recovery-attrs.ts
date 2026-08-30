/**
 * Pure helpers backing the roadmap's recovery affordances (R4-11-T3 — the
 * standalone `/recovery` page folded onto `InitiativeCard`). Kept separate
 * from `page.tsx` so the "recoverable" state check + attempt-count lookup
 * get real unit coverage (`forge-ui`'s vitest config only exercises
 * `lib/**\/*.test.ts` — there is no component-test harness, so the DOM/JSX
 * wiring itself is covered by the `roadmap-recovery` journey beat instead).
 */
import type { InitiativeGroup } from './cycle-grouping';

// R4-11-F1 (carried over from the retired `/recovery` page): `merged` is
// deliberately EXCLUDED. It's a transient pass-through — closure promotes it
// on to `done/` in the same finalize sweep that lands it in `merged/` — never
// a parking state an operator needs to act on.
export const RECOVERABLE_STATUSES: ReadonlySet<string> = new Set([
  'in-flight',
  'ready-for-review',
  'failed',
]);

export function isRecoverableStatus(status: string): boolean {
  return RECOVERABLE_STATUSES.has(status);
}

export type AttemptInfo = { attemptCount: number; priorCycleIds: string[] };

const DEFAULT_ATTEMPT_INFO: AttemptInfo = { attemptCount: 1, priorCycleIds: [] };

/**
 * Look up an initiative's attempt count / prior cycle ids from the grouped
 * cycle list (`groupCyclesByInitiative` — a different data source than
 * `fetchRoadmap()`'s `RoadmapInitiative[]`, which doesn't carry attemptCount).
 * Falls back to a single-attempt default when no group is found (e.g. the
 * cycles fetch hasn't landed yet, or raced ahead of the roadmap fetch).
 */
export function attemptInfoFor(initiativeId: string, groups: InitiativeGroup[]): AttemptInfo {
  const match = groups.find((g) => g.initiativeId === initiativeId);
  return match
    ? { attemptCount: match.attemptCount, priorCycleIds: match.priorCycleIds }
    : DEFAULT_ATTEMPT_INFO;
}
