/**
 * Bead `forge-mfut` — the budget stop is a DOM contract
 * (`docs/forge-ui-dom-and-harness.md`: `data-stop-on-budget`), and reverting
 * its render left the whole forge-ui suite green: `run-controls-view.test.ts`
 * pins the derivation (`runFailureNoteKind`), nothing pinned what the operator
 * SEES. These render the REAL `RunControls` and `RunRail` through
 * `react-dom/server` and kill two wrong worlds each: the attribute or the copy
 * dropped from a budget stop, and a budget stop's attribute leaking onto an
 * ordinary failure.
 */
import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/flows/forge-develop',
  useSearchParams: () => new URLSearchParams(),
}));

import { RunControls } from '../../components/studio/RunControls.tsx';
import { RunRail } from '../../components/studio/RunRail.tsx';
import type { Run } from '../../lib/studio-client.ts';

const STOP: NonNullable<Run['stopOnBudget']> = {
  spentUsd: 12.4, ceilingUsd: 12, resumable: true, completedWorkItems: 1, totalWorkItems: 3, stoppedBeforeNode: 'demo',
};

function failed(over: Partial<Run> = {}): Run {
  return {
    id: '2026-09-19T10-00-00_INIT-2026-09-19-budget',
    flowId: 'forge-develop',
    initiativeId: 'INIT-2026-09-19-budget',
    initiative: 'budget stop',
    status: 'failed',
    origin: 'architect',
    costUsd: 12.4,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
    ...over,
  };
}

function markup(Component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(Component as never, props as never));
}

const COPY = 'Stopped on budget — $12.40 of $12.00 spent, 1 of 3 work items complete, resumable before demo.';

test('RunControls: a run stopped on budget carries data-stop-on-budget and says what stopped it', () => {
  const html = markup(RunControls, { run: failed({ stopOnBudget: STOP, failNote: 'stale note' }) });
  expect(html).toContain('data-stop-on-budget="true"');
  expect(html).toContain(COPY);
  expect(html).not.toContain('stale note');
});

test('RunControls: an ordinary failure carries NO budget attribute', () => {
  const html = markup(RunControls, { run: failed({ failNote: 'gate red' }) });
  expect(html).not.toContain('data-stop-on-budget');
  expect(html).toContain('Run failed — gate red.');
});

test('RunRail: a run stopped on budget carries data-stop-on-budget and says what stopped it', () => {
  const html = markup(RunRail, { runs: [failed({ stopOnBudget: STOP })], activeRunId: null, onSelect: () => {}, flowId: 'forge-develop' });
  expect(html).toContain('data-stop-on-budget="true"');
  expect(html).toContain(COPY);
});

test('RunRail: an ordinary failure carries NO budget attribute', () => {
  const html = markup(RunRail, { runs: [failed({ failNote: 'gate red' })], activeRunId: null, onSelect: () => {}, flowId: 'forge-develop' });
  expect(html).not.toContain('data-stop-on-budget');
});
