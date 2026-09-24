/**
 * forge-0b0: a zero-node KB graph renders a blank canvas with no "no data
 * yet" caption. `KbGraph.tsx:219` computes `nodeCount` (rides on
 * `data-node-count` and the "nodes: {nodeCount}" legend stat, line ~449)
 * but never gates on `nodeCount === 0` — the legend/controls/svg all render
 * unconditionally, same as a populated graph, so an operator on a genuinely
 * empty KB sees an inert canvas with nothing telling them that is expected.
 *
 * `KbGraph` is a client component (d3-force/d3-selection/d3-zoom/d3-drag),
 * but none of its effects touch `document`/`window` at import time or during
 * the FIRST synchronous render, so — like every other `*-render.test.ts`
 * here — it renders faithfully under `react-dom/server`'s
 * `renderToStaticMarkup`. No jsdom.
 *
 * RUN: npx vitest run --root apps/studio tests/regression/kb-graph-empty-caption.test.ts
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KbGraph } from '@/components/studio/knowledge/KbGraph';
import type { KbGraph as KbGraphData } from '@/lib/studio-client';

function render(graph: KbGraphData): string {
  return renderToStaticMarkup(
    React.createElement(KbGraph, {
      kbId: 'kb1',
      graph,
      selectedNodeId: null,
      onSelectNode: () => {},
    }),
  );
}

test('RED: a zero-node graph renders a "no data yet" caption', () => {
  const html = render({ nodes: [], edges: [] });
  expect(html).toContain('data-component="kb-graph-empty"');
});

test('a populated graph does NOT render the empty caption', () => {
  const html = render({
    nodes: [{ id: 'i1', title: 'Index', layer: 'index' } as KbGraphData['nodes'][number]],
    edges: [],
  });
  expect(html).not.toContain('data-component="kb-graph-empty"');
});
