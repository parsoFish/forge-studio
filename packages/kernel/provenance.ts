/**
 * Server-side per-type provenance (bead forge-3oq, exit row 14).
 *
 * Moved from `cli/studio-provenance.ts` (M4-knowledge s5) — QUARRY:76 owns
 * this file to kernel, and its stated prerequisite is met by the same PR: the
 * pure-mapping test that used to live inside a 654-line bridge integration
 * test is now `provenance.test.ts` beside this module. A kernel module with
 * no package-level test is the shape this campaign exists to stop.
 *
 * Its real consumer was never legacy: `packages/knowledge/bridge-studio-kbs.ts`
 * had to import `cli/` to reach it, which is a `package-to-legacy` violation.
 * The mapping is a fact every package needs and none of them owns — kernel's
 * own charter, verbatim.
 *
 * `apps/studio/components/ProvenanceBadge.tsx` used to derive its badge from a
 * CLIENT-SIDE inference over `flow.origin`, and Flow was the only Studio
 * object type carrying a real per-object origin signal — a "universal" badge
 * for agent/project/kb would have been fabricated. This module is the ONE
 * shared origin->provenance mapping every server descriptor route uses
 * (`apps/forge/bridge-studio.ts`, `packages/knowledge/bridge-studio-kbs.ts`) so the mapping never
 * forks into a second, driftable copy.
 *
 * The n/a-invariant: a type (or object) the server cannot attest reports the
 * literal string 'unknown' — NEVER a guessed 'ootb'/'operator' badge. This
 * mirrors the antipattern `apps/studio/lib/skill-library-view.ts` already
 * refuses for skills (inventing a badge from a field that doesn't carry the
 * distinction is exactly the "declared data enforced nowhere" failure mode).
 */

/** The three honest provenance tokens a descriptor can carry. */
export type Provenance = 'ootb' | 'operator' | 'unknown';

/**
 * The ONE origin->provenance mapping every server descriptor shares.
 * `'seed'` and `'ootb-library'` are the two on-disk `origin:` values that
 * mean "shipped by forge, not created by the operator" (flow.yaml uses
 * `seed`; other origins may use `ootb-library` — both map to `'ootb'`).
 * `'studio'` means "created via the Studio UI/bridge" -> `'operator'`.
 * Anything else — absent, empty, or an unrecognized value — reports
 * `'unknown'` rather than guessing: a value this function has never seen is
 * not evidence of either provenance.
 */
export function provenanceOfOrigin(origin?: string | null): Provenance {
  if (origin === 'seed' || origin === 'ootb-library') return 'ootb';
  if (origin === 'studio') return 'operator';
  return 'unknown';
}

/**
 * Agents (`skills/<slug>/SKILL.md`) carry NO on-disk origin field — an OOTB
 * hand-authored agent and an operator-authored one are byte-indistinguishable
 * on disk. Named constant (not an inline literal) so this honest gap is
 * greppable, and flipping it the day a real signal lands (e.g. an
 * `origin:` frontmatter key) is a one-line edit here rather than a hunt
 * through every route that reads it.
 */
export const AGENT_PROVENANCE: Provenance = 'unknown';

/**
 * Studio has no "OOTB project" concept at all, and `discoverProjects` is a
 * pure directory scan over `projects/*` — the server has no field to read
 * that would let it attest either way. Named constant for the same
 * greppability reason as `AGENT_PROVENANCE`.
 */
export const PROJECT_PROVENANCE: Provenance = 'unknown';
