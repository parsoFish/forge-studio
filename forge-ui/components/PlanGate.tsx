'use client';

import { useEffect, useState } from 'react';

import {
  postPlanVerdict,
  architectFileUrl,
  type ArchitectEscalation,
} from '@/lib/bridge-client';

/**
 * ADR 020 — the in-UI PLAN gate. Shows the comparative PLAN.html (Phase C) in a
 * `sandbox=""` iframe for reading, plus the SINGLE interactive decision surface:
 * one row of side-by-side pros/cons option cards per council escalation (operator
 * pref 2026-06-01 — the PLAN.html preview is read-only; this is the one place a
 * decision is resolved). **Approve** enables only once every decision is resolved;
 * approving POSTs the selections, which feed one more architect turn that bakes
 * them into the manifests and promotes them to `_queue/pending/`. Send-back /
 * Reject are also available. There is no auto-approve.
 */
export function PlanGate({
  project,
  sessionId,
  planUrl,
  escalations,
  idea,
  fullPage = false,
}: {
  project: string;
  sessionId: string;
  planUrl: string | null;
  escalations: ArchitectEscalation[];
  idea: string;
  /** Dedicated plan screen — render the PLAN.html iframe tall (its own page). */
  fullPage?: boolean;
}) {
  const [iframeSrc, setIframeSrc] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (planUrl) architectFileUrl(planUrl).then((u) => { if (!cancelled) setIframeSrc(u); });
    return () => { cancelled = true; };
  }, [planUrl]);

  const allResolved = escalations.every((e) => selections[e.id]);

  async function submit(kind: 'approve' | 'revise' | 'reject'): Promise<void> {
    if (submitting) return;
    if (kind === 'approve' && !allResolved) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await postPlanVerdict({
        project,
        sessionId,
        kind,
        selections: kind === 'approve' ? selections : undefined,
        rationale: rationale.trim() || undefined,
      });
      if (!res.ok) { setError(res.error ?? 'verdict failed'); return; }
      setDone(kind);
    } finally {
      setSubmitting(false);
    }
  }

  const verdictState = done ?? (allResolved ? 'ready' : 'unresolved');

  return (
    <div
      data-section="plan-gate"
      data-session-id={sessionId}
      data-plan-verdict-state={verdictState}
      data-decisions-resolved={allResolved ? 'true' : 'false'}
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

      {escalations.length > 0 && (
        <div data-section="design-decisions" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 8 }}>
            Resolve {escalations.length} design decision{escalations.length === 1 ? '' : 's'}
          </div>
          {escalations.map((e) => (
            <fieldset
              key={e.id}
              data-escalation-id={e.id}
              data-decision-resolved={selections[e.id] ? 'true' : 'false'}
              style={{ border: '1px solid #21262d', borderRadius: 8, padding: 12, margin: '0 0 12px' }}
            >
              <legend style={{ fontSize: 12, color: '#e6edf3', padding: '0 4px' }}>
                {e.question} <span style={{ color: '#8b949e' }}>({e.critic})</span>
              </legend>
              {/* Options laid out HORIZONTALLY — one row, side-by-side columns that
                  do not wrap (operator pref: full pros/cons card per option). */}
              <div
                style={{
                  display: 'grid',
                  gridAutoFlow: 'column',
                  gridAutoColumns: `minmax(0, 1fr)`,
                  gap: 10,
                  alignItems: 'stretch',
                }}
              >
                {e.options.map((opt) => {
                  const selected = selections[e.id] === opt.label;
                  return (
                    <OptionCard
                      key={opt.label}
                      escId={e.id}
                      opt={opt}
                      selected={selected}
                      onSelect={() => setSelections((s) => ({ ...s, [e.id]: opt.label }))}
                    />
                  );
                })}
              </div>
            </fieldset>
          ))}
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
            disabled={!allResolved || submitting}
            data-action="approve-plan"
            style={btn(allResolved && !submitting, '#238636')}
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

/**
 * One option as a vertical pros/cons card. Cards are laid out side-by-side by
 * the parent grid (one row per decision); each card stretches to equal height.
 * The radio input is preserved (the e2e-journey harness `.check()`s
 * `[data-escalation-id] input[type="radio"]`), and `data-option-label` /
 * `data-option-selected` mirror the selection for DOM-as-metrics automation.
 */
function OptionCard({
  escId,
  opt,
  selected,
  onSelect,
}: {
  escId: string;
  opt: ArchitectEscalation['options'][number];
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const pros = opt.tradeoffs?.pros ?? [];
  const cons = opt.tradeoffs?.cons ?? [];
  return (
    <label
      data-option-label={opt.label}
      data-option-selected={selected ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        minWidth: 0,
        border: `1px solid ${selected ? '#2f81f7' : '#30363d'}`,
        boxShadow: selected ? '0 0 0 1px #2f81f7' : 'none',
        borderRadius: 6,
        padding: 10,
        background: selected ? '#0d1b2e' : '#0d1117',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="radio"
          name={`esc-${escId}`}
          checked={selected}
          onChange={onSelect}
          style={{ flex: '0 0 auto' }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', minWidth: 0, overflowWrap: 'anywhere' }}>
          {opt.label}
        </span>
      </div>
      <span style={{ fontSize: 12, color: '#8b949e', overflowWrap: 'anywhere' }}>{opt.rationale}</span>
      {(pros.length > 0 || cons.length > 0) && (
        <ul data-option-tradeoffs style={{ listStyle: 'none', padding: 0, margin: '2px 0 0', fontSize: 11.5, display: 'grid', gap: 2 }}>
          {pros.map((p, i) => (
            <li key={`p${i}`} className="pro" style={{ color: '#7ee787', overflowWrap: 'anywhere' }}>
              <span style={{ color: '#2ea043', marginRight: 5 }}>✓</span>{p}
            </li>
          ))}
          {cons.map((c, i) => (
            <li key={`c${i}`} className="con" style={{ color: '#ffa198', overflowWrap: 'anywhere' }}>
              <span style={{ color: '#cf222e', marginRight: 5 }}>✕</span>{c}
            </li>
          ))}
        </ul>
      )}
    </label>
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
