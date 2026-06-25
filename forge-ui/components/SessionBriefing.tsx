'use client';

import { useState } from 'react';

/**
 * Shared briefing screen for the instructions + demo agent flows.
 *
 * Both flows now open on a briefing surface that does NOT auto-run the agent:
 * the operator reviews the existing artifact (when any) + provides optional
 * notes, then explicitly kicks off the agent. `onSubmit(notes)` records the
 * brief and (on the bridge side) transitions briefing → working.
 *
 * Matches the Studio CSS-var design system (the `/instructions/<sid>` and
 * `/demo/<sid>` pages render this inside StudioArchitectShell).
 */
export function SessionBriefing({
  heading,
  modeLabel,
  contextLabel,
  contextContent,
  notesPlaceholder,
  submitLabel,
  onSubmit,
}: {
  heading: string;
  modeLabel: string;
  contextLabel?: string;
  contextContent?: string | null;
  notesPlaceholder: string;
  submitLabel?: string;
  onSubmit: (notes: string) => Promise<void>;
}): JSX.Element {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasContext = typeof contextContent === 'string' && contextContent.trim().length > 0;

  async function submit(): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(notes.trim());
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-section="session-briefing"
      data-mode={modeLabel}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '16px 18px',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{heading}</div>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--steel, #5cc8ff)',
            background: 'rgba(92,200,255,.12)',
            border: '1px solid rgba(92,200,255,.3)',
            borderRadius: 999,
            padding: '2px 9px',
          }}
        >
          {modeLabel}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.5 }}>
        Review the context below and add any notes for the agent, then start it. The agent does not
        run until you do.
      </div>

      {hasContext && (
        <div>
          {contextLabel && (
            <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 }}>{contextLabel}</div>
          )}
          <pre
            data-section="briefing-context"
            style={{
              margin: 0,
              maxHeight: '40vh',
              overflowY: 'auto',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm, 6px)',
              padding: '12px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {contextContent}
          </pre>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 }}>Notes for the agent</div>
        <textarea
          data-field="briefing-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={notesPlaceholder}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-2)',
            color: 'var(--text)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm, 6px)',
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red, #f85149)' }}>{error}</div>}

      <div>
        <button
          type="button"
          data-action="submit-brief"
          onClick={() => void submit()}
          disabled={submitting}
          style={{
            color: '#fff',
            background: '#238636',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '7px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Starting…' : submitLabel ?? 'Start the agent →'}
        </button>
      </div>
    </div>
  );
}
