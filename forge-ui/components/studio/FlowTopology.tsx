'use client';

import { useMemo } from 'react';
import { topoLevels } from '@/lib/dep-layout';
import type { Flow, FlowNode, Run } from '@/lib/studio-client';

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

const HEX_W = 88;
const HEX_H = 80;
const COL_GAP = 180;   // horizontal gap between level columns (center-to-center)
const ROW_GAP = 110;   // vertical gap between sibling nodes (center-to-center)
const PAD_X  = 80;
const PAD_Y  = 80;

interface FlowTopologyProps {
  flow: Flow;
  run: Run | null;
  onNodeClick: (nodeId: string) => void;
}

// Position record for a rendered hex
interface HexPos {
  nodeId: string;
  label: string;
  x: number;  // center x in canvas-px
  y: number;  // center y in canvas-px
  status: string;
  isGated: boolean;
  isFailed: boolean;
  wiId?: string; // set for fanOut expanded WI hexes
}

export function FlowTopology({ flow, run, onNodeClick }: FlowTopologyProps) {
  const { hexes, edges, canvasW, canvasH } = useMemo(
    () => buildLayout(flow, run),
    [flow, run],
  );

  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'auto',
        background:
          'radial-gradient(circle, rgba(57,69,95,0.4) 1px, transparent 1px) var(--bg)',
        backgroundSize: '28px 28px',
        minHeight: 260,
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

      {/* Hex nodes */}
      {hexes.map((hex) => (
        <HexNode key={hex.nodeId + (hex.wiId ?? '')} hex={hex} onNodeClick={onNodeClick} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout builder
// ---------------------------------------------------------------------------

function buildLayout(
  flow: Flow,
  run: Run | null,
): {
  hexes: HexPos[];
  edges: Array<{ from: string; to: string; artifact?: string }>;
  canvasW: number;
  canvasH: number;
} {
  // topoLevels expects items with id + deps extracted via callbacks
  const nodes = flow.nodes;
  const edgesRaw = flow.edges;

  // Build dep map from edges (edge.to depends on edge.from)
  const depsOf = (n: FlowNode): string[] =>
    edgesRaw.filter((e) => e.to === n.id).map((e) => e.from);

  const { byLevel, maxLevel } = topoLevels(
    nodes,
    (n) => n.id,
    depsOf,
  );

  // Identify fanOut node
  const fanOutNodeId = nodes.find((n) => n.fanOut)?.id ?? null;

  // Assign positions
  const hexes: HexPos[] = [];

  const gateNodeId = run?.gate ?? null;
  const failNodeId = run?.failedAt ?? null;

  for (let level = 0; level <= maxLevel; level++) {
    const levelNodes = byLevel.get(level) ?? [];
    const cx = PAD_X + level * COL_GAP;

    // Expand fanOut node if WIs are present
    let expandedCount = 0;
    for (const n of levelNodes) {
      if (n.id === fanOutNodeId && run?.workItems && run.workItems.length > 0) {
        expandedCount += run.workItems.length;
      } else {
        expandedCount += 1;
      }
    }

    let rowIndex = 0;

    for (const n of levelNodes) {
      const status = run?.phases[n.id] ?? 'pending';
      const isGated = n.id === gateNodeId;
      const isFailed = n.id === failNodeId;
      const agentLabel = n.agent ?? n.id;

      if (n.id === fanOutNodeId && run?.workItems && run.workItems.length > 0) {
        // Expand to one hex per WI
        const wiCount = run.workItems.length;
        for (let wi = 0; wi < wiCount; wi++) {
          const wiItem = run.workItems[wi];
          const adjustedCy = PAD_Y + rowIndex * ROW_GAP + (expandedCount > 1 ? (-(expandedCount - 1) * ROW_GAP / 2) : 0);
          hexes.push({
            nodeId: n.id,
            label: wiItem.id,
            x: cx,
            y: adjustedCy,
            status: wiItem.status,
            isGated: false,
            isFailed: false,
            wiId: wiItem.id,
          });
          rowIndex++;
        }
      } else {
        const adjustedCy = PAD_Y + rowIndex * ROW_GAP + (expandedCount > 1 ? (-(expandedCount - 1) * ROW_GAP / 2) : 0);
        hexes.push({
          nodeId: n.id,
          label: agentLabel,
          x: cx,
          y: adjustedCy,
          status,
          isGated,
          isFailed,
        });
        rowIndex++;
      }
    }
  }

  // Canvas dimensions
  const allX = hexes.map((h) => h.x);
  const allY = hexes.map((h) => h.y);
  const canvasW = (allX.length ? Math.max(...allX) : 0) + PAD_X + HEX_W;
  const canvasH = (allY.length ? Math.max(...allY) : 0) + PAD_Y + HEX_H;

  return { hexes, edges: edgesRaw, canvasW, canvasH };
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
  onNodeClick: (nodeId: string) => void;
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
      onClick={() => onNodeClick(hex.nodeId)}
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
