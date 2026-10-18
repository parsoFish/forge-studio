/**
 * forge-mfv5.1.62: a Requeue re-classifies a failure from the events that caused it (requeue-resume.ts
 * `derivedFailureClassification`); a stored `failure_classification` is only the record. A fixture therefore
 * seeds the CAUSE — the events the current classifier reads as that class — and then the record, as cycle.ts writes it.
 */
import { COST_CEILING_MESSAGE_PREFIX, OPERATOR_STOP_MESSAGE_PREFIX, PM_SET_VALIDATION_UNREPAIRED_PREFIX } from '@forge/contracts';

export type FailureCause = 'environment' | 'operator-stop' | 'cost-ceiling' | 'plan' | 'pr-open' | 'review' | 'terminal';

const err = (initiativeId: string, phase: string, message: string, at: string): Record<string, unknown> => ({
  event_id: `cause-${phase}-${at}`, initiative_id: initiativeId, started_at: at, phase, skill: 'cycle', event_type: 'error', input_refs: [], output_refs: [], message,
});

/** The event(s) the classifier reads as `cause`, timestamped `at`. */
export function failureCauseEvents(cause: FailureCause, initiativeId: string, at = '2026-07-11T00:00:30.000Z'): Array<Record<string, unknown>> {
  switch (cause) {
    case 'environment': return [{ ...err(initiativeId, 'developer-loop', 'ralph.end', at), event_type: 'end', metadata: { status: 'failed', rate_limited: true } }];
    case 'operator-stop': return [err(initiativeId, 'orchestrator', `${OPERATOR_STOP_MESSAGE_PREFIX} operator stopped the run at a clean boundary`, at)];
    case 'cost-ceiling': return [err(initiativeId, 'orchestrator', `${COST_CEILING_MESSAGE_PREFIX} spend $5.10 crossed the $5.00 ceiling at a clean boundary`, at)];
    case 'plan': return [err(initiativeId, 'project-manager', `project-manager phase failed: ${PM_SET_VALIDATION_UNREPAIRED_PREFIX} WI-2 missing creates`, at)];
    case 'pr-open': return [err(initiativeId, 'orchestrator', 'reviewer.pr-open-failed: git push failed: Could not resolve host: github.com', at)];
    case 'review': return [err(initiativeId, 'orchestrator', 'adversarial review pipeline failed (budget-exhausted: src/x.ts is too large for review) — no findings artifact was produced', at)];
    case 'terminal': return [err(initiativeId, 'orchestrator', 'unifier did not pass its composed gate', at)];
  }
}

/** A `failure_classification` record exactly as cycle.ts writes it — `metadata` is whatever that code wrote then. */
export function failureClassificationRecord(initiativeId: string, metadata: Record<string, unknown>, at = '2026-07-11T00:01:00.000Z'): Record<string, unknown> {
  return { event_id: `record-${at}`, initiative_id: initiativeId, started_at: at, phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [], output_refs: [], message: 'failure_classification', metadata };
}
