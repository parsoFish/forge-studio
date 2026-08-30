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

import { MAX_KICKOFF_COST_CEILING_USD, kickoffCeilingInvalidReason, reconcileProjectPrefill, reconcileSelectPrefill } from './kickoff-form';
import { MAX_KICKOFF_COST_CEILING_USD as SSOT_MAX } from '@forge/contracts';

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

// ---------------------------------------------------------------------------
// W8-B3 (sessions-kinds-R03) — the prefill rule generalised to the `?kb=`
// field. Only the project prefill was ever routed through it; the kickoff
// page's own comment admitted the KB select was "seeded directly from" the raw
// query, and the result was the exact shape this rule exists to stop:
// /sessions/kb-cleanup/new?kb=not-a-real-kb showed the "select a KB…"
// placeholder while Start stayed ENABLED and POSTed the invisible value (404).
// ---------------------------------------------------------------------------

test('R03: a prefill naming a real roster id seeds the select', () => {
  expect(reconcileSelectPrefill('forge-dev', ['cycles', 'forge-dev'])).toEqual({ selected: 'forge-dev', unknownPrefill: null });
});

test('R03: a prefill the roster does not know NEVER seeds the select — it surfaces instead, so Start cannot submit what the operator cannot see', () => {
  expect(reconcileSelectPrefill('not-a-real-kb', ['cycles', 'forge-dev'])).toEqual({ selected: '', unknownPrefill: 'not-a-real-kb' });
});

test('R03: an absent prefill is not an unknown one — no notice, no value', () => {
  expect(reconcileSelectPrefill('', ['cycles'])).toEqual({ selected: '', unknownPrefill: null });
});

test('R03: an EMPTY roster (a failed or still-loading fetch) refuses the prefill rather than trusting it — fail closed, not open', () => {
  expect(reconcileSelectPrefill('forge-dev', [])).toEqual({ selected: '', unknownPrefill: 'forge-dev' });
});

test('R03: reconcileProjectPrefill is a thin alias over the SAME rule — the two fields cannot drift apart again', () => {
  for (const [prefill, roster] of [['a', ['a', 'b']], ['zzz', ['a', 'b']], ['', ['a']], ['a', []]] as const) {
    const generic = reconcileSelectPrefill(prefill, roster);
    const project = reconcileProjectPrefill(prefill, roster);
    expect(project).toEqual({ project: generic.selected, unknownPrefill: generic.unknownPrefill });
  }
});
