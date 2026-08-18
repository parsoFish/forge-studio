'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PlanGate } from '@/components/PlanGate';
import { ArchitectCommittedView } from '@/components/studio/session/ArchitectCommittedView';
import { architectFileUrl, type ArchitectSessionSummary, type SchedulerStatus } from '@/lib/bridge-client';
import { isCriticBlocked, shouldResetApproval, planGateKey } from '@/lib/plan-gate-state';
import {
  architectGateArmed,
  architectPlanStatusCopy,
  architectSessionHref,
  deriveArchitectPlanPhase,
  type InitiativeLinkage,
} from '@/lib/architect-plan-view';
import type { SchedulerAction } from '@/lib/scheduler-view';

/**
 * The native Studio PLAN surface for an architect session (M7-4, ADR-031;
 * rewritten per phase in W7-A3 — artifact-plan-03/04/09/10/21/27/33,
 * sessions-kinds-14). Rendered on /artifact when `runId='_architect-<sid>'`.
 *
 * ONE control set: the PlanGate (Approve / Send back / Reject) is the only gate
 * an architect plan renders, and only while the session awaits a verdict — the
 * page never mounts the generic GateBar for an architect id. Every other phase
 * renders an honest status line, a link back to the owning session (the
 * interview questions live there), and the plan itself read-only whenever the
 * session has one — a committed / rejected / drafting session is never an
 * empty body. A session that does not exist renders not-found, never a gate.
 *
 * On approve the optimistic payoff (`ArchitectCommittedView`: initiative ids
 * → queue state → run link, scheduler-aware headline + Start control) persists
 * through `finalizing` → `committed`; the poll's phase is the source of truth
 * that keeps it once it lands.
 *
 * DOM contract:
 *   [data-section="architect-plan"][data-architect-phase][data-gate-armed]
 *     [data-component="run-not-found"][data-run-kind="architect-session"] + a[data-action="back-to-sessions"]
 *     [data-section="architect-plan-status"] + a[data-action="answer-questions"|"open-session"]
 *     [data-section="plan-gate"] (PlanGate, awaiting-verdict only)
 *     [data-section="architect-committed"] (finalizing / committed / optimistic approve)
 *     iframe[data-plan-iframe][data-plan-readonly="true"] (every non-gate phase with a plan)
 */
export function ArchitectPlanGate({
  session,
  sessionId,
  sessionResolved,
  onGateState,
  linkage,
  linkageReady,
  scheduler,
  schedulerReady,
  schedulerBusy = false,
  schedulerError = null,
  onSchedulerAction,
}: {
  session: ArchitectSessionSummary | null;
  /** The `_architect-` id from the URL, shown when the session cannot be resolved. */
  sessionId: string;
  /** True once the sessions fetch settled — not-found is never asserted before. */
  sessionResolved: boolean;
  /** Bubble the verdict up so the page's data-gate-state stays in sync. */
  onGateState?: (state: 'approved' | 'idle') => void;
  linkage: InitiativeLinkage[];
  linkageReady: boolean;
  scheduler: SchedulerStatus | null;
  schedulerReady: boolean;
  schedulerBusy?: boolean;
  schedulerError?: string | null;
  onSchedulerAction?: (action: SchedulerAction) => void;
}): JSX.Element {
  // Optimistic local approval for instant payoff before the session poll catches
  // up; `finalizing`/`committed` are the bridge source of truth that keep it.
  const [approved, setApproved] = useState(false);
  const phase = session?.phase ?? '';
  const criticBlocked = isCriticBlocked(phase, session?.completenessCritic);
  useEffect(() => {
    if (session && shouldResetApproval(session.phase, session.completenessCritic)) {
      setApproved(false);
      if (criticBlocked) onGateState?.('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the phase + blocked FLAG, as before
  }, [phase, criticBlocked]);

  const kind = deriveArchitectPlanPhase(session);
  const armed = architectGateArmed(session);

  return (
    <div data-section="architect-plan" data-architect-phase={kind} data-gate-armed={armed ? 'true' : 'false'}>
      {!session && !sessionResolved && (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '20px 0' }}>Loading the architect session…</div>
      )}

      {!session && sessionResolved && (
        <div
          data-component="run-not-found"
          data-run-kind="architect-session"
          style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: '20px 0', fontSize: 13, color: 'var(--dim)' }}
        >
          <div>No architect session <code style={{ fontFamily: 'var(--font-mono)' }}>{sessionId}</code>.</div>
          <Link href="/sessions" data-action="back-to-sessions" style={{ color: 'var(--accent)' }}>← Back to sessions</Link>
        </div>
      )}

      {session && armed && (
        <PlanGate
          key={planGateKey(session.round, session.completenessCritic)}
          fullPage
          project={session.project}
          sessionId={session.sessionId}
          planUrl={session.planUrl}
          idea={session.idea}
          criticFindings={session.completenessCritic?.findings}
          onVerdict={(verdict) => {
            onGateState?.(verdict === 'approve' ? 'approved' : 'idle');
            if (verdict === 'approve') setApproved(true);
          }}
        />
      )}

      {session && !armed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(approved || kind === 'finalizing' || kind === 'committed') ? (
            <ArchitectCommittedView
              session={session}
              linkage={linkage}
              linkageReady={linkageReady}
              scheduler={scheduler}
              schedulerReady={schedulerReady}
              busy={schedulerBusy}
              error={schedulerError}
              onSchedulerAction={onSchedulerAction}
            />
          ) : (
            <StatusLine session={session} kind={kind} />
          )}
          {session.planUrl && <ReadOnlyPlan planUrl={session.planUrl} />}
        </div>
      )}
    </div>
  );
}

function StatusLine({ session, kind }: { session: ArchitectSessionSummary; kind: string }): JSX.Element {
  const href = architectSessionHref(session);
  return (
    <div
      data-section="architect-plan-status"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--panel)',
        fontSize: 13,
        color: 'var(--dim)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1 }}>{architectPlanStatusCopy(session)}</span>
      {kind === 'awaiting-answers' ? (
        <Link href={href} data-action="answer-questions" style={btnLinkStyle}>Answer the architect&apos;s questions →</Link>
      ) : kind === 'working' ? (
        <Link href={href} data-action="open-session" style={btnLinkStyle}>Follow the architect →</Link>
      ) : (
        <Link href={href} data-action="open-session" style={{ fontSize: 12.5, color: 'var(--accent)' }}>Open the session →</Link>
      )}
    </div>
  );
}

/** The plan, readable off-gate: rejected / committed / drafting sessions still
 *  have a PLAN.html worth reading. Same sandbox as PlanGate's own iframe. */
function ReadOnlyPlan({ planUrl }: { planUrl: string }): JSX.Element {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let cancelled = false;
    architectFileUrl(planUrl).then((u) => { if (!cancelled) setSrc(u); });
    return () => { cancelled = true; };
  }, [planUrl]);
  return (
    <iframe
      src={src || undefined}
      sandbox=""
      data-plan-iframe
      data-plan-readonly="true"
      title="PLAN"
      style={{ width: '100%', height: '72vh', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: '#fff' }}
    />
  );
}

const btnLinkStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: '#238636',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 14px',
  textDecoration: 'none',
};
