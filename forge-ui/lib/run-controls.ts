/**
 * run-controls — what an operator can do to a run, DERIVED from the run's own
 * status on every read.
 *
 * W8-A3 WI-3 (`flows-28`, `flows-49`, `flows-23`). Before this module the flow
 * monitor hard-coded a single "Run failed. [Resume]" bar and the run detail
 * page had no control at all, while `POST /api/recovery/:id/requeue` and
 * `/abandon` sat in the bridge with one consumer (the project roadmap canvas).
 * Two things follow from putting the set here:
 *
 *  1. The monitor and the run page render the SAME controls, because they read
 *     the same derivation rather than each hard-coding a bar.
 *  2. Nothing on a run says which controls it offers, so nothing can go stale.
 *     The status is the whole input.
 *
 * `detail` is not decoration: Resume and Requeue are materially different acts
 * (see each entry), and `flows-49` is exactly the finding that the UI offered
 * them without saying which was which.
 */
import type { Run } from './studio-client';

export type RunControlId = 'resume' | 'requeue' | 'abandon';

export type RunControl = {
  id: RunControlId;
  /** The `data-action` the button carries — the DOM contract the journeys key on. */
  action: string;
  label: string;
  /** What it actually does to the run's worktree, branch and re-entry point. */
  detail: string;
  /** True when the act destroys work; the UI must confirm before posting. */
  destructive: boolean;
};

/** The full action vocabulary, in render order. */
export const RUN_CONTROL_ACTIONS = ['resume-run', 'requeue-run', 'abandon-run'] as const;

const FAILED_CONTROLS: RunControl[] = [
  {
    id: 'resume',
    action: 'resume-run',
    label: 'Resume',
    // `POST /api/runs/:id/resume` → runRequeue(..., { resumeFromDemo: true }).
    detail: 'Re-enters at the demo node against the preserved worktree and branch — completed work items are not rebuilt.',
    destructive: false,
  },
  {
    id: 'requeue',
    action: 'requeue-run',
    label: 'Requeue',
    // `POST /api/recovery/:id/requeue { resetRetries: true }`.
    detail: 'Re-runs the flow from the start on a fresh worktree, and resets the retry count.',
    destructive: false,
  },
  {
    id: 'abandon',
    action: 'abandon-run',
    label: 'Abandon',
    // `POST /api/recovery/:id/abandon`.
    detail: 'Moves the initiative to failed/ and deletes its worktree and branch. This cannot be undone.',
    destructive: true,
  },
];

/** The recovery controls a run offers right now. Only a FAILED run offers any. */
export function deriveRunControls(run: Run | null): RunControl[] {
  if (run === null || run.status !== 'failed') return [];
  return FAILED_CONTROLS;
}

/**
 * True when the run is queued and the SCHEDULER is what will start it —
 * `flows-23`: the operator landing on a queued run's page needs the daemon's
 * state and its Start control, not a run-scoped button that does not exist.
 */
export function runAwaitsScheduler(run: Run | null): boolean {
  return run !== null && run.status === 'planned';
}

/**
 * What a click on a control's OWN button must do.
 *
 * Review round 1, S2-4. The first cut asked "is this control destructive AND not
 * already armed?", which meant the SECOND click on a destructive button posted:
 * the arming click set no busy flag, so the button was never disabled, and the
 * confirmation renders below the row so the button does not move under the
 * cursor. A double-click therefore abandoned a run — deleting its worktree and
 * branch, irreversibly — without the operator ever seeing the panel.
 *
 * The rule is now unconditional: a destructive control's own button ONLY arms,
 * on every click, forever. The post is reachable solely from the confirmation's
 * own button.
 */
export function intentForControlClick(control: RunControl): 'arm' | 'post' {
  return control.destructive ? 'arm' : 'post';
}

/**
 * The armed destructive control, resolved against the controls currently on
 * offer — `null` when the armed id is no longer among them.
 *
 * Review round 1, S3-10: a run that leaves `failed` while the confirmation is
 * open (a poll tick, a rail selection change) used to leave the panel rendered
 * over a button that silently did nothing. Deriving the panel from this means
 * the panel simply goes away with the control.
 */
export function armedControl(controls: RunControl[], armedId: RunControlId | null): RunControl | null {
  if (armedId === null) return null;
  return controls.find((c) => c.id === armedId) ?? null;
}

/**
 * May a POST for `control` proceed, given what is currently armed?
 *
 * Review round 2 finding 8: after round 1 the "never post without a
 * confirmation" rule lived ONLY in the call site's `onClick` ternary — the
 * inverse of the discipline this same change enforces on the enqueue ("the rule
 * lives on the primitive, not on the route"). It lives here now as well, so a
 * third call site of the poster, or a revert of that ternary, cannot abandon a
 * run without the operator having armed it.
 */
export function mayPostControl(control: RunControl, armedId: RunControlId | null): boolean {
  return !control.destructive || armedId === control.id;
}

/**
 * Should the run-controls section render at all?
 *
 * Review round 3, S2-5. The first cut returned `null` whenever the run offered
 * no controls, which is exactly what a SUCCESSFUL resume produces: the run flips
 * `failed → planned`, the control set empties, and on the flow monitor (which
 * mounts its own scheduler strip, so `schedulerStrip` is false there) the whole
 * section unmounted — throwing away the scheduler-aware outcome line that
 * `flows-49` ("make the outcome observable") exists to show. The `key` fix could
 * never have covered that: the early return is a second, independent cause.
 */
export function runControlsShouldRender(
  controlCount: number,
  awaitsScheduler: boolean,
  /** The component's own outcome state, forwarded — NOT a boolean the call site
   *  computed. Review round 4, finding 6: a `hasOutcome: boolean` parameter left
   *  the caller free to pass `false` forever, with every test in the repo green
   *  and the flows-49 outcome line invisible again. Taking the values removes
   *  that failure mode from the call site entirely. */
  done: RunControlId | null,
  error: string | null,
): boolean {
  return controlCount > 0 || awaitsScheduler || done !== null || error !== null;
}
