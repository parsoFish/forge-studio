/**
 * W7-B6 review F2 + F8 — kickoff-form shared-rule pins.
 *
 * F8: the client ceiling validation checked finite-and-positive but not the
 * server's MAX_KICKOFF_COST_CEILING_USD cap — an over-cap value left Start
 * enabled and failed only after a server round-trip, contradicting the
 * crosscut-25 disabled-explains-itself contract the same PR extends. The cap
 * here is a MIRROR (forge-ui can't import orchestrator at runtime); the
 * parity test below imports the SSOT and pins equality, following
 * lib/wi-status-parity.test.ts's pattern.
 *
 * F2: the generic kickoff page seeded its project select from the raw
 * ?project= prefill with no roster validation — a stale/name-based prefill
 * rendered a BLANK select while Start stayed enabled and submitted the
 * invisible stale value. Killed implementation: `useState(prefillProject)`
 * with no reconciliation.
 *
 * RUN: npx vitest run lib/kickoff-form.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';

import {
  MAX_KICKOFF_COST_CEILING_USD,
  kickoffCeilingInvalidReason,
  reconcileProjectPrefill,
} from './kickoff-form';
import { MAX_KICKOFF_COST_CEILING_USD as SSOT_MAX } from '../../orchestrator/config.ts';

test('parity: the mirrored ceiling cap equals orchestrator/config.ts\'s MAX_KICKOFF_COST_CEILING_USD (SSOT)', () => {
  expect(MAX_KICKOFF_COST_CEILING_USD).toBe(SSOT_MAX);
});

test('kickoffCeilingInvalidReason (F8): blank valid; positive-under-cap valid; at-cap valid (server accepts exactly-at-max); over-cap NAMES the cap; non-positive/NaN invalid', () => {
  expect(kickoffCeilingInvalidReason(undefined)).toBeNull();
  expect(kickoffCeilingInvalidReason(2.5)).toBeNull();
  expect(kickoffCeilingInvalidReason(MAX_KICKOFF_COST_CEILING_USD)).toBeNull();
  expect(kickoffCeilingInvalidReason(MAX_KICKOFF_COST_CEILING_USD + 1)).toMatch(/\$500/);
  expect(kickoffCeilingInvalidReason(0)).toMatch(/positive/);
  expect(kickoffCeilingInvalidReason(-1)).toMatch(/positive/);
  expect(kickoffCeilingInvalidReason(Number.NaN)).toMatch(/positive/);
});

test('reconcileProjectPrefill (F2): roster hit seeds the select; a non-roster prefill yields an EMPTY select + the value for the data-unknown-project notice; blank is quiet', () => {
  expect(reconcileProjectPrefill('gitpulse', ['gitpulse', 'mdtoc'])).toEqual({ project: 'gitpulse', unknownPrefill: null });
  expect(reconcileProjectPrefill('Deleted Project Name', ['gitpulse'])).toEqual({ project: '', unknownPrefill: 'Deleted Project Name' });
  expect(reconcileProjectPrefill('', ['gitpulse'])).toEqual({ project: '', unknownPrefill: null });
});
