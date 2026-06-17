'use client';

import { useRef, useCallback } from 'react';
import type { KbNode, KbEdge } from '@/lib/studio-client';

// ── Physics constants (ported from mockups/agent-flow-builder/knowledge-base.html) ──
const K_SPRING   = 0.04;
const REST_LEN   = 160;
const REPULSION  = 6000;
const DAMPING    = 0.82;
const CENTER_F   = 0.012;
const SETTLE_TICKS = 180;

// Layout density — the two constants the operator can tune (REST_LEN / REPULSION).
// Defaults equal the constants above, so callers that pass nothing are unaffected.
export type LayoutForces = { restLen: number; repulsion: number };

export const DEFAULT_FORCES: LayoutForces = { restLen: REST_LEN, repulsion: REPULSION };

// Operator-selectable density presets. 'balanced' is the default (current values),
// so the graph looks unchanged until the operator picks compact/spread.
export type LayoutPreset = 'compact' | 'balanced' | 'spread';

export const LAYOUT_PRESETS: Record<LayoutPreset, LayoutForces> = {
  compact:  { restLen: REST_LEN * 0.6, repulsion: REPULSION * 0.6 },
  balanced: { restLen: REST_LEN,       repulsion: REPULSION },
  spread:   { restLen: REST_LEN * 1.6, repulsion: REPULSION * 1.8 },
};

export type SimNode = {
  id: string;
  title: string;
  layer: 'index' | 'theme' | 'raw' | 'guidance';
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
};

export type SimEdge = { from: number; to: number; fromId: string; toId: string };

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function tick(nodes: SimNode[], edges: SimEdge[], cx: number, cy: number, forces: LayoutForces = DEFAULT_FORCES): void {
  // reset velocities for unpinned
  for (const n of nodes) {
    if (!n.pinned) { n.vx = 0; n.vy = 0; }
  }

  // repulsion between all pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]; const b = nodes[j];
      const dx = (b.x - a.x) || 0.1;
      const dy = (b.y - a.y) || 0.1;
      const dist2 = dx * dx + dy * dy;
      const dist  = Math.sqrt(dist2) || 1;
      const force = forces.repulsion / dist2;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  // spring along edges
  for (const e of edges) {
    const a = nodes[e.from]; const b = nodes[e.to];
    if (!a || !b) continue;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const delta = (dist - forces.restLen) * K_SPRING;
    const fx = (dx / dist) * delta;
    const fy = (dy / dist) * delta;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }

  // center pull + integrate
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * CENTER_F;
    n.vy += (cy - n.y) * CENTER_F;
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x  += n.vx;
    n.y  += n.vy;
  }
}

function normalise(nodes: SimNode[], W: number, H: number): void {
  if (!nodes.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const bboxW = maxX - minX || 1;
  const bboxH = maxY - minY || 1;
  const scale = Math.min((W * 0.80) / bboxW, (H * 0.80) / bboxH, 1.8);
  const cx = W / 2; const cy = H / 2;
  for (const n of nodes) {
    n.x = cx + (n.x - (minX + bboxW / 2)) * scale;
    n.y = cy + (n.y - (minY + bboxH / 2)) * scale;
  }
}

export function buildSimState(
  nodes: KbNode[],
  edges: KbEdge[],
  W: number,
  H: number,
  forces: LayoutForces = DEFAULT_FORCES,
): { simNodes: SimNode[]; simEdges: SimEdge[] } {
  const cx = W / 2; const cy = H / 2;
  const themes = nodes.filter((n) => n.layer === 'theme');
  const raws   = nodes.filter((n) => n.layer === 'raw');

  const simNodes: SimNode[] = nodes.map((n) => {
    let x: number; let y: number;
    if (n.layer === 'index') {
      x = cx; y = cy;
    } else if (n.layer === 'theme') {
      const i     = themes.indexOf(n);
      const angle = (i / Math.max(themes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      x = cx + Math.cos(angle) * 150;
      y = cy + Math.sin(angle) * 130;
    } else {
      const i     = raws.indexOf(n);
      const angle = (i / Math.max(raws.length, 1)) * Math.PI * 2 + 0.4;
      x = cx + Math.cos(angle) * 260;
      y = cy + Math.sin(angle) * 220;
    }
    x += (Math.random() - 0.5) * 60;
    y += (Math.random() - 0.5) * 60;
    return { id: n.id, title: n.title, layer: n.layer, x, y, vx: 0, vy: 0, pinned: false };
  });

  const simEdges: SimEdge[] = edges
    .map((e) => {
      const fi = simNodes.findIndex((n) => n.id === e.from);
      const ti = simNodes.findIndex((n) => n.id === e.to);
      if (fi < 0 || ti < 0) return null;
      return { from: fi, to: ti, fromId: e.from, toId: e.to };
    })
    .filter((e): e is SimEdge => e !== null);

  // run settle ticks off-screen
  for (let i = 0; i < SETTLE_TICKS; i++) tick(simNodes, simEdges, cx, cy, forces);
  normalise(simNodes, W, H);

  return { simNodes, simEdges };
}

// ── rAF-based animation hook ──────────────────────────────────────────────────

export function useForceSim(
  onFrame: (nodes: SimNode[], edges: SimEdge[]) => void,
) {
  const rafRef  = useRef<number | null>(null);
  const stateRef = useRef<{ nodes: SimNode[]; edges: SimEdge[]; cx: number; cy: number; forces: LayoutForces } | null>(null);
  const tickRef  = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const start = useCallback(
    (nodes: SimNode[], edges: SimEdge[], cx: number, cy: number, forces: LayoutForces = DEFAULT_FORCES) => {
      stop();
      stateRef.current = { nodes, edges, cx, cy, forces };
      tickRef.current  = 0;

      const step = () => {
        const s = stateRef.current;
        if (!s) return;
        tick(s.nodes, s.edges, s.cx, s.cy, s.forces);
        tickRef.current++;
        onFrame(s.nodes, s.edges);
        if (tickRef.current < 80) rafRef.current = requestAnimationFrame(step);
        else rafRef.current = null;
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [stop, onFrame],
  );

  return { start, stop };
}

// ── Re-export helper so KbGraph can compute hex points ───────────────────────
export { hexPoints };
