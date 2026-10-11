/**
 * forge-mfv5.1.34 (D-49) — the recovery panel says WHICH Requeue it will run
 * before the operator presses it: a FAILED initiative whose manifest records
 * project-manager validation errors gets a repair-mode Requeue (the errors are
 * listed, the approved plan is kept); anything else gets today's re-run.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InitiativeDetail } from '../../components/studio/InitiativeDetail';

const BASE = {
  expanded: true,
  initiativeId: 'INIT-2026-10-11-i2-apply-engine-terraform-retired',
  status: 'failed',
  dependsOnInitiatives: [],
  blocked: false,
  blockedBy: [],
  unplanned: false,
  wiLevels: null,
  runCycleIds: ['CY-1'],
  plan: { state: 'idle' } as never,
  canStartDevelopment: false,
  develop: { state: 'idle' } as never,
  attempt: { attemptCount: 1, priorCycleIds: [] },
  recoveryDetail: null,
  recoveryBusy: false,
  recoveryNote: '',
  onInspectRecovery: () => {},
  onRecoveryAction: () => {},
};
const D18 = 'WI-3: creates lists 7 path(s), exceeding the D-18 sizing bound of 5 — split into smaller work items';

const render = (extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(React.createElement(InitiativeDetail as never, { ...BASE, ...extra } as never));

test('D-49: recorded PM errors → the panel announces a repair-mode Requeue and lists every error', () => {
  const html = render({ pmRepairErrors: [D18, 'AC5 (uncarried: `python3 -m pytest tests/`)'] });
  expect(html).toContain('data-recovery-requeue-mode="repair"');
  expect(html).toContain('the approved plan is kept');
  expect(html.match(/data-recovery-repair-error/g)?.length).toBe(2);
  expect(html).toContain('exceeding the D-18 sizing bound of 5');
});

test('D-49: no recorded errors → the panel announces today\'s Requeue', () => {
  const html = render();
  expect(html).toContain('data-recovery-requeue-mode="standard"');
  expect(html).not.toContain('data-recovery-repair-error');
});
