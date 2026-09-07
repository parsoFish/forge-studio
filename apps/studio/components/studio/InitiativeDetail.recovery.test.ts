/**
 * `InitiativeDetail` — abandon is arm-then-confirm on the roadmap drawer too.
 *
 * THE DEFECT (bead `forge-8vfn.7.5.5`, filed under T1 ruling 432 out of the S10
 * authoring census). ONE destructive act had TWO confirmation contracts:
 *
 *   run detail    `RunControls.tsx` — arm, then a visible
 *                 `[data-component="abandon-confirm"]` panel, then a second
 *                 press. Its own header records why: a double-click re-entered
 *                 with the guard already false and abandoned a run, deleting
 *                 its worktree and branch, without the operator ever seeing the
 *                 panel. "Deterministic, not a race."
 *   roadmap drawer `recovery-abandon` POSTed on the FIRST click, gated only by
 *                 `recoveryBusy`.
 *
 * Same act, same consequence — the initiative's worktree and branch are gone —
 * and the operator's protection depended on which screen they happened to be
 * looking at. This file pins the stricter contract on both.
 *
 * REQUEUE IS DELIBERATELY NOT GATED. It is recoverable, and a confirmation on a
 * safe act is how an operator learns to click through the one that is not.
 *
 * SCOPE. `renderToStaticMarkup` runs no click handler (no jsdom in this suite),
 * so the armed branch is reached through `initialPendingRecovery` — a prop that
 * exists for exactly that reason and defaults to none, leaving every caller
 * unchanged. A control below pins that default.
 *
 * RUN: npx vitest run components/studio/InitiativeDetail.recovery.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InitiativeDetail } from './InitiativeDetail';

const BASE = {
  expanded: true,
  initiativeId: 'INIT-2026-09-08-x',
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

const render = (extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(React.createElement(InitiativeDetail as never, { ...BASE, ...extra } as never));

test('7.5.5: the recovery row still offers all three acts', () => {
  const html = render();
  expect(html).toContain('data-action="recovery-inspect"');
  expect(html).toContain('data-action="recovery-requeue"');
  expect(html).toContain('data-action="recovery-abandon"');
});

test('7.5.5: abandon does NOT act on the first press — no confirm panel is rendered yet', () => {
  // NOT marked RED, deliberately: this one passes against the pre-fix code too,
  // for a different reason (there was no panel at all, rather than a panel that
  // is not yet armed). It is a guard on the ARM, not evidence of the fix — the
  // two cases that DID go red against the restored one-press abandon are the
  // armed panel and the disabled reason, and only those carry the (RED) mark.
  const html = render();
  expect(html).not.toContain('data-component="recovery-abandon-confirm"');
  expect(html).not.toContain('data-action="confirm-recovery-abandon"');
});

test('7.5.5 (RED): once armed, the drawer asks — naming the initiative and what is lost', () => {
  const html = render({ initialPendingRecovery: 'abandon' });
  expect(html).toContain('data-component="recovery-abandon-confirm"');
  expect(html).toContain('data-action="confirm-recovery-abandon"');
  expect(html).toContain('data-action="cancel-recovery-abandon"');
  // The consequence is stated, not implied: this is the press that deletes work.
  expect(html).toContain('worktree and branch are deleted');
  expect(html).toContain('INIT-2026-09-08-x');
});

test('7.5.5 POSITIVE CONTROL: REQUEUE is not gated — a confirm on a safe act teaches clicking through', () => {
  const html = render({ initialPendingRecovery: 'abandon' });
  // Only one confirm panel exists, and it is abandon's.
  expect(html).not.toContain('data-action="confirm-recovery-requeue"');
  expect(html).toContain('data-action="recovery-requeue"');
});

test('7.5.5 POSITIVE CONTROL: the default is unarmed — the prop makes a branch reachable, not the default', () => {
  expect(render()).not.toContain('data-component="recovery-abandon-confirm"');
});

test('7.5.5: a busy recovery says WHY both buttons are disabled', () => {
  // Without a reason a story can only report that a press did nothing, and an
  // operator can only guess. `disabledAttrs` drives disabled/title/data-* from
  // one nullable reason so they cannot drift.
  const html = render({ recoveryBusy: true });
  expect(html).toContain('data-disabled-reason="a recovery action is already running"');
});

test('7.5.5: a non-recoverable status renders no recovery block at all', () => {
  // The guard the block already had, pinned so the confirm work cannot widen it.
  expect(render({ status: 'done' })).not.toContain('data-recovery-item');
});
