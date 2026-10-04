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
import type { ServeStatus } from './bridge-client';

export type RunControlId = 'resume' | 'requeue' | 'abandon' | 'stop';

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
export const RUN_CONTROL_ACTIONS = ['stop-run', 'resume-run', 'requeue-run', 'abandon-run'] as const;

/**
 * M7 row 150 (bead forge-8vfn.8.1.39, rulings 1771 + 1774) — the ONLY control
 * an active/gated run offers. Non-destructive by construction: it never
 * deletes the worktree or branch (`Abandon` does; `Stop` never does), so it
 * posts on its own click like Resume/Requeue, no arm-then-confirm step.
 */
const RUNNING_CONTROLS: RunControl[] = [
  {
    id: 'stop',
    action: 'stop-run',
    label: 'Stop',
    // `POST /api/recovery/:id/stop`. Active: writes a stop flag the runner
    // consults at its next clean node/work-item boundary (the SAME boundary
    // the cost ceiling already halts at — ADR 028 amendment). Gated: no live
    // agent to signal, so this moves the manifest to failed/ directly.
    detail:
      'Halts at the next clean boundary (or immediately if gated). The worktree and ' +
      'branch are kept — resumable.',
    destructive: false,
  },
];

const FAILED_CONTROLS: RunControl[] = [
  {
    id: 'resume',
    action: 'resume-run',
    label: 'Resume',
    // `POST /api/runs/:id/resume` → runRequeue(..., { resumeFromIntegrate: true }).
    detail: 'Re-enters at the integrate node against the preserved worktree and branch — completed work items are not rebuilt.',
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

/**
 * The recovery controls a run offers right now. A FAILED run offers the
 * destructive/resume set; an ACTIVE or GATED run offers only the
 * non-destructive Stop (M7 row 150, rulings 1771 + 1774). Every other status
 * (planned, complete) offers none.
 */
export function deriveRunControls(run: Run | null): RunControl[] {
  if (run === null) return [];
  if (run.status === 'failed') return FAILED_CONTROLS;
  if (run.status === 'active' || run.status === 'gated') return RUNNING_CONTROLS;
  return [];
}

/**
 * True when the run is queued and `forge serve` claiming it is what starts
 * it — `flows-23`: the operator landing on a queued run's page needs serve's
 * own state, not a run-scoped button that does not exist.
 */
export function runAwaitsServe(run: Run | null): boolean {
  return run !== null && run.status === 'planned';
}

export type QueuedServeTone = 'halted' | 'running' | 'not-running' | 'unknown';

/**
 * MEDIUM-2: the queued-run serve line's three tones. ONLY `running` may
 * promise a pickup (`queued-awaits-serve`) — `unknown` (the read failed, or
 * this bridge has no supervisor at all: the dry bridge, or a second studio
 * attached read-only) must say it could not confirm rather than render the
 * SAME pickup promise `running` does (ADR 031: Studio never claims a run is
 * in progress unless a daemon is alive and claiming it). `not-running` (a
 * CONFIRMED draining/restarting/down) keeps the shared `<ServeStatusNotice>`.
 * Mirrors `describePostCommit`'s own `unknown = serve === null ||
 * serve.state === 'unsupervised'` rule (lib/architect-plan-view.ts).
 */
export function queuedServeTone(serve: ServeStatus | null): QueuedServeTone {
  if (serve !== null && serve.halt !== null) return 'halted';
  if (serve === null || serve.state === 'unsupervised') return 'unknown';
  if (serve.state === 'running') return 'running';
  return 'not-running';
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
 * mounts its own serve notice, so `serveStrip` is false there) the whole
 * section unmounted — throwing away the outcome line that `flows-49` ("make
 * the outcome observable") exists to show. The `key` fix could never have
 * covered that: the early return is a second, independent cause.
 */
export function runControlsShouldRender(
  controlCount: number,
  awaitsServe: boolean,
  /** The component's own outcome state, forwarded — NOT a boolean the call site
   *  computed. Review round 4, finding 6: a `hasOutcome: boolean` parameter left
   *  the caller free to pass `false` forever, with every test in the repo green
   *  and the flows-49 outcome line invisible again. Taking the values removes
   *  that failure mode from the call site entirely. */
  done: RunControlId | null,
  error: string | null,
): boolean {
  return controlCount > 0 || awaitsServe || done !== null || error !== null;
}

/**
 * W8-A2 (ON-7 defect 2) — a cost-ceiling stop is a DIFFERENT terminal
 * outcome from an ordinary crash: the flow hit its budget at a clean,
 * resumable phase boundary with real work already done, not a bare
 * "failed". `RunControls`/`RunRail` must PREFER this over `run.failNote`
 * whenever `run.stopOnBudget` is present — a `failNote` written by the
 * classifier that predates `stopOnBudget` reads a budget stop as an
 * unclassified crash forever (the real 2026-08-18 cycle's STORED failNote
 * still says "failure could not be classified — examine events.jsonl
 * manually", since it was written once and never re-derived). ONE copy
 * function so the flow monitor and the run detail page can never say this
 * two different ways.
 */
export function describeStopOnBudget(stop: NonNullable<Run['stopOnBudget']>): string {
  const boundary = stop.stoppedBeforeNode ? `, resumable before ${stop.stoppedBeforeNode}` : ', resumable';
  return `Stopped on budget — $${stop.spentUsd.toFixed(2)} of $${stop.ceilingUsd.toFixed(2)} spent, ${stop.completedWorkItems} of ${stop.totalWorkItems} work items complete${boundary}.`;
}

/** M7 row 150 (ruling 1774) — `describeStopOnBudget`'s sibling: the ONE copy
 *  for an operator-requested stop, so RunControls and RunRail can't drift. */
export function describeOperatorStop(): string {
  return 'Stopped by the operator — resumable; the worktree and branch are kept.';
}

/**
 * W8-A2 (ON-7 defect 2) — the ONE decision `RunControls` and `RunRail` both
 * route through for "which failure note, if any" — so the "stopOnBudget
 * wins over failNote" rule lives in exactly one place instead of two
 * independently-written ternaries that could drift. Only a 'failed' run
 * renders either; every other status renders neither (unchanged from
 * today, where both components already gate on `run.status === 'failed'`
 * before looking at `failNote`).
 *
 * M7 row 150 (ruling 1774): `operatorStop` is a THIRD kind, same priority
 * band as `stopOnBudget` (a clean, resumable, non-crash halt) — checked
 * after budget (mutually exclusive in practice: whichever boundary check
 * threw first is the one that ran) and before the generic fail-note.
 */
export function runFailureNoteKind(
  run: Pick<Run, 'status' | 'stopOnBudget' | 'operatorStop' | 'failNote'>,
): 'budget' | 'operator-stop' | 'fail-note' | null {
  if (run.status !== 'failed') return null;
  if (run.stopOnBudget) return 'budget';
  if (run.operatorStop) return 'operator-stop';
  if (run.failNote) return 'fail-note';
  return null;
}
