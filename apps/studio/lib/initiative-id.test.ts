/**
 * W7-B7 pins (artifact-plan-18/-25) — one id-resolution rule for every
 * verdict surface. The bug class: GateBar and ReviewVerdictForm posted the
 * raw `?run=` handle (a cycle id) where the bridge validates INIT-…, so the
 * demo gate 400'd invisibly and the no-demo fallback form 400'd inline while
 * its sibling DemoReviewSurface — with a private copy of this recovery —
 * worked. RUN: cd forge-ui && npx vitest run lib/initiative-id.test.ts
 */
import { test, expect } from 'vitest';

import { effectiveInitiativeId } from './initiative-id';

test('an INIT- id passes through regardless of the cycle id', () => {
  expect(effectiveInitiativeId('INIT-2026-07-11-cli-sort-flag', 'whatever')).toBe('INIT-2026-07-11-cli-sort-flag');
});

test('a cycle-id handle recovers its embedded initiative id', () => {
  expect(effectiveInitiativeId('', '2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag')).toBe('INIT-2026-07-11-cli-sort-flag');
  expect(
    effectiveInitiativeId('2026-01-01T00-00-00_INIT-r6-06-agent-ledger-flow-node', '2026-01-01T00-00-00_INIT-r6-06-agent-ledger-flow-node'),
  ).toBe('INIT-r6-06-agent-ledger-flow-node');
});

test('unrecoverable: the given initiativeId is returned verbatim (the route stays the validator)', () => {
  expect(effectiveInitiativeId('nonsense', 'also_nonsense')).toBe('nonsense');
});
