'use client';

import { useEffect, useState } from 'react';

import {
  postPlanVerdict,
  architectFileUrl,
} from '@/lib/bridge-client';

/**
 * ADR 020 — the in-UI PLAN gate. Shows the PLAN.html in a `sandbox=""` iframe
 * for reading. Approve is always enabled (no escalation gate). Send-back /
 * Reject are also available. There is no auto-approve.
 */
export function PlanGate({
  project,
  sessionId,
  planUrl,
  idea,
  fullPage = false,
  onVerdict,
}: {
  project: string;
  sessionId: string;
  planUrl: string | null;
  idea: string;
  /** Dedicated plan screen — render the PLAN.html iframe tall (its own page). */
  fullPage?: boolean;
  /** Fired after a verdict POST succeeds — lets the host surface a follow-on
   *  affordance (e.g. the /artifact gate's "Watch it build →" link on approve). */
  onVerdict?: (kind: 'approve' | 'revise' | 'reject') => void;
}) {
  const [iframeSrc, setIframeSrc] = useState('');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (planUrl) architectFileUrl(planUrl).then((u) => { if (!cancelled) setIframeSrc(u); });
    return () => { cancelled = true; };
  }, [planUrl]);

  async function submit(kind: 'approve' | 'revise' | 'reject'): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await postPlanVerdict({
        project,
        sessionId,
        kind,
        rationale: rationale.trim() || undefined,
      });
      if (!res.ok) { setError(res.error ?? 'verdict failed'); return; }
      setDone(kind);
      onVerdict?.(kind);
    } finally {
      setSubmitting(false);
    }
  }

  const verdictState = done ?? 'ready';

  return (
    <div
      data-section="plan-gate"
      data-session-id={sessionId}
      data-plan-verdict-state={verdictState}
      data-decisions-resolved="true"
      style={{ border: '1px solid #30363d', borderRadius: 10, padding: 16, background: '#0d1117' }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
        Plan ready — review &amp; approve
      </div>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>{idea}</div>

      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          sandbox=""
          data-plan-iframe
          title="PLAN"
          style={{
            width: '100%',
            height: fullPage ? '72vh' : 420,
            border: '1px solid #30363d',
            borderRadius: 8,
            background: '#fff',
            marginBottom: 14,
          }}
        />
      ) : (
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14 }}>
          (PLAN.html not available)
        </div>
      )}

      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Optional note (required context for send-back)…"
        rows={2}
        data-field="rationale"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#010409',
          color: '#e6edf3',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 13,
          marginBottom: 10,
          resize: 'vertical',
        }}
      />

      {error && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {done && (
        <div data-plan-verdict-submitted={done} style={{ color: '#3fb950', fontSize: 12, marginBottom: 8 }}>
          {done === 'approve' ? 'Approved — manifests queued, the autonomous loop is starting…' : done === 'revise' ? 'Sent back — the architect is taking another turn.' : 'Rejected.'}
        </div>
      )}

      {!done && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void submit('approve')}
            disabled={submitting}
            data-action="approve-plan"
            style={btn(!submitting, '#238636')}
          >
            Approve
          </button>
          <button
            onClick={() => void submit('revise')}
            disabled={submitting}
            data-action="revise-plan"
            style={btn(!submitting, '#9e6a03')}
          >
            Send back
          </button>
          <button
            onClick={() => void submit('reject')}
            disabled={submitting}
            data-action="reject-plan"
            style={btn(!submitting, '#6e2330')}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function btn(enabled: boolean, bg: string): React.CSSProperties {
  return {
    background: enabled ? bg : '#21262d',
    color: enabled ? '#fff' : '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}
