'use client';

import { useState } from 'react';
import { postGate } from '@/lib/bridge-client';

export type GateState = 'idle' | 'approved' | 'sent-back';

/**
 * Fixed bottom bar for plan + demo gate-modes.
 * Verdict gate uses ReviewVerdictForm instead (the harness depends on its data-*).
 *
 * Approve is disabled until decisionsResolved is true (plan gate: all design
 * decisions selected; demo gate: no decisions, always enabled).
 * On approve → POST /api/runs/:id/gates/:gateId {verdict:'approve', rationale}
 * On send-back → requires notes → POST {verdict:'send-back', notes}
 */
export function GateBar({
  runId,
  gateId,
  decisionsResolved,
  label,
  hint,
  onStateChange,
}: {
  runId: string;
  /** 'plan' | 'verdict' (but we only show GateBar for plan + demo) */
  gateId: string;
  /** When false, Approve button stays disabled (plan gate: needs all decisions). */
  decisionsResolved: boolean;
  label: string;
  hint: string;
  onStateChange?: (state: GateState) => void;
}) {
  const [gateState, setGateState] = useState<GateState>('idle');
  const [showSendBack, setShowSendBack] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function transition(s: GateState) {
    setGateState(s);
    onStateChange?.(s);
  }

  async function handleApprove() {
    if (!decisionsResolved || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await postGate(runId, gateId, 'approve', {});
      if (!res.ok) { setError(res.error ?? 'approve failed'); return; }
      transition('approved');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendBack() {
    if (!notes.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await postGate(runId, gateId, 'send-back', { notes: notes.trim() });
      if (!res.ok) { setError(res.error ?? 'send-back failed'); return; }
      transition('sent-back');
      setShowSendBack(false);
    } finally {
      setSubmitting(false);
    }
  }

  const barBorderColor =
    gateState === 'approved' ? 'var(--green)' :
    gateState === 'sent-back' ? 'var(--violet)' :
    'var(--ember)';

  return (
    <div
      data-gate-state={gateState}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        background: 'var(--panel-2)',
        borderTop: `2px solid ${barBorderColor}`,
        boxShadow: '0 -8px 40px rgba(0,0,0,.5)',
        padding: '16px 28px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
        transition: 'border-top-color 0.3s',
      }}
    >
      {/* Context */}
      <div style={{ flex: 1, minWidth: 200 }}>
        {gateState === 'idle' ? (
          <>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--amber)',
              marginBottom: 4,
            }}>
              {label}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>{hint}</div>
          </>
        ) : gateState === 'approved' ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--green)',
          }}>
            <span style={{ fontSize: 20 }}>✓</span>
            Approved — flow resuming…
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--violet)',
          }}>
            <span style={{ fontSize: 20 }}>↩</span>
            Sent back — agent will iterate
          </div>
        )}
      </div>

      {/* Actions */}
      {gateState === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => void handleApprove()}
            disabled={!decisionsResolved || submitting}
            title={!decisionsResolved ? 'Resolve all design decisions first' : undefined}
            style={{
              background: decisionsResolved ? 'linear-gradient(135deg,#238636,#1a7a2e)' : 'var(--panel-3)',
              color: decisionsResolved ? '#fff' : 'var(--faint)',
              border: '1px solid',
              borderColor: decisionsResolved ? '#2ea043' : 'var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 20px',
              fontSize: 13,
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              cursor: decisionsResolved && !submitting ? 'pointer' : 'not-allowed',
              opacity: !decisionsResolved ? 0.45 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {submitting ? 'Approving…' : 'Approve'}
          </button>

          <button
            onClick={() => setShowSendBack((v) => !v)}
            disabled={submitting}
            style={{
              background: 'transparent',
              color: 'var(--dim)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 16px',
              fontSize: 13,
              fontFamily: 'var(--font-display)',
              cursor: 'pointer',
            }}
          >
            Send back with notes
          </button>
        </div>
      )}

      {/* Send-back textarea */}
      {gateState === 'idle' && showSendBack && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe what needs to change…"
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--bg-2)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => void handleSendBack()}
              disabled={!notes.trim() || submitting}
              style={{
                background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                color: '#fff',
                border: '1px solid #8b5cf6',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 16px',
                fontSize: 13,
                cursor: !notes.trim() || submitting ? 'not-allowed' : 'pointer',
                opacity: !notes.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? 'Sending…' : 'Send back'}
            </button>
            <button
              onClick={() => { setShowSendBack(false); setNotes(''); }}
              style={{
                background: 'transparent',
                color: 'var(--dim)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
