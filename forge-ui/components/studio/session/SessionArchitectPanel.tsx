'use client';

import { useState } from 'react';
import Link from 'next/link';

import { rerunArchitectSession, type ArchitectSessionSummary, type EventLogEntry } from '@/lib/bridge-client';
import { StageHex } from '@/components/StageHex';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { ArchitectCommittedView } from '@/components/studio/session/ArchitectCommittedView';
import { architectHexMeta, architectHexMetaForLifecycle, isArchitectWorking, isSessionStale } from '@/lib/architect-hex';
import { architectPlanArtifactHref } from '@/lib/architect-plan-view';
import { useLoopClosureState } from '@/lib/use-loop-closure-state';

// ---------------------------------------------------------------------------
// SessionArchitectPanel — the architect kind's live interactive affordance,
// carried over UNCHANGED from `/architect/[sessionId]/interview` (R2-10 PR2,
// WI-7): the stale-warning + one-click re-run, the question form, the
// working-phase activity log, the plan-gate handoff, and the committed/
// rejected terminal states. Every `data-action`/`data-section`/`data-component`
// name below is byte-identical to the retired page's — the journeys that
// drive it by name must not need to change when this panel replaces it.
//
// W6-B7: the working-phase activity log is now the shared full-width bottom
// `ActivityLog` drawer (`components/studio/ActivityLog.tsx`), replacing the
// retired `ArchitectActivityLog` inline panel — `data-section="architect-
// activity"` is gone, superseded by the drawer's own `data-component=
// "activity-drawer"` contract (`docs/forge-ui-dom-and-harness.md`).
//
// W7-A3 (sessions-kinds-08/12/13, artifact-plan-22/23):
//   - `[data-action="open-plan"]` renders EXACTLY ONCE, in every phase where
//     the session has a PLAN.html (gate mode at awaiting-verdict, view mode
//     otherwise) — a committed session's plan is no longer unreachable;
//   - the committed branch is the shared `ArchitectCommittedView`: initiative
//     ids → queue state → run link, and a scheduler-aware headline with a
//     Start control (the hardcoded "the autonomous loop is building it now →
//     /flows/forge-develop" is gone);
//   - the activity drawer stays available in EVERY phase (collapsed once the
//     architect is no longer working) so the reasoning trail is there exactly
//     when the operator judges the plan.
// ---------------------------------------------------------------------------

export function SessionArchitectPanel({
  session,
  events,
  nowMs,
}: {
  session: ArchitectSessionSummary;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  // W8-A2 (ON-7 defect 3) — a CRASHED runner's `phase` is frozen mid-work
  // (it dies before it could write one more status.json field), so the hex
  // reads "drafting the plan…" forever unless the derived lifecycle
  // overrides it. `session.lifecycle?.state` is `undefined` for a wire
  // payload that predates the lifecycle field (declared-data-fails-open
  // guard) — that reads as the ordinary phase-only tone.
  const meta = architectHexMetaForLifecycle(session.phase, session.lifecycle?.state);
  const active = isArchitectWorking(session.phase);
  const stale = isSessionStale(session);
  const committed = session.phase === 'committed';
  // Linkage + scheduler only matter once the plan is approved — the hook is
  // inert (no fetch) for every other phase.
  const loop = useLoopClosureState(session.initiativeIds, committed);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 180px' }}>
        <StageHex
          title="architect"
          component="architect-hex"
          statusLabel={meta.label}
          glow={meta.glow}
          frac={meta.frac}
          active={active}
          events={events}
          nowMs={nowMs}
          extraData={{
            'data-architect-phase': session.phase,
            'data-architect-active': active ? 'true' : 'false',
          }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stale && <StuckWarning session={session} />}

        {session.phase === 'awaiting-answers' && (
          session.questions && session.questions.length > 0 ? (
            <ArchitectQuestionForm
              project={session.project}
              sessionId={session.sessionId}
              round={session.round}
              questions={session.questions}
            />
          ) : (
            // W6-SW-3 (sweep C6#3): questions can be empty/undefined while
            // phase is still 'awaiting-answers' — every other phase branch
            // renders explicit Status() text; this one used to render nothing.
            <Status label="Waiting on the next question…" />
          )
        )}

        {(session.phase === 'interviewing' || session.phase === 'exploring' || session.phase === 'drafting' || session.phase === 'finalizing') && (
          <Status
            label={
              session.phase === 'exploring'
                ? 'The architect is exploring edge cases…'
                : session.phase === 'drafting'
                ? 'The architect is drafting the plan…'
                : session.phase === 'finalizing'
                ? 'The architect is finalizing the plan…'
                : `The architect is thinking… (round ${session.round})`
            }
          />
        )}

        {session.phase === 'awaiting-verdict' && (
          <Status label="Plan ready — opening the review gate…" />
        )}

        {committed && (
          <div data-section="architect-status">
            <ArchitectCommittedView
              session={session}
              linkage={loop.linkage}
              linkageReady={loop.linkageReady}
              scheduler={loop.status}
              schedulerReady={loop.ready}
              busy={loop.busy}
              error={loop.error}
              onSchedulerAction={(a) => void loop.act(a)}
            />
          </div>
        )}

        {session.phase === 'rejected' && (
          <Status label="Plan rejected — start a new idea when you're ready." />
        )}

        {/* The plan link — ONCE, whenever a PLAN.html exists (W7-A3,
            artifact-plan-22): the gate at awaiting-verdict, read-only view in
            every other phase. Playwright strict mode + the flows-run journey's
            `open-plan` click both need this to be the only such element. */}
        {session.planUrl && (
          <Link
            href={architectPlanArtifactHref(session.sessionId, session.phase === 'awaiting-verdict' ? 'gate' : 'view')}
            data-action="open-plan"
            style={session.phase === 'awaiting-verdict' ? btnLinkStyle : quietLinkStyle}
          >
            {session.phase === 'awaiting-verdict' ? 'Review the plan →' : 'View the plan →'}
          </Link>
        )}

        {/* The reasoning trail, in every phase (W7-A3, sessions-kinds-13) —
            open while the architect works, collapsed once it is waiting on the
            operator or terminal, never gone. */}
        {events.length > 0 && (
          <ActivityLog
            label="architect activity"
            events={events}
            phaseLabel={session.phase}
            phaseActive={active}
            defaultOpen={active}
          />
        )}
      </div>
    </div>
  );
}

const quietLinkStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  fontSize: 12.5,
  color: 'var(--accent)',
  textDecoration: 'none',
};

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
  alignSelf: 'flex-start',
};

function Status({ label }: { label: string }): JSX.Element {
  return (
    <div
      data-section="architect-status"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--panel)',
        fontSize: 13,
        color: 'var(--dim)',
      }}
    >
      {label}
    </div>
  );
}

/** P1 — stale-session warning, with the F5 one-click re-run affordance. */
function StuckWarning({ session }: { session: ArchitectSessionSummary }): JSX.Element {
  const staleMinutes = Math.round((session.staleMs ?? 0) / 60_000);
  const [rerunState, setRerunState] = useState<'idle' | 'rerunning' | 'error'>('idle');

  async function onRerun(): Promise<void> {
    if (rerunState === 'rerunning') return;
    setRerunState('rerunning');
    try {
      const res = await rerunArchitectSession(session.project, session.sessionId);
      setRerunState(res.ok ? 'idle' : 'error');
    } catch {
      setRerunState('error');
    }
  }

  // W8-A2 (ON-7 defect 2) — `lifecycle.error` is the runner's OWN crash
  // message (the last non-stack line of stderr.log —
  // `cli/bridge-studio-lifecycle.ts::extractErrorMessage`), reached now
  // that `GET /api/architect/sessions` finally wires the lifecycle in (ON-7
  // defect 1). Naming a LOG FILE PATH was never an error message — the
  // operator had to go open a terminal and cat it themselves. Falls back to
  // the silence-based copy when the session is stale but NOT (yet) resolved
  // `crashed` (silent past the ceiling with no stderr at all is genuinely
  // "may have stalled", a different, honest claim from "crashed" — never
  // fabricate a crash message that doesn't exist).
  const crashError = session.lifecycle?.state === 'crashed' ? session.lifecycle.error : null;
  const phaseLabel = architectHexMeta(session.phase).label;

  return (
    <div
      data-architect-stale="true"
      data-architect-stale-ms={session.staleMs}
      data-rerun-state={rerunState}
      style={{
        marginBottom: 12,
        border: '1px solid #9e6a0388',
        borderRadius: 8,
        padding: '10px 14px',
        background: '#1a110033',
        fontSize: 13,
        color: '#d29922',
      }}
    >
      <div>
        {crashError !== null ? (
          <>⚠ The architect crashed while {phaseLabel} — {crashError}</>
        ) : (
          <>
            ⚠ No architect activity for {staleMinutes}m — it may have stalled. Check{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              _logs/_architect-{session.sessionId}/stderr.log
            </code>{' '}
            or re-run below.
          </>
        )}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => void onRerun()}
          disabled={rerunState === 'rerunning'}
          data-action="architect-rerun"
          style={{
            background: rerunState === 'rerunning' ? '#21262d' : '#9e6a03',
            color: '#fff',
            border: '1px solid #9e6a0388',
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: rerunState === 'rerunning' ? 'not-allowed' : 'pointer',
          }}
        >
          {rerunState === 'rerunning' ? 'Re-running…' : 'Re-run'}
        </button>
        {rerunState === 'error' && (
          <span style={{ color: '#f85149', fontSize: 12 }}>Failed to re-run — try again.</span>
        )}
      </div>
    </div>
  );
}
