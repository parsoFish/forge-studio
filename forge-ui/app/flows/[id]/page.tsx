'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { subscribe, type EventLogEntry, startRun, resumeRun } from '@/lib/bridge-client';
import { fetchRuns, fetchRun, fetchStudioFlows, fetchFlow, fetchStudioAgents, fetchStarterFlow, saveFlow } from '@/lib/studio-client';
import type { Run, Flow, Agent } from '@/lib/studio-client';
import { resolveFlowViewState } from '@/lib/flow-view-state';
import { StudioNav } from '@/components/StudioNav';
import { RunRail } from '@/components/studio/RunRail';
import { MonitorSummary } from '@/components/studio/MonitorSummary';
import { FlowTopology } from '@/components/studio/FlowTopology';
import { PhaseDrawer } from '@/components/studio/PhaseDrawer';
import { EventTail } from '@/components/studio/EventTail';
import { AgentPalette } from '@/components/studio/flow-builder/AgentPalette';
import { FlowBuilderCanvas, rfNodesToFlow, rfEdgesToFlow, type CanvasHandle } from '@/components/studio/flow-builder/FlowBuilderCanvas';
import { FlowHeader, type FlowHeaderState } from '@/components/studio/flow-builder/FlowHeader';
import { FlowKickoff } from '@/components/studio/FlowKickoff';

// ---------------------------------------------------------------------------
// Flow monitor page — /flows/[id]
//
// Layout (left-to-right):
//   RunRail | MonitorMain (summary strip + topology + event tail) | PhaseDrawer (overlay)
//
// Data flow:
//   - fetchStudioFlows() → find flow by id
//   - fetchRuns({flow: id}) → list of runs; pick default active run
//   - subscribe():
//       {type:'event', cycleId} for active run's cycleId → append to tail + refresh run
//       {type:'cycle-list-changed'} → re-fetch runs
// ---------------------------------------------------------------------------

function pickDefaultRun(runs: Run[]): Run | null {
  // Priority: gated → active → first complete → first planned
  const gated    = runs.find((r) => r.status === 'gated');
  const active   = runs.find((r) => r.status === 'active');
  const complete = runs.find((r) => r.status === 'complete');
  const planned  = runs.find((r) => r.status === 'planned');
  return gated ?? active ?? complete ?? planned ?? runs[0] ?? null;
}

type PageTab = 'monitor' | 'build';

export default function FlowMonitorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  // A brand-new flow: start in BUILD, seed the canvas from the basic starter,
  // and on save derive a slug from the name + redirect to the real flow.
  const isNew = id === 'new';

  // Tab state — monitor is the default; a new flow opens straight into BUILD.
  const [tab, setTab] = useState<PageTab>(isNew ? 'build' : 'monitor');

  const [flow,        setFlow]        = useState<Flow | null>(null);
  const [runs,        setRuns]        = useState<Run[]>([]);
  const [activeRun,   setActiveRun]   = useState<Run | null>(null);
  const [ready,       setReady]       = useState(false);
  const [tailEvents,  setTailEvents]  = useState<EventLogEntry[]>([]);
  // Drawer selection is a single state object so the toggle updater reads its
  // own fresh `prev` (no cross-state read of a closed-over value).
  const [drawer, setDrawer] = useState<{
    node: string | null;
    hexKind: 'phase' | 'wi';
    wiId?: string;
  }>({ node: null, hexKind: 'phase' });

  // BUILD tab state
  const [buildFlow,   setBuildFlow]   = useState<Flow | null>(null);
  const [allFlows,    setAllFlows]    = useState<Flow[]>([]);
  // M1: which flow ids currently have runs (for the monitor flow filter).
  const [flowsWithRuns, setFlowsWithRuns] = useState<Set<string>>(new Set());
  const [agents,      setAgents]      = useState<Agent[]>([]);
  const [buildVersion, setBuildVersion] = useState<number | undefined>(undefined);
  const [headerState, setHeaderState] = useState<FlowHeaderState>({
    name: '',
    goal: '',
    project: '',
    kb: '',
    triggers: [],
  });
  const canvasRef = useRef<CanvasHandle | null>(null);

  // ---- data loading ----

  const loadData = useCallback(
    async (signal: { cancelled: boolean }, preserveRunId?: string) => {
      try {
        const [flows, everyRun] = await Promise.all([
          fetchStudioFlows(),
          fetchRuns(), // unfiltered — derive this flow's runs + the set of flows that have runs (M1)
        ]);
        if (signal.cancelled) return;

        const found = flows.find((f) => f.id === id) ?? null;
        setFlow(found);
        setAllFlows(flows);
        // A threaded spine run surfaces under every flow in its lineage
        // (architect→develop→reflect), so each flow's RUNS rail + monitor shows it.
        setFlowsWithRuns(new Set(everyRun.flatMap((r) => (r.flowLineage?.length ? r.flowLineage : [r.flowId]))));
        const allRuns = everyRun.filter((r) => r.flowId === id || (r.flowLineage ?? []).includes(id));
        setRuns(allRuns);

        // Selection precedence: explicit preserve id → the user's sticky pick
        // (sessionStorage, survives reloads) → gated-first default. Without
        // the sticky layer, pickDefaultRun's gated-first priority pulls focus
        // to the top "needs you" run on every page load.
        let sticky: string | null = null;
        try {
          sticky = sessionStorage.getItem(`forge-run-sel:${id}`);
        } catch {
          /* non-fatal */
        }
        const next =
          (preserveRunId ? allRuns.find((r) => r.id === preserveRunId) : undefined) ??
          (sticky ? allRuns.find((r) => r.id === sticky) : undefined) ??
          pickDefaultRun(allRuns);
        setActiveRun(next);
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    },
    [id],
  );

  const refreshActiveRun = useCallback(
    async (signal: { cancelled: boolean }, runId: string) => {
      const run = await fetchRun(runId);
      if (signal.cancelled) return;
      if (run) {
        setActiveRun(run);
        setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      }
    },
    [],
  );

  const refreshRuns = useCallback(
    async (signal: { cancelled: boolean }, currentRunId: string | null) => {
      const allRuns = await fetchRuns(id);
      if (signal.cancelled) return;
      setRuns(allRuns);
      if (currentRunId) {
        const updated = allRuns.find((r) => r.id === currentRunId);
        if (updated) setActiveRun(updated);
      }
    },
    [id],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    // Clear the previous flow's transient view state (event tail, open drawer)
    // up front — `view` (lib/flow-view-state.ts) already keeps the render path
    // from showing a stale flow/run/activeRun during the reload, but these two
    // are accumulated independently of loadData() and must reset the same way
    // a manual run switch already resets them (see handleSelectRun below).
    setTailEvents([]);
    setDrawer({ node: null, hexKind: 'phase' });
    void loadData(signal);

    const sub = subscribe({
      onState: () => { /* page does not show connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;

        if (msg.type === 'event') {
          // Only attach events for the currently active run
          setActiveRun((currentRun) => {
            if (currentRun && msg.cycleId === currentRun.id) {
              setTailEvents((prev) => {
                const next = [...prev, msg.event];
                return next.slice(-100);
              });
              // Also refresh the run to pick up phase state changes
              void refreshActiveRun(signal, currentRun.id);
            }
            return currentRun;
          });
        }

        if (msg.type === 'cycle-list-changed') {
          setActiveRun((currentRun) => {
            void refreshRuns(signal, currentRun?.id ?? null);
            return currentRun;
          });
        }
      },
    });

    return () => {
      signal.cancelled = true;
      sub.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- BUILD tab data loading ----

  const loadBuildData = useCallback(async (signal: { cancelled: boolean }) => {
    const [flowDef, flows, ags] = await Promise.all([
      // A new flow seeds its canvas from the basic starter (plan → dev → review).
      isNew ? fetchStarterFlow() : fetchFlow(id),
      fetchStudioFlows(),
      fetchStudioAgents(),
    ]);
    if (signal.cancelled) return;
    setBuildFlow(flowDef);
    setAllFlows(flows);
    setAgents(ags);
    if (flowDef) {
      setHeaderState({
        // The operator names their own flow; the starter only seeds the canvas
        // + goal so a basic flow is creatable with near-zero input.
        name: isNew ? '' : flowDef.name,
        goal: flowDef.goal ?? '',
        project: flowDef.project ?? '',
        kb: flowDef.kb ?? '',
        triggers: isNew ? [] : (flowDef.triggers ?? []),
      });
    }
  }, [id, isNew]);

  useEffect(() => {
    if (tab === 'build') {
      const signal = { cancelled: false };
      void loadBuildData(signal);
      return () => { signal.cancelled = true; };
    }
  }, [tab, loadBuildData]);

  // ---- BUILD tab save ----

  const handleBuildSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return { ok: false as const, error: 'canvas not ready' };
    // A new flow has no id yet — derive a slug from the (required) name.
    const saveId = isNew
      ? headerState.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      : id;
    if (isNew && !saveId) {
      return { ok: false as const, error: 'Name your flow before saving.' };
    }
    const rfNodes = canvas.getNodes();
    const rfEdges = canvas.getEdges();
    const nodes = rfNodesToFlow(rfNodes);
    const edges = rfEdgesToFlow(rfEdges);
    const result = await saveFlow(saveId, {
      name: headerState.name,
      goal: headerState.goal,
      project: headerState.project || undefined,
      kb: headerState.kb || undefined,
      triggers: headerState.triggers,
      nodes,
      edges,
    });
    if (result.ok && result.version !== undefined) {
      setBuildVersion(result.version);
    }
    // New flow saved → navigate to its real route so subsequent edits target it.
    if (result.ok && isNew) {
      window.location.href = `/flows/${encodeURIComponent(saveId)}`;
    }
    return result;
  }, [id, isNew, headerState]);

  // ---- start / resume ----

  const handleStartRun = useCallback(async () => {
    const signal = { cancelled: false };
    const r = await startRun(flow?.project ?? id);
    if (r.ok) {
      // Pin selection to the run just created (or whatever was selected) —
      // without preserveRunId, loadData re-derives via pickDefaultRun and the
      // selection snaps to the highest-priority run in the rail.
      void loadData(signal, r.runId ?? activeRun?.id);
    }
  }, [flow, id, loadData, activeRun]);

  const handleResumeRun = useCallback(async () => {
    if (!activeRun) return;
    const signal = { cancelled: false };
    const r = await resumeRun(activeRun.id);
    if (r.ok) {
      void loadData(signal, activeRun.id);
    }
  }, [activeRun, loadData]);

  // ---- run selection ----

  const handleSelectRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.id === runId) ?? null;
      setActiveRun(run);
      // Sticky selection: the user's explicit pick must survive reloads and
      // data refreshes — without this, pickDefaultRun's gated-first priority
      // yanks focus back to the top "needs you" run on every re-derivation.
      try {
        if (run) sessionStorage.setItem(`forge-run-sel:${id}`, run.id);
      } catch {
        /* sessionStorage unavailable (SSR/private mode) — non-fatal */
      }
      setTailEvents([]); // clear tail on run switch
      setDrawer({ node: null, hexKind: 'phase' });
    },
    [runs, id],
  );

  // ---- drawer ----

  const handleNodeClick = useCallback(
    (nodeId: string, hexKind: 'phase' | 'wi' = 'phase', wiId?: string) => {
      // Toggle key combines nodeId + wiId because every fanOut WI hex shares the
      // same nodeId (the dev node) — clicking a different WI must reopen, not close.
      // Single functional updater: `prev` is always fresh, so the toggle key
      // comparison never reads a stale closed-over wiId.
      const key = wiId ? `${nodeId}::${wiId}` : nodeId;
      setDrawer((prev) => {
        const prevKey =
          prev.node && prev.wiId ? `${prev.node}::${prev.wiId}` : prev.node;
        if (prevKey === key) {
          return { node: null, hexKind: 'phase' };
        }
        return {
          node: nodeId,
          hexKind,
          wiId: hexKind === 'wi' ? wiId : undefined,
        };
      });
    },
    [],
  );

  const handleDrawerClose = useCallback(() => {
    setDrawer({ node: null, hexKind: 'phase' });
  }, []);

  // ---- flow-switch staleness guard ----
  // `id` (the route param) changes the instant the operator swaps flows, but
  // `flow`/`runs`/`activeRun`/`ready` only catch up once the async loadData()
  // for the new id resolves. `view` is the atomically-reset render state for
  // that window — see lib/flow-view-state.ts. Every render-affecting read
  // below (JSX + data-* mirrors) uses `view.*`, never the raw state, so a
  // flow switch never paints the previous flow's run model.
  const view = resolveFlowViewState(id, { flow, runs, activeRun, ready });

  // ---- empty states ----

  const flowNotFound = view.ready && !view.flow;

  return (
    <main
      data-page="flow-monitor"
      data-flow-id={id}
      data-active-run={view.activeRun?.id ?? ''}
      data-page-ready={view.ready ? 'true' : 'false'}
      data-run-count={view.runs.length}
      data-can-start={view.flow ? 'true' : 'false'}
      data-active-tab={tab}
      style={{ height: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <StudioNav />

      {/* BUILD tab: FlowHeader replaces the static flow strip */}
      {tab === 'build' ? (
        <>
          <FlowHeader
            flowId={id}
            isNew={isNew}
            state={headerState}
            onChange={setHeaderState}
            version={buildVersion}
            onSave={handleBuildSave}
            flows={allFlows}
            onFlowSelect={(newId) => {
              if (newId !== id) {
                // Navigate to the selected flow
                window.location.href = `/flows/${encodeURIComponent(newId)}`;
              }
            }}
          />
          {/* Tabs bar — BUILD active */}
          <div className="tabs" style={{ background: 'var(--panel)', padding: '0 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button className="tab" onClick={() => setTab('monitor')}>MONITOR</button>
            <button className="tab active">BUILD</button>
          </div>
          {/* BUILD canvas */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            <AgentPalette />
            <FlowBuilderCanvas
              initialNodes={buildFlow?.nodes ?? []}
              initialEdges={buildFlow?.edges ?? []}
              agents={agents}
              onRef={(handle) => { canvasRef.current = handle; }}
            />
          </div>
        </>
      ) : (
        <>
          {/* MONITOR tab: original flow header strip */}
          <div
            style={{
              background: 'var(--panel)',
              borderBottom: '1px solid var(--line)',
              padding: '14px 24px 0',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
              {/* The monitor flow selector lists EVERY flow that actually exists
                  (same source as the BUILD tab), annotating which have runs — not
                  just flows-with-runs, which left the selector stale/absent. The
                  current flow is always present (it's in allFlows). */}
              {(() => {
                const candidates = allFlows.some((f) => f.id === id)
                  ? allFlows
                  : [...allFlows, ...(view.flow ? [view.flow] : [])];
                if (candidates.length <= 1) {
                  return (
                    <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                      {view.flow?.name ?? id}
                    </h2>
                  );
                }
                return (
                  <select
                    data-field="monitor-flow-selector"
                    value={id}
                    onChange={(e) => { if (e.target.value !== id) window.location.href = `/flows/${encodeURIComponent(e.target.value)}`; }}
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', outline: 'none' }}
                  >
                    {candidates.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}{flowsWithRuns.has(f.id) ? '' : ' (no runs)'}</option>
                    ))}
                  </select>
                );
              })()}
              {view.flow?.goal && (
                <span style={{ fontSize: 13, color: 'var(--dim)', flex: 1 }}>
                  {view.flow.goal}
                </span>
              )}
            </div>

            {/* Tabs bar — MONITOR active */}
            <div className="tabs">
              <button className="tab active">MONITOR</button>
              <button
                className="tab"
                onClick={() => setTab('build')}
                title="Switch to Build tab"
              >
                BUILD
              </button>
            </div>
          </div>

          {/* Main body — MONITOR */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {flowNotFound ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--faint)',
                  fontSize: 14,
                }}
              >
                Flow &ldquo;{id}&rdquo; not found.
              </div>
            ) : (
          <>
            {/* Left: Run rail */}
            <RunRail
              runs={view.runs}
              activeRunId={view.activeRun?.id ?? null}
              onSelect={handleSelectRun}
            />

            {/* Center: Monitor main */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Hint caption */}
              <p
                style={{
                  margin: 0,
                  padding: '7px 20px 6px',
                  fontSize: 12,
                  color: 'var(--faint)',
                  fontStyle: 'italic',
                  background: 'var(--panel)',
                  borderBottom: '1px solid var(--line)',
                  flexShrink: 0,
                }}
              >
                <em>
                  <span style={{ color: 'var(--ember)' }}>›</span> click any
                  phase hex for logs, liveness + artifacts
                </em>
              </p>

              {/* Gated banner */}
              {view.runs.some((r) => r.status === 'gated') && (
                <GatedBanner runs={view.runs} onSelect={handleSelectRun} />
              )}

              {/* M6: reflection ready — surface the feedback CTA on the monitor so
                  the operator isn't left hunting for the reflection screen. */}
              {view.activeRun?.artifactsReady?.reflection && (
                <div
                  data-banner="reflection-ready"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px',
                    background: 'rgba(183,140,255,0.08)', borderBottom: '1px solid rgba(183,140,255,0.3)',
                    fontSize: 12, color: 'var(--violet)', flexShrink: 0,
                  }}
                >
                  <strong>Reflection ready</strong> — review the retro &amp; answer the agent&apos;s questions.
                  <a
                    data-action="review-reflection"
                    href={`/artifact?run=${encodeURIComponent(view.activeRun.id)}&type=reflection&mode=view`}
                    style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 12px', background: 'var(--violet)', color: '#fff', borderRadius: 4, textDecoration: 'none' }}
                  >
                    Review reflection →
                  </a>
                </div>
              )}

              {/* Stage C kickoff surface — shown when the flow is known but no
                  runs exist yet. Renders the launch UI matching flow.kickoff.kind
                  (idea / initiative-select / trigger-only), else a generic Start Run. */}
              {view.ready && view.flow && view.runs.length === 0 && (
                <FlowKickoff
                  flow={view.flow}
                  onStartGeneric={() => void handleStartRun()}
                />
              )}

              {/* Resume CTA — shown when the active run has failed */}
              {view.activeRun?.status === 'failed' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 20px',
                    background: 'rgba(255,80,80,0.06)',
                    borderBottom: '1px solid rgba(255,80,80,0.2)',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--faint)' }}>Run failed.</span>
                  <button
                    data-action="resume-run"
                    data-run-id={view.activeRun.id}
                    onClick={() => void handleResumeRun()}
                    style={{
                      fontSize: 12,
                      padding: '3px 12px',
                      background: 'var(--ember)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Resume
                  </button>
                </div>
              )}

              {/* Summary strip */}
              <MonitorSummary run={view.activeRun} flow={view.flow ?? EMPTY_FLOW} />

              {/* Topology canvas — each flow's monitor renders its OWN nodes
                  (Model B). A threaded spine run surfaces under all three flows via
                  its derived flowLineage, so /flows/forge-architect shows architect+pm,
                  /flows/forge-develop shows dev[+WI fan-out]+unifier+review, etc. */}
              {view.flow ? (
                <FlowTopology
                  flow={view.flow}
                  run={view.activeRun}
                  onNodeClick={handleNodeClick}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)' }}>
                  {view.ready ? 'No runs yet for this flow.' : 'Loading…'}
                </div>
              )}

              {/* Event tail */}
              <EventTail
                events={tailEvents}
                activeRunId={view.activeRun?.id ?? null}
              />
            </div>
          </>
        )}
      </div>

          {/* Phase drawer — overlays from right */}
          {view.flow && (
            <PhaseDrawer
              nodeId={drawer.node}
              run={view.activeRun}
              flow={view.flow}
              onClose={handleDrawerClose}
              hexKind={drawer.hexKind}
              wiId={drawer.wiId}
            />
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// GatedBanner — shown when any run needs attention
// ---------------------------------------------------------------------------

function GatedBanner({
  runs,
  onSelect,
}: {
  runs: Run[];
  onSelect: (id: string) => void;
}) {
  const gated = runs.filter((r) => r.status === 'gated');
  if (gated.length === 0) return null;
  return (
    <div
      style={{
        background: 'rgba(255,158,74,0.08)',
        borderBottom: '1px solid rgba(255,158,74,0.3)',
        padding: '7px 18px',
        fontSize: 12,
        color: 'var(--ember)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <strong>
        {gated.length} run{gated.length !== 1 ? 's' : ''}{' '}
        {gated.length === 1 ? 'needs' : 'need'} you
      </strong>{' '}
      —{' '}
      {gated.map((r, i) => (
        <span key={r.id}>
          {i > 0 && ' · '}
          <button
            onClick={() => onSelect(r.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ember)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 12,
              padding: 0,
            }}
          >
            {r.id} ({r.gateNote ?? 'needs you'})
          </button>
        </span>
      ))}
    </div>
  );
}

// Fallback empty flow shape to avoid null-checks everywhere
const EMPTY_FLOW: Flow = {
  id: '',
  name: '',
  goal: '',
  nodes: [],
  edges: [],
  triggers: [],
};
