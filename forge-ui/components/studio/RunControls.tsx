'use client';

/**
 * RunControls — the run's recovery affordances, on every surface that shows a
 * run (W8-A3 WI-3: `flows-28`, `flows-49`, `flows-23`).
 *
 * What it replaces: a hard-coded "Run failed. [Resume]" bar on the flow
 * monitor whose click had no else branch (a failed POST vanished), no
 * disclosure of what Resume does, no observable outcome when the scheduler is
 * stopped — and, on the run DETAIL page, nothing at all.
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
 *  3. Makes the outcome observable. Every one of these is a QUEUE WRITE — the
 *     daemon does the running — so a success mounts the shared, scheduler-aware
 *     `EnqueueOutcomeLine`, which says "the scheduler is stopped, so nothing
 *     will run" and puts Start right there. A failure renders its error rather
 *     than being swallowed. A queued (`planned`) run, which has no run-scoped
 *     control at all, gets the scheduler strip for the same reason.
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
 *     [data-component="scheduler-card"][data-scheduler-variant="strip"]  (queued runs)
 */

import { useState } from 'react';

import { EnqueueOutcomeLine } from '@/components/studio/EnqueueOutcomeLine';
import { SchedulerCard } from '@/components/SchedulerCard';
import { resumeRun, recoveryRequeue, recoveryAbandon } from '@/lib/bridge-client';
import { armedControl, deriveRunControls, intentForControlClick, mayPostControl, runAwaitsScheduler, type RunControl, type RunControlId } from '@/lib/run-controls';
import type { Run } from '@/lib/studio-client';
import { disabledAttrs } from '@/lib/disabled-reason';

async function post(id: RunControlId, initiativeId: string): Promise<{ ok: boolean; error?: string }> {
  if (id === 'resume') return resumeRun(initiativeId);
  if (id === 'requeue') return recoveryRequeue(initiativeId, { resetRetries: true });
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
  schedulerStrip = true,
  queuedCount,
}: {
  run: Run | null;
  onActed?: (initiativeId: string) => void;
  /**
   * The REAL number of queued runs, when the mounting surface knows it. Omitted
   * where it does not: the run detail page reads one run and never the queue.
   *
   * The first cut hard-coded `1` here (review round 1, S3-6) — every run page
   * then stated "1 queued run will not start until the scheduler runs" and
   * `data-scheduler-queued="1"` regardless of the real queue. Round 2 caught the
   * fix swapping that for a fabricated `0`, because `SchedulerCard` defaulted
   * the prop and rendered the attribute unconditionally; the attribute is now
   * OMITTED when nothing read the queue, which is a different claim from zero.
   */
  queuedCount?: number;
  /**
   * Whether to mount the scheduler strip for a QUEUED run. A rendering-context
   * switch, not state: the run detail page has no other scheduler surface and
   * needs it (`flows-23`), while the flow monitor already mounts its own strip
   * directly above this component and would otherwise show two.
   */
  schedulerStrip?: boolean;
}): JSX.Element | null {
  const controls = deriveRunControls(run);
  const awaitsScheduler = schedulerStrip && runAwaitsScheduler(run);
  const [busy, setBusy] = useState<RunControlId | null>(null);
  const [pendingDestructive, setPendingDestructive] = useState<RunControlId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RunControlId | null>(null);

  if (run === null || (controls.length === 0 && !awaitsScheduler)) return null;

  const initiativeId = run.initiativeId;

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
      {run.status === 'failed' && (
        <span data-component="run-status-line" style={{ fontSize: 12, color: 'var(--faint)' }}>
          Run failed{run.failNote ? ` — ${run.failNote}` : ''}.
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

      {/* A resume/requeue is a QUEUE WRITE — say what the scheduler will (or
          will not) do with it, and offer Start when it is stopped. Abandon is
          terminal: it enqueues nothing, so it gets no scheduler line. */}
      {done !== null && done !== 'abandon' && (
        <div data-component="run-control-outcome" data-outcome-control={done}>
          <EnqueueOutcomeLine kind="flow" runAction="open-recovered-run" runId={initiativeId} flowId={run.flowId} />
        </div>
      )}
      {done === 'abandon' && (
        <span data-component="run-control-outcome" data-outcome-control="abandon" style={{ fontSize: 12, color: 'var(--faint)' }}>
          Abandoned — the initiative is in failed/ and its worktree and branch are gone.
        </span>
      )}

      {/* flows-23: a QUEUED run's control is the daemon, not a run-scoped button. */}
      {awaitsScheduler && (
        <SchedulerCard variant="strip" {...(queuedCount !== undefined ? { queuedCount } : {})} />
      )}
    </section>
  );
}
