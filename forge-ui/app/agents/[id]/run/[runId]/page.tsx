'use client';

/**
 * Standalone run view — /agents/[id]/run/[runId].
 *
 * W7-B5 (agents-07 / agents-30 / forge-irn): this page is no longer a
 * one-shot snapshot —
 *   - while the run is LIVE it polls `fetchRunDetail` on the shared bounded
 *     cadence (`pollUntilTerminal`, lib/agent-dispatch.ts) so the log/cost
 *     move without a browser reload; poll exhaustion surfaces as
 *     `data-poll-state="timed-out"` + a Re-check control — never a frozen
 *     page silently claiming liveness;
 *   - a Refresh control re-fetches on demand in every state;
 *   - a LIVE run gets a Cancel control (`POST /api/agents/runs/:runId/cancel`
 *     — the same two-step confirm shape the session surfaces use);
 *   - the fetch resolves THREE ways (lib/run-view-client.ts): `not-found`
 *     renders the shared NotFound, `unresolved` renders the shared
 *     FetchErrorState (a 500/transport failure is a fact about the READ,
 *     never rendered as "no such run" — bead forge-irn), `found` renders
 *     RunView.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FetchErrorState } from '@/components/FetchErrorState';
import { RunView } from '@/components/studio/agent-builder/RunView';
import { fetchRunDetail, type RunDetail } from '@/lib/run-view-client';
import { pollUntilTerminal, pollDisplayState } from '@/lib/agent-dispatch';
import { cancelAgentRun } from '@/lib/studio-client';
import { useDocumentTitle } from '@/lib/document-title';

export default function AgentRunPage() {
  const params = useParams();
  const runId = decodeURIComponent((params?.runId as string) ?? '');
  // W7-A3 (agents-12): the agent slug from the URL is shown and linked back
  // to — the run page used to ignore `params.id` entirely.
  const agentSlug = decodeURIComponent((params?.id as string) ?? '');

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Bounded live poll (agents-07): fetch immediately, then every 2s while
  // the run is live or the read is transiently failing; stop on a terminal
  // state or a definitive not-found. `pollNonce` restarts it (Refresh /
  // Re-check / post-cancel).
  useEffect(() => {
    if (!runId) return;
    setPollExhausted(false);
    return pollUntilTerminal<RunDetail>({
      fetchStatus: () => fetchRunDetail(runId),
      isRunning: (d) =>
        (d.resolution === 'found' && d.state === 'running')
        || (d.resolution === 'unresolved' && (d.readError?.status === undefined || d.readError.status >= 500)),
      onUpdate: (d) => setDetail(d),
      onTimeout: (last) => {
        if (last) setDetail(last);
        setPollExhausted(true);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollNonce]);

  const refresh = useCallback(() => {
    setCancelArmed(false);
    setPollNonce((n) => n + 1);
  }, []);

  const onCancel = useCallback(async () => {
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setCancelBusy(true);
    setCancelError(null);
    try {
      const r = await cancelAgentRun(runId);
      if (!r.ok) setCancelError(r.error ?? 'cancel failed');
    } finally {
      setCancelBusy(false);
      setCancelArmed(false);
      setPollNonce((n) => n + 1);
    }
  }, [cancelArmed, runId]);

  const loaded = detail !== null;
  // W7-C3 (crosscut-06): per-route tab title.
  useDocumentTitle(`run ${runId}`, agentSlug, 'Agents');
  const running = detail?.resolution === 'found' && detail.state === 'running';
  const pollState = !loaded ? null : pollExhausted ? 'timed-out' : running ? 'watching' : pollDisplayState({ state: detail!.state });

  if (loaded && detail!.resolution === 'not-found') {
    return <NotFound kind="run" id={runId} backHref="/agents" backLabel="Agents" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }} data-agent-slug={agentSlug}>
      <StudioNav />
      {/* W7-A3 (agents-12 / agents-37 / crosscut-23): the run page is no
          longer a terminus — a breadcrumb back to the agent that ran it. */}
      <nav data-section="run-breadcrumb" aria-label="Run breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px 0', fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
        <Link href="/agents" style={{ color: 'var(--dim)', textDecoration: 'none' }}>Agents</Link>
        <span style={{ color: 'var(--line-2)' }}>/</span>
        {/* W7-FIX-A3 (A3-10): exactly ONE `[data-agent-slug]` per page — the
            shell root above carries it; the link's visible text is the slug. */}
        <Link href={`/agents/${encodeURIComponent(agentSlug)}`} data-action="back-to-agent" style={{ color: 'var(--dim)', textDecoration: 'none' }}>
          {agentSlug || 'agent'}
        </Link>
        <span style={{ color: 'var(--line-2)' }}>/</span>
        <span>run {runId}</span>
        <span style={{ flex: 1 }} />
        {loaded && detail!.resolution === 'found' && (
          <span data-section="run-live-controls" {...(pollState ? { 'data-poll-state': pollState } : {})} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {pollExhausted && (
              <span className="muted" data-component="poll-exhausted-note">
                stopped watching — the run may still be going
              </span>
            )}
            <button type="button" className="btn btn-sm" data-action="refresh-run" onClick={refresh}>
              {pollExhausted ? 'Re-check' : 'Refresh'}
            </button>
            {running && (
              <button
                type="button"
                className="btn btn-sm"
                data-action="cancel-run"
                data-cancel-armed={cancelArmed ? 'true' : 'false'}
                disabled={cancelBusy}
                onClick={() => void onCancel()}
              >
                {cancelBusy ? 'Cancelling…' : cancelArmed ? 'Confirm cancel' : 'Cancel run'}
              </button>
            )}
          </span>
        )}
      </nav>
      {cancelError && (
        <p data-component="cancel-error" className="save-hint save-hint-dirty" style={{ margin: '8px 20px 0', fontSize: 12 }}>{cancelError}</p>
      )}
      {/* W7-C3 (agents-35): <main> in every state, matching RunView's own
          root — a route's [data-page] must sit on the same element type in
          every state (FlowRunDetail's convention). */}
      {!loaded ? (
        <main data-page="agent-run" data-run-id={runId} data-page-ready="false" className="muted" style={{ padding: 20, fontSize: 13 }}>
          Loading run…
        </main>
      ) : detail!.resolution === 'unresolved' ? (
        <main data-page="agent-run" data-run-id={runId} data-page-ready="true" data-fetch-status="error" style={{ padding: 20 }}>
          <FetchErrorState
            what="this agent run"
            error={detail!.readError?.message ?? 'the run could not be read'}
            status={detail!.readError?.status}
            onRetry={refresh}
          />
        </main>
      ) : (
        <RunView
          runId={runId}
          found={true}
          state={detail!.state}
          costUsd={detail!.costUsd}
          lines={detail!.lines}
          materials={detail!.materials}
          ceilingUsd={detail!.ceilingUsd}
          outputRefs={detail!.outputRefs}
          errorText={detail!.errorText}
          trigger={detail!.trigger}
        />
      )}
    </div>
  );
}
