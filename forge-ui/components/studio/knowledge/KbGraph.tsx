'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { drag as d3drag, type D3DragEvent } from 'd3-drag';

import type { KbGraph as KbGraphData } from '@/lib/studio-client';
import {
  buildSimData, useForceSim, hexPoints, LAYER_RADIUS,
  LAYOUT_PRESETS, type LayoutPreset, type SimNode, type SimLink,
} from './useForceSim';

// ── Constants ─────────────────────────────────────────────────────────────────

function nodeRadius(layer: string): number { return LAYER_RADIUS[layer as keyof typeof LAYER_RADIUS] ?? 8; }

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const LAYOUT_STORAGE_PREFIX = 'kb-layout:';
const PRESET_LABELS: Record<LayoutPreset, string> = { compact: 'Compact', balanced: 'Balanced', spread: 'Spread' };

function readStoredPreset(kbId: string): LayoutPreset {
  if (typeof window === 'undefined') return 'balanced';
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_PREFIX + kbId);
    if (raw === 'compact' || raw === 'balanced' || raw === 'spread') return raw;
  } catch { /* localStorage unavailable */ }
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
  const viewportRef = useRef<SVGGElement | null>(null);
  const nodesRef    = useRef<SimNode[]>([]);
  const linksRef    = useRef<SimLink[]>([]);
  const zoomRef     = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [, forceRender] = useState(0);

  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('balanced');
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const onTick = useCallback(() => { forceRender((n) => n + 1); }, []);
  const { start: simStart, stop: simStop, reheat, simRef } = useForceSim(onTick);

  // ── On KB change: load the persisted density preset ───────────────────────
  useEffect(() => { setLayoutPreset(readStoredPreset(kbId)); }, [kbId]);

  // ── On graph data / preset change: (re)build + start the d3-force sim ──────
  useEffect(() => {
    const svg = svgRef.current;
    const W = svg?.clientWidth || 700;
    const H = svg?.clientHeight || 500;
    const { simNodes, simLinks } = buildSimData(graph.nodes, graph.edges, W, H);
    nodesRef.current = simNodes;
    linksRef.current = simLinks;
    setHoveredNode(null);
    forceRender((n) => n + 1);
    simStart(simNodes, simLinks, W, H, LAYOUT_PRESETS[layoutPreset]);
    return () => simStop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, graph, layoutPreset]);

  // ── Pan/zoom — d3-zoom owns the viewport transform (imperative, no stale
  //    closures). The zoom ignores pointer-downs that land on a node (those
  //    start a node-drag instead); wheel + background-drag pan/zoom. ──────────
  useEffect(() => {
    const svg = svgRef.current;
    const g = viewportRef.current;
    if (!svg || !g) return;
    const sel = select(svg);
    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .filter((event: Event) => {
        const t = event.target as Element;
        if (t.closest?.('[data-node-id]')) return false; // node → drag, not pan
        if (event.type === 'dblclick') return false;       // keep dblclick for unpin
        return !(event as MouseEvent).ctrlKey || event.type === 'wheel';
      })
      .on('zoom', (event) => { g.setAttribute('transform', event.transform.toString()); });
    sel.call(zoomBehavior);
    sel.on('dblclick.zoom', null);
    zoomRef.current = zoomBehavior;
    return () => { sel.on('.zoom', null); };
  }, []);

  // ── Node drag — d3-drag fixes the node (fx/fy) and reheats the sim, so the
  //    dragged node's neighbours pull/stretch toward it and re-settle. A press
  //    with no movement is a select; double-click releases (unpins) a node. ──
  useEffect(() => {
    const g = viewportRef.current;
    if (!g) return;
    let moved = false;
    const dragBehavior = d3drag<SVGGElement, unknown>()
      .container(() => g)
      .clickDistance(4) // ≤4px of travel still counts as a click (selection via onClick)
      .filter((event: Event) => !!(event.target as Element).closest?.('[data-node-id]'))
      .subject((event: D3DragEvent<SVGGElement, unknown, SimNode>) => {
        const el = (event.sourceEvent.target as Element).closest('[data-node-id]');
        const id = el?.getAttribute('data-node-id');
        return nodesRef.current.find((n) => n.id === id) as SimNode;
      })
      .on('start', (event: D3DragEvent<SVGGElement, unknown, SimNode>) => {
        moved = false;
        const d = event.subject;
        if (!d) return;
        simRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event: D3DragEvent<SVGGElement, unknown, SimNode>) => {
        const d = event.subject;
        if (!d) return;
        moved = true;
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event: D3DragEvent<SVGGElement, unknown, SimNode>) => {
        const d = event.subject;
        if (!d) return;
        simRef.current?.alphaTarget(0);
        if (moved) {
          d.pinned = true; // keep it where dropped; neighbours settle around it
        } else {
          d.fx = null; d.fy = null; // a click must not pin — selection is via onClick
        }
        forceRender((n) => n + 1);
      });
    select(g).call(dragBehavior);
    return () => { select(g).on('.drag', null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Double-click a pinned node to release it back into the simulation.
  const releaseNode = useCallback((id: string) => {
    const d = nodesRef.current.find((n) => n.id === id);
    if (!d) return;
    d.fx = null; d.fy = null; d.pinned = false;
    reheat(0.4);
  }, [reheat]);

  // ── Zoom controls (reuse the d3-zoom behaviour) ────────────────────────────
  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    select(svg).transition().duration(160).call(zoomRef.current.scaleBy, factor);
  }, []);

  const fitView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    select(svg).transition().duration(220).call(zoomRef.current.transform, zoomIdentity);
  }, []);

  // ── Layout density preset (persisted per-KB; sim rebuilds via the effect) ──
  const changePreset = useCallback((preset: LayoutPreset) => {
    setLayoutPreset(preset);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(LAYOUT_STORAGE_PREFIX + kbId, preset); } catch { /* */ }
    }
  }, [kbId]);

  // ── Hover adjacency ────────────────────────────────────────────────────────
  const getNeighbours = (id: string): Set<string> => {
    const s = new Set([id]);
    for (const e of linksRef.current) {
      if (e.fromId === id) s.add(e.toId);
      if (e.toId === id) s.add(e.fromId);
    }
    return s;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const simNodes = nodesRef.current;
  const simLinks = linksRef.current;
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
        style={{ flex: 1, width: '100%', height: '100%', cursor: 'grab', display: 'block', touchAction: 'none' }}
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

        <g id="kb-svg-viewport" ref={viewportRef}>
          {/* Edges */}
          <g id="svg-edges">
            {simLinks.map((e) => {
              const a = e.source as SimNode; const b = e.target as SimNode;
              if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') return null;
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
            {simNodes.map((n) => {
              const r   = nodeRadius(n.layer);
              const sel = n.id === selectedNodeId;
              const opacity = neighbours ? (neighbours.has(n.id) ? 1 : 0.25) : 1;
              return (
                <g
                  key={n.id}
                  data-node-id={n.id}
                  data-layer={n.layer}
                  data-pinned={n.pinned ? 'true' : 'false'}
                  style={{ cursor: 'grab', opacity }}
                  onClick={() => onSelectNode(n.id)}
                  onMouseEnter={() => setHoveredNode(n.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onDoubleClick={(e) => { e.stopPropagation(); releaseNode(n.id); }}
                >
                  {n.layer === 'guidance' && <GuidanceNode n={n} r={r} sel={sel} />}
                  {n.layer === 'index'    && <IndexNode    n={n} r={r} sel={sel} />}
                  {n.layer === 'theme'    && <ThemeNode    n={n} r={r} sel={sel} />}
                  {n.layer === 'raw'      && <RawNode      n={n} r={r} sel={sel} hoveredNode={hoveredNode} />}
                  {n.pinned && <circle cx={n.x} cy={n.y} r={r + 3} fill="none" stroke="var(--amber)" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />}

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
        <CtrlButton label="+" title="Zoom in"     onClick={() => zoomBy(1.25)}    dataAction="kb-zoom-in" />
        <CtrlButton label="−" title="Zoom out"    onClick={() => zoomBy(1 / 1.25)} dataAction="kb-zoom-out" />
        <CtrlButton label="⤢" title="Reset / fit" onClick={fitView}               dataAction="kb-fit" />
      </div>

      {/* Layout density presets (top-left) */}
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

      {/* Affordance hint */}
      <div
        data-component="kb-affordance-hint"
        style={{
          position: 'absolute', bottom: 8, left: 12, zIndex: 4,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)',
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        scroll to zoom · drag background to pan · drag a node to reposition (neighbours follow) · double-click to release
      </div>

      {/* Tooltip for raw/guidance nodes */}
      {hoveredNode && (() => {
        const n = simNodes.find((s) => s.id === hoveredNode);
        if (!n || (n.layer !== 'raw' && n.layer !== 'guidance')) return null;
        return (
          <div style={{
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

// ── Control button ────────────────────────────────────────────────────────────

function CtrlButton({ label, title, onClick, dataAction }: { label: string; title: string; onClick: () => void; dataAction: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-action={dataAction}
      onClick={onClick}
      style={{
        width: 26, height: 26, background: 'var(--panel)', color: 'var(--text)',
        border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer',
        fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        <polygon points={hexPoints(n.x, n.y, r + 7)} fill="none" stroke="var(--ember)" strokeWidth="2" opacity="0.9" />
      )}
      <polygon points={hexPoints(n.x, n.y, r)} fill="rgba(74,222,128,0.15)" stroke="var(--c-kb)" strokeWidth="2" filter="url(#glow-green)" />
      <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="9" fill="var(--c-kb)" fontWeight="700" fontFamily="var(--font-display)" letterSpacing="0.08em">
        INDEX
      </text>
      <text x={n.x} y={n.y + r + 16} textAnchor="middle" fontSize="11" fill="var(--c-kb)" fontWeight="600" fontFamily="var(--font-display)">
        {n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title}
      </text>
    </>
  );
}

function ThemeNode({ n, r, sel }: { n: SimNode; r: number; sel: boolean }) {
  return (
    <>
      {sel && (<circle cx={n.x} cy={n.y} r={r + 6} fill="none" stroke="var(--ember)" strokeWidth="2"/>)}
      <circle cx={n.x} cy={n.y} r={r} fill="rgba(92,200,255,0.1)" stroke="var(--steel)" strokeWidth="1.5"/>
      <text x={n.x} y={n.y + r + 14} textAnchor="middle" fontSize="11.5" fill="var(--text)" fontFamily="var(--font-body)">
        {n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title}
      </text>
    </>
  );
}

function RawNode({ n, r, sel, hoveredNode }: { n: SimNode; r: number; sel: boolean; hoveredNode: string | null }) {
  return (
    <>
      {sel && (<circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke="var(--ember)" strokeWidth="1.5"/>)}
      <circle cx={n.x} cy={n.y} r={r} fill="var(--faint)" opacity="0.45"/>
      {hoveredNode === n.id && (
        <text x={n.x} y={n.y + r + 12} textAnchor="middle" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
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
        fill="rgba(251,191,36,0.18)" stroke={sel ? 'var(--ember)' : 'var(--amber)'} strokeWidth="1.5" strokeDasharray="3 2"
      />
      <text x={n.x} y={n.y + r * 2 + 6} textAnchor="middle" fontSize="10" fill="var(--amber)" fontFamily="var(--font-mono)">
        ⊕ guidance
      </text>
    </>
  );
}
