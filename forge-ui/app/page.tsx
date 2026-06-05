'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCost,
  fetchCycles,
  fetchEvents,
  subscribe,
  fetchArchitectSessions,
  fetchLiveness,
  resolveBridgeUrl,
  type CostSummary,
  type Cycle,
  type CycleListSnapshot,
  type ConnectionState,
  type ArchitectSessionSummary,
} from '@/lib/bridge-client';
import { CycleToasts } from '@/components/Toasts';
import { AgentGraphCanvas } from '@/components/AgentGraphCanvas';
import { HexDetailDrawer } from '@/components/HexDetailDrawer';
import { ArchitectLauncher } from '@/components/ArchitectLauncher';
import { SchedulerBanner } from '@/components/SchedulerBanner';
import type { SelectedHex } from '@/lib/hex-detail';
import { fetchWiGraph, type WiGraph } from '@/lib/wi-graph';
import { useGraphModel } from '@/lib/use-graph-model';
import { useBatchedEvents } from '@/lib/use-batched-events';
import { PHASE_ORDER, costForPhaseHex } from '@/lib/phases';
import { STATUS_COLOR } from '@/lib/status-colors';
import { topoLevels } from '@/lib/dep-layout';

export default function Page() {
  const [snapshot, setSnapshot] = useState<CycleListSnapshot>({ live: [], recent: [] });
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  // Phase B: batched event buffer — coalesces high-frequency per-tool events
  // into ≤4 state flushes/sec so the graph re-derives at a bounded cadence.
  const { events, append: appendEvent, reset: resetEvents } = useBatchedEvents();
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  // Feature #8 — daemon-stall liveness. Polled from the bridge; when the daemon
  // heartbeats go stale past a generous threshold we flip the page-level
  // conn-state to `daemon-stalled` and fire ONE toast (edge-triggered, not
  // repeated). The OS supervisor (systemd / pm2) is what actually restarts
  // `forge serve` — this only SURFACES the stall (docs/operations/serve-supervision.md).
  const [daemonStalled, setDaemonStalled] = useState(false);
  const [stallNotice, setStallNotice] = useState<string | null>(null);
  const stallFiredRef = useRef(false);
  // ADR 020 — in-UI architect sessions. Fetched on mount + on every
  // `architect-list-changed` WS message (the runner checkpoints between turns).
  const [architectSessions, setArchitectSessions] = useState<ArchitectSessionSummary[]>([]);

  // The WS handler captures activeCycleId via a ref so we don't churn the
  // subscription every time the operator clicks a different cycle.
  const activeCycleIdRef = useRef<string | null>(null);
  useEffect(() => { activeCycleIdRef.current = activeCycleId; }, [activeCycleId]);

  // Open the WebSocket exactly once per mount. Cycle filtering happens
  // inside the handler against the ref.
  useEffect(() => {
    let cancelled = false;
    fetchCycles()
      .then((s) => { if (!cancelled) setSnapshot(s); })
      .catch(() => { /* bridge offline — connState will report */ });
    fetchArchitectSessions()
      .then((s) => { if (!cancelled) setArchitectSessions(s); })
      .catch(() => { /* ignore */ });

    const sub = subscribe({
      onState: setConnState,
      onMessage: (msg) => {
        if (msg.type === 'snapshot') {
          setSnapshot(msg.cycles);
        } else if (msg.type === 'cycle-list-changed') {
          fetchCycles().then(setSnapshot).catch(() => { /* ignore */ });
        } else if (msg.type === 'architect-list-changed') {
          fetchArchitectSessions().then(setArchitectSessions).catch(() => { /* ignore */ });
        } else if (msg.type === 'event' && msg.cycleId === activeCycleIdRef.current) {
          appendEvent(msg.event);
        }
      },
    });
    return () => { cancelled = true; sub.close(); };
  }, []);

  // When the operator selects a different cycle, snapshot its full event log.
  useEffect(() => {
    if (!activeCycleId) { resetEvents([]); return; }
    let cancelled = false;
    fetchEvents(activeCycleId).then((rows) => { if (!cancelled) resetEvents(rows); });
    return () => { cancelled = true; };
  }, [activeCycleId, resetEvents]);

  // Feature #9: operator-selected hex (phase / feature / wi), set by clicking
  // ANY hex in AgentGraphCanvas. Drives the hex-detail drawer (definition +
  // scoped activity).
  const [selectedHex, setSelectedHex] = useState<SelectedHex | null>(null);

  // U1: cost summary per cycle. Re-fetched whenever the active cycle
  // changes; also re-fetched every 10s so live cycles show their cost
  // ticking up. Cheap (just reads the events.jsonl server-side).
  const [cost, setCost] = useState<CostSummary | null>(null);
  useEffect(() => {
    if (!activeCycleId) { setCost(null); return; }
    let cancelled = false;
    const refresh = (): void => {
      fetchCost(activeCycleId).then((c) => { if (!cancelled) setCost(c); });
    };
    refresh();
    const id = setInterval(refresh, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeCycleId]);

  // Feature #8 — poll the bridge's daemon-stall liveness every 30s. Edge-fire a
  // single toast on the not-stalled → stalled transition; clear it on recovery
  // so a later genuine stall can notify again.
  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void fetchLiveness().then((l) => {
        if (cancelled || !l) return;
        setDaemonStalled(l.stalled);
        if (l.stalled && !stallFiredRef.current) {
          stallFiredRef.current = true;
          const mins = Math.round(l.maxHeartbeatAgeMs / 60000);
          setStallNotice(`Scheduler daemon may be stalled — no heartbeat for ~${mins} min. Check the forge serve supervisor (systemd / pm2).`);
        } else if (!l.stalled && stallFiredRef.current) {
          stallFiredRef.current = false;
          setStallNotice(null);
        }
      }).catch(() => { /* bridge offline — connState reports separately */ });
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // The page-level connection state the DOM mirrors: the daemon-stalled signal
  // overrides only when the bridge itself is reachable (`open`). When the
  // bridge is unreachable, `reconnecting` / `no-bridge` is the truer signal.
  const effectiveConnState: ConnectionState =
    connState === 'open' && daemonStalled ? 'daemon-stalled' : connState;

  const allCycles = useMemo(() => [...snapshot.live, ...snapshot.recent], [snapshot]);
  // Project names the operator has worked with — feeds the new-idea datalist.
  const knownProjects = useMemo(() => {
    const names = new Set<string>();
    for (const c of allCycles) if (c.project) names.add(c.project);
    for (const s of architectSessions) names.add(s.project);
    return [...names].sort();
  }, [allCycles, architectSessions]);
  const defaultActive = useMemo(
    () => snapshot.live[0] ?? snapshot.recent[0] ?? null,
    [snapshot],
  );
  // Drive an initial selection once cycles are known.
  useEffect(() => {
    if (!activeCycleId && defaultActive) setActiveCycleId(defaultActive.cycleId);
  }, [activeCycleId, defaultActive]);

  const activeCycle = useMemo(
    () => allCycles.find((c) => c.cycleId === activeCycleId) ?? null,
    [allCycles, activeCycleId],
  );

  // WI graph for the active cycle (PM emits `_logs/<id>/work-items-
  // snapshot/_graph.md` at pm.end). Feeds the pipeline-tree WI tier.
  // Polls until the bridge serves the graph, then stops.
  const [wiGraph, setWiGraph] = useState<WiGraph | null>(null);
  useEffect(() => {
    setWiGraph(null);
    if (!activeCycleId) return;
    let cancelled = false;
    let loaded = false;
    const attempt = (): void => {
      if (loaded) return;
      void fetchWiGraph(activeCycleId).then((g) => {
        if (cancelled) return;
        if (g) { setWiGraph(g); loaded = true; }
      });
    };
    attempt();
    const id = setInterval(attempt, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeCycleId]);

  // Phase B: all pipeline-graph derivation (phase states, work items + per-WI
  // status) lives in one shared hook so the graph + heatmap consume a single
  // source. Feature tier removed — WIs derive directly from events.
  const { phaseStates, workItems } = useGraphModel({
    events,
    wiGraph,
  });

  // Surface the resolved bridge URL in the DOM so the operator can
  // diagnose connectivity from view-source / dev-tools without needing
  // to instrument the browser. Updated once on mount.
  const [bridgeUrlDebug, setBridgeUrlDebug] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    resolveBridgeUrl().then((url) => { if (!cancelled) setBridgeUrlDebug(url || '(none)'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main
      style={{ padding: '16px 24px', minHeight: '100vh' }}
      // DOM-as-metrics root (cwc-workshops "how-we-claude-code" pattern):
      // every load-bearing UI state is mirrored to a data-* attribute so
      // playwright / scripted automation / LLM-driven UI tests can read
      // page state without scraping rendered text. Keep these in sync
      // when changing component state.
      data-conn-state={effectiveConnState}
      data-daemon-stalled={daemonStalled ? 'true' : 'false'}
      data-bridge-url={bridgeUrlDebug}
      data-live-count={snapshot.live.length}
      data-recent-count={snapshot.recent.length}
      data-active-cycle-id={activeCycleId ?? ''}
      data-active-cycle-status={activeCycle?.status ?? ''}
      data-active-cycle-events={events.length}
      data-active-cycle-cost-usd={cost?.totalUsd ?? ''}
      data-page-ready={effectiveConnState === 'open' || effectiveConnState === 'no-bridge' || effectiveConnState === 'daemon-stalled' ? 'true' : 'false'}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 18, letterSpacing: 0.4 }}>forge</h1>
        <ConnectionBadge state={effectiveConnState} />
        {cost && (
          <span
            data-cost-badge
            data-cost-usd={cost.totalUsd}
            style={{ fontSize: 12, color: '#d2a8ff', fontFamily: 'ui-monospace, Menlo, monospace' }}
            title={`Per-phase: ${PHASE_ORDER.map((p) => ({ p, c: costForPhaseHex(p, cost) })).filter((x) => x.c > 0).map((x) => `${x.p}=$${x.c.toFixed(2)}`).join(' · ')}`}
          >
            ${cost.totalUsd.toFixed(2)}
          </span>
        )}
        {connState !== 'open' && bridgeUrlDebug && (
          <span
            data-bridge-url-visible
            style={{ fontSize: 11, color: '#8b949e', fontFamily: 'ui-monospace, Menlo, monospace' }}
            title="The URL the browser is trying to reach for the bridge"
          >
            → {bridgeUrlDebug}
          </span>
        )}
      </header>

      <SchedulerBanner />

      <ArchitectLauncher sessions={architectSessions} knownProjects={knownProjects} />

      <CyclesTab cycles={allCycles} activeId={activeCycleId} onSelect={setActiveCycleId} />

      {/* The inline review verdict box was retired (ADR 020 cleanup) — the
          review human moment runs via /forge-review (own session), merging the
          PR in GitHub, or a future standalone review screen mirroring
          /architect/[sessionId]. */}

      {/* Live React Flow pipeline graph: phase spine on top, features
          branching off dev-loop, WIs below, ephemeral tool nodes pulsing
          off the active WI as per-tool events arrive. */}
      <section style={{ marginTop: 24, display: 'flex', alignItems: 'stretch', gap: 12 }} data-section="pipeline-tree">
        {/* The canvas keeps its full width; the hex-detail drawer (Feature #9)
            sits BESIDE it (flex sibling), never covering the hexes. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <AgentGraphCanvas
            phaseStates={phaseStates}
            cost={cost}
            workItems={workItems}
            events={events}
            cycleId={activeCycleId}
            selectedHex={selectedHex}
            onSelectHex={setSelectedHex}
          />
        </div>
        {selectedHex && (
          <div style={{ position: 'relative', flex: '0 0 460px', minHeight: 0 }}>
            <HexDetailDrawer
              hex={selectedHex}
              cycleId={activeCycleId}
              events={events}
              phaseStates={phaseStates}
              cost={cost}
              workItems={workItems}
              onClose={() => setSelectedHex(null)}
            />
          </div>
        )}
      </section>

      <CycleToasts snapshot={snapshot} />

      {/* Feature #8 — single edge-fired daemon-stall notice (not repeated). */}
      {stallNotice && (
        <div
          data-component="daemon-stall-toast"
          onClick={() => setStallNotice(null)}
          style={{
            position: 'fixed', left: 16, bottom: 16, maxWidth: 360, zIndex: 1001,
            background: '#161b22', border: '1px solid #d29922', color: '#e6edf3',
            borderRadius: 8, padding: '10px 14px', fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {stallNotice}
        </div>
      )}
    </main>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const colour =
    state === 'open' ? '#7ee787' :
    state === 'connecting' ? '#d29922' :
    state === 'reconnecting' ? '#f85149' :
    state === 'daemon-stalled' ? '#d29922' :
    '#8b949e';
  const glyph =
    state === 'open' ? '●' :
    state === 'connecting' ? '◐' :
    state === 'reconnecting' ? '◌' :
    state === 'daemon-stalled' ? '◑' :
    '○';
  const label = state === 'daemon-stalled' ? 'daemon stalled' : state;
  return (
    <span style={{ fontSize: 12, color: colour }} data-conn-badge data-state={state}>
      bridge {glyph} {label}
    </span>
  );
}

// ----- Initiative pane (grouped-by-project roadmap) -----------------------

const CYCLE_STATUS_META: Record<Cycle['status'], { color: string; label: string; rank: number }> = {
  'in-flight': { color: STATUS_COLOR.active, label: 'running', rank: 0 },
  'ready-for-review': { color: STATUS_COLOR.attention, label: 'review', rank: 1 },
  pending: { color: STATUS_COLOR.idle, label: 'queued', rank: 2 },
  done: { color: STATUS_COLOR.complete, label: 'done', rank: 3 },
  failed: { color: STATUS_COLOR.failed, label: 'failed', rank: 4 },
};

/** Strip the `INIT-YYYY-MM-DD-` prefix to the readable slug; fall back to the id. */
function initiativeSlug(initiativeId: string): string {
  const m = /^INIT-\d{4}-\d{2}-\d{2}-(.+)$/.exec(initiativeId);
  return m ? m[1] : initiativeId;
}

/**
 * The initiative pane — cycles grouped into projects with a roadmap-style
 * track per project. Each project header carries a status tally; each cycle is
 * a status-coloured card sorted by lifecycle rank (running → review → queued →
 * done → failed). Projects with active work float to the top.
 */
function CyclesTab({
  cycles,
  activeId,
  onSelect,
}: {
  cycles: Cycle[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (cycles.length === 0) {
    return (
      <div style={{ color: '#8b949e', fontSize: 13 }} data-section="cycles-tab" data-cycles-empty="true">
        No cycles yet. Run <code>forge enqueue …</code> + <code>forge start</code>.
      </div>
    );
  }

  // Group by project.
  const groups = new Map<string, Cycle[]>();
  for (const c of cycles) {
    const key = c.project ?? '(no project)';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  const sortedGroups = [...groups.entries()]
    .map(([project, list]) => {
      const sorted = [...list].sort(
        (a, b) => CYCLE_STATUS_META[a.status].rank - CYCLE_STATUS_META[b.status].rank,
      );
      const hasActive = sorted.some((c) => c.status === 'in-flight' || c.status === 'ready-for-review');
      return { project, list: sorted, hasActive };
    })
    .sort((a, b) =>
      a.hasActive !== b.hasActive ? (a.hasActive ? -1 : 1) : a.project.localeCompare(b.project),
    );

  return (
    <div
      data-section="cycles-tab"
      data-cycles-count={cycles.length}
      data-project-count={sortedGroups.length}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {sortedGroups.map(({ project, list }) => {
        const tally = list.reduce<Record<string, number>>((acc, c) => {
          acc[c.status] = (acc[c.status] ?? 0) + 1;
          return acc;
        }, {});
        return (
          <div
            key={project}
            data-project-group={project}
            data-project-cycle-count={list.length}
            style={{ border: '1px solid #21262d', borderRadius: 8, padding: '10px 12px', background: '#0b0f14' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>{project}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                {(Object.keys(CYCLE_STATUS_META) as Cycle['status'][])
                  .filter((s) => tally[s])
                  .map((s) => (
                    <span key={s} title={CYCLE_STATUS_META[s].label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8b949e' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: CYCLE_STATUS_META[s].color }} />
                      {tally[s]}
                    </span>
                  ))}
              </span>
            </div>
            <RoadmapTrack list={list} activeId={activeId} onSelect={onSelect} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Feature #10 — per-project roadmap spine. Lays the project's initiatives
 * left-to-right by topological level (level 0 = no `depends_on_initiatives`,
 * level n = max(dep levels) + 1), so a dependent initiative sits to the RIGHT
 * of its prerequisite and the dependency flow reads as a straight spine with
 * bubbles coming off it. Initiatives at the same level STACK vertically (the
 * "bubbles coming off the top and bottom"). A single flat level (no edges) is
 * the HONEST signal that the architect under-structured the roadmap — shown
 * flat, exactly as it is.
 *
 * Dependency edges resolve cycle→cycle by matching each cycle's
 * `dependsOnInitiatives` entries against the sibling cycles' `initiativeId`.
 */
function RoadmapTrack({
  list,
  activeId,
  onSelect,
}: {
  list: Cycle[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  // Map initiativeId → cycle so dependency edges (which reference initiative
  // ids) resolve to the rendered cards. Topo levels are computed over the
  // cycles, keyed by their initiativeId.
  const byInit = new Map(list.map((c) => [c.initiativeId, c] as const));
  const { levelById, byLevel, maxLevel } = topoLevels(
    list,
    (c) => c.initiativeId,
    (c) => (c.dependsOnInitiatives ?? []).filter((d) => byInit.has(d)),
  );
  const levels = Array.from({ length: maxLevel + 1 }, (_, i) => byLevel.get(i) ?? []);
  // Whether ANY initiative has a resolvable cross-initiative dep — drives the
  // honest flat-vs-spine signal in the DOM (a flat roadmap has no edges).
  const hasEdges = maxLevel > 0;

  return (
    <div
      data-project-track
      data-roadmap-spine={hasEdges ? 'true' : 'false'}
      data-roadmap-levels={maxLevel + 1}
      style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto' }}
    >
      {levels.map((bucket, lvl) => (
        <div key={lvl} style={{ display: 'flex', alignItems: 'center' }}>
          {/* The spine connector between levels (a horizontal flow arrow). */}
          {lvl > 0 && (
            <span
              data-roadmap-edge={lvl}
              aria-hidden
              style={{ display: 'inline-flex', alignItems: 'center', color: '#30363d', fontSize: 14, padding: '0 8px', alignSelf: 'center' }}
            >
              →
            </span>
          )}
          {/* Same-level initiatives stack as bubbles off the spine. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bucket.map((c) => (
              <CycleCard
                key={c.cycleId}
                cycle={c}
                level={levelById.get(c.initiativeId) ?? 0}
                active={c.cycleId === activeId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One initiative bubble on the roadmap spine. */
function CycleCard({
  cycle: c,
  level,
  active,
  onSelect,
}: {
  cycle: Cycle;
  level: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = CYCLE_STATUS_META[c.status];
  const reviewable = c.status === 'ready-for-review';
  return (
    <span data-roadmap-bubble data-dep-level={level} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <button
        data-cycle-id={c.cycleId}
        data-cycle-initiative-id={c.initiativeId}
        data-cycle-status={c.status}
        data-cycle-project={c.project ?? ''}
        data-cycle-active={active ? 'true' : 'false'}
        data-cycle-dep-level={level}
        data-cycle-depends-on={(c.dependsOnInitiatives ?? []).join(',')}
        onClick={() => onSelect(c.cycleId)}
        title={c.initiativeId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px 6px 10px',
          fontSize: 12,
          border: '1px solid ' + (active ? '#58a6ff' : '#30363d'),
          borderLeftWidth: 3,
          borderLeftColor: meta.color,
          background: active ? '#0d1f3a' : '#161b22',
          color: '#e6edf3',
          borderRadius: reviewable ? '6px 0 0 6px' : 6,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{initiativeSlug(c.initiativeId)}</span>
        <span style={{ fontSize: 10, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{meta.label}</span>
      </button>
      {reviewable && (
        <Link
          href={`/review/${encodeURIComponent(c.cycleId)}`}
          data-action="open-review"
          title="Review this PR"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 10px',
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: '#9e6a03',
            border: '1px solid #30363d',
            borderLeft: 'none',
            borderRadius: '0 6px 6px 0',
            textDecoration: 'none',
          }}
        >
          Review →
        </Link>
      )}
    </span>
  );
}
