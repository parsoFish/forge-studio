'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { projectBrainBrief, projectBrainApprove, projectBrainAbandon, type ProjectBrainSession } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// SessionProjectBrainPanel — the project-brain kind's live interactive
// affordance, carried over UNCHANGED from `/project-brain/[sessionId]`
// (R2-10 PR2, WI-7): the back-to-project button, the briefing form, the
// analyzing/committing status text, the theme review + approve/abandon, and
// the committed/abandoned terminal states. Every `data-action`/`data-section`
// name below is byte-identical to the retired page's. Unlike the architect/
// instructions kinds, project-brain never showed a StageHex/activity-log —
// that fidelity is preserved here rather than forced onto it for visual
// uniformity (see the T3 report's design-choices note).
// ---------------------------------------------------------------------------

export function SessionProjectBrainPanel({
  session,
  themes,
  onRefresh,
}: {
  session: ProjectBrainSession;
  themes: Array<{ name: string; content: string }>;
  onRefresh: () => void;
}): JSX.Element {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  const startAnalysis = useCallback(async () => {
    setBusy(true);
    await projectBrainBrief({ project: session.project, sessionId: session.session_id, brief });
    setBusy(false);
    onRefresh();
  }, [session.project, session.session_id, brief, onRefresh]);

  const approve = useCallback(async () => {
    setBusy(true);
    await projectBrainApprove({ project: session.project, sessionId: session.session_id });
    setBusy(false);
    onRefresh();
  }, [session.project, session.session_id, onRefresh]);

  const abandon = useCallback(async () => {
    setBusy(true);
    await projectBrainAbandon({ project: session.project, sessionId: session.session_id });
    setBusy(false);
    onRefresh();
  }, [session.project, session.session_id, onRefresh]);

  return (
    <div>
      <button
        data-action="back-to-project"
        onClick={() => router.push(`/projects/${encodeURIComponent(session.project)}`)}
        style={backBtn}
      >
        ← {session.project}
      </button>

      {session.phase === 'briefing' && (
        <div data-section="brain-briefing" style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
            Optionally focus the analysis (e.g. &ldquo;emphasise the build/test conventions and the module
            layout&rdquo;), then start. The agent reads the project and drafts theme pages for your review.
          </p>
          <textarea
            data-component="brain-brief-input"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="Focus / guidance (optional)"
            style={textarea}
          />
          <button data-action="start-brain-analysis" disabled={busy} onClick={() => void startAnalysis()} style={primaryBtn}>
            {busy ? 'Starting…' : 'Start analysis →'}
          </button>
        </div>
      )}

      {session.phase === 'analyzing' && (
        <div data-section="brain-analyzing" style={{ marginTop: 12, fontSize: 13, color: 'var(--dim)' }}>
          Reading the project and authoring themes… this can take a minute.
        </div>
      )}

      {session.phase === 'awaiting-review' && (
        <div data-section="brain-review" data-theme-count={themes.length} style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--dim)' }}>{themes.length} draft theme(s). Review, then approve to commit into the central brain.</p>
          {themes.map((t) => (
            <details
              key={t.name}
              data-theme-name={t.name}
              style={{ marginBottom: 10, border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', background: 'var(--panel)' }}
            >
              <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{t.name}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--dim)', marginTop: 8 }}>{t.content}</pre>
            </details>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button data-action="approve-brain" disabled={busy} onClick={() => void approve()} style={primaryBtn}>
              {busy ? 'Committing…' : 'Approve + commit'}
            </button>
            <button data-action="abandon-brain" disabled={busy} onClick={() => void abandon()} style={ghostBtn}>
              Abandon
            </button>
          </div>
        </div>
      )}

      {session.phase === 'committing' && (
        <div data-section="brain-committing" style={{ marginTop: 12, fontSize: 13, color: 'var(--dim)' }}>
          Committing themes into the central brain…
        </div>
      )}
      {session.phase === 'committed' && (
        <div data-section="brain-committed" style={{ marginTop: 12, fontSize: 13 }}>
          {/* W6-SW-3 (sweep C6#1): this click only navigates — the per-project
              brain is already bound at onboarding time (kb.yaml's
              binding:{kind:project}), not by any step here. The old copy and
              data-action name ("bind-and-return") promised a bind step that
              never existed. */}
          ✓ Brain committed.{' '}
          <button
            data-action="return-to-project"
            onClick={() => router.push(`/projects/${encodeURIComponent(session.project)}`)}
            style={linkBtn}
          >
            Return to the project
          </button>.
        </div>
      )}
      {session.phase === 'abandoned' && (
        <div data-section="brain-abandoned" style={{ marginTop: 12, fontSize: 13, color: 'var(--dim)' }}>
          Session abandoned.
        </div>
      )}
    </div>
  );
}

const backBtn: React.CSSProperties = { fontSize: 12, background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 };
const primaryBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { fontSize: 13, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', padding: 0 };
const textarea: React.CSSProperties = { width: '100%', maxWidth: 560, margin: '10px 0', fontSize: 13, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 8, resize: 'vertical', display: 'block' };
