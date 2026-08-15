'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { startOnboardingSession, fetchActiveOnboarding } from '@/lib/studio-client';
import { pollAgentRun, pollDisplayState, type PolledAgentRunStatus } from '@/lib/agent-dispatch';

/**
 * OnboardWithAgent (R4-02-F1, repointed R4-17) — the /projects entry point
 * into the onboarding agent. Extracted from `app/projects/[id]/page.tsx`
 * (W6-B14, mirrors RunPanel.tsx's own D12 extraction — a page-route file can
 * only export the reserved Next.js route symbols, so a component this task
 * needs a standalone render-pin test for has to live outside the page file).
 *
 * Dispatches through the staged onboarding session route, `POST /api/studio/
 * onboarding/start` ({@link startOnboardingSession}), rather than the generic
 * `POST /api/agents/onboarding-agent/run` — D6 keeps the underlying spawn
 * byte-identical (`spawnAgentDispatch(...)`, same argv/prompt), so the
 * returned `runId` remains pollable via the SAME `pollAgentRun` this panel
 * always used; the only change is a real, staged session dir (`sessionId`)
 * the operator can follow to `/sessions/onboarding/<id>` instead of only
 * watching the generic agent page's raw event log.
 * `data-onboard-run-id` / `data-onboard-run-status` /
 * `data-action="run-onboarding-agent"` are UNCHANGED (an existing journey
 * beat asserts them) — `data-onboard-session-id` is additive from R4-17.
 *
 * W6-B14 (background-work-server-owned-client-observes): adds the shared
 * three-visible-state contract — `data-poll-state="watching|timed-out|
 * terminal"` plus a `data-action="re-check"` affordance once timed out — and
 * reattaches on mount via `fetchActiveOnboarding` (`GET .../onboarding/
 * active`), so a nav-away-and-back (or a reload) shows the SAME live/
 * terminal state instead of forgetting a still-running dispatch.
 */
export function OnboardWithAgent({ projectId }: { projectId: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PolledAgentRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(true);
  const [pollNonce, setPollNonce] = useState(0);

  // Reattach on mount / project change — GET the active-or-latest onboarding
  // session instead of assuming a fresh, run-less state (the same shape
  // KbDrainPanel.tsx already established for drain-to-green).
  useEffect(() => {
    let cancelled = false;
    setAttaching(true);
    fetchActiveOnboarding(projectId).then((r) => {
      if (cancelled) return;
      setAttaching(false);
      if (r.runId && r.phase === 'running') {
        setRunId(r.runId);
        setSessionId(r.sessionId);
      }
    }).catch(() => { if (!cancelled) setAttaching(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Poll the dispatched run inline so events/cost are visible from the /projects
  // entry point too (F1 AC), not only the agent page. Bounded, shared with
  // RunPanel via lib/agent-dispatch.ts's pollAgentRun (never a silent freeze
  // once the poll ceiling trips — see that module's header). `pollNonce` lets
  // the "Re-check" button restart a bounded poll for the SAME runId after a
  // watch timeout, without needing runId itself to change.
  useEffect(() => {
    if (!runId) return;
    return pollAgentRun(runId, { onUpdate: setStatus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollNonce]);

  const onRun = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await startOnboardingSession(projectId);
      if (r.ok && r.runId) {
        setRunId(r.runId);
        setSessionId(r.sessionId ?? null);
      } else {
        setError(r.error ?? 'dispatch failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const runState = status?.state ?? (runId ? 'running' : 'idle');
  const pollState = pollDisplayState(status) ?? (runId ? 'watching' : null);

  return (
    <section
      data-section="onboard-with-agent"
      data-onboard-run-id={runId ?? ''}
      data-onboard-run-status={runState}
      data-onboard-session-id={sessionId ?? ''}
      data-onboard-attaching={attaching ? 'true' : 'false'}
      {...(pollState ? { 'data-poll-state': pollState } : {})}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px', marginTop: 12 }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Onboarding agent</h3>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
        Run the onboarding agent to drive this project to contract-green (declares the gate,
        converges preflight, disposes advisory clauses).
      </p>
      <button
        className="btn btn-primary"
        data-action="run-onboarding-agent"
        onClick={() => void onRun()}
        disabled={busy}
      >
        {busy ? 'Dispatching…' : 'Run onboarding agent'}
      </button>
      {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 6 }}>{error}</p>}
      {runId && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div>run <code>{runId}</code> — <Link href="/agents/onboarding-agent">agent page</Link></div>
          <div>
            status: <strong>{runState}</strong>
            {status ? ` · $${status.costUsd.toFixed(4)} · ${status.events} events` : ''}
            {pollState === 'timed-out' && (
              <button
                type="button"
                data-action="re-check"
                className="btn btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => setPollNonce((n) => n + 1)}
              >
                Re-check
              </button>
            )}
          </div>
          {sessionId && (
            <div style={{ marginTop: 4 }}>
              <Link
                data-action="view-onboarding-session"
                href={`/sessions/onboarding/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(projectId)}`}
              >
                View onboarding session →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
