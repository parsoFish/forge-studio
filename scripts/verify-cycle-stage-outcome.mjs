/**
 * verify-cycle-stage-outcome.mjs — did a `forge serve --once` stage actually
 * succeed? Bead forge-8vfn.6.10.6.
 *
 * WHY THIS EXISTS. On 2026-09-04 (G1 run 3) the architect stage's serve pass
 * printed `PM FAILED …` and `· cycle ERROR: project-manager phase failed …`, and
 * `verify-cycle.mjs` handed off to develop nine seconds later — because
 * `runServeStage` returned nothing and the caller had nothing to consult. The
 * initiative went on to merge to a real project on a work-item set its own
 * validation had rejected.
 *
 * It is a PURE function of the serve output so it can be tested without a live
 * run: a predicate only a $7 cycle can exercise is a predicate nobody exercises
 * (§15.163). Same shape, and same reason, as `ci-terminal.sh classify`.
 *
 * Ordering of the predicates matters and mirrors §15.154: a failure marker is
 * decisive whatever else the pass printed, and SILENCE IS NOT SUCCESS — a stage
 * that produced no outcome line has demonstrated nothing (§15.92).
 */

/** `· cycle ERROR: <reason>` — the serve loop's own terminal-failure marker. */
const CYCLE_ERROR = /·\s*cycle ERROR:\s*(.+)$/;
/** `· PM FAILED` — the phase verdict, which may sit on a line whose agent-turn
 *  `subtype=success` says the opposite (bead forge-8vfn.6.1). Read the phase. */
const PHASE_FAILED = /·\s*(PM|DEV|REVIEW|DEMO|REFLECT) FAILED\b/;
/** `· cycle done` / `· cycle <status>` — evidence the pass reached an outcome. */
const CYCLE_OUTCOME = /·\s*cycle (done|complete|started|[a-z-]+)\b/;

/**
 * @param {readonly string[]} lines stdout+stderr of one `forge serve --once` pass
 * @returns {{ ok: boolean, errors: string[] }} `errors` carries each reason verbatim
 */
export function classifyServeStageOutcome(lines) {
  const errors = [];
  let sawOutcome = false;

  for (const line of lines) {
    const m = CYCLE_ERROR.exec(line);
    if (m) { errors.push(m[1].trim()); sawOutcome = true; continue; }
    if (PHASE_FAILED.test(line)) { errors.push(line.trim()); sawOutcome = true; continue; }
    if (CYCLE_OUTCOME.test(line)) sawOutcome = true;
  }

  if (errors.length > 0) return { ok: false, errors };
  if (!sawOutcome) {
    return {
      ok: false,
      errors: ['the serve stage printed no cycle outcome at all — nothing was demonstrated, so the hand-off is refused'],
    };
  }
  return { ok: true, errors: [] };
}
