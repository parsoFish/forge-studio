'use client';

import type { SessionLifecycle } from '@/lib/session-lifecycle-client';
import { formatIdle } from '@/lib/session-lifecycle-client';
import { CancelSessionButton } from './CancelSessionButton';

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
//   - terminal         → per-phase honest copy, NO cancel
// DOM: div[data-section="session-lifecycle"][data-lifecycle-state]
// [data-needs-you][data-cancellable]; button[data-action="cancel"].
// ---------------------------------------------------------------------------

/** Phases that mean "finished successfully" vs "stopped" — the terminal
 *  copy names which. Anything else terminal (a future kind's own token)
 *  reads as the neutral "Finished — <phase>". */
const DONE_PHASES: ReadonlySet<string> = new Set(['committed', 'locked', 'applied', 'complete']);
const STOPPED_PHASES: ReadonlySet<string> = new Set(['rejected', 'abandoned', 'cancelled', 'failed']);

function terminalCopy(phase: string): string {
  if (DONE_PHASES.has(phase)) return `Done — ${phase}. Nothing further to do here.`;
  if (STOPPED_PHASES.has(phase)) return `${phase.charAt(0).toUpperCase()}${phase.slice(1)} — nothing further to do here.`;
  return `Finished — ${phase}.`;
}

export function SessionLifecycleBar({
  lifecycle,
  phase,
  kind,
  sessionId,
  project,
  onCancelled,
}: {
  lifecycle: SessionLifecycle;
  phase: string;
  kind: string;
  sessionId: string;
  project: string | null;
  onCancelled?: () => void;
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
  else if (state === 'terminal') headline = terminalCopy(phase);
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
      </div>
      {cancellable && (
        <CancelSessionButton kind={kind} sessionId={sessionId} project={project} action="cancel" onCancelled={() => onCancelled?.()} />
      )}
    </div>
  );
}
