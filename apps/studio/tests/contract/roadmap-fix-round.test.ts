/**
 * Bead forge-mfv5.1.27 — Studio's half of the parked fix round. The bridge
 * serves `fixRound` (derived once by `fixRoundOf`); the card reads it and
 * never recomputes it: label FIX ROUND <n>, `data-fix-round`, the WI badge
 * 5/6, and no completion date / ✓ (so the "N merged" caption excludes it).
 *
 * RUN (from apps/studio): npx vitest run on this file.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoadmapCanvas } from '@/components/studio/RoadmapCanvas';
import { queueStatusLabel } from '@/lib/roadmap-status-color';
import type { ProjectRoadmap, RoadmapInitiative } from '@/lib/bridge-client';

const FIX_ROUND: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-10-stranded-fix-round', title: 'Stranded fix round', status: 'ready-for-review',
  dependsOnInitiatives: [], ready: true, blockedBy: [], canStartDevelopment: false, flowId: 'forge-develop', fixRound: 1,
  workItems: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `WI-${n}`, title: `WI-${n}`, dependsOn: [], status: n === 6 ? 'pending' as const : 'complete' as const })),
};
const SHIPPED: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-01-shipped', title: 'Shipped', status: 'done', dependsOnInitiatives: [],
  ready: true, blockedBy: [], workItems: [{ id: 'WI-1', title: 'WI-1', dependsOn: [], status: 'complete' }],
  completedAt: '2026-10-01T09:00:00.000Z',
};
const ROADMAP: ProjectRoadmap = { projectId: 'p', initiatives: [SHIPPED, FIX_ROUND] };

function card(): { html: string; card: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(RoadmapCanvas as any, {
    roadmap: ROADMAP, cycleGroups: [], nowMs: Date.parse('2026-10-10T06:00:00.000Z'),
    developByInitiative: {}, planByInitiative: {}, onStartDevelopment: () => {}, onPlan: () => {},
  }));
  const at = html.indexOf(`data-initiative-id="${FIX_ROUND.initiativeId}"`);
  return { html, card: html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at)) };
}

test('card: FIX ROUND 1 label, data-fix-round="1", the 5/6 WI badge, status stays ready-for-review', () => {
  const { card: c } = card();
  expect(queueStatusLabel('ready-for-review', 1)).toBe('fix round 1'); // rendered uppercase
  expect(c).toContain('>fix round 1<');
  expect(c).toContain('data-fix-round="1"');
  expect(c).toContain('data-initiative-status="ready-for-review"');
  expect(c).toContain('data-badge-value="5/6"');
});

test('merged count: the fix-round card carries no completion date and no ✓', () => {
  const { html, card: c } = card();
  expect(c).not.toContain('data-completed-at');
  expect(c).not.toContain('✓');
  expect(html).toMatch(/1 merged/);
});

test('a plain review card keeps its served word', () => {
  expect(queueStatusLabel('ready-for-review')).toBe('ready-for-review');
});
