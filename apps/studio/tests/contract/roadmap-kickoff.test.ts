/**
 * Bead forge-mfv5.1.25 — Studio's half of the Kickoff gate. The bridge serves
 * `status: 'awaiting-kickoff'` (roadmap) and `awaitingKickoff` (runs); every
 * Studio consumer reads those fields and never recomputes them:
 *   - the card reads KICKOFF with `data-initiative-status="awaiting-kickoff"`
 *     and its own tone;
 *   - project-level Start development and "Start eligible" count it;
 *   - the canvas's "N merged" caption excludes it (no completedAt, no ✓);
 *   - the architect committed view headlines "awaiting kickoff".
 *
 * RUN (from apps/studio): npx vitest run on this file.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoadmapCanvas } from '@/components/studio/RoadmapCanvas';
import { StartWorkActions } from '@/components/studio/StartWorkActions';
import { deriveStartWorkState, isStartEligible } from '@/lib/start-work-view';
import { deriveActionableNow } from '@/lib/roadmap-actionable';
import { queueStatusToColor, queueStatusLabel, ROADMAP_TONE_COLOR } from '@/lib/roadmap-status-color';
import { STATUS_COLOR } from '@/lib/status-colors';
import { deriveInitiativeLinkage, describePostCommit } from '@/lib/architect-plan-view';
import type { ProjectRoadmap, RoadmapInitiative } from '@/lib/bridge-client';
import type { Run } from '@/lib/studio-client';

const KICKOFF: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-09-stranded-kickoff',
  title: 'Stranded kickoff',
  status: 'awaiting-kickoff',
  dependsOnInitiatives: [],
  ready: true,
  blockedBy: [],
  canStartDevelopment: true,
  flowId: 'forge-architect',
  workItems: [1, 2, 3, 4, 5].map((n) => ({ id: `WI-${n}`, title: `WI-${n}`, dependsOn: [], status: 'pending' as const })),
};
const SHIPPED: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-01-shipped', title: 'Shipped', status: 'done', dependsOnInitiatives: [],
  ready: true, blockedBy: [], workItems: [{ id: 'WI-1', title: 'WI-1', dependsOn: [], status: 'complete' }],
  completedAt: '2026-10-01T09:00:00.000Z',
};
const ROADMAP: ProjectRoadmap = { projectId: 'p', initiatives: [SHIPPED, KICKOFF] };

function renderCanvas(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(RoadmapCanvas as any, {
    roadmap: ROADMAP, cycleGroups: [], nowMs: Date.parse('2026-10-10T00:00:00.000Z'),
    developByInitiative: {}, planByInitiative: {}, onStartDevelopment: () => {}, onPlan: () => {},
  }));
}

function cardOf(html: string, id: string): string {
  const at = html.indexOf(`data-initiative-id="${id}"`);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('</button>', at));
}

test('card: KICKOFF label, data-initiative-status="awaiting-kickoff", its own tone', () => {
  const card = cardOf(renderCanvas(), KICKOFF.initiativeId);
  expect(card).toContain('data-initiative-status="awaiting-kickoff"');
  expect(card).toContain('>kickoff<');
  expect(queueStatusLabel('awaiting-kickoff')).toBe('kickoff');
  expect(queueStatusToColor('awaiting-kickoff')).toBe('kickoff');
  expect(ROADMAP_TONE_COLOR.kickoff).not.toBe(ROADMAP_TONE_COLOR[queueStatusToColor('ready-for-review')]);
  expect(Object.keys(STATUS_COLOR)).toHaveLength(5);
  expect(card).toContain(ROADMAP_TONE_COLOR.kickoff);
});

test('merged count: the kickoff card carries no completion date and no ✓; the caption counts only the shipped one', () => {
  const html = renderCanvas();
  const card = cardOf(html, KICKOFF.initiativeId);
  expect(card).not.toContain('data-completed-at');
  expect(card).not.toContain('✓');
  expect(html).toMatch(/1 merged/);
  expect(html).not.toMatch(/2 merged/);
});

test('Start development: project-level start-work-develop is ENABLED for a kickoff', () => {
  const s = deriveStartWorkState([KICKOFF], []);
  expect(s.eligible.map((i) => i.initiativeId)).toEqual([KICKOFF.initiativeId]);
  expect(s.startDisabledReason).toBeNull();
  const html = renderToStaticMarkup(React.createElement(StartWorkActions, { projectId: 'p', roadmap: ROADMAP, flows: [], onChanged: () => {} }));
  const button = html.slice(html.lastIndexOf('<button', html.indexOf('data-action="start-work-develop"')), html.indexOf('</button>', html.indexOf('data-action="start-work-develop"')));
  expect(button).not.toMatch(/disabled=""/);
});

test('Start eligible + actionable list count it; a ready-for-review card does not', () => {
  expect(isStartEligible(KICKOFF)).toBe(true);
  expect(isStartEligible({ ...KICKOFF, status: 'ready-for-review' })).toBe(false);
  expect(deriveActionableNow([KICKOFF], [])).toEqual([{ kind: 'start', initiativeId: KICKOFF.initiativeId, title: KICKOFF.title }]);
});

test('RoadmapView: "Start eligible" reads isStartEligible and the develop ceiling field stays rendered', () => {
  const page = readFileSync(resolve(__dirname, '../../app/projects/[id]/page.tsx'), 'utf8');
  expect(page).toMatch(/return isStartEligible\(i\) && dev !== 'starting'/);
  expect(page).toContain('data-field="develop-cost-ceiling-usd"');
});

test('architect committed view: a run served awaitingKickoff headlines "awaiting kickoff", not a verdict', () => {
  const run = { id: 'c1', flowId: 'forge-architect', initiativeId: KICKOFF.initiativeId, status: 'gated', awaitingKickoff: true } as Run;
  const linkage = deriveInitiativeLinkage([KICKOFF.initiativeId], [run], ['forge-architect']);
  expect(linkage[0].queueState).toBe('kickoff');
  const view = describePostCommit(linkage, null);
  expect(view.tone).toBe('kickoff');
  expect(view.headline).toMatch(/awaiting kickoff/);
  expect(view.headline).not.toMatch(/verdict/);
});
