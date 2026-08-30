'use client';

import { useState } from 'react';

import { startDemoBuilder } from '@/lib/bridge-client';
import { SessionMinted } from '@/components/studio/session/SessionMinted';

/**
 * "Select the demo stage and hand it to the demo builder" — the act S1 beat 7
 * describes, given a control on the surface the operator is standing on.
 *
 * `forge-8vfn.5.6`, second half: the onboarding session's stage detail declared
 * `data-stage-detail-state|stage|status` and NO `data-action` at all, so the
 * demo stage could be READ from the session and never acted on;
 * `[data-action="launch-demo-builder"]` existed only on the project page
 * (`DemoTimeline`), two navigations away. This is the same act, dispatched the
 * same way (`startDemoBuilder`), on the surface that names the stage.
 *
 * It publishes the minted id rather than navigating inside the click
 * (`forge-8vfn.5.5`), so the session it starts is bindable by the beat that
 * started it.
 */
export function DemoStageHandoff({ project }: { project: string }): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startDemoBuilder({ project, mode: 'create' });
      if (!res.ok || !res.sessionId) {
        setError(res.error ?? 'failed to start the demo agent');
        return;
      }
      setSessionId(res.sessionId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <button
        type="button"
        className="btn btn-sm"
        data-action="launch-demo-builder"
        disabled={busy || sessionId !== null}
        onClick={() => void launch()}
      >
        {busy ? 'Starting…' : 'Hand this stage to the demo builder'}
      </button>
      {error !== null && (
        <span data-demo-handoff-error style={{ fontSize: 12, color: 'var(--red, #f87171)' }}>{error}</span>
      )}
      <SessionMinted kind="demo" sessionId={sessionId} project={project} />
    </div>
  );
}
