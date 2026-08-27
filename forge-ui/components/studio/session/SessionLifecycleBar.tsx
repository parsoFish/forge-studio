'use client';

import Link from 'next/link';
import type { SessionLifecycle, CancelOutcome } from '@/lib/session-lifecycle-client';
import { formatIdle, describeLifecycle } from '@/lib/session-lifecycle-client';
import { sessionTerminalOutcome } from '@/lib/history-ledger';
import { CancelSessionButton } from './CancelSessionButton';
import { CancelOutcomeNotice } from './CancelOutcomeNotice';

// ---------------------------------------------------------------------------
// SessionLifecycleBar — W7-A2: the per-session lifecycle banner every kind
// renders above its two panes (architect and project-brain included — this
// is shell-level, not panel-level, so a kind with its own bespoke panel, or
// none at all, still gets crash/stall/cancel).
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
//
// WI-1b (ON-7): `data-lifecycle-state` stays EXACTLY the 5-token contract
// above (never widened — journeys this lane cannot run assert on it) even
// though `terminal` used to bucket a genuinely-failed session (phase
// rejected/abandoned/cancelled/failed) identically to a succeeded one. Fixed
// ADDITIVELY: `data-lifecycle-terminal-outcome="succeeded"|"failed"|
// "cancelled"` (derived from `phase` via `sessionTerminalOutcome`, the SAME
// classification `home-view.ts`'s failed-hex derivation uses), present ONLY
// when `state === 'terminal'`. A terminal-`failed` outcome ALSO renders the
// real reason in `pre[data-lifecycle-error]` (the SAME element `crashed`
// already uses) whenever `lifecycle.error` actually carries one — never a
// log-file path in its place.
// ---------------------------------------------------------------------------

export function SessionLifecycleBar({
  lifecycle,
  phase,
  kind,
  sessionId,
  project,
  legacy = false,
  onCancelled,
  lastCancel = null,
}: {
  lifecycle: SessionLifecycle;
  phase: string;
  kind: string;
  sessionId: string;
  project: string | null;
  /** W8-F6 (bead forge-6gv.27) — this session's working files are gone and its
   *  phase is whatever its event log last recorded MID-FLIGHT, not a terminal
   *  token. See `terminalOutcome` below for why that matters here. */
  legacy?: boolean;
  /** W7A2-02 — receives the cancel's real outcome (`killed`), never discarded. */
  onCancelled?: (outcome: CancelOutcome) => void;
  lastCancel?: CancelOutcome | null;
}): JSX.Element {
  const { state, needsYou, error, idleMs, cancellable } = lifecycle;
  // WI-1b (ON-7): the terminal outcome, ONLY meaningful (and only computed)
  // when state === 'terminal' — null otherwise, so the additive attribute
  // below never renders on a non-terminal row.
  // W8-F6 (bead forge-6gv.27), adversarial review finding 2 — NOT derived for a
  // legacy session. `sessionTerminalOutcome` fails CLOSED over a closed
  // terminal vocabulary: anything that is not a declared done-phase and not
  // 'cancelled' is 'failed'. That is right for a real terminal phase and wrong
  // for a legacy one, whose phase is a MID-FLIGHT snapshot the log happened to
  // record last — on the reference host all seven legacy architect sessions
  // read `finalizing`, so every one of them would have rendered
  // `data-lifecycle-terminal-outcome="failed"` directly beneath a banner saying
  // "Read-only history … Last recorded phase: finalizing". A fabricated verdict
  // on the exact page this fix exists to make honest. Omitted entirely rather
  // than guessed: the session's outcome is genuinely unknown.
  const terminalOutcome = state === 'terminal' && !legacy ? sessionTerminalOutcome(phase) : null;
  // A real reason is worth showing for a terminal FAILURE too — but only
  // when the lifecycle actually carries one (`error` is null for every
  // terminal row today; this stays honest-absent rather than fabricating
  // one, and never falls back to a log-file path).
  const showTerminalError = terminalOutcome === 'failed' && error !== null;
  const tone =
    state === 'crashed' ? 'var(--red, #f87171)'
    : state === 'stalled' || state === 'awaiting-operator' ? 'var(--ember)'
    : state === 'terminal' ? 'var(--faint)'
    : 'var(--dim)';

  let headline: string;
  if (state === 'crashed') headline = 'The agent turn crashed';
  else if (state === 'stalled') headline = `No activity for ${idleMs !== null ? formatIdle(idleMs) : 'a while'} — the agent may have stalled`;
  else if (state === 'awaiting-operator') headline = 'Waiting on you';
  else if (state === 'terminal' && legacy) headline = phase === ''
    ? 'Read-only history — this session ended and its working files are gone'
    : `Read-only history — last recorded phase: ${phase}`;
  else if (state === 'terminal') headline = describeLifecycle('terminal', null, null, phase);
  else headline = idleMs !== null ? `Agent working — last activity ${formatIdle(idleMs)} ago` : 'Agent working';

  return (
    <div
      data-section="session-lifecycle"
      data-lifecycle-state={state}
      {...(terminalOutcome !== null ? { 'data-lifecycle-terminal-outcome': terminalOutcome } : {})}
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
        {(state === 'crashed' || showTerminalError) && (
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
