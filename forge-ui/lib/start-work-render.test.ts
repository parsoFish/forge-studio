/**
 * W7-B6 WI-4 — Start-work action group pins (operator note 11 / orch-02,
 * projects-18/-20, crosscut-25).
 *
 * The project page's kick-off control used to be an INERT select at the very
 * bottom of a very long page (the chosen flow rode a ?flow= nothing read).
 * These pins hold the replacement: `deriveStartWorkState` (the pure
 * enablement rule) and `StartWorkActions`'s rendered contract
 * (`data-section="start-work"`, four real actions, honest disabled reasons).
 * Killed implementations: an action group whose Run-a-flow still routes
 * through /architect/new?flow=…; enabled buttons with nothing to act on;
 * bare disabled buttons with no reason.
 *
 * RUN: npx vitest run lib/start-work-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { deriveStartWorkState, type StartWorkInitiative } from './start-work-view';
import { StartWorkActions } from '../components/studio/StartWorkActions';
import type { ProjectRoadmap } from './bridge-client';
import type { Flow } from './studio-client';

const init = (over: Partial<StartWorkInitiative>): StartWorkInitiative => ({
  initiativeId: 'INIT-x',
  title: 'x',
  status: 'pending',
  ready: true,
  ...over,
});

const FLOWS = [
  { id: 'forge-develop', name: 'Develop', kickoff: { kind: 'initiative-select' } },
  { id: 'forge-architect', name: 'Architect', kickoff: { kind: 'idea' } },
  { id: 'forge-reflect', name: 'Reflect', kickoff: { kind: 'trigger-only' } },
];

test('deriveStartWorkState: buckets by planned/ready; idea + trigger-only flows are NOT runnable', () => {
  const s = deriveStartWorkState(
    [
      init({ initiativeId: 'INIT-unplanned' }),
      init({ initiativeId: 'INIT-eligible', workItems: [] }),
      init({ initiativeId: 'INIT-blocked', ready: false }),
      init({ initiativeId: 'INIT-done', status: 'done', workItems: [] }),
    ],
    FLOWS,
  );
  expect(s.unplannedReady.map((i) => i.initiativeId)).toEqual(['INIT-unplanned']);
  expect(s.eligible.map((i) => i.initiativeId)).toEqual(['INIT-eligible']);
  expect(s.runnableFlows.map((f) => f.id)).toEqual(['forge-develop']);
  // Pending initiatives (planned or not) are run candidates; done/blocked-by-status are not.
  expect(s.runCandidates.map((i) => i.initiativeId)).toEqual(['INIT-unplanned', 'INIT-eligible', 'INIT-blocked']);
  expect(s.planDisabledReason).toBeNull();
  expect(s.startDisabledReason).toBeNull();
  expect(s.runFlowDisabledReason).toBeNull();
});

test('deriveStartWorkState: empty roadmap → every action disabled with an ARCHITECT-pointing reason', () => {
  const s = deriveStartWorkState(null, FLOWS);
  expect(s.planDisabledReason).toMatch(/Architect/i);
  expect(s.startDisabledReason).toMatch(/Architect/i);
  expect(s.runFlowDisabledReason).toMatch(/plan one|no pending/i);
});

test('deriveStartWorkState: ready-but-unplanned only → Start development says "Plan first"', () => {
  const s = deriveStartWorkState([init({ initiativeId: 'INIT-a' })], FLOWS);
  expect(s.startDisabledReason).toMatch(/Plan first/i);
  expect(s.planDisabledReason).toBeNull();
});

function render(roadmap: ProjectRoadmap | null, flows: unknown[]): string {
  return renderToStaticMarkup(
    React.createElement(StartWorkActions, {
      projectId: 'proj-1',
      roadmap,
      flows: flows as Flow[],
      onChanged: () => {},
    }),
  );
}

test('StartWorkActions renders data-section="start-work" with the four actions; Run-a-flow is a REAL picker (no ?flow= handoff)', () => {
  const roadmap: ProjectRoadmap = {
    projectId: 'proj-1',
    initiatives: [
      { initiativeId: 'INIT-unplanned', title: 'u', status: 'pending', dependsOnInitiatives: [], ready: true, blockedBy: [] },
      { initiativeId: 'INIT-eligible', title: 'e', status: 'pending', dependsOnInitiatives: [], ready: true, blockedBy: [], workItems: [] },
    ],
  };
  const html = render(roadmap, FLOWS);
  expect(html).toContain('data-section="start-work"');
  expect(html).toContain('data-action="start-work-plan"');
  expect(html).toContain('data-action="start-work-develop"');
  expect(html).toContain('data-action="start-work-run-flow"');
  expect(html).toContain('data-action="start-work-architect"');
  // The architect entry deep-links the PROJECT ID (crosscut-21's id rule).
  expect(html).toContain('/architect/new?project=proj-1');
  // Run-a-flow is a real two-select control posting to the flow-run route —
  // never the old ?flow= handoff that nothing read (projects-20).
  expect(html).toContain('data-field="start-work-flow"');
  expect(html).toContain('data-field="start-work-initiative"');
  expect(html).not.toContain('&flow=');
  expect(html).not.toContain('&amp;flow=');
  // Enabled counts on the two dispatch buttons.
  expect(html).toContain('Plan (1)');
  expect(html).toContain('Start development (1)');
});

test('StartWorkActions: with NO roadmap every dispatch button is disabled AND explains itself (crosscut-25)', () => {
  const html = render(null, FLOWS);
  expect(html).toContain('data-disabled-reason');
  expect(html).toMatch(/no roadmap yet — start with the Architect/);
  // The Architect link never disables — it IS the way out.
  expect(html).toContain('data-action="start-work-architect"');
});
