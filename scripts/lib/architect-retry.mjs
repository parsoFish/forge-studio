/**
 * architect-retry.mjs — the ONE stall `driveArchitect` (scripts/verify-cycle.mjs)
 * retries: a stream-deadline abort on the architect's structured turn
 * (packages/agents/stream-deadline.ts, `label: 'architect-structured'`,
 * packages/sessions/kinds/architect-steps.ts).
 *
 * THE DEFECT. A funded `verify-cycle.mjs` run threw `StreamDeadlineError` mid-
 * architect — the SDK stream produced no message for 360s, a usage-limit /
 * network stall the error's OWN message calls "transient; routes to auto-
 * retry" — and `driveArchitect` threw and ended the run. The retry the message
 * promises was never taken on THIS path: `classifyCycleFailure`
 * (packages/agents/failure-classifier.ts) only ever reads a CYCLE's own
 * events.jsonl, and the architect interview loop lives entirely in the
 * harness, upstream of any cycle — there is no events.jsonl for it to read.
 *
 * WHY `classifyCrash`, NOT A NEW REGEX. `packages/agents/failure-classifier.ts`
 * already carries the `'stream-deadline'` signature inside its
 * `TRANSIENT_CRASH_SIGNATURES` list (G3, plan 2.3 — used to classify a crashed
 * agent PROCESS before a cycle-level re-spawn). `architectFailurePhase`
 * (scripts/architect-phase.mjs) surfaces the architect session's failure only
 * as a free-text `status.json.error` string — there is no separate
 * `failure_kind` field on an architect session to match on structurally — so
 * reusing that classifier's verdict is the honest choice over hand-rolling a
 * second `stream-deadline` pattern in the harness that could silently drift
 * from the one `packages/agents` already owns.
 *
 * SCOPED NARROWLY, ON PURPOSE. `classifyCrash` also returns `transient` for
 * rate-limit / SIGKILL / network-reset signatures — those stay UN-retried on
 * this path. The defect this file closes is the one the error message names
 * (a stream-deadline stall); widening the harness's own retry to every
 * environment signature `classifyCrash` recognises is a separate ruling this
 * bead does not make.
 */
import { classifyCrash } from '@forge/agents';

/** The exact quoted signature `classifyCrash` embeds in its `reason` when it
 *  matches on `stream-deadline` (see `TRANSIENT_CRASH_SIGNATURES`,
 *  packages/agents/failure-classifier.ts). Reading it out of the classifier's
 *  own structured verdict — rather than re-testing the raw failure text a
 *  second time here — keeps this file down to one boolean case: "did the
 *  shared classifier name THIS signature", never a second copy of the pattern
 *  that could drift from the original. */
const STREAM_DEADLINE_SIGNATURE = '"stream-deadline"';

/**
 * True iff `failureMessage` (the free-text `architectFailurePhase` throw, i.e.
 * `status.json.error` verbatim) is the stream-deadline stall this file
 * retries — never a broader "was this transient" question.
 */
export function isArchitectStall(failureMessage) {
  if (typeof failureMessage !== 'string' || failureMessage.length === 0) return false;
  const classification = classifyCrash(failureMessage, null);
  return classification.kind === 'transient' && classification.reason.includes(STREAM_DEADLINE_SIGNATURE);
}

/**
 * True iff `driveArchitect` should start a FRESH architect session (the same
 * `POST /api/architect/start` the first attempt used) and retry, rather than
 * throw. `attempt` is the attempt that just failed — 1 for the first, real
 * session; a stall on attempt 2 (the retry itself) must not retry again, so
 * the harness stays bounded to exactly one retry.
 */
export function shouldRetryArchitect(failureMessage, attempt) {
  if (attempt >= 2) return false;
  return isArchitectStall(failureMessage);
}
