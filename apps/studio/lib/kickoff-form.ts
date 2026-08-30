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
 * W7-B6 review F2 — reconcile a URL prefill against the loaded roster. A
 * prefill naming a real roster id seeds the select; anything else (a deleted
 * project, a pre-B6 NAME-based link, junk) yields an empty select plus the
 * offending value for an honest `data-unknown-*` notice — never a hidden
 * non-roster value a still-enabled Start would submit.
 *
 * W8-B3 (sessions-kinds-R03) — GENERALISED from `reconcileProjectPrefill` to
 * cover the `?kb=` prefill too. Only the project prefill was ever routed
 * through this rule; the kickoff page's own comment said so outright ("The
 * ?kb= prefill is kept as-is: the KB select is seeded directly from it"), and
 * the consequence was exactly the shape this function exists to prevent:
 * `/sessions/kb-cleanup/new?kb=not-a-real-kb` rendered the select showing its
 * "select a KB…" placeholder while Start stayed ENABLED and submitted the
 * invisible value into a 404. The server failed closed, so this was a
 * guard-SYMMETRY gap rather than data loss — but a control that submits a
 * value the operator cannot see is the defect either way, and the fix is one
 * shared rule rather than a second copy for the second field.
 */
export function reconcileSelectPrefill(
  prefill: string,
  rosterIds: readonly string[],
): { selected: string; unknownPrefill: string | null } {
  if (prefill === '') return { selected: '', unknownPrefill: null };
  return rosterIds.includes(prefill)
    ? { selected: prefill, unknownPrefill: null }
    : { selected: '', unknownPrefill: prefill };
}

/** The project-shaped alias, kept so existing callers read naturally. Thin by
 *  design — it must never grow a rule of its own. */
export function reconcileProjectPrefill(
  prefill: string,
  rosterIds: readonly string[],
): { project: string; unknownPrefill: string | null } {
  const { selected, unknownPrefill } = reconcileSelectPrefill(prefill, rosterIds);
  return { project: selected, unknownPrefill };
}
