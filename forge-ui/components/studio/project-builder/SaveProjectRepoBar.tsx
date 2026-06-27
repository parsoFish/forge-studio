'use client';

import { useEffect, useState, useCallback } from 'react';

import { fetchRepoStatus, saveProjectRepo } from '@/lib/studio-client';

/**
 * R1-2 — Save bar for the project-repo write transaction. forge-UI edits
 * (project.json, AGENTS.md, demo machinery, preflight fixes) accumulate on the
 * project's `forge-studio` branch; this merges that one branch into the default
 * branch (no CI) + pushes. `reloadKey` bumps when the page re-reads project state
 * after a write, so the pending indicator stays current.
 */
export function SaveProjectRepoBar({ projectId, reloadKey }: { projectId: string; reloadKey?: number }) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchRepoStatus(projectId).then((s) => setPending(s.pending)).catch(() => {});
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh, reloadKey]);

  const save = useCallback(async () => {
    setBusy(true); setMsg(null);
    const r = await saveProjectRepo(projectId);
    setBusy(false);
    setMsg(!r.ok ? (r.error ?? 'save failed') : r.merged ? `Saved → main${r.pushed ? ' + pushed' : ''}` : (r.detail || 'nothing to save'));
    refresh();
  }, [projectId, refresh]);

  return (
    <div
      data-component="save-project-repo"
      data-repo-pending={pending ? 'true' : 'false'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 6,
        background: pending ? 'var(--panel-2)' : 'transparent', border: `1px solid ${pending ? 'var(--accent)' : 'var(--line)'}`,
      }}
    >
      <span style={{ fontSize: 12, color: pending ? 'var(--text)' : 'var(--faint)' }}>
        {pending ? 'Unsaved forge changes (on forge-studio)' : 'Project repo up to date'}
      </span>
      <button
        data-action="save-project-repo"
        disabled={busy || !pending}
        onClick={() => void save()}
        style={{
          fontSize: 12, padding: '4px 12px', borderRadius: 5, cursor: pending ? 'pointer' : 'default',
          background: pending ? 'var(--accent)' : 'var(--panel-2)', color: pending ? '#fff' : 'var(--dim)',
          border: '1px solid var(--line-2)', opacity: pending ? 1 : 0.6,
        }}
      >
        {busy ? 'Saving…' : 'Save to main'}
      </button>
      {msg && <span data-component="save-project-repo-result" style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{msg}</span>}
    </div>
  );
}
