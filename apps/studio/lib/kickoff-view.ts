/**
 * Pure view helpers for the generic session-kickoff screen
 * (app/sessions/[kind]/new/page.tsx) — W7-B3 (community-08 / community-12).
 *
 * Testability convention mirrors session-shell-view.ts: no DOM, no React, no
 * network — tiny derivations the page renders verbatim, pinned by
 * lib/kickoff-view.test.ts so the kickoff card can never regress to the
 * `<forge-anchor>` placeholder or an unchecked model radiogroup again.
 */

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
 * The session-directory preview line on the kickoff context card.
 *
 * W7-B3 review F9 (historical): the anchor used to be keyed on the KIND, not
 * the selector shape, because the one selector-less kind that ever existed
 * (community-refresh, W6-CR-3) anchored under a real fixed pseudo-project
 * (`.community-registry`) rather than the honest generic placeholder below —
 * naming it explicitly kept the preview from looking like a real path under
 * an anchor it did not use (the community-12 fabricated-context-card class).
 * W8-B5b WI-3 retired that kind; no kind currently has `selector: 'none'`, so
 * every call falls through to the generic placeholder or the `kb`/`project`
 * branches below. The `'none'` branch stays as live generic mechanism for
 * whatever selector-less kind comes next — should THAT kind also need a real
 * (not placeholder) anchor, key it on its own kind id here, the same way.
 */
export function sessionDirPreview(kind: string, selector: 'project' | 'kb' | 'none', project: string): string {
  if (selector === 'none') return `projects/<anchor>/_${kind}/<sessionId>`;
  if (selector === 'kb') return `projects/<kb-project>/_${kind}/<sessionId>`;
  return `projects/${project.trim() || '<project>'}/_${kind}/<sessionId>`;
}

/**
 * The kickoff page's `main` data attributes.
 *
 * `data-minted-session-id` closes the sessions-owned half of bead
 * `forge-8vfn.5.10`: the page POSTs to its kind's `/start` route and
 * `router.push`es straight into the new session, so the id it just minted
 * appeared nowhere an observer could read — not to a story, not to a journey,
 * not to an operator whose navigation failed. The value is published on the
 * page that MINTED it, before it navigates away.
 *
 * It is the empty string until a session is minted, and empty is meaningful:
 * "this page has started nothing". A caller must not read absence and presence
 * as the same thing, which is why the key is always present rather than
 * conditionally spread — an attribute that appears only on success cannot be
 * distinguished from a page that never rendered it.
 */
export function kickoffMainData(kind: string, mintedSessionId: string): Record<string, string> {
  return { 'data-kickoff-kind': kind, 'data-minted-session-id': mintedSessionId };
}
