/**
 * forge-8vfn.8.2.1 — the integrate band's delivery-gate failure must classify as
 * what it is.
 *
 * The classifier matched `'delivery gate: demo pipeline failed'`, a string the
 * executor stopped throwing when the band became `integrate` — so the branch
 * never fired and this failure fell through to another rule. Its own door built
 * that old message by hand, which is why nothing noticed: a door that types the
 * product's message instead of taking it from the product pins the typing.
 *
 * This door takes the message from the product's own builder (the one the
 * executor throws with) and hands it to the classifier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { integrateDeliveryFailure } from '@forge/stations/phases/executor-table.ts';
import { classifyCycleFailure } from '@forge/agents';
import type { EventLogEntry } from '@forge/kernel';

function orchestratorError(message: string): EventLogEntry {
  return {
    event_id: 'e1', cycle_id: 'CYCLE-x', initiative_id: 'INIT-x', started_at: '2026-09-19T00:00:00.000Z',
    phase: 'orchestrator', skill: 'cycle', event_type: 'error', message, input_refs: [], output_refs: [],
  };
}

test('the integrate delivery-gate throw classifies as the integrate band failing, terminal', () => {
  const c = classifyCycleFailure([orchestratorError(integrateDeliveryFailure('render-failed', 'the derived bundle never rendered'))]);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /integrate band failed/i);
  assert.doesNotMatch(c.reason, /reviewer-Ralph/i, 'it must not read as the reviewer failing to converge');
});
