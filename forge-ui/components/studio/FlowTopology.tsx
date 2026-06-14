'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { buildMonitorLayout, HEX_W, HEX_H, type HexPos, type HexKind } from '@/lib/monitor-layout';
import type { Flow, Run } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// FlowTopology — static positioned hex layout for the monitor tab.
//
// Design §6 contract:
//  - No ReactFlow; pure positioned divs + SVG bezier edges
//  - x = topo level, y = lane within level (siblings stacked vertically)
//  - fanOut node expands to one hex per run.workItems when WIs present
//  - Gated node shows "needs you" tag + pulsing ember outline
//  - Failed node shows red outline
//  - SVG bezier edges with artifact label at midpoint
//  - complete→active edge gets ember-flow dashed animation
// ---------------------------------------------------------------------------

interface FlowTopologyProps {
  flow: Flow;
  run: Run | null;
  onNodeClick: (nodeId: string, hexKind: HexKind, wiId?: string) => void;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;

export function FlowTopology({ flow, run, onNodeClick }: FlowTopologyProps) {
  // buildMonitorLayout is the pure run-model → topology mapping (unit-tested in
  // lib/monitor-layout.test.ts). `hexes` is the full set (edges resolve by
  // nodeId); `topologyHexes` is the deduplicated render set (one phase hex per
  // nodeId + every WI hex) so the per-PHASE node count is deterministic.
  const { hexes, topologyHexes, fanOutAggregate, edges, canvasW, canvasH } = useMemo(
    () => buildMonitorLayout(flow, run),
    [flow, run],
  );

  // Pan + zoom viewport. The hex "world" is CSS-transformed (translate + scale);
  // every data-* attribute lives on the hexes inside it, unchanged — the harness
  // reads attributes, not positions, so the transform is transparent to it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0 });
  const pan = useRef({ active: false, sx: 0, sy: 0, tx: 0, ty: 0 });

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !canvasW || !canvasH) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return;
    const pad = 48;
    const zoom = Math.max(ZOOM_MIN, Math.min((cw - pad) / canvasW, (ch - pad) / canvasH, 1.3));
    setView({ zoom, tx: (cw - canvasW * zoom) / 2, ty: (ch - canvasH * zoom) / 2 });
  }, [canvasW, canvasH]);

  // Auto-fit on mount + whenever the flow or canvas extent changes, so the whole
  // pipeline is visible without manual navigation.
  useEffect(() => { fitView(); }, [fitView, flow.id]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(v.zoom * factor, ZOOM_MAX));
      const k = zoom / v.zoom;
      const el = containerRef.current;
      const cx = px ?? (el ? el.clientWidth / 2 : 0);
      const cy = py ?? (el ? el.clientHeight / 2 : 0);
      // Keep the point under the cursor fixed while scaling.
      return { zoom, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  }, []);

  // Native non-passive wheel listener so preventDefault actually stops the page
  // from scrolling while zooming (React's onWheel can bind passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Pan only from the background — never when pressing a hex (preserves the
    // click-to-open-drawer behaviour). closest() walks up from the event target.
    if ((e.target as HTMLElement).closest('[data-mon-node]')) return;
    pan.current = { active: true, sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    const el = containerRef.current;
    if (el) {
      el.style.cursor = 'grabbing';
      el.setPointerCapture?.(e.pointerId);
    }
  }, [view.tx, view.ty]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pan.current.active) return;
    setView((v) => ({
      ...v,
      tx: pan.current.tx + (e.clientX - pan.current.sx),
      ty: pan.current.ty + (e.clientY - pan.current.sy),
    }));
  }, []);

  const endPan = useCallback(() => {
    pan.current.active = false;
    const el = containerRef.current;
    if (el) el.style.cursor = 'grab';
  }, []);

  return (
    <div
      ref={containerRef}
      data-pannable="true"
      data-zoom={view.zoom.toFixed(2)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background:
          'radial-gradient(circle, rgba(57,69,95,0.4) 1px, transparent 1px) var(--bg)',
        backgroundSize: '28px 28px',
        minHeight: 260,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      {/* Zoom / fit controls */}
      <div
        data-component="topology-controls"
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <ZoomButton label="+" title="Zoom in" onClick={() => zoomBy(1.2)} dataAction="zoom-in" />
        <ZoomButton label="−" title="Zoom out" onClick={() => zoomBy(1 / 1.2)} dataAction="zoom-out" />
        <ZoomButton label="⤢" title="Fit to view" onClick={fitView} dataAction="fit-view" />
      </div>

      {/* Transformed hex world — translate + scale; children keep their data-* */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasW,
          height: canvasH,
          transformOrigin: '0 0',
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`,
        }}
      >
        {/* SVG layer — edges drawn behind nodes */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            overflow: 'visible',
            width: canvasW,
            height: canvasH,
          }}
          width={canvasW}
          height={canvasH}
        >
          {edges.map((e) => (
            <EdgePath key={`${e.from}-${e.to}`} edge={e} hexes={hexes} run={run} />
          ))}
        </svg>

        {/* Hex nodes — deduplicated render set (one phase hex per nodeId + every WI hex) */}
        {topologyHexes.map((hex) => (
          <HexNode key={hex.nodeId + (hex.wiId ?? '')} hex={hex} onNodeClick={onNodeClick} />
        ))}

        {/*
          FanOut aggregate sentinel — when the fanOut (dev-loop) node expands into
          per-WI hexes, no 'phase' hex for it appears above. This hidden node keeps
          the aggregate dev-loop status + cost assertable (run.phases[dev] /
          phaseMeta[dev].costUsd) without inflating the deterministic per-PHASE
          count: it carries data-fanout-phase (NOT data-hex-kind="phase").
        */}
        {fanOutAggregate && (
          <div
            data-fanout-phase=""
            data-node-id={fanOutAggregate.nodeId}
            data-status={fanOutAggregate.status}
            data-phase-cost-usd={fanOutAggregate.costUsd.toFixed(2)}
            aria-hidden="true"
            style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZoomButton — compact control for the topology viewport
// ---------------------------------------------------------------------------

function ZoomButton({
  label,
  title,
  onClick,
  dataAction,
}: {
  label: string;
  title: string;
  onClick: () => void;
  dataAction?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...(dataAction ? { 'data-action': dataAction } : {})}
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

// ---------------------------------------------------------------------------
// EdgePath — single SVG bezier edge
// ---------------------------------------------------------------------------

function EdgePath({
  edge,
  hexes,
  run,
}: {
  edge: { from: string; to: string; artifact?: string };
  hexes: HexPos[];
  run: Run | null;
}) {
  // Use the first hex for each node (fanOut uses first WI)
  const fromHex = hexes.find((h) => h.nodeId === edge.from);
  const toHex   = hexes.find((h) => h.nodeId === edge.to);
  if (!fromHex || !toHex) return null;

  const x1 = fromHex.x + HEX_W / 2 - 2;
  const y1 = fromHex.y;
  const x2 = toHex.x - HEX_W / 2 + 2;
  const y2 = toHex.y;
  const cx = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;

  const fromStatus = run?.phases[edge.from] ?? 'pending';
  const toStatus   = run?.phases[edge.to]   ?? 'pending';
  const flowing = fromStatus === 'complete' && (toStatus === 'active' || toStatus === 'retrying');

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const artifactName = edge.artifact;

  return (
    <g>
      {/* Base stroke */}
      <path
        d={d}
        fill="none"
        stroke="var(--line-2)"
        strokeWidth={2}
      />
      {/* Animated ember overlay when flowing */}
      {flowing && (
        <path
          d={d}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={2}
          strokeDasharray="8 6"
          style={{ animation: 'ember-flow 0.7s linear infinite', opacity: 0.8 }}
        />
      )}
      {/* Artifact label at midpoint */}
      {artifactName && (
        <>
          <rect
            x={midX - 36}
            y={midY - 7}
            width={72}
            height={14}
            rx={3}
            fill="var(--bg-2)"
            stroke="rgba(251,191,36,0.35)"
            strokeWidth={1}
          />
          <text
            x={midX}
            y={midY + 1}
            fill="var(--c-artifact)"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {artifactName}
          </text>
        </>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// HexNode — single positioned hex div
// ---------------------------------------------------------------------------

function HexNode({
  hex,
  onNodeClick,
}: {
  hex: HexPos;
  onNodeClick: (nodeId: string, hexKind: HexKind, wiId?: string) => void;
}) {
  const gatedStyle: React.CSSProperties = hex.isGated
    ? {
        outline: '2px solid var(--ember)',
        outlineOffset: 3,
        borderRadius: 4,
        animation: 'gated-pulse 1.4s ease-in-out infinite',
      }
    : {};

  const failedStyle: React.CSSProperties = hex.isFailed
    ? {
        outline: '2px solid var(--red)',
        outlineOffset: 3,
        borderRadius: 4,
        boxShadow: '0 0 18px rgba(248,113,113,0.55)',
      }
    : {};

  // Determine the displayed status for the hex-frame
  const frameStatus = hex.isGated ? 'active' : hex.status;

  return (
    <div
      className={`mon-node${hex.isGated ? ' gated-node' : ''}${hex.isFailed ? ' failed-node' : ''}`}
      data-mon-node=""
      data-node-id={hex.nodeId}
      data-status={hex.status}
      data-hex-kind={hex.hexKind}
      {...(hex.wiId ? { 'data-wi-id': hex.wiId } : {})}
      data-phase-cost-usd={(hex.costUsd ?? 0).toFixed(2)}
      onClick={() => onNodeClick(hex.nodeId, hex.hexKind, hex.wiId)}
      style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'auto',
        cursor: 'pointer',
        left: hex.x - HEX_W / 2,
        top: hex.isGated ? hex.y - HEX_H / 2 - 10 : hex.y - HEX_H / 2,
      }}
    >
      {hex.isGated && (
        <div
          className="needs-you-tag"
          style={{
            position: 'absolute',
            top: -18,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ember)',
            color: '#000',
            fontSize: 9,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            padding: '1px 6px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            letterSpacing: '0.05em',
          }}
        >
          needs you
        </div>
      )}
      <div
        className="hex-frame"
        data-status={frameStatus}
        style={{
          width: HEX_W,
          height: HEX_H,
          ...gatedStyle,
          ...failedStyle,
        }}
      >
        <div
          className="hex"
          style={{
            width: HEX_W - 3,
            height: HEX_H - 3,
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text)',
              textAlign: 'center',
              lineHeight: 1.2,
              maxWidth: 70,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hex.label}
          </span>
          {hex.wiId && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8.5,
                color: 'var(--faint)',
              }}
            >
              wi
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
