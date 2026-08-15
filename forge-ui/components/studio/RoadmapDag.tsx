'use client';

/**
 * RoadmapDag — the R4-13 roadmap-tab surface. Replaces the time-ordered
 * serpentine timeline (INIT-date winding spine + host-rendered popover) with a
 * real DEPENDENCY DAG: initiatives laid out left→right by dependency depth, one
 * edge per (prerequisite → dependent) pair, and every R4-11 affordance re-homed
 * onto the node card so nothing is lost when the InitiativeCard subtree moves.
 *
 * RESEARCH-FIRST / why not reuse <DependencyDag> (components/studio/DependencyDag.tsx):
 * that component is a generic, reusable level-layout renderer over a
 * pre-computed `DependencyDagView<T>` — but it emits NO edge DOM elements
 * (dependencies show only as `unresolved: …` text), no run links, and none of
 * the roadmap-node affordances (plan/lock, recovery, run dig-in). The roadmap
 * tab needs all three. So this reuses the shared FOUNDATION helpers —
 * `byDepth` (column = max(parent column)+1, cap MAX_COLUMN) for layout and
 * `queueStatusToColor` for the node tone — and renders the edges + affordance
 * cards here rather than bending the generic renderer to fit.
 *
 * NO-jsdom render contract (see lib/roadmap-dag-render.test.ts): the component
 * renders its full initial DOM synchronously — edges, run links, and the
 * plan/recovery affordances are all present on first paint (the DETAIL region
 * is always mounted, just `display:none` while collapsed — see W6-RV-1 below).
 * The edge SVG geometry is measured in a browser-only effect (ResizeObserver),
 * so under `renderToStaticMarkup` the edge elements exist with placeholder
 * coordinates and get positioned once mounted. The recovery-detail region is
 * rendered UNCONDITIONALLY on a recoverable node (empty until Inspect
 * populates it) — a detail region reachable only through a click would
 * silently vanish from the re-homed subtree, which is exactly what AT5 exists
 * to prevent.
 *
 * W6-RV-1 (direction-agnostic first step toward the RV-2 time-axis canvas):
 * the detail body — deps line, blocked-by, WI badges, run links, plan/
 * start-development triggers, the recovery region — moved out to
 * `InitiativeDetail.tsx` as a pure re-home (byte-identical DOM/data-*). Nodes
 * now default COLLAPSED (a uniform, scannable card: title/id/status chip +
 * two micro-badges) instead of the old expanded-by-default full card, so a
 * roadmap with many initiatives stays readable; a per-node click, or the new
 * collapse-all/expand-all toolbar, toggles the full `InitiativeDetail` back
 * in. See `lib/roadmap-dag-render.test.ts` for the collapsed-card contract
 * pins (`data-initiative-collapsed`, `data-micro-badge`).
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
import { byDepth } from '@/lib/roadmap-dag-layout';
import { queueStatusToColor } from '@/lib/roadmap-status-color';
import { STATUS_COLOR } from '@/lib/status-colors';
import { attemptInfoFor } from '@/lib/recovery-attrs';
import { topoLevels } from '@/lib/dep-layout';
import { InitiativeDetail } from './InitiativeDetail';

// ---------------------------------------------------------------------------
// Per-initiative trigger state — the same two shapes page.tsx threads into the
// retiring InitiativeCard. Exported (not imported FROM page.tsx — it does not
// export them) so InitiativeDetail.tsx can share the same two shapes instead
// of redeclaring them.
// ---------------------------------------------------------------------------
export type DevelopCardState = { status: 'idle' | 'starting' | 'started' | 'error'; error: string | null };
const IDLE_DEVELOP: DevelopCardState = { status: 'idle', error: null };

export type PlanCardState = { status: 'idle' | 'planning' | 'started' | 'error'; error: string | null };
const IDLE_PLAN: PlanCardState = { status: 'idle', error: null };

/** planStateAttr, mirrored byte-for-byte from app/projects/[id]/page.tsx so the
 *  DOM-as-metrics attribute reads identically after the re-home. */
function planStateAttr(unplanned: boolean, plan: PlanCardState): 'planned' | 'planning' | 'error' | 'unplanned' {
  if (!unplanned) return 'planned';
  if (plan.status === 'error') return 'error';
  if (plan.status === 'planning' || plan.status === 'started') return 'planning';
  return 'unplanned';
}

type EdgeGeom = { x1: number; y1: number; x2: number; y2: number };

export type RoadmapDagProps = {
  roadmap: ProjectRoadmap;
  /** run-link join source (lib/cycle-grouping): activeCycleId + priorCycleIds. */
  cycleGroups: InitiativeGroup[];
  developByInitiative?: Record<string, DevelopCardState>;
  planByInitiative?: Record<string, PlanCardState>;
  onStart?: (initiativeId: string) => void | Promise<void>;
  onPlan?: (initiativeId: string) => void | Promise<void>;
  /** called after a successful requeue/abandon to refetch roadmap + cycle groups. */
  onRecoveryDone?: () => void | Promise<void>;
  onOpenDemo?: () => void;
};

const COLUMN_GAP = 56;
const NODE_GAP = 18;
const COLUMN_MIN_WIDTH = 300;

export function RoadmapDag({
  roadmap,
  cycleGroups,
  developByInitiative,
  planByInitiative,
  onStart,
  onPlan,
  onRecoveryDone,
  onOpenDemo,
}: RoadmapDagProps) {
  const initiatives = roadmap.initiatives;

  // Layout: column = dependency depth (Foundation helper).
  const columns = useMemo(() => byDepth(initiatives), [initiatives]);

  // Bucket initiatives into ascending depth columns, preserving roadmap order
  // within a column so the render is deterministic.
  const columnBuckets = useMemo(() => {
    const buckets = new Map<number, RoadmapInitiative[]>();
    for (const init of initiatives) {
      const col = columns.get(init.initiativeId) ?? 0;
      const bucket = buckets.get(col);
      if (bucket) bucket.push(init);
      else buckets.set(col, [init]);
    }
    return [...buckets.entries()].sort(([a], [b]) => a - b);
  }, [initiatives, columns]);

  // Every (prerequisite → dependent) pair that has both ends in the roadmap.
  const edges = useMemo(() => {
    const known = new Set(initiatives.map((i) => i.initiativeId));
    return initiatives.flatMap((init) =>
      init.dependsOnInitiatives
        .filter((parent) => known.has(parent))
        .map((parent) => ({ from: parent, to: init.initiativeId })),
    );
  }, [initiatives]);

  // Edge geometry, measured in the browser. SSR leaves it empty → edges render
  // with placeholder coordinates (their data-* hooks are what the tests pin).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [edgeGeom, setEdgeGeom] = useState<Record<string, EdgeGeom>>({});

  const registerNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const anchors = new Map<string, { left: number; right: number; cy: number }>();
    for (const [id, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      anchors.set(id, {
        left: r.left - cRect.left,
        right: r.right - cRect.left,
        cy: r.top - cRect.top + r.height / 2,
      });
    }
    const next: Record<string, EdgeGeom> = {};
    for (const edge of edges) {
      const p = anchors.get(edge.from);
      const c = anchors.get(edge.to);
      if (!p || !c) continue;
      next[edgeKey(edge)] = { x1: p.right, y1: p.cy, x2: c.left, y2: c.cy };
    }
    setEdgeGeom(next);
  }, [edges]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    measure();
    const container = containerRef.current;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro && container) ro.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // W6-RV-1: collapse-all/expand-all. Every RoadmapNode keeps its own local
  // `expanded` useState (default collapsed) — these are one-shot SIGNAL
  // tokens, not lifted state: bumping the counter tells every node "force
  // yourself collapsed/expanded now", then each node goes back to owning its
  // own toggle. Avoids lifting per-node expand state (and its re-render
  // fan-out) into the DAG just to serve two bulk buttons.
  const [collapseAllToken, setCollapseAllToken] = useState(0);
  const [expandAllToken, setExpandAllToken] = useState(0);

  return (
    <div
      ref={containerRef}
      data-roadmap-dag
      data-initiative-count={initiatives.length}
      data-roadmap-edge-count={edges.length}
      style={{ position: 'relative', overflowX: 'auto', padding: '4px 2px' }}
    >
      <div data-roadmap-toolbar style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          data-action="roadmap-collapse-all"
          onClick={() => setCollapseAllToken((n) => n + 1)}
          style={toolbarBtnStyle}
        >
          Collapse all
        </button>
        <button
          type="button"
          data-action="roadmap-expand-all"
          onClick={() => setExpandAllToken((n) => n + 1)}
          style={toolbarBtnStyle}
        >
          Expand all
        </button>
      </div>

      {/* Edge overlay — one <path> per (prerequisite → dependent) pair. Drawn
          under the cards; pointer-transparent so the nodes stay clickable. */}
      <svg
        data-dag-edges
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 0 }}
      >
        {edges.map((edge) => {
          const g = edgeGeom[edgeKey(edge)];
          const d = g
            ? `M ${g.x1} ${g.y1} C ${g.x1 + COLUMN_GAP / 2} ${g.y1}, ${g.x2 - COLUMN_GAP / 2} ${g.y2}, ${g.x2} ${g.y2}`
            : 'M 0 0';
          return (
            <path
              key={edgeKey(edge)}
              data-dep-edge
              data-dep-from={edge.from}
              data-dep-to={edge.to}
              d={d}
              fill="none"
              stroke="var(--line, #30363d)"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', gap: COLUMN_GAP, alignItems: 'flex-start' }}>
        {columnBuckets.map(([col, inits]) => (
          <div
            key={col}
            data-dag-column={col}
            style={{ display: 'flex', flexDirection: 'column', gap: NODE_GAP, minWidth: COLUMN_MIN_WIDTH }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>
              Depth {col}
            </div>
            {inits.map((init) => (
              <RoadmapNode
                key={init.initiativeId}
                initiative={init}
                group={cycleGroups.find((g) => g.initiativeId === init.initiativeId)}
                develop={developByInitiative?.[init.initiativeId] ?? IDLE_DEVELOP}
                plan={planByInitiative?.[init.initiativeId] ?? IDLE_PLAN}
                attempt={attemptInfoFor(init.initiativeId, cycleGroups)}
                registerNode={registerNode}
                onStart={onStart}
                onPlan={onPlan}
                onRecoveryDone={onRecoveryDone}
                onOpenDemo={onOpenDemo}
                collapseAllToken={collapseAllToken}
                expandAllToken={expandAllToken}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function edgeKey(edge: { from: string; to: string }): string {
  return `${edge.from}->${edge.to}`;
}

const toolbarBtnStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text)', background: 'var(--panel)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// RoadmapNode — one DAG node. Collapsed by default (a uniform, scannable
// card: title/id/status chip + deps-count/WI-progress micro-badges);
// expanding it renders `InitiativeDetail` — the retiring InitiativeCard's
// affordances re-homed there with byte-identical data-* attributes, plus the
// per-node run dig-in (active + prior cycle links) and the recovery-detail
// region, unconditionally rendered on a recoverable node.
// ---------------------------------------------------------------------------
function RoadmapNode({
  initiative,
  group,
  develop,
  plan,
  attempt,
  registerNode,
  onStart,
  onPlan,
  onRecoveryDone,
  onOpenDemo,
  collapseAllToken,
  expandAllToken,
}: {
  initiative: RoadmapInitiative;
  group?: InitiativeGroup;
  develop: DevelopCardState;
  plan: PlanCardState;
  attempt: { attemptCount: number; priorCycleIds: string[] };
  registerNode: (id: string, el: HTMLElement | null) => void;
  onStart?: (initiativeId: string) => void | Promise<void>;
  onPlan?: (initiativeId: string) => void | Promise<void>;
  onRecoveryDone?: () => void | Promise<void>;
  onOpenDemo?: () => void;
  /** W6-RV-1: bump-to-fire signals from the DAG's collapse-all/expand-all toolbar. */
  collapseAllToken: number;
  expandAllToken: number;
}) {
  const { initiativeId, title, status, dependsOnInitiatives, workItems, ready, blockedBy } = initiative;
  const colour = STATUS_COLOR[queueStatusToColor(status)];

  // W6-RV-1: default COLLAPSED — a uniform, scannable card at first paint.
  // The detail region stays ALWAYS in the DOM (so the affordances survive an
  // SSR/no-jsdom render); the click only toggles its visual expansion.
  const [expanded, setExpanded] = useState(false);

  // Bulk collapse-all/expand-all: each token is a one-shot signal (bumped by
  // the DAG's toolbar buttons), tracked here via a ref of the last-seen value
  // so a REPEAT click of the same button still fires (the token changes on
  // every click) without fighting the node's own local toggle in between.
  const seenCollapseToken = useRef(collapseAllToken);
  const seenExpandToken = useRef(expandAllToken);
  useEffect(() => {
    if (collapseAllToken !== seenCollapseToken.current) {
      seenCollapseToken.current = collapseAllToken;
      setExpanded(false);
    }
  }, [collapseAllToken]);
  useEffect(() => {
    if (expandAllToken !== seenExpandToken.current) {
      seenExpandToken.current = expandAllToken;
      setExpanded(true);
    }
  }, [expandAllToken]);

  // Recovery state — folded off the retired standalone /recovery page, same as
  // InitiativeCard. Effects/handlers do not run under renderToStaticMarkup.
  const [recoveryDetail, setRecoveryDetail] = useState<RecoveryInspect | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState('');

  const inspectRecovery = useCallback(async (): Promise<void> => {
    setRecoveryDetail(await fetchRecovery(initiativeId));
  }, [initiativeId]);

  const doRecoveryAction = useCallback(async (kind: 'requeue' | 'abandon'): Promise<void> => {
    setRecoveryBusy(true);
    setRecoveryNote('');
    const res = kind === 'requeue'
      ? await recoveryRequeue(initiativeId, { resetRetries: true })
      : await recoveryAbandon(initiativeId);
    setRecoveryBusy(false);
    setRecoveryNote(res.ok ? `${kind} ok` : `${kind} failed: ${res.error ?? 'unknown'}`);
    if (res.ok) {
      setRecoveryDetail(null);
      await onRecoveryDone?.();
    }
  }, [initiativeId, onRecoveryDone]);

  // R4-11-F2: "planned" == a WI snapshot exists (independent of queue status).
  const planned = workItems !== undefined;
  const unplanned = status === 'pending' && !planned;
  const canStartDevelopment = status === 'pending' && ready && planned;
  const blocked = status === 'pending' && !ready;

  const wiLevels = workItems && workItems.length > 0
    ? topoLevels(workItems, (w) => w.id, (w) => w.dependsOn)
    : null;

  // Per-node run dig-in: the active cycle plus every prior (completed) attempt,
  // linked by cycleId — never the bare initiativeId.
  const runCycleIds = group ? [group.activeCycleId, ...group.priorCycleIds] : [];

  // W6-RV-1: the collapsed card's two micro-badges — deps count, WI done/total.
  // 'complete' counts toward done; 'failed' counts in the total but NOT
  // toward done (a failed WI is not silently folded into "not done yet" —
  // its own count surfaces via data-badge-failed + the visual indicator
  // below, since failed != pending is real signal an operator needs); an
  // undefined workItems (unplanned) reads as 0/0, never a fabricated total.
  const depsCount = dependsOnInitiatives.length;
  const wiTotal = workItems?.length ?? 0;
  const wiDone = workItems?.filter((w) => w.status === 'complete').length ?? 0;
  const wiFailed = workItems?.filter((w) => w.status === 'failed').length ?? 0;
  const wiAllComplete = wiTotal > 0 && wiDone === wiTotal && wiFailed === 0;

  return (
    <div
      ref={(el) => registerNode(initiativeId, el)}
      data-roadmap-node
      data-initiative-id={initiativeId}
      data-initiative-status={status}
      data-develop-state={develop.status}
      data-plan-state={planStateAttr(unplanned, plan)}
      data-initiative-ready={String(ready)}
      data-blocked-by={blockedBy.join(',')}
      data-initiative-collapsed={String(!expanded)}
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderTop: `3px solid ${colour}`,
        borderRadius: 'var(--radius)',
        padding: expanded ? '14px 16px' : '10px 12px',
        display: 'flex', flexDirection: 'column', gap: expanded ? 10 : 6,
        position: 'relative',
        width: expanded ? undefined : 280,
        minHeight: expanded ? undefined : 72,
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        data-action="toggle-node-detail"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            title={title}
            style={{
              fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35,
              ...(expanded ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
            }}
          >{title}</div>
          <div style={{
            fontSize: 11, color: 'var(--faint)', marginTop: 3,
            ...(expanded ? {} : { fontFamily: 'var(--font-mono, monospace)' }),
          }}>{initiativeId}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
          color: colour, background: `${colour}18`, borderRadius: 4, padding: '2px 6px', flexShrink: 0,
        }}>{status}</span>
      </button>

      {/* W6-RV-1: the uniform collapsed card's two micro-badges — deps count,
          WI done/total. Only rendered while collapsed; the expanded state
          shows the real deps line + per-WI badges instead (InitiativeDetail).
          wi-progress styling: muted when unplanned (0/0 — nothing to show
          yet, distinct from "done"), a complete tone when every WI is done
          with zero failures, neutral otherwise. A failed WI always surfaces
          via [data-badge-failed] + a visual marker — never silently folded
          into "not done yet". */}
      {!expanded && (
        <div data-micro-badges style={{ display: 'flex', gap: 6 }}>
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
              <span
                data-badge-failed-marker
                title={`${wiFailed} failed work item${wiFailed === 1 ? '' : 's'}`}
                style={{ marginLeft: 4, color: STATUS_COLOR.failed, fontWeight: 700 }}
              >
                ⚠{wiFailed}
              </span>
            )}
          </span>
        </div>
      )}

      <InitiativeDetail
        expanded={expanded}
        initiativeId={initiativeId}
        status={status}
        dependsOnInitiatives={dependsOnInitiatives}
        blocked={blocked}
        blockedBy={blockedBy}
        unplanned={unplanned}
        wiLevels={wiLevels}
        runCycleIds={runCycleIds}
        onOpenDemo={onOpenDemo}
        plan={plan}
        onPlan={onPlan}
        canStartDevelopment={canStartDevelopment}
        develop={develop}
        onStart={onStart}
        attempt={attempt}
        recoveryDetail={recoveryDetail}
        recoveryBusy={recoveryBusy}
        recoveryNote={recoveryNote}
        onInspectRecovery={inspectRecovery}
        onRecoveryAction={doRecoveryAction}
      />
    </div>
  );
}

const microBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--dim)', background: 'var(--bg)',
  border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap',
};

/** wi-progress micro-badge tone: muted when unplanned (0/0 — distinct from
 *  "done", never conflated with it), the shared complete tone when every WI
 *  is done with zero failures, neutral (the base badge) otherwise — a failed
 *  WI's own indicator (data-badge-failed + the ⚠ marker) carries that signal
 *  instead of a badge-wide tone change. */
function wiProgressBadgeStyle(wiTotal: number, wiAllComplete: boolean): React.CSSProperties {
  if (wiTotal === 0) {
    return { ...microBadgeStyle, color: 'var(--faint)', fontStyle: 'italic', opacity: 0.7 };
  }
  if (wiAllComplete) {
    return { ...microBadgeStyle, color: STATUS_COLOR.complete, borderColor: `${STATUS_COLOR.complete}55` };
  }
  return microBadgeStyle;
}
