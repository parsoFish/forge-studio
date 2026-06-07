/**
 * Unit tests for deriveGraphModel — focus on the send-back/requeue regression:
 * a RESUMED cycle skips the PM phase, so it emits no `pm.work-item-emitted`
 * events. Without the wiGraph fallback the WI hexes vanish from the hex view.
 */
import { test, expect } from 'vitest';
import { deriveGraphModel } from './use-graph-model.ts';
import type { EventLogEntry } from './bridge-client.ts';
import type { WiGraph } from './wi-graph.ts';

const ev = (partial: Partial<EventLogEntry>): EventLogEntry => ({
  event_id: `e-${Math.random()}`,
  initiative_id: 'INIT-x',
  started_at: new Date(1_700_000_000_000).toISOString(),
  phase: 'developer-loop',
  skill: 'developer-ralph',
  event_type: 'log',
  metadata: {},
  ...partial,
} as EventLogEntry);

const wiGraph: WiGraph = {
  nodes: [
    { id: 'WI-1', label: 'WI-1: data source + unit tests' },
    { id: 'WI-2', label: 'WI-2: registration + acc test + docs' },
  ],
  edges: [{ from: 'WI-1', to: 'WI-2' }],
} as WiGraph;

test('resumed cycle (no pm.work-item-emitted) seeds the WI list from the graph snapshot', () => {
  // A resumed cycle's events: dev/unifier activity but NO pm.work-item-emitted.
  const events = [ev({ message: 'unifier.start', phase: 'unifier' })];
  const model = deriveGraphModel({ events, wiGraph });
  expect(model.workItems.map((w) => w.id).sort()).toEqual(['WI-1', 'WI-2']);
  // titles + deps still come from the graph
  const wi2 = model.workItems.find((w) => w.id === 'WI-2')!;
  expect(wi2.title).toContain('registration');
  expect(wi2.dependsOn).toEqual(['WI-1']);
});

test('without events AND without a graph, the WI list is empty (pre-PM state preserved)', () => {
  expect(deriveGraphModel({ events: [], wiGraph: null }).workItems).toEqual([]);
});

test('pm.work-item-emitted events still take precedence (normal cycle unchanged)', () => {
  const events = [
    ev({ message: 'pm.work-item-emitted', phase: 'project-manager', metadata: { work_item_id: 'WI-1' } }),
  ];
  // Even with a 2-node graph, only the emitted WI materialises in a normal cycle.
  const model = deriveGraphModel({ events, wiGraph });
  expect(model.workItems.map((w) => w.id)).toEqual(['WI-1']);
});
