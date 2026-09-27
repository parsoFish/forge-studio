/**
 * M7 row 150 (bead `forge-8vfn.8.1.39`, rulings 1771 + 1774) — the
 * non-destructive `stop-run` control's DOM contract, mirroring
 * `run-stop-on-budget-render.test.ts`'s own precedent for the sibling
 * `stopOnBudget` outcome: `data-run-stop-reason="operator-stop"` on the SAME
 * status-line/failure-note spots `data-stop-on-budget` already renders on,
 * plus the active/gated `[data-action="stop-run"]` button itself and its
 * post-click outcome line.
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
import type { Run, RunStatus } from '../../lib/studio-client.ts';

function run(status: RunStatus, over: Partial<Run> = {}): Run {
  return {
    id: '2026-09-27T08-00-00_INIT-2026-09-27-stop',
    flowId: 'forge-develop',
    initiativeId: 'INIT-2026-09-27-stop',
    initiative: 'operator stop',
    status,
    origin: 'architect',
    costUsd: 3.2,
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

const COPY = 'Stopped by the operator — resumable; the worktree and branch are kept.';

test('RunControls: an ACTIVE run renders the stop-run button', () => {
  const html = markup(RunControls, { run: run('active') });
  expect(html).toContain('data-action="stop-run"');
  expect(html).toContain('>Stop<');
});

test('RunControls: a GATED run renders the stop-run button too', () => {
  const html = markup(RunControls, { run: run('gated') });
  expect(html).toContain('data-action="stop-run"');
});

test(
  'RunControls: a run stopped by the operator carries data-run-stop-reason and says so, ' +
    'never the stale failNote',
  () => {
  const html = markup(RunControls, {
    run: run('failed', { operatorStop: true, failNote: 'stale crash note' }),
  });
  expect(html).toContain('data-run-stop-reason="operator-stop"');
  expect(html).toContain(COPY);
  expect(html).not.toContain('stale crash note');
});

test('RunControls: an ordinary failure carries NO operator-stop attribute', () => {
  const html = markup(RunControls, { run: run('failed', { failNote: 'gate red' }) });
  expect(html).not.toContain('data-run-stop-reason');
  expect(html).toContain('Run failed — gate red.');
});

test('RunControls: a budget stop still wins over operatorStop if both are (hypothetically) present', () => {
  const html = markup(RunControls, {
    run: run('failed', {
      operatorStop: true,
      stopOnBudget: { spentUsd: 5, ceilingUsd: 5, resumable: true, completedWorkItems: 1, totalWorkItems: 2 },
    }),
  });
  expect(html).toContain('data-stop-on-budget="true"');
  expect(html).not.toContain('data-run-stop-reason="operator-stop"');
});

test('RunRail: a run stopped by the operator carries data-run-stop-reason and says so', () => {
  const html = markup(RunRail, {
    runs: [run('failed', { operatorStop: true })],
    activeRunId: null,
    onSelect: () => {},
    flowId: 'forge-develop',
  });
  expect(html).toContain('data-run-stop-reason="operator-stop"');
  expect(html).toContain(COPY);
});

test('RunRail: an ordinary failure carries NO operator-stop attribute', () => {
  const html = markup(RunRail, {
    runs: [run('failed', { failNote: 'gate red' })],
    activeRunId: null,
    onSelect: () => {},
    flowId: 'forge-develop',
  });
  expect(html).not.toContain('data-run-stop-reason');
});
