/**
 * W7-B6 WI-5 — roadmap/showcase/ledger loop-closure pins
 * (projects-18/-21/-22/-27/-33).
 *
 * Killed implementations, one per section:
 *  - a ledger that renders "—" for every date because it only reads a
 *    `startedAt` the cycles payload never carries (the cycleId EMBEDS the
 *    stamp), and `$0.00`/nothing for costs the cost route knows;
 *  - a showcase pinned to exactly one cycle with no way to browse or to
 *    leave (no run/artifact links), and a "TESTS 0" tile for a model that
 *    never captured test evidence;
 *  - a roadmap whose only path to an initiative's actions is a 52-node
 *    canvas click (no "what needs me now" list), and failed rows whose run
 *    link doesn't carry the cycleId;
 *  - a FAILED card wearing a green ✓ completion badge.
 *
 * RUN: npx vitest run lib/b6-loop-links.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { deriveProjectCycleLedgerRows, cycleIdEmbeddedIso } from './project-cycle-ledger';
import { listShowcaseCycleIds, deriveShowcaseStats } from './project-showcase';
import { loadShowcase } from './showcase-load';
import { deriveActionableNow } from './roadmap-actionable';
import { RoadmapCanvas } from '../components/studio/RoadmapCanvas';
import type { Cycle, DemoModel, ProjectRoadmap } from './bridge-client';

const cyc = (over: Partial<Cycle>): Cycle => ({
  cycleId: '2026-07-11T17-26-34_INIT-x',
  initiativeId: 'INIT-x',
  project: 'gitpulse',
  status: 'done',
  ...over,
});

// ---- ledger (projects-27) --------------------------------------------------

test('cycleIdEmbeddedIso parses the leading stamp; garbage → null', () => {
  expect(cycleIdEmbeddedIso('2026-07-11T17-26-34_INIT-cli-sort-flag')).toBe('2026-07-11T17:26:34Z');
  expect(cycleIdEmbeddedIso('INIT-no-stamp')).toBeNull();
  expect(cycleIdEmbeddedIso('')).toBeNull();
});

test('ledger rows: when falls back to the cycleId-embedded stamp (no more em-dash dates), cost comes from the cost route map', () => {
  const rows = deriveProjectCycleLedgerRows(
    [cyc({ cycleId: '2026-07-11T17-26-34_INIT-a', initiativeId: 'INIT-a' })],
    { '2026-07-11T17-26-34_INIT-a': 1.23 },
  );
  expect(rows[0].when).toBe('2026-07-11T17:26:34Z');
  expect(rows[0].costUsd).toBe(1.23);
  // href carries the FULL cycleId as the run handle (P0 census, unchanged).
  expect(rows[0].href).toBe('/flows/forge-develop/run/2026-07-11T17-26-34_INIT-a');
});

test('ledger rows: a cycle with NO fetched cost stays null (honest em dash) — never a fabricated 0', () => {
  const rows = deriveProjectCycleLedgerRows([cyc({})]);
  expect(rows[0].costUsd).toBeNull();
});

// ---- showcase (projects-21/-22) ---------------------------------------------

test('listShowcaseCycleIds: every terminal cycle for the project, newest first; head = the derived pick', () => {
  const ids = listShowcaseCycleIds(
    [
      cyc({ cycleId: '2026-07-01T00-00-00_INIT-old', status: 'done' }),
      cyc({ cycleId: '2026-07-11T17-26-34_INIT-new', status: 'merged' }),
      cyc({ cycleId: '2026-07-20T00-00-00_INIT-inflight', status: 'in-flight' }),
      cyc({ cycleId: '2026-07-15T00-00-00_INIT-foreign', project: 'other' }),
    ],
    'gitpulse',
  );
  expect(ids).toEqual(['2026-07-11T17-26-34_INIT-new', '2026-07-01T00-00-00_INIT-old']);
});

test('loadShowcase honours a requested ELIGIBLE cycle; an unknown/foreign request falls back to the derived pick', async () => {
  const cycles = [
    cyc({ cycleId: '2026-07-01T00-00-00_INIT-old' }),
    cyc({ cycleId: '2026-07-11T17-26-34_INIT-new' }),
  ];
  const fetched: string[] = [];
  const fetchDemo = async (cycleId: string) => {
    fetched.push(cycleId);
    return null;
  };
  const picked = await loadShowcase({ cycles, projectId: 'gitpulse', fetchDemo, requestedCycleId: '2026-07-01T00-00-00_INIT-old' });
  expect(picked).toMatchObject({ kind: 'loaded', cycleId: '2026-07-01T00-00-00_INIT-old' });
  const fallback = await loadShowcase({ cycles, projectId: 'gitpulse', fetchDemo, requestedCycleId: 'not-eligible' });
  expect(fallback).toMatchObject({ kind: 'loaded', cycleId: '2026-07-11T17-26-34_INIT-new' });
  // The fetch ran with exactly the resolved ids — never the raw request.
  expect(fetched).toEqual(['2026-07-01T00-00-00_INIT-old', '2026-07-11T17-26-34_INIT-new']);
});

test('deriveShowcaseStats: ABSENT testEvidence → null ("not captured"); present-but-empty → a real 0', () => {
  const base: DemoModel = { title: 't', essence: 'e', project: 'p', diffStat: '', checkpoints: [] };
  expect(deriveShowcaseStats(base).testEvidenceCount).toBeNull();
  expect(deriveShowcaseStats({ ...base, testEvidence: [] } as DemoModel).testEvidenceCount).toBe(0);
});

// ---- actionable-now (projects-18) -------------------------------------------

test('deriveActionableNow: failed first with the CYCLE-id run link, then plan, then start; nothing else leaks in', () => {
  const rows = deriveActionableNow(
    [
      { initiativeId: 'INIT-start', title: 's', status: 'pending', dependsOnInitiatives: [], ready: true, blockedBy: [], workItems: [] },
      { initiativeId: 'INIT-plan', title: 'p', status: 'pending', dependsOnInitiatives: [], ready: true, blockedBy: [] },
      { initiativeId: 'INIT-failed', title: 'f', status: 'failed', dependsOnInitiatives: [], ready: false, blockedBy: [] },
      { initiativeId: 'INIT-done', title: 'd', status: 'done', dependsOnInitiatives: [], ready: false, blockedBy: [] },
      { initiativeId: 'INIT-blocked', title: 'b', status: 'pending', dependsOnInitiatives: [], ready: false, blockedBy: ['INIT-plan'] },
    ],
    [
      { initiativeId: 'INIT-failed', status: 'failed', activeCycleId: '2026-08-03T00-00-00_INIT-failed', attemptCount: 1, priorCycleIds: [] },
    ],
  );
  expect(rows.map((r) => `${r.kind}:${r.initiativeId}`)).toEqual([
    'failed:INIT-failed',
    'plan:INIT-plan',
    'start:INIT-start',
  ]);
  const failed = rows[0];
  expect(failed.kind === 'failed' && failed.runHref).toBe(
    '/flows/forge-develop/run/2026-08-03T00-00-00_INIT-failed',
  );
});

// ---- failed-card badge (projects-33) ----------------------------------------

test('RoadmapCanvas: a FAILED card with completedAt wears the failed badge (✕, status colour) — never a green ✓', () => {
  const roadmap: ProjectRoadmap = {
    projectId: 'gitpulse',
    initiatives: [
      {
        initiativeId: 'INIT-failed',
        title: 'Design decisions',
        status: 'failed',
        dependsOnInitiatives: [],
        ready: false,
        blockedBy: [],
        workItems: [],
        completedAt: '2026-08-03T01:18:00Z',
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(RoadmapCanvas, { roadmap, cycleGroups: [], developByInitiative: {}, planByInitiative: {} }),
  );
  const badge = html.match(/data-badge="completed-at"[^>]*/)?.[0] ?? '';
  expect(badge).toContain('data-badge-status="failed"');
  expect(html).toContain('✕ 01:18');
  expect(html).not.toContain('✓ 01:18');
});
