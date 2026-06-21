'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PlanGate } from '@/components/PlanGate';
import type { ArchitectSessionSummary } from '@/lib/bridge-client';

/**
 * The native Studio PLAN-gate surface for an architect session (M7-4, ADR-031).
 * Re-homed off the retired /architect standalone screen: rendered on /artifact
 * when `runId='_architect-<sid>'` and no structured plan.json exists.
 *
 * - The gate (PlanGate) is live only while the architect awaits a verdict. On
 *   send-back the session phase drops to drafting → the gate unmounts (the
 *   harness's beat-8 detach); the revised plan brings it back at
 *   awaiting-verdict with a fresh, unsubmitted gate (keyed on round so the
 *   component remounts per revision).
 * - On approve, the "Watch it build →" payoff appears and lands on the Studio
 *   flow monitor (beat 9). Harness asserts data-action="watch-it-build".
 */
export function ArchitectPlanGate({
  session,
  onGateState,
}: {
  session: ArchitectSessionSummary;
  /** Bubble the verdict up so the page's data-gate-state stays in sync. */
  onGateState?: (state: 'approved' | 'idle') => void;
}): JSX.Element {
  // Optimistic local approval for instant payoff before the session poll catches
  // up; `session.phase === 'committed'` is the bridge source of truth that keeps
  // it shown once the poll lands.
  const [approved, setApproved] = useState(false);

  // On send-back → redraft, the session drops to a working phase (drafting/
  // interviewing) before a fresh round returns at `awaiting-verdict`. Reset the
  // local approval there so the "Watch it build →" payoff cannot leak across
  // rounds. Do NOT reset on `committed` — that IS the approved terminal state and
  // is what keeps the payoff visible after the poll updates the phase.
  useEffect(() => {
    if (session.phase !== 'awaiting-verdict' && session.phase !== 'committed') {
      setApproved(false);
    }
  }, [session.phase]);

  const showPayoff = approved || session.phase === 'committed';

  return (
    <>
      {session.phase === 'awaiting-verdict' && (
        <PlanGate
          key={`plan-gate-r${session.round}`}
          fullPage
          project={session.project}
          sessionId={session.sessionId}
          planUrl={session.planUrl}
          idea={session.idea}
          onVerdict={(kind) => {
            onGateState?.(kind === 'approve' ? 'approved' : 'idle');
            if (kind === 'approve') setApproved(true);
          }}
        />
      )}

      {showPayoff && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid rgba(74,222,128,.4)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 18px',
            background: 'rgba(74,222,128,.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--green)' }}>
            Approved — manifests queued; the autonomous loop is building it now.
          </span>
          <Link
            href="/flows/forge-develop"
            data-action="watch-it-build"
            style={{
              flex: '0 0 auto',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: '#238636',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '6px 14px',
              textDecoration: 'none',
            }}
          >
            Watch it build →
          </Link>
        </div>
      )}
    </>
  );
}
