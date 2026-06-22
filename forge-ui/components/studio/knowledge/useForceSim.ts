'use client';

/**
 * KB-graph layout engine — d3-force.
 *
 * Replaces the hand-rolled spring/repulsion integrator. d3-force is the
 * battle-tested force-directed layout: forceLink (springs along edges),
 * forceManyBody (n-body repulsion via a Barnes-Hut quadtree), forceCenter +
 * forceX/Y (gravity), forceCollide (no overlap). Initial positions are seeded
 * DETERMINISTICALLY by layer (no Math.random), so the same graph lays out the
 * same way every load. The simulation runs continuously and cools on its own
 * (alpha decay); dragging a node fixes it (fx/fy) and reheats the sim so its
 * neighbours pull/stretch toward it, then re-settle.
 */

import { useCallback, useRef } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type ForceLink,
} from 'd3-force';

import type { KbNode, KbEdge } from '@/lib/studio-client';

export type KbLayer = 'index' | 'theme' | 'raw' | 'guidance';

export const LAYER_RADIUS: Record<KbLayer, number> = { index: 28, theme: 18, guidance: 12, raw: 8 };

// d3-force node — d3 mutates x/y/vx/vy in place and honours fx/fy (a fixed/pinned
// coordinate). `pinned` is our own flag for styling a dropped node.
export type SimNode = {
  id: string;
  title: string;
  layer: KbLayer;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  pinned?: boolean;
  index?: number;
};

// d3 link — source/target start as ids and are resolved to node refs by forceLink.
export type SimLink = {
  source: string | SimNode;
  target: string | SimNode;
  fromId: string;
  toId: string;
};

export type KbSimulation = Simulation<SimNode, SimLink>;

// Layout density — link rest length + n-body charge. The operator picks a preset.
export type LayoutForces = { linkDistance: number; charge: number };
export type LayoutPreset = 'compact' | 'balanced' | 'spread';

export const LAYOUT_PRESETS: Record<LayoutPreset, LayoutForces> = {
  compact:  { linkDistance: 70,  charge: -200 },
  balanced: { linkDistance: 120, charge: -360 },
  spread:   { linkDistance: 200, charge: -680 },
};

export const DEFAULT_FORCES: LayoutForces = LAYOUT_PRESETS.balanced;

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * Build the d3 node/link arrays with DETERMINISTIC seed positions (index at the
 * centre, themes on an inner ring, guidance just outside, raw on an outer ring —
 * ordered by their position in the data, no randomness). d3-force then relaxes
 * from these seeds, so the result is stable across reloads.
 */
export function buildSimData(
  nodes: KbNode[],
  edges: KbEdge[],
  W: number,
  H: number,
): { simNodes: SimNode[]; simLinks: SimLink[] } {
  const cx = W / 2;
  const cy = H / 2;
  const themes = nodes.filter((n) => n.layer === 'theme');
  const raws = nodes.filter((n) => n.layer === 'raw');
  const guidances = nodes.filter((n) => n.layer === 'guidance');

  const simNodes: SimNode[] = nodes.map((n) => {
    let x = cx;
    let y = cy;
    if (n.layer === 'theme') {
      const i = themes.indexOf(n);
      const a = (i / Math.max(themes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      x = cx + Math.cos(a) * 150;
      y = cy + Math.sin(a) * 130;
    } else if (n.layer === 'guidance') {
      const i = guidances.indexOf(n);
      const a = (i / Math.max(guidances.length, 1)) * Math.PI * 2 + 0.8;
      x = cx + Math.cos(a) * 200;
      y = cy + Math.sin(a) * 175;
    } else if (n.layer === 'raw') {
      const i = raws.indexOf(n);
      const a = (i / Math.max(raws.length, 1)) * Math.PI * 2 + 0.4;
      x = cx + Math.cos(a) * 270;
      y = cy + Math.sin(a) * 230;
    }
    return { id: n.id, title: n.title, layer: n.layer as KbLayer, x, y };
  });

  const ids = new Set(simNodes.map((n) => n.id));
  const simLinks: SimLink[] = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, fromId: e.from, toId: e.to }));

  return { simNodes, simLinks };
}

// ── Simulation hook ───────────────────────────────────────────────────────────

export function useForceSim(onTick: () => void) {
  const simRef = useRef<KbSimulation | null>(null);

  const stop = useCallback(() => {
    simRef.current?.stop();
    simRef.current = null;
  }, []);

  const start = useCallback(
    (simNodes: SimNode[], simLinks: SimLink[], W: number, H: number, forces: LayoutForces) => {
      simRef.current?.stop();
      const sim = forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          forceLink<SimNode, SimLink>(simLinks)
            .id((d) => d.id)
            .distance(forces.linkDistance)
            .strength(0.35),
        )
        .force('charge', forceManyBody<SimNode>().strength(forces.charge).distanceMax(520))
        .force('center', forceCenter<SimNode>(W / 2, H / 2).strength(0.6))
        .force('x', forceX<SimNode>(W / 2).strength(0.03))
        .force('y', forceY<SimNode>(H / 2).strength(0.03))
        .force('collide', forceCollide<SimNode>().radius((d) => LAYER_RADIUS[d.layer] + 7).strength(0.85))
        .alpha(1)
        .alphaDecay(0.028)
        .on('tick', onTick);
      simRef.current = sim;
      return sim;
    },
    [onTick],
  );

  /** Reheat the running simulation (e.g. after a drag) so it re-settles. */
  const reheat = useCallback((alpha = 0.5) => {
    simRef.current?.alpha(alpha).restart();
  }, []);

  return { start, stop, reheat, simRef };
}

export { hexPoints };
export type { ForceLink };
