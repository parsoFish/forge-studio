'use client';

/**
 * RoadmapCanvas — the W6-RV-2 "B-prime" roadmap-tab surface. Replaces
 * `RoadmapDag` (dependency-depth columns, per-node inline expansion) with a
 * COMPLETION-TIME canvas: initiatives with a real `completedAt` are placed
 * on a day-by-day time axis (left→right by completion order); pending work
 * continues right of an amber now-line, banded by dependency-feasibility
 * (in-flight → ready → after-prerequisites → unplanned) under NO invented
 * dates. Pan/zoom is a hand-rolled CSS transform (translate+scale) — see the
 * "why not reactflow" note below. mockups/roadmap-uplift/b-prime.html is the
 * operator-locked visual/semantic reference this ports; layout math lives in
 * `forge-ui/lib/roadmap-time-layout.ts` as pure, unit-tested functions —
 * this component only turns that layout into DOM.
 *
 * WHY A HAND-ROLLED CSS TRANSFORM, NOT reactflow (already a dep for
 * FlowBuilderCanvas): every node/edge coordinate here comes from
 * `computeRoadmapTimeLayout` — a pure function, not a runtime DOM
 * measurement — so reactflow's actual value-add (auto-sizing nodes off
 * ResizeObserver, connection-drag editing, its own internal layout state)
 * is irrelevant to a read-only visualization whose positions are ALREADY
 * fully computed. Its cost is real: this repo's `renderToStaticMarkup`
 * no-jsdom render-test convention (see `roadmap-canvas-render.test.ts`) has
 * no precedent of a reactflow tree surviving that path (FlowBuilderCanvas
 * itself carries no render test — only a browser `ui:journey` beat), so
 * adopting it here would be a first, unverified bet on the exact contract
 * this file's tests depend on. The mock's own hand-rolled pan/zoom/minimap
 * is ~150 lines of vanilla JS; the React port below is comparably small and
 * needs no new dependency.
 *
 * Node cards stay COLLAPSED always (the RV-1 280×72 uniform-card contract —
 * `data-initiative-collapsed="true"` never flips): B-prime retires B's
 * on-canvas inline expansion (operator ruling, mock decision point P5).
 * Clicking a card selects it and opens the RIGHT PUSH DRAWER — canvas
 * geometry NEVER reflows on selection, only the drawer's own width animates.
 * The drawer hosts `InitiativeDetail` (byte-identical data-* contract to
 * RV-1) wrapped in `[data-drawer-initiative]`. Because there is no more
 * per-card inline expand/collapse, RV-1's bulk "Collapse all / Expand all"
 * toolbar has nothing left to toggle — this ports its SPIRIT (a bulk,
 * canvas-wide view reset) onto `roadmap-zoom-fit` / `roadmap-jump-now`
 * instead of carrying the dead affordance forward; `data-canvas-scale` is
 * the same kind of "did the toolbar actually change canvas state" pin
 * `data-initiative-collapsed` was for the old buttons.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ProjectRoadmap,
  RoadmapInitiative,
  RecoveryInspect,
} from '@/lib/bridge-client';
import { fetchRecovery, recoveryRequeue, recoveryAbandon } from '@/lib/bridge-client';
import type { InitiativeGroup } from '@/lib/cycle-grouping';
import {
  computeRoadmapTimeLayout,
  type PendingBand,
  type RoadmapTimeLayout,
  type CardPosition,
} from '@/lib/roadmap-time-layout';
import { queueStatusToColor } from '@/lib/roadmap-status-color';
import { STATUS_COLOR } from '@/lib/status-colors';
import { attemptInfoFor, type AttemptInfo } from '@/lib/recovery-attrs';
import { topoLevels } from '@/lib/dep-layout';
import { InitiativeDetail } from './InitiativeDetail';

// ---------------------------------------------------------------------------
// Per-initiative trigger state — SAME two shapes RV-1's RoadmapDag carried
// (InitiativeDetail imports these two types from this file by name).
// ---------------------------------------------------------------------------
// W7-A3 (projects-32): `flowId` carries the flow the enqueue targeted so the
// success line can link THAT run (`/flows/<flowId>/run/<initiativeId>`), not
// the flow index.
export type DevelopCardState = {
  /** W8-A3 (`flows-37`, review round 2 finding 2): `needs-confirm` is a REAL
   *  outcome of a card's single-initiative dispatch — the initiative is queued
   *  under another flow. Collapsing it into `error` left the card offering
   *  "retry", which re-posted the identical unconfirmed request forever. */
  status: 'idle' | 'starting' | 'started' | 'needs-confirm' | 'error';
  error: string | null;
  flowId?: string;
  /** Present on `needs-confirm` — the flow it is queued under today. */
  currentFlowId?: string;
};
const IDLE_DEVELOP: DevelopCardState = { status: 'idle', error: null };

export type PlanCardState = {
  /** W8-A3 (`flows-37`, review round 2 finding 1): see DevelopCardState. */
  status: 'idle' | 'planning' | 'started' | 'needs-confirm' | 'error';
  error: string | null;
  flowId?: string;
  /** Present on `needs-confirm` — the flow it is queued under today. */
  currentFlowId?: string;
};
const IDLE_PLAN: PlanCardState = { status: 'idle', error: null };

const DEFAULT_ATTEMPT: AttemptInfo = { attemptCount: 1, priorCycleIds: [] };

/** planStateAttr — mirrored from RV-1, plus W8-A3's fifth status (see below). */
export function planStateAttr(unplanned: boolean, plan: PlanCardState): 'planned' | 'planning' | 'error' | 'needs-confirm' | 'unplanned' {
  if (!unplanned) return 'planned';
  // W8-A3 review round 3, S3-7: `needs-confirm` used to fall through to
  // 'unplanned', so a card whose plan was REFUSED was byte-identical in the DOM
  // to one nobody had touched — while the sibling `data-develop-state` passed the
  // same status through raw. Two card attributes disagreeing about whether a
  // status exists is the drift extracting the mappers was meant to prevent.
  if (plan.status === 'needs-confirm') return 'needs-confirm';
  if (plan.status === 'error') return 'error';
  if (plan.status === 'planning' || plan.status === 'started') return 'planning';
  return 'unplanned';
}

export type RoadmapCanvasProps = {
  roadmap: ProjectRoadmap;
  /** run-link join source (lib/cycle-grouping): activeCycleId + priorCycleIds. */
  cycleGroups: InitiativeGroup[];
  developByInitiative?: Record<string, DevelopCardState>;
  planByInitiative?: Record<string, PlanCardState>;
  onStart?: (initiativeId: string, confirmRepointFrom?: string) => void | Promise<void>;
  onPlan?: (initiativeId: string, confirmRepointFrom?: string) => void | Promise<void>;
  /** W8-A3 (`flows-37`): dismiss a pending repoint confirmation on a card. */
  onDismissRepoint?: (kind: 'plan' | 'develop', initiativeId: string) => void;
  /** called after a successful requeue/abandon to refetch roadmap + cycle groups. */
  onRecoveryDone?: () => void | Promise<void>;
  /** W6-B10: routes honestly — resumes the project's in-flight demo session
   *  or opens the kickoff screen, keyed off this initiative for context. */
  onOpenDemo?: (initiativeId: string) => void | Promise<void>;
  /** Testability / future deep-link: open the drawer already selected. */
  initialSelectedId?: string;
  /** Testability: pin the "now" instant driving the now-line instead of
   *  `Date.now()`. Omit in production. */
  nowMs?: number;
};

const BAND_LABEL: Record<PendingBand, string> = {
  'done-no-date': 'done — date unknown',
  'in-flight': 'in flight',
  ready: 'ready — projected next',
  'after-prerequisites': 'after prerequisites',
  unplanned: 'unplanned',
};

const BAND_TONE: Record<PendingBand, string> = {
  // Still the "complete" tone (it genuinely finished) — the LABEL, not the
  // colour, carries the "we don't know when" distinction from the real
  // time-axis 'done' cards and from the 'ready' (upcoming) band.
  'done-no-date': STATUS_COLOR.complete,
  'in-flight': STATUS_COLOR.active,
  ready: STATUS_COLOR.complete,
  'after-prerequisites': STATUS_COLOR.attention,
  unplanned: STATUS_COLOR.idle,
};

const VIEWPORT_HEIGHT = 560;

export function RoadmapCanvas({
  roadmap,
  cycleGroups,
  developByInitiative,
  planByInitiative,
  onStart,
  onPlan,
  onDismissRepoint,
  onRecoveryDone,
  onOpenDemo,
  initialSelectedId,
  nowMs,
}: RoadmapCanvasProps) {
  const initiatives = roadmap.initiatives;
  const effectiveNowMs = nowMs ?? Date.now();

  const layout = useMemo<RoadmapTimeLayout>(
    () => computeRoadmapTimeLayout(initiatives, effectiveNowMs),
    [initiatives, effectiveNowMs],
  );

  // Every (prerequisite → dependent) pair that has both ends in the roadmap
  // — same edge derivation RV-1's RoadmapDag used. Unlike RV-1, positions
  // come straight from the pure layout (no post-mount measurement needed).
  const edges = useMemo(() => {
    const known = new Set(initiatives.map((i) => i.initiativeId));
    return initiatives.flatMap((init) =>
      init.dependsOnInitiatives
        .filter((parent) => known.has(parent))
        .map((parent) => ({ from: parent, to: init.initiativeId })),
    );
  }, [initiatives]);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [view, setView] = useState({ tx: 40, ty: 30, scale: 1 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStart = useRef<{ x: number; y: number } | null>(null);

  const fitView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const scale = Math.min(
      (vp.clientWidth - 60) / Math.max(1, layout.worldWidth),
      (vp.clientHeight - 90) / Math.max(1, layout.worldHeight),
      1.2,
    );
    const clamped = Math.max(0.1, scale);
    const tx = (vp.clientWidth - layout.worldWidth * clamped) / 2;
    const ty = 46 + (vp.clientHeight - 46 - layout.worldHeight * clamped) * 0.3;
    setView({ tx, ty, scale: clamped });
  }, [layout.worldWidth, layout.worldHeight]);

  const jumpNow = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || layout.nowX == null) {
      fitView();
      return;
    }
    const scale = 0.75;
    setView({ tx: vp.clientWidth * 0.45 - layout.nowX * scale, ty: 50, scale });
  }, [layout.nowX, fitView]);

  const panToId = useCallback(
    (id: string) => {
      const vp = viewportRef.current;
      const p = layout.positions.get(id);
      if (!vp || !p) return;
      setView((v) => {
        const scale = v.scale < 0.5 ? 0.75 : v.scale;
        return {
          scale,
          tx: vp.clientWidth / 2 - (p.x + p.w / 2) * scale,
          ty: vp.clientHeight / 2 - (p.y + p.h / 2) * scale,
        };
      });
    },
    [layout.positions],
  );

  // Browser-only initial fit — a no-op under renderToStaticMarkup/SSR (no
  // ref to measure), matching the repo's existing browser-only-effect
  // convention for anything that needs real container dimensions.
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.worldWidth, layout.worldHeight]);

  // Reviewer finding (HIGH): React's root event listener is PASSIVE for
  // wheel, so a JSX `onWheel={...}` handler's `preventDefault()` is a
  // silent no-op — the browser scrolls the PAGE underneath the canvas at
  // the same time the handler zooms it. Wheel semantics here are
  // browser-level, not React's synthetic layer: attach natively via
  // `addEventListener('wheel', handler, { passive: false })` on the real
  // viewport element (the same pattern reactflow itself uses for its own
  // pannable/zoomable surface), so `preventDefault()` actually takes.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const ns = Math.min(2, Math.max(0.1, v.scale * f));
        return { tx: mx - (mx - v.tx) * (ns / v.scale), ty: my - (my - v.ty) * (ns / v.scale), scale: ns };
      });
    };
    vp.addEventListener('wheel', handleWheel, { passive: false });
    return () => vp.removeEventListener('wheel', handleWheel);
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-roadmap-node],[data-minimap],button,a')) return;
      panStart.current = { x: e.clientX - view.tx, y: e.clientY - view.ty };
    },
    [view.tx, view.ty],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panStart.current) return;
      setView((v) => ({ ...v, tx: e.clientX - panStart.current!.x, ty: e.clientY - panStart.current!.y }));
    };
    const onUp = () => {
      panStart.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const select = useCallback((id: string) => setSelectedId(id), []);
  const selectAndJump = useCallback(
    (id: string) => {
      setSelectedId(id);
      panToId(id);
    },
    [panToId],
  );
  const closeDrawer = useCallback(() => setSelectedId(null), []);

  const selectedInitiative = selectedId ? initiatives.find((i) => i.initiativeId === selectedId) ?? null : null;

  const neighbors = useMemo(() => {
    if (!selectedId) return { up: new Set<string>(), down: new Set<string>() };
    const self = initiatives.find((i) => i.initiativeId === selectedId);
    const up = new Set(self?.dependsOnInitiatives ?? []);
    const down = new Set(initiatives.filter((i) => i.dependsOnInitiatives.includes(selectedId)).map((i) => i.initiativeId));
    return { up, down };
  }, [selectedId, initiatives]);

  const sx = useCallback((wx: number) => wx * view.scale + view.tx, [view.scale, view.tx]);

  return (
    <div
      data-roadmap-canvas
      data-initiative-count={initiatives.length}
      data-roadmap-edge-count={edges.length}
      data-canvas-scale={view.scale.toFixed(2)}
      style={{ display: 'flex', alignItems: 'stretch', gap: 0, position: 'relative' }}
    >
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div data-roadmap-toolbar style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" data-action="roadmap-zoom-out" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.1, v.scale / 1.25) }))} style={toolbarBtnStyle}>
            −
          </button>
          <button type="button" data-action="roadmap-zoom-in" onClick={() => setView((v) => ({ ...v, scale: Math.min(2, v.scale * 1.25) }))} style={toolbarBtnStyle}>
            +
          </button>
          <button type="button" data-action="roadmap-zoom-fit" onClick={fitView} style={toolbarBtnStyle}>
            fit
          </button>
          <button type="button" data-action="roadmap-jump-now" onClick={jumpNow} style={toolbarBtnStyle}>
            now
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
            X = real completion time · pending work projected right of the now-line, dependency order (no invented dates)
          </span>
        </div>

        <div
          ref={viewportRef}
          data-roadmap-viewport
          onMouseDown={onMouseDown}
          style={{
            position: 'relative',
            height: VIEWPORT_HEIGHT,
            overflow: 'hidden',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            cursor: 'grab',
          }}
        >
          <div
            style={{
              position: 'absolute',
              transformOrigin: '0 0',
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              width: Math.max(1, layout.worldWidth),
              height: Math.max(1, layout.worldHeight),
            }}
          >
            {layout.projectedFromX != null && (
              <div
                data-projected-zone
                style={{
                  position: 'absolute',
                  left: layout.projectedFromX,
                  top: 0,
                  width: Math.max(0, layout.worldWidth - layout.projectedFromX),
                  height: layout.worldHeight,
                  background: 'repeating-linear-gradient(45deg, rgba(147,160,180,.06) 0 12px, transparent 12px 26px)',
                  borderLeft: '1px dashed var(--faint)',
                  pointerEvents: 'none',
                }}
              />
            )}

            <svg
              data-dag-edges
              aria-hidden="true"
              style={{ position: 'absolute', left: 0, top: 0, width: layout.worldWidth, height: layout.worldHeight, overflow: 'visible', pointerEvents: 'none' }}
            >
              {edges.map((edge) => {
                const a = layout.positions.get(edge.from);
                const b = layout.positions.get(edge.to);
                if (!a || !b) return null;
                const x1 = a.x + a.w;
                const y1 = a.y + a.h / 2;
                const x2 = b.x;
                const y2 = b.y + b.h / 2;
                const dx = Math.max(40, Math.abs(x2 - x1) / 2);
                const hot = selectedId != null && (edge.from === selectedId || edge.to === selectedId);
                return (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    data-dep-edge
                    data-dep-from={edge.from}
                    data-dep-to={edge.to}
                    data-hot={String(hot)}
                    d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={hot ? 'var(--steel)' : 'var(--line)'}
                    strokeWidth={hot ? 2 : 1.2}
                    strokeOpacity={hot ? 0.95 : selectedId != null ? 0.09 : 0.2}
                  />
                );
              })}
              {layout.nowX != null && (
                <line
                  data-now-line
                  x1={layout.nowX}
                  y1={0}
                  x2={layout.nowX}
                  y2={layout.worldHeight}
                  stroke="var(--amber)"
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  strokeOpacity={0.9}
                />
              )}
            </svg>

            {layout.dayCaptions.map((c) => (
              <div
                key={`day-${c.day}`}
                data-day-column
                data-day={c.day}
                data-day-count={c.count}
                style={{ position: 'absolute', left: c.x, top: 2, fontSize: 10, fontWeight: 700, color: 'var(--dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}
              >
                {c.day} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {c.count} merged</span>
              </div>
            ))}

            {layout.bandCaptions.map((b) => (
              <div
                key={`band-${b.band}`}
                data-band={b.band}
                data-band-count={b.count}
                style={{ position: 'absolute', left: b.x, top: 2, fontSize: 10, fontWeight: 700, fontStyle: 'italic', color: 'var(--faint)', whiteSpace: 'nowrap' }}
              >
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: BAND_TONE[b.band], marginRight: 5 }} />
                {BAND_LABEL[b.band]} · {b.count}
              </div>
            ))}

            {layout.gaps.map((g) => (
              <div
                key={`gap-${g.cx}`}
                data-gap-chip
                data-gap-days={g.days}
                style={{
                  position: 'absolute', left: g.cx, top: 30, transform: 'translateX(-50%)',
                  fontSize: 9.5, color: 'var(--faint)', border: '1px dashed var(--line)', borderRadius: 9,
                  padding: '1px 8px', whiteSpace: 'nowrap', background: 'rgba(11,14,20,.7)',
                }}
              >
                ··· {g.days} days
              </div>
            ))}

            {initiatives.map((init) => {
              const pos = layout.positions.get(init.initiativeId);
              if (!pos) return null;
              const isSelected = init.initiativeId === selectedId;
              const isNeighbor = neighbors.up.has(init.initiativeId) || neighbors.down.has(init.initiativeId);
              const dimmed = selectedId != null && !isSelected && !isNeighbor;
              return (
                <RoadmapCanvasNode
                  key={init.initiativeId}
                  initiative={init}
                  position={pos}
                  plan={planByInitiative?.[init.initiativeId] ?? IDLE_PLAN}
                  develop={developByInitiative?.[init.initiativeId] ?? IDLE_DEVELOP}
                  selected={isSelected}
                  neighbor={isNeighbor}
                  dimmed={dimmed}
                  onSelect={select}
                />
              );
            })}
          </div>

          {/* Screen-anchored time axis: horizontal position tracks pan/zoom
              (`sx`), vertical position stays fixed at the viewport top. */}
          <div data-roadmap-axis aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 34, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(15,20,32,.9) 60%, rgba(15,20,32,0))' }}>
            {layout.months.map((m) => (
              <div key={`m-${m.label}-${m.from}`} style={{ position: 'absolute', left: Math.max(4, sx(m.from) + 4), top: 3, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--dim)' }}>
                {m.label}
              </div>
            ))}
            {layout.dayCaptions.map((c) => (
              <div key={`dt-${c.day}`} style={{ position: 'absolute', left: sx(c.x), top: 19, transform: 'translateX(-50%)', fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                {Number(c.day.slice(8, 10))}
              </div>
            ))}
            {layout.nowX != null && (
              <div data-now-chip style={{ position: 'absolute', left: sx(layout.nowX), top: 2, transform: 'translateX(-50%)', fontSize: 9.5, fontWeight: 700, color: '#0b0e14', background: 'var(--amber)', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                {layout.nowLabel}
              </div>
            )}
          </div>

          <RoadmapMinimap layout={layout} initiatives={initiatives} view={view} viewportRef={viewportRef} onJump={selectAndJump} onPan={setView} />
        </div>
      </div>

      <RoadmapDrawer
        selectedId={selectedId}
        initiative={selectedInitiative}
        group={selectedId ? cycleGroups.find((g) => g.initiativeId === selectedId) : undefined}
        develop={selectedId ? developByInitiative?.[selectedId] ?? IDLE_DEVELOP : IDLE_DEVELOP}
        plan={selectedId ? planByInitiative?.[selectedId] ?? IDLE_PLAN : IDLE_PLAN}
        attempt={selectedId ? attemptInfoFor(selectedId, cycleGroups) : DEFAULT_ATTEMPT}
        onClose={closeDrawer}
        onStart={onStart}
        onPlan={onPlan}
        onDismissRepoint={onDismissRepoint}
        onRecoveryDone={onRecoveryDone}
        onOpenDemo={onOpenDemo}
        onDepJump={selectAndJump}
      />
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text)', background: 'var(--panel)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// RoadmapCanvasNode — the uniform, ALWAYS-collapsed 280×72 card. No inline
// expand/collapse in the canvas world — click selects + opens the drawer.
// ---------------------------------------------------------------------------
function RoadmapCanvasNode({
  initiative,
  position,
  plan,
  develop,
  selected,
  neighbor,
  dimmed,
  onSelect,
}: {
  initiative: RoadmapInitiative;
  position: CardPosition;
  plan: PlanCardState;
  develop: DevelopCardState;
  selected: boolean;
  neighbor: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const { initiativeId, title, status, dependsOnInitiatives, workItems, ready, blockedBy, completedAt } = initiative;
  const colour = STATUS_COLOR[queueStatusToColor(status)];
  const planned = workItems !== undefined;
  const unplanned = status === 'pending' && !planned;

  const depsCount = dependsOnInitiatives.length;
  const wiTotal = workItems?.length ?? 0;
  const wiDone = workItems?.filter((w) => w.status === 'complete').length ?? 0;
  const wiFailed = workItems?.filter((w) => w.status === 'failed').length ?? 0;
  const wiAllComplete = wiTotal > 0 && wiDone === wiTotal && wiFailed === 0;

  return (
    <button
      type="button"
      data-roadmap-node
      data-initiative-id={initiativeId}
      data-initiative-status={status}
      data-develop-state={develop.status}
      data-plan-state={planStateAttr(unplanned, plan)}
      data-initiative-ready={String(ready)}
      data-blocked-by={blockedBy.join(',')}
      data-initiative-collapsed="true"
      {...(completedAt !== undefined ? { 'data-completed-at': completedAt } : {})}
      onClick={() => onSelect(initiativeId)}
      style={{
        position: 'absolute', left: position.x, top: position.y, width: position.w, height: position.h,
        background: 'var(--panel)', border: '1px solid var(--line)', borderLeft: `3px solid ${colour}`,
        borderRadius: 'var(--radius-sm)', padding: '8px 10px 7px', textAlign: 'left', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: 'var(--text)',
        boxSizing: 'border-box', boxShadow: selected ? '0 0 0 1px var(--violet)' : undefined,
        outline: selected ? '1px solid var(--violet)' : neighbor ? '1px solid var(--steel)' : undefined,
        opacity: dimmed ? 0.28 : 1, transition: 'opacity .12s, outline-color .12s',
      }}
    >
      <div
        title={title}
        style={{
          fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: 'var(--text)',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}
      >
        {title}
      </div>

      <div data-micro-badges style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colour, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: colour, flexShrink: 0 }} />
          {status}
        </span>
        {/* W7-B6 (projects-33): the completion-time badge takes the STATUS
            colour and only earns a ✓ for a successful terminal state — a
            FAILED card used to show a green "✓ HH:MM" because the badge was
            keyed off completedAt's mere presence. */}
        {completedAt !== undefined && (
          <span
            data-badge="completed-at"
            data-badge-status={status}
            title={`real cycle-end ${completedAt}`}
            style={{ color: status === 'failed' ? STATUS_COLOR.failed : colour }}
          >
            {status === 'failed' ? '✕' : '✓'} {completedAt.slice(11, 16)}
          </span>
        )}
        <span data-micro-badge="deps-count" data-badge-value={depsCount} style={microBadgeStyle}>
          {depsCount} dep{depsCount === 1 ? '' : 's'}
        </span>
        <span
          data-micro-badge="wi-progress"
          data-badge-value={`${wiDone}/${wiTotal}`}
          data-badge-failed={wiFailed}
          style={wiProgressBadgeStyle(wiTotal, wiAllComplete)}
        >
          {wiDone}/{wiTotal} WI
          {wiFailed > 0 && (
            <span data-badge-failed-marker title={`${wiFailed} failed work item${wiFailed === 1 ? '' : 's'}`} style={{ marginLeft: 3, color: STATUS_COLOR.failed, fontWeight: 700 }}>
              ⚠{wiFailed}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

const microBadgeStyle: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 600, color: 'var(--dim)', background: 'var(--bg)',
  border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
};

function wiProgressBadgeStyle(wiTotal: number, wiAllComplete: boolean): React.CSSProperties {
  if (wiTotal === 0) return { ...microBadgeStyle, color: 'var(--faint)', fontStyle: 'italic', opacity: 0.7 };
  if (wiAllComplete) return { ...microBadgeStyle, color: STATUS_COLOR.complete, borderColor: `${STATUS_COLOR.complete}55` };
  return microBadgeStyle;
}

// ---------------------------------------------------------------------------
// RoadmapDrawer — A's static right push drawer, hosting InitiativeDetail
// byte-identical (W6-RV-1 contract). Owns the recovery-inspect/requeue/
// abandon state, reset on every selection change.
// ---------------------------------------------------------------------------
function RoadmapDrawer({
  selectedId,
  initiative,
  group,
  develop,
  plan,
  attempt,
  onClose,
  onStart,
  onPlan,
  onDismissRepoint,
  onRecoveryDone,
  onOpenDemo,
  onDepJump,
}: {
  selectedId: string | null;
  initiative: RoadmapInitiative | null;
  group?: InitiativeGroup;
  develop: DevelopCardState;
  plan: PlanCardState;
  attempt: AttemptInfo;
  onClose: () => void;
  onStart?: (initiativeId: string, confirmRepointFrom?: string) => void | Promise<void>;
  onPlan?: (initiativeId: string, confirmRepointFrom?: string) => void | Promise<void>;
  /** W8-A3 (`flows-37`): dismiss a pending repoint confirmation on a card. */
  onDismissRepoint?: (kind: 'plan' | 'develop', initiativeId: string) => void;
  onRecoveryDone?: () => void | Promise<void>;
  onOpenDemo?: (initiativeId: string) => void | Promise<void>;
  onDepJump: (id: string) => void;
}) {
  const [recoveryDetail, setRecoveryDetail] = useState<RecoveryInspect | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState('');

  // A fresh selection must never show the PREVIOUS initiative's stale
  // inspect/requeue result.
  useEffect(() => {
    setRecoveryDetail(null);
    setRecoveryBusy(false);
    setRecoveryNote('');
  }, [selectedId]);

  const inspectRecovery = useCallback(async (): Promise<void> => {
    if (!selectedId) return;
    setRecoveryDetail(await fetchRecovery(selectedId));
  }, [selectedId]);

  const doRecoveryAction = useCallback(
    async (kind: 'requeue' | 'abandon'): Promise<void> => {
      if (!selectedId) return;
      setRecoveryBusy(true);
      setRecoveryNote('');
      const res = kind === 'requeue' ? await recoveryRequeue(selectedId, { resetRetries: true }) : await recoveryAbandon(selectedId);
      setRecoveryBusy(false);
      setRecoveryNote(res.ok ? `${kind} ok` : `${kind} failed: ${res.error ?? 'unknown'}`);
      if (res.ok) {
        setRecoveryDetail(null);
        await onRecoveryDone?.();
      }
    },
    [selectedId, onRecoveryDone],
  );

  const open = initiative !== null;

  let body: React.ReactNode = null;
  if (initiative) {
    const { initiativeId, title, status, dependsOnInitiatives, workItems, ready, blockedBy } = initiative;
    const planned = workItems !== undefined;
    const unplanned = status === 'pending' && !planned;
    const canStartDevelopment = status === 'pending' && ready && planned;
    const blocked = status === 'pending' && !ready;
    const wiLevels = workItems && workItems.length > 0 ? topoLevels(workItems, (w) => w.id, (w) => w.dependsOn) : null;
    const runCycleIds = group ? [group.activeCycleId, ...group.priorCycleIds] : [];

    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{title}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)', marginTop: 4, wordBreak: 'break-all' }}>{initiativeId}</div>
          </div>
          <button type="button" data-action="drawer-close" onClick={onClose} style={toolbarBtnStyle}>
            close ×
          </button>
        </div>
        <InitiativeDetail
          expanded
          initiativeId={initiativeId}
          status={status}
          dependsOnInitiatives={dependsOnInitiatives}
          blocked={blocked}
          blockedBy={blockedBy}
          unplanned={unplanned}
          wiLevels={wiLevels}
          runCycleIds={runCycleIds}
          onOpenDemo={onOpenDemo ? () => void onOpenDemo(initiativeId) : undefined}
          plan={plan}
          onPlan={onPlan}
          onDismissRepoint={onDismissRepoint}
          canStartDevelopment={canStartDevelopment}
          develop={develop}
          onStart={onStart}
          attempt={attempt}
          recoveryDetail={recoveryDetail}
          recoveryBusy={recoveryBusy}
          recoveryNote={recoveryNote}
          onInspectRecovery={inspectRecovery}
          onRecoveryAction={doRecoveryAction}
          onDepJump={onDepJump}
        />
      </>
    );
  }

  return (
    <aside
      data-roadmap-drawer
      data-drawer-open={String(open)}
      aria-label="Initiative detail"
      style={{
        width: open ? 420 : 0, overflow: 'hidden', flexShrink: 0,
        borderLeft: open ? '1px solid var(--line)' : 'none', background: 'var(--panel)',
        transition: 'width .18s ease',
      }}
    >
      {initiative && (
        <div
          data-drawer-initiative={initiative.initiativeId}
          style={{ minWidth: 380, padding: '14px 16px 20px', maxHeight: VIEWPORT_HEIGHT + 34, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {body}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// RoadmapMinimap — a small proportional overview + click-to-jump. Pure
// scaling from the SAME `layout.positions` (no separate measurement).
// ---------------------------------------------------------------------------
function RoadmapMinimap({
  layout,
  initiatives,
  view,
  viewportRef,
  onJump,
  onPan,
}: {
  layout: RoadmapTimeLayout;
  initiatives: readonly RoadmapInitiative[];
  view: { tx: number; ty: number; scale: number };
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onJump: (id: string) => void;
  onPan: (v: { tx: number; ty: number; scale: number }) => void;
}) {
  const MM_W = 200;
  const worldW = Math.max(1, layout.worldWidth);
  const worldH = Math.max(1, layout.worldHeight);
  const mmH = Math.max(30, Math.round((MM_W * worldH) / worldW));
  const s = MM_W / worldW;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const vp = viewportRef.current;
      const r = e.currentTarget.getBoundingClientRect();
      if (!vp) return;
      const wx = (e.clientX - r.left) / s;
      const wy = (e.clientY - r.top) / s;
      onPan({ tx: vp.clientWidth / 2 - wx * view.scale, ty: vp.clientHeight / 2 - wy * view.scale, scale: view.scale });
    },
    [s, view.scale, viewportRef, onPan],
  );

  return (
    <div
      data-minimap
      onClick={handleClick}
      title="Minimap — click to jump"
      style={{
        position: 'absolute', right: 12, bottom: 12, width: MM_W, height: mmH,
        background: 'rgba(15,20,32,.92)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {initiatives.map((init) => {
        const p = layout.positions.get(init.initiativeId);
        if (!p) return null;
        const colour = STATUS_COLOR[queueStatusToColor(init.status)];
        return (
          <div
            key={init.initiativeId}
            onClick={(e) => {
              e.stopPropagation();
              onJump(init.initiativeId);
            }}
            style={{
              position: 'absolute', left: p.x * s, top: p.y * s,
              width: Math.max(2, p.w * s), height: Math.max(2, p.h * s),
              background: colour, opacity: 0.85, borderRadius: 1,
            }}
          />
        );
      })}
      {layout.nowX != null && (
        <div style={{ position: 'absolute', left: layout.nowX * s, top: 0, width: 1, height: mmH, background: 'var(--amber)', opacity: 0.9 }} />
      )}
    </div>
  );
}
