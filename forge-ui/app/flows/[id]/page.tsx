'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { subscribe, type EventLogEntry, type ConnectionState, resumeRun } from '@/lib/bridge-client';
import { fetchRuns, fetchRun, fetchStudioFlows, fetchFlow, fetchStudioAgents, fetchStarterFlow, saveFlow, deleteFlow } from '@/lib/studio-client';
import type { Run, Flow, Agent } from '@/lib/studio-client';
import { resolveFlowViewState } from '@/lib/flow-view-state';
import { runsForFlow, splitRunsForFlow } from '@/lib/home-view';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { PageLoadError } from '@/components/PageLoadError';
import { FetchErrorState, fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecoveryWhenFailed } from '@/lib/use-bridge-status';
import { RunRail } from '@/components/studio/RunRail';
import { MonitorSummary } from '@/components/studio/MonitorSummary';
import { FlowTopology } from '@/components/studio/FlowTopology';
import { PhaseDrawer } from '@/components/studio/PhaseDrawer';
import { EventTail } from '@/components/studio/EventTail';
import { AgentPalette } from '@/components/studio/flow-builder/AgentPalette';
import { FlowBuilderCanvas, rfNodesToFlow, rfEdgesToFlow, type CanvasHandle } from '@/components/studio/flow-builder/FlowBuilderCanvas';
import { builderSnapshot, savedNodesCarryPositions } from '@/lib/flow-builder-dirty';
import { FlowHeader, type FlowHeaderState } from '@/components/studio/flow-builder/FlowHeader';
import { FlowKickoff, type KickoffCandidate } from '@/components/studio/FlowKickoff';
import { deriveKickoffCandidates, canStartFlow } from '@/lib/kickoff-candidates';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { SchedulerCard } from '@/components/SchedulerCard';
import { deriveFlowLedgerRows } from '@/lib/flow-ledger';
import { useDocumentTitle } from '@/lib/document-title';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

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

/** W7-B4 (flows-27): a stable, key-sorted serialisation of the builder's
 *  editable state — header fields + canvas nodes/edges — used to detect
 *  unsaved edits before they are silently discarded on a tab switch. */
function pickDefaultRun(runs: Run[]): Run | null {
  // Priority: gated → active → first complete → first planned
  const gated    = runs.find((r) => r.status === 'gated');
  const active   = runs.find((r) => r.status === 'active');
  const complete = runs.find((r) => r.status === 'complete');
  const planned  = runs.find((r) => r.status === 'planned');
  return gated ?? active ?? complete ?? planned ?? runs[0] ?? null;
}

// W6-SW-3 (sweep C3#6): ConnectionState → the shared status-dot vocabulary
// (globals.css only styles pending/active/complete/retrying/failed). Both
// maps are exhaustive `Record<ConnectionState, ...>` — 'daemon-stalled' is
// carried for completeness even though this page's own `subscribe()` call
// never emits it today (bridge-client.ts's WS onState setState() calls only
// ever pass 'connecting'|'open'|'reconnecting'|'no-bridge'; 'daemon-stalled'
// is declared on the shared ConnectionState type for "Feature #8" — a
// separate scheduler-heartbeat health signal, not yet wired to this
// component's subscribe() — see bridge-client.ts:62-65's own comment).
const CONNECTION_DOT_STATUS: Record<ConnectionState, 'pending' | 'active' | 'complete' | 'retrying' | 'failed'> = {
  connecting: 'pending',
  open: 'complete',
  reconnecting: 'retrying',
  'no-bridge': 'failed',
  'daemon-stalled': 'failed',
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  'no-bridge': 'No bridge — events may be stale',
  'daemon-stalled': 'Daemon stalled — events may be stale',
};

type PageTab = 'monitor' | 'build';

export default function FlowMonitorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  // A brand-new flow: start in BUILD, seed the canvas from the basic starter,
  // and on save derive a slug from the name + redirect to the real flow.
  const isNew = id === 'new';

  // Tab state — monitor is the default; a new flow opens straight into BUILD.
  const [tab, setTab] = useState<PageTab>(isNew ? 'build' : 'monitor');

  const [flow,        setFlow]        = useState<Flow | null>(null);
  const [runs,        setRuns]        = useState<Run[]>([]);
  // W7-A3 (flows-02): every run across every flow — the generic kickoff's
  // initiative picker is derived from it (one run per queued manifest).
  const [allQueueRuns, setAllQueueRuns] = useState<Run[]>([]);
  // W7-A3 (flows-03): the kickoff surface is persistent behind a header
  // toggle; open by default only while the flow has no runs (null = not yet
  // decided — resolved once the first load lands).
  const [kickoffOpen, setKickoffOpen] = useState<boolean | null>(null);
  const [activeRun,   setActiveRun]   = useState<Run | null>(null);
  const [ready,       setReady]       = useState(false);
  // W7-FIX-A1 (A1-02): a FAILED flows/runs read is an ERROR state (the shared
  // PageLoadError with Retry) — never NotFound "No flow <id>" for a flow that
  // may well exist. `loadKey` re-runs the load on Retry + bridge recovery
  // (the WS subscription below is re-opened with it — same effect).
  const [loadError,   setLoadError]   = useState<{ error: string; status?: number } | null>(null);
  // The BUILD tab's definition/palette read has its OWN slot: the monitor
  // read's success must not clear a failure it did not supersede (A1-03
  // class — else /flows/new fell through to a blank canvas + empty palette).
  const [buildLoadError, setBuildLoadError] = useState<{ error: string; status?: number } | null>(null);
  const pageLoadError = loadError ?? buildLoadError;
  // A FAILED live refresh (WS-triggered `fetchRuns`/`fetchRun` — fail-closed
  // reads THROW) is a monitor-scoped error: last-known runs stay, the failure
  // is shown beside the connection dot with Retry — never an unhandled
  // rejection, never unseating the loaded page (review round 2).
  const [refreshError, setRefreshError] = useState<{ error: string; status?: number } | null>(null);
  const [loadKey,     setLoadKey]     = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  // Recovery refills ONLY a failed load — never re-loads over the operator's
  // unsaved builder edits / open drawer / live tail (W7-FIX-A1 review).
  useBridgeRecoveryWhenFailed(pageLoadError !== null, reload);
  const [tailEvents,  setTailEvents]  = useState<EventLogEntry[]>([]);
  // W6-SW-3 (sweep C3#6): subscribe()'s ConnectionState used to be discarded
  // — on a dropped socket the tail kept showing stale events with zero
  // indication the connection itself failed (indistinguishable from a
  // genuinely stalled run). Surfaced as a status-dot near the summary strip.
  const [connState,   setConnState]   = useState<ConnectionState>('connecting');
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
  // W7-B4 (flows-27): the last SAVED builder snapshot — the dirty test's
  // baseline. Set on load and on every successful save.
  const savedSnapshotRef = useRef<string | null>(null);
  // W7-B4 review finding 3: positions join the dirty comparison only when the
  // SAVED file actually carried them (see lib/flow-builder-dirty.ts). Seed
  // flows ship without any, so the autolayout x/y the canvas always emits must
  // not read as an operator edit.
  const savedHasPositionsRef = useRef<boolean>(false);
  // W7-B4 (flows-11): a failed delete's error, shown in the BUILD tab.
  const [flowActionError, setFlowActionError] = useState<string | null>(null);

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
        setAllQueueRuns(everyRun);
        // A threaded spine run surfaces under every flow in its lineage
        // (architect→develop→reflect), so each flow's RUNS rail + monitor shows it.
        setFlowsWithRuns(new Set(everyRun.flatMap((r) => (r.flowLineage?.length ? r.flowLineage : [r.flowId]))));
        // forge-n5r: the ONE flow<->run matcher (lib/home-view.ts), shared
        // with FlowCard and Home rather than a third independent copy of
        // this predicate.
        const allRuns = runsForFlow(id, everyRun);
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
        setKickoffOpen((prev) => (prev === null ? allRuns.length === 0 : prev));
        setLoadError(null);
      } catch (err) {
        // W7-FIX-A1 (A1-02): the flows/runs read threw — an ERROR state;
        // `flow` stays whatever it was, so `flowNotFound` (gated on
        // `!loadError` below) cannot fire off this failure.
        if (signal.cancelled) return;
        setLoadError(fetchErrorPropsFrom(err));
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    },
    [id],
  );

  const refreshActiveRun = useCallback(
    async (signal: { cancelled: boolean }, runId: string) => {
      try {
        const run = await fetchRun(runId);
        if (signal.cancelled) return;
        if (run) {
          setActiveRun(run);
          setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
        }
        setRefreshError(null);
      } catch (err) {
        if (signal.cancelled) return;
        setRefreshError(fetchErrorPropsFrom(err));
      }
    },
    [],
  );

  const refreshRuns = useCallback(
    async (signal: { cancelled: boolean }, currentRunId: string | null) => {
      try {
        const allRuns = await fetchRuns(id);
        if (signal.cancelled) return;
        setRuns(allRuns);
        if (currentRunId) {
          const updated = allRuns.find((r) => r.id === currentRunId);
          if (updated) setActiveRun(updated);
        }
        setRefreshError(null);
      } catch (err) {
        if (signal.cancelled) return;
        setRefreshError(fetchErrorPropsFrom(err));
      }
    },
    [id],
  );

  /** Retry for a failed live refresh: re-run the runs refresh alone (never a
   *  full reload — that is the page-load Retry's job). */
  const retryRefresh = useCallback(() => {
    setActiveRun((currentRun) => {
      void refreshRuns({ cancelled: false }, currentRun?.id ?? null);
      return currentRun;
    });
  }, [refreshRuns]);

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
      onState: (s) => { if (!signal.cancelled) setConnState(s); },
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
    // loadKey: Retry / bridge recovery re-run the load (W7-FIX-A1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadKey]);

  // ---- BUILD tab data loading ----

  const loadBuildData = useCallback(async (signal: { cancelled: boolean }) => {
    try {
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
      setBuildLoadError(null);
      if (flowDef) {
        const header = {
          // The operator names their own flow; the starter only seeds the canvas
          // + goal so a basic flow is creatable with near-zero input.
          name: isNew ? '' : flowDef.name,
          goal: flowDef.goal ?? '',
          project: flowDef.project ?? '',
          kb: flowDef.kb ?? '',
          triggers: isNew ? [] : (flowDef.triggers ?? []),
        };
        setHeaderState(header);
        // W7-B4 (flows-27): the freshly-loaded state is the clean baseline.
        savedHasPositionsRef.current = savedNodesCarryPositions(flowDef.nodes ?? []);
        savedSnapshotRef.current = builderSnapshot(
          header, flowDef.nodes ?? [], flowDef.edges ?? [], savedHasPositionsRef.current,
        );
      }
    } catch (err) {
      // W7-FIX-A1 (A1-02): the builder's definition/palette read threw — the
      // same page-level ERROR state (a blank canvas + empty palette is not a
      // flow), never an unhandled rejection. Its OWN slot (see above).
      if (signal.cancelled) return;
      setBuildLoadError(fetchErrorPropsFrom(err));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (tab === 'build') {
      const signal = { cancelled: false };
      void loadBuildData(signal);
      return () => { signal.cancelled = true; };
    }
    // loadKey: Retry / bridge recovery re-run the builder read too (W7-FIX-A1)
  }, [tab, loadBuildData, loadKey]);

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
      // W7-B4 (flows-13): the new-flow path declares itself a CREATE so a
      // name colliding with an existing flow 409s instead of overwriting it.
      ...(isNew ? { create: true } : {}),
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
    if (result.ok) {
      // W7-B4 (flows-27): a successful save resets the dirty baseline.
      savedHasPositionsRef.current = savedNodesCarryPositions(nodes);
      savedSnapshotRef.current = builderSnapshot(headerState, nodes, edges, savedHasPositionsRef.current);
    }
    // New flow saved → navigate to its real route so subsequent edits target it.
    if (result.ok && isNew) {
      router.push(`/flows/${encodeURIComponent(saveId)}`);
    }
    return result;
  }, [id, isNew, headerState, router]);

  // W7-B4 (flows-27): unsaved canvas/header edits must not be silently
  // discarded — the tab switch away from BUILD asks first.
  const builderHasUnsavedEdits = useCallback((): boolean => {
    const canvas = canvasRef.current;
    if (!canvas || savedSnapshotRef.current === null) return false;
    const current = builderSnapshot(
      headerState, rfNodesToFlow(canvas.getNodes()), rfEdgesToFlow(canvas.getEdges()), savedHasPositionsRef.current,
    );
    return current !== savedSnapshotRef.current;
  }, [headerState]);

  const leaveBuildTab = useCallback(() => {
    if (builderHasUnsavedEdits() && !window.confirm('You have unsaved builder edits — discard them?')) {
      return;
    }
    setTab('monitor');
  }, [builderHasUnsavedEdits]);

  // W7-B4 (flows-11): delete an authored flow from the BUILD header.
  const handleDeleteFlow = useCallback(async () => {
    setFlowActionError(null);
    const r = await deleteFlow(id);
    if (!r.ok) {
      setFlowActionError(r.error ?? 'delete failed');
      return;
    }
    router.push('/flows');
  }, [id, router]);

  // ---- start / resume ----

  // W7-A3 (flows-02): the generic kickoff POSTs a REAL initiative to
  // /api/flows/:id/run itself (FlowKickoff); on success re-read the rail,
  // pinning selection to the run just enqueued (or whatever was selected) —
  // without preserveRunId, loadData re-derives via pickDefaultRun.
  const handleEnqueued = useCallback((initiativeId: string) => {
    const signal = { cancelled: false };
    // A freshly enqueued (planned) run's id IS its initiative id (run-model).
    void loadData(signal, initiativeId);
  }, [loadData]);

  // Candidates for the generic kickoff — W7-FIX-A3 (A3-01): ONLY queued
  // (planned) initiatives; a finished or failed one is never offered (the
  // picker used to list merged initiatives, and Start Run silently yanked
  // them out of _queue/done — see lib/kickoff-candidates.ts).
  const kickoffCandidates: KickoffCandidate[] = deriveKickoffCandidates(allQueueRuns);

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
  // W7-C3 (crosscut-06): per-route tab title.
  useDocumentTitle(view.flow?.name ?? id, 'Flows');

  // ---- empty states ----

  const flowNotFound = view.ready && !view.flow;

  // W7-A4 (flows-16 / crosscut-27 / flows-04): an unknown flow id renders the
  // ONE shared NotFound for the WHOLE page — never the monitor chrome with a
  // selector showing a DIFFERENT flow's name. A flow id that runs still name
  // (`runs` is `runsForFlow(id, everyRun)`) but that has no definition —
  // `release-refine`, or the pre-flow_id `unknown` sentinel — is a RETIRED
  // flow: its runs remain openable from any flow HISTORY ledger
  // (`/flows/<id>/run/<runId>` renders the run's own recorded phases).
  // W7-FIX-A1 (A1-02): the read FAILED — the flow may well exist. The shared
  // page-level error with Retry, never NotFound.
  if (view.ready && pageLoadError) {
    return (
      <PageLoadError
        page="flow-monitor"
        rootAttrs={{ 'data-flow-id': id }}
        what={buildLoadError && !loadError ? `the builder for flow "${id}"` : `flow "${id}"`}
        error={pageLoadError.error}
        status={pageLoadError.status}
        onRetry={reload}
        backHref="/flows"
        backLabel="Flows"
      />
    );
  }
  if (flowNotFound && !isNew && !pageLoadError) {
    const retired = view.runs.length > 0;
    return (
      <NotFound
        kind="flow"
        id={id}
        backHref="/flows"
        backLabel="Flows"
        variant={retired ? 'retired' : 'unknown'}
        detail={retired
          ? `${view.runs.length} run${view.runs.length === 1 ? '' : 's'} still reference this flow id — open one from a flow HISTORY ledger; its recorded phases render there.`
          : undefined}
      />
    );
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="flow-monitor"
      data-flow-id={id}
      data-active-run={view.activeRun?.id ?? ''}
      data-page-ready={view.ready ? 'true' : 'false'}
      data-run-count={view.runs.length}
      data-can-start={canStartFlow(view.flow) ? 'true' : 'false'}
      data-active-tab={tab}
      data-kickoff-open={kickoffOpen ? 'true' : 'false'}
      style={{ height: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <StudioNav />
      {/* W7-C3 (crosscut-18): one h1 per page. The monitor's visible identity
          is the flow SELECTOR and the builder's is the name input, so the
          heading is visually hidden but real for AT/outline tooling. */}
      <h1 className="sr-only">{view.flow?.name ?? id} — flow {tab === 'build' ? 'builder' : 'monitor'}</h1>
      {/* W7-C3 (crosscut-19): the shared trail on the flow monitor/builder. */}
      <div style={{ padding: '10px 20px 0' }}>
        <Breadcrumbs items={[{ label: 'Flows', href: '/flows' }, { label: view.flow?.name ?? id }]} />
      </div>

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
                // W7-B4 (flows-27): the selector leaves the builder too.
                if (builderHasUnsavedEdits() && !window.confirm('You have unsaved builder edits — discard them?')) return;
                router.push(`/flows/${encodeURIComponent(newId)}`);
              }
            }}
            // W7-B4 review finding 12: mirror the BRIDGE's rule exactly. The
            // server refuses only `origin: 'seed'` (403); gating the button on
            // `=== 'studio'` made a flow with any other origin string
            // undeletable in the UI while the API would happily delete it.
            canDelete={!isNew && buildFlow !== null && buildFlow.origin !== 'seed'}
            onDelete={() => void handleDeleteFlow()}
          />
          {flowActionError && (
            <div data-component="flow-action-error" style={{ background: 'var(--panel)', padding: '6px 24px', fontSize: 12.5, color: '#f87171', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              {flowActionError}
            </div>
          )}
          {/* Tabs bar — BUILD active */}
          <div className="tabs" style={{ background: 'var(--panel)', padding: '0 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button
              className="tab"
              onClick={leaveBuildTab}
              disabled={isNew}
              title={isNew ? 'Save this flow first — there is nothing to monitor yet.' : undefined}
              style={isNew ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              MONITOR
            </button>
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
                    onChange={(e) => { if (e.target.value !== id) router.push(`/flows/${encodeURIComponent(e.target.value)}`); }}
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}
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
              {/* W7-A3 (flows-03): the launch control is a PERMANENT header
                  affordance — a flow no longer loses it after its first run. */}
              {view.flow && (
                <button
                  type="button"
                  className={kickoffOpen ? 'btn' : 'btn btn-primary'}
                  data-action="toggle-kickoff"
                  aria-expanded={!!kickoffOpen}
                  onClick={() => setKickoffOpen((v) => !v)}
                  style={{ fontSize: 12 }}
                >
                  {kickoffOpen ? 'Hide launcher' : 'Run flow'}
                </button>
              )}
              {/* W6-SW-3 (sweep C3#6): live-connection indicator — without
                  this a dropped WS socket looked identical to a genuinely
                  quiet run. */}
              <span
                data-component="ws-connection-status"
                data-connection-state={connState}
                title={CONNECTION_LABEL[connState]}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--faint)' }}
              >
                <span className="status-dot" data-status={CONNECTION_DOT_STATUS[connState]} />
                {CONNECTION_LABEL[connState]}
              </span>
              {refreshError ? (
                <span data-section="monitor-refresh-error" style={{ display: 'inline-flex' }}>
                  <FetchErrorState what="the live run list" error={refreshError.error} status={refreshError.status} onRetry={retryRefresh} compact />
                </span>
              ) : null}
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
            {flowNotFound ? null : (
          <>
            {/* Left: Run rail */}
            <RunRail
              runs={view.runs}
              activeRunId={view.activeRun?.id ?? null}
              onSelect={handleSelectRun}
              flowId={id}
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
                  <Link
                    data-action="review-reflection"
                    href={`/artifact?run=${encodeURIComponent(view.activeRun.id)}&type=reflection&mode=view`}
                    style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 12px', background: 'var(--violet)', color: '#fff', borderRadius: 4, textDecoration: 'none' }}
                  >
                    Review reflection →
                  </Link>
                </div>
              )}

              {/* Stage C kickoff surface — W7-A3 (flows-03): behind the
                  header's "Run flow" toggle in EVERY state (open by default
                  when the flow has no runs). Renders the launch UI matching
                  flow.kickoff.kind (idea / initiative-select / trigger-only),
                  else the generic initiative picker → POST /api/flows/:id/run. */}
              {view.ready && view.flow && kickoffOpen && (
                <FlowKickoff
                  flow={view.flow}
                  candidates={kickoffCandidates}
                  onEnqueued={handleEnqueued}
                />
              )}

              {/* W7-A3 (flows-01/23): the scheduler is what turns the QUEUED
                  rows in the rail into running ones — its real state and
                  Start/Pause/Stop sit right here on the monitor. */}
              <div style={{ padding: '6px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
                <SchedulerCard variant="strip" queuedCount={view.runs.filter((r) => r.status === 'planned').length} />
              </div>

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
                runStatus={view.activeRun?.status ?? null}
              />

              {/* History ledger — every run this flow has ever had (all six
                  `_queue/` states, already in `view.runs` via `fetchRuns()`;
                  no additional fetch), not just the currently-active one.
                  W7-C1 (flows-21): SPLIT own-vs-lineage. The primary ledger
                  is runs whose manifest flowId IS this flow; runs that only
                  traversed it as part of another flow render as a second,
                  labelled group (their rows link to the run under its own
                  flow) — no more identical 60-row ledgers on every monitor
                  with unexplained cross-flow links. */}
              {(() => {
                const split = splitRunsForFlow(id, view.runs);
                return (
                  <>
                    <HistoryLedger rows={deriveFlowLedgerRows(split.own)} nowMs={Date.now()} />
                    {split.lineage.length > 0 && (
                      <div data-section="history-ledger-lineage" data-count={split.lineage.length}>
                        <div
                          style={{
                            padding: '8px 20px 2px',
                            fontSize: 11.5,
                            color: 'var(--faint)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          Ran here as part of another flow — rows open under their own flow
                        </div>
                        <HistoryLedger rows={deriveFlowLedgerRows(split.lineage)} nowMs={Date.now()} />
                      </div>
                    )}
                  </>
                );
              })()}
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
