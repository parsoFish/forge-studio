/**
 * Pure helpers for the opt-in release process (WS-A · final-loop / release).
 *
 * A project that declares `releaseProcess` in its `.forge/project.json` opts
 * into a three-seam release flow:
 *   1. an IN-CYCLE draft changelog (these helpers feed the PM standing-AC set
 *      + the unifier brief);
 *   2. a POST-APPROVAL PRE-MERGE finalisation phase (the `release-finalize`
 *      runner consumes `releaseFinalizeSteps`);
 *   3. a CI release on merge (forge ships the workflow template, never runs it).
 *
 * This module is intentionally PURE — no IO, no SDK, no orchestration. It maps
 * a `ReleaseConfig` to the standing-AC text + step lists the phases compose. A
 * project WITHOUT `releaseProcess` is byte-for-byte unchanged: every helper
 * returns an empty list when handed `undefined`.
 */

import type { ReleaseConfig, ReleaseStep } from './studio/types.ts';

/** Default changelog path used in AC prose when the project does not declare one. */
const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * The `phase: 'in-cycle'` `kind: 'changelog'` steps, rendered as standing
 * acceptance-criteria text. These are concatenated into the project's
 * standing-AC set by the PM so EVERY work item in a release-bearing initiative
 * carries the draft-changelog requirement. Returns `[]` when the project has
 * no `releaseProcess` (no opt-in) or declares no in-cycle changelog steps.
 *
 * The text is intentionally the DRAFT requirement only — the finalised entry
 * (semver bump, category roll-up) is the pre-merge finaliser's job, not the
 * dev-loop's. The draft is the fallback if finalisation later fails.
 */
export function releaseDraftAcs(cfg: ReleaseConfig | undefined): string[] {
  if (!cfg) return [];
  const changelogPath = cfg.changelogPath ?? DEFAULT_CHANGELOG_PATH;
  const drafts = cfg.steps.filter((s) => s.phase === 'in-cycle' && s.kind === 'changelog');
  if (drafts.length === 0) return [];
  const acs: string[] = [
    `Release contract — DRAFT CHANGELOG: this initiative contributes a release. Add a draft changelog entry to \`${changelogPath}\` under an \`## [Unreleased]\` heading describing the user-visible behaviour change (one bullet per work item, categorised Added/Changed/Fixed). The DRAFT is what ships in the PR; the finalised version (semver bump) is applied post-approval, before merge.`,
  ];
  for (const step of drafts) {
    acs.push(`Release draft step — ${step.text}`);
  }
  return acs;
}

/**
 * The `phase: 'pre-merge'` steps the post-approval finaliser runs. Returned in
 * declaration order. Empty when the project has no `releaseProcess` or declares
 * no pre-merge steps (a project that only drafts a changelog in-cycle and lets
 * CI do everything else is valid — the finaliser then just computes the semver
 * bump + promotes the draft, with no extra steps).
 */
export function releaseFinalizeSteps(cfg: ReleaseConfig | undefined): ReleaseStep[] {
  if (!cfg) return [];
  return cfg.steps.filter((s) => s.phase === 'pre-merge');
}

/**
 * Whether a project has opted into the release process at all. A single source
 * of truth for the opt-in gate so the PM, unifier, and finaliser agree.
 */
export function hasReleaseProcess(cfg: ReleaseConfig | undefined): cfg is ReleaseConfig {
  return cfg !== undefined && Array.isArray(cfg.steps);
}
