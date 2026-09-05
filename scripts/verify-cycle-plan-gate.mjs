/**
 * The plan gate's one decision, as a pure function (bead forge-8vfn.6.10.8).
 *
 * The completeness critic can block finalize with findings, and the harness
 * plays the operator's acknowledge role — ONCE, because the critic is one-shot
 * per session. Until this landed, that acknowledge was unconditional: G1 run 4
 * printed `[high] the PLAN … pivots to a completely different initiative … no
 * relationship to the idea` and re-approved on the next line. The severity was
 * parsed, printed, and enforced nowhere.
 *
 * FAIL CLOSED. Only a severity this function RECOGNISES as non-blocking is
 * acknowledged; a missing, null, numeric or unknown severity blocks, because
 * the harness cannot tell "the critic found nothing serious" from "the critic
 * said something this parser does not understand" — and the second is not a
 * thing to spend a costed run on.
 *
 * A pure function so it is exercised by tests rather than only by a live run
 * (§15.163): a predicate that needs $12 to reach is a predicate nobody reaches.
 */

/** Severities the harness may acknowledge on the operator's behalf. Everything else blocks. */
const ACKNOWLEDGEABLE = new Set(['medium', 'low', 'info']);

/**
 * @param {unknown} findings the critic's `status.completenessCritic.findings`
 * @returns {{ acknowledge: boolean, blocking: Array<{severity: unknown, gap: unknown}>, reason: string }}
 *   `acknowledge` — re-approve once, the critic's one-shot contract.
 *   `blocking`    — the findings that must stop the run, in the order given.
 *   `reason`      — a line naming the severity and quoting the gap, for the
 *                   thrown error, so a stopped run says WHY.
 *   `log`         — the lines the harness prints, owned here so the printed
 *                   severity and the acted-on severity are the SAME read. The
 *                   defect this closes was exactly a print and a decision that
 *                   had drifted apart.
 */
export function classifyCriticFindings(findings) {
  if (!Array.isArray(findings)) {
    const reason = 'completeness-critic findings were not an array — the harness cannot read this payload and will not approve past it';
    return { acknowledge: false, blocking: [], reason, log: [reason] };
  }
  if (findings.length === 0) {
    const reason = 'no completeness-critic findings — nothing to acknowledge';
    return { acknowledge: false, blocking: [], reason, log: [reason] };
  }

  const blocking = findings.filter((f) => {
    const severity = typeof f?.severity === 'string' ? f.severity.trim().toLowerCase() : null;
    return severity === null || !ACKNOWLEDGEABLE.has(severity);
  });

  const listed = findings.map((f) => `  - [${String(f?.severity ?? 'unknown')}] ${String(f?.gap ?? '(no gap text)')}`);
  const header = `completeness critic blocked finalize with ${findings.length} finding(s):`;

  if (blocking.length === 0) {
    const reason = `${findings.length} completeness-critic finding(s), none blocking — acknowledging once (one-shot critic)`;
    return { acknowledge: true, blocking: [], reason, log: [header, ...listed, 're-approving to acknowledge (one-shot critic semantics)…'] };
  }

  const detail = blocking.map((f) => `[${String(f?.severity ?? 'unknown')}] ${String(f?.gap ?? '(no gap text)')}`).join('; ');
  const reason = `plan gate REFUSED: ${blocking.length} completeness-critic finding(s) the harness may not acknowledge for the operator — ${detail}`;
  return { acknowledge: false, blocking, reason, log: [header, ...listed, reason] };
}
