/**
 * verify-cycle-stage-outcome.mjs — did a claimed cycle actually succeed?
 * Bead forge-8vfn.6.10.6; reworked for M7-E row 205.
 *
 * `forge studio` supervises a forever-mode `forge serve` and claims every
 * eligible pending manifest on its own (ADR 011/031) — neither harness
 * driver (`scripts/verify-cycle.mjs`, `scripts/stories/d12-demo-runs.mjs`)
 * spawns `forge serve` itself, so there is no child process whose stdout a
 * classifier can tail. `classifyCycleEventLog` reads the SAME structured
 * record the product itself writes for every cycle — `_logs/<cycleId>/
 * events.jsonl` (`packages/flows/scheduler-run-one.ts` / `cycle.ts`) — and is
 * a pure function of those lines, the same shape (and for the same reason)
 * as `scripts/lib/verify-outcomes.mjs`'s `classifyReflectorProgress`: a
 * predicate only a live, paid run can exercise is a predicate nobody
 * exercises (§15.163).
 *
 * WHY THIS EXISTS. On 2026-09-04 (G1 run 3) a project-manager phase failure
 * wrote `project-manager`/`error` and `orchestrator`/`cycle`/`error` events,
 * and the caller handed off to develop nine seconds later because nothing
 * read them. The initiative went on to merge to a real project on a
 * work-item set its own validation had rejected.
 *
 * Ordering of the predicates matters, mirroring §15.154: a failure marker is
 * decisive whatever else the log carries, and SILENCE IS NOT SUCCESS — a log
 * with no `cycle.end` and no failure marker has demonstrated nothing yet
 * (§15.92); the caller (`scripts/lib/serve-wait.mjs`'s `waitForManifestOutcome`)
 * reads that as "still in progress" and keeps polling until its own deadline.
 */

/** A structured failure the scheduler itself names before any worktree or
 *  cycle exists (`packages/flows/scheduler-run-one.ts`'s `emitOrchestratorEvent`
 *  call sites): `phase: 'orchestrator', skill: 'scheduler', message:
 *  'claim.refused'`, `metadata: { reason, terminal }`. */
function claimRefusedError(e) {
  if (e.phase !== 'orchestrator' || e.skill !== 'scheduler' || e.message !== 'claim.refused') return null;
  const md = e.metadata ?? {};
  const kind = md.terminal === true ? 'terminal' : 'non-terminal';
  return `claim refused (${kind}): ${md.reason ?? '(no reason recorded)'}`;
}

/** The cycle's own terminal-failure marker (`cycle.ts`'s outer try/catch):
 *  `phase: 'orchestrator', skill: 'cycle', event_type: 'error'`, `message`
 *  carrying the thrown error's text verbatim (e.g. "project-manager phase
 *  failed: …"). */
function cycleErrorError(e) {
  if (e.phase !== 'orchestrator' || e.skill !== 'cycle' || e.event_type !== 'error') return null;
  return `cycle ERROR: ${e.message ?? '(no message)'}`;
}

/** The project-manager phase's own failure event (`scheduler-run-one.ts`'s
 *  progress tee prints this as "PM FAILED"): `phase: 'project-manager',
 *  event_type: 'error'`, `metadata: { result_subtype, work_item_count }`. */
function pmFailedError(e) {
  if (e.phase !== 'project-manager' || e.event_type !== 'error') return null;
  const md = e.metadata ?? {};
  return `PM FAILED (subtype=${md.result_subtype ?? '?'}, WIs=${md.work_item_count ?? '?'})`;
}

const FAILURE_CLASSIFIERS = [claimRefusedError, cycleErrorError, pmFailedError];

/**
 * @param {readonly string[]} lines raw JSONL lines from one cycle's
 *   `_logs/<cycleId>/events.jsonl` (or any subset of it); malformed lines are
 *   skipped, matching every other line-scanner in this tree
 * @returns {{ errors: string[], sawEnd: boolean, endStatus: string | null }}
 *   `errors` carries each decisive failure, verbatim, in log order.
 *   `sawEnd` is true once the cycle's own `orchestrator`/`cycle`/`end` event
 *   is observed; `endStatus` is that event's `metadata.status` (e.g.
 *   `'ready-for-review'`, `'merged'`, `'failed'`).
 */
export function classifyCycleEventLog(lines) {
  const errors = [];
  let sawEnd = false;
  let endStatus = null;

  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    let matched = false;
    for (const classify of FAILURE_CLASSIFIERS) {
      const msg = classify(e);
      if (msg !== null) {
        errors.push(msg);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (e.phase === 'orchestrator' && e.skill === 'cycle' && e.event_type === 'end') {
      sawEnd = true;
      endStatus = e.metadata?.status ?? null;
    }
  }

  return { errors, sawEnd, endStatus };
}
