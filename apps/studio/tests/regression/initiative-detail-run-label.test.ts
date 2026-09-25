/**
 * forge-6gv.13.1 (projects-46) — the initiative drawer always labels its
 * newest run "active run", even for an 18-day-old FAILED cycle.
 *
 * THE DEFECT: `InitiativeDetail.tsx`'s run dig-in labels `runCycleIds[0]`
 * "active run" unconditionally (`idx === 0 ? 'active run' : 'prior run'`) —
 * `cycle-grouping.ts`'s own doc comment on `activeCycleId` says what it
 * actually means: "cycleId of the **most recent attempt**", not "currently
 * running". A cycle that finished (successfully or not) days ago is still
 * the most recent attempt and still lands at `runCycleIds[0]`, so it read
 * as "active run" regardless of its own status.
 *
 * THE FIX: `InitiativeDetail` already receives `status` — the initiative's
 * own current status, on the SAME vocabulary as `Cycle['status']`
 * (`'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' |
 * 'pending'`, `lib/bridge-client.ts`'s `RoadmapInitiative`/`Cycle` types) —
 * so no new prop is needed. Reuses this repo's existing terminal-status SSOT
 * (`COST_TERMINAL_CYCLE_STATUSES`, `lib/cycle-cost-cache.ts`: merged/done/
 * failed) rather than a second, possibly-diverging list: `runCycleIds[0]`
 * reads "active run" only when `status` is NOT terminal; a terminal status
 * reads "last run" instead — distinct from "prior run" (an OLDER, superseded
 * attempt), naming instead "the most recent attempt, already concluded".
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/initiative-detail-run-label.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InitiativeDetail } from '../../components/studio/InitiativeDetail';

const BASE = {
  expanded: true,
  initiativeId: 'INIT-2026-09-08-x',
  dependsOnInitiatives: [],
  blocked: false,
  blockedBy: [],
  unplanned: false,
  wiLevels: null,
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

test('RED forge-6gv.13.1: a FAILED status on the newest cycle reads "last run", never "active run"', () => {
  const html = render({ status: 'failed', runCycleIds: ['CY-1'] });
  expect(html).toContain('last run');
  expect(html).not.toContain('active run');
});

test('RED forge-6gv.13.1: a "done" status on the newest cycle also reads "last run"', () => {
  const html = render({ status: 'done', runCycleIds: ['CY-1'] });
  expect(html).toContain('last run');
  expect(html).not.toContain('active run');
});

test('a genuinely non-terminal status (in-flight) on the newest cycle still reads "active run"', () => {
  const html = render({ status: 'in-flight', runCycleIds: ['CY-1'] });
  expect(html).toContain('active run');
  expect(html).not.toContain('last run');
});

test('an OLDER attempt (idx > 0) still reads "prior run", regardless of the newest cycle\'s status', () => {
  const html = render({ status: 'failed', runCycleIds: ['CY-2', 'CY-1'] });
  expect(html).toContain('prior run');
  expect(html).toContain('CY-1');
});

test('data-run-active stays "true" on a terminal newest run — the label and data-run-live carry the terminal fact, not the attribute', () => {
  // T2 review (forge-6gv.13.1): S10.story.mjs binds `<cycleId>` off
  // `[data-run-active="true"][data-run-cycle-id]` and documents
  // data-run-active="true" as meaning NEWEST, NOT RUNNING. Gating this
  // attribute on `status` would strand that story beat the moment the
  // newest run concludes. The terminal fact belongs on the label and on
  // the new, separate `data-run-live` attribute instead.
  const failedHtml = render({ status: 'failed', runCycleIds: ['CY-1'] });
  expect(failedHtml).toContain('data-run-active="true"');
  expect(failedHtml).toContain('data-run-live="false"');
  expect(failedHtml).toContain('last run');

  const liveHtml = render({ status: 'in-flight', runCycleIds: ['CY-1'] });
  expect(liveHtml).toContain('data-run-active="true"');
  expect(liveHtml).toContain('data-run-live="true"');
  expect(liveHtml).toContain('active run');
});
