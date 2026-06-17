'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { KbGraph as KbGraphData } from '@/lib/studio-client';
import {
  buildSimState, useForceSim, hexPoints,
  LAYOUT_PRESETS, type LayoutPreset, type SimNode, type SimEdge,
} from './useForceSim';

// ── Constants ─────────────────────────────────────────────────────────────────

const LAYER_RADIUS: Record<string, number> = { index: 28, theme: 18, guidance: 12, raw: 8 };

function nodeRadius(layer: string): number { return LAYER_RADIUS[layer] ?? 8; }

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const LAYOUT_STORAGE_PREFIX = 'kb-layout:';
const PRESET_LABELS: Record<LayoutPreset, string> = { compact: 'Compact', balanced: 'Balanced', spread: 'Spread' };

function readStoredPreset(kbId: string): LayoutPreset {
  if (typeof window === 'undefined') return 'balanced';
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_PREFIX + kbId);
    if (raw === 'compact' || raw === 'balanced' || raw === 'spread') return raw;
  } catch { /* localStorage unavailable — fall through to default */ }
  return 'balanced';
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  kbId: string;
  graph: KbGraphData;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function KbGraph({ kbId, graph, selectedNodeId, onSelectNode }: Props) {
  const svgRef      = useRef<SVGSVGElement | null>(null);
  const nodesRef    = useRef<SimNode[]>([]);
  const edgesRef    = useRef<SimEdge[]>([]);
  const hoveredRef  = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  // viewport pan/zoom
  const vpRef  = useRef({ x: 0, y: 0, scale: 1 });
  const panRef = useRef<{ startX: number; startY: number } | null>(null);

  // layout density preset (persisted per-KB in localStorage)
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('balanced');

  // tooltip
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // ── On KB change: load the persisted density preset ───────────────────────
  useEffect(() => {
    setLayoutPreset(readStoredPreset(kbId));
  }, [kbId]);

  // ── On graph data / preset change: rebuild sim ────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    const W   = svg?.clientWidth  ?? 700;
    const H   = svg?.clientHeight ?? 500;
    const forces = LAYOUT_PRESETS[layoutPreset];
    const { simNodes, simEdges } = buildSimState(graph.nodes, graph.edges, W, H, forces);
    nodesRef.current = simNodes;
    edgesRef.current = simEdges;
    vpRef.current    = { x: 0, y: 0, scale: 1 };
    hoveredRef.current = null;
    forceRender((n) => n + 1);
    simStart(simNodes, simEdges, W / 2, H / 2, forces);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, graph, layoutPreset]);

  // ── rAF settle animation ───────────────────────────────────────────────────
  const onFrame = useCallback((nodes: SimNode[], edges: SimEdge[]) => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    forceRender((n) => n + 1);
  }, []);

  const { start: simStart, stop: simStop } = useForceSim(onFrame);

  useEffect(() => () => simStop(), [simStop]);

  // ── Viewport transform string ──────────────────────────────────────────────
  const vp = vpRef.current;
  const vpTransform = `translate(${vp.x},${vp.y}) scale(${vp.scale})`;

  const applyViewport = () => {
    const g = svgRef.current?.querySelector<SVGGElement>('#kb-svg-viewport');
    if (g) g.setAttribute('transform', vpTransform);
  };

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = svg.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const delta  = e.deltaY > 0 ? 0.88 : 1.14;
      const newScale = Math.min(Math.max(vp.scale * delta, 0.2), 4);
      vpRef.current = {
        x: mx - (mx - vp.x) * (newScale / vp.scale),
        y: my - (my - vp.y) * (newScale / vp.scale),
        scale: newScale,
      };
      applyViewport();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pan events ────────────────────────────────────────────────────────────
  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    if (target.closest('[data-node-id]')) return;
    panRef.current = { startX: e.clientX - vp.x, startY: e.clientY - vp.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panRef.current) return;
      vpRef.current = { ...vpRef.current, x: e.clientX - panRef.current.startX, y: e.clientY - panRef.current.startY };
      applyViewport();
    };
    const onUp = () => { panRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Node drag + click ─────────────────────────────────────────────────────
  const attachNodeHandlers = (node: SimNode, idx: number) => {
    let isDragging = false;
    let dragStart: { mx: number; my: number; nx: number; ny: number } | null = null;

    return {
      onMouseDown: (e: React.MouseEvent) => {
        e.stopPropagation();
        isDragging = false;
        dragStart  = { mx: e.clientX, my: e.clientY, nx: node.x, ny: node.y };

        const onMove = (ev: MouseEvent) => {
          if (!dragStart) return;
          const dx = (ev.clientX - dragStart.mx) / vp.scale;
          const dy = (ev.clientY - dragStart.my) / vp.scale;
          if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) isDragging = true;
          if (isDragging) {
            const ns = nodesRef.current;
            ns[idx].x = dragStart.nx + dx;
            ns[idx].y = dragStart.ny + dy;
            ns[idx].pinned = true;
            forceRender((n) => n + 1);
          }
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          if (!isDragging) onSelectNode(node.id);
          dragStart = null;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },
    };
  };

  // ── Hover adjacency ───────────────────────────────────────────────────────
  const getNeighbours = (id: string): Set<string> => {
    const s = new Set([id]);
    for (const e of edgesRef.current) {
      if (e.fromId === id) s.add(e.toId);
      if (e.toId   === id) s.add(e.fromId);
    }
    return s;
  };

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // ── Zoom controls — reuse the same vpRef + applyViewport seam as wheel/pan ──
  // Buttons zoom about the SVG centre (the wheel zooms about the cursor).
  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const cx = rect ? rect.width  / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const v = vpRef.current;
    const newScale = Math.min(Math.max(v.scale * factor, ZOOM_MIN), ZOOM_MAX);
    vpRef.current = {
      x: cx - (cx - v.x) * (newScale / v.scale),
      y: cy - (cy - v.y) * (newScale / v.scale),
      scale: newScale,
    };
    forceRender((n) => n + 1);
  }, []);

  // Reset/fit — recentre to the identity viewport (sim already normalises to fit).
  const fitView = useCallback(() => {
    vpRef.current = { x: 0, y: 0, scale: 1 };
    forceRender((n) => n + 1);
  }, []);

  // ── Layout density — change preset, persist per-KB, sim rebuilds via effect ──
  const changePreset = useCallback((preset: LayoutPreset) => {
    setLayoutPreset(preset);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(LAYOUT_STORAGE_PREFIX + kbId, preset); }
      catch { /* localStorage unavailable — preset still applies for this session */ }
    }
  }, [kbId]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const simNodes = nodesRef.current;
  const simEdges = edgesRef.current;
  const neighbours = hoveredNode ? getNeighbours(hoveredNode) : null;

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
      background: 'radial-gradient(ellipse at 30% 40%, rgba(74,222,128,.04) 0%, transparent 60%), var(--bg)' }}>

      <svg
        ref={svgRef}
        id="kb-svg"
        xmlns="http://www.w3.org/2000/svg"
        data-kb-id={kbId}
        data-node-count={nodeCount}
        data-edge-count={edgeCount}
        data-selected-node={selectedNodeId ?? ''}
        style={{ flex: 1, width: '100%', height: '100%', cursor: 'grab', display: 'block' }}
        onMouseDown={onSvgMouseDown}
      >
        <defs>
          <filter id="glow-green">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="glow-ember">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--line-2)"/>
          </marker>
        </defs>

        <g id="kb-svg-viewport" transform={vpTransform}>
          {/* Edges */}
          <g id="svg-edges">
            {simEdges.map((e) => {
              const a = simNodes[e.from]; const b = simNodes[e.to];
              if (!a || !b) return null;
              const fromIndex = a.layer === 'index';
              return (
                <line
                  key={`${e.fromId}-${e.toId}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={fromIndex ? 'rgba(74,222,128,0.3)' : 'var(--line-2)'}
                  strokeWidth={fromIndex ? 1.5 : 1}
                  strokeLinecap="round"
                  data-edge-from={e.fromId}
                  data-edge-to={e.toId}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g id="svg-nodes">
            {simNodes.map((n, idx) => {
              const r   = nodeRadius(n.layer);
              const sel = n.id === selectedNodeId;
              const opacity = neighbours ? (neighbours.has(n.id) ? 1 : 0.25) : 1;
              const handlers = attachNodeHandlers(n, idx);

              return (
                <g
                  key={n.id}
                  data-node-id={n.id}
                  data-layer={n.layer}
                  style={{ cursor: 'pointer', opacity }}
                  {...handlers}
                  onMouseEnter={() => setHoveredNode(n.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  {n.layer === 'guidance' && <GuidanceNode n={n} r={r} sel={sel} />}
                  {n.layer === 'index'    && <IndexNode    n={n} r={r} sel={sel} />}
                  {n.layer === 'theme'    && <ThemeNode    n={n} r={r} sel={sel} />}
                  {n.layer === 'raw'      && <RawNode      n={n} r={r} sel={sel} hoveredNode={hoveredNode} />}

                  {/* invisible hit area */}
                  <circle cx={n.x} cy={n.y} r={Math.max(r + 8, 16)} fill="transparent" data-hit="true" />
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Zoom / fit controls (top-right) */}
      <div
        data-component="topology-controls"
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <CtrlButton label="+" title="Zoom in"     onClick={() => zoomBy(1.2)}     dataAction="kb-zoom-in" />
        <CtrlButton label="−" title="Zoom out"    onClick={() => zoomBy(1 / 1.2)} dataAction="kb-zoom-out" />
        <CtrlButton label="⤢" title="Reset / fit" onClick={fitView}               dataAction="kb-fit" />
      </div>

      {/* Layout density presets (below the zoom controls) */}
      <div
        data-component="kb-layout-controls"
        data-layout-preset={layoutPreset}
        style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)', marginRight: 2 }}>
          layout
        </span>
        {(['compact', 'balanced', 'spread'] as LayoutPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            title={`${PRESET_LABELS[preset]} layout`}
            aria-label={`${PRESET_LABELS[preset]} layout`}
            aria-pressed={layoutPreset === preset}
            data-preset={preset}
            {...(layoutPreset === preset ? { 'data-active': 'true' } : {})}
            onClick={() => changePreset(preset)}
            style={{
              background: layoutPreset === preset ? 'rgba(74,222,128,.12)' : 'var(--panel)',
              color: layoutPreset === preset ? 'var(--c-kb)' : 'var(--dim)',
              border: `1px solid ${layoutPreset === preset ? 'rgba(74,222,128,.4)' : 'var(--line)'}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 10.5,
              fontWeight: 600,
              padding: '3px 8px',
              lineHeight: 1,
            }}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>

      {/* Affordance hint — surfaces the hidden wheel/drag/pin interactions */}
      <div
        data-component="kb-affordance-hint"
        style={{
          position: 'absolute', bottom: 8, left: 12, zIndex: 4,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)',
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        scroll to zoom · drag to pan · drag a node to pin
      </div>

      {/* Tooltip for raw/guidance nodes */}
      {hoveredNode && (() => {
        const n = simNodes.find((s) => s.id === hoveredNode);
        if (!n || (n.layer !== 'raw' && n.layer !== 'guidance')) return null;
        return (
          <div ref={tooltipRef} style={{
            position: 'absolute', top: 8, left: 8,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            borderRadius: 'var(--radius-sm)', padding: '5px 10px',
            fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)',
            pointerEvents: 'none', zIndex: 50, boxShadow: 'var(--shadow)',
            whiteSpace: 'nowrap',
          }}>
            {n.title}
          </div>
        );
      })()}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '8px 18px',
        borderTop: '1px solid var(--line)', background: 'var(--bg-2)', fontSize: 11.5,
        flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--dim)' }}>
          <svg width="22" height="24" viewBox="0 0 22 24">
            <polygon points="5.5,1 16.5,1 21,12 16.5,23 5.5,23 1,12" fill="none" stroke="var(--c-kb)" strokeWidth="1.5" filter="url(#glow-green)"/>
          </svg>
          <span><strong style={{ color: 'var(--c-kb)' }}>INDEX</strong> — the front door</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--dim)' }}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="7" fill="none" stroke="var(--steel)" strokeWidth="1.5"/>
          </svg>
          <span><strong style={{ color: 'var(--steel)' }}>THEMES</strong> — distilled patterns</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--dim)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="var(--faint)" opacity=".5"/>
          </svg>
          <span><strong style={{ color: 'var(--faint)' }}>RAW</strong> — unprocessed evidence</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
          <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            nodes: <span style={{ color: 'var(--text)', fontWeight: 600 }} id="stat-nodes">{nodeCount}</span>
          </span>
          <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            edges: <span style={{ color: 'var(--text)', fontWeight: 600 }} id="stat-edges">{edgeCount}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Control button (matches FlowTopology's ZoomButton style) ──────────────────

function CtrlButton({
  label,
  title,
  onClick,
  dataAction,
}: {
  label: string;
  title: string;
  onClick: () => void;
  dataAction: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-action={dataAction}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        background: 'var(--panel)',
        color: 'var(--text)',
        border: '1px solid var(--line)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}

// ── Node sub-components ───────────────────────────────────────────────────────

function IndexNode({ n, r, sel }: { n: SimNode; r: number; sel: boolean }) {
  return (
    <>
      {sel && (
        <polygon
          points={hexPoints(n.x, n.y, r + 7)}
          fill="none" stroke="var(--ember)" strokeWidth="2" opacity="0.9"
        />
      )}
      <polygon
        points={hexPoints(n.x, n.y, r)}
        fill="rgba(74,222,128,0.15)" stroke="var(--c-kb)" strokeWidth="2"
        filter="url(#glow-green)"
      />
      <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="9" fill="var(--c-kb)"
        fontWeight="700" fontFamily="var(--font-display)" letterSpacing="0.08em">
        INDEX
      </text>
      <text x={n.x} y={n.y + r + 16} textAnchor="middle" fontSize="11" fill="var(--c-kb)"
        fontWeight="600" fontFamily="var(--font-display)">
        {n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title}
      </text>
    </>
  );
}

function ThemeNode({ n, r, sel }: { n: SimNode; r: number; sel: boolean }) {
  return (
    <>
      {sel && (
        <circle cx={n.x} cy={n.y} r={r + 6} fill="none" stroke="var(--ember)" strokeWidth="2"/>
      )}
      <circle cx={n.x} cy={n.y} r={r} fill="rgba(92,200,255,0.1)" stroke="var(--steel)" strokeWidth="1.5"/>
      <text x={n.x} y={n.y + r + 14} textAnchor="middle" fontSize="11.5" fill="var(--text)"
        fontFamily="var(--font-body)">
        {n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title}
      </text>
    </>
  );
}

function RawNode({ n, r, sel, hoveredNode }: { n: SimNode; r: number; sel: boolean; hoveredNode: string | null }) {
  return (
    <>
      {sel && (
        <circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke="var(--ember)" strokeWidth="1.5"/>
      )}
      <circle cx={n.x} cy={n.y} r={r} fill="var(--faint)" opacity="0.45"/>
      {/* label on hover only */}
      {hoveredNode === n.id && (
        <text x={n.x} y={n.y + r + 12} textAnchor="middle" fontSize="10" fill="var(--faint)"
          fontFamily="var(--font-mono)">
          {n.title.length > 18 ? n.title.slice(0, 16) + '…' : n.title}
        </text>
      )}
    </>
  );
}

function GuidanceNode({ n, r, sel }: { n: SimNode; r: number; sel: boolean }) {
  const size = r * 1.5;
  return (
    <>
      <polygon
        points={`${n.x},${n.y - size} ${n.x + size},${n.y} ${n.x},${n.y + size} ${n.x - size},${n.y}`}
        fill="rgba(251,191,36,0.18)"
        stroke={sel ? 'var(--ember)' : 'var(--amber)'}
        strokeWidth="1.5" strokeDasharray="3 2"
      />
      <text x={n.x} y={n.y + r * 2 + 6} textAnchor="middle" fontSize="10" fill="var(--amber)"
        fontFamily="var(--font-mono)">
        ⊕ guidance
      </text>
    </>
  );
}
