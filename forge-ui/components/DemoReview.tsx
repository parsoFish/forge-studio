'use client';

import { useEffect, useState } from 'react';

import {
  architectFileUrl,
  demoBuilderFeedback,
  demoBuilderLock,
  demoBuilderAbandon,
} from '@/lib/bridge-client';

/**
 * Stage B — the DEMO.html review gate. Mirrors {@link InstructionsVerdict}'s
 * visual style, but renders the generated demo itself: on mount it absolutises
 * the bridge-relative `demoUrl` through {@link architectFileUrl} (the same
 * `base + relative` resolver InstructionsVerdict uses for its draft) and shows
 * the rendered DEMO.html in a `sandbox=""` iframe (the PLAN.html gate pattern).
 *
 * Three actions wired to the demo-builder client:
 *   - Apply feedback & regenerate → demoBuilderFeedback({ feedback }) (→ generating)
 *   - Lock it in                  → demoBuilderLock   (→ locking → locked)
 *   - Abandon                     → demoBuilderAbandon (→ abandoned)
 *
 * The parent page re-polls `listDemoSessions()` on the `demo-list-changed` WS
 * signal, so once an action settles the page swaps to the new phase on its own.
 */
export function DemoReview({
  project,
  sessionId,
  demoUrl,
  iteration,
}: {
  project: string;
  sessionId: string;
  demoUrl: string | null;
  iteration: number;
}): JSX.Element {
  const [iframeSrc, setIframeSrc] = useState('');
  const [feedback, setFeedback] = useState('');
  const [action, setAction] = useState<'apply-feedback' | 'lock-demo' | 'abandon-demo'>('apply-feedback');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Absolutise the bridge-relative demoUrl for the iframe src once it resolves.
  useEffect(() => {
    let cancelled = false;
    if (!demoUrl) {
      setIframeSrc('');
      return;
    }
    architectFileUrl(demoUrl).then((abs) => {
      if (!cancelled) setIframeSrc(abs);
    });
    return () => {
      cancelled = true;
    };
  }, [demoUrl]);

  async function applyFeedback(): Promise<void> {
    if (submitting || !feedback.trim()) return;
    setAction('apply-feedback');
    setError(null);
    setSubmitting(true);
    try {
      const res = await demoBuilderFeedback({ project, sessionId, feedback: feedback.trim() });
      if (!res.ok) {
        setError(res.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function lockDemo(): Promise<void> {
    if (submitting) return;
    setAction('lock-demo');
    setError(null);
    setSubmitting(true);
    try {
      const res = await demoBuilderLock({ project, sessionId });
      if (!res.ok) {
        setError(res.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function abandonDemo(): Promise<void> {
    if (submitting) return;
    setAction('abandon-demo');
    setError(null);
    setSubmitting(true);
    try {
      const res = await demoBuilderAbandon({ project, sessionId });
      if (!res.ok) {
        setError(res.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        style={{ ...panelStyle, borderColor: '#3fb950' }}
        data-component="demo-review"
        data-demo-iter={iteration}
        data-form-state="submitted"
      >
        <div style={{ fontSize: 13, color: '#3fb950' }}>
          {action === 'apply-feedback'
            ? 'Feedback sent — the demo agent is regenerating.'
            : action === 'lock-demo'
            ? 'Locking the demo in…'
            : 'Demo abandoned.'}
        </div>
      </div>
    );
  }

  return (
    <div
      style={panelStyle}
      data-component="demo-review"
      data-demo-iter={iteration}
      data-form-state={submitting ? 'submitting' : 'editing'}
    >
      <div style={labelStyle}>generated DEMO.html (iteration {iteration})</div>

      {iframeSrc ? (
        <iframe
          data-demo-iframe
          src={iframeSrc}
          sandbox=""
          title="DEMO"
          style={{
            width: '100%',
            height: 520,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: '#fff',
            marginBottom: 12,
          }}
        />
      ) : (
        <div style={{ fontSize: 12, color: '#6e7681', marginBottom: 12 }}>
          (DEMO.html not available yet)
        </div>
      )}

      <label style={labelStyle}>
        feedback for the demo agent
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What should the demo agent change before you lock it in?"
          style={inputStyle}
          rows={3}
        />
      </label>

      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#f85149' }}>{error}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={() => void applyFeedback()}
          disabled={submitting || !feedback.trim()}
          data-action="apply-feedback"
          style={{
            ...buttonStyle,
            background: '#9e6a03',
            opacity: submitting || !feedback.trim() ? 0.5 : 1,
          }}
        >
          {submitting && action === 'apply-feedback' ? 'submitting…' : 'Apply feedback & regenerate'}
        </button>
        <button
          onClick={() => void lockDemo()}
          disabled={submitting}
          data-action="lock-demo"
          style={{ ...buttonStyle, background: '#238636', opacity: submitting ? 0.5 : 1 }}
        >
          {submitting && action === 'lock-demo' ? 'submitting…' : '✓ Lock it in'}
        </button>
        <button
          onClick={() => void abandonDemo()}
          disabled={submitting}
          data-action="abandon-demo"
          style={{ ...buttonStyle, background: '#21262d', borderColor: '#30363d' }}
        >
          {submitting && action === 'abandon-demo' ? 'submitting…' : 'Abandon'}
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
