/**
 * Kickoff-form shared rules (W7-B6 review F2 + F8) — the ONE place the two
 * kickoff forms (`components/NewIdeaBox.tsx` and
 * `app/sessions/[kind]/new/page.tsx`) get their project-prefill and
 * cost-ceiling validation from, so the rules cannot drift between them
 * (crosscut-21 / crosscut-25).
 */

/**
 * W7-B6 review F8 — parity-tested MIRROR of
 * `orchestrator/config.ts`'s `MAX_KICKOFF_COST_CEILING_USD` (forge-ui cannot
 * import orchestrator code at runtime; `lib/kickoff-form.test.ts` imports the
 * SSOT and pins equality, same pattern as `lib/wi-status-parity.test.ts`).
 * The bridge 400s any ceiling above this — validating it client-side keeps
 * the disabled-explains-itself contract (crosscut-25) instead of a post-hoc
 * server round-trip.
 */
export const MAX_KICKOFF_COST_CEILING_USD = 500;

/**
 * Why a typed cost-ceiling value cannot be submitted, or `null` when it can.
 * `undefined` = blank field = "send nothing" — always valid.
 */
export function kickoffCeilingInvalidReason(ceilingUsd: number | undefined): string | null {
  if (ceilingUsd === undefined) return null;
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) {
    return 'the cost ceiling must be a positive number (or blank)';
  }
  if (ceilingUsd > MAX_KICKOFF_COST_CEILING_USD) {
    return `the cost ceiling must be at most $${MAX_KICKOFF_COST_CEILING_USD} (or blank)`;
  }
  return null;
}

/**
 * W7-B6 review F2 — reconcile a `?project=` prefill against the loaded
 * roster. A prefill naming a real roster id seeds the select; anything else
 * (a deleted project, a pre-B6 NAME-based link, junk) yields an empty select
 * plus the offending value for an honest `data-unknown-project` notice —
 * never a hidden non-roster value a still-enabled Start would submit.
 */
export function reconcileProjectPrefill(
  prefill: string,
  rosterIds: readonly string[],
): { project: string; unknownPrefill: string | null } {
  if (prefill === '') return { project: '', unknownPrefill: null };
  return rosterIds.includes(prefill)
    ? { project: prefill, unknownPrefill: null }
    : { project: '', unknownPrefill: prefill };
}
