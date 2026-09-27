/**
 * `parseRun`'s `operatorStop` field-parity pin (M7 row 150, bead
 * forge-8vfn.8.1.39, ruling 1774) — split out of
 * studio-client.test.ts's monolithic FIELD-PARITY PIN test in round 3
 * (ruling 1794 round 3, file-size) so that file returns to its baseline.
 *
 * `operatorStop` is the same "declared-data-fails-open" hazard `stopOnBudget`
 * (W8-A2, ON-7 defect 2) already pins in the monolith: `parseRun` spreads it
 * in via `carryWireFieldIfDefined` (run-wire-field.ts) only when the raw
 * payload actually carries the key, so a regression that silently drops the
 * field on the way through would leave `parsed.operatorStop` `undefined`
 * rather than `true` — this test fails exactly there.
 */
import { test, expect } from 'vitest';
import { parseRun } from '../../lib/studio-client';

test('parseRun: carries operatorStop through verbatim (M7 row 150, ruling 1774)', () => {
  const parsed = parseRun({ id: 'CYCLE-operator-stop-probe', operatorStop: true });
  expect(parsed.operatorStop, 'operatorStop was dropped (undefined) by parseRun').toBe(true);
});

test('parseRun: an absent operatorStop key stays undefined, never defaulted to false', () => {
  const parsed = parseRun({ id: 'CYCLE-operator-stop-absent' });
  expect(parsed.operatorStop).toBeUndefined();
});
