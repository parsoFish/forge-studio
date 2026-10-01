/**
 * Pseudo-project session anchors — pure transfer from
 * `packages/sessions/session-resolution.ts` (ADR 046 boundary fix,
 * `studio-beyond-contracts` edge 3). A project id starting with "." is NEVER
 * a real registered project: `discoverProjects` (`@forge/kernel`)
 * categorically filters every dot-prefixed directory out of the real project
 * list.
 *
 * `packages/sessions/session-resolution.ts` re-exports both symbols (and
 * still uses `COMMUNITY_REFRESH_PROJECT_ANCHOR` in `invalidProjectReason`);
 * `apps/studio/lib/session-shell-view.ts` re-exports them too (the latter
 * under its own established `COMMUNITY_REGISTRY_ANCHOR` name). Both were
 * previously independent, hand-kept mirrors held in step by a parity test
 * (`apps/studio/tests/contract/session-shell-view.test.ts`'s AT-104/AT-104b);
 * with one definition here, the two call sites can no longer drift, so that
 * parity test was removed rather than repointed.
 */

/** The retired community-refresh session kind's fixed, dot-prefixed pseudo
 *  project anchor. The kind that used to mint sessions under it is gone
 *  (W8-B5b), but historical sessions still live on disk under this anchor,
 *  and the studio session shell still maps it to `/community`. */
export const COMMUNITY_REFRESH_PROJECT_ANCHOR = '.community-registry';

/** General check: ANY leading-"." project id is a pseudo-anchor, not an
 *  enumerated allow-list of the two known shapes (`.kb-<id>`,
 *  `.community-registry`) — a third, unrecognised dot-prefixed anchor still
 *  trips this, it just resolves to no known destination downstream. */
export function isPseudoProjectAnchor(project: string): boolean {
  return project.startsWith('.');
}
