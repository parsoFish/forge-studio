/**
 * run-panel-gating — W7-D1: the ONE derivation behind everything `RunPanel`
 * disables, and the run state it disables against.
 *
 * Extracted from `RunPanel.tsx` because the defect the Wave D gate found was
 * not visible from the component's rendered output: the lock depended on
 * effect-driven state (`fetchLatestStandaloneRun`'s reattach, the poll's
 * `pollExhausted` flag), and `renderToStaticMarkup` runs no effects. As a
 * pure function it is exhaustively testable — see `run-panel-gating.test.ts`
 * for the three rulings and the live evidence behind them.
 *
 * The shape of the bug, in one line: an agent whose last standalone run died
 * without a terminal marker could never be run again, because the panel
 * reattached to it, believed it 'running' forever, and disabled every control
 * on the surface — with no reason on any of them.
 */

/** Terminal-or-idle states a run can be reported in. Only 'running' means
 *  "something is happening right now"; everything else is history. */
const IN_FLIGHT_STATE = 'running';

export type RunGatingInput = {
  /** The agent is saved, has a slug, and carries no unsaved edits. */
  canRun: boolean;
  /** A bound connection is not ready (or its readiness is not known yet).
   *  `''` means no block. */
  blockedMessage: string;
  /** This agent cannot be dispatched standalone at all (a ralph loop). */
  standaloneBlockedReason: string | null;
  /** A dispatch POST is on the wire right now. */
  dispatching: boolean;
  /** What the panel currently believes about its run — see {@link runStateOf}. */
  runState: string;
  /** The bounded watch gave up (`pollAgentRun`'s `onTimeout`). The run may
   *  still be alive server-side; what ended is our OBSERVATION of it. */
  pollExhausted: boolean;
};

export type RunGating = {
  /** The project select, inputs textarea, cost ceiling and materials input. */
  formDisabled: boolean;
  formDisabledReason: string | null;
  /** The Run button alone. */
  runDisabled: boolean;
  runDisabledReason: string | null;
};

/** The hint shown when the agent itself is not in a runnable shape. Kept as a
 *  constant because `RunPanel`'s title attribute and this reason must be the
 *  same string, not two hand-written near-copies. */
export const SAVE_TO_RUN_HINT = 'Save the agent (no unsaved changes) to run it';
export const RUN_IN_FLIGHT_REASON = 'A run is already in flight';
export const DISPATCHING_REASON = 'Dispatching…';

/**
 * Why the whole surface is unusable, or `null` if it is usable. These are
 * facts about the AGENT (or about a request already on the wire), never about
 * a run that happens to have been dispatched earlier — editing the next run's
 * project while one is in flight harms nothing.
 */
function formBlockReason(i: RunGatingInput): string | null {
  if (i.standaloneBlockedReason) return i.standaloneBlockedReason;
  if (i.blockedMessage) return i.blockedMessage;
  if (!i.canRun) return SAVE_TO_RUN_HINT;
  if (i.dispatching) return DISPATCHING_REASON;
  return null;
}

export function deriveRunGating(i: RunGatingInput): RunGating {
  const formDisabledReason = formBlockReason(i);
  // A run blocks a SECOND dispatch only while we are actively observing it.
  // Once `pollExhausted` is set the panel already renders a 'timed-out' chip;
  // it cannot also claim a run is in flight, and leaving the claim standing is
  // what bricked the surface for every run that died without a terminal event.
  const observedRunning = i.runState === IN_FLIGHT_STATE && !i.pollExhausted;
  const runDisabledReason = formDisabledReason ?? (observedRunning ? RUN_IN_FLIGHT_REASON : null);
  return {
    formDisabled: formDisabledReason !== null,
    formDisabledReason,
    runDisabled: runDisabledReason !== null,
    runDisabledReason,
  };
}

/**
 * What the panel believes about its run, in strict precedence:
 *
 *   1. a real polled status — always wins;
 *   2. the status of the ledger row a run id was REATTACHED from (W7-B5
 *      agents-26) — a fact we already have, so there is nothing to guess;
 *   3. a run id this panel DISPATCHED with no status yet — honestly still
 *      being watched (W6-B14), so 'running';
 *   4. no run at all — 'idle'.
 *
 * Step 2 is the fix: before it, a reattached id fell through to step 3 and the
 * panel fabricated 'running' for a run the ledger had already reported done.
 */
function runStateOf(i: {
  status: { state: string } | null | undefined;
  runId: string | null;
  reattachedStatus: string | null;
}): string {
  if (i.status) return i.status.state;
  if (!i.runId) return 'idle';
  return i.reattachedStatus ?? IN_FLIGHT_STATE;
}

deriveRunGating.runStateOf = runStateOf;

export { runStateOf };
