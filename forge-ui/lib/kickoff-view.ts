/**
 * Pure view helpers for the generic session-kickoff screen
 * (app/sessions/[kind]/new/page.tsx) — W7-B3 (community-08 / community-12).
 *
 * Testability convention mirrors session-shell-view.ts: no DOM, no React, no
 * network — tiny derivations the page renders verbatim, pinned by
 * lib/kickoff-view.test.ts so the kickoff card can never regress to the
 * `<forge-anchor>` placeholder or an unchecked model radiogroup again.
 */

import { COMMUNITY_REGISTRY_ANCHOR } from './session-shell-view';

/**
 * The tier to pre-select when the operator has not chosen one: the FIRST
 * (cheapest) entry of the SKILL-declared envelope — the SAME default
 * `resolveSessionModel` applies server-side when the request omits
 * `modelTier`, so the checked radio always names what will actually run.
 * Empty string for a fixed-strategy agent (no choice exists; the picker
 * renders its read-only chip instead).
 */
export function defaultKickoffTier(allowedTiers: readonly string[]): string {
  return allowedTiers[0] ?? '';
}

/**
 * The session-directory preview line on the kickoff context card. A
 * selector-less kind anchors under the ONE fixed pseudo-project
 * (`.community-registry`) — shown for real, never as a `<forge-anchor>`
 * placeholder (community-12).
 */
export function sessionDirPreview(kind: string, selector: 'project' | 'kb' | 'none', project: string): string {
  // W7-B3 review F9: the anchor is keyed on the KIND, not the selector shape
  // — `.community-registry` is community-refresh's OWN pseudo-project. A
  // future selector-less kind gets the honest generic placeholder below, not
  // a real-looking path under an anchor it does not use (the community-12
  // fabricated-context-card class).
  if (kind === 'community-refresh') return `projects/${COMMUNITY_REGISTRY_ANCHOR}/_${kind}/<sessionId>`;
  if (selector === 'none') return `projects/<anchor>/_${kind}/<sessionId>`;
  if (selector === 'kb') return `projects/<kb-project>/_${kind}/<sessionId>`;
  return `projects/${project.trim() || '<project>'}/_${kind}/<sessionId>`;
}

/** A brief is only a brief when the operator actually typed one — trimmed;
 *  whitespace-only input is no brief at all (the POST omits the field and
 *  the agent runs the full refresh). */
export function briefFromPrompt(prompt: string): string | undefined {
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
