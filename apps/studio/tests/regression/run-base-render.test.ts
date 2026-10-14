/**
 * Bead forge-mfv5.1.37 row 2 — the operator can SEE the base a run's dev
 * loop started on (`data-run-base`, the commit the entry rebase put the
 * branch onto), on the run page and on the roadmap card; and a refused entry
 * rebase reads "rebase conflict onto <sha>" in the initiative drawer, not
 * only in the event log.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowRunDetail, type FlowRunDetailProps } from '@/components/studio/FlowRunDetail';
import { RoadmapCanvas } from '@/components/studio/RoadmapCanvas';
import { InitiativeDetail } from '@/components/studio/InitiativeDetail';
import type { ProjectRoadmap, Run } from '@/lib/bridge-client';

const BASE_SHA = '93fbaec2a1b2c3d4e5f60718293a4b5c6d7e8f90';

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'cyc-1', flowId: 'forge-develop', initiativeId: 'INIT-I3B', initiative: 'I3b', status: 'active',
    origin: 'architect', costUsd: 0, phases: { dev: 'active' }, phaseMeta: {}, artifactsReady: {},
    workItems: [], flowLineage: ['forge-develop'], ...over,
  };
}

function runPage(r: Run): string {
  const props: FlowRunDetailProps = {
    runId: 'INIT-I3B', found: true, flow: null, run: r, rows: [], findings: { doc: null, failed: false },
  } as FlowRunDetailProps;
  return renderToStaticMarkup(React.createElement(FlowRunDetail as never, props as never));
}

test('run page: the page landmark carries the base the dev loop started on, and a human can read it', () => {
  const html = runPage(run({ runBase: BASE_SHA }));
  expect(html).toContain(`data-run-base="${BASE_SHA}"`);
  expect(html).toContain('data-component="run-base"');
  expect(html).toContain(BASE_SHA.slice(0, 12));
});

test('run page: no entry rebase recorded → data-run-base is empty, never a fabricated sha', () => {
  const html = runPage(run());
  expect(html).toContain('data-run-base=""');
  expect(html).not.toContain('data-component="run-base"');
});

function roadmap(runBase?: string): ProjectRoadmap {
  return {
    projectId: 'gitweave',
    initiatives: [{
      initiativeId: 'INIT-I3B', title: 'I3b', status: 'in-flight', dependsOnInitiatives: [], ready: true, blockedBy: [],
      ...(runBase !== undefined ? { runBase } : {}),
    }],
  };
}

const canvas = (rm: ProjectRoadmap): string =>
  renderToStaticMarkup(React.createElement(RoadmapCanvas as never, { roadmap: rm, cycleGroups: [], nowMs: Date.parse('2026-10-14T00:00:00Z') } as never));

test('roadmap card: carries data-run-base when the bridge serves one, omits it otherwise', () => {
  expect(canvas(roadmap(BASE_SHA))).toContain(`data-run-base="${BASE_SHA}"`);
  expect(canvas(roadmap())).not.toContain('data-run-base=');
});

test('initiative drawer: a failed initiative shows its served failure note by name', () => {
  const note = 'rebase conflict onto 93fbaec2a1b2 (origin/main) — the preserved branch conflicts with current main';
  const html = renderToStaticMarkup(React.createElement(InitiativeDetail as never, {
    expanded: true, initiativeId: 'INIT-I3B', status: 'failed', dependsOnInitiatives: [], blocked: false, blockedBy: [],
    unplanned: false, wiLevels: null, plan: { state: 'idle' }, canStartDevelopment: false, develop: { state: 'idle' },
    attempt: { attemptCount: 1, priorCycleIds: [] }, recoveryDetail: null, recoveryBusy: false, recoveryNote: '',
    onInspectRecovery: () => {}, onRecoveryAction: () => {}, runCycleIds: [], failNote: note,
  } as never));
  expect(html).toContain('data-initiative-fail-note');
  expect(html).toContain('rebase conflict onto 93fbaec2a1b2');
});
