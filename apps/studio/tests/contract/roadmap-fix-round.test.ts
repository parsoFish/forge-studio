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
import type { DevelopCardState } from '@/components/studio/RoadmapCanvas';
import type { RoadmapInitiative } from '@/lib/bridge-client';

const FIX_ROUND: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-10-stranded-fix-round', title: 'Stranded fix round', status: 'ready-for-review',
  dependsOnInitiatives: [], ready: true, blockedBy: [], canStartDevelopment: false, flowId: 'forge-develop', fixRound: 1,
  workItems: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `WI-${n}`, title: `WI-${n}`, dependsOn: [], status: n === 6 ? 'pending' as const : 'complete' as const })),
};
// forge-nk1y.23 — the D-20 drain re-entered the fix WI: in-flight, 5/6 complete, develop building.
const FIX_RUNNING: RoadmapInitiative = { ...FIX_ROUND, status: 'in-flight', fixRoundRunning: true, developRunning: true };
const SHIPPED: RoadmapInitiative = {
  initiativeId: 'INIT-2026-10-01-shipped', title: 'Shipped', status: 'done', dependsOnInitiatives: [],
  ready: true, blockedBy: [], workItems: [{ id: 'WI-1', title: 'WI-1', dependsOn: [], status: 'complete' }],
  completedAt: '2026-10-01T09:00:00.000Z',
};
function card(initiative: RoadmapInitiative = FIX_ROUND, developByInitiative: Record<string, DevelopCardState> = {}): { html: string; card: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(RoadmapCanvas as any, {
    roadmap: { projectId: 'p', initiatives: [SHIPPED, initiative] }, cycleGroups: [], nowMs: Date.parse('2026-10-10T06:00:00.000Z'),
    developByInitiative, planByInitiative: {}, onStartDevelopment: () => {}, onPlan: () => {},
  }));
  const at = html.indexOf(`data-initiative-id="${initiative.initiativeId}"`);
  return { html, card: html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at)) };
}

test('card: FIX ROUND 1 label, data-fix-round="1", the 5/6 WI badge, status stays ready-for-review', () => {
  const { card: c } = card();
  expect(queueStatusLabel('ready-for-review', 1)).toBe('fix round 1'); // rendered uppercase
  expect(c).toContain('>fix round 1<');
  expect(c).toContain('data-fix-round="1"');
  expect(c).toContain('data-initiative-status="ready-for-review"');
  expect(c).toContain('data-badge-value="5/6"');
  expect(c).toContain('data-fix-round-state="parked"');
  expect(c).toContain('data-develop-state="idle"');
});

test('in-flight re-entered round: "fix round 1 · running · 5/6 WI", data-fix-round=1, state running, develop running', () => {
  const { card: c } = card(FIX_RUNNING);
  expect(queueStatusLabel('in-flight', 1, { done: 5, total: 6 })).toBe('fix round 1 · running · 5/6 WI'); // rendered uppercase
  expect(c).toContain('>fix round 1 · running · 5/6 WI<');
  expect(c).toContain('data-fix-round="1"');
  expect(c).toContain('data-fix-round-state="running"');
  expect(c).toContain('data-develop-state="running"');
  expect(c).toContain('data-initiative-status="in-flight"');
  expect(c).toContain('data-badge-value="5/6"');
  expect(c).not.toContain('data-completed-at');
});

test('develop running reads without a fix round too (a plain in-flight build)', () => {
  const plain: RoadmapInitiative = { ...FIX_RUNNING, fixRound: undefined, fixRoundRunning: undefined };
  const { card: c } = card(plain);
  expect(c).toContain('data-develop-state="running"');
  expect(c).not.toContain('data-fix-round');
  expect(c).toContain('>in-flight<');
});

test('nothing running: an in-flight card with no served developRunning stays idle', () => {
  const { card: c } = card({ ...FIX_RUNNING, fixRound: undefined, fixRoundRunning: undefined, developRunning: undefined });
  expect(c).toContain('data-develop-state="idle"');
});

test('a local press outcome (starting, needs-confirm, error) wins over the served running fact; started does not', () => {
  const id = FIX_RUNNING.initiativeId;
  for (const status of ['starting', 'needs-confirm', 'error'] as const) {
    expect(card(FIX_RUNNING, { [id]: { status, error: null } }).card).toContain(`data-develop-state="${status}"`);
  }
  expect(card(FIX_RUNNING, { [id]: { status: 'started', error: null } }).card).toContain('data-develop-state="running"');
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
