'use client';

/**
 * RunControls — the run's recovery affordances, on every surface that shows a
 * run (W8-A3 WI-3: `flows-28`, `flows-49`, `flows-23`).
 *
 * What it replaces: a hard-coded "Run failed. [Resume]" bar on the flow
 * monitor whose click had no else branch (a failed POST vanished), no
 * disclosure of what Resume does, no observable outcome when `forge serve`
 * is not currently claiming — and, on the run DETAIL page, nothing at all.
 *
 * Three things it does that the old bar did not:
 *
 *  1. Offers the full set the bridge already implements. `requeue` and
 *     `abandon` (`POST /api/recovery/:id/{requeue,abandon}`) had exactly one
 *     consumer in the product, the roadmap canvas.
 *  2. Says what each one DOES. Resume re-enters at the demo node against the
 *     preserved branch; Requeue re-runs from the start on a fresh worktree;
 *     Abandon deletes the worktree and branch. The copy comes from
 *     `lib/run-controls.ts`, next to the derivation.
 *  3. Makes the outcome observable. Every one of these is a QUEUE WRITE — a
 *     success mounts the shared `EnqueueOutcomeLine`, which carries the ONE
 *     read-only `<ServeStatusNotice>` so a restarting/draining/down serve is
 *     still honest about "nothing will run yet" rather than silently
 *     promising progress. A failure renders its error rather than being
 *     swallowed. A queued (`planned`) run, which has no run-scoped control at
 *     all, gets the same read-only serve line for the same reason.
 *
 * The recovery routes key on the INITIATIVE id (`INIT_ID_RE`), which is also
 * the stable run handle across a claim, so all three posts use `run.initiativeId`.
 *
 * DOM contract:
 *   [data-section="run-controls"][data-run-status][data-control-count][data-run-id]
 *     [data-component="run-control-detail"][data-control=<id>]
 *     button[data-action="resume-run"|"requeue-run"|"abandon-run"]
 *       [data-run-id]         the run handle shown in the UI (a cycle id once claimed)
 *       [data-initiative-id]  the id these routes actually take (INIT_ID_RE) — a
 *                             harness driving the API keys on THIS one
 *     [data-component="abandon-confirm"] + [data-action="confirm-abandon"|"cancel-abandon"]
 *     [data-component="run-control-error"]      (verbatim failure text)
 *     [data-component="run-control-outcome"][data-outcome-control=<id>]
 *       -> EnqueueOutcomeLine's own contract ([data-component="enqueue-outcome"] …)
 *     [data-component="queued-halted"]                              (queued runs, emergency halt on)
 *     [data-component="queued-awaits-serve"]                         (queued runs, serve CONFIRMED running)
 *     [data-component="serve-status-notice"][data-serve-state]       (queued runs, serve CONFIRMED not running)
 *     [data-component="queued-serve-unconfirmed"]                    (queued runs, serve status unknown — null or unsupervised)
 */

import { useState } from 'react';

import { EnqueueOutcomeLine } from '@/components/studio/EnqueueOutcomeLine';
import { ServeStatusNotice } from '@/components/studio/ServeStatusNotice';
import { useServeStatus } from '@/lib/use-serve-status';
import { resumeRun, recoveryRequeue, recoveryAbandon, recoveryStop } from '@/lib/bridge-client';
import {
  armedControl,
  deriveRunControls,
  describeOperatorStop,
  describeStopOnBudget,
  intentForControlClick,
  mayPostControl,
  queuedServeTone,
  QUEUED_HALTED_TEXT,
  runAwaitsServe,
  runControlsShouldRender,
  runFailureNoteKind,
  type RunControl,
  type RunControlId,
} from '@/lib/run-controls';
import type { Run } from '@/lib/studio-client';
import { disabledAttrs } from '@/lib/disabled-reason';

async function post(id: RunControlId, initiativeId: string): Promise<{ ok: boolean; error?: string }> {
  if (id === 'resume') return resumeRun(initiativeId);
  if (id === 'requeue') return recoveryRequeue(initiativeId, { resetRetries: true });
  if (id === 'stop') return recoveryStop(initiativeId);
  return recoveryAbandon(initiativeId);
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
};

const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 12px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  color: '#fff',
};

export function RunControls({
  run,
  onActed,
  serveStrip = true,
}: {
  run: Run | null;
  onActed?: (initiativeId: string) => void;
  /**
   * Whether to mount the queued-run serve line for a QUEUED run. A
   * rendering-context switch, not state: the run detail page has no other
   * serve surface and needs it (`flows-23`), while the flow monitor already
   * mounts its own notice directly above this component and would otherwise
   * show two.
   */
  serveStrip?: boolean;
}): JSX.Element | null {
  const controls = deriveRunControls(run);
  const awaitsServe = serveStrip && runAwaitsServe(run);
  const { status: serve } = useServeStatus(awaitsServe);
  const [busy, setBusy] = useState<RunControlId | null>(null);
  const [pendingDestructive, setPendingDestructive] = useState<RunControlId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RunControlId | null>(null);

  // W8-A3 review round 3, S2-5: `done`/`error` must keep the section mounted.
  // A successful Resume flips the run `failed → planned`, which empties
  // `controls`; on the flow monitor (`serveStrip={false}`) that made this
  // return null and threw away the outcome line — the very thing `flows-49`
  // ("make the outcome observable") exists to show. The `key` fix alone could
  // never have covered this: the early return is the other cause.
  if (run === null || !runControlsShouldRender(controls.length, awaitsServe, done, error)) return null;

  const initiativeId = run.initiativeId;
  // W8-A2 (ON-7 defect 2) — see the run-status-line render below.
  const failureNoteKind = runFailureNoteKind(run);

  /**
   * The armed destructive control, DERIVED — so a run that leaves `failed` while
   * the panel is open (a poll tick, a selection change) drops the panel instead
   * of leaving a button that silently does nothing (review round 1, S3-10).
   */
  const armed = armedControl(controls, pendingDestructive);

  /**
   * ARM ONLY. A destructive control's click never posts, on any click, ever —
   * the post lives in `act()` and is reachable solely from `confirm-abandon`.
   *
   * Review round 1, S2-4: the first cut armed and posted from the same function,
   * gated on `pendingDestructive !== control.id`. The arming click set no `busy`,
   * so the button was never disabled, and the confirm panel renders BELOW the
   * rows so the button does not move — a double-click re-entered with the guard
   * already false and abandoned the run, deleting its worktree and branch,
   * without the operator ever seeing the panel. Deterministic, not a race.
   */
  function arm(control: RunControl): void {
    if (busy !== null) return;
    setError(null);
    setDone(null);
    setPendingDestructive(control.id);
  }

  async function act(control: RunControl): Promise<void> {
    if (busy !== null) return;
    // Defence in depth (review round 2 finding 8): the rule that a destructive
    // act needs an arming click lives HERE too, not only in the click handler's
    // ternary below. A future third caller of `act`, or a revert of that
    // ternary, cannot post an unconfirmed Abandon through this function.
    if (!mayPostControl(control, pendingDestructive)) return;
    setBusy(control.id);
    setError(null);
    setDone(null);
    try {
      const r = await post(control.id, initiativeId);
      if (r.ok) {
        setPendingDestructive(null);
        setDone(control.id);
        onActed?.(initiativeId);
      } else {
        // flows-49: the old handler had no else branch at all.
        setError(r.error ?? `${control.label} failed`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      data-section="run-controls"
      data-run-status={run.status}
      data-run-id={run.id}
      data-control-count={controls.length}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 6,
        border: `1px solid ${run.status === 'failed' ? 'rgba(255,80,80,0.28)' : 'var(--line)'}`,
        background: run.status === 'failed' ? 'rgba(255,80,80,0.06)' : 'transparent',
      }}
    >
      {/* W8-A2 (ON-7 defect 2): `runFailureNoteKind` decides "budget" vs
          "fail-note" ONCE (lib/run-controls.ts) so this and RunRail's
          identical rendering can never independently drift on the
          "stopOnBudget wins over failNote" rule. */}
      {run.status === 'failed' && (
        <span
          data-component="run-status-line"
          data-stop-on-budget={failureNoteKind === 'budget' ? 'true' : undefined}
          data-run-stop-reason={failureNoteKind === 'operator-stop' ? 'operator-stop' : undefined}
          style={{ fontSize: 12, color: 'var(--faint)' }}
        >
          {failureNoteKind === 'budget'
            ? describeStopOnBudget(run.stopOnBudget!)
            : failureNoteKind === 'operator-stop'
              ? describeOperatorStop()
              : `Run failed${failureNoteKind === 'fail-note' ? ` — ${run.failNote}` : ''}.`}
        </span>
      )}
      {controls.map((c) => (
        <div key={c.id} style={rowStyle}>
          <button
            data-action={c.action}
            data-run-id={run.id}
            data-initiative-id={initiativeId}
            data-control-intent={intentForControlClick(c)}
            {...disabledAttrs(busy !== null ? `${busy} in progress…` : null)}
            onClick={() => (intentForControlClick(c) === 'arm' ? arm(c) : void act(c))}
            style={{ ...buttonStyle, background: c.destructive ? 'var(--red, #b62324)' : 'var(--ember)', minWidth: 92 }}
          >
            {busy === c.id ? '…' : c.label}
          </button>
          <span data-component="run-control-detail" data-control={c.id} style={{ fontSize: 11.5, color: 'var(--dim)', flex: 1 }}>
            {c.detail}
          </span>
        </div>
      ))}

      {armed !== null && (
        <div
          data-component="abandon-confirm"
          data-run-id={run.id}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--red, #b62324)', borderRadius: 4 }}
        >
          <span style={{ fontSize: 12 }}>
            Abandon <strong>{initiativeId}</strong>? Its worktree and branch are deleted. This cannot be undone.
          </span>
          <button
            data-action="confirm-abandon"
            {...disabledAttrs(busy !== null ? 'Abandoning…' : null)}
            onClick={() => void act(armed)}
            style={{ ...buttonStyle, background: 'var(--red, #b62324)' }}
          >
            Abandon it
          </button>
          <button
            data-action="cancel-abandon"
            onClick={() => setPendingDestructive(null)}
            style={{ fontSize: 12, padding: '3px 12px', background: 'transparent', color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      )}

      {error !== null && (
        <span data-component="run-control-error" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>
      )}

      {/* A resume/requeue is a QUEUE WRITE — the shared outcome line carries
          its own honest serve notice. Abandon and Stop are both terminal for
          THIS act — neither enqueues anything, so neither gets that line. */}
      {done !== null && done !== 'abandon' && done !== 'stop' && (
        <div data-component="run-control-outcome" data-outcome-control={done}>
          <EnqueueOutcomeLine kind="flow" runAction="open-recovered-run" runId={initiativeId} flowId={run.flowId} />
        </div>
      )}
      {done === 'abandon' && (
        <span data-component="run-control-outcome" data-outcome-control="abandon" style={{ fontSize: 12, color: 'var(--faint)' }}>
          Abandoned — the initiative is in failed/ and its worktree and branch are gone.
        </span>
      )}
      {done === 'stop' && (
        <span
          data-component="run-control-outcome"
          data-outcome-control="stop"
          style={{ fontSize: 12, color: 'var(--faint)' }}
        >
          Stop requested — the run halts at its next clean boundary; the worktree and branch are kept.
        </span>
      )}

      {/* flows-23: a QUEUED run's control is `forge serve` claiming it, not a
          run-scoped button. Only a CONFIRMED running serve may promise the
          pickup — a CONFIRMED non-running serve gets the shared notice, and
          an UNCONFIRMED serve (null or unsupervised) gets its own honest
          line rather than the same promise `running` gets. */}
      {awaitsServe && (() => {
        const tone = queuedServeTone(serve);
        if (tone === 'halted') {
          return (
            <span data-component="queued-halted" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
              {QUEUED_HALTED_TEXT}
            </span>
          );
        }
        if (tone === 'running') {
          return (
            <span data-component="queued-awaits-serve" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
              Queued — forge serve will pick it up.
            </span>
          );
        }
        if (tone === 'unknown') {
          return (
            <span data-component="queued-serve-unconfirmed" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
              Queued — could not confirm forge serve is running.
            </span>
          );
        }
        return <ServeStatusNotice status={serve} variant="strip" />;
      })()}
    </section>
  );
}
