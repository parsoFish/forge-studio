/**
 * W7-B7 (artifact-plan-18/-25) — the ONE initiative-id resolution rule for
 * every verdict-posting surface on the /artifact page.
 *
 * The verdict routes validate `INIT-YYYY-MM-DD-slug`; run handles in the UI
 * are routinely CYCLE ids (`<timestamp>_<initiativeId>` — the timestamp
 * segment carries no `_`). DemoReviewSurface had this recovery privately
 * while GateBar and ReviewVerdictForm posted the raw handle and 400'd — two
 * verdict surfaces, two id rules. Now all three resolve through here (the
 * bridge additionally recovers server-side: packages/flows/bridge-studio-runs.ts
 * `recoverInitiativeId` — defence in depth, same rule).
 */

/**
 * Prefer `initiativeId` when it already looks like an initiative id;
 * otherwise pull the id out of the `<timestamp>_<initiativeId>` cycle id.
 * Falls back to the given `initiativeId` verbatim when neither recovers —
 * the route's own validation stays the authority.
 */
export function effectiveInitiativeId(initiativeId: string, cycleId: string): string {
  if (/^INIT-/.test(initiativeId)) return initiativeId;
  const idx = cycleId.indexOf('_');
  const fromCycle = idx >= 0 ? cycleId.slice(idx + 1) : cycleId;
  return /^INIT-/.test(fromCycle) ? fromCycle : initiativeId;
}
