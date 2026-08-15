/**
 * Tests for `gate-verdict-body.ts` — the pure body-builder GateBar uses to
 * shape its postGate calls (W6-SW-3 reviewer HIGH finding). No DOM, no
 * React, no network — this repo has no jsdom/@testing-library/react
 * harness for forge-ui components, so GateBar's body-construction logic is
 * pulled into a pure function here and asserted directly, per the
 * established convention (agent-builder-view.ts, run-panel-view.ts).
 *
 * The bug being pinned: GateBar's Approve button worked for plan gates
 * (verdict:'approve' already satisfies the bridge's kind ternary), but
 * Send-back was a dead control — verdict:'send-back' fell through to
 * kind:'' and the bridge 400s "unknown kind: ''". The fix additionally
 * re-keys the operator's typed `notes` to `rationale` for the plan-gate
 * path, since applyPlanVerdict only ever reads `rationale` for the
 * feedback.md text it writes on a 'revise'.
 */
import { test, expect } from 'vitest';

import { buildGateVerdictBody } from './gate-verdict-body';

// ---------------------------------------------------------------------------
// gateId==='plan' — the path this fix repairs
// ---------------------------------------------------------------------------

test('buildGateVerdictBody: plan gate approve — carries project, no kind (verdict alone satisfies the route)', () => {
  expect(buildGateVerdictBody('plan', 'approve', { project: 'demo' })).toEqual({
    project: 'demo',
  });
});

test('buildGateVerdictBody: plan gate approve — project omitted when unresolved (never a fabricated empty string)', () => {
  expect(buildGateVerdictBody('plan', 'approve', {})).toEqual({ project: undefined });
});

test('buildGateVerdictBody: plan gate send-back — carries kind:"revise" so the route\'s kind ternary matches', () => {
  const body = buildGateVerdictBody('plan', 'send-back', { notes: 'needs another pass', project: 'demo' });
  expect(body.kind).toBe('revise');
});

test('buildGateVerdictBody: plan gate send-back — re-keys notes to rationale, the only field the route reads', () => {
  const body = buildGateVerdictBody('plan', 'send-back', { notes: 'needs another pass', project: 'demo' });
  expect(body.rationale).toBe('needs another pass');
  expect(body).not.toHaveProperty('notes');
});

test('buildGateVerdictBody: plan gate send-back — full body shape (the exact wire contract this fix repairs)', () => {
  expect(buildGateVerdictBody('plan', 'send-back', { notes: 'needs another pass', project: 'demo' })).toEqual({
    project: 'demo',
    kind: 'revise',
    rationale: 'needs another pass',
  });
});

// ---------------------------------------------------------------------------
// gateId==='verdict' (demo gates) — pre-existing contract, untouched
// ---------------------------------------------------------------------------

test('buildGateVerdictBody: demo/verdict gate approve — empty body (unchanged)', () => {
  expect(buildGateVerdictBody('verdict', 'approve', { project: 'demo' })).toEqual({});
});

test('buildGateVerdictBody: demo/verdict gate send-back — still sends notes, no kind/rationale/project (unchanged)', () => {
  expect(buildGateVerdictBody('verdict', 'send-back', { notes: 'needs more work' })).toEqual({
    notes: 'needs more work',
  });
});
