/**
 * Row 159 (bead forge-8vfn.8.1.47, ruling 1891), part (c) CLASSIFY — an
 * architect draft-manifest validation error that survived its one bounded
 * repair turn must classify as a deterministic, named architect-phase
 * failure — never "failure could not be classified" — mirroring
 * `failure-classifier.pm-acceptance-gate.test.ts`'s own rationale for row
 * 157 (kept in its own file: `unit/failure-classifier.test.ts` has no
 * baseline headroom).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import { ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX } from '@forge/contracts';
import type { EventLogEntry } from '@forge/kernel';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'architect-session-sess-1',
    started_at: '2026-09-27T22-54-57.000Z',
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

/** The real shape (S10 run 41's evidence, `architect-draft-repair.ts`): a
 *  `log` start event, then the repair's own classified `error` event, whose
 *  MESSAGE carries the shared prefix — the same field the thrown Error's
 *  `.message` carries onto `status.json.error`. */
function realWorldEvents(): EventLogEntry[] {
  return [
    ev({ event_type: 'start' }),
    ev({
      event_id: 'e2',
      message: 'architect.draft-repair.start',
      metadata: {
        session_id: 'sess-1',
        validation_error:
          'architect draft "exclude-author-flag": acceptance_criteria[8].given must be a non-empty string',
      },
    }),
    ev({
      event_id: 'e3',
      event_type: 'error',
      message:
        'architect.draft-repair.end: ' +
        `${ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX} architect draft "exclude-author-flag": ` +
        'acceptance_criteria[8].given must be a non-empty string',
      metadata: { session_id: 'sess-1', outcome: 'unresolved' },
    }),
  ];
}

test(
  'classifyCycleFailure: architect draft-manifest-unresolved → terminal, non-recoverable, ' +
    'not environment, no resumeFrom (architect has no scheduler resume point)',
  () => {
    const c = classifyCycleFailure(realWorldEvents());
    assert.equal(c.kind, 'terminal', 'a fresh draft re-derives the identical validation error — no retry');
    assert.equal(c.recoverable, false);
    assert.equal(c.environment, false, 'this is a decomposition/validation defect, not API pressure');
    assert.equal(c.resumeFrom, undefined, 'the architect is interactive, not a develop-flow cycle');
    assert.doesNotMatch(c.reason, /could not be classified/);
  },
);

test('classifyCycleFailure: an UNPREFIXED architect error does not set the flag', () => {
  // Regression lock: the classifier keys on the shared PREFIX inside an
  // `architect`-phase error event, never a bare substring scan of prose a
  // project's own test/log output could carry.
  const events = [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'error',
      message: 'architect runner: draft step returned no initiatives after a forced-emit retry',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.doesNotMatch(c.reason, /draft-manifest validation failed/);
});

test('classifyCycleFailure: the SAME prefix outside phase "architect" is phase-scoped, not set', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: `unrelated: ${ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX} some other agent echoed this text`,
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.doesNotMatch(c.reason, /draft-manifest validation failed/);
});
