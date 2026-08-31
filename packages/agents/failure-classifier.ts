/**
 * Post-cycle failure classification — `transient | terminal` only.
 *
 * Collapsed from a 14-mode taxonomy on 2026-05-24 (rebuild-review §3 #8).
 * Further slimmed 2026-06-03: removed the 18-boolean intermediary layer;
 * each signature is checked inline and returns directly. Defaults to
 * `terminal` when no signature matches — better to surface an unrecognised
 * failure than to auto-retry into the same hole.
 */

import type { EventLogEntry } from '@forge/kernel';

export type FailureKind = 'transient' | 'terminal';

export type FailureClassification = {
  kind: FailureKind;
  reason: string;
  /** Convenience: true iff kind === 'transient'. Scheduler reads this. */
  recoverable: boolean;
  /**
   * N7 (plan 2.9): true iff the failure is an ENVIRONMENT failure — API
   * pressure / host contention / a hung external step (rate-limit death,
   * gate timeout, parallel-lint lock), never a defect in the work itself.
   * Structured so the requeue-resume decision keys on a flag, not on
   * sniffing reason text. Always a subset of `transient`.
   */
  environment: boolean;
  /** Up to 5 event_ids whose content drove the classification. */
  evidence_event_ids: string[];
};

const T = (
  kind: FailureKind,
  reason: string,
  evidence: string[],
  environment = false,
): FailureClassification => ({
  kind, reason, recoverable: kind === 'transient', environment, evidence_event_ids: evidence,
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
 * G10 (2026-07 refinement, brain/cycles/themes/2026-07-03 + 2026-07-09
 * parallel-golangci-lint themes): golangci-lint holds a file lock; when a
 * concurrent run (another forge worktree, a prior cycle's straggler) holds it,
 * the new invocation exits non-zero with this exact text instead of waiting.
 * That is host contention — an environment failure that self-resolves in
 * minutes — NOT a lint failure in the code.
 *
 * W8-F3: anchored, because a bare `.includes` over `gate_stdout_tail` is the
 * SAME defect class this change closes for the rate-limit rule — captured tool
 * output is project-controlled, so a project whose own test asserts on this
 * string ("expected the wrapper to surface exit 1 when \"parallel golangci-lint
 * is running\" is seen") bought its own deterministic test failure two
 * auto-retries. golangci-lint emits the signature as its OWN error line. All
 * three known real forms carry an error marker — the two in the archived logs
 * ("Error: parallel golangci-lint is running", "…command is terminated due to
 * an error: parallel golangci-lint is running") and the `ERRO`-prefixed form a
 * pinned test carries — so requiring line-start or an `err`/`erro`/`error`
 * prefix keeps every real shape and drops the quoted-in-a-sentence one.
 */
const PARALLEL_LINT_CONTENTION_SIGNATURE =
  /(?:^|\berr(?:o|or)?\b[\s:=-]*)parallel golangci-lint is running/im;

/**
 * N9 (2026-07 refinement, brain/cycles/themes/2026-07-04-rate-limit-crash-
 * prereq-failed-cascade.md): the CLI's rate/usage-limit death surfaces in
 * *reasoning/log* events ("You've hit your limit · resets 12:10am
 * (Australia/Brisbane)") while the crash itself is a generic exit-code-1 —
 * so limit detection cannot be restricted to error events. These are the
 * HIGH-specificity signatures safe to scan across every event type: literal
 * system/API strings that an agent merely *writing rate-limit handling code*
 * won't emit (broad forms like `429` / `rate-limit` stay error-events-only).
 */
const RATE_LIMIT_TEXT_SIGNATURES = [
  'hit your limit', // Claude Code CLI: "You've hit your limit · resets …"
  'usage limit reached', // "Claude AI usage limit reached|resets …"
  'rate_limit_error', // Anthropic API error type
  'overloaded_error', // Anthropic API error type (529)
] as const;

/** True iff `text` carries one of the high-specificity rate/usage-limit
 *  signatures. Shared with the dev-loop (N9) so the signature set that marks
 *  a WI's death "environment" is the same one the classifier keys on. */
export function matchesRateLimitSignature(text: string): boolean {
  const t = text.toLowerCase();
  return RATE_LIMIT_TEXT_SIGNATURES.some((s) => t.includes(s));
}

/**
 * W8-F3 (ON-7 residue): the broad rate-limit vocabulary, scanned over an error
 * event's OWN message only — never over its metadata.
 *
 * The rule this replaces scanned `message + JSON.stringify(metadata)`. An
 * event's metadata is dominated by PROJECT-CONTROLLED payload: the PM error's
 * `hidden_coupling_violations[].sharedFiles` (real repo file paths),
 * `parse_errors` / `set_errors` free text, `gate_stdout_tail` (compiler and
 * linter output), `error` strings carrying git SHAs. Surveying all 354
 * archived cycle logs under `_logs/`, that scan's precision was ZERO: no error
 * event has ever carried a rate-limit token in its own message, and every one
 * of the five metadata hits was a false positive — a `529` inside the source
 * line number `resource_release_definition.go:1529:36`, a `529` inside the git
 * SHA `0529de0a`. One of those cycles still replays to
 * "agent rate-limited" today although its recorded 2026-06 classification was
 * the correct "dev-loop completed 0/N work items".
 */
const RATE_LIMIT_MESSAGE_SIGNATURES = [
  'rate_limit', 'rate-limit', 'usage limit', 'overloaded', 'stream-deadline',
] as const;

/**
 * `429` / `529` preceded by an explicit STATUS MARKER.
 *
 * Bare-substring matching is what made the old scan useless: `:1529:36` is a
 * source line, `0529de0a` is a SHA fragment, `4290` is a byte count. A first
 * cut guarded only digit/dot/colon adjacency, and an adversarial review broke
 * it in BOTH directions: `PR429`, `WI-429`, `issue429` and
 * "golangci-lint reported 429 problems" still matched (a letter is not a
 * digit), while "error 429." and "statusCode:429" no longer did — and losing a
 * genuine detection is the mirror-image defect, a cycle that stops
 * auto-retrying through real API pressure.
 *
 * Requiring a marker (`http…`, `status`/`statusCode`/`status_code`, `error`)
 * immediately before the number keeps every real shape — "HTTP 429",
 * "HTTP/1.1 429", "status: 529", "statusCode:429", "error 429." — and drops
 * every identifier-, count- and line-number shape, because none of those has a
 * status word in front of it.
 */
const HTTP_PRESSURE_STATUS_RE = /(?:\bhttps?[\w/.]*|\bstatus(?:_?code)?|\berror)[\s:=/-]*\b(?:429|529)\b/i;

/** Typed API error kinds. Compared as exact values, never as substrings. */
const RATE_LIMIT_ERROR_TYPES = ['rate_limit_error', 'overloaded_error'] as const;

/**
 * True iff the error's OWN fields signal API pressure: its message, the SDK's
 * typed error kind, or an HTTP status compared as a NUMBER. Project-supplied
 * payload fields are deliberately not read — a repo that happens to contain
 * `internal/provider/rate_limit.go` or `docs/adr/429-quota.md` must not be
 * able to re-label its own deterministic defects as environment failures.
 */
function errorOwnFieldsSignalRateLimit(msg: string, md: Record<string, unknown>): boolean {
  const m = msg.toLowerCase();
  if (RATE_LIMIT_MESSAGE_SIGNATURES.some((s) => m.includes(s))) return true;
  if (HTTP_PRESSURE_STATUS_RE.test(msg)) return true;
  for (const key of ['error_type', 'type', 'api_error_type']) {
    const v = md[key];
    if (typeof v === 'string' && (RATE_LIMIT_ERROR_TYPES as readonly string[]).includes(v.toLowerCase())) return true;
  }
  for (const key of ['status', 'http_status', 'statusCode', 'status_code']) {
    const v = md[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
    if (n === 429 || n === 529) return true;
  }
  return false;
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
  let pmEmptyDecomposition = false, pmPartialUsable = false;
  let pmCapped = false, pmBudgetExhausted = false;
  let pmHiddenCoupling = false, pmInvalidWorkItems = false;
  let agentThrew = false, devLoopTotalFailure = false;
  let unifierNoDemo = false, unifierNotPassed = false, reviewFailed = false;
  // R4-10-F1: the demo + adversarial-review nodes replaced the unifier on the
  // live develop flow; their delivery-gate throws must be diagnosed accurately,
  // not swept into the retired unifier / reviewer-Ralph vocabulary below.
  let demoPipelineFailed = false, adversarialReviewFailed = false;
  let uwiLoopCapExhausted = false;
  let rateLimited = false, brainSkipped = false, trivialPass = false;
  let gateErrored = false, gateTimedOut = false, transientLint = false;
  let crashDeterministic = false;
  // W8-A2 (ON-7 defect 2a): the flow's own budget guard (CostTracker.
  // checkCeiling, flow-budgets.ts) firing. Captured verbatim so the reason
  // string below can quote the flow's own accounting instead of re-deriving
  // it (the message already names the spend, the ceiling, and that the stop
  // was at a clean, resumable phase boundary).
  let costCeilingHit = false, costCeilingMessage = '';

  for (const e of windowed) {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    const msg = e.message ?? '';
    const pmErr = e.phase === 'project-manager' && e.event_type === 'error';

    // CostCeilingError's message (flow-budgets.ts) always starts with this
    // literal prefix. W8-F3: capturing the signal early was never enough —
    // this comment used to claim the branch "never depends on the blob-based
    // rate-limit/agent_threw checks happening to miss it", which was false,
    // because the RETURN below sat under `rateLimited`. The precedence, not
    // the capture, is what decides. It is now in the deterministic block.
    if (e.event_type === 'error' && msg.startsWith('cost-ceiling:')) { costCeilingHit = true; costCeilingMessage = msg; ev(e); }
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
    // Plan 2.11: a capped PM run that still wrote ≥1 valid WI (incremental-
    // write discipline) is partial-but-usable — a distinct, recoverable class.
    if (e.phase === 'project-manager' && msg === 'pm.partial-decomposition' && md.usable === true) { pmPartialUsable = true; ev(e); }
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
    // G10: golangci-lint lock contention in any FAILED gate's captured output —
    // per-WI / code-fix-UWI gates (`gate.fail`, tails), the unifier's composed
    // initiative gate (`unifier.gate.initiative-failed`, stderr tail), and the
    // final CI delivery gate (`cycle.ci-gate` red, output_tail). Passing gate
    // events never set it (a pass that merely echoes the string is not
    // contention that failed anything).
    if (
      e.event_type === 'error' &&
      (msg === 'gate.fail' || msg === 'unifier.gate.initiative-failed' || msg === 'cycle.ci-gate')
    ) {
      const tails = (
        String(md.gate_stderr_tail ?? '') + ' ' +
        String(md.gate_stdout_tail ?? '') + ' ' +
        String(md.output_tail ?? '')
      ).toLowerCase();
      if (PARALLEL_LINT_CONTENTION_SIGNATURE.test(tails)) { transientLint = true; ev(e); }
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
      // Transient API-pressure signatures: rate limits, usage limits, overload,
      // and the idle-deadline abort (a usage-limit / network stall that would
      // otherwise have hung the stream forever — known-gaps 2026-06-01).
      // W8-F3: read the error's OWN fields only — see
      // `errorOwnFieldsSignalRateLimit`.
      if (errorOwnFieldsSignalRateLimit(msg, md)) { rateLimited = true; ev(e); }
      if (msg.includes('agent_threw') || md.kind === 'agent_threw') { agentThrew = true; ev(e); }
    }
    // N9: the CLI's limit death surfaces in reasoning/log events while the
    // crash is a generic exit-code-1 — scan EVERY event type for the
    // high-specificity limit signatures, plus the structured `rate_limited`
    // flag the dev-loop stamps on an environment-failed WI's `ralph.end`.
    if (md.rate_limited === true || matchesRateLimitSignature(msg)) { rateLimited = true; ev(e); }
    if (e.phase === 'orchestrator' && e.event_type === 'error') {
      if (msg.includes('developer-loop') && msg.includes('total failure')) { devLoopTotalFailure = true; ev(e); }
      // R4-10-F1: the successor nodes' delivery-gate throws (flow-runner.ts
      // execDemo/execAdversarialReview) carry these exact prefixes. Match them
      // FIRST — both contain 'review'+'failed' (from "review-ready" / "review
      // pipeline failed") and would otherwise mis-trip the reviewer-Ralph /
      // unifier-no-demo branches for a node that isn't the unifier or reviewer.
      if (msg.includes('delivery gate: demo pipeline failed')) {
        demoPipelineFailed = true; ev(e);
      } else if (msg.includes('adversarial review pipeline failed')) {
        adversarialReviewFailed = true; ev(e);
      // F1.I1: distinguish unifier-no-demo from generic reviewer failure.
      // Order matters — check the more specific signature first.
      } else if (msg.includes('reviewer.pr-open-failed') || msg.includes('DEMO.md') || msg.includes('demo.json') || msg.includes('pr-description.md')) {
        unifierNoDemo = true; ev(e);
      } else if (msg.includes('review') && msg.includes('failed')) {
        reviewFailed = true; ev(e);
      }
    }
  }

  // ---------------------------------------------------------------------
  // W8-F3 (ON-7 residue): DETERMINISTIC verdicts are decided FIRST.
  //
  // The environment-first chain below rests on a sound premise — a rate limit
  // or a gate timeout is the CAUSE of the terminal-looking signals that follow
  // it, so those must not win. But that premise does not hold for failures an
  // identical retry provably cannot fix no matter how good the conditions are:
  // a cost ceiling that has ALREADY been crossed is still crossed on the
  // retry; a crash the crash-classifier proved deterministic re-crashes at the
  // same point; a decomposition defect is re-derived from the same initiative
  // body. For these, "the environment caused it" is not an available
  // explanation, so environment-first buys nothing and costs a full
  // MAX_AUTO_RETRIES of byte-identical failures.
  //
  // This ordering is load-bearing on its own, independent of the narrowed
  // rate-limit detector above: the PM's own thrown message names the file the
  // coupled WIs overlap on ("…share internal/provider/rate_limit.go"), so the
  // token reaches the error's own message legitimately. Narrowing alone would
  // not close it; precedence does.
  //
  // Everything NOT in this block stays where it was. agent_threw, dev-loop
  // total failure, the unifier/review gates and the broken-gate rules can all
  // genuinely be *caused* by API pressure, and their environment-first
  // treatment is correct and pinned.
  // ---------------------------------------------------------------------
  const deterministic = ((): FailureClassification | null => {
    // W8-A2 (ON-7 defect 2a): a CostCeilingError is the flow's OWN budget
    // guard firing at a clean phase boundary (flow-budgets.ts CostTracker.
    // checkCeiling) — never a defect in the work, and the class's own doc
    // comment even calls it "resumable — the operator decides whether to
    // continue or abandon." That "resumable" is about a HUMAN being able to
    // raise the ceiling and re-queue past this exact point; it is NOT license
    // to auto-retry. `recoverable` (kind==='transient') is what
    // `decideAutoRetry` reads to grant an unattended retry, and an unattended
    // retry here would immediately re-spend against a ceiling it already
    // crossed — zero new work, guaranteed repeat, at cost. So this stays
    // `kind: 'terminal'` (recoverable: false) even though it is, in the
    // "an operator could resume this" sense, the least "terminal" terminal
    // failure in this file. Do not "fix" this to transient.
    if (costCeilingHit) return T('terminal', `cost ceiling reached — ${costCeilingMessage} An auto-retry would immediately re-spend against the same already-crossed ceiling with zero new work; continuing is an OPERATOR decision (raise the ceiling and resume from this phase boundary, or abandon), never an unattended scheduler retry.`, evidence);
    // G3 (plan 2.3): `classifyCrash` checks the API-pressure signatures FIRST
    // and returns `transient` for them, so a crash that reaches
    // `deterministic` is by construction NOT rate-limit death — it is context
    // overflow or the identical crash repeated at the same point.
    if (crashDeterministic) return T('terminal', 'agent process crashed DETERMINISTICALLY (context-length overflow, or the identical crash repeated at the same point) — an identical re-spawn cannot succeed. Preserved work stays on the branch (ADR 012); amend the WI spec / shrink the context / fix the environment, then re-queue for a fresh (non-identical) attempt.', evidence);
    // Plan 2.11 carve-out, narrowed by W8-F3: a capped incremental-write run
    // legitimately leaves a TRUNCATED TAIL work item (per-item errors)
    // alongside usable ones, and a cap is stochastic — a fresh pass is a
    // legitimate retry, pinned by "partial-usable beats the capped+degenerate
    // terminal rule" with 2026-07-10 evidence. Hidden coupling is a different
    // animal: it is an overlap between work items the PM actually WROTE,
    // computed deterministically from them. A cap cannot produce it and a
    // fresh pass cannot be expected to avoid it. So partial-usable keeps
    // shielding per-item errors and stops shielding coupling; when it shields,
    // defer to the ordinary chain so the environment-first rules still get
    // their say and the transient reason stays accurate.
    if (pmPartialUsable && !pmHiddenCoupling) return null;
    if (pmEmptyDecomposition) return T('terminal', 'PM emitted zero work items — the initiative body may have no decomposable ACs or the PM ignored them entirely; amend the initiative body and re-queue', evidence);
    if (pmCapped && (pmHiddenCoupling || pmInvalidWorkItems)) return T('terminal', 'PM hit cap AND produced degenerate WIs — never converged', evidence);
    if (pmBudgetExhausted) return T('terminal', 'PM exhausted its budget cap', evidence);
    // W8-A1 (ON-7): a PM decomposition defect is DETERMINISTIC, not transient.
    // The same initiative body, re-decomposed, produces the same overlap and
    // the same schema violation — an auto-retry re-runs the identical failure
    // at the identical cost. INIT-2026-08-14-betterado-gap-registry proved it:
    // three byte-identical runs at ~$2.40 and ~14m each, all three reporting
    // "4 per-item validation errors; 5 hidden-coupling pair(s)", because
    // `transient` bought it the full MAX_AUTO_RETRIES. Terminal ⇒
    // `recoverable: false` ⇒ `decideAutoRetry` grants ZERO retries and the
    // manifest lands in failed/ on the first failure, where an operator can
    // see it.
    if (pmHiddenCoupling) return T('terminal', 'PM emitted overlapping WIs (hidden coupling) — deterministic: the same decomposition re-runs the same violation, so no auto-retry. Fix the decomposition (add the missing depends_on edge, or merge the WIs) and re-dispatch', evidence);
    if (pmInvalidWorkItems) return T('terminal', 'PM emitted schema-invalid WIs — deterministic: the same decomposition re-runs the same validation errors, so no auto-retry. Fix the WI frontmatter (see the per-item errors on the project-manager error event) and re-dispatch', evidence);
    return null;
  })();
  if (deterministic) return deterministic;

  // Environment failures — checked BEFORE the terminal chain: the environment
  // signal is the CAUSE of any downstream terminal-looking signal
  // (agent_threw, unifier.failed, dev-loop total failure) and a retry under
  // normal conditions is the correct move. Environment, not work.
  // N10: gate killed by its timeout.
  if (gateTimedOut) return T('transient', 'a quality gate timed out (environment failure — machine load / hung step, NOT a work failure; the code may be complete). Auto-retry; raise FORGE_GATE_TIMEOUT_MS if this gate is legitimately slow.', evidence, true);
  // G10: golangci-lint lock contention.
  if (transientLint) return T('transient', 'a gate hit golangci-lint lock contention ("parallel golangci-lint is running" — environment failure: a concurrent lint run on this host held the lock, NOT a lint failure in the code). Auto-retry; the lock clears when the other run finishes.', evidence, true);
  // N9: rate/usage-limit death — time-bounded API pressure, never a code
  // defect. Must beat agent_threw + dev-loop-total-failure (the limit caused
  // them) so the manifest goes back to pending instead of failed/ — dependents
  // of this initiative stay QUEUED behind a retrying prerequisite rather than
  // collapsing behind a dead one.
  if (rateLimited) return T('transient', 'agent rate-limited / usage-limited / stream stalled (environment failure — transient API pressure, NOT a work failure) — auto-retry', evidence, true);

  // Terminal first — manifest/env/code defects auto-retry can't fix.
  // W8-A2 (ON-7 defect 2a): a CostCeilingError is the flow's OWN budget
  // guard firing at a clean phase boundary (flow-budgets.ts CostTracker.
  // checkCeiling) — never a defect in the work, and the class's own doc
  // comment even calls it "resumable — the operator decides whether to
  // continue or abandon." That "resumable" is about a HUMAN being able to
  // raise the ceiling and re-queue past this exact point; it is NOT license
  // to auto-retry. `recoverable` (kind==='transient') is what
  // `decideAutoRetry` reads to grant an unattended retry, and an unattended
  // retry here would immediately re-spend against a ceiling it already
  // crossed — zero new work, guaranteed repeat, at cost. So this stays
  // `kind: 'terminal'` (recoverable: false) even though it is, in the
  // "an operator could resume this" sense, the least "terminal" terminal
  // failure in this file. Do not "fix" this to transient.
  if (gateErrored) return T('terminal', 'a quality gate could NOT RUN (missing binary / permission denied / killed by signal) — this is a BROKEN GATE, not a test or code failure. Fix the quality_gate_cmd (is the runner installed? is the binary/path correct? did it OOM?), then re-run. The agent cannot make a non-runnable command pass, so this never "fails because the code was wrong".', evidence);
  if (gateMissingScript) return T('terminal', 'gate referenced a missing npm script', evidence);
  if (worktreeNoDeps) return T('terminal', 'gate failed at module resolution — worktree missing deps', evidence);
  if (baselineRed) return T('terminal', 'project baseline already red at HEAD — the full gate failed before any WI work (pre-existing failure / missing deps / flaky test); fix the baseline, then re-run', evidence);
  if (resumeNeedsRebase) return T('terminal', 'resume blocked — the preserved branch conflicts with current main (another cycle merged during the stall); rebase the initiative branch onto main by hand, then re-resume', evidence);
  // Plan 2.11: partial-but-usable BEATS the empty-decomposition and
  // capped+degenerate terminal rules — an incremental-write run capped
  // mid-flight legitimately leaves a truncated tail WI (per-item errors)
  // alongside usable ones, and the 2026-07-10 evidence shows a re-queue
  // (fresh PM pass with injected context) succeeds. Reached only when the
  // deterministic block above deferred, i.e. when there is no hidden coupling.
  if (pmPartialUsable) return T('transient', 'PM hit its turn/budget cap mid-decomposition but left a partial, USABLE work-item graph (incremental-write discipline held) — the decomposition is viable; auto-retry runs a fresh PM pass. If this recurs, split the initiative or raise its cost budget', evidence);
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
  // R4-10-F1: the successor nodes' own delivery-gate failures — checked before
  // the reviewer-Ralph rule so a demo/adversarial failure reads accurately.
  if (demoPipelineFailed) return T('terminal', 'the demo pipeline failed (author-invalid / capture tooling / scope violation / budget) — the branch is not review-ready and no PR opened; triage the demo-agent failure (see the demo.* error events), then re-run', evidence);
  if (adversarialReviewFailed) return T('terminal', 'the adversarial-review pipeline failed to produce a findings artifact (spawn / scope / budget) — the verdict gate has nothing to render; triage the review-agent failure (see the review.* error events), then re-run', evidence);
  if (reviewFailed) return T('terminal', 'reviewer-Ralph failed to converge', evidence);

  // Transient — auto-retry within MAX_AUTO_RETRIES.
  if (brainSkipped) return T('transient', 'agent skipped brain reads', evidence);
  if (trivialPass) return T('transient', 'gate passed before any iteration — F-26 forces ≥1 iteration on retry', evidence);

  return T('terminal', 'failure could not be classified — examine events.jsonl manually', evidence);
}
