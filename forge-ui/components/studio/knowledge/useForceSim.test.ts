/**
 * useForceSim.test.ts — R6-08 WI-3 (F1, hub-anchor `tension` preset, RULING 4
 * separate low/med/high control) RED pins (T3). First pure-fn test for this
 * module, co-located with its source (forge-ui/components/studio/knowledge/
 * useForceSim.ts) rather than under lib/ — vitest.config.ts's `include` was
 * widened to `components/**\/*.test.ts` alongside the existing `lib/**\/*.test.ts`
 * to discover it (see that file's comment).
 *
 * `useForceSim` is a React hook (useCallback/useRef), so it can't be called
 * directly outside a component render — BUT `useCallback`/`useRef` (unlike
 * `useEffect`) run fine under `react-dom/server`'s synchronous
 * `renderToStaticMarkup`, and the closures they return keep working after the
 * render call returns (they close over a plain `useRef` object, not over any
 * React-internal dispatcher). Spiked and confirmed empirically before writing
 * this file: a wrapper component that calls `useForceSim(tick)` and stashes
 * its returned `{ start, stop, reheat }` into an outer variable during
 * `renderToStaticMarkup` yields callables that drive a REAL, real d3-force
 * `Simulation` headlessly afterward (`sim.stop()` kills the async d3-timer
 * immediately; `sim.tick()` called manually N times settles it
 * deterministically — the standard headless-Node d3-force idiom). So this
 * file drives the ACTUAL production `useForceSim`/`buildSimData`/
 * `LAYOUT_PRESETS`, not a re-implementation — RED-L needed no fallback to a
 * source-text pin.
 *
 * RUN: cd forge-ui && npx vitest run components/studio/knowledge/useForceSim.test.ts
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  useForceSim,
  buildSimData,
  LAYOUT_PRESETS,
  type SimNode,
  type SimLink,
  type LayoutForces,
} from './useForceSim';
import type { KbNode, KbEdge } from '@/lib/studio-client';

/** Capture `useForceSim`'s returned `{ start, stop, reheat }` via one
 *  synchronous SSR render pass (see the file header for why this headlessly
 *  drives the real hook). */
function captureForceSim(): ReturnType<typeof useForceSim> {
  let captured: ReturnType<typeof useForceSim> | null = null;
  function Probe() {
    captured = useForceSim(() => {});
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  if (!captured) throw new Error('captureForceSim: useForceSim did not return from the SSR render pass');
  return captured;
}

// A root-index → category-index → theme fixture graph, per the real edge
// shape orchestrator/kb-graph.ts builds (kb-graph.ts:455 category-index→theme;
// :458 kbIndex→theme fallback when no category index exists — this fixture
// uses the category-index-present shape, the common case).
function hubFixture(): { nodes: KbNode[]; edges: KbEdge[] } {
  return {
    nodes: [
      { id: 'kb-index-root', title: 'Root', layer: 'index' },
      { id: 'kb-index-patterns', title: 'Patterns', layer: 'index' },
      { id: 'theme-a', title: 'Theme A', layer: 'theme', category: 'pattern' },
    ],
    edges: [
      { from: 'kb-index-root', to: 'kb-index-patterns' },
      { from: 'kb-index-patterns', to: 'theme-a' },
    ],
  };
}

/** Settle a fresh sim (own captured hook instance + own simNodes/simLinks —
 *  d3-force mutates its input arrays in place, so each call needs fresh
 *  data) under `forces`, returning the theme node's distance from its
 *  category-index hub after settling. Manual `.tick()` loop (see header):
 *  `sim.stop()` right after `start()` kills the async d3-timer so the
 *  simulation only ever advances via the explicit loop — deterministic, no
 *  reliance on real time passing. */
function settledHubDistance(forces: LayoutForces): number {
  const { start } = captureForceSim();
  const { nodes, edges } = hubFixture();
  const { simNodes, simLinks } = buildSimData(nodes, edges, 800, 600);
  const sim = start(simNodes as SimNode[], simLinks as SimLink[], 800, 600, forces);
  sim.stop();
  for (let i = 0; i < 300; i++) sim.tick();
  const hub = simNodes.find((n) => n.id === 'kb-index-patterns')!;
  const theme = simNodes.find((n) => n.id === 'theme-a')!;
  return Math.hypot(hub.x - theme.x, hub.y - theme.y);
}

describe('LAYOUT_PRESETS — tension axis (R6-08 WI-3, RULING 4)', () => {
  it('RED: exposes a `tension` field on each preset, distinct from linkDistance/charge', () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      // Today LAYOUT_PRESETS only has { linkDistance, charge } — `tension` is
      // undefined on every preset.
      expect(typeof (preset as unknown as { tension?: unknown }).tension).toBe('number');
    }
  });

  it('RED: tension differs across the compact/balanced/spread presets (a real low/med/high control, RULING 4)', () => {
    const tensions = Object.values(LAYOUT_PRESETS).map(
      (p) => (p as unknown as { tension?: number }).tension,
    );
    // `new Set([undefined, undefined, undefined]).size === 1` today — the
    // assertion below requires 3 DISTINCT real numeric values.
    expect(new Set(tensions).size).toBe(3);
    for (const t of tensions) expect(typeof t).toBe('number');
  });
});

describe('useForceSim — hub-pull settle behaviour under tension (R6-08 WI-3, RULING 4)', () => {
  it('RED: a theme settles measurably CLOSER to its hub under high tension than under low tension, holding linkDistance/charge fixed', () => {
    // Same linkDistance/charge (LAYOUT_PRESETS.balanced) for both runs —
    // ONLY `tension` differs. Confirmed empirically before writing this
    // assertion: today `start()`'s force config never reads `forces.tension`
    // at all, so varying it produces byte-identical settled positions
    // (deterministic seeding, no Math.random anywhere in the pipeline) — the
    // distances below come out EQUAL, not high < low, which is exactly what
    // "tension has no effect yet" looks like as a failing assertion.
    const base = LAYOUT_PRESETS.balanced;
    const highTension: LayoutForces = { ...base, tension: 10 } as unknown as LayoutForces;
    const lowTension: LayoutForces = { ...base, tension: 0.1 } as unknown as LayoutForces;

    const distHigh = settledHubDistance(highTension);
    const distLow = settledHubDistance(lowTension);

    expect(distHigh).toBeLessThan(distLow);
  });
});
