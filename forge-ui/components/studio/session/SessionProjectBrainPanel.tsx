'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { projectBrainBrief, projectBrainApprove, projectBrainAbandon, type ProjectBrainSession } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// SessionProjectBrainPanel — the project-brain kind's live interactive
// affordance (carried from `/project-brain/[sessionId]`, R2-10 PR2, WI-7):
// the briefing form, the analyzing/committing status text, the theme-review
// verdict, and the committed/abandoned terminal states. Unlike the
// architect/instructions kinds, project-brain never showed a StageHex/
// activity-log — that fidelity is preserved here rather than forced onto it
// for visual uniformity.
//
// W7-C2 (sessions-kinds-21/22):
//   - the panel's own back-to-project link and its per-theme <details>
//     accordion are GONE — the generic session shell already renders the one
//     back link (page.tsx's `backTo`) and the artifact pane (brain-structure
//     renderer) owns file browsing; two viewers with two selection states on
//     one screen was pure overlap. The theme COUNT stays (the review copy
//     needs it).
//   - Abandon is a two-step confirm (`abandon-brain` arms it,
//     `confirm-abandon-brain` fires, `cancel-abandon-brain` backs out) and
//     is styled as the QUIET action; Approve + commit is the primary. The
//     old styling had it backwards in practice — primaryBtn leaned on
//     `var(--accent)`, a token globals.css never defines (finding
//     sessions-kinds-V02), so the PRIMARY rendered transparent while the
//     destructive ghost rendered filled. Both buttons now use the shared
//     .btn classes every other Studio control uses.
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
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

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
    setConfirmingAbandon(false);
    onRefresh();
  }, [session.project, session.session_id, onRefresh]);

  return (
    <div>
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
          <button data-action="start-brain-analysis" disabled={busy} onClick={() => void startAnalysis()} className="btn btn-primary">
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
          <p style={{ fontSize: 13, color: 'var(--dim)' }}>
            {themes.length} draft theme(s) — review them in the artifact pane on the right, then approve to commit into the central brain.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button data-action="approve-brain" disabled={busy || confirmingAbandon} onClick={() => void approve()} className="btn btn-primary">
              {busy ? 'Committing…' : 'Approve + commit'}
            </button>
            {!confirmingAbandon ? (
              <button data-action="abandon-brain" disabled={busy} onClick={() => setConfirmingAbandon(true)} style={quietDangerBtn}>
                Abandon…
              </button>
            ) : (
              <span data-section="brain-abandon-confirm" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'var(--red)' }}>Discard the drafted themes?</span>
                <button data-action="confirm-abandon-brain" disabled={busy} onClick={() => void abandon()} style={dangerBtn}>
                  {busy ? 'Abandoning…' : 'Confirm abandon'}
                </button>
                <button data-action="cancel-abandon-brain" disabled={busy} onClick={() => setConfirmingAbandon(false)} className="btn">
                  Keep reviewing
                </button>
              </span>
            )}
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

// W7-C2 (sessions-kinds-21 root cause, sessions-kinds-V02): the old
// primaryBtn/linkBtn leaned on `var(--accent)` — a token globals.css never
// defines, so the PRIMARY button rendered transparent while the destructive
// ghost rendered filled. Primary actions now use the shared .btn classes;
// the two abandon-flow styles below are deliberately QUIET (border-only)
// and danger-tinted respectively.
const quietDangerBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'none', color: 'var(--dim)', border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'none', color: 'var(--red, #f87171)', border: '1px solid var(--red, #f87171)', borderRadius: 5, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { fontSize: 13, background: 'none', border: 'none', color: 'var(--ember, #ff9e4a)', cursor: 'pointer', textDecoration: 'underline', padding: 0 };
const textarea: React.CSSProperties = { width: '100%', maxWidth: 560, margin: '10px 0', fontSize: 13, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 8, resize: 'vertical', display: 'block' };
