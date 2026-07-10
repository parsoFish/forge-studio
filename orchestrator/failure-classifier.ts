/**
 * Post-cycle failure classification — `transient | terminal` only.
 *
 * Collapsed from a 14-mode taxonomy on 2026-05-24 (rebuild-review §3 #8).
 * Further slimmed 2026-06-03: removed the 18-boolean intermediary layer;
 * each signature is checked inline and returns directly. Defaults to
 * `terminal` when no signature matches — better to surface an unrecognised
 * failure than to auto-retry into the same hole.
 */

import type { EventLogEntry } from './logging.ts';

export type FailureKind = 'transient' | 'terminal';

export type FailureClassification = {
  kind: FailureKind;
  reason: string;
  /** Convenience: true iff kind === 'transient'. Scheduler reads this. */
  recoverable: boolean;
  /** Up to 5 event_ids whose content drove the classification. */
  evidence_event_ids: string[];
};

const T = (kind: FailureKind, reason: string, evidence: string[]): FailureClassification => ({
  kind, reason, recoverable: kind === 'transient', evidence_event_ids: evidence,
});

// ---------------------------------------------------------------------------
// G3 (plan 2.3, crash-no-identical-retry): pre-retry crash classification.
//
// Evidence (brain/cycles/themes/2026-07-03-unifier-process-crash-before-tools.md
// + 2026-07-04-rate-limit-crash-prereq-failed-cascade.md): the F-44 crash
// retry re-spawned the agent IDENTICALLY — same binary, same spec, same
// context — which repeats the crash when the cause is deterministic (context
// overflow, a crash that already repeated at the same point) and wastes spend.
// `classifyCrash` runs BEFORE each re-spawn:
//   - transient      → environment/API pressure (rate-limit, OOM SIGKILL,
//                       network); a bounded backoff retry is legitimate.
//   - deterministic  → an identical re-spawn provably cannot succeed
//                       (context-length overflow, or the SAME crash repeated
//                       verbatim); stop with a terminal classified event.
//   - unknown        → unrecognised signature; allow ONE bounded retry — if
//                       it crashes identically again the repeat rule promotes
//                       it to deterministic.
// This only stops IDENTICAL futile re-spawns; ADR 012 resume-preserves-work
// is untouched (committed work stays on the branch, crashed UWIs persist as
// re-runnable `pending`).
// ---------------------------------------------------------------------------

export type CrashKind = 'transient' | 'deterministic' | 'unknown';

export type CrashClassification = {
  kind: CrashKind;
  reason: string;
};

/** Environment/API-pressure signatures — a fresh spawn under better conditions can succeed. */
const TRANSIENT_CRASH_SIGNATURES = [
  'rate_limit', 'rate-limit', '429', '529',
  'usage limit', 'hit your limit', 'overloaded',
  'stream-deadline',
  'sigkill', 'signal 9',
  'econnreset', 'etimedout', 'enotfound', 'econnrefused', 'epipe',
  'socket hang up', 'network error', 'fetch failed',
] as const;

/** Deterministic-from-the-first-crash signatures — the same inputs overflow again. */
const DETERMINISTIC_CRASH_SIGNATURES = [
  'prompt is too long', 'context length', 'context_length',
  'maximum context', 'input length and `max_tokens` exceed',
] as const;

export function classifyCrash(message: string, priorMessage: string | null): CrashClassification {
  const blob = message.toLowerCase();
  for (const sig of TRANSIENT_CRASH_SIGNATURES) {
    if (blob.includes(sig)) {
      return { kind: 'transient', reason: `environment/API-pressure crash signature "${sig}" — a backoff retry can succeed` };
    }
  }
  for (const sig of DETERMINISTIC_CRASH_SIGNATURES) {
    if (blob.includes(sig)) {
      return { kind: 'deterministic', reason: `deterministic crash signature "${sig}" — an identical re-spawn crashes at the same point` };
    }
  }
  if (priorMessage !== null && priorMessage === message) {
    return { kind: 'deterministic', reason: 'identical crash repeated at the same point — a further identical re-spawn is futile' };
  }
  return { kind: 'unknown', reason: 'unrecognised crash signature — one bounded retry allowed before the repeat rule applies' };
}

/**
 * G5 (2026-07-10 refinement, brain/cycles/themes/2026-07-04-rate-limit-crash-
 * prereq-failed-cascade.md): a cycle's event log accumulates across
 * scheduler resumes (ADR 019 resume-preserves-work) — a superseded earlier
 * attempt's events stay in the SAME log file the next attempt appends to.
 * Classifying from the FULL history let a stale signal from an
 * already-resolved earlier attempt win the fixed terminal-then-transient
 * priority chain below and mask the CURRENT attempt's real (and often
 * different) failure. Every phase entry point emits exactly one
 * `event_type: 'start'` event, so windowing to "events since the last
 * phase start" cleanly isolates the current attempt without inventing a
 * new data-model concept. Falls back to the full array when no `start`
 * event is present (empty/minimal/legacy logs) so existing behaviour is
 * unchanged for those.
 */
function windowSinceLastPhaseStart(events: readonly EventLogEntry[]): readonly EventLogEntry[] {
  let lastStart = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.event_type === 'start') lastStart = i;
  }
  return lastStart === -1 ? events : events.slice(lastStart);
}

export function classifyCycleFailure(events: readonly EventLogEntry[]): FailureClassification {
  const windowed = windowSinceLastPhaseStart(events);
  const evidence: string[] = [];
  const ev = (e: EventLogEntry): void => { if (evidence.length < 5) evidence.push(e.event_id); };

  // Collect the signals that affect the terminal/transient decision.
  // Each group is only what's needed to resolve the classification below.
  let gateMissingScript = false, worktreeNoDeps = false;
  let baselineRed = false, resumeNeedsRebase = false;
  let pmEmptyDecomposition = false;
  let pmCapped = false, pmBudgetExhausted = false;
  let pmHiddenCoupling = false, pmInvalidWorkItems = false;
  let agentThrew = false, devLoopTotalFailure = false;
  let unifierNoDemo = false, unifierNotPassed = false, reviewFailed = false;
  let uwiLoopCapExhausted = false;
  let rateLimited = false, brainSkipped = false, trivialPass = false;
  let gateErrored = false, gateTimedOut = false;
  let crashDeterministic = false;

  for (const e of windowed) {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    const msg = e.message ?? '';
    const pmErr = e.phase === 'project-manager' && e.event_type === 'error';

    if (msg === 'ralph.end' && md.status === 'failed' && (md.iterations === 0 || md.iterations === undefined) && md.stop_reason === 'quality-gates-pass') { trivialPass = true; ev(e); }
    if (e.event_type === 'error' && (msg.includes('brain-skipped') || msg.includes('brain-first mandate'))) { brainSkipped = true; ev(e); }
    if (e.phase === 'project-manager' && (md.result_subtype === 'error_max_turns' || md.result_subtype === 'error_max_budget_usd')) {
      pmCapped = true;
      if (md.result_subtype === 'error_max_budget_usd') pmBudgetExhausted = true;
      ev(e);
    }
    if (pmErr && Array.isArray(md.hidden_coupling_violations) && md.hidden_coupling_violations.length > 0) { pmHiddenCoupling = true; ev(e); }
    if (pmErr && typeof md.per_item_error_count === 'number' && md.per_item_error_count > 0) { pmInvalidWorkItems = true; ev(e); }
    if (e.phase === 'project-manager' && msg === 'pm.empty-decomposition') { pmEmptyDecomposition = true; ev(e); }
    if (e.phase === 'developer-loop' && msg === 'dev-loop.baseline-red') { baselineRed = true; ev(e); }
    if (msg === 'unifier.failed') { unifierNotPassed = true; ev(e); }
    // G4 (plan item 2.2): the unifier's fix-iteration loop halted after N
    // consecutive failures of the SAME composed-gate sub-check.
    if (msg === 'uwi.loop-cap-exhausted') { uwiLoopCapExhausted = true; ev(e); }
    if (e.phase === 'orchestrator' && msg === 'cycle.resume-needs-rebase') { resumeNeedsRebase = true; ev(e); }
    if (msg === 'gate.fail') {
      const blob = (String(md.gate_stderr_tail ?? '') + ' ' + String(md.gate_stdout_tail ?? '')).toLowerCase();
      if (blob.includes('missing script')) { gateMissingScript = true; ev(e); }
      if (blob.includes('cannot find module') || blob.includes('module not found')) { worktreeNoDeps = true; ev(e); }
    }
    // re-review #1/#5: a gate that could not RUN (missing binary / EACCES /
    // killed) is a BROKEN GATE, not a test or code failure. Distinct terminal
    // so the operator fixes the quality_gate_cmd and the reflector isn't
    // mis-trained into "the code was wrong". Covers per-WI (gate.errored) and
    // unifier (unifier.gate.errored) paths via the gate_errored metadata flag.
    if (md.gate_errored === true || msg === 'gate.errored' || msg === 'unifier.gate.errored') { gateErrored = true; ev(e); }
    // N10 (2026-07 betterado): a gate killed by its TIMEOUT is an ENVIRONMENT
    // failure (machine load / a hung live step), not a work failure and not a
    // broken gate — the work may be complete (security-permissions UWI-6: fix
    // landed and pushed, the compile-heavy judge gate timed out under
    // concurrent-build load and the WI mis-failed). Covers per-WI
    // (gate.timeout) and unifier (unifier.gate.timeout) paths via the
    // gate_timed_out metadata flag.
    if (md.gate_timed_out === true || msg === 'gate.timeout' || msg === 'unifier.gate.timeout') { gateTimedOut = true; ev(e); }
    // G3 (plan 2.3): the dev-loop/unifier gave up on a crash classified as
    // DETERMINISTIC (context overflow / identical crash repeated at the same
    // point). An identical cycle-level retry re-runs the same spawn and
    // crashes again — terminal, operator-visible.
    if (msg === 'dev-loop.crash-deterministic' || msg === 'unifier.crash-deterministic') { crashDeterministic = true; ev(e); }
    if (e.event_type === 'error') {
      const blob = (msg + ' ' + JSON.stringify(md)).toLowerCase();
      // Transient API-pressure signatures: rate limits, usage limits, overload,
      // and the idle-deadline abort (a usage-limit / network stall that would
      // otherwise have hung the stream forever — known-gaps 2026-06-01).
      if (
        blob.includes('rate_limit') ||
        blob.includes('rate-limit') ||
        blob.includes('429') ||
        blob.includes('529') ||
        blob.includes('usage limit') ||
        blob.includes('overloaded') ||
        blob.includes('stream-deadline')
      ) { rateLimited = true; ev(e); }
      if (msg.includes('agent_threw') || md.kind === 'agent_threw') { agentThrew = true; ev(e); }
    }
    if (e.phase === 'orchestrator' && e.event_type === 'error') {
      if (msg.includes('developer-loop') && msg.includes('total failure')) { devLoopTotalFailure = true; ev(e); }
      // F1.I1: distinguish unifier-no-demo from generic reviewer failure.
      // Order matters — check the more specific signature first.
      if (msg.includes('reviewer.pr-open-failed') || msg.includes('DEMO.md') || msg.includes('demo.json') || msg.includes('pr-description.md')) {
        unifierNoDemo = true; ev(e);
      } else if (msg.includes('review') && msg.includes('failed')) {
        reviewFailed = true; ev(e);
      }
    }
  }

  // N10: checked BEFORE the terminal chain — when a gate timed out, the
  // timeout is the CAUSE of any downstream terminal-looking signal
  // (unifier.failed, dev-loop total failure) and a retry under normal load
  // is the correct move. Environment, not work.
  if (gateTimedOut) return T('transient', 'a quality gate timed out (environment failure — machine load / hung step, NOT a work failure; the code may be complete). Auto-retry; raise FORGE_GATE_TIMEOUT_MS if this gate is legitimately slow.', evidence);

  // Terminal first — manifest/env/code defects auto-retry can't fix.
  if (crashDeterministic) return T('terminal', 'agent process crashed DETERMINISTICALLY (context-length overflow, or the identical crash repeated at the same point) — an identical re-spawn cannot succeed. Preserved work stays on the branch (ADR 012); amend the WI spec / shrink the context / fix the environment, then re-queue for a fresh (non-identical) attempt.', evidence);
  if (gateErrored) return T('terminal', 'a quality gate could NOT RUN (missing binary / permission denied / killed by signal) — this is a BROKEN GATE, not a test or code failure. Fix the quality_gate_cmd (is the runner installed? is the binary/path correct? did it OOM?), then re-run. The agent cannot make a non-runnable command pass, so this never "fails because the code was wrong".', evidence);
  if (gateMissingScript) return T('terminal', 'gate referenced a missing npm script', evidence);
  if (worktreeNoDeps) return T('terminal', 'gate failed at module resolution — worktree missing deps', evidence);
  if (baselineRed) return T('terminal', 'project baseline already red at HEAD — the full gate failed before any WI work (pre-existing failure / missing deps / flaky test); fix the baseline, then re-run', evidence);
  if (resumeNeedsRebase) return T('terminal', 'resume blocked — the preserved branch conflicts with current main (another cycle merged during the stall); rebase the initiative branch onto main by hand, then re-resume', evidence);
  if (pmEmptyDecomposition) return T('terminal', 'PM emitted zero work items — the initiative body may have no decomposable ACs or the PM ignored them entirely; amend the initiative body and re-queue', evidence);
  if (pmCapped && (pmHiddenCoupling || pmInvalidWorkItems)) return T('terminal', 'PM hit cap AND produced degenerate WIs — never converged', evidence);
  if (pmBudgetExhausted) return T('terminal', 'PM exhausted its budget cap', evidence);
  if (agentThrew) return T('terminal', 'agent threw a non-rate-limit error', evidence);
  if (devLoopTotalFailure) return T('terminal', 'dev-loop completed 0/N work items', evidence);
  // G4: checked AFTER the N10 timeout-transient rule above — a cap exhausted
  // BY gate timeouts stays an environment failure (the cap already did its
  // job bounding the in-session burn); a cap exhausted by real gate failures
  // is terminal: the agent demonstrably cannot clear this sub-check, so an
  // auto-retry would only re-enter the same loop (the 2026-07-04 16-restart
  // spins).
  if (uwiLoopCapExhausted) return T('terminal', 'unifier fix-loop cap exhausted — the SAME composed-gate sub-check failed the configured number of consecutive times (see the uwi.gate-failed events for which gate + output); the agent cannot clear it autonomously. Fix by hand or send a targeted review UWI, then re-run', evidence);
  if (unifierNoDemo) return T('terminal', 'unifier did not author the PR — DEMO.md / pr-description.md missing because dev-loop WIs failed to produce their declared paths', evidence);
  if (unifierNotPassed) return T('terminal', 'unifier did not pass its composed gate (tests / demo / self-contained PR / branch-sync) — branch not review-ready, PR creation blocked at the delivery gate', evidence);
  if (reviewFailed) return T('terminal', 'reviewer-Ralph failed to converge', evidence);

  // Transient — auto-retry within MAX_AUTO_RETRIES.
  if (rateLimited) return T('transient', 'agent rate-limited / usage-limited / stream stalled (transient API pressure) — auto-retry', evidence);
  if (pmHiddenCoupling) return T('transient', 'PM emitted overlapping WIs (hidden coupling)', evidence);
  if (pmInvalidWorkItems) return T('transient', 'PM emitted schema-invalid WIs', evidence);
  if (brainSkipped) return T('transient', 'agent skipped brain reads', evidence);
  if (trivialPass) return T('transient', 'gate passed before any iteration — F-26 forces ≥1 iteration on retry', evidence);

  return T('terminal', 'failure could not be classified — examine events.jsonl manually', evidence);
}
