/**
 * W8-B4 FIX-1 — the ONE enumeration of "which single file at an authoring
 * session's `staging/` root identifies the drafted package's shape",
 * client-side half of the mirror.
 *
 * The defect this module exists to close: `kind:'template'` (W8-B4/WI-3)
 * was taught to the server's DEDICATED finalize route
 * (`cli/bridge-studio-authoring.ts`'s `runFinalize`) but never to the
 * GENERIC verdict route's own copy of this rule
 * (`cli/bridge-studio-affordances.ts`'s `deriveAuthoringPackageKind`) — the
 * route the operator's real Approve button actually calls
 * (`POST /api/studio/sessions/authoring/:id/awaiting-review-verdict`,
 * dispatched via `postSessionAffordance`) — so drafting a template worked
 * end to end but approving it 409'd forever. The rule was hand-copied into
 * THREE places with no cross-check; this lane fixes the third and adds one.
 *
 * This is the CLIENT-side copy of `cli/bridge-studio-affordances.ts`'s own
 * exported `AUTHORING_PACKAGE_SHAPES` — hand-mirrored, never a cross-
 * boundary import (forge-ui never imports cli/ at runtime; see
 * forge-ui/lib/session-lifecycle-client.ts's own header, and
 * forge-ui/lib/session-client.ts's "no-cross-boundary-import convention").
 * Kept honest by `cli/authoring-package-shape-parity.test.ts`, which is a
 * NODE-SIDE TEST (not part of either production bundle) that imports BOTH
 * arrays directly — a plain, framework-free TS module under forge-ui/lib/
 * (no JSX, no 'use client', no Next-only API) IS importable by a
 * `node --experimental-strip-types --test` file, exactly as
 * `cli/id-rule.test.ts` already does with `forge-ui/lib/
 * project-save-payload.ts` — and fails the moment the two arrays disagree,
 * so a shape added on one side and forgotten on the other is a RED test,
 * not a silent gap.
 *
 * WITHIN forge-ui itself there is no such boundary: every forge-ui
 * consumer of this rule (`SessionInteractivePanel.tsx`'s `draftShapeOf` /
 * `FinalizedLink` / the package-id field label, `session-verdict-gate.ts`'s
 * `DraftShape` type) imports THIS one module directly — a real single
 * source of truth on this side of the fence, not a third hand-copy.
 */

/** The set of package kinds an authoring session can drive to `committed`
 *  (`runFinalize`'s own `kind` parameter, cli/bridge-studio-authoring.ts). */
export type AuthoringPackageKind = 'skill' | 'hook' | 'template';

export type AuthoringPackageShape = {
  /** The ONE canonical staging-root filename that marks this shape (e.g.
   *  `staging/SKILL.md`) — mirrors that file's own one-canonical-name-
   *  per-shape convention. */
  readonly filename: string;
  readonly kind: AuthoringPackageKind;
};

/** Order matters only in that it is the order `deriveAuthoringPackageKind`
 *  (cli) checks presence in — irrelevant here since a real drafted package
 *  never carries two marker files at once, but kept identical to the
 *  server array so `assert.deepEqual` in the parity test is a true
 *  byte-for-byte comparison, not just a same-elements-any-order one. */
export const AUTHORING_PACKAGE_SHAPES: readonly AuthoringPackageShape[] = [
  { filename: 'SKILL.md', kind: 'skill' },
  { filename: 'hook.yaml', kind: 'hook' },
  { filename: 'template.md', kind: 'template' },
];

/** `true` iff `value` is one of the kinds this file's array declares —
 *  the ONE membership check every consumer that used to hand-roll
 *  `x === 'skill' || x === 'hook'` should call instead, so a shape added
 *  here is a shape every such check recognises for free. */
export function isAuthoringPackageKind(value: unknown): value is AuthoringPackageKind {
  return AUTHORING_PACKAGE_SHAPES.some((s) => s.kind === value);
}

/** Derives a drafted package's shape purely by file PRESENCE among the
 *  paths a `file-package` artifact carries — the ONE derivation
 *  `SessionInteractivePanel.tsx`'s `draftShapeOf` delegates to. `'unknown'`
 *  when none of the marker filenames is present (still drafting, or a
 *  file-package artifact this rule does not describe at all — historically
 *  the now-retired community-refresh kind's registry.yaml + evidence.* draft,
 *  W8-B5b WI-3; the same "unknown, by design" fallback covers whatever kind
 *  reuses `file-package` for a non-skill/hook/template shape next). */
export function authoringPackageKindOf(paths: readonly string[]): AuthoringPackageKind | 'unknown' {
  const match = AUTHORING_PACKAGE_SHAPES.find((s) => paths.includes(s.filename));
  return match ? match.kind : 'unknown';
}
