'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { StudioNav } from '@/components/StudioNav';
import {
  fetchProjectBrainSessions,
  fetchStagedThemes,
  projectBrainBrief,
  projectBrainApprove,
  projectBrainAbandon,
  type ProjectBrainSession,
} from '@/lib/bridge-client';

/**
 * R1-3b — project-brain builder review surface. An agent reads the project and
 * authors theme drafts; the operator reviews them here and approves (commit to
 * the central brain) or abandons. Mirrors the instructions/demo session screens.
 */
export default function ProjectBrainPage({ params }: { params: { sessionId: string } }) {
  const { sessionId } = params;
  const router = useRouter();
  const search = useSearchParams();
  const project = search.get('project') ?? '';

  const [session, setSession] = useState<ProjectBrainSession | null>(null);
  const [themes, setThemes] = useState<Array<{ name: string; content: string }>>([]);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const sessions = await fetchProjectBrainSessions();
    const s = sessions.find((x) => x.session_id === sessionId) ?? null;
    setSession(s);
    if (s?.phase === 'awaiting-review') setThemes(await fetchStagedThemes(s.project, sessionId));
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while the agent is working.
  useEffect(() => {
    if (session?.phase !== 'analyzing' && session?.phase !== 'committing') return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [session?.phase, refresh]);

  const phase = session?.phase ?? 'briefing';
  const proj = session?.project ?? project;

  const startAnalysis = useCallback(async () => {
    setBusy(true);
    await projectBrainBrief({ project: proj, sessionId, brief });
    setBusy(false);
    await refresh();
  }, [proj, sessionId, brief, refresh]);

  const approve = useCallback(async () => {
    setBusy(true);
    await projectBrainApprove({ project: proj, sessionId });
    setBusy(false);
    await refresh();
  }, [proj, sessionId, refresh]);

  const abandon = useCallback(async () => {
    setBusy(true);
    await projectBrainAbandon({ project: proj, sessionId });
    setBusy(false);
    await refresh();
  }, [proj, sessionId, refresh]);

  return (
    <main data-page="project-brain" data-session-id={sessionId} data-project-brain-phase={phase} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <StudioNav />
      <div style={{ padding: '24px 32px', overflowY: 'auto', maxWidth: 880 }}>
        <button data-action="back-to-project" onClick={() => router.push(`/projects/${encodeURIComponent(proj)}`)} style={backBtn}>← {proj}</button>
        <h1 style={{ fontSize: 18, margin: '12px 0 4px' }}>Build project brain — {proj}</h1>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginBottom: 20 }}>
          Phase: <span style={{ fontFamily: 'var(--font-mono)' }}>{phase}</span>
        </div>

        {phase === 'briefing' && (
          <div data-section="brain-briefing">
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

        {phase === 'analyzing' && (
          <div data-section="brain-analyzing" style={{ fontSize: 13, color: 'var(--dim)' }}>
            Reading the project and authoring themes… this can take a minute.
          </div>
        )}

        {phase === 'awaiting-review' && (
          <div data-section="brain-review" data-theme-count={themes.length}>
            <p style={{ fontSize: 13, color: 'var(--dim)' }}>{themes.length} draft theme(s). Review, then approve to commit into the central brain.</p>
            {themes.map((t) => (
              <details key={t.name} data-theme-name={t.name} style={{ marginBottom: 10, border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', background: 'var(--panel)' }}>
                <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{t.name}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--dim)', marginTop: 8 }}>{t.content}</pre>
              </details>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button data-action="approve-brain" disabled={busy} onClick={() => void approve()} style={primaryBtn}>{busy ? 'Committing…' : 'Approve + commit'}</button>
              <button data-action="abandon-brain" disabled={busy} onClick={() => void abandon()} style={ghostBtn}>Abandon</button>
            </div>
          </div>
        )}

        {phase === 'committing' && <div data-section="brain-committing" style={{ fontSize: 13, color: 'var(--dim)' }}>Committing themes into the central brain…</div>}
        {phase === 'committed' && (
          <div data-section="brain-committed" style={{ fontSize: 13 }}>
            ✓ Brain committed. <button data-action="bind-and-return" onClick={() => router.push(`/projects/${encodeURIComponent(proj)}`)} style={linkBtn}>Return to the project</button> and bind the <code>{proj}</code> brain.
          </div>
        )}
        {phase === 'abandoned' && <div data-section="brain-abandoned" style={{ fontSize: 13, color: 'var(--dim)' }}>Session abandoned.</div>}
      </div>
    </main>
  );
}

const backBtn: React.CSSProperties = { fontSize: 12, background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0 };
const primaryBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { fontSize: 13, padding: '6px 16px', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { fontSize: 13, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', padding: 0 };
const textarea: React.CSSProperties = { width: '100%', maxWidth: 560, margin: '10px 0', fontSize: 13, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 8, resize: 'vertical', display: 'block' };
