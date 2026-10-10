/**
 * forge-nk1y.12 (D-48) — InitiativeDetail renders "Add work item" ONLY at the
 * Kickoff gate (`status === 'awaiting-kickoff'`), and AFTER Start development
 * so the gate's primary act stays first (D-46).
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/initiative-detail-kickoff-add.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InitiativeDetail } from '../../components/studio/InitiativeDetail';

const BASE = {
  expanded: true, initiativeId: 'INIT-2026-10-09-stranded-kickoff', dependsOnInitiatives: [], blocked: false, blockedBy: [],
  unplanned: false, wiLevels: null, runCycleIds: [], plan: { status: 'idle', error: null } as never,
  canStartDevelopment: true, develop: { status: 'idle', error: null } as never, onStart: () => {},
  attempt: { attemptCount: 1, priorCycleIds: [] }, recoveryDetail: null, recoveryBusy: false, recoveryNote: '',
  onInspectRecovery: () => {}, onRecoveryAction: () => {},
};
const render = (status: string): string =>
  renderToStaticMarkup(React.createElement(InitiativeDetail as never, { ...BASE, status } as never));

test('at the Kickoff gate: Add work item renders, after Start development', () => {
  const html = render('awaiting-kickoff');
  expect(html).toContain('data-component="kickoff-add-work-item"');
  expect(html.indexOf('data-action="start-development"')).toBeGreaterThan(-1);
  expect(html.indexOf('data-action="start-development"')).toBeLessThan(html.indexOf('data-component="kickoff-add-work-item"'));
});

test('anywhere else: no Add work item', () => {
  for (const status of ['pending', 'ready-for-review', 'in-flight', 'failed']) {
    expect(render(status)).not.toContain('data-component="kickoff-add-work-item"');
  }
});
