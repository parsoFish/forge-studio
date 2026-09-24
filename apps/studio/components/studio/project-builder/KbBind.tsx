'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Kb } from '@/lib/studio-client';
import { startProjectBrain } from '@/lib/bridge-client';
import { SessionMinted } from '@/components/studio/session/SessionMinted';

type CreateState = 'idle' | 'starting' | 'error';

export function KbBind({
  kb,
  kbs,
  projectId,
  onChange,
}: {
  kb: string | null;
  kbs: Kb[];
  projectId: string;
  onChange: (v: string | null) => void;
}) {
  const router = useRouter();
  const boundKb = kb ? kbs.find((k) => k.id === kb) : null;
  const [createState, setCreateState] = useState<CreateState>('idle');
  const [createError, setCreateError] = useState<string | null>(null);
  // forge-8vfn.5.10: the id THIS click mints, rendered before the navigation
  // that consumes it — the `SessionMinted` convention M1-G (`forge-8vfn.5.5`)
  // adopted for architect and demo. `router.push`ing from inside the click
  // left the id observable to nothing (docs/reference/studio-dom-contract.md).
  const [mintedSessionId, setMintedSessionId] = useState<string | null>(null);

  // R1-3b: building a project brain is now an agentic session — the agent reads
  // the project + authors real themes, the operator reviews, then it commits.
  async function handleCreateProjectBrain() {
    setCreateState('starting');
    setCreateError(null);
    const r = await startProjectBrain({ project: projectId });
    if (!r.ok || !r.sessionId) {
      setCreateState('error');
      setCreateError(r.error ?? 'could not start the brain builder');
      return;
    }
    // Publish, never navigate (rulings 396/406/409/422/436): mint and stay.
    // NO `?project=` on the resulting link — the session shell resolves it
    // itself off `fetchProjectBrainSessions()`, and the runner matches a
    // minted anchor's href EXACTLY, so a query string is a link no beat can
    // find (see `authoring-launcher-mint.test.ts`; dropping this query
    // string is `forge-8vfn.5.10`'s own fix, not a carry-over).
    setCreateState('idle');
    setMintedSessionId(r.sessionId);
  }

  return (
    <div data-project-brain-session-id={mintedSessionId ?? ''}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Knowledge Base</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {boundKb ? (
          <span className="chip" data-kind="kb">
            <span className="dot" />
            {boundKb.name}
            <span className="x" onClick={() => onChange(null)} style={{ cursor: 'pointer' }}>×</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>None bound</span>
        )}
      </div>
      <select
        value={kb ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
 width: '100%', background: 'var(--panel)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          fontSize: 12.5, padding: '6px 10px', cursor: 'pointer', marginBottom: 8,
        }}
      >
        <option value="">— bind a knowledge base —</option>
        {kbs.map((k) => <option key={k.id} value={k.id}>{k.name} [{k.binding.kind}]</option>)}
      </select>
      {/* A project carries a SINGLE brain — once one is bound, the build button is
          hidden (swap via the dropdown above, or unbind with the × chip). */}
      {!boundKb && (
        <div data-section="build-project-brain">
          <button
            className="btn btn-ghost"
            data-action="create-project-brain"
            style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
            disabled={createState === 'starting'}
            onClick={handleCreateProjectBrain}
          >
            {createState === 'starting' ? 'Starting…' : '✦ Build project brain with the agent'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4, lineHeight: 1.4 }}>
            An agent reads the project and authors real themes; you review before they land.
          </div>
          {createState === 'error' && createError && (
            <div style={{ fontSize: 11, color: 'var(--error, #f87171)', marginTop: 4 }}>
              {createError}
            </div>
          )}
          <SessionMinted kind="project-brain" sessionId={mintedSessionId} />
        </div>
      )}
    </div>
  );
}
