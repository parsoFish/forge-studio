'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { startInstructions } from '@/lib/bridge-client';

/**
 * Standing-instructions panel, bound to the project's **AGENTS.md** as the single
 * source (Stage A). When an agent-instruction file exists, this panel shows its
 * content READ-ONLY — the only way to change it is the instructions agent (which
 * writes the file through an operator-confirmed interview). The editable textarea
 * appears only as a legacy fallback for a project that has no AGENTS.md yet (its
 * value persists to project.json until an AGENTS.md is authored).
 */
export function Instructions({
  project,
  value,
  source,
  onChange,
}: {
  project: string;
  value: string;
  /** Where `value` came from — drives read-only (file-bound) vs editable. */
  source?: 'AGENTS.md' | 'CLAUDE.md' | 'project.json';
  onChange: (v: string) => void;
}) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileBound = source === 'AGENTS.md' || source === 'CLAUDE.md';
  const fileName = fileBound ? source : 'AGENTS.md';

  async function onLaunch(): Promise<void> {
    if (launching) return;
    setError(null);
    setLaunching(true);
    try {
      // No prompt — the session opens on a briefing screen (no spawn). 'edit'
      // carries the existing AGENTS.md as context; 'init' creates a fresh one.
      const res = await startInstructions({ project, mode: fileBound ? 'edit' : 'init' });
      if (!res.ok || !res.sessionId) {
        setError(res.error ?? 'failed to start the instructions agent');
        return;
      }
      router.push(`/instructions/${encodeURIComponent(res.sessionId)}`);
    } finally {
      setLaunching(false);
    }
  }

  const launchBtn = (
    <button
      type="button"
      className="btn btn-primary"
      data-action="launch-instructions"
      onClick={() => void onLaunch()}
      disabled={launching}
      style={{ alignSelf: 'flex-start', opacity: launching ? 0.6 : 1 }}
    >
      {launching ? 'Starting…' : fileBound ? `✦ Edit ${fileName} with the instructions agent` : '✦ Generate AGENTS.md with the instructions agent'}
    </button>
  );

  return (
    <section>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Standing Instructions <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <div
        data-section="instructions-source"
        data-source-file={fileName}
        data-instructions-bound={fileBound ? 'true' : 'false'}
        style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 10 }}
      >
        {fileBound ? (
          <>Single source: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fileName}</code> — bound read-only to the file the instructions agent writes. This is exactly what every agent sees.</>
        ) : (
          <>No <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>AGENTS.md</code> yet — generate one with the instructions agent (it becomes the single source). The box below is a legacy fallback saved to project.json until then.</>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><span>How agents should work this project — injected into every agent</span></div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {launchBtn}
          {error && <div style={{ fontSize: 11.5, color: 'var(--red, #f85149)' }}>{error}</div>}

          {fileBound ? (
            <pre
              data-section="instructions-file-view"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5,
                color: 'var(--text)', background: 'var(--bg-2)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)', padding: '12px 14px', margin: 0,
                maxHeight: 460, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {value.trim() || `(${fileName} is empty)`}
            </pre>
          ) : (
            <textarea
              className="input instructions-textarea"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 100, resize: 'vertical' }}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Optional brief for the agent, or interim instructions saved to project.json. e.g. 'Use targeted package builds. Run tests with -tags all. Keep commits conventional.'"
            />
          )}
        </div>
      </div>
    </section>
  );
}
