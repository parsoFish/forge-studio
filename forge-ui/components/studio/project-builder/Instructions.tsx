'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { startInstructions } from '@/lib/bridge-client';

/**
 * Standing-instructions editor. The canonical source is the project's
 * **AGENTS.md** — the instructions agent authors it (interview → draft → verdict
 * → write); this textarea remains a manual fallback / brief. The "Generate with
 * the instructions agent" launcher starts a session and routes to
 * `/instructions/<sid>`, passing the current textarea as the operator brief.
 */
export function Instructions({
  project,
  value,
  onChange,
}: {
  project: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parts = value.trim().length > 0
    ? value.trim().split(/[.\n]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  async function onLaunch(): Promise<void> {
    if (launching) return;
    setError(null);
    setLaunching(true);
    try {
      const res = await startInstructions({ project, prompt: value.trim() });
      if (!res.ok || !res.sessionId) {
        setError(res.error ?? 'failed to start the instructions agent');
        return;
      }
      router.push(`/instructions/${encodeURIComponent(res.sessionId)}`);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <section>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Standing Instructions <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <div
        data-section="instructions-source"
        data-source-file="AGENTS.md"
        style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 10 }}
      >
        Single source: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>AGENTS.md</code> — the instructions agent writes it; this is what every agent sees.
      </div>

      <div className="panel">
        <div className="panel-head"><span>How agents should work this project — injected into every agent</span></div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            data-action="launch-instructions"
            onClick={() => void onLaunch()}
            disabled={launching}
            style={{ alignSelf: 'flex-start', opacity: launching ? 0.6 : 1 }}
          >
            {launching ? 'Starting…' : '✦ Generate with the instructions agent'}
          </button>
          {error && <div style={{ fontSize: 11.5, color: 'var(--red, #f85149)' }}>{error}</div>}

          <textarea
            className="input instructions-textarea"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 80, resize: 'vertical' }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write positive directives — what TO do. e.g. 'Use targeted package builds. Run tests with -tags all. Keep commits conventional.'"
          />
          <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>What agents will actually see</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {parts.length === 0
                ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontStyle: 'italic', color: 'var(--faint)' }}>— type instructions above —</span>
                : parts.map((t, i) => (
                    <span key={i} style={{ background: 'var(--panel-3)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '3px 8px', fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                      {t}
                    </span>
                  ))
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
