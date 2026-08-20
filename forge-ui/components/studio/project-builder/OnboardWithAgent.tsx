'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { startOnboardingSession, fetchActiveOnboarding, getAgentRunStatus, type AgentRunStatus } from '@/lib/studio-client';
import { cancelStudioSession } from '@/lib/session-lifecycle-client';
import { pollAgentRun, pollDisplayState, type PolledAgentRunStatus } from '@/lib/agent-dispatch';

/**
 * OnboardWithAgent (R4-02-F1, repointed R4-17) — the /projects entry point
 * into the onboarding agent.
 *
 * W7-B5 (projects-29 / projects-31 / projects-36):
 *   - the poll budget now COVERS a routine run: a real successful onboarding
 *     run took 222s while the old 90×2s ceiling gave up at ~172s and painted
 *     the live run "timed-out" — `ONBOARDING_POLL_MAX_ATTEMPTS` (300 ≈ 10
 *     min) plus the shared `pollExhausted` semantics keep
 *     `data-onboard-run-status` on the last REAL state and put the watcher's
 *     exhaustion in `data-poll-state` where it belongs;
 *   - a COMPLETED run no longer vanishes on reload: the reattach effect
 *     keeps a terminal session's runId and renders a last-run block — state,
 *     cost, what it wrote (`outputRefs`), links to the run page + session;
 *   - the operator can BRIEF the agent: north star / gate command /
 *     constraints post as the `inputs` map `renderOnboardingPrompt` already
 *     supported (prompt.md is no longer "(no inputs provided)");
 *   - a live run is CANCELLABLE (the A2 session-cancel route — onboarding's
 *     dispatch pid is tracked, so cancel really kills it).
 *
 * `data-onboard-run-id` / `data-onboard-run-status` /
 * `data-action="run-onboarding-agent"` are UNCHANGED (an existing journey
 * beat asserts them); `data-onboard-session-id`, `data-poll-state`,
 * `data-onboard-attaching` unchanged from R4-17/W6-B14.
 */

/** W7-B5 (projects-29): the onboarding poll ceiling — ≥ a routine run's real
 *  length (222s observed) with margin, at the shared 2s cadence. */
export const ONBOARDING_POLL_MAX_ATTEMPTS = 300;

export function OnboardWithAgent({ projectId }: { projectId: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PolledAgentRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(true);
  const [pollNonce, setPollNonce] = useState(0);
  // W7-B5 (projects-36): a terminal reattach renders a last-run block
  // instead of silently resetting to idle.
  const [lastRun, setLastRun] = useState<{ runId: string; sessionId: string | null; status: AgentRunStatus } | null>(null);
  // W7-B5 (projects-31): the operator brief — posted as the `inputs` map.
  const [northStar, setNorthStar] = useState('');
  const [gateCommand, setGateCommand] = useState('');
  const [constraints, setConstraints] = useState('');
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Reattach on mount / project change — GET the active-or-latest onboarding
  // session instead of assuming a fresh, run-less state. W7-B5: a TERMINAL
  // phase no longer drops the run on the floor — it loads the last-run facts.
  useEffect(() => {
    let cancelled = false;
    setAttaching(true);
    setLastRun(null);
    fetchActiveOnboarding(projectId).then(async (r) => {
      if (cancelled) return;
      if (r.runId && r.phase === 'running') {
        setRunId(r.runId);
        setSessionId(r.sessionId);
        setAttaching(false);
        return;
      }
      if (r.runId) {
        // Terminal (complete/failed/cancelled) — one status read for the
        // last-run block (cost, outputRefs, real state).
        const s = await getAgentRunStatus(r.runId);
        if (cancelled) return;
        setLastRun({ runId: r.runId, sessionId: r.sessionId, status: s });
      }
      setAttaching(false);
    }).catch(() => { if (!cancelled) setAttaching(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Poll the dispatched run inline so events/cost are visible from the
  // /projects entry point too. W7-B5: the ceiling covers a routine run
  // (see ONBOARDING_POLL_MAX_ATTEMPTS) and exhaustion no longer overwrites
  // the run's own state.
  useEffect(() => {
    if (!runId) return;
    return pollAgentRun(runId, { onUpdate: setStatus, maxAttempts: ONBOARDING_POLL_MAX_ATTEMPTS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollNonce]);

  const onRun = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const inputs: Record<string, string> = {};
      if (northStar.trim()) inputs.northStar = northStar.trim();
      if (gateCommand.trim()) inputs.gateCommand = gateCommand.trim();
      if (constraints.trim()) inputs.constraints = constraints.trim();
      const r = await startOnboardingSession(projectId, Object.keys(inputs).length > 0 ? inputs : undefined);
      if (r.ok && r.runId) {
        setRunId(r.runId);
        setSessionId(r.sessionId ?? null);
        setLastRun(null);
      } else {
        setError(r.error ?? 'dispatch failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!sessionId) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setCancelBusy(true);
    setError(null);
    try {
      const r = await cancelStudioSession('onboarding', sessionId, projectId);
      if (!r.ok) setError(r.error ?? 'cancel failed');
    } finally {
      setCancelBusy(false);
      setCancelArmed(false);
      setPollNonce((n) => n + 1);
    }
  };

  const runState = status?.state ?? (runId ? 'running' : 'idle');
  const pollState = pollDisplayState(status) ?? (runId ? 'watching' : null);
  const runningNow = runId !== null && runState === 'running';

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
      {/* W7-B5 (projects-31): the brief — DATA the agent receives via the
          /start route's `inputs` map, so prompt.md is no longer
          "(no inputs provided)". All optional. */}
      <details data-section="onboard-brief" style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>Brief the agent (optional)</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input
            className="input"
            data-onboard-input="northStar"
            placeholder="North star — what this project is for"
            value={northStar}
            onChange={(e) => setNorthStar(e.target.value)}
            disabled={busy || runningNow}
          />
          <input
            className="input"
            data-onboard-input="gateCommand"
            placeholder="Quality gate command (e.g. npm test)"
            value={gateCommand}
            onChange={(e) => setGateCommand(e.target.value)}
            disabled={busy || runningNow}
          />
          <input
            className="input"
            data-onboard-input="constraints"
            placeholder="Constraints / what done means"
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            disabled={busy || runningNow}
          />
        </div>
      </details>
      <button
        className="btn btn-primary"
        data-action="run-onboarding-agent"
        onClick={() => void onRun()}
        disabled={busy || runningNow}
        title={runningNow ? 'An onboarding run is already in flight for this project' : 'Dispatch the onboarding agent'}
      >
        {busy ? 'Dispatching…' : 'Run onboarding agent'}
      </button>
      {runningNow && sessionId && (
        <button
          type="button"
          className="btn"
          data-action="cancel-onboarding"
          data-cancel-armed={cancelArmed ? 'true' : 'false'}
          disabled={cancelBusy}
          onClick={() => void onCancel()}
          style={{ marginLeft: 8 }}
        >
          {cancelBusy ? 'Cancelling…' : cancelArmed ? 'Confirm cancel' : 'Cancel'}
        </button>
      )}
      {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 6 }}>{error}</p>}
      {runId && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div>
            run{' '}
            <Link data-action="open-onboarding-run" href={`/agents/onboarding-agent/run/${encodeURIComponent(runId)}`}>
              <code>{runId}</code>
            </Link>
            {' — '}
            <Link href="/agents/onboarding-agent">agent page</Link>
          </div>
          <div>
            status: <strong>{runState}</strong>
            {status ? ` · $${status.costUsd.toFixed(4)} · ${status.events} events` : ''}
            {status?.ok === false && status.error ? (
              <span data-run-read-error className="muted" style={{ marginLeft: 6 }}>· status read failed: {status.error}</span>
            ) : null}
            {pollState === 'timed-out' && (
              <>
                {/* W7-B5 (projects-29): exhaustion is a fact about the
                    WATCHER — the run's own status above stays real. */}
                <span className="muted" data-component="poll-exhausted-note" style={{ marginLeft: 6 }}>
                  · stopped watching — the run may still be going
                </span>
                <button
                  type="button"
                  data-action="re-check"
                  className="btn btn-sm"
                  style={{ marginLeft: 8 }}
                  onClick={() => setPollNonce((n) => n + 1)}
                >
                  Re-check
                </button>
              </>
            )}
          </div>
          {status?.errorText && (
            <p data-component="run-error" className="save-hint save-hint-dirty" style={{ margin: '4px 0 0' }}>
              {status.errorText}
            </p>
          )}
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
      {/* W7-B5 (projects-36): the last completed/failed run stays visible —
          when it ran, how it ended, what it cost, what it wrote, and the
          links to audit it. */}
      {!runId && lastRun && (
        <div
          data-section="onboard-last-run"
          data-last-run-id={lastRun.runId}
          data-last-run-status={lastRun.status.state}
          style={{ marginTop: 8, fontSize: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}
        >
          <div>
            last run:{' '}
            <Link data-action="open-onboarding-run" href={`/agents/onboarding-agent/run/${encodeURIComponent(lastRun.runId)}`}>
              <code>{lastRun.runId}</code>
            </Link>
          </div>
          <div>
            ended <strong>{lastRun.status.state}</strong>
            {` · $${lastRun.status.costUsd.toFixed(4)}`}
            {lastRun.status.ceilingUsd !== undefined ? ` · ceiling $${lastRun.status.ceilingUsd}` : ''}
          </div>
          {lastRun.status.errorText && (
            <p data-component="run-error" className="save-hint save-hint-dirty" style={{ margin: '4px 0 0' }}>
              {lastRun.status.errorText}
            </p>
          )}
          {(lastRun.status.outputRefs ?? []).length > 0 && (
            <div data-component="onboard-last-run-outputs">
              wrote:{' '}
              {(lastRun.status.outputRefs ?? []).map((ref, i) => (
                <span key={ref}>{i > 0 ? ', ' : ''}<code>{ref}</code></span>
              ))}
            </div>
          )}
          {lastRun.sessionId && (
            <div style={{ marginTop: 4 }}>
              <Link
                data-action="view-onboarding-session"
                href={`/sessions/onboarding/${encodeURIComponent(lastRun.sessionId)}?project=${encodeURIComponent(projectId)}`}
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
