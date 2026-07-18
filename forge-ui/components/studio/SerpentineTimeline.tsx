'use client';

/**
 * SerpentineTimeline — a project's roadmap laid out as a winding arrow over
 * TIME. Initiatives are ordered chronologically (by their INIT-YYYY-MM-DD id)
 * and threaded along a boustrophedon spine: row 0 flows left→right, row 1 wraps
 * back right→left, and so on, ending in an arrowhead at the newest/current
 * initiative. Each initiative is a status-coloured node branching above/below
 * the spine; dependencies are drawn as dotted connector arcs. Pure SVG, scales
 * to its container width (ResizeObserver).
 *
 * Clicking a node SELECTS it and pops the host-rendered detail card up off that
 * dot (an absolutely-positioned popover anchored to the node, with a connector
 * stub), tying the card to its point on the timeline. Escape / the × / clicking
 * the same node again dismisses it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { RoadmapInitiative } from '@/lib/bridge-client';

// R4-11: single source of truth for the roadmap initiative-status palette —
// was duplicated here AND in forge-ui/app/projects/[id]/page.tsx; that file
// now imports this export instead of keeping its own copy. `merged` (R4-11-F1,
// the brief pass-through between a confirmed merge and its promotion to
// `done/` in the same sweep) reuses the `done` colour since an operator
// glancing at the roadmap should read it as "finished", not a distinct state.
export const STATUS_COLOURS: Record<string, string> = {
  'in-flight': 'var(--c-active, #3b82f6)',
  'ready-for-review': 'var(--c-review, #f0a500)',
  'merged': 'var(--c-complete, #4ade80)',
  'done': 'var(--c-complete, #4ade80)',
  'failed': 'var(--c-failed, #e05454)',
  'pending': 'var(--faint, #8b949e)',
};

/** Sortable YYYYMMDD key from an INIT-YYYY-MM-DD-slug id (00000000 if absent). */
function dateKey(id: string): string {
  const m = id.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '00000000';
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const MARGIN_X = 56;
const MARGIN_Y = 60;
const ROW_H = 156;
const NODE_R = 11;
const HIT_R = 20;
const MIN_GAP = 132;   // minimum horizontal distance between nodes
const CARD_W = 340;    // popover width (for edge clamping)

export function SerpentineTimeline({
  initiatives,
  selectedId,
  onSelect,
  onClose,
  renderCard,
}: {
  initiatives: RoadmapInitiative[];
  selectedId?: string | null;
  onSelect?: (initiativeId: string) => void;
  onClose?: () => void;
  /** Host-supplied detail card for the selected initiative (popped off its dot). */
  renderCard?: (initiative: RoadmapInitiative) => React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(360, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Escape dismisses the open popover.
  useEffect(() => {
    if (!selectedId || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, onClose]);

  const ordered = useMemo(
    () =>
      [...initiatives].sort(
        (a, b) =>
          dateKey(a.initiativeId).localeCompare(dateKey(b.initiativeId)) ||
          a.initiativeId.localeCompare(b.initiativeId),
      ),
    [initiatives],
  );

  const layout = useMemo(() => {
    const innerW = Math.max(width - MARGIN_X * 2, MIN_GAP);
    const perRow = Math.max(2, Math.min(ordered.length || 1, Math.floor(innerW / MIN_GAP) + 1));
    const stepX = perRow > 1 ? innerW / (perRow - 1) : 0;
    const rows = Math.max(1, Math.ceil(ordered.length / perRow));
    const height = MARGIN_Y * 2 + (rows - 1) * ROW_H;

    const nodes = ordered.map((init, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const colInRow = row % 2 === 0 ? col : perRow - 1 - col;
      const x = MARGIN_X + colInRow * stepX;
      const y = MARGIN_Y + row * ROW_H;
      const above = i % 2 === 0;
      return { init, i, row, x, y, above };
    });

    let spine = '';
    nodes.forEach((n, i) => {
      if (i === 0) { spine = `M ${n.x} ${n.y}`; return; }
      const prev = nodes[i - 1];
      if (n.row === prev.row) {
        spine += ` L ${n.x} ${n.y}`;
      } else {
        const bulge = prev.row % 2 === 0 ? 50 : -50;
        spine += ` C ${prev.x + bulge} ${prev.y}, ${n.x + bulge} ${n.y}, ${n.x} ${n.y}`;
      }
    });

    const byId = new Map(nodes.map((n) => [n.init.initiativeId, n]));
    const deps: { d: string }[] = [];
    for (const n of nodes) {
      for (const depId of n.init.dependsOnInitiatives ?? []) {
        const src = byId.get(depId);
        if (!src) continue;
        const midX = (src.x + n.x) / 2;
        const midY = (src.y + n.y) / 2;
        const lift = (n.above ? -1 : 1) * 42;
        deps.push({ d: `M ${src.x} ${src.y} Q ${midX} ${midY + lift} ${n.x} ${n.y}` });
      }
    }

    return { nodes, spine, deps, height, width, byId };
  }, [ordered, width]);

  if (ordered.length === 0) return null;

  const first = layout.nodes[0];
  const last = layout.nodes[layout.nodes.length - 1];
  const sel = selectedId ? layout.byId.get(selectedId) : undefined;

  // Popover geometry: pop the card on the spine-clear side, clamped to width.
  const popAbove = sel ? sel.y > layout.height / 2 : false;
  const popCenterX = sel ? Math.min(Math.max(sel.x, CARD_W / 2 + 8), layout.width - CARD_W / 2 - 8) : 0;

  return (
    <div ref={wrapRef} data-roadmap-timeline data-node-count={ordered.length} style={{ width: '100%', position: 'relative' }}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="project roadmap over time"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <marker id="rm-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-2)" />
          </marker>
        </defs>

        {layout.deps.map((dep, i) => (
          <path key={i} d={dep.d} fill="none" stroke="var(--violet, #b78cff)" strokeWidth={1.3} strokeDasharray="3 4" opacity={0.5} />
        ))}

        <path
          d={layout.spine}
          fill="none"
          stroke="var(--line-2)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd="url(#rm-arrowhead)"
        />

        {/* feathered tail at the oldest end */}
        <g stroke="var(--line-2)" strokeWidth={3} strokeLinecap="round">
          <line x1={first.x - 14} y1={first.y - 9} x2={first.x - 2} y2={first.y} />
          <line x1={first.x - 14} y1={first.y + 9} x2={first.x - 2} y2={first.y} />
          <line x1={first.x - 22} y1={first.y - 9} x2={first.x - 10} y2={first.y} />
          <line x1={first.x - 22} y1={first.y + 9} x2={first.x - 10} y2={first.y} />
        </g>

        {layout.nodes.map((n) => {
          const colour = STATUS_COLOURS[n.init.status] ?? 'var(--faint)';
          const selected = n.init.initiativeId === selectedId;
          const chipY = n.above ? n.y - 52 : n.y + 28;
          const stalkEnd = n.above ? n.y - 24 : n.y + 24;
          return (
            <g key={n.init.initiativeId}>
              <title>{`${n.init.title} — ${n.init.status} (${n.init.initiativeId})`}</title>
              <line x1={n.x} y1={n.y} x2={n.x} y2={stalkEnd} stroke="var(--line-2)" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
              {selected && (
                <circle cx={n.x} cy={n.y} r={NODE_R + 5} fill="none" stroke={colour} strokeWidth={2} opacity={0.8} style={{ pointerEvents: 'none' }} />
              )}
              <circle cx={n.x} cy={n.y} r={NODE_R} fill={colour} stroke="var(--bg)" strokeWidth={3} style={{ pointerEvents: 'none' }} />
              <foreignObject x={n.x - 72} y={chipY} width={144} height={26} style={{ pointerEvents: 'none' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 10.5,
                    fontWeight: selected ? 700 : 600,
                    lineHeight: 1.2,
                    textAlign: 'center',
                    color: selected ? 'var(--text)' : 'var(--dim)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {truncate(n.init.title, 22)}
                </div>
              </foreignObject>
              {/* transparent hit-area — the clickable; carries the node data-* */}
              <circle
                data-roadmap-node
                data-initiative-id={n.init.initiativeId}
                data-initiative-status={n.init.status}
                cx={n.x}
                cy={n.y}
                r={HIT_R}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect?.(n.init.initiativeId)}
              />
            </g>
          );
        })}

        <text
          x={last.x}
          y={last.above ? last.y + 26 : last.y - 18}
          textAnchor="middle"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--faint)', letterSpacing: '0.08em' }}
        >
          NOW
        </text>
      </svg>

      {/* Detail card popped off the selected dot. */}
      {sel && renderCard && (
        <>
          {/* connector stub from the dot to the card */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: sel.x - 1,
              top: popAbove ? sel.y - 18 : sel.y,
              width: 2,
              height: 18,
              background: 'var(--line-2)',
              zIndex: 19,
              pointerEvents: 'none',
            }}
          />
          <div
            data-roadmap-popover
            data-popover-initiative-id={sel.init.initiativeId}
            style={{
              position: 'absolute',
              left: popCenterX,
              top: popAbove ? sel.y - 18 : sel.y + 18,
              transform: popAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              zIndex: 20,
            }}
          >
            {/* × floats on the outer corner (outside the scroll area) so it never
                overlaps the card's own status badge. */}
            <button
              type="button"
              data-action="close-roadmap-popover"
              aria-label="Close"
              onClick={onClose}
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                zIndex: 1,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--line)',
                borderRadius: '50%',
                background: 'var(--panel-2)',
                color: 'var(--dim)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              }}
            >
              ×
            </button>
            <div style={{ maxHeight: 420, overflowY: 'auto', borderRadius: 'var(--radius)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.45))' }}>
              {renderCard(sel.init)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
