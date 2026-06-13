'use client';

import { useEffect, useState, useCallback } from 'react';
import { subscribe, type EventLogEntry, startRun, resumeRun } from '@/lib/bridge-client';
import { fetchRuns, fetchRun, fetchStudioFlows } from '@/lib/studio-client';
import type { Run, Flow } from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';
import { RunRail } from '@/components/studio/RunRail';
import { MonitorSummary } from '@/components/studio/MonitorSummary';
import { FlowTopology } from '@/components/studio/FlowTopology';
import { PhaseDrawer } from '@/components/studio/PhaseDrawer';
import { EventTail } from '@/components/studio/EventTail';

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

export default function FlowMonitorPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [flow,        setFlow]        = useState<Flow | null>(null);
  const [runs,        setRuns]        = useState<Run[]>([]);
  const [activeRun,   setActiveRun]   = useState<Run | null>(null);
  const [ready,       setReady]       = useState(false);
  const [tailEvents,  setTailEvents]  = useState<EventLogEntry[]>([]);
  const [drawerNode,  setDrawerNode]  = useState<string | null>(null);

  // ---- data loading ----

  const loadData = useCallback(
    async (signal: { cancelled: boolean }, preserveRunId?: string) => {
      try {
        const [flows, allRuns] = await Promise.all([
          fetchStudioFlows(),
          fetchRuns(id),
        ]);
        if (signal.cancelled) return;

        const found = flows.find((f) => f.id === id) ?? null;
        setFlow(found);
        setRuns(allRuns);

        // If preserving a run selection pick by id, else pick the default
        const next = preserveRunId
          ? (allRuns.find((r) => r.id === preserveRunId) ?? pickDefaultRun(allRuns))
          : pickDefaultRun(allRuns);
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

  // ---- start / resume ----

  const handleStartRun = useCallback(async () => {
    const signal = { cancelled: false };
    const r = await startRun(flow?.project ?? id);
    if (r.ok) {
      void loadData(signal);
    }
  }, [flow, id, loadData]);

  const handleResumeRun = useCallback(async () => {
    if (!activeRun) return;
    const signal = { cancelled: false };
    const r = await resumeRun(activeRun.id);
    if (r.ok) {
      void loadData(signal);
    }
  }, [activeRun, loadData]);

  // ---- run selection ----

  const handleSelectRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.id === runId) ?? null;
      setActiveRun(run);
      setTailEvents([]); // clear tail on run switch
      setDrawerNode(null);
    },
    [runs],
  );

  // ---- drawer ----

  const handleNodeClick = useCallback((nodeId: string) => {
    setDrawerNode((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerNode(null);
  }, []);

  // ---- empty states ----

  const flowNotFound = ready && !flow;

  return (
    <main
      data-page="flow-monitor"
      data-flow-id={id}
      data-active-run={activeRun?.id ?? ''}
      data-page-ready={ready ? 'true' : 'false'}
      data-run-count={runs.length}
      data-can-start={flow ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />

      {/* Flow header strip */}
      <div
        style={{
          background: 'var(--panel)',
          borderBottom: '1px solid var(--line)',
          padding: '14px 24px 0',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {flow?.name ?? id}
          </h2>
          {flow?.goal && (
            <span style={{ fontSize: 13, color: 'var(--dim)', flex: 1 }}>
              {flow.goal}
            </span>
          )}
        </div>

        {/* Tabs bar — Monitor active; Build disabled (M4) */}
        <div className="tabs">
          <button className="tab active">MONITOR</button>
          <button
            className="tab"
            disabled
            title="M4"
            style={{ cursor: 'not-allowed', opacity: 0.45 }}
          >
            BUILD
          </button>
        </div>
      </div>

      {/* Main body */}
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
              runs={runs}
              activeRunId={activeRun?.id ?? null}
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
              {runs.some((r) => r.status === 'gated') && (
                <GatedBanner runs={runs} onSelect={handleSelectRun} />
              )}

              {/* Start Run CTA — shown when the flow is known but no runs exist yet */}
              {ready && flow && runs.length === 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 20px',
                    background: 'var(--panel)',
                    borderBottom: '1px solid var(--line)',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--dim)' }}>No runs yet.</span>
                  <button
                    data-action="start-run"
                    onClick={() => void handleStartRun()}
                    style={{
                      fontSize: 12,
                      padding: '3px 12px',
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Start Run
                  </button>
                </div>
              )}

              {/* Resume CTA — shown when the active run has failed */}
              {activeRun?.status === 'failed' && (
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
                    data-run-id={activeRun.id}
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
              <MonitorSummary run={activeRun} flow={flow ?? EMPTY_FLOW} />

              {/* Topology canvas */}
              {flow ? (
                <FlowTopology
                  flow={flow}
                  run={activeRun}
                  onNodeClick={handleNodeClick}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)' }}>
                  {ready ? 'No runs yet for this flow.' : 'Loading…'}
                </div>
              )}

              {/* Event tail */}
              <EventTail
                events={tailEvents}
                activeRunId={activeRun?.id ?? null}
              />
            </div>
          </>
        )}
      </div>

      {/* Phase drawer — overlays from right */}
      {flow && (
        <PhaseDrawer
          nodeId={drawerNode}
          run={activeRun}
          flow={flow}
          onClose={handleDrawerClose}
        />
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
