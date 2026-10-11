'use client';

import { useEffect, useState } from 'react';


import {
  postPlanVerdict,
  architectFileUrl,
  type CompletenessCriticFinding,
} from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { GateBand, decisionCard, gateButton } from '@/components/studio/gate/GateBand';
import { IdeaText } from '@/components/studio/gate/IdeaText';
import { pane, paneHeader, paneTitle, meta, eyebrow, word, input } from '@/components/studio/gate/styles';

const SEVERITY_COLOR: Record<CompletenessCriticFinding['severity'], string> = {
  high: 'var(--red)',
  medium: 'var(--amber)',
  low: 'var(--dim)',
};

/**
 * The architect-completeness-critic findings (REFINEMENT-PLAN §6.3), in a
 * contained pane below the decision. Purely informational — Approve IS the
 * operator's acknowledge action; there is no separate dismiss control.
 */
function CriticFindings({ findings }: { findings: CompletenessCriticFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div data-section="critic-findings" data-critic-finding-count={findings.length} style={{ ...pane, borderColor: 'var(--amber)' }}>
      <header style={paneHeader}>
        <h2 style={paneTitle}>Completeness critic</h2>
        <span style={{ ...meta, color: 'var(--amber)' }}>{findings.length} potential gap{findings.length === 1 ? '' : 's'} — read before you approve</span>
      </header>
      <ul data-pane-body style={{ height: 'var(--pane-md)', overflowY: 'auto', margin: 0, padding: 'var(--space-2) var(--space-4) var(--space-2) var(--space-6)' }}>
        {findings.map((f, i) => (
          <li key={i} data-critic-severity={f.severity} style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', marginBottom: 'var(--space-2)', overflowWrap: 'anywhere' }}>
            <span style={{ ...word, color: SEVERITY_COLOR[f.severity], marginRight: 'var(--space-2)' }}>{f.severity}</span>
            {f.initiativeId && <span style={{ ...meta, color: 'var(--faint)' }}>{f.initiativeId} </span>}
            {f.gap}
          </li>
        ))}
      </ul>
    </div>
  );
}

const DONE_COPY: Record<string, string> = {
  approve: 'Approved — manifests queued, the autonomous loop is starting…',
  revise: 'Sent back — the architect is taking another turn.',
  reject: 'Rejected.',
};

/**
 * The in-UI PLAN gate on the gate shell (forge-mfv5.1.31 row 3): the idea and
 * the decision first (D-46 — the decision control inside viewport 1), then
 * the critic's gaps and the PLAN.html (a `sandbox=""` iframe) in contained
 * panes. Approve is always enabled (no escalation gate); Send back and Reject
 * are beside it. There is no auto-approve.
 */
export function PlanGate({
  project,
  sessionId,
  planUrl,
  idea,
  criticFindings,
  onVerdict,
}: {
  project: string;
  sessionId: string;
  planUrl: string | null;
  idea: string;
  /** Outstanding findings from the architect-completeness-critic (ADR
   *  REFINEMENT-PLAN §6.3), present once the critic has run for this
   *  session. A re-approve with findings still present skips the critic and
   *  proceeds — this block is advisory only. */
  criticFindings?: CompletenessCriticFinding[];
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
  const findings = criticFindings ?? [];
  const busy = submitting ? 'the verdict is being submitted' : null;

  return (
    <div
      data-section="plan-gate"
      data-session-id={sessionId}
      data-plan-verdict-state={verdictState}
      data-decisions-resolved="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
    >
      <GateBand
        story={(
          <div style={{ ...pane, padding: 'var(--space-4) var(--space-5)', gap: 'var(--space-2)' }}>
            <div style={eyebrow}>What you asked the architect for</div>
            <div data-section="plan-idea" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 'var(--pane-lg)', overflowY: 'auto', fontSize: 'var(--text-base)', color: 'var(--dim)', overflowWrap: 'anywhere' }}>
              <IdeaText idea={idea} />
            </div>
          </div>
        )}
        decision={(
          <aside style={decisionCard}>
            <div style={eyebrow}>Your decision on the plan</div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)' }}>Plan ready — approve, send back or reject</h2>
            {findings.length > 0 && (
              <p data-section="review-claims" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--amber)', borderLeft: '2px solid var(--amber)', paddingLeft: 'var(--space-2)' }}>
                The completeness critic found {findings.length} potential gap{findings.length === 1 ? '' : 's'} — read them below before you approve.
              </p>
            )}
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Optional note (required context for send-back)…"
              rows={2}
              data-field="rationale"
              style={{ ...input, resize: 'vertical' }}
            />
            {error && <div style={{ color: 'var(--red)', fontSize: 'var(--text-sm)' }}>{error}</div>}
            {done && (
              <div data-plan-verdict-submitted={done} style={{ color: 'var(--green)', fontSize: 'var(--text-sm)' }}>{DONE_COPY[done]}</div>
            )}
            {!done && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button onClick={() => void submit('approve')} {...disabledAttrs(busy)} data-action="approve-plan" style={gateButton('primary', !submitting)}>Approve</button>
                <button onClick={() => void submit('revise')} {...disabledAttrs(busy)} data-action="revise-plan" style={gateButton('secondary', !submitting)}>Send back</button>
                <button onClick={() => void submit('reject')} {...disabledAttrs(busy)} data-action="reject-plan" style={gateButton('danger', !submitting)}>Reject</button>
              </div>
            )}
          </aside>
        )}
      />

      <CriticFindings findings={findings} />

      <div style={pane}>
        <header style={paneHeader}><h2 style={paneTitle}>The plan</h2><span style={meta}>PLAN.html · scrolls inside</span></header>
        {iframeSrc ? (
          <iframe src={iframeSrc} sandbox="" data-plan-iframe title="PLAN" style={{ width: '100%', height: 'var(--pane-xl)', border: 0, background: 'var(--text)' }} />
        ) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--dim)', padding: 'var(--space-3) var(--space-4)' }}>(PLAN.html not available)</div>
        )}
      </div>
    </div>
  );
}
