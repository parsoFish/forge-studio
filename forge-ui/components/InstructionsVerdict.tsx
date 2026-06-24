'use client';

import { useEffect, useState } from 'react';

import { architectFileUrl, instructionsVerdict } from '@/lib/bridge-client';

/**
 * Stage A — the AGENTS.md draft gate. Mirrors {@link ReviewVerdictForm}'s visual
 * style: on mount it fetches the pending `AGENTS.draft.md` (bridge-relative
 * `draftUrl`, absolutised through {@link architectFileUrl} — a generic
 * `base + relative` resolver) and shows the markdown in a scrollable block, with
 * three actions wired to `instructionsVerdict`:
 *   - Approve  → kind:'approve'  (finalize → commit AGENTS.md)
 *   - Revise   → reveals a feedback textarea → kind:'revise' { feedback }
 *   - Reject   → kind:'reject'
 *
 * `onSettled` lets the parent page re-poll once a verdict lands.
 */
export function InstructionsVerdict({
  project,
  sessionId,
  draftUrl,
  onSettled,
}: {
  project: string;
  sessionId: string;
  draftUrl: string | null;
  onSettled?: (kind: 'approve' | 'revise' | 'reject') => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [kind, setKind] = useState<'approve' | 'revise' | 'reject'>('approve');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the pending AGENTS.draft.md once the draftUrl resolves.
  useEffect(() => {
    let cancelled = false;
    if (!draftUrl) {
      setDraft(null);
      return;
    }
    setDraft(null);
    setDraftError(null);
    architectFileUrl(draftUrl)
      .then(async (abs) => {
        if (!abs) throw new Error('no bridge configured');
        const res = await fetch(abs, { cache: 'no-store' });
        if (!res.ok) throw new Error(`draft → ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setDraft(text);
      })
      .catch((err) => {
        if (!cancelled) setDraftError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [draftUrl]);

  async function submit(verdictKind: 'approve' | 'revise' | 'reject'): Promise<void> {
    if (submitting) return;
    // Revise is a two-step interaction: first click reveals the feedback box.
    if (verdictKind === 'revise' && kind !== 'revise') {
      setKind('revise');
      return;
    }
    setKind(verdictKind);
    setError(null);
    setSubmitting(true);
    try {
      const res = await instructionsVerdict({
        project,
        sessionId,
        kind: verdictKind,
        feedback: verdictKind === 'revise' ? feedback.trim() : undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
      onSettled?.(verdictKind);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        style={{ ...panelStyle, borderColor: '#3fb950' }}
        data-component="instructions-verdict"
        data-form-state="submitted"
        data-form-kind={kind}
      >
        <div style={{ fontSize: 13, color: '#3fb950' }}>
          {kind === 'approve'
            ? 'Approved — writing AGENTS.md…'
            : kind === 'revise'
            ? 'Revision requested — the instructions agent is redrafting.'
            : 'Draft rejected.'}
        </div>
      </div>
    );
  }

  return (
    <div
      style={panelStyle}
      data-component="instructions-verdict"
      data-form-state={submitting ? 'submitting' : 'editing'}
      data-form-kind={kind}
    >
      <div style={labelStyle}>pending AGENTS.md draft</div>
      <div
        data-section="instructions-draft"
        style={{
          maxHeight: 420,
          overflowY: 'auto',
          background: '#010409',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        {draftError ? (
          <div style={{ fontSize: 12, color: '#f85149' }}>Could not load draft: {draftError}</div>
        ) : draft === null ? (
          <div style={{ fontSize: 12, color: '#6e7681' }}>Loading draft…</div>
        ) : (
          <pre
            style={{
              margin: 0,
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: '#e6edf3',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {draft}
          </pre>
        )}
      </div>

      {kind === 'revise' && (
        <label style={labelStyle}>
          what should change
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should the instructions agent revise in the draft?"
            style={inputStyle}
            rows={3}
          />
        </label>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#f85149' }}>{error}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={() => void submit('approve')}
          disabled={submitting}
          data-action="approve-instructions"
          style={{ ...buttonStyle, background: '#238636', opacity: submitting ? 0.5 : 1 }}
        >
          {submitting && kind === 'approve' ? 'submitting…' : 'Approve — write AGENTS.md'}
        </button>
        <button
          onClick={() => void submit('revise')}
          disabled={submitting || (kind === 'revise' && !feedback.trim())}
          data-action="revise-instructions"
          style={{
            ...buttonStyle,
            background: '#9e6a03',
            opacity: submitting || (kind === 'revise' && !feedback.trim()) ? 0.5 : 1,
          }}
        >
          {submitting && kind === 'revise' ? 'submitting…' : kind === 'revise' ? 'Send revision' : 'Revise'}
        </button>
        <button
          onClick={() => void submit('reject')}
          disabled={submitting}
          data-action="reject-instructions"
          style={{ ...buttonStyle, background: '#21262d', borderColor: '#30363d' }}
        >
          {submitting && kind === 'reject' ? 'submitting…' : 'Reject'}
        </button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: 16,
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#010409',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
};
const buttonStyle: React.CSSProperties = {
  color: '#fff',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
