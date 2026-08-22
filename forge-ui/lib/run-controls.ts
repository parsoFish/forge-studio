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
