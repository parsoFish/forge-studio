'use client';

import Link from 'next/link';
import type { SessionLifecycle, CancelOutcome } from '@/lib/session-lifecycle-client';
import { formatIdle, describeLifecycle } from '@/lib/session-lifecycle-client';
import { CancelSessionButton } from './CancelSessionButton';
import { CancelOutcomeNotice } from './CancelOutcomeNotice';

// ---------------------------------------------------------------------------
// SessionLifecycleBar — W7-A2: the per-session lifecycle banner every kind
// renders above its two panes (architect and project-brain included — this
// is shell-level, not panel-level, so a kind with no generic panel — e.g.
// community-refresh today — still gets crash/stall/cancel).
//
// Renders EXCLUSIVELY from the shell payload's server-derived `lifecycle`
// (cli/bridge-studio-lifecycle.ts): never re-derives crashed/stalled from
// phase names, timestamps, or the event log client-side.
//   - crashed          → the runner's own error text, verbatim
//                        (`[data-lifecycle-error]`) + Cancel
//   - stalled          → names the silence + Cancel
//   - awaiting-operator→ "needs you" + Cancel (the actual control lives in
//                        the panel below; this bar only states the fact)
//   - working          → quiet one-liner + Cancel (a live turn is killable)
//   - terminal         → per-phase honest copy (W7A2-10: the ONE
//                        `describeLifecycle(…, phase)` sentence the index
//                        chip renders too), NO cancel
//   - lastCancel       → W7A2-02: what the cancel actually did
//                        (`[data-cancel-outcome]`, CancelOutcomeNotice) —
//                        held by the page so it survives the refetch to
//                        terminal.
// DOM: div[data-section="session-lifecycle"][data-lifecycle-state]
// [data-needs-you][data-cancellable]; button[data-action="cancel"];
// div[data-cancel-outcome].
// ---------------------------------------------------------------------------

export function SessionLifecycleBar({
  lifecycle,
  phase,
  kind,
  sessionId,
  project,
  onCancelled,
  lastCancel = null,
}: {
  lifecycle: SessionLifecycle;
  phase: string;
  kind: string;
  sessionId: string;
  project: string | null;
  /** W7A2-02 — receives the cancel's real outcome (`killed`), never discarded. */
  onCancelled?: (outcome: CancelOutcome) => void;
  lastCancel?: CancelOutcome | null;
}): JSX.Element {
  const { state, needsYou, error, idleMs, cancellable } = lifecycle;
  const tone =
    state === 'crashed' ? 'var(--red, #f87171)'
    : state === 'stalled' || state === 'awaiting-operator' ? 'var(--ember)'
    : state === 'terminal' ? 'var(--faint)'
    : 'var(--dim)';

  let headline: string;
  if (state === 'crashed') headline = 'The agent turn crashed';
  else if (state === 'stalled') headline = `No activity for ${idleMs !== null ? formatIdle(idleMs) : 'a while'} — the agent may have stalled`;
  else if (state === 'awaiting-operator') headline = 'Waiting on you';
  else if (state === 'terminal') headline = describeLifecycle('terminal', null, null, phase);
  else headline = idleMs !== null ? `Agent working — last activity ${formatIdle(idleMs)} ago` : 'Agent working';

  return (
    <div
      data-section="session-lifecycle"
      data-lifecycle-state={state}
      data-needs-you={needsYou}
      data-cancellable={cancellable}
      role={state === 'crashed' || state === 'stalled' ? 'alert' : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
        border: `1px solid ${state === 'crashed' ? 'var(--red, #f87171)' : state === 'stalled' ? 'var(--ember)' : 'var(--line)'}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 14, background: 'var(--panel)',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tone }}>{headline}</div>
        {state === 'crashed' && (
          <pre
            data-lifecycle-error
            style={{
              margin: '6px 0 0', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: 'var(--text)', fontFamily: 'ui-monospace, Menlo, monospace', maxHeight: 160, overflow: 'auto',
            }}
          >
            {error ?? 'the agent turn threw (see stderr.log)'}
          </pre>
        )}
        {(state === 'crashed' || state === 'stalled') && (
          <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4 }}>
            Cancel to clear it from your queue, or start a fresh session of this kind.
          </div>
        )}
        {/* W7-B3 (community-01 / sessions-kinds-32): a session with nothing
            left to run here — crashed, stalled, or terminal — offers the way
            forward: the kind's own kickoff. Never rendered on a healthy
            working/awaiting session (the operator's next step is HERE). */}
        {(state === 'crashed' || state === 'stalled' || state === 'terminal') && (
          <Link
            href={`/sessions/${encodeURIComponent(kind)}/new`}
            data-action="start-new-session"
            style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--ember)', textDecoration: 'none' }}
          >
            Start a new {kind} session →
          </Link>
        )}
        {lastCancel !== null && <CancelOutcomeNotice outcome={lastCancel} />}
      </div>
      {cancellable && (
        <CancelSessionButton kind={kind} sessionId={sessionId} project={project} action="cancel" onCancelled={(outcome) => onCancelled?.(outcome)} />
      )}
    </div>
  );
}
