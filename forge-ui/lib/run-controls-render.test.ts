/**
 * W8-A3 WI-3 — `RunControls` rendered, and its composition into the run detail
 * page (`flows-28`, `flows-49`, `flows-23`).
 *
 * `run-controls-view.test.ts` pins the derivation. This file pins the DOM
 * contract automation and the journeys read, by rendering the REAL components
 * through `react-dom/server` (the `lib/run-panel-render.test.ts` convention).
 * Click behaviour and the scheduler fetch do not run under
 * `renderToStaticMarkup` — what is asserted here is the initial render, which
 * is exactly where the three defects lived:
 *
 *   flows-28 — the failed-run bar carried ONE button.
 *   flows-49 — it disclosed nothing about what Resume does.
 *   flows-23 — `/flows/[id]/run/[runId]` rendered zero buttons, no status and
 *              no scheduler card, for any run in any state.
 */
import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/flows/forge-develop',
  useSearchParams: () => new URLSearchParams(),
}));

import { RunControls } from '../components/studio/RunControls.tsx';
import { FlowRunDetail } from '../components/studio/FlowRunDetail.tsx';
import { RUN_CONTROL_ACTIONS } from './run-controls.ts';
import type { Run, RunStatus, Flow } from './studio-client.ts';

function run(status: RunStatus, over: Partial<Run> = {}): Run {
  return {
    id: '2026-08-03T01-16-00_INIT-2026-08-03-coupling',
    flowId: 'forge-develop',
    initiativeId: 'INIT-2026-08-03-coupling',
    initiative: 'coupling change',
    status,
    origin: 'architect',
    costUsd: 1.5,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
    ...over,
  };
}

const FLOW: Flow = { id: 'forge-develop', name: 'develop', goal: '', nodes: [], edges: [], triggers: [] };

/** Components with hooks must be RENDERED, not called — see run-panel-render.test.ts. */
function markup(Component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(Component as never, props as never));
}

// ---- flows-28 / flows-49: the failed-run controls ---------------------------

test('flows-28: a failed run renders all three recovery controls, each with its own run id', () => {
  const html = markup(RunControls, { run: run('failed') });
  for (const action of RUN_CONTROL_ACTIONS) {
    expect(html, action).toContain(`data-action="${action}"`);
  }
  expect(html).toContain('data-section="run-controls"');
  expect(html).toContain('data-control-count="3"');
  expect(html).toContain('data-run-status="failed"');
});

test('flows-49: each control renders its own disclosure of what it does', () => {
  const html = markup(RunControls, { run: run('failed') });
  for (const id of ['resume', 'requeue', 'abandon']) {
    expect(html, id).toContain(`data-component="run-control-detail" data-control="${id}"`);
  }
  expect(html).toMatch(/demo node/i);
  expect(html).toMatch(/from the start/i);
});

test('flows-28: abandon is not armed on first render — the destructive confirm appears only once asked for', () => {
  const html = markup(RunControls, { run: run('failed') });
  expect(html).not.toContain('data-component="abandon-confirm"');
  expect(html).not.toContain('data-action="confirm-abandon"');
});

test('flows-49: nothing claims an outcome before an action has been taken', () => {
  const html = markup(RunControls, { run: run('failed') });
  expect(html).not.toContain('data-component="run-control-outcome"');
  expect(html).not.toContain('data-component="run-control-error"');
});

test('a failed run carrying a failNote shows it rather than a bare "Run failed."', () => {
  const html = markup(RunControls, { run: run('failed', { failNote: 'dev-loop wedged at WI-3' }) });
  expect(html).toContain('dev-loop wedged at WI-3');
});

// ---- flows-23: the queued run's control is the scheduler --------------------

test('flows-23 (S3-6): the scheduler strip on a run page claims NO queue count — the surface never read the queue', () => {
  // KILLS: the first cut's hard-coded `queuedCount={1}`, which made every run
  // page state "1 queued run will not start until the scheduler runs" and
  // `data-scheduler-queued="1"` regardless of the real queue — a fabricated
  // number on a documented harness attribute, i.e. this change's own dominant
  // defect class inside the change.
  const html = markup(RunControls, { run: run('planned') });
  expect(html, 'no count was supplied, so none may be asserted').not.toContain('data-scheduler-queued="1"');
  expect(html).toContain('data-scheduler-queued="0"'); // SchedulerCard's own "no count supplied" default
  // A caller that DOES know the real number passes it and it is carried verbatim.
  expect(markup(RunControls, { run: run('planned'), queuedCount: 12 })).toContain('data-scheduler-queued="12"');
});

test('flows-28/49 (S3-11): each control advertises BOTH ids — the run handle and the initiative id the routes take', () => {
  // KILLS: advertising only `data-run-id` (a cycle id once claimed) on buttons
  // that post `run.initiativeId`; a harness reading the documented attribute and
  // calling /api/recovery/<that>/abandon gets a 400 (INIT_ID_RE).
  const r = run('failed');
  const html = markup(RunControls, { run: r });
  expect(html).toContain(`data-run-id="${r.id}"`);
  expect(html).toContain(`data-initiative-id="${r.initiativeId}"`);
});

test('flows-23: a QUEUED run renders the scheduler strip — the only thing that can start it', () => {
  const html = markup(RunControls, { run: run('planned') });
  expect(html).toContain('data-component="scheduler-card"');
  expect(html).toContain('data-scheduler-variant="strip"');
  expect(html).toContain('data-run-status="planned"');
  // and no run-scoped recovery button, which would be a lie
  for (const action of RUN_CONTROL_ACTIONS) {
    expect(html, action).not.toContain(`data-action="${action}"`);
  }
});

test('flows-23: the scheduler strip can be opted out of where a surface already mounts one — and then a queued run renders nothing', () => {
  const html = markup(RunControls, { run: run('planned'), schedulerStrip: false });
  expect(html).toBe('');
  // …while the default (the run detail page) still mounts it.
  expect(markup(RunControls, { run: run('planned') })).toContain('data-component="scheduler-card"');
});

test('a run with neither recovery controls nor a scheduler dependency renders nothing at all', () => {
  for (const status of ['active', 'gated', 'complete'] as RunStatus[]) {
    expect(markup(RunControls, { run: run(status) }), status).toBe('');
  }
  expect(markup(RunControls, { run: null })).toBe('');
});

// ---- flows-23: composed into the run detail page ---------------------------

function detail(r: Run | null, found = true): string {
  return markup(FlowRunDetail, { runId: r?.id ?? 'x', found, flow: FLOW, run: r, rows: [], findings: null });
}

test('flows-23: the run detail page shows the run\'s status in the body, not only as an attribute', () => {
  const html = detail(run('failed'));
  expect(html).toContain('data-component="run-status-chip"');
  expect(html).toContain('data-run-status="failed"');
});

test('flows-23: the run detail page of a FAILED run carries the recovery controls', () => {
  const html = detail(run('failed'));
  for (const action of RUN_CONTROL_ACTIONS) {
    expect(html, action).toContain(`data-action="${action}"`);
  }
});

test('flows-23: the run detail page of a QUEUED run carries the scheduler control', () => {
  const html = detail(run('planned'));
  expect(html).toContain('data-component="scheduler-card"');
});

test('flows-23: a run whose manifest names its architect session links back to it', () => {
  const html = detail(run('planned', { architectSessionId: '2026-08-14T15-26-59-072e0775' }));
  expect(html).toContain('data-action="open-architect-session"');
  expect(html).toContain('/sessions/architect/2026-08-14T15-26-59-072e0775');
});

test('flows-23: a run with no architect session fabricates no backlink', () => {
  expect(detail(run('planned'))).not.toContain('data-action="open-architect-session"');
});

test('flows-23: a NOT-FOUND run page still renders its honest 404 body and no controls', () => {
  const html = detail(null, false);
  expect(html).toContain('data-component="run-not-found"');
  expect(html).not.toContain('data-section="run-controls"');
});
