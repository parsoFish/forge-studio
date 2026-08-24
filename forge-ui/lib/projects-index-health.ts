/**
 * projects-index-health — the projects roster's health signal (W8-C3 WI-1;
 * projects-08 / forge-j1e / bead forge-6gv.13.2).
 *
 * The defect: `/projects` rendered an identical card for every project, so a
 * contract-broken project — gitpulse, whose `.forge/project.json` is still on
 * the R1-03 flat gate keys and which `GET /api/studio/projects/:id/
 * contract-stages` already 409s on — was visually indistinguishable from a
 * fully-onboarded, buildable one.
 *
 * THE STRUCTURAL RULE (wave-8 exit row 4). Health is DERIVED, on every
 * render, from its source of truth. Concretely:
 *
 *   · the source of truth is `.forge/project.json` on disk;
 *   · the server judges it per request by running the REAL validator the
 *     orchestrator runs the project through (`validateProjectConfig`), and
 *     ships that verdict as `Project.configHealth` — nothing is persisted;
 *   · `fetchStudioProjects` PARSES that verdict fail-closed (absent/garbage →
 *     `'unknown'`, never `'ok'`);
 *   · this module maps the verdict to a display level, and every renderer
 *     calls it. There is no `health` field on `Project`, no `health` prop on
 *     `ProjectCard`, and no cache — so there is nowhere for a stale copy to
 *     live and nothing for a writer to forget to update. `ProjectCard` has
 *     exactly ONE consumer today (grep-verified, and pinned by the test beside
 *     this file); the point of giving it no `health` prop is that the SECOND
 *     consumer cannot introduce a disagreement, because there is no value for
 *     it to pass.
 *
 * PURE on purpose (mirrors `./sessions-index-filter.ts` and `./home-view.ts`):
 * no fetch, no DOM, no React — unit-testable without a mount.
 *
 * See `./projects-index-health.test.ts` for the acceptance contract.
 */

import type { Project } from './studio-client';

/**
 * The display levels, in escalation order.
 *
 * · `healthy`   — the config validates; forge can build this project.
 * · `attention` — onboarding is unfinished (no `.forge/project.json` yet).
 *                 Recoverable by finishing onboarding, not a breakage.
 * · `broken`    — the config is present and REJECTED (unparseable, unreadable,
 *                 or rejected by the validator). A cycle against this project
 *                 cannot load its contract.
 * · `unknown`   — the server said nothing we could parse. Honest ignorance;
 *                 never rounded up to `healthy`.
 */
export const PROJECT_HEALTH_LEVELS = ['healthy', 'attention', 'broken', 'unknown'] as const;

export type ProjectHealthLevel = (typeof PROJECT_HEALTH_LEVELS)[number];

export type ProjectHealth = {
  level: ProjectHealthLevel;
  /** Short display token for the chip — the level, spelled for a human. */
  label: string;
  /**
   * Why, in the words of whatever judged it. Empty for `healthy`. Never
   * re-worded here: a re-worded copy is a second source of truth that drifts
   * from the validator the moment either side changes.
   */
  reasons: string[];
};

const LABELS: Record<ProjectHealthLevel, string> = {
  healthy: 'ready',
  attention: 'onboarding unfinished',
  broken: 'contract broken',
  unknown: 'health unknown',
};

/**
 * Derive one project's health. The ONE place the mapping lives.
 *
 * Returns a fresh object every call and mutates nothing on `project` — the
 * caller must never be able to end up holding a health value that outlives
 * the roster read it came from.
 */
export function deriveProjectHealth(project: Project): ProjectHealth {
  const config = project.configHealth;
  const reasons: string[] = [];
  let level: ProjectHealthLevel;

  if (config === undefined || config.state === 'unknown') {
    level = 'unknown';
  } else if (config.state === 'ok') {
    level = 'healthy';
  } else if (config.state === 'unconfigured') {
    level = 'attention';
  } else {
    level = 'broken';
  }

  // The reason is carried verbatim from whoever judged, for every level that
  // has one. `healthy` never invents one.
  if (level !== 'healthy' && config?.reason) reasons.push(config.reason);

  return { level, label: LABELS[level], reasons };
}

export type ProjectHealthSummary = Record<ProjectHealthLevel, number>;

/**
 * Roster rollup. Derived from `deriveProjectHealth` — the same function the
 * cards call — so the summary and the cards can never disagree. The counts
 * always sum to the roster size: every project lands in exactly one bucket,
 * including the ones we know nothing about.
 */
export function summariseProjectHealth(projects: readonly Project[]): ProjectHealthSummary {
  const summary: ProjectHealthSummary = { healthy: 0, attention: 0, broken: 0, unknown: 0 };
  for (const project of projects) summary[deriveProjectHealth(project).level] += 1;
  return summary;
}
