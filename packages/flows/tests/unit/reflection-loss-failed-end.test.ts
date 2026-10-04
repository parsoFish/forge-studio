/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qh (2) — a lost
 * reflection now writes its start's own `reflector.end` carrying the failed
 * marker (`status: 'failed'`, `errorEndMetadata`). Flows readers apply the
 * row-206 reader rule (`endMetaIndicatesFailure`): an end so marked is never a
 * recovery and never a completed reflection.
 *
 * Fixture rows are the R6j capture's (S10 `2026-10-02T05-13-08_…`), plus the
 * end the emitter now writes after the loss row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventLogEntry } from '@forge/kernel';
import { findReflectionLoss } from '../../run-model-derive-status.ts';
import { makeProgressTee } from '../../scheduler-run-one.ts';

const INIT = 'INIT-2026-10-02-exclude-author-flag-complete';
const base = {
  cycle_id: `2026-10-02T05-13-08_${INIT}`, initiative_id: INIT, phase: 'reflection', skill: 'reflector',
  input_refs: [] as string[], output_refs: [] as string[],
};
const START = { ...base, event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T05:59:03.187Z', event_type: 'start', message: 'reflector.start' } as EventLogEntry;
const LOST = {
  ...base, event_id: 'EV_muqkc78w_43etnnmk', parent_event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T06:09:22.352Z',
  event_type: 'error', message: 'cycle.reflection-lost',
  metadata: { cause: 'budget-exhausted', detail: 'reflector SDK run ended with result subtype "error_max_budget_usd" — reflection outputs are incomplete', result_subtype: 'error_max_budget_usd' },
} as EventLogEntry;
const FAILED_END = {
  ...base, event_id: 'EV_r207_failed_end', parent_event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T06:09:22.353Z',
  event_type: 'end', message: 'reflector.end',
  metadata: { status: 'failed', error: 'cycle.reflection-lost budget-exhausted: reflector SDK run ended with result subtype "error_max_budget_usd"' },
} as EventLogEntry;
const RERUN_START = { ...base, event_id: 'EV_muqkc7s4_3wrx4wzu', started_at: '2026-10-02T06:09:23.044Z', event_type: 'start', message: 'reflector.start' } as EventLogEntry;
const RERUN_END = {
  ...base, event_id: 'EV_muqkdcfe_zf9vr1q2', parent_event_id: 'EV_muqkc7s4_3wrx4wzu', started_at: '2026-10-02T06:10:15.722Z',
  event_type: 'end', message: 'reflector.end', metadata: { status: 'closed', result_subtype: 'success' },
} as EventLogEntry;

const opts = { queueComplete: true, isStale: false };

test('findReflectionLoss: the lost pass\'s own failed reflector.end does NOT recover the loss', () => {
  const loss = findReflectionLoss([START, LOST, FAILED_END], opts);
  assert.deepEqual(loss, { cause: 'budget-exhausted', note: LOST.metadata!['detail'] });
});

test('findReflectionLoss: a closed rerun end after the failed one still recovers it (R6j\'s real tail)', () => {
  assert.equal(findReflectionLoss([START, LOST, FAILED_END, RERUN_START, RERUN_END], opts), undefined);
});

test('findReflectionLoss: a failed end with no loss row on a stale done cycle reads interrupted, never complete', () => {
  const loss = findReflectionLoss([START, FAILED_END], { queueComplete: true, isStale: true });
  assert.equal(loss?.cause, 'interrupted');
});

test('progress tee: a failed reflector.end prints reflection FAILED, never reflection done', (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'log', (s: string) => { lines.push(s); });
  const tee = makeProgressTee();
  tee(FAILED_END);
  tee(RERUN_END);
  assert.match(lines[0], /reflection FAILED/);
  assert.doesNotMatch(lines[0], /reflection done/);
  assert.match(lines[1], /reflection done/);
});
