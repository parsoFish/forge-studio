/**
 * projects-index-filter — pure filter / sort / search derivation for the
 * `/projects` index (W8-C3 WI-3; projects-08 / forge-j1e / bead
 * forge-6gv.13.2).
 *
 * The defect: the index had no filter, no sort and no search — a static mirror
 * of the bridge's id-order with no operator lever at all. That is the same
 * defect `home-sessions-07` closed for `/sessions` in W7-B1, and this module
 * deliberately mirrors `./sessions-index-filter.ts` so the two indexes behave
 * the same way rather than each inventing their own filtering idiom.
 *
 * PURE on purpose (same contract as that precedent and as `./home-view.ts`):
 * no fetch, no DOM, no React. `ProjectsIndexBody` holds the filter STATE and
 * calls in here, so the behaviour is unit-testable without a mount.
 *
 * TWO RULES CARRIED OVER, both earned:
 *
 *  1. The DEFAULT sort is the SERVER's order, untouched — a filter only
 *     removes rows. Three live journeys (`home`, `stand-up-onboard`,
 *     `stand-up-create`) read `[data-section="projects-grid"]`'s own count and
 *     card order; a default re-sort would silently move them, and it would
 *     hide the bridge's own ordering contract behind a client preference.
 *  2. `filterOptions` keeps an ACTIVE value in the option list even after a
 *     refetch removes its last row. A controlled `<select>` whose value has no
 *     matching option silently displays "all …" while the stale constraint
 *     keeps filtering — contradictory UI, and a real defect W7-B1 hit.
 *
 * EVERY predicate here derives from `./projects-index-health.ts` and
 * `./projects-index-activity.ts` — the SAME functions the cards call. A filter
 * carrying its own copy of "what broken means" is a second source of truth,
 * and it would drift the first time either definition moved.
 *
 * See `./projects-index-filter.test.ts` for the acceptance contract.
 */

import type { Project } from './studio-client';
import type { Cycle, ProjectAttentionItem } from './bridge-client';
import { deriveProjectHealth, type ProjectHealthLevel } from './projects-index-health';
import { deriveProjectActivity, type ProjectActivity } from './projects-index-activity';

/** `''` = the server's own order, untouched (the default). */
export const PROJECT_SORTS = ['', 'name', 'activity', 'health'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** `''` on a field = no constraint (the "all" option). */
export type ProjectFilters = {
  search: string;
  /** One of `PROJECT_HEALTH_LEVELS`, matched against the DERIVED level. */
  health: string;
  sort: ProjectSort;
  needsYouOnly: boolean;
};

export const NO_PROJECT_FILTERS: ProjectFilters = { search: '', health: '', sort: '', needsYouOnly: false };

/** The raw sources every derivation in here reads. Passed, never cached. */
export type ProjectFilterSources = {
  attention: readonly ProjectAttentionItem[];
  cycles: readonly Cycle[];
};

/**
 * A whitespace-only search is NOT a constraint — it is what a stray keystroke
 * leaves behind, and treating it as one empties the roster and reads as "no
 * projects". Judged on the TRIMMED value everywhere, so `hasActiveProjectFilters`
 * and `applyProjectFilters` can never disagree about it.
 */
export function hasActiveProjectFilters(f: ProjectFilters): boolean {
  return f.search.trim() !== '' || f.health !== '' || f.sort !== '' || f.needsYouOnly;
}

/**
 * Whether this project is waiting on the operator.
 *
 * Three ways, and they are enumerated deliberately rather than collapsed into
 * "is anything queued": planned/in-flight work is forge working, not the
 * operator being asked. What actually needs a human is a GATED initiative (a
 * verdict is pending), a FLAGGED plan (the PM's own completeness check said
 * so), or a contract that is not healthy (forge cannot build the project until
 * someone fixes it). `unknown` health counts: we cannot say it is fine.
 */
export function projectNeedsYou(project: Project, activity: ProjectActivity): boolean {
  if (deriveProjectHealth(project).level !== 'healthy') return true;
  if (activity.queue === null) return false;
  return activity.queue.gated > 0 || activity.queue.flagged > 0;
}

function matchesSearch(project: Project, needle: string): boolean {
  const haystacks = [project.id, project.name, project.northStar ?? ''];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/** Worst-first, so the projects that need the operator sort to the top. */
const HEALTH_RANK: Record<ProjectHealthLevel, number> = { broken: 0, attention: 1, unknown: 2, healthy: 3 };

/**
 * Filter, then sort. Returns a NEW array; never mutates the input roster or any
 * element of it (the standing "return new objects, never mutate inputs" rule —
 * the roster is React state owned by the page).
 */
export function applyProjectFilters(
  projects: readonly Project[],
  f: ProjectFilters,
  sources: ProjectFilterSources,
): Project[] {
  const needle = f.search.trim().toLowerCase();

  const kept = projects.filter((project) => {
    if (needle !== '' && !matchesSearch(project, needle)) return false;
    if (f.health !== '' && deriveProjectHealth(project).level !== f.health) return false;
    if (f.needsYouOnly && !projectNeedsYou(project, deriveProjectActivity(project.id, sources.attention, sources.cycles))) return false;
    return true;
  });

  if (f.sort === '') return kept;

  const byName = (a: Project, b: Project) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

  if (f.sort === 'name') return [...kept].sort(byName);

  if (f.sort === 'health') {
    // Tie-broken by name so the order is deterministic — an unstable order on
    // a page the operator scans is its own small defect.
    return [...kept].sort((a, b) => {
      const rank = HEALTH_RANK[deriveProjectHealth(a).level] - HEALTH_RANK[deriveProjectHealth(b).level];
      return rank !== 0 ? rank : byName(a, b);
    });
  }

  // sort === 'activity' — most recent first. A project with no USABLE activity
  // sorts LAST, never first: the same rule `sortLedgerRowsNewestFirst` states
  // for a row with no usable `when`, and for the same reason (a naive
  // `new Date(x).getTime()` key yields NaN, whose comparator behaviour is
  // implementation-defined and can float such a row to the top of "most
  // recent").
  const activityMs = (project: Project): number | null => {
    const iso = deriveProjectActivity(project.id, sources.attention, sources.cycles).lastActivityIso;
    if (iso === null) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  return [...kept].sort((a, b) => {
    const aMs = activityMs(a);
    const bMs = activityMs(b);
    if (aMs === null && bMs === null) return byName(a, b);
    if (aMs === null) return 1;
    if (bMs === null) return -1;
    return bMs - aMs;
  });
}

/** Distinct values in FIRST-SEEN order — the option list offers only levels
 *  that actually exist in the current roster, never a hardcoded list that
 *  could drift from reality (`./sessions-index-filter.ts`'s own rule). */
export function distinctProjectHealthLevels(projects: readonly Project[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const project of projects) {
    const level = deriveProjectHealth(project).level;
    if (!seen.has(level)) {
      seen.add(level);
      out.push(level);
    }
  }
  return out;
}

/** See rule 2 in this file's header. Identical contract to
 *  `./sessions-index-filter.ts`'s `filterOptions`. */
export function filterOptions(present: readonly string[], active: string): string[] {
  return active !== '' && !present.includes(active) ? [...present, active] : [...present];
}
