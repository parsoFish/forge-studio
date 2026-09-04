/**
 * architect-phase.mjs — which architect session phases END a wait, in failure.
 *
 * ONE source of truth, and it exists because two loops disagreed. Before
 * M4-flows' G1, `verify-cycle.mjs` had two wait loops over the same
 * `status.json` — the interview poll and the finalize poll — and each
 * open-coded its own terminal list. Both handled `rejected`; NEITHER handled
 * `failed`.
 *
 * A real cycle then refused at 04:40 with `no manifest ports were injected`,
 * and the interview loop kept sleeping 4 s against its 25-minute deadline,
 * emitting nothing. From outside, "still working" and "failed thirteen minutes
 * ago" were the same observation — the shape COMMON §15.92 names: a check whose
 * negative result is indistinguishable from nothing to report.
 *
 * A shared list cannot be half-updated the way two open-coded ones can, which
 * is the point: the fix is the shape, not the extra branch.
 */

/**
 * @param {{phase?: string, error?: string} | null | undefined} status
 * @param {string} where  optional context, e.g. 'during finalize'
 * @returns {string | null} the message to throw, or null while the session lives
 */
export function architectFailurePhase(status, where = '') {
  const phase = status?.phase;
  const at = where ? ` ${where}` : '';
  if (phase === 'rejected') return `architect session was rejected${at}`;
  if (phase === 'failed') {
    return `architect session FAILED${at}: ${status?.error ?? '(no error recorded in status.json)'}`;
  }
  return null;
}
