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
 * plan/recovery affordances are all present on first paint. The edge SVG
 * geometry is measured in a browser-only effect (ResizeObserver), so under
 * `renderToStaticMarkup` the edge elements exist with placeholder coordinates
 * and get positioned once mounted. The recovery-detail region is rendered
 * UNCONDITIONALLY on a recoverable node (empty until Inspect populates it) — a
 * detail region reachable only through a click would silently vanish from the
 * re-homed subtree, which is exactly what AT5 exists to prevent.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import type {
  ProjectRoadmap,
  RoadmapInitiative,
  RoadmapWorkItem,
  RecoveryInspect,
} from '@/lib/bridge-client';
import { fetchRecovery, recoveryRequeue, recoveryAbandon } from '@/lib/bridge-client';
import type { InitiativeGroup } from '@/lib/cycle-grouping';
import { byDepth } from '@/lib/roadmap-dag-layout';
import { queueStatusToColor } from '@/lib/roadmap-status-color';
import { STATUS_COLOR } from '@/lib/status-colors';
import { isRecoverableStatus, attemptInfoFor } from '@/lib/recovery-attrs';
import { topoLevels } from '@/lib/dep-layout';

// ---------------------------------------------------------------------------
// Per-initiative trigger state — the same two shapes page.tsx threads into the
// retiring InitiativeCard. Local (not imported) because page.tsx does not
// export them; the integration phase passes matching maps.
// ---------------------------------------------------------------------------
type DevelopCardState = { status: 'idle' | 'starting' | 'started' | 'error'; error: string | null };
const IDLE_DEVELOP: DevelopCardState = { status: 'idle', error: null };

type PlanCardState = { status: 'idle' | 'planning' | 'started' | 'error'; error: string | null };
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

  return (
    <div
      ref={containerRef}
      data-roadmap-dag
      data-initiative-count={initiatives.length}
      data-roadmap-edge-count={edges.length}
      style={{ position: 'relative', overflowX: 'auto', padding: '4px 2px' }}
    >
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

// ---------------------------------------------------------------------------
// RoadmapNode — one DAG node. Reproduces the retiring InitiativeCard's
// affordances with byte-identical data-* attributes, adds the per-node run
// dig-in (active + prior cycle links), and renders the recovery-detail region
// unconditionally on a recoverable node.
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
}) {
  const { initiativeId, title, status, dependsOnInitiatives, workItems, ready, blockedBy } = initiative;
  const colour = STATUS_COLOR[queueStatusToColor(status)];

  // Click-to-pop: the detail region is ALWAYS in the DOM (so the affordances
  // survive an SSR/no-jsdom render); the click only toggles its visual
  // expansion. Default expanded so first paint shows the full card.
  const [expanded, setExpanded] = useState(true);

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
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderTop: `3px solid ${colour}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative',
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
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>{initiativeId}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
          color: colour, background: `${colour}18`, borderRadius: 4, padding: '2px 6px', flexShrink: 0,
        }}>{status}</span>
      </button>

      {/* click-to-pop detail card — always present in the DOM; expansion is a
          visual toggle so the re-homed affordances can never silently vanish. */}
      <div
        data-node-detail
        style={{ display: expanded ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}
      >
        {dependsOnInitiatives.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--dim)' }}>
            Depends on: {dependsOnInitiatives.join(', ')}
          </div>
        )}

        {blocked && (
          <div data-section="initiative-blocked" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
            Blocked by: {blockedBy.join(', ')}
          </div>
        )}

        {unplanned && (
          <div data-section="initiative-blocked-until-planned" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
            Not yet planned — decompose it before starting development.
          </div>
        )}

        {wiLevels && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Work Items</div>
            {Array.from({ length: wiLevels.maxLevel + 1 }, (_, lvl) =>
              (wiLevels.byLevel.get(lvl) ?? []).map((w) => <WorkItemBadge key={w.id} wi={w} />),
            )}
          </div>
        )}

        {/* R4-13 run dig-in: active + prior (completed) cycles, joined on cycleId. */}
        {runCycleIds.length > 0 && (
          <div data-section="initiative-runs" style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Runs</div>
            {runCycleIds.map((cycleId, idx) => (
              <Link
                key={cycleId}
                data-run-link
                data-run-cycle-id={cycleId}
                data-run-active={idx === 0 ? 'true' : 'false'}
                href={`/flows/forge-develop/run/${cycleId}`}
                style={{ fontSize: 11, color: 'var(--c-dev, #4ca3f5)', textDecoration: 'underline' }}
              >
                {idx === 0 ? 'active run' : 'prior run'} · {cycleId} →
              </Link>
            ))}
          </div>
        )}

        {onOpenDemo && (
          <button
            data-link="demo-builder"
            onClick={onOpenDemo}
            style={{
              alignSelf: 'flex-start', fontSize: 11, color: 'var(--c-project, #1f6feb)',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            demo builder →
          </button>
        )}

        {/* R4-11-F2: Plan trigger — only on a WI-less pending initiative. */}
        {unplanned && plan.status !== 'started' && (
          <button
            data-action="plan-initiative"
            data-initiative-id={initiativeId}
            disabled={plan.status === 'planning' || !onPlan}
            onClick={() => void onPlan?.(initiativeId)}
            style={{
              marginTop: 4, alignSelf: 'flex-start',
              color: '#fff', background: plan.status === 'error' ? '#9e6a03' : '#1f6feb',
              border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
              fontSize: 12, fontWeight: 600, cursor: plan.status === 'planning' ? 'default' : 'pointer',
              opacity: plan.status === 'planning' ? 0.6 : 1,
            }}
          >
            {plan.status === 'planning' ? 'planning…' : plan.status === 'error' ? 'retry — plan' : 'Plan →'}
          </button>
        )}
        {unplanned && plan.status === 'error' && plan.error && (
          <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{plan.error}</div>
        )}
        {unplanned && plan.status === 'started' && (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Planning started — the initiative will be decomposed into work items.</span>
            <Link data-action="open-plan-run" href="/flows/forge-architect" style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}>
              view run →
            </Link>
          </div>
        )}

        {/* S7: start-development trigger — only on a decomposed, not-yet-developing initiative. */}
        {canStartDevelopment && develop.status !== 'started' && (
          <button
            data-action="start-development"
            data-initiative-id={initiativeId}
            disabled={develop.status === 'starting' || !onStart}
            onClick={() => void onStart?.(initiativeId)}
            style={{
              marginTop: 4, alignSelf: 'flex-start',
              color: '#fff', background: develop.status === 'error' ? '#9e6a03' : '#238636',
              border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
              fontSize: 12, fontWeight: 600, cursor: develop.status === 'starting' ? 'default' : 'pointer',
              opacity: develop.status === 'starting' ? 0.6 : 1,
            }}
          >
            {develop.status === 'starting' ? 'starting…' : develop.status === 'error' ? 'retry — start development' : 'Start development →'}
          </button>
        )}
        {develop.status === 'error' && develop.error && (
          <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{develop.error}</div>
        )}
        {develop.status === 'started' && (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Development started — the unifier will open a PR for review.</span>
            <Link data-action="open-develop-run" href="/flows/forge-develop" style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}>
              view run →
            </Link>
          </div>
        )}

        {/* R4-11-T3: recovery affordances — gated on the recoverable set
            (in-flight / ready-for-review / failed). The recovery-detail region
            is rendered UNCONDITIONALLY (populated by Inspect) so the re-home
            cannot drop a click-gated affordance. */}
        {isRecoverableStatus(status) && (
          <div
            data-recovery-item
            data-recovery-initiative={initiativeId}
            data-recovery-status={status}
            data-recovery-attempt-count={attempt.attemptCount}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                Recovery
                {attempt.attemptCount > 1 && (
                  <span
                    data-recovery-prior-attempts={attempt.attemptCount - 1}
                    title={`${attempt.attemptCount - 1} prior attempt(s): ${attempt.priorCycleIds.join(', ')}`}
                    style={{ marginLeft: 8, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--faint)', fontSize: 10.5 }}
                  >
                    ×{attempt.attemptCount}
                  </span>
                )}
              </div>
              <span style={{ display: 'flex', gap: 6 }}>
                <button data-action="recovery-inspect" onClick={() => void inspectRecovery()} style={recoveryBtn('var(--line)')}>Inspect</button>
                <button data-action="recovery-requeue" disabled={recoveryBusy} onClick={() => void doRecoveryAction('requeue')} style={recoveryBtn('#1f6feb')}>Requeue</button>
                <button data-action="recovery-abandon" disabled={recoveryBusy} onClick={() => void doRecoveryAction('abandon')} style={recoveryBtn('#a33')}>Abandon</button>
              </span>
            </div>

            <div data-section="recovery-detail" data-recovery-detail-initiative={initiativeId} style={{ fontSize: 11, color: 'var(--dim)' }}>
              {recoveryDetail ? (
                <>
                  <div>branch: <code>{recoveryDetail.branch}</code> · worktree: {recoveryDetail.worktreeExists ? 'preserved' : 'gone'} · PR draft: {recoveryDetail.prDraftChars ?? 0} chars</div>
                  {recoveryDetail.commits && recoveryDetail.commits.length > 0 && (
                    <pre data-recovery-commits style={{ background: 'var(--bg)', padding: 6, borderRadius: 4, marginTop: 4, overflowX: 'auto' }}>
                      {recoveryDetail.commits.join('\n')}
                    </pre>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--faint)', fontStyle: 'italic' }}>Inspect to load branch / worktree / PR-draft detail.</span>
              )}
            </div>
            {recoveryNote && <p data-recovery-note style={{ fontSize: 11, color: 'var(--faint)', margin: 0 }}>{recoveryNote}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function recoveryBtn(bg: string): React.CSSProperties {
  return { fontSize: 10, padding: '2px 8px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };
}

function WorkItemBadge({ wi }: { wi: RoadmapWorkItem }) {
  return (
    <div
      data-work-item-id={wi.id}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: 'var(--text)',
        background: 'var(--bg)', borderRadius: 'var(--radius-sm)',
        padding: '5px 9px', border: '1px solid var(--line)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--c-dev, #4ca3f5)', fontWeight: 700 }}>{wi.id}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wi.title}</span>
    </div>
  );
}
