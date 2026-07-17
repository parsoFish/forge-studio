/**
 * Developer-loop phase runner. Extracted from cycle.ts (Phase 3.4c step 4).
 *
 * Walks the work items in topological order, running a Ralph loop per WI and
 * skipping dependents of failed prerequisites. Behaviour is identical to the
 * prior in-cycle implementation — this module only relocates the code so the
 * orchestration spine stays thin.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pinnedSdkQuery as sdkQuery } from '../pinned-sdk-query.ts';

import type { EventLogger } from '../logging.ts';
import { classifyCrash } from '../failure-classifier.ts';
import {
  DEV_ALLOWED_TOOLS,
  DEV_DISALLOWED_TOOLS,
  DEV_MODEL,
  devAgentSpec,
  buildDevSystemPrompt,
  prepareDevWorkspace,
  tallyToolUse as tallyDevToolUse,
  type DevToolUseSummary,
} from '../dev-invocation.ts';
import {
  gateRequiredPaths,
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItemStatus,
  type WorkItem,
} from '../work-item.ts';
import { type QueryFn, type ClaudeAgentOptions } from '../../loops/ralph/claude-agent.ts';
import { getAdapter, resolveSdkId } from '../../loops/_adapters/registry.ts';
import type { AgentInvocation } from '../../loops/_adapters/types.ts';
import { DEMO_JSON_BASENAME, worktreeDemoRelDir } from '../demo-paths.ts';
import { checkDemoFanInHonesty } from './demo-fanin-honesty.ts';
import { makeToolEventSink } from '../tool-event-emit.ts';
import { run as runRalph, type LoopResult } from '../../loops/ralph/runner.ts';
import { matchesRateLimitSignature } from '../failure-classifier.ts';
import { createWiWorktree, removeWiWorktree } from '../wi-worktree.ts';
import { createMergeQueue, mergeAndPublish, type MergeConflictDetail } from '../wi-merge-back.ts';
import { makeQualityGateFromCmd, resolveGateTimeoutMs, type GateRunInfo } from '../../loops/ralph/stop-conditions.ts';
import { assertLocalRemoteSynced, checkLocalRemoteSynced, pushInitiativeBranch, type PushResult } from '../pr.ts';
import {
  buildUnifierSystemPrompt,
  prepareUnifierWorkspace,
  UNIFIER_DEFAULT_ITERATION_CAP,
  unifierAgentSpec,
} from '../unifier-invocation.ts';
import {
  pendingUnifierItems,
  seedStaticUnifierItem,
  unifierItemsDir,
} from '../unifier-items.ts';
import { modelForSpec } from '../phase-agent.ts';
import {
  resolveUnifierGateFailureCap,
  resolveDevWiConcurrency,
  ralphGitIdentity,
  UNIFIER_GIT_IDENTITY,
  type GitIdentity,
} from '../config.ts';
import { runConcurrentDispatch, type DispatchOutcome } from '../wi-dispatch-scheduler.ts';
import { loadProjectConfig, type AcceptanceGateConfig, type ProjectConfig } from '../project-config.ts';
import { validateDemoModel, coerceDemoModel } from '../../cli/demo-model.ts';
import {
  buildDemoCaptureArgv,
  CAPTURE_NONCE_ENV,
  commitOrchestratedCaptureArtifacts,
  demoJsonWantsCapture,
  generateCaptureNonce,
  preflightDemoCaptureCommands,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
} from './orchestrated-capture.ts';
import type { CycleInput } from '../cycle-context.ts';

/**
 * Wipe the Ralph scratch files (PROMPT.md / AGENT.md / fix_plan.md) so the
 * next sub-phase doesn't inherit stale state. Inlined here after the
 * reviewer-invocation.ts deletion (S4).
 */
function wipeRalphScratch(worktreePath: string): void {
  for (const f of ['PROMPT.md', 'AGENT.md', 'fix_plan.md']) {
    const p = join(worktreePath, f);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Defaults for the live Ralph loop. Per CONTRACTS.md C19, the per-WI $1.0 USD
 * cap that previously lived here has been REMOVED — iteration cap is the
 * only bound on the dev-loop. Cost is still logged per event for telemetry,
 * but no $-threshold gate exists. The per-iteration turn cap stays as a
 * runtime safety bound (not a budget).
 */
const DEV_LIVE_DEFAULT_ITERATIONS_PER_WI = 5;
// Per-iteration tool-call cap — a SAFETY BACKSTOP, not the working bound.
//
// The SDK counts every tool call as one "turn" regardless of cost, so a flat
// cap penalises a cheap Grep/Read exactly like an expensive generation
// (Write/Edit) — which is wrong: a from-scratch WI legitimately needs to
// explore a lot (the SDK type, a reference resource, helpers) BEFORE it writes.
// At 25 the agent exhausted the cap on exploration and the turn ended before it
// ever wrote a file (release_folder, 2026-06-02: 55 greps + 13 reads + 0
// writes/run); at 50 it converged in one iteration. The general fix (operator
// steer 2026-06-02): don't let cheap exploration eat the budget meant for
// impactful work. Since the SDK can't reweight its own turn counter, make the
// cap a HIGH backstop so exploration never prematurely ends an iteration, and
// let the TOKEN-WEIGHTED cost bound (the WI's cost_budget_usd) be the real
// limit — generation costs far more tokens than a grep, so cost already counts
// "impactful" work and treats cheap turns as nearly free. iteration_budget +
// cost_budget remain the spend bounds; the idle-deadline (stream-deadline.ts)
// still aborts a genuine no-output stall.
const DEV_LIVE_MAX_TURNS_PER_ITERATION = 120;

// F-44: the Claude Code agent subprocess intermittently dies on spawn
// ("Claude Code process exited with code 1", iterations:0, stop_reason
// crashed → runner_error.kind 'agent_threw'). Observed across betterado +
// trafficgame: most WIs succeed, but a flaky crash on a *prerequisite* WI
// (e.g. betterado-03 WI-1) fails the whole initiative non-recoverably and
// stalls every dependent. A 0-iteration subprocess crash is a transient
// infra fault, NOT a quality signal — so retry it a bounded number of
// times with a short backoff. A genuine quality-gate failure returns a
// `result` (status 'failed') and is NOT retried here (that path must stay
// honest — don't mask real failures). Persistent crashes exhaust the
// retries and fail exactly as before.
const DEV_AGENT_CRASH_MAX_RETRIES = 2;
const DEV_AGENT_CRASH_BACKOFF_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Phase 4 step 7: a WI's fan-in merge conflict is not immediately terminal —
// a sibling that merged concurrently (or a stale start point) can make a
// SECOND attempt against the fresh cycle-branch tip succeed cleanly. Bounded
// to ONE retry (two attempts total): a second conflict for the same WI is a
// real, persistent conflict — not a race — and stays terminal exactly like
// the un-bounded step-5 behavior.
const DEV_WI_MERGE_CONFLICT_MAX_RETRIES = 1;

/**
 * Adapt an EventLogger into the `resolveSdkId` log callback (ADR 029). When a
 * SKILL.md declares a `runtime.sdk` that is not available (unregistered, or
 * registered-but-available:false in this environment), `resolveSdkId` falls
 * back to `claude` AND fires this callback so the fallback is observable in the
 * event log instead of being a silent downgrade.
 */
function sdkFallbackEventSink(
  logger: EventLogger,
  initiativeId: string,
  phase: 'developer-loop' | 'unifier',
  skill: string,
): (event: { type: string; sdk?: string }) => void {
  return (event) => {
    logger.emit({
      initiative_id: initiativeId,
      phase,
      skill,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: event.type,
      metadata: { requested_sdk: event.sdk ?? null, resolved_sdk: 'claude' },
    });
  };
}

/**
 * G8 wave 2 (2026-07-12) — resolve which git identity a `makeAgentWithTelemetry`
 * call's agent commits should carry. The phase alone discriminates: the
 * per-WI dev-loop call site (`phase: 'developer-loop'`) always sets
 * `workItemId`; both unifier item roles (packaging — no workItemId — and
 * code-fix — has a UWI workItemId) share the SAME flat unifier identity, so
 * `workItemId` presence is NOT the discriminator for the unifier phase.
 *
 * Exported for direct unit testing (no SDK, no git) — same pattern as
 * `assertNonEmptyDelivery` in cycle-helpers.ts.
 */
export function resolveGitIdentity(sinkCtx: { phase: 'developer-loop' | 'unifier'; workItemId?: string }): GitIdentity {
  if (sinkCtx.phase === 'unifier') return UNIFIER_GIT_IDENTITY;
  if (!sinkCtx.workItemId) {
    throw new Error('resolveGitIdentity: developer-loop phase requires a workItemId');
  }
  return ralphGitIdentity(sinkCtx.workItemId);
}

/**
 * Change C — shared factory for tool-event-sink + Claude agent pairs.
 *
 * Both the per-WI dev-loop and the unifier follow the identical pattern:
 *   1. build a `makeToolEventSink` for live telemetry
 *   2. build the agent via the runtime adapter (`getAdapter(sdkId).createAgent`)
 *      with `onToolUse` + `onHeartbeat` wired in
 *
 * This helper collapses that duplication. The caller supplies the logger +
 * context (phase/skill/workItemId) for the sink and the agent-specific
 * options (model, tools, systemPrompt, …). The returned `{ agent, toolSink }`
 * carry exactly the same objects the inline code produced before.
 *
 * Behavior-preserving: the sink and agent options are forwarded unchanged;
 * net effect is fewer lines at each call site.
 *
 * Change B — `onUsageDelta` is wired inside so every agent emits per-turn
 * token-usage log events. The callback emits a `log` event with
 * `usage_delta` message carrying raw token counts (no pricing table —
 * the authoritative `cost_usd` continues to come from the iteration `result`
 * event; this is additive mid-turn granularity only).
 */
function makeAgentWithTelemetry(
  logger: EventLogger,
  sinkCtx: {
    initiativeId: string;
    parentEventId: string;
    phase: 'developer-loop' | 'unifier';
    skill: string;
    workItemId?: string;
  },
  agentOpts: Omit<ClaudeAgentOptions, 'onToolUse' | 'onHeartbeat' | 'onUsageDelta' | 'onReasoning'>,
  // Runtime selection (ADR-029). Now threaded from the SKILL.md runtime.sdk via
  // the phase agent spec (devAgentSpec/unifierAgentSpec), resolved through
  // resolveSdkId at the caller so a free-text/unavailable id falls back to
  // 'claude' (logged). The 'claude' default here is the safe fallback for any
  // future call site that does not yet thread an sdk; the conformance suite is
  // the admission gate for any non-claude adapter.
  sdkId = 'claude',
  // Studio observability sub-gap #2 — when provided, fired for each non-empty
  // assistant text block. Only wired for dev-loop per-WI agents (not unifier).
  onReasoning?: (text: string) => void,
): { agent: AgentInvocation; toolSink: ReturnType<typeof makeToolEventSink> } {
  const toolSink = makeToolEventSink(logger, {
    initiativeId: sinkCtx.initiativeId,
    parentEventId: sinkCtx.parentEventId,
    phase: sinkCtx.phase,
    skill: sinkCtx.skill,
    workItemId: sinkCtx.workItemId,
  });

  const agent = getAdapter(sdkId).createAgent({
    ...agentOpts,
    gitIdentity: resolveGitIdentity(sinkCtx),
    onToolUse: toolSink.onToolUse,
    onHeartbeat: toolSink.onHeartbeat,
    ...(onReasoning !== undefined ? { onReasoning } : {}),
    onUsageDelta: (u) => {
      // Change B: emit per-turn token deltas as a lightweight log event so
      // the operator UI and future tooling can track mid-iteration usage.
      // No USD cost is derived here (no pricing table exists in the codebase).
      // The authoritative cost_usd comes from the iteration end event.
      try {
        logger.emit({
          initiative_id: sinkCtx.initiativeId,
          parent_event_id: sinkCtx.parentEventId,
          phase: sinkCtx.phase,
          skill: sinkCtx.skill,
          event_type: 'log',
          input_refs: [],
          output_refs: [],
          message: 'usage_delta',
          metadata: {
            ...(sinkCtx.workItemId ? { work_item_id: sinkCtx.workItemId } : {}),
            input_tokens: u.inputTokens,
            output_tokens: u.outputTokens,
            cache_read_tokens: u.cacheReadTokens,
            cache_creation_tokens: u.cacheCreationTokens,
          },
        });
      } catch {
        /* never let a failing emit break the outer agent loop */
      }
    },
  });

  return { agent, toolSink };
}

export async function runDeveloperLoop(
  input: CycleInput,
  logger: EventLogger,
  // best-effort wedge abort; not yet chained into per-WI Ralph instances
  // (each Ralph creates its own abortController in claude-agent.ts — a clean
  // chain requires ClaudeAgentOptions to accept an external signal, deferred).
  _signal?: AbortSignal,
): Promise<void> {
  const workItemsDir = resolve(input.worktreePath, '.forge/work-items');
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'start',
    input_refs: [workItemsDir],
    output_refs: [],
    metadata: {
      // ADR 024 seam observability: the agent + tier the orchestrator spawned.
      agent_skill: devAgentSpec.skill,
      agent_tier: devAgentSpec.tier,
      model: DEV_MODEL,
    },
  });

  const { items, parseErrors } = readWorkItemsFromDir(workItemsDir);
  if (Object.keys(parseErrors).length > 0) {
    throw new Error(
      `developer-loop: parse errors: ${Object.entries(parseErrors).map(([f, e]) => `${f}: ${e}`).join('; ')}`,
    );
  }
  if (items.length === 0) {
    throw new Error(`developer-loop: no work items found at ${workItemsDir}`);
  }
  const { setErrors } = validateWorkItemSet(items);
  if (setErrors.length > 0) {
    throw new Error(`developer-loop: invalid WI set: ${setErrors.join('; ')}`);
  }

  const ordered = topologicalOrder(items);
  // ADR 019: resume-from-unifier skips the per-WI dev-loop entirely — the WI
  // commits already exist on the preserved branch from the prior cycle. We
  // still read + validate the WI set above (the unifier uses it for context),
  // but run the per-WI loop over an empty list so only the unifier executes.
  const resumeFromUnifier = input.resumeFrom === 'unifier';
  const toRun = resumeFromUnifier ? [] : ordered;

  // cascade-v4 #2: establish a known-green baseline ONCE before any WI work.
  // On a fresh (non-resume) dev-loop the worktree sits at the initiative
  // branch's base (== main's HEAD) before any WI commit, so the project-level
  // gate here measures the *baseline*. A pre-existing red suite (or missing
  // deps / a gitignored fixture) is otherwise invisible until the unifier,
  // which then can't tell "my changes broke it" from "it was already broken"
  // and burns its whole budget. Fail fast with a distinct diagnosis instead.
  // Skipped on resume (the branch already carries the WI commits — not a baseline).
  if (!resumeFromUnifier) {
    assertGreenBaseline(input, logger, start.event_id);
  }

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const systemPrompt = buildDevSystemPrompt(forgeRoot);
  const sdkQueryFn = sdkQuery as unknown as QueryFn;

  // ADR 029: resolve the dev agent's runtime sdk ONCE (the SKILL.md
  // `runtime.sdk`, threaded via devAgentSpec). resolveSdkId gates a free-text /
  // unavailable id back to 'claude' and logs `sdk.unavailable-fallback` so the
  // downgrade is observable rather than silent. Stock SKILL.md → 'claude'.
  const DEV_SDK_ID = resolveSdkId(
    devAgentSpec.sdk,
    sdkFallbackEventSink(logger, input.initiativeId, 'developer-loop', 'developer-ralph'),
  );

  // Live-acc env guard (2026-06-06): when the project declares an
  // `acceptance_gate` with `requires_env`, a WI whose gate targets the acc
  // suite must run with those vars set — else the runner SKIPS and the gate
  // false-passes (the daemon ran betterado cycles without TF_ACC and shipped
  // unverified resources). Load the config once; absent ⇒ no env requirement.
  // R5-02 F2: same load also yields the project's declared `ci_gate_unset_env`
  // (e.g. `["TF_ACC"]`) — env vars to strip from every per-WI gate child so an
  // operator's shell (or a sibling live-acc cycle) exporting TF_ACC=1 can't
  // silently run the live-acceptance suite on a docs-only cycle.
  let accGate: AcceptanceGateConfig | undefined;
  let ciGateUnsetEnv: string[] | undefined;
  try {
    const projectCfg = loadProjectConfig(input.worktreePath);
    accGate = projectCfg?.acceptance_gate;
    ciGateUnsetEnv = projectCfg?.ci_gate_unset_env;
  } catch {
    /* best-effort — a malformed config is fail-closed by the baseline gate */
  }

  // N9: `environment` marks a WI that died for an environment reason (rate-
  // limit hit) — its dependents are left queued, not cascaded to failed.
  //
  // Step 3 (2026-07-10 false-total-failure race): outcomes settle into a Map
  // keyed by work_item_id instead of a push-array. Every WI that enters the
  // loop below — success, skip-for-prerequisite, or early-exit skip — must
  // settle EXACTLY ONCE via `settleWiOutcome` (hard-throws on a double-settle
  // for the same id). `assertOutcomesSettled`, run before any complete/failed
  // count is derived, hard-throws if the map is a partial snapshot of the WIs
  // actually run — a partial-snapshot read as "N failed" was the false-total-
  // failure race; it is now structurally impossible.
  const wiOutcomes = new Map<string, WiOutcome>();

  // Phase 4 step 5: each WI runs in its own sibling worktree
  // (`wi-worktree.ts`), and the fan-in point back into the cycle worktree —
  // `git merge --no-ff` — is single-flight through this ONE shared queue
  // instance, even though step 6 now dispatches WIs concurrently: only one
  // merge may ever touch the cycle worktree's working tree at a time.
  const worktreesRoot = dirname(input.worktreePath);
  const mergeQueue = createMergeQueue();

  // Phase 4 step 7: how many times EACH WI has hit a fan-in merge conflict
  // so far, keyed by work_item_id. `runWiDispatchTask` reads this at the top
  // of its merge-decision to tell a retry apart from a first attempt — a
  // fresh top-level call from the scheduler (after a `{ requeue: true }`
  // resolution) has no other way to know it's attempt 2. Never reset; a WI
  // id is dispatched at most `DEV_WI_MERGE_CONFLICT_MAX_RETRIES + 1` times
  // in one dev-loop run.
  const mergeConflictAttempts = new Map<string, number>();
  // Conflict-context injection: the STRUCTURED detail from a WI's fan-in
  // conflict, keyed by work_item_id, set only when that conflict is about to
  // requeue (never for a terminal second conflict — there is no further
  // attempt to inject it into). Consumed exactly once, at the top of the
  // SAME WI's requeued dispatch, to seed its fresh worktree's
  // `.forge/last-gate-failure.md` via `writeMergeConflictFeedback`.
  const mergeConflictDetails = new Map<string, MergeConflictDetail>();

  // Phase 4 step 6: the branch-push-failure early exit (see the end of
  // `runWiDispatchTask` below) used to be a synchronous `break` out of the
  // serial for-loop plus a dedicated tail loop marking every remaining WI
  // failed. Under concurrent dispatch there is no single tail loop to run —
  // instead this flag is checked at the TOP of every dispatch (before
  // `runWiDispatchTask` even starts, so no `ralph.start` event fires for a
  // WI that never got a chance to run), and every WI that becomes ready
  // after the flag flips gets the exact same 'branch-push-failed-early-exit'
  // skip treatment the old tail loop gave it — just applied lazily, one WI
  // at a time, as the scheduler would have dispatched it anyway. At
  // `cap: 1` this reproduces the old code's event sequence byte-for-byte
  // (see wi-dispatch-scheduler.test.ts's cap-1 equivalence coverage).
  //
  // NOT fully equivalent at `cap > 1`, though: a WI that is already in
  // flight when a sibling's push sets this flag runs to completion —
  // including its OWN merge and push — rather than being retroactively
  // skipped. At `cap: 1` nothing can be "already in flight" when the flag
  // flips (strictly serial dispatch), so this edge case is structurally
  // impossible there; under real concurrency it is possible for an in-flight
  // sibling to still land a successful push after a peer's push already
  // failed. Not unsafe (each WI's own merge/push is still correct in
  // isolation), just a real behavioral difference from cap 1 that a full
  // WI-level cancellation (this file's top-of-function AbortSignal note)
  // would close.
  const pushFailedRef = { current: false };

  /**
   * Run ONE work item's full dev-loop turn: prerequisite check, isolated
   * worktree + Ralph loop, fan-in merge, push, and outcome settlement.
   * Mechanically unchanged from the pre-step-6 serial for-loop body — the
   * only behavioral difference is that a branch-push failure now sets
   * `pushFailedRef.current` instead of directly marking every subsequent
   * `ordered` WI failed (the dispatch wrapper passed to
   * `runConcurrentDispatch`, below, does that lazily per-WI so it works
   * under concurrency too).
   */
  async function runWiDispatchTask(wi: WorkItem): Promise<DispatchOutcome> {
    const wiStart = logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'log',
      input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
      output_refs: [],
      message: 'ralph.start',
      metadata: { work_item_id: wi.work_item_id },
    });
    // M5: bracket this WI's net git contribution so we can emit a PER-WI
    // delivered summary at its end (vs the one cycle-level aggregate).
    const wiBaseSha = gitHeadSha(input.worktreePath);

    const blockage = prerequisiteBlockage(wi, [...wiOutcomes.values()]);
    if (blockage === 'work-failure') {
      writeWorkItemStatus(resolve(workItemsDir, `${wi.work_item_id}.md`), 'failed');
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
        output_refs: [],
        message: 'ralph.skipped',
        metadata: { work_item_id: wi.work_item_id, reason: 'prerequisite-failed' },
      });
      settleWiOutcome(wiOutcomes, { id: wi.work_item_id, status: 'failed', result: null });
      return { requeue: false };
    }
    if (blockage === 'environment-failure') {
      // N9: the prerequisite died for an ENVIRONMENT reason (rate-limit) — this
      // WI was never attempted and nothing about it is wrong. Leave its status
      // file `pending` (queued for the transient auto-retry) instead of
      // cascading `failed`/`prerequisite-failed` through the whole wave.
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
        output_refs: [],
        message: 'ralph.skipped',
        metadata: {
          work_item_id: wi.work_item_id,
          reason: 'prerequisite-environment-failure',
          failure_kind: 'environment',
        },
      });
      settleWiOutcome(wiOutcomes, { id: wi.work_item_id, status: 'pending', result: null, environment: true });
      return { requeue: false };
    }

    const specPath = resolve(workItemsDir, `${wi.work_item_id}.md`);
    const wiToolUse: DevToolUseSummary = { reads: 0, brainReads: 0, writes: 0, bashCalls: 0, testRuns: 0 };

    // Phase 4 step 5: this WI runs in its OWN sibling worktree/branch, cut
    // from the cycle branch's tip AT DISPATCH (wiBaseSha, captured above
    // before this WI's blockage check) — never from a moving HEAD. Status
    // truth (writeWorkItemStatus below) still targets the CYCLE worktree's
    // spec path; only the ralph run itself is isolated.
    const wiWorktree = createWiWorktree({
      projectRepoPath: input.projectRepoPath,
      worktreesRoot,
      initiativeId: input.initiativeId,
      workItemId: wi.work_item_id,
      startPointRef: wiBaseSha,
      cycleWorktreePath: input.worktreePath,
    });

    // Conflict-context injection: this dispatch is a requeued attempt iff a
    // PRIOR attempt for this same WI id already conflicted (the map is only
    // ever populated on the requeue path below). Written into the fresh
    // worktree BEFORE ralph runs. Note the runner's iteration 0 is NOT the
    // agent's first turn — it is the sharp-gate pre-check, which runs the
    // REAL quality gate and reports through `writeGateFeedback`; that
    // writer's iteration-0 append contract preserves this note (gate detail
    // appended beneath it), so the agent's actual first turn (runner
    // iteration 1) — which the dev system prompt mandates opens by reading
    // `.forge/last-gate-failure.md` — still sees the conflict context first.
    // Consumed exactly once: the entry is deleted here so the map never
    // leaks settled WIs (a second conflict is terminal and never re-reads it).
    const priorMergeConflict = mergeConflictDetails.get(wi.work_item_id);
    if (priorMergeConflict) {
      mergeConflictDetails.delete(wi.work_item_id);
      writeMergeConflictFeedback(
        wiWorktree.path,
        mergeConflictAttempts.get(wi.work_item_id) ?? 1,
        priorMergeConflict,
      );
    }

    // Outcome-shaping state, threaded out of the try block below so the
    // finally can clean up the worktree unconditionally (success, ralph
    // failure, or merge conflict all reach it) while the settle/skip logic
    // after the finally still sees the resolved status.
    let finalStatus: WorkItem['status'] = 'failed';
    let mergeConflict = false;
    let environmentFailure = false;
    let wiDelta: { files: number; insertions: number; deletions: number; commits: number } = {
      files: 0,
      insertions: 0,
      deletions: 0,
      commits: 0,
    };
    let pushResult: PushResult | null = null;
    // Phase 4 step 7: set inside the try block below when this attempt hits
    // a fan-in conflict that hasn't exhausted its retry yet — threaded out
    // here (same reasoning as the rest of this block) so the settle/return
    // logic after the `finally` can see it.
    let requeueForMergeConflict = false;

    try {
    // F-40: wipe AGENT.md / fix_plan.md / PROMPT.md between WIs. The dev-loop
    // runs N WIs sequentially against the same worktree; without this, WI-2's
    // agent inherits WI-1's institutional memory and ticked-off fix_plan,
    // looks at the satisfied checklist, and exits immediately with "all ACs
    // verified" — never reading its own WI.md. Reviewer already calls
    // wipeRalphScratch for the same reason (different role, different state);
    // the dev-loop needs the same treatment per WI. Diagnosed from the
    // 2026-05-10T21:32 cycle where WI-2..7 had 0 writes each because the
    // agent read WI-1.md, not WI-2.md. (Step 5: now scoped to the per-WI
    // worktree, which is freshly created per WI anyway — kept for safety.)
    wipeRalphScratch(wiWorktree.path);

    prepareDevWorkspace({
      initiativeId: input.initiativeId,
      workItemSpecPath: specPath,
      workItemSpecRelPath: `.forge/work-items/${wi.work_item_id}.md`,
      worktreePath: wiWorktree.path,
      iterationBudget: wi.estimated_iterations > 0
        ? Math.max(wi.estimated_iterations, DEV_LIVE_DEFAULT_ITERATIONS_PER_WI)
        : DEV_LIVE_DEFAULT_ITERATIONS_PER_WI,
      // Per CONTRACTS.md C19: no $ cap. Carries through to the prompt header
      // as Infinity so the agent sees "no $ ceiling — iteration cap is the
      // only bound".
      costBudgetUsd: Number.POSITIVE_INFINITY,
    });

    const tallyingQueryFn: QueryFn = ({ prompt, options }) => {
      const inner = sdkQueryFn({ prompt, options });
      return (async function* () {
        for await (const msg of inner) {
          const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } };
          if (m.type === 'assistant') tallyDevToolUse(m.message, wiToolUse);
          yield msg;
        }
      })();
    };

    // N9: set from the reasoning stream below; read when classifying this
    // WI's failure as environment (rate-limit) vs work.
    let wiSawRateLimit = false;

    // Change C — Phase A per-tool live telemetry sink + agent built together.
    const { agent, toolSink: wiToolSink } = makeAgentWithTelemetry(
      logger,
      {
        initiativeId: input.initiativeId,
        parentEventId: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        workItemId: wi.work_item_id,
      },
      {
        model: DEV_MODEL,
        allowedTools: [...DEV_ALLOWED_TOOLS],
        disallowedTools: [...DEV_DISALLOWED_TOOLS],
        permissionMode: 'acceptEdits',
        systemPrompt,
        maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
        // Per CONTRACTS.md C19: no $ cap on the per-WI Ralph.
        queryFn: tallyingQueryFn,
      },
      // ADR 029: spawn on the resolved runtime sdk (default 'claude').
      DEV_SDK_ID,
      // Studio observability sub-gap #2: emit each assistant reasoning block
      // as a log event so the operator UI can show live "thinking" per WI hex.
      (text) => {
        // N9: the CLI's rate/usage-limit death announces itself in the
        // reasoning stream ("You've hit your limit · resets …") while the
        // crash that follows is a generic exit-code-1 — remember the sighting
        // so this WI's failure is marked environment, not work.
        if (matchesRateLimitSignature(text)) wiSawRateLimit = true;
        try {
          logger.emit({
            initiative_id: input.initiativeId,
            parent_event_id: wiStart.event_id,
            phase: 'developer-loop',
            skill: 'developer-ralph',
            event_type: 'log',
            input_refs: [],
            output_refs: [],
            message: text,
            metadata: { kind: 'reasoning', work_item_id: wi.work_item_id },
          });
        } catch {
          /* never let a failing emit break the outer agent loop */
        }
      },
    );

    let result: LoopResult | null = null;
    let runnerError: { kind: string; message: string } | undefined;
    // G3 (plan 2.3): remember the previous crash so classifyCrash can spot an
    // IDENTICAL repeat — the deterministic no-third-attempt rule.
    let priorCrashMessage: string | null = null;
    // F-44: bounded retry on transient agent-subprocess crash only.
    for (let attempt = 0; attempt <= DEV_AGENT_CRASH_MAX_RETRIES; attempt++) {
      runnerError = undefined;
      try {
        // re-review #1: captured by the gate's onRun each run; read by the
        // runner's gateErrored predicate to stop early on a broken gate.
        let lastGateErrored = false;
        result = await runRalph(
        {
          workItemSpecPath: specPath,
          worktreePath: wiWorktree.path,
          initiativeBudget: {
            iterations: Math.max(wi.estimated_iterations, DEV_LIVE_DEFAULT_ITERATIONS_PER_WI),
            // Per CONTRACTS.md C19: no $ cap. Pass Infinity so the runner's
            // cost-budget stop condition never fires.
            usd: Number.POSITIVE_INFINITY,
          },
          brainQueryResults: '',
          cycleId: logger.cycleId,
          initiativeId: input.initiativeId,
          // F-04 + 2026-05-25 (claude-harness audit): prefer the WI's
          // per-WI quality_gate_cmd (set by PM to a sharp, AC-exercising
          // command) over the cycle-level default. The cycle-level
          // default (`npm test --silent`) is only the fallback when the
          // WI doesn't set its own — but post-2026-05-24 the WI MUST set
          // its own, so this is effectively always the WI's cmd in
          // production. Without this, the iter-0 gate-too-loose check
          // false-fires (the WI's sharp gate would have failed cleanly,
          // but cycle-level `npm test` passes on the baseline).
          qualityGate: ((): undefined | (() => boolean) => {
            const wiCmd = wi.quality_gate_cmd && wi.quality_gate_cmd.length > 0 ? wi.quality_gate_cmd : null;
            const fallback = input.qualityGateCmd && input.qualityGateCmd.length > 0 ? input.qualityGateCmd : null;
            const effective = wiCmd ?? fallback;
            if (!effective) return undefined;
            // Live-acc env guard: if this WI's gate targets the acc suite
            // (matches the project's acceptance_gate.match) and the project
            // declares requires_env, demand those vars be set — else the gate
            // errors (can't validate live) instead of skip-and-false-passing.
            const requiredEnv =
              accGate?.requires_env && accGate.requires_env.length > 0 &&
              effective.some((tok) => tok.includes(accGate!.match))
                ? accGate.requires_env
                : undefined;
            return makeQualityGateFromCmd(
              wiWorktree.path,
              effective,
              // N10: a TIMED-OUT gate also stops the loop early (iterating
              // doesn't fix machine load and burns agent spend) — but its
              // distinct gate.timeout event classifies as transient/environment
              // so the scheduler retries instead of failing the work as wrong.
              (gateInfo) => { lastGateErrored = (gateInfo.errored ?? false) || (gateInfo.timedOut ?? false); emitGateEvent(logger, input.initiativeId, wiStart.event_id, wi.work_item_id, gateInfo); writeGateFeedback(wiWorktree.path, gateInfo); },
              // Wave B (2026-06-04): enforce that declared output paths land.
              // The WI's declared paths MUST appear in the branch diff before
              // the gate can pass — independently of whether a sibling WI
              // already produced tests. The `already-complete` 3-way runner
              // check handles the "sibling beat us" case upstream; this layer
              // catches "agent exited without writing declared files".
              // 2026-07-11: creates → verification_artifact → files_in_scope
              // fallback (gateRequiredPaths) — a PM that omits `creates` no
              // longer disables the check, which let a vacuous scoped go-test
              // (exit 0, "[no tests to run]") false-pass at iter-0 and kill
              // the WI as gate-too-loose.
              {
                requiredPaths: gateRequiredPaths(wi),
                ...(requiredEnv ? { requiredEnv } : {}),
                ...(ciGateUnsetEnv && ciGateUnsetEnv.length > 0 ? { unsetEnv: ciGateUnsetEnv } : {}),
                timeoutMs: resolveGateTimeoutMs(),
              },
            );
          })(),
          // re-review #3: the runner only takes the `already-complete` shortcut
          // when ALL of THIS WI's declared outputs are on the branch (a sibling
          // genuinely delivered them) — not on a bare "branch has a commit".
          requiredPaths: wi.creates ?? [],
          // A behaviour-preserving refactor WI (rename/move/reformat) has no
          // fail-first gate — the existing suite is green on the base — so the
          // iter-0 hollow-gate guard would wrongly reject it. The PM marks such
          // WIs; honour the marker by disabling that guard for them (the diff +
          // empty-delivery backstop still guard against a no-op).
          failOnHollowIter0Gate: !wi.behavior_preserving,
          // re-review #1: stop early if the gate command can't RUN (broken
          // gate) rather than iterating against it and burning the budget.
          gateErrored: () => lastGateErrored,
          // G1 rescope (plan item 2.6): the autocommit safety net stays, but
          // when it fires the agent's commit-discipline failure becomes a
          // distinct, greppable event instead of being silently absorbed —
          // reflectors see the gap and the skill clause can be tightened.
          onAutoCommit: (iteration) =>
            emitUncommittedWorkSwept(logger, {
              initiativeId: input.initiativeId,
              parentEventId: wiStart.event_id,
              workItemId: wi.work_item_id,
              worktreePath: wiWorktree.path,
              phase: 'developer-loop',
              skill: 'developer-ralph',
            }, iteration),
          // F-14: emit per-iteration events so metrics (cycle.ts:metrics.ts)
          // can aggregate iteration counts. F-23 enriches the metadata so
          // post-mortems can see what the agent actually did per iteration
          // (which tools, which bash commands, last assistant text, tokens).
          onIteration: (iteration, info) => {
            // Phase A — flush the per-tool sampler's coalesced remainder for
            // this iteration before the iteration-summary event.
            wiToolSink.flushIteration(iteration);
            logger.emit({
              initiative_id: input.initiativeId,
              parent_event_id: wiStart.event_id,
              phase: 'developer-loop',
              skill: 'developer-ralph',
              event_type: 'iteration',
              iteration,
              input_refs: [specPath],
              output_refs: info.filesChanged,
              cost_usd: info.costUsd,
              tokens_in: info.tokensIn,
              tokens_out: info.tokensOut,
              metadata: {
                work_item_id: wi.work_item_id,
                tools_used: info.toolsUsed,
                bash_commands: info.bashCommands,
                last_assistant_text: info.lastAssistantText,
              },
            });
          },
        },
        agent,
      );
      } catch (err) {
        runnerError = {
          kind: 'agent_threw',
          message: err instanceof Error ? err.message : String(err),
        };
      }

      // F-44: success (or a real quality-gate `result`) → done, no retry.
      // Only a thrown agent-subprocess crash is retryable, and only while
      // attempts remain. A persistent crash exhausts retries → fails as
      // before. Quality-gate failures come back as `result` (not a throw)
      // and intentionally fall through here without retry.
      if (!runnerError || attempt === DEV_AGENT_CRASH_MAX_RETRIES) break;
      // G3 (plan 2.3): classify the crash BEFORE an identical re-spawn.
      // Deterministic (context overflow / same crash twice at the same point)
      // → give up now with a terminal classified event; a further identical
      // attempt provably repeats the crash and only wastes spend. Transient/
      // unknown → retry with backoff as before (retry-with-cause).
      const crashClass = classifyCrash(runnerError.message, priorCrashMessage);
      if (crashClass.kind === 'deterministic') {
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: wiStart.event_id,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'error',
          input_refs: [specPath],
          output_refs: [],
          message: 'dev-loop.crash-deterministic',
          metadata: {
            work_item_id: wi.work_item_id,
            attempts_made: attempt + 1,
            max_retries: DEV_AGENT_CRASH_MAX_RETRIES,
            crash_class: crashClass.kind,
            crash_reason: crashClass.reason,
            runner_error: runnerError,
          },
        });
        break;
      }
      priorCrashMessage = runnerError.message;
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [specPath],
        output_refs: [],
        message: 'dev-loop.agent-crash-retry',
        metadata: {
          work_item_id: wi.work_item_id,
          attempt: attempt + 1,
          max_retries: DEV_AGENT_CRASH_MAX_RETRIES,
          crash_class: crashClass.kind,
          crash_reason: crashClass.reason,
          runner_error: runnerError,
        },
      });
      await sleep(DEV_AGENT_CRASH_BACKOFF_MS);
    }

    // F-34b: brain-first runtime gate REMOVED from the dev-loop. Brain
    // context is for design (architect / PM / reflector); the dev agent's
    // job is to make the WI's acceptance criteria observable using
    // files_in_scope and existing project code. Forcing the agent to read
    // brain themes was making it anchor on cross-cutting forge-system
    // patterns instead of focusing on the WI, producing trivial-pass exits
    // (see WI-2 of the 12:01 simplification-tests cycle). brainReads are
    // still TALLIED for telemetry — just no longer gated.
    const ralphStatus: WorkItem['status'] = runnerError
      ? 'failed'
      : result?.status === 'complete'
        ? 'complete'
        : 'failed';

    // Phase 4 step 5 fan-in: a clean ralph run merges its isolated branch
    // back into the cycle worktree, single-flight through the shared queue
    // — load-bearing since Phase 4 step 6's concurrent WI dispatch. A ralph
    // FAILURE never attempts a merge at all — nothing merges, nothing
    // pushes. A merge CONFLICT is terminal for the WI at this step (bounded
    // requeue is a later step): `mergeWiIntoCycle` already ran `merge
    // --abort`, so the cycle worktree is clean before the next WI dispatches.
    //
    // Phase 4 step 6 review fix: the status write + origin push run INSIDE
    // the same queued turn as the merge (`mergeAndPublish`, wi-merge-back.ts)
    // rather than after `mergeQueue.enqueue()` resolves — folding them into
    // the merge queue's critical section makes "only one op touches the
    // cycle worktree's working tree/branch at a time" structural, not an
    // emergent property of every statement between the merge resolving and
    // the push completing happening to be synchronous.
    let mergeDetail: string | undefined;
    // Phase 4 step 7: this attempt's merge-conflict ordinal (1 = this is the
    // first time this WI has conflicted), 0 when it never conflicts.
    let mergeConflictAttempt = 0;
    if (ralphStatus === 'complete') {
      const outcome = await mergeQueue.enqueue(() =>
        mergeAndPublish({
          cycleWorktreePath: input.worktreePath,
          wiBranch: wiWorktree.branch,
          workItemId: wi.work_item_id,
          specPath,
          startPointRef: wiBaseSha,
          wiWorktreePath: wiWorktree.path,
        }),
      );
      if (outcome.scratchStripped && outcome.scratchStripped.length > 0) {
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: wiStart.event_id,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'log',
          input_refs: [wiWorktree.path],
          output_refs: [],
          message: 'dev-loop.scratch-stripped',
          metadata: { work_item_id: wi.work_item_id, files: outcome.scratchStripped },
        });
      }
      if (outcome.untrackedRemediated && outcome.untrackedRemediated.length > 0) {
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: wiStart.event_id,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'log',
          input_refs: [input.worktreePath],
          output_refs: [],
          message: 'dev-loop.merge-untracked-remediated',
          metadata: { work_item_id: wi.work_item_id, files: outcome.untrackedRemediated, merged: outcome.merged },
        });
      }
      if (outcome.merged) {
        finalStatus = 'complete';
        pushResult = outcome.push;
      } else {
        mergeConflict = true;
        mergeDetail = outcome.detail;
        // Step 7: bounded requeue — the FIRST conflict for this WI does not
        // conclude its outcome. It goes back to the scheduler for exactly
        // ONE retry (a fresh worktree + ralph run + merge, against whatever
        // the cycle-branch tip is once a slot next opens); only a SECOND
        // conflict for the same WI is terminal (`finalStatus` stays its
        // initial 'failed' default in both cases).
        mergeConflictAttempt = (mergeConflictAttempts.get(wi.work_item_id) ?? 0) + 1;
        if (mergeConflictAttempt <= DEV_WI_MERGE_CONFLICT_MAX_RETRIES) {
          mergeConflictAttempts.set(wi.work_item_id, mergeConflictAttempt);
          // Conflict-context injection: only stored when a retry is actually
          // coming — a terminal (exhausted-retry) conflict has no further
          // attempt to inject this into.
          mergeConflictDetails.set(wi.work_item_id, outcome.conflict);
          requeueForMergeConflict = true;
        } else {
          finalStatus = 'failed';
        }
      }
    } else {
      finalStatus = 'failed';
    }
    if (!requeueForMergeConflict && finalStatus !== 'complete') {
      writeWorkItemStatus(specPath, finalStatus);
    }

    // N9: a failed WI whose death carries a rate/usage-limit signature (seen
    // in the reasoning stream, or in the thrown error itself) failed for an
    // ENVIRONMENT reason — stamp it so the failure classifier retries the
    // cycle and dependents below stay queued instead of cascading to failed.
    // A merge conflict is never also stamped environment here — it carries
    // its OWN failure_kind below and is folded into the environment CLASS
    // only via the `settleWiOutcome` outcome flag further down.
    environmentFailure =
      finalStatus === 'failed' &&
      !mergeConflict &&
      (wiSawRateLimit || (runnerError !== undefined && matchesRateLimitSignature(runnerError.message)));

    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: wiStart.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'end',
      input_refs: [specPath],
      output_refs: result ? result.filesChanged : [],
      cost_usd: result?.cost_usd ?? 0,
      duration_ms: result?.duration_ms ?? 0,
      message: 'ralph.end',
      metadata: {
        work_item_id: wi.work_item_id,
        status: finalStatus,
        iterations: result?.iterations ?? 0,
        stop_reason: result?.stop_reason ?? 'crashed',
        tool_use: wiToolUse,
        runner_error: runnerError,
        // N9: structured environment marker (mirrors the N10 gate.timeout
        // convention) — the failure classifier keys on `rate_limited`.
        ...(environmentFailure ? { failure_kind: 'environment', rate_limited: true } : {}),
        // Phase 4 step 5: a clean ralph run that only failed at the fan-in
        // merge gets its OWN failure_kind — distinct from both a work
        // failure and an environment failure for observability, even though
        // it cascades to dependents the SAME way (see `settleWiOutcome`
        // below + prerequisiteBlockage's environment-failure class).
        ...(mergeConflict ? { failure_kind: 'merge-conflict', merge_detail: mergeDetail } : {}),
      },
    });

    // Phase 4 step 7: the requeue DECISION gets its own distinct event,
    // separate from the ralph.end result above — attempt metadata lets
    // recovery/observability see the retry happening without inferring it
    // from a second ralph.start for the same WI id.
    if (requeueForMergeConflict) {
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [specPath],
        output_refs: [],
        message: 'dev-loop.merge-conflict-requeue',
        metadata: {
          work_item_id: wi.work_item_id,
          attempt: mergeConflictAttempt,
          max_retries: DEV_WI_MERGE_CONFLICT_MAX_RETRIES,
          merge_detail: mergeDetail,
        },
      });
    }

    // M5: per-WI delivered — this WI's net git delta (carries work_item_id so the
    // monitor shows real per-WI stats, not the cycle aggregate on every hex).
    // Phase 4/2 (honest delivery events, brain/cycles/themes/2026-07-11-dev-
    // loop-delivered-event-fires-for-failed-wi.md): `dev-loop.delivered` is
    // SUCCESS-ONLY. A failed WI carries the SAME diff-stat fields on
    // `dev-loop.discarded` instead — nothing is lost, but the event name never
    // implies a shipped WI when it wasn't.
    //
    // Phase 4 step 5: computed against the per-WI worktree (not the cycle
    // worktree) so the stats are correct whether or not this WI ever merged
    // — and read here, BEFORE the `finally` below removes the worktree.
    //
    // Phase 4 step 7: skipped entirely on a requeue — this attempt's outcome
    // isn't concluded (it's being retried), so neither `delivered` nor
    // `discarded` honestly describes it; the eventual terminal attempt fires
    // exactly one of the two, same as before Step 7.
    if (!requeueForMergeConflict) {
      wiDelta = gitNetDelta(wiWorktree.path, wiBaseSha);
      const deliveryEvent = wiDeliveryEvent(finalStatus, wi.work_item_id, wiDelta);
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [wiWorktree.path],
        output_refs: [],
        message: deliveryEvent.message,
        metadata: deliveryEvent.metadata,
      });
    }

    // G8: the CYCLE branch is pushed to origin after a successful merge-back
    // only (Phase 4 step 5 — replaces the old unconditional per-WI push: a
    // ralph failure or a merge conflict never touched the cycle worktree, so
    // there is nothing new to publish). The agent's per-iteration commit
    // (backstopped by commitDevLoopBoundary) plus the fan-in merge commit
    // are already on the branch; publishing now keeps origin in lock-step.
    //
    // Phase 4 step 6 review fix: the push itself now runs INSIDE
    // `mergeAndPublish` above, in the same merge-queue turn as the merge
    // (`pushResult` was set there) — this block only logs the outcome.
    //
    // Push failure is still a HARD EARLY-EXIT (post-2026-05-23 dogfood
    // pushback): if the push fails (e.g. remote ahead from a prior cycle's
    // stale state), every subsequent WI would dispatch from a branch that
    // won't merge cleanly.
    if (finalStatus === 'complete' && pushResult) {
      const push = pushResult;
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: push.pushed ? 'log' : 'error',
        input_refs: [input.worktreePath],
        output_refs: [],
        message: push.pushed ? 'dev-loop.branch-pushed' : 'dev-loop.branch-push-failed',
        // Phase 4/2: carry the same explicit outcome field as the delivered/
        // discarded pair above — push behavior itself is unchanged (still fires
        // regardless of finalStatus; only the metadata gains context).
        metadata: push.pushed
          ? { work_item_id: wi.work_item_id, branch: push.branch, outcome: finalStatus }
          : { work_item_id: wi.work_item_id, reason: push.reason, early_exit: true, outcome: finalStatus },
      });
    }

    // Phase 4 step 7: a requeued attempt never settles — `settleWiOutcome`'s
    // own double-settle guard would otherwise hard-throw on the terminal
    // attempt's settle later. Skipping the settle here is what makes this
    // an "attempt-scoped" settle: exactly one settle per WI id, always on
    // whichever attempt actually concludes it.
    if (!requeueForMergeConflict) {
      settleWiOutcome(wiOutcomes, {
        id: wi.work_item_id,
        status: finalStatus,
        result,
        // A merge conflict cascades to dependents the SAME way an environment
        // failure does (they stay pending, not failed) — prerequisiteBlockage
        // generalizes over this single flag regardless of which non-work
        // reason set it.
        ...(environmentFailure || mergeConflict ? { environment: true } : {}),
      });
    }
    } finally {
      // Phase 4 step 5: per-WI worktrees are pure scratch — remove them on
      // EVERY outcome (success, ralph failure, merge conflict) so the next
      // WI never inherits stale state. No ADR-019 preserve semantics here;
      // the WI's outcome lives on in the cycle branch (merge) or the event
      // log (failure), never in the per-WI worktree itself.
      removeWiWorktree({
        projectRepoPath: input.projectRepoPath,
        path: wiWorktree.path,
        branch: wiWorktree.branch,
        deleteBranch: true,
      });
    }

    if (pushResult && !pushResult.pushed) {
      // Phase 4 step 6: under concurrent dispatch there is no single tail
      // loop of "everything remaining" to mark failed synchronously — set
      // the shared flag instead. `dispatchWi` (below) checks it at the top
      // of every subsequent dispatch and applies the exact same
      // 'branch-push-failed-early-exit' skip treatment lazily, one WI at a
      // time, as the scheduler would have reached it anyway (see the flag's
      // declaration above `runWiDispatchTask` for the full rationale).
      pushFailedRef.current = true;
    }

    // Phase 4 step 7: tells the scheduler whether this WI's outcome
    // concluded (settled above) or needs a fresh re-dispatch.
    return { requeue: requeueForMergeConflict };
  }

  // Phase 4 step 6: the dispatch wrapper handed to `runConcurrentDispatch`.
  // Checked BEFORE `runWiDispatchTask` so a WI that will never get to run
  // (because an earlier sibling's branch-push already failed) never emits a
  // `ralph.start` event — the lazy per-WI equivalent of the old tail loop's
  // synchronous "mark everything remaining failed" (see `pushFailedRef`'s
  // declaration above).
  async function dispatchWi(wi: WorkItem): Promise<DispatchOutcome> {
    if (pushFailedRef.current) {
      writeWorkItemStatus(resolve(workItemsDir, `${wi.work_item_id}.md`), 'failed');
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
        output_refs: [],
        message: 'ralph.skipped',
        metadata: { work_item_id: wi.work_item_id, reason: 'branch-push-failed-early-exit' },
      });
      settleWiOutcome(wiOutcomes, { id: wi.work_item_id, status: 'failed', result: null });
      return { requeue: false };
    }
    return runWiDispatchTask(wi);
  }

  // Phase 4 step 6: dispatch every WI over the dependency graph, up to the
  // configured concurrency cap (default 1 — byte-identical to the pre-
  // step-6 serial loop; see wi-dispatch-scheduler.test.ts's cap-1
  // equivalence coverage). Readiness is keyed off a dependency's dispatch
  // PROMISE settling, which for `runWiDispatchTask` only resolves after that
  // WI's fan-in merge (step 5's single-flight `mergeQueue`) has already run
  // — so a dependent's worktree always branches from a tip that contains
  // every prerequisite (see `wiBaseSha` inside `runWiDispatchTask`).
  await runConcurrentDispatch({
    items: toRun,
    idOf: (wi) => wi.work_item_id,
    dependsOn: (wi) => wi.depends_on,
    cap: resolveDevWiConcurrency(),
    dispatch: dispatchWi,
  });

  // Step 3: assert the outcome snapshot is COMPLETE for every WI actually run
  // (toRun — [] on a unifier-only resume) before deriving any count. See
  // assertOutcomesSettled's doc for the race this closes.
  assertOutcomesSettled(wiOutcomes, toRun);
  const completeCount = [...wiOutcomes.values()].filter((o) => o.status === 'complete').length;
  const totalCost = [...wiOutcomes.values()].reduce((acc, o) => acc + (o.result?.cost_usd ?? 0), 0);

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'end',
    input_refs: [workItemsDir],
    output_refs: [input.worktreePath],
    cost_usd: totalCost,
    metadata: {
      work_item_count: items.length,
      complete: completeCount,
      failed: items.length - completeCount,
      // ADR 019: flag resume runs so the report/UI can distinguish a
      // unifier-only resume (0 WIs run, commits already on branch) from a
      // genuine 0/N total failure.
      resumed: resumeFromUnifier,
    },
  });

  // Partial dev-loop completion is NOT fatal to the cycle. The reviewer's
  // send-back loop is the gap-filler — once gates flip green from any WI
  // and src/ is non-empty, the reviewer can run, the simulator/human can
  // identify what's missing, and feedback rounds can complete the work.
  // Only throw when ZERO WIs succeeded (total dev-loop failure); otherwise
  // emit the partial outcome and hand off to the unifier.
  // ADR 019: on resume-from-unifier zero WIs run by design (their commits are
  // already on the branch), so the total-failure guard must not fire.
  if (!resumeFromUnifier && completeCount === 0 && items.length > 0) {
    throw new Error(
      `developer-loop: 0/${items.length} work items completed — total failure`,
    );
  }

  // The unifier is no longer run here — it is its own independently-dispatchable
  // flow node (runUnifierPhase, executed by flow-runner's execUnifier). On a
  // unifier resume the flow-runner skips this dev node entirely (M8-0). The
  // dev-loop phase ends here, with only the per-WI work on the branch.
}

/**
 * runUnifierPhase — the unifier as an independently-dispatchable flow node
 * (M8-0; ADR-028/019). Extracted from the former tail of runDeveloperLoop so
 * the flow DAG's `unifier` node is a real executor, not a marker. Runs once per
 * dev-loop (initial-prep) or once per send-back round (the drain), and is the
 * resume target for `resumeFrom: 'unifier'` (the per-WI dev node is skipped).
 *
 * Order is preserved exactly vs the old runDeveloperLoop tail: (resume-only
 * branch publish) → runUnifier → assertDevLoopCloseSync → emitDeliverySummary.
 * The flow-runner runs the close-contract gates (commit boundary, close
 * invariant, delivery gate, non-empty guard, final CI) immediately after this
 * returns — the same sequence as before, just lifted into execUnifier.
 */
export async function runUnifierPhase(
  input: CycleInput,
  logger: EventLogger,
  // best-effort wedge abort; the unifier node gets its own wedge detector in
  // flow-runner. Accepted (not yet chained into the unifier's Ralph instances).
  _signal?: AbortSignal,
): Promise<{ unifierSucceeded: boolean; unifierFailureClass: string | null; commitsAhead: number; filesChanged: number; insertions: number }> {
  const resumeFromUnifier = input.resumeFrom === 'unifier';

  // Phase-boundary event: anchors the unifier's child events (parent_event_id)
  // and lights the unifier hex in the UI — the node is now a real executor.
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'unifier',
    skill: 'developer-unifier',
    event_type: 'start',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: 'unifier-phase.start',
    metadata: { resumed: resumeFromUnifier },
  });

  // S4: run the unifier sub-phase. The unifier owns the initiative-level
  // ACs, the tracked demo bundle, and the PR description. Failures are
  // classified per council 04 F7:
  //   - dev-loop-unifier-gate-failed
  //   - dev-loop-unifier-demo-failed
  //   - dev-loop-unifier-branch-divergence
  //
  // ADR 019: on resume the per-WI loop (which normally publishes the branch
  // incrementally via dev-loop.branch-pushed) was skipped, so origin/<branch>
  // may not exist yet — the unifier's sync gate requires it. Publish the
  // preserved branch now so the resumed unifier sees a synced remote.
  if (resumeFromUnifier) {
    const push = pushInitiativeBranch(input.worktreePath);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: push.pushed ? 'log' : 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: push.pushed ? 'dev-loop.resume-branch-pushed' : 'dev-loop.resume-branch-push-failed',
      metadata: push.pushed ? { branch: push.branch } : { reason: push.reason },
    });
  }
  const unifierOutcome = await runUnifier(input, logger, start.event_id);

  // S1.3: at dev-loop close the local↔remote invariant MUST hold —
  // `origin/<branch>` == local HEAD AND `main` == merge-base. A per-WI
  // push could have failed silently mid-loop (transient network blip),
  // and the reviewer + the rest of the cycle assume the branch is fully
  // published. A divergence here is a hard, classified failure: emit a
  // `dev-loop.branch-divergence` event and re-throw — the cycle's
  // try/catch + failure classifier handle the rest.
  //
  // Note: `cycle-helpers.ts:enforceDevLoopCloseInvariant` ALSO asserts this
  // same invariant after this phase returns (run by execUnifier). The two
  // calls are deliberately additive (not duplicative): this one is the
  // unifier-PHASE'S own boundary check (phase-scoped event), the cycle-level
  // one runs AFTER `commitDevLoopBoundary` may have added one more commit +
  // push. Both are idempotent reads against git state.
  assertDevLoopCloseSync(input.worktreePath, logger, input.initiativeId);

  // cascade-v4 #1: emit the authoritative DELIVERY ground truth (git
  // diff-stat of the branch's net contribution) while the branch + base still
  // exist. The reflector grounds "what was delivered" in THIS event, not in
  // per-WI status counts — which can read stale `failed:N` on a resume even
  // though the branch carries merged, tested code (the cascade-v4 wrong-theme).
  const deliveryStat = emitDeliverySummary(input, logger, start.event_id);

  // cascade-v4 #3: surface the unifier outcome so the flow's delivery gate can
  // refuse a PR when the unifier did not pass its composed gate.
  return {
    unifierSucceeded: unifierOutcome.succeeded,
    unifierFailureClass: unifierOutcome.failureClass,
    commitsAhead: deliveryStat.commits,
    filesChanged: deliveryStat.filesChanged,
    insertions: deliveryStat.insertions,
  };
}

/**
 * S1.3 — dev-loop close-step local↔remote invariant assertion.
 *
 * On OK: emits a `dev-loop.branch-sync-ok` log event (with ref hashes for
 * post-mortem) and returns.
 * On divergence: emits a `dev-loop.branch-divergence` error event (same
 * metadata shape) and re-throws the underlying `assertLocalRemoteSynced`
 * error. Caller decides what to do — the cycle's try/catch + failure
 * classifier consume the event.
 *
 * Exported for unit testing (real tmp git repos — see
 * `developer-loop-close-sync.test.ts`). Production callers should reach
 * this only via `runUnifierPhase`'s close path (M8-0).
 */
/**
 * cascade-v4 #1: emit `dev-loop.delivered` — the git-derived net contribution
 * of the initiative branch (files changed, insertions, deletions, commits)
 * against its base. This is the authoritative delivery signal the reflector
 * cross-checks before drawing any "nothing delivered / empty branch"
 * conclusion: per-WI status files can read stale `failed:N` after a resume
 * even when the branch carries real merged code. Best-effort (git failures →
 * zeros); never throws. Exported for unit testing.
 */
/** Current HEAD sha of a worktree, or '' on any failure. Used to bracket a WI's
 *  net contribution (M5: per-WI delivered stats). */
function gitHeadSha(wt: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).toString().trim();
  } catch {
    return '';
  }
}

/** Net diff stats from `fromRef..HEAD` in a worktree (M5). Best-effort → zeros.
 *  Exported for unit testing (Phase 4 step 5's fan-in test proves this is
 *  read against the per-WI worktree, before its `finally`-block cleanup,
 *  on the ralph-FAILURE path too — not just the merged-success path). */
export function gitNetDelta(wt: string, fromRef: string): { files: number; insertions: number; deletions: number; commits: number } {
  const git = (args: string[]): string => {
    try { return execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).toString().trim(); }
    catch { return ''; }
  };
  if (!fromRef) return { files: 0, insertions: 0, deletions: 0, commits: 0 };
  const ss = git(['diff', '--shortstat', `${fromRef}..HEAD`]);
  return {
    files: Number(ss.match(/(\d+) files? changed/)?.[1] ?? 0),
    insertions: Number(ss.match(/(\d+) insertions?/)?.[1] ?? 0),
    deletions: Number(ss.match(/(\d+) deletions?/)?.[1] ?? 0),
    commits: Number(git(['rev-list', '--count', `${fromRef}..HEAD`]) || '0') || 0,
  };
}

/**
 * Phase 4/2 (honest delivery events) — decide the per-WI delivery event's
 * message + metadata from the WI's final status. `dev-loop.delivered` is
 * SUCCESS-ONLY (`finalStatus === 'complete'`); any other outcome carries the
 * SAME diff-stat fields on `dev-loop.discarded` instead, so a failed WI's
 * partial work is never silently lost from the log — it just is never
 * misnamed as a shipped delivery. Both variants carry an explicit `outcome`
 * field so a consumer never has to infer success from the message name
 * alone (brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-
 * failed-wi.md). Pure — no I/O. Exported for unit testing.
 */
export function wiDeliveryEvent(
  finalStatus: WorkItem['status'],
  workItemId: string,
  delta: { files: number; insertions: number; deletions: number; commits: number },
): { message: 'dev-loop.delivered' | 'dev-loop.discarded'; metadata: Record<string, unknown> } {
  return {
    message: finalStatus === 'complete' ? 'dev-loop.delivered' : 'dev-loop.discarded',
    metadata: {
      work_item_id: workItemId,
      files_changed: delta.files,
      insertions: delta.insertions,
      deletions: delta.deletions,
      commits: delta.commits,
      outcome: finalStatus,
    },
  };
}

export function emitDeliverySummary(
  input: CycleInput,
  logger: EventLogger,
  parentEventId: string,
): { filesChanged: number; insertions: number; deletions: number; commits: number } {
  const wt = input.worktreePath;
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).toString().trim();
    } catch {
      return '';
    }
  };
  let base = '';
  if (git(['rev-parse', '--verify', 'main'])) base = 'main';
  else if (git(['rev-parse', '--verify', 'master'])) base = 'master';

  let filesChanged = 0, insertions = 0, deletions = 0, commits = 0;
  if (base) {
    const shortstat = git(['diff', '--shortstat', `${base}...HEAD`]);
    filesChanged = Number(shortstat.match(/(\d+) files? changed/)?.[1] ?? 0);
    insertions = Number(shortstat.match(/(\d+) insertions?/)?.[1] ?? 0);
    deletions = Number(shortstat.match(/(\d+) deletions?/)?.[1] ?? 0);
    commits = Number(git(['rev-list', '--count', `${base}..HEAD`]) || '0') || 0;
  }
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [wt],
    output_refs: [],
    message: 'dev-loop.delivered',
    metadata: { base: base || null, files_changed: filesChanged, insertions, deletions, commits },
  });
  return { filesChanged, insertions, deletions, commits };
}

export function assertDevLoopCloseSync(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  try {
    const inv = assertLocalRemoteSynced(worktreePath);
    logger.emit({
      initiative_id: initiativeId,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'log',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'dev-loop.branch-sync-ok',
      metadata: {
        branch: inv.branch,
        local_head: inv.localHead,
        origin_head: inv.originHead,
        main_head: inv.mainHead,
        merge_base: inv.mergeBase,
        detail: inv.detail,
      },
    });
  } catch (err) {
    // Capture the ref-hash snapshot for the event BEFORE re-throwing so
    // post-mortems can see what diverged without re-running git from the
    // (possibly cleaned-up) worktree.
    const inv = checkLocalRemoteSynced(worktreePath);
    logger.emit({
      initiative_id: initiativeId,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'dev-loop.branch-divergence',
      metadata: {
        branch: inv.branch,
        local_head: inv.localHead,
        origin_head: inv.originHead,
        main_head: inv.mainHead,
        merge_base: inv.mergeBase,
        detail: inv.detail,
        error_message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

/**
 * N9 (2026-07 refinement, brain/cycles/themes/2026-07-04-rate-limit-crash-
 * prereq-failed-cascade.md): decide whether a work item is blocked by a
 * prerequisite's outcome, and by WHICH KIND of failure:
 *
 *   - `work-failure` — a prerequisite genuinely failed its work; the dependent
 *     is failed with reason `prerequisite-failed` (the historical cascade).
 *   - `environment-failure` — every blocking prerequisite died for an
 *     ENVIRONMENT reason (rate-limit hit — `environment: true` on its outcome)
 *     or was itself left `pending` by an environment skip (transitive). The
 *     dependent is left QUEUED (`pending`) for the cycle's transient
 *     auto-retry, NOT failed — the work was never attempted and nothing about
 *     it is wrong.
 *
 * A genuine work failure dominates across mixed prerequisites. Outcomes
 * without `environment` flags (the unifier's UWI loop) behave exactly like
 * the old boolean `prerequisiteFailed`.
 */
export function prerequisiteBlockage(
  wi: WorkItem,
  outcomes: ReadonlyArray<{ id: string; status: WorkItem['status']; environment?: boolean }>,
): 'none' | 'work-failure' | 'environment-failure' {
  if (wi.depends_on.length === 0) return 'none';
  const byId = new Map(outcomes.map((o) => [o.id, o] as const));
  let environmentBlocked = false;
  for (const dep of wi.depends_on) {
    const outcome = byId.get(dep);
    if (!outcome) continue;
    if (outcome.status === 'failed') {
      if (outcome.environment === true) environmentBlocked = true;
      else return 'work-failure';
    }
    // A dep left queued by an environment skip transitively blocks its
    // dependents the same way — its work does not exist on the branch yet.
    if (outcome.status === 'pending') environmentBlocked = true;
  }
  return environmentBlocked ? 'environment-failure' : 'none';
}

/**
 * Phase 4 / Step 3 (2026-07-10 false-total-failure race): the per-WI outcome
 * a work item settles into exactly once — success, work-failure,
 * environment-skip, or early-exit skip all funnel through the same shape.
 * Carries `id` even though it also keys the Map (prerequisiteBlockage's
 * signature is unchanged and expects a flat `{id, status, environment?}`
 * array — `[...outcomes.values()]` reconstructs that shape without touching
 * the pure function).
 */
export type WiOutcome = {
  id: string;
  status: WorkItem['status'];
  result: LoopResult | null;
  environment?: boolean;
};

/**
 * Record a work item's terminal outcome exactly once. Every WI that enters
 * the dev-loop — whether it runs Ralph, is skipped for a failed/environment
 * prerequisite, or is skipped by the branch-push-failed early exit — must
 * settle here precisely once. A second settle for the same `id` is an
 * internal-invariant violation (two code paths raced to conclude the same
 * WI, or a skip/complete path double-fired) — hard-throw rather than
 * silently overwrite, since silently overwriting would hide exactly that
 * bug and could also quietly resurrect the false-total-failure race this
 * step closes.
 */
export function settleWiOutcome(outcomes: Map<string, WiOutcome>, outcome: WiOutcome): void {
  if (outcomes.has(outcome.id)) {
    throw new Error(
      `developer-loop: internal error — work item '${outcome.id}' settled twice (double-settle)`,
    );
  }
  outcomes.set(outcome.id, outcome);
}

/**
 * Completeness invariant (closes the 2026-07-10 false-total-failure race):
 * the aggregate phase-end event and the total-failure verdict must never
 * derive complete/failed counts from a PARTIAL outcome snapshot — a WI that
 * hasn't settled yet would silently read as "not complete", producing a
 * truncated summary or a false 0/N total-failure throw. Assert every WI
 * actually run has settled BEFORE any count is computed; hard-throw naming
 * the missing WIs otherwise so the gap is loud instead of silently wrong.
 */
export function assertOutcomesSettled(
  outcomes: ReadonlyMap<string, WiOutcome>,
  wisRun: ReadonlyArray<WorkItem>,
): void {
  if (outcomes.size === wisRun.length) return;
  const missing = wisRun.filter((wi) => !outcomes.has(wi.work_item_id)).map((wi) => wi.work_item_id);
  throw new Error(
    `developer-loop: internal error — incomplete outcome snapshot before summary ` +
      `(${outcomes.size}/${wisRun.length} settled)${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}`,
  );
}

/**
 * F-23: emit a `gate` event with the captured stdout/stderr/exit details from
 * a quality-gate run. The dev-loop's prior visibility into the gate was a
 * single boolean per iteration, swallowing the actual reason for failure;
 * this surfaces the truncated output so post-mortems can answer "why did the
 * gate fail" without re-running the worktree.
 */
function emitGateEvent(
  logger: EventLogger,
  initiativeId: string,
  parentEventId: string,
  workItemId: string,
  info: GateRunInfo,
  // ADR 026: a code-fix UWI runs in the unifier phase wearing the dev role —
  // attribute its gate events to `unifier` so post-mortems don't mis-file them
  // under developer-loop. Defaults to the dev-loop's own phase/skill.
  attr: { phase: 'developer-loop' | 'unifier'; skill: string } = { phase: 'developer-loop', skill: 'developer-ralph' },
): void {
  // 2026-05-25: iter-0 gate fails are EXPECTED (the L2 sharp-gate
  // check proves the gate isn't hollow before the agent has done any
  // work). Emit as `log` with `expected_fail: true` so the UI doesn't
  // flip the dev-loop phase to red on a normal-path event. Real
  // failures (iter >= 1 with the gate still failing) stay as `error`.
  // A gate that ERRORED (could not run — missing binary / signal) is NEVER
  // "expected", even at iter-0: it's a broken gate, not a test outcome. Always
  // surface it as an error with a distinct `gate.errored` message so the
  // classifier says "fix the gate" instead of mis-reading it as a code failure.
  // N10: a gate KILLED by its timeout is an ENVIRONMENT failure — never
  // "expected" and never a work failure. Distinct `gate.timeout` message +
  // `gate_timed_out` / `failure_kind: 'environment'` metadata so the failure
  // classifier routes it as transient instead of "the code was wrong".
  const isExpectedIter0Fail = !info.passed && !info.errored && !info.timedOut && info.iteration === 0;
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: parentEventId,
    phase: attr.phase,
    skill: attr.skill,
    event_type: info.passed || isExpectedIter0Fail ? 'log' : 'error',
    input_refs: [],
    output_refs: [],
    duration_ms: info.durationMs,
    message: info.timedOut
      ? 'gate.timeout'
      : info.errored
        ? 'gate.errored'
        : info.passed
          ? 'gate.pass'
          : isExpectedIter0Fail
            ? 'gate.expected-fail'
            : 'gate.fail',
    metadata: {
      work_item_id: workItemId,
      gate_passed: info.passed,
      gate_exit_code: info.exitCode,
      gate_command: info.command,
      gate_stdout_tail: info.stdoutTail,
      gate_stderr_tail: info.stderrTail,
      ...(info.errored ? { gate_errored: true } : {}),
      ...(info.timedOut ? { gate_timed_out: true, failure_kind: 'environment' } : {}),
      ...(info.rejectReason ? { reject_reason: info.rejectReason } : {}),
      ...(info.iteration !== undefined ? { iteration: info.iteration } : {}),
      ...(isExpectedIter0Fail ? { expected_fail: true } : {}),
    },
  });
}

/**
 * The one scratch path both the live-gate-feedback loop (`writeGateFeedback`,
 * the unifier's composed-gate equivalent) and the fan-in merge-conflict loop
 * (`writeMergeConflictFeedback`, below) write into. `.forge/` is gitignored
 * on every onboarded project (contract C2) and stripped pre-PR, so this
 * scratch file never lands on a branch. Kept as a single named helper so the
 * seam both loops share is structural, not an incidentally-matching literal
 * repeated at each call site.
 */
function lastGateFailurePath(worktreePath: string): string {
  return join(worktreePath, '.forge', 'last-gate-failure.md');
}

/**
 * The two heading prefixes the shared feedback file can open with. Structural
 * — `writeGateFeedback`'s iteration-0 append path keys on them (a file that
 * STARTS with the merge-conflict heading is preserved; the gate detail is
 * spliced at the first gate-failure heading), so they live as named constants
 * rather than incidentally-matching literals in two bodies. Exported for the
 * integration tests that assert on the file's shape.
 */
export const MERGE_CONFLICT_FEEDBACK_HEADING = '# MERGE CONFLICT';
export const GATE_FAILURE_FEEDBACK_HEADING = '# Live quality-gate failure — AUTHORITATIVE';

/**
 * S9 fix (2026-07-01): feed the authoritative LIVE gate failure back to the dev
 * agent. The orchestrator's quality gate runs the WI's `quality_gate_cmd` live
 * (secrets.env-injected, TF_ACC set) while the agent's own self-check runs
 * offline and can false-pass (acceptance tests silently skip without TF_ACC).
 * Persisting the live failure to `.forge/last-gate-failure.md` — which the dev
 * PROMPT tells the agent to read first — lets the next iteration fix the exact
 * live failure instead of re-confirming offline-green and burning the iteration
 * budget. `.forge/` is stripped pre-PR, so this scratch file never lands on the branch.
 *
 * Exported (2026-07-12, Wave 2 gate-feedback-loop conformance item) so the
 * integration test can drive the EXACT production write/clear path against a
 * real per-WI worktree and `runRalph` call, rather than re-implementing it —
 * behaviour is otherwise unchanged.
 *
 * Precedence vs. `writeMergeConflictFeedback` (below): both target the SAME
 * file. This is deliberate, not an oversight — a requeued WI's fresh worktree
 * gets the merge-conflict note written once, before ralph runs, so the
 * agent's first turn on the retry sees "sibling work already changed these
 * files, don't reproduce your last edit." The wrinkle (re-review CRITICAL,
 * 2026-07-12): the runner's iteration 0 is NOT the agent's first turn — it is
 * the sharp-gate pre-check (`failOnHollowIter0Gate`, default ON for per-WI
 * ralphs), which runs the REAL gate before the agent exists and delivers its
 * result here via `onRun`. On a fresh requeue fork that iter-0 gate almost
 * always FAILS, and a blind rewrite would delete the conflict note before the
 * agent ever read it — nullifying the injection on the exact path it exists
 * for. So the contract is three-cased:
 *
 * - FAILING gate at iteration 0 with a merge-conflict note already in the
 *   file → PRESERVE the note and append the gate detail beneath it (one
 *   file, conflict context first — it is the higher-signal instruction; the
 *   iter-0 gate failure on a fresh fork is expected, not news).
 * - FAILING gate at iteration ≥ 1 → replace the file entirely. The agent has
 *   had its first turn (which the dev prompt mandates opens by reading this
 *   file); from here on the live gate result is the freshest, most
 *   actionable signal — the file's existing "always reflects the freshest
 *   live truth, never accumulates history" contract (the 2026-07-04
 *   stale-last-gate-failure theme).
 * - PASSING gate at ANY iteration → delete, as always. If even the iter-0
 *   gate passes on a fresh fork, sibling merges already delivered the
 *   behavior (the runner classifies it `already-complete`/`gate-too-loose`)
 *   and the conflict note is moot.
 */
export function writeGateFeedback(worktreePath: string, info: GateRunInfo): void {
  const filePath = lastGateFailurePath(worktreePath);
  try {
    if (info.passed) {
      if (existsSync(filePath)) unlinkSync(filePath);
      return;
    }
    const gateBody = [
      `${GATE_FAILURE_FEEDBACK_HEADING} (forge, iteration ${info.iteration ?? '?'})`,
      '',
      'This is the result of the SAME gate that decides whether this work item is done.',
      'Your own offline test run can show a FALSE pass: live acceptance tests silently',
      'skip without TF_ACC and print `ok ... 0.00s`. Fix EXACTLY what is below — the work',
      'item is NOT done until this file disappears.',
      '',
      `Command: ${info.command ?? ''}`,
      `Exit code: ${String(info.exitCode ?? '?')}${info.errored ? '  (gate ERRORED — could not run; fix the gate/build itself)' : ''}`,
      '',
      '## stdout (tail)',
      '```',
      info.stdoutTail ?? '',
      '```',
      '',
      '## stderr (tail)',
      '```',
      info.stderrTail ?? '',
      '```',
      '',
    ].join('\n');
    // Iteration-0 append path (see the precedence contract in the doc
    // comment): the sharp-gate pre-check fires before the agent's first
    // turn, and on a requeued fork the file already holds the merge-conflict
    // note. Preserve it — conflict context first, gate detail beneath.
    // Splitting at the first gate-failure heading keeps a repeated iter-0
    // write idempotent (fresh gate detail, never accumulated copies).
    let body = gateBody;
    if (info.iteration === 0 && existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8');
      if (existing.startsWith(MERGE_CONFLICT_FEEDBACK_HEADING)) {
        const spliceAt = existing.indexOf(GATE_FAILURE_FEEDBACK_HEADING);
        const conflictNote = (spliceAt === -1 ? existing : existing.slice(0, spliceAt)).replace(/\s*$/, '');
        body = `${conflictNote}\n\n${gateBody}`;
      }
    }
    mkdirSync(join(worktreePath, '.forge'), { recursive: true });
    writeFileSync(filePath, body);
  } catch {
    /* best-effort — never throw out of the gate sink */
  }
}

/**
 * Conflict-context injection (Phase 4 step 7 follow-up, 2026-07-12): a WI
 * whose fan-in merge conflicted gets exactly ONE bounded requeue
 * (`DEV_WI_MERGE_CONFLICT_MAX_RETRIES`) against a fresh cycle-branch tip —
 * but a fresh per-WI worktree carries zero knowledge of WHY the previous
 * attempt conflicted, so ralph reliably reproduces the same overlapping
 * edit (proven live: 2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag's
 * WI-3 conflicted twice in a row, deterministically). This writes the
 * captured conflict detail (`captureMergeConflictDetail` in
 * `wi-merge-back.ts`) into the requeued attempt's fresh worktree, reusing
 * the SAME `.forge/last-gate-failure.md` seam `writeGateFeedback` uses — the
 * dev system prompt already mandates reading that file first, so no prompt
 * change is needed for the agent to see this on its very first turn.
 *
 * A distinct heading ("MERGE CONFLICT" vs. "Live quality-gate failure")
 * keeps the two kinds of feedback from reading as the same thing — this is
 * fan-in evidence about sibling work, not a report on the WI's own gate.
 * See `writeGateFeedback`'s doc comment above for the precedence decision
 * between the two writers.
 */
export function writeMergeConflictFeedback(
  worktreePath: string,
  attempt: number,
  conflict: MergeConflictDetail,
): void {
  try {
    const fileList =
      conflict.conflictingFiles.length > 0
        ? conflict.conflictingFiles.map((f) => `- ${f}`).join('\n')
        : '- (git reported no specific unmerged paths for this failure)';
    const commitList =
      conflict.siblingCommits.length > 0
        ? conflict.siblingCommits.map((c) => `- ${c}`).join('\n')
        : '- (none found — the conflict may be against a change forge has not recorded a commit for)';
    const body = [
      `${MERGE_CONFLICT_FEEDBACK_HEADING} (attempt ${attempt}) — forge fan-in, NOT a quality-gate failure`,
      '',
      'Your PREVIOUS attempt on this work item conflicted when forge tried to merge its',
      'branch back into the cycle branch. Sibling work items already merged into the',
      'cycle branch while you were working, and your edit overlapped theirs on the files',
      'listed below. This is a FRESH worktree/branch forked from the CURRENT cycle tip —',
      'do NOT reproduce your previous edit verbatim. Read the current state of these',
      'files first and rebase your approach on top of what is already there.',
      '',
      `Your previous attempt's last commit: "${conflict.wiBranchTipSubject || '(unknown)'}"`,
      '',
      '## Files that conflicted',
      '',
      fileList,
      ...(conflict.filesTruncated ? ['', '_(truncated — more files conflicted than listed above)_'] : []),
      '',
      '## Sibling commits already merged that touched those files',
      '',
      commitList,
      ...(conflict.commitsTruncated
        ? ['', '_(truncated — more sibling commits touched these files than listed above)_']
        : []),
      '',
    ].join('\n');
    mkdirSync(join(worktreePath, '.forge'), { recursive: true });
    writeFileSync(lastGateFailurePath(worktreePath), body);
  } catch {
    /* best-effort — never throw out of the requeue path */
  }
}

/**
 * S4 — run the developer-unifier sub-phase. Treats the initiative as one PR;
 * proves every AC against branch tip; authors demo + PR body; pushes; asserts
 * branch sync. The unifier reuses the Ralph runner with:
 *
 *   - System prompt: `buildUnifierSystemPrompt()` (SKILL.md + Ralph discipline)
 *   - Iteration cap: diff-scaled (per CONTRACTS.md C19; no $ cap)
 *   - Quality gate: a composed `unifierQualityGate` checking all five
 *     gates (initiative, demo, pr-self-contained, branches-in-sync, delivery).
 *
 * ADR 026: the unifier runs a for-each-pending-UWI loop; review feedback
 * appends UWIs the drain runs in the same cycle (no send-back to a dev phase).
 *
 * Failure classification per council 04 F7:
 *   - dev-loop-unifier-gate-failed
 *   - dev-loop-unifier-demo-failed
 *   - dev-loop-unifier-branch-divergence
 *
 * Log-and-continue on failure: the cycle still proceeds to closure so the
 * operator sees the state via `forge review --inspect`. The failure event
 * is the diagnostic record.
 */
/**
 * cascade-v4 #2: run the project-level quality gate ONCE at dev-loop start to
 * prove the baseline is green before any WI work. Throws (failing the cycle
 * fast) if it is red, emitting a distinct `dev-loop.baseline-red` event the
 * failure-classifier surfaces as the `baseline-already-red` terminal mode —
 * with the gate's stderr so the operator can tell a real pre-existing failure
 * from missing deps / a flaky test. Uses the same gate the unifier runs
 * (projectConfig.quality_gate_cmd ?? cycle qualityGateCmd); skips cleanly when
 * no project-level gate is configured (the per-WI gates carry it then).
 */
export function assertGreenBaseline(
  input: CycleInput,
  logger: EventLogger,
  parentEventId: string,
): void {
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(input.projectRepoPath);
  } catch {
    /* tolerate — fall back to the cycle-level gate below */
  }
  const baselineCmd = projectConfig?.quality_gate_cmd ?? input.qualityGateCmd ?? null;
  if (!baselineCmd || baselineCmd.length === 0) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'log',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'dev-loop.baseline-skipped',
      metadata: { reason: 'no project-level quality_gate_cmd configured' },
    });
    return;
  }

  // Pure exit-code check — the baseline question is "is HEAD green", not
  // "does the gate discriminate" (that is the per-WI gate's job, enforced by
  // the iter-0 hollow check).
  let info: GateRunInfo | undefined;
  const ciGateUnsetEnv = projectConfig?.ci_gate_unset_env;
  const passed = makeQualityGateFromCmd(
    input.worktreePath,
    [...baselineCmd],
    (i) => { info = i; },
    {
      timeoutMs: resolveGateTimeoutMs(),
      // R5-02 F2: strip the project's declared ci_gate_unset_env (e.g.
      // TF_ACC) so the baseline gate can't silently run the live-acceptance
      // suite just because the orchestrator's own process env carries it.
      ...(ciGateUnsetEnv && ciGateUnsetEnv.length > 0 ? { unsetEnv: ciGateUnsetEnv } : {}),
    },
  )();

  if (passed) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'log',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'dev-loop.baseline-green',
      metadata: { command: baselineCmd, duration_ms: info?.durationMs },
    });
    return;
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: 'dev-loop.baseline-red',
    metadata: {
      command: baselineCmd,
      exit_code: info?.exitCode,
      stdout_tail: info?.stdoutTail ?? '',
      stderr_tail: info?.stderrTail ?? '',
    },
  });
  throw new Error(
    `developer-loop: baseline already red — the project quality gate (${baselineCmd.join(' ')}) ` +
      `fails at HEAD before any work item runs (exit ${info?.exitCode ?? '?'}). Fix the baseline ` +
      `(pre-existing test failure, missing deps, or a flaky/env-dependent test) before re-running. ` +
      `Forge cannot distinguish a change-induced break from a pre-broken baseline once WI work starts.`,
  );
}

/**
 * betterado #5: scale the unifier iteration cap to the branch's diff size so a
 * trivial (packaging-only) change can't thrash for the full cap (~15 iters /
 * ~$11 observed on a one-file test change). Tiers by files changed on
 * `main...HEAD`: trivial (≤2) → 4, small (≤10) → 8, larger → the full cap.
 * Best-effort: any measurement failure falls back to the full cap so a real
 * change is never under-budgeted. Exported for unit testing.
 */
export function unifierIterationCap(worktreePath: string): number {
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' }).toString().trim();
    } catch {
      return '';
    }
  };
  let base = '';
  if (git(['rev-parse', '--verify', 'main'])) base = 'main';
  else if (git(['rev-parse', '--verify', 'master'])) base = 'master';
  if (!base) return UNIFIER_DEFAULT_ITERATION_CAP;
  const files = Number(git(['diff', '--shortstat', `${base}...HEAD`]).match(/(\d+) files? changed/)?.[1] ?? 0);
  if (files === 0) return UNIFIER_DEFAULT_ITERATION_CAP; // couldn't measure ⇒ don't under-budget
  if (files <= 2) return 4;
  if (files <= 10) return 8;
  return UNIFIER_DEFAULT_ITERATION_CAP;
}

export async function runUnifier(
  input: CycleInput,
  logger: EventLogger,
  parentEventId: string,
): Promise<{ succeeded: boolean; failureClass: string | null }> {
  // Load the project config (mandatory per CONTRACTS.md C1 + council 04 F8).
  // The config provides quality_gate_cmd and demoProcess for the unifier.
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(input.projectRepoPath);
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [input.projectRepoPath],
      output_refs: [],
      message: 'unifier.project-config-invalid',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    // Fall through with projectConfig=null; the gate emits a classified
    // failure event below when it tries to use the demo command.
  }

  const qualityGateCmd =
    projectConfig?.quality_gate_cmd ??
    input.qualityGateCmd ??
    (['npm', 'test'] as string[]);

  // ADR 029: resolve the runtime sdk for each role the unifier phase spawns.
  // The packaging UWI runs on the unifier agent's sdk; a code-fix UWI wears the
  // DEV role (dev SKILL.md + tools), so it spawns on the dev agent's sdk. Both
  // are gated through resolveSdkId (free-text/unavailable → 'claude', logged).
  const unifierSdkId = resolveSdkId(
    unifierAgentSpec.sdk,
    sdkFallbackEventSink(logger, input.initiativeId, 'unifier', 'developer-unifier'),
  );
  const devRoleSdkId = resolveSdkId(
    devAgentSpec.sdk,
    sdkFallbackEventSink(logger, input.initiativeId, 'unifier', 'developer-ralph'),
  );
  // betterado #5: right-size the unifier loop to the diff. A trivial change (a
  // one-file test add) was burning ~15 iters / ~$11 packaging-only because the
  // cap was a flat 15. Scale it to the branch's diff size so packaging-only work
  // can't thrash for 9× the actual work.
  const iterationCap = unifierIterationCap(input.worktreePath);

  // ADR 026: the unifier owns a WI queue at `.forge/unifier-items/`. Seed the
  // static `UWI-1 = "unify & prep the PR"` (idempotent — a re-entrant cycle
  // keeps the existing UWI-1). Review feedback later APPENDS `UWI-2+` to the
  // same queue (the drain) so the review↔unifier loop stays in ONE cycle. With
  // only UWI-1 present this loop runs exactly once and is behaviour-equivalent
  // to the prior single-mission unifier.
  seedStaticUnifierItem(input.worktreePath, {
    initiativeId: input.initiativeId,
    estimatedIterations: iterationCap,
    qualityGateCmd,
  });

  // Stale-feedback fix (2026-07-04 theme: stale-last-gate-failure-poisons-
  // unifier): `.forge/` is gitignored, so a dev-WI's final gate failure from
  // hours ago survives into the unifier session and reads as live signal.
  // Delete it up front — the composed gate rewrites it fresh on every failing
  // evaluation, so from here on "present ⇒ fresh".
  clearUnifierGateFeedback(input.worktreePath);

  const pending = pendingUnifierItems(input.worktreePath);

  const start = logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'unifier',
    skill: 'developer-unifier',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
    message: 'unifier.start',
    metadata: {
      iteration_cap: iterationCap,
      pending_uwis: pending.map((p) => p.work_item_id),
      // ADR 024 seam observability: the agent + tier the orchestrator spawned.
      agent_skill: unifierAgentSpec.skill,
      agent_tier: unifierAgentSpec.tier,
      model: modelForSpec(unifierAgentSpec),
    },
  });

  // Run each pending UWI in dependency order (mirrors the dev-loop per-WI loop).
  const uwiDir = unifierItemsDir(input.worktreePath);
  const uwiOutcomes: UnifierItemOutcome[] = [];
  for (const uwi of pending) {
    const uwiPath = resolve(uwiDir, `${uwi.work_item_id}.md`);
    // UWI outcomes never carry `environment` flags nor `pending` statuses, so
    // this is exactly the old boolean prerequisite-failed check.
    if (prerequisiteBlockage(uwi, uwiOutcomes) !== 'none') {
      writeWorkItemStatus(uwiPath, 'failed');
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [uwiPath],
        output_refs: [],
        message: 'unifier.uwi-skipped',
        metadata: { work_item_id: uwi.work_item_id, reason: 'prerequisite-failed' },
      });
      uwiOutcomes.push({ id: uwi.work_item_id, status: 'failed', result: null, failureClass: 'dev-loop-unifier-gate-failed', runnerError: null, crashed: false });
      continue;
    }
    const runOnce = (): Promise<UnifierItemOutcome> =>
      runUnifierItem({
        uwi,
        input,
        logger,
        startEventId: start.event_id,
        qualityGateCmd,
        demoProcess: projectConfig?.demoProcess,
        skills: projectConfig?.skills,
        changelogPath: projectConfig?.releaseProcess?.changelogPath,
        ciGateUnsetEnv: projectConfig?.ci_gate_unset_env,
        unifierSdkId,
        devRoleSdkId,
      });
    // #1 (F-44 parity for the unifier): retry a transient agent-process CRASH
    // inline (a fresh runUnifierItem re-spawns the agent) with backoff, up to
    // DEV_AGENT_CRASH_MAX_RETRIES — the SAME bound the per-WI dev-loop already
    // uses. A gate FAILURE is NOT retried (deterministic + operator-deferred).
    // Observed: the unifier SDK process exiting 1 at iteration 0 right after a
    // multi-WI burst (gitpulse, 2026-06-21) — the dev-loop had this guard, the
    // unifier did not.
    //
    // G3 (plan 2.3): each re-spawn is IDENTICAL (same UWI spec, same context),
    // so classify the crash first — deterministic (context overflow / same
    // crash twice at the same point, brain/cycles/themes/2026-07-03-unifier-
    // process-crash-before-tools.md) → give up with a terminal classified
    // event instead of repeating the crash; transient/unknown → backoff retry.
    let itemOutcome = await runOnce();
    let priorCrashMessage: string | null = null;
    for (let attempt = 1; itemOutcome.crashed && attempt <= DEV_AGENT_CRASH_MAX_RETRIES; attempt++) {
      const crashMessage = itemOutcome.runnerError ?? '';
      const crashClass = classifyCrash(crashMessage, priorCrashMessage);
      if (crashClass.kind === 'deterministic') {
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: start.event_id,
          phase: 'unifier',
          skill: 'developer-unifier',
          event_type: 'error',
          input_refs: [uwiPath],
          output_refs: [],
          message: 'unifier.crash-deterministic',
          metadata: { work_item_id: uwi.work_item_id, attempts_made: attempt, max_retries: DEV_AGENT_CRASH_MAX_RETRIES, crash_class: crashClass.kind, crash_reason: crashClass.reason, runner_error: itemOutcome.runnerError },
        });
        break;
      }
      priorCrashMessage = crashMessage;
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [uwiPath],
        output_refs: [],
        message: 'unifier.crash-retry',
        metadata: { work_item_id: uwi.work_item_id, attempt, max_retries: DEV_AGENT_CRASH_MAX_RETRIES, crash_class: crashClass.kind, crash_reason: crashClass.reason, runner_error: itemOutcome.runnerError },
      });
      await sleep(DEV_AGENT_CRASH_BACKOFF_MS);
      itemOutcome = await runOnce();
    }
    // #2: a still-crashed UWI persists as re-runnable `pending` (so a later
    // resume-from-unifier re-drains it) rather than operator-deferred `failed`.
    // A real gate failure persists as `failed` (deferred to the operator).
    writeWorkItemStatus(uwiPath, itemOutcome.crashed ? 'pending' : itemOutcome.status);
    uwiOutcomes.push(itemOutcome);
    // Stop the batch on the first non-complete outcome — a failed/crashed concern
    // UWI must not let a later re-prep UWI re-package over a broken state.
    if (itemOutcome.status !== 'complete') break;
  }

  // Push once more at unifier close, then assert sync. The unifier may have
  // committed the demo bundle + closing commit; push so origin matches local.
  const push = pushInitiativeBranch(input.worktreePath);
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'unifier',
    skill: 'developer-unifier',
    event_type: push.pushed ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: push.pushed ? 'unifier.branch-pushed' : 'unifier.branch-push-failed',
    metadata: push.pushed ? { branch: push.branch } : { reason: push.reason },
  });

  // Classify the aggregate unifier outcome. The unifier succeeds only when every
  // pending UWI completed; an empty pending set (all already complete) is a
  // no-op success.
  const firstFailure = uwiOutcomes.find((o) => o.status !== 'complete');
  const succeeded = pending.length === 0 ? true : uwiOutcomes.length > 0 && firstFailure === undefined;
  // Default classification — the composed gate's own events specialise this
  // further (dev-loop-unifier-{gate,demo}-failed are emitted from inside
  // composedUnifierGate when the relevant sub-gate fails).
  let failureClass: string | null = succeeded ? null : (firstFailure?.failureClass ?? 'dev-loop-unifier-gate-failed');

  // Branch-divergence check (last). If branches aren't in sync, that dominates
  // the failure class — surface it specifically. (As before, this relabels the
  // failure class but does not flip a passing run.)
  try {
    assertLocalRemoteSynced(input.worktreePath);
  } catch {
    failureClass = 'dev-loop-unifier-branch-divergence';
  }

  const repResult = firstFailure?.result ?? (uwiOutcomes.length > 0 ? uwiOutcomes[uwiOutcomes.length - 1]!.result : null);
  const totalCost = uwiOutcomes.reduce((acc, o) => acc + (o.result?.cost_usd ?? 0), 0);
  const totalIterations = uwiOutcomes.reduce((acc, o) => acc + (o.result?.iterations ?? 0), 0);
  const totalDuration = uwiOutcomes.reduce((acc, o) => acc + (o.result?.duration_ms ?? 0), 0);
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'unifier',
    skill: 'developer-unifier',
    event_type: succeeded ? 'end' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [input.worktreePath],
    duration_ms: totalDuration,
    cost_usd: totalCost,
    message: succeeded ? 'unifier.end' : 'unifier.failed',
    metadata: {
      status: succeeded ? 'complete' : (repResult?.status ?? 'crashed'),
      iterations: totalIterations,
      stop_reason: repResult?.stop_reason ?? (succeeded ? 'complete' : 'crashed'),
      runner_error: firstFailure?.runnerError ?? null,
      failure_class: failureClass,
      uwis_run: uwiOutcomes.map((o) => ({ id: o.id, status: o.status })),
    },
  });

  return { succeeded, failureClass };
}

/**
 * Run ONE unifier work-item (UWI). The packaging UWI-1 ("unify & prep the PR")
 * and any review-feedback UWI-2+ all flow through here: stamp the per-UWI
 * prompt, spawn the unifier agent, run the Ralph loop against the composed
 * unifier gate (with per-iteration push so `branches_in_sync` stays
 * satisfiable), and classify. Extracted from `runUnifier` so the per-UWI loop
 * mirrors the dev-loop's per-WI loop. With only UWI-1 present this is
 * behaviour-equivalent to the prior single-mission unifier.
 */
type UnifierItemArgs = {
  uwi: WorkItem;
  input: CycleInput;
  logger: EventLogger;
  startEventId: string;
  qualityGateCmd: string[];
  /** Project's typed demo steps (M2). Threaded into prepareUnifierWorkspace. */
  demoProcess?: Array<{ kind: string; text: string }>;
  /** Project's bound skill slugs (M2). Threaded into prepareUnifierWorkspace. */
  skills?: string[];
  /** WS-A: worktree-relative changelog path (release opt-in). Threaded into prepareUnifierWorkspace. */
  changelogPath?: string;
  /** ADR 029: resolved runtime sdk for the packaging (unifier-role) UWI. */
  unifierSdkId: string;
  /** ADR 029: resolved runtime sdk for a code-fix UWI (dev-role inside the unifier). */
  devRoleSdkId: string;
  /**
   * R5-02 F2: the project's declared `ci_gate_unset_env` — env var names to
   * strip from every gate child this UWI spawns (the code-fix UWI's own
   * quality gate AND the packaging UWI's composed-gate `initiative_gate`
   * sub-check). Absent/empty ⇒ no stripping.
   */
  ciGateUnsetEnv?: readonly string[];
};
type UnifierItemOutcome = {
  id: string;
  status: WorkItem['status'];
  result: LoopResult | null;
  failureClass: string | null;
  runnerError: string | null;
  /**
   * True when the UWI did not finish because the agent PROCESS crashed/threw
   * (runnerError set), as opposed to running to completion and failing its
   * composed gate. A crash is transient + incomplete, so the drain retries it
   * inline and (if still crashing) persists the UWI as re-runnable `pending` —
   * NOT operator-deferred `failed` (which is reserved for a real gate failure).
   */
  crashed: boolean;
};

async function runUnifierItem(args: UnifierItemArgs): Promise<UnifierItemOutcome> {
  // Wipe per-UWI scratch (PROMPT.md / AGENT.md / fix_plan.md) so this UWI's
  // agent doesn't inherit the previous mission's ticked checklist — same reason
  // the dev-loop wipes between WIs.
  wipeRalphScratch(args.input.worktreePath);

  // ADR 026 typed dispatch: a `code-fix` UWI (a review concern that needs real
  // code) runs the DEV role against the write-a-failing-test-first gate — the
  // same rigor as PM-originated code — without ever returning to a dev phase.
  // Everything else (UWI-1, the terminal re-prep, demo/doc tweaks) is packaging.
  return args.uwi.kind === 'code-fix' ? runCodeFixUwi(args) : runPackagingUwi(args);
}

/**
 * Per-iteration callback shared by both UWI roles: flush the live tool sampler,
 * emit the `unifier` iteration event, and push the branch so the next gate
 * check sees `origin == HEAD` (the runner autocommits WIP without pushing —
 * Finding #2, 2026-05-31). Phase stays `unifier` for both roles: a code-fix UWI
 * is still unifier work (the unifier owns the queue), it just wears the dev role.
 */
function unifierIterationHandler(
  args: UnifierItemArgs,
  toolSink: ReturnType<typeof makeToolEventSink>,
): (iteration: number, info: import('../../loops/ralph/runner.ts').AgentIterationInfo) => void {
  const { input, logger, startEventId } = args;
  return (iteration, info) => {
    toolSink.flushIteration(iteration);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: startEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'iteration',
      iteration,
      input_refs: [input.worktreePath],
      output_refs: info.filesChanged,
      cost_usd: info.costUsd,
      tokens_in: info.tokensIn,
      tokens_out: info.tokensOut,
      metadata: {
        work_item_id: args.uwi.work_item_id,
        tools_used: info.toolsUsed,
        bash_commands: info.bashCommands,
        last_assistant_text: info.lastAssistantText,
      },
    });
    const iterSync = pushInitiativeBranch(input.worktreePath);
    if (!iterSync.pushed) {
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: startEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [input.worktreePath],
        output_refs: [],
        message: 'unifier.iter-sync-push-skipped',
        metadata: { iteration, reason: iterSync.reason },
      });
    }
  };
}

export function unifierItemClassify(uwi: WorkItem, loopResult: LoopResult | null, runnerError: string | null): UnifierItemOutcome {
  const status: WorkItem['status'] = loopResult?.status === 'complete' && runnerError === null ? 'complete' : 'failed';
  // Distinguish a PROCESS crash (the agent threw/exited before producing a clean
  // gate verdict — runnerError set, or the loop reports a crashed status) from a
  // GATE failure (the agent ran to completion but its output failed the composed
  // gate). The former is transient/incomplete (retry inline; resume re-drains);
  // the latter is operator-deferred. A complete run is never a crash.
  const crashed = status !== 'complete' && (runnerError !== null || loopResult === null);
  // G4: a loop-cap-exhausted stop is a deterministic gate outcome with its own
  // class — the agent repeatedly failed the SAME composed-gate sub-check and
  // the fix-iteration ceiling halted the loop (never a transient crash).
  const capExhausted = !crashed && loopResult?.stop_reason === 'loop-cap-exhausted';
  return {
    id: uwi.work_item_id,
    status,
    result: loopResult,
    failureClass:
      status === 'complete'
        ? null
        : crashed
          ? 'dev-loop-unifier-crashed'
          : capExhausted
            ? 'dev-loop-unifier-loop-cap-exhausted'
            : 'dev-loop-unifier-gate-failed',
    runnerError,
    crashed,
  };
}

/**
 * G4 (plan item 2.2): per-UWI composed-gate failure tracker.
 *
 * Wired into `composedUnifierGate`'s `onGateFailure` seam by the packaging
 * UWI's fix-iteration loop:
 *   - Every failing evaluation emits ONE `uwi.gate-failed` event carrying the
 *     failing sub-check + exit code + output tail — the restart between
 *     iterations was previously invisible (2026-07-04 theme: 16 unifier
 *     restarts with zero diagnostic events between them).
 *   - `cap` CONSECUTIVE failures of the SAME sub-check emit a single terminal
 *     `uwi.loop-cap-exhausted` error event and flip `capExhausted()`, which
 *     the Ralph runner reads to stop the loop (stop_reason:
 *     `loop-cap-exhausted`) instead of re-invoking the agent against a gate
 *     it demonstrably cannot clear (the $84.56 single-cycle spin). A failure
 *     of a DIFFERENT sub-check means progress (short-circuit order) and
 *     resets the counter.
 *
 * The code-fix UWI loop deliberately does NOT get this cap: its sharp gate is
 * SUPPOSED to fail repeatedly during the red→green TDD rhythm, its failures
 * are already visible via per-run `gate.fail` events, and its iteration
 * budget bounds it.
 */
export function createUwiGateFailureTracker(args: {
  logger: EventLogger;
  initiativeId: string;
  parentEventId: string;
  workItemId: string;
  cap: number;
}): { onGateFailure: (failure: UnifierGateFailure) => void; capExhausted: () => boolean } {
  let consecutive = 0;
  let lastCheckId: UnifierGateFailure['checkId'] | null = null;
  let exhausted = false;

  const onGateFailure = (failure: UnifierGateFailure): void => {
    consecutive = failure.checkId === lastCheckId ? consecutive + 1 : 1;
    lastCheckId = failure.checkId;
    const evidence = {
      work_item_id: args.workItemId,
      check_id: failure.checkId,
      gate_exit_code: failure.exitCode,
      gate_output_tail: failure.outputTail.slice(-2000),
      consecutive_failures: consecutive,
      failure_cap: args.cap,
    };
    // Restart-visibility marker ('log', not 'error' — the failing sub-check
    // already emitted its own classified unifier.gate.* error event; this is
    // the observational between-restarts trace, like unifier.gate.sub-check).
    args.logger.emit({
      initiative_id: args.initiativeId,
      parent_event_id: args.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'uwi.gate-failed',
      metadata: evidence,
    });
    if (consecutive >= args.cap && !exhausted) {
      exhausted = true;
      args.logger.emit({
        initiative_id: args.initiativeId,
        parent_event_id: args.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [],
        output_refs: [],
        message: 'uwi.loop-cap-exhausted',
        metadata: { failure_class: 'dev-loop-unifier-loop-cap-exhausted', ...evidence },
      });
    }
  };

  return { onGateFailure, capExhausted: () => exhausted };
}

/** The packaging role: unify, author demo/PR, prove the 4-gate composed unifier
 *  gate. UWI-1, the terminal re-prep, and demo/doc tweaks. */
async function runPackagingUwi(args: UnifierItemArgs): Promise<UnifierItemOutcome> {
  const { uwi, input, logger, startEventId, qualityGateCmd } = args;

  const itemGateCmd = uwi.quality_gate_cmd && uwi.quality_gate_cmd.length > 0 ? uwi.quality_gate_cmd : qualityGateCmd;
  const itemCap = Math.max(1, uwi.estimated_iterations || UNIFIER_DEFAULT_ITERATION_CAP);

  // Stamp PROMPT.md / AGENT.md / fix_plan.md for this UWI. Threading `uwi`
  // embeds ITS spec verbatim (plan 2.7) — for a review-concern UWI that is the
  // operator's send-back rationale + ACs, previously invisible to this role.
  const { promptPath } = prepareUnifierWorkspace({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreePath: input.worktreePath,
    iterationBudget: itemCap,
    qualityGateCmd: itemGateCmd,
    demoProcess: args.demoProcess,
    skills: args.skills,
    changelogPath: args.changelogPath,
    uwi,
  });

  const systemPrompt = buildUnifierSystemPrompt();
  const sdkQueryFn = sdkQuery as unknown as QueryFn;

  // Change C — Phase A per-tool live telemetry sink + unifier agent built together.
  // ADR 024 seam: the orchestrator picks the model tier + tool policy from the
  // declarative PhaseAgentSpec; it authors no intent here.
  const { agent, toolSink } = makeAgentWithTelemetry(
    logger,
    {
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
    },
    {
      model: modelForSpec(unifierAgentSpec),
      allowedTools: [...unifierAgentSpec.allowedTools],
      disallowedTools: [...unifierAgentSpec.disallowedTools],
      permissionMode: 'acceptEdits',
      systemPrompt,
      maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
      // Per CONTRACTS.md C19: no $ cap on the unifier. Iteration cap is the only bound.
      queryFn: sdkQueryFn,
    },
    // ADR 029: spawn the packaging UWI on the unifier agent's resolved sdk.
    args.unifierSdkId,
  );

  // G4 (plan item 2.2): bound the fix-iteration loop. Every failing composed-
  // gate evaluation emits a `uwi.gate-failed` event (the restart was
  // previously invisible — 2026-07-04 themes: 16 restarts, zero diagnostic
  // events); `cap` consecutive failures of the SAME sub-check trip a terminal
  // `uwi.loop-cap-exhausted` and stop the Ralph loop instead of spinning
  // ($84.56 single-cycle burn). This also bounds an orchestrated-capture
  // failure inside the loop (the N1 caveat).
  const gateFailureTracker = createUwiGateFailureTracker({
    logger,
    initiativeId: input.initiativeId,
    parentEventId: startEventId,
    workItemId: uwi.work_item_id,
    cap: resolveUnifierGateFailureCap(),
  });

  // Composed quality gate (5 gates since plan 2.5):
  //   1. initiative_gate (project quality_gate_cmd against branch tip)
  //   2. pr_self_contained (demo.json valid + pr-description.md present)
  //   3. demo_fanin_honesty (demo metadata matches post-fan-in reality)
  //   4. branches_in_sync (assertLocalRemoteSynced doesn't throw)
  //   5. incomplete_delivery (every WI's creates[] paths in diff)
  const unifierGate = async (): Promise<boolean> =>
    composedUnifierGate({
      onGateFailure: gateFailureTracker.onGateFailure,
      worktreePath: input.worktreePath,
      initiativeId: input.initiativeId,
      qualityGateCmd: itemGateCmd,
      // R5-02 F2: strip the project's declared ci_gate_unset_env.
      unsetEnv: args.ciGateUnsetEnv,
      logger,
      initiativeIdForEvent: input.initiativeId,
      parentEventId: startEventId,
      workItemsDir: resolve(input.worktreePath, '.forge/work-items'),
      // Resolved through the demo-path SSOT from the WORKTREE's own
      // project.json (N3): the gate must check demo.json exactly where the
      // unifier prompt / snapshot / pr-open resolve it. Reading artifactRoot
      // from the main project repo here (as before) could diverge from the
      // branch being judged — the 2026-07-05 false-negative class.
      demoDir: worktreeDemoRelDir(input.worktreePath, input.initiativeId),
      // N10: bound the initiative gate; a kill by this timeout classifies as
      // environment (unifier.gate.timeout), never work-failure.
      gateTimeoutMs: resolveGateTimeoutMs(),
      // ADR 036 / N1: the ORCHESTRATOR runs `forge demo capture` — the agent
      // only authors checkpoint `command`s; real before/after evidence is
      // produced by a process the agent never touched and committed by forge.
      orchestratedCapture: { argv: buildDemoCaptureArgv(input.initiativeId) },
    });

  let loopResult: LoopResult | null = null;
  let runnerError: string | null = null;
  try {
    loopResult = await runRalph(
      {
        workItemSpecPath: promptPath,
        worktreePath: input.worktreePath,
        initiativeBudget: {
          iterations: itemCap,
          usd: Number.POSITIVE_INFINITY,
        },
        brainQueryResults: '',
        cycleId: logger.cycleId,
        initiativeId: input.initiativeId,
        qualityGate: unifierGate,
        // The unifier's gate (demo.json + pr-description present & valid) can
        // legitimately PASS at iter-0 — it is not a write-a-failing-test loop,
        // and on a resume-from-unifier the prior cycle's demo/PR are already on
        // the preserved branch. So the iter-0 hollow-gate check would misfire as
        // `gate-too-loose` (cascade-v4 #7, iter-0-on-resume). Disable it here;
        // the per-WI Ralphs keep it on. (Aligns the code with the runner's
        // documented intent — previously the default true left this live.)
        failOnHollowIter0Gate: false,
        // (Tier 2 thinning 2026-05-26): wedged-detection was removed
        // from the runner entirely; the unifier no longer needs the
        // Infinity override because the check is gone.
        // G4: stop the loop once the consecutive same-sub-check failure
        // cap is exhausted (stop_reason: loop-cap-exhausted).
        loopCapExhausted: gateFailureTracker.capExhausted,
        // G1 rescope (plan item 2.6): surface autocommit sweeps as a distinct
        // event so the unifier's commit-discipline gaps are visible too.
        onAutoCommit: (iteration) =>
          emitUncommittedWorkSwept(logger, {
            initiativeId: input.initiativeId,
            parentEventId: startEventId,
            workItemId: uwi.work_item_id,
            worktreePath: input.worktreePath,
            phase: 'unifier',
            skill: 'developer-unifier',
          }, iteration),
        onIteration: unifierIterationHandler(args, toolSink),
      },
      agent,
    );
  } catch (err) {
    runnerError = err instanceof Error ? err.message : String(err);
  }

  return unifierItemClassify(uwi, loopResult, runnerError);
}

/**
 * G1 rescope (plan item 2.6): one autocommit-sweep observation. The safety
 * net (`autoCommitWorktreeIfDirty`) STAYS — it closes the
 * uncommitted-work-dead-ends-the-gate failure mode — but when it fires, the
 * AGENT failed its commit discipline, and that must be a distinct greppable
 * event for reflectors instead of being silently absorbed.
 */
function emitUncommittedWorkSwept(
  logger: EventLogger,
  ctx: {
    initiativeId: string;
    parentEventId: string;
    workItemId: string;
    worktreePath: string;
    phase: 'developer-loop' | 'unifier';
    skill: 'developer-ralph' | 'developer-unifier';
  },
  iteration: number,
): void {
  logger.emit({
    initiative_id: ctx.initiativeId,
    parent_event_id: ctx.parentEventId,
    phase: ctx.phase,
    skill: ctx.skill,
    event_type: 'log',
    input_refs: [ctx.worktreePath],
    output_refs: [],
    message: 'ralph.uncommitted-work-swept',
    metadata: {
      work_item_id: ctx.workItemId,
      iteration,
      detail:
        'agent exited the iteration with uncommitted work; the forge-autocommit safety net swept it (commit-discipline gap — the agent must commit its own work, git add -f for gitignored declared deliverables)',
    },
  });
}

/**
 * The code-fix role (ADR 026): a review concern that needs real code is held to
 * dev-grade rigor — the DEV system prompt + the UWI's SHARP gate +
 * `failOnHollowIter0Gate` ON (the write-a-failing-test-first discipline). At
 * ready-for-review the branch already has commits, so iter-0 never false-fails
 * as `gate-too-loose`; a sharp gate (red until the concern is fixed) drives a
 * real red→green loop, while the project-gate fallback simply iterates with the
 * dev role. The terminal re-prep (packaging) UWI re-authors demo/PR after.
 */
async function runCodeFixUwi(args: UnifierItemArgs): Promise<UnifierItemOutcome> {
  const { uwi, input, logger, startEventId, qualityGateCmd } = args;

  const itemGateCmd = uwi.quality_gate_cmd && uwi.quality_gate_cmd.length > 0 ? uwi.quality_gate_cmd : qualityGateCmd;
  // B5 (pre-merge review): does this UWI carry a SHARP gate (one that's RED on the
  // current branch until the concern is fixed), or is it falling back to the
  // green project gate? At ready-for-review the branch already has commits, so a
  // green gate + empty creates[] would take the runner's iter-0 `already-complete`
  // shortcut → the UWI false-completes with ZERO agent work. So enable the
  // sharp-gate iter-0 check ONLY with a real sharp gate (red iter-0 → iterate →
  // real red→green loop); with the project-gate fallback DISABLE it so the agent
  // gets a turn (the dev-role prompt drives the write-a-failing-test-first work).
  const hasSharpGate = !!(
    uwi.quality_gate_cmd && uwi.quality_gate_cmd.length > 0 &&
    JSON.stringify(uwi.quality_gate_cmd) !== JSON.stringify(qualityGateCmd)
  );
  const itemCap = Math.max(1, uwi.estimated_iterations || UNIFIER_DEFAULT_ITERATION_CAP);
  const uwiAbsPath = resolve(unifierItemsDir(input.worktreePath), `${uwi.work_item_id}.md`);
  const uwiRelPath = `.forge/unifier-items/${uwi.work_item_id}.md`;

  // Stamp the DEV workspace from the UWI spec (dev-role PROMPT.md/AGENT.md).
  prepareDevWorkspace({
    initiativeId: input.initiativeId,
    workItemSpecPath: uwiAbsPath,
    workItemSpecRelPath: uwiRelPath,
    worktreePath: input.worktreePath,
    iterationBudget: itemCap,
    // Per CONTRACTS.md C19: no $ cap — iteration cap is the only bound.
    costBudgetUsd: Number.POSITIVE_INFINITY,
  });

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const systemPrompt = buildDevSystemPrompt(forgeRoot);
  const sdkQueryFn = sdkQuery as unknown as QueryFn;

  const { agent, toolSink } = makeAgentWithTelemetry(
    logger,
    {
      initiativeId: input.initiativeId,
      parentEventId: startEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      workItemId: uwi.work_item_id,
    },
    {
      model: DEV_MODEL,
      allowedTools: [...DEV_ALLOWED_TOOLS],
      disallowedTools: [...DEV_DISALLOWED_TOOLS],
      permissionMode: 'acceptEdits',
      systemPrompt,
      maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
      queryFn: sdkQueryFn,
    },
    // ADR 029: a code-fix UWI wears the dev role — spawn it on the dev sdk.
    args.devRoleSdkId,
  );

  let lastGateErrored = false;
  const gate = makeQualityGateFromCmd(
    input.worktreePath,
    [...itemGateCmd],
    // N10: a timed-out gate stops the loop like a broken gate, but its
    // gate.timeout event classifies as transient/environment (see the dev-WI
    // call site above). Gate feedback flows through the SAME
    // .forge/last-gate-failure.md seam the dev loop + composed gate use
    // (ADR 036) — cleared at unifier start, so present ⇒ fresh.
    (gateInfo) => { lastGateErrored = (gateInfo.errored ?? false) || (gateInfo.timedOut ?? false); emitGateEvent(logger, input.initiativeId, startEventId, uwi.work_item_id, gateInfo, { phase: 'unifier', skill: 'developer-unifier' }); writeGateFeedback(input.worktreePath, gateInfo); },
    {
      requiredPaths: uwi.creates ?? [],
      timeoutMs: resolveGateTimeoutMs(),
      // R5-02 F2: strip the project's declared ci_gate_unset_env.
      ...(args.ciGateUnsetEnv && args.ciGateUnsetEnv.length > 0 ? { unsetEnv: args.ciGateUnsetEnv } : {}),
    },
  );

  let loopResult: LoopResult | null = null;
  let runnerError: string | null = null;
  try {
    loopResult = await runRalph(
      {
        workItemSpecPath: uwiAbsPath,
        worktreePath: input.worktreePath,
        initiativeBudget: { iterations: itemCap, usd: Number.POSITIVE_INFINITY },
        brainQueryResults: '',
        cycleId: logger.cycleId,
        initiativeId: input.initiativeId,
        qualityGate: gate,
        requiredPaths: uwi.creates ?? [],
        gateErrored: () => lastGateErrored,
        // B5: only enforce the iter-0 sharp-gate check with a real sharp gate
        // (else the green project-gate fallback false-completes at iter-0).
        failOnHollowIter0Gate: hasSharpGate,
        // G1 rescope (plan item 2.6): commit-discipline sweeps are visible.
        onAutoCommit: (iteration) =>
          emitUncommittedWorkSwept(logger, {
            initiativeId: input.initiativeId,
            parentEventId: startEventId,
            workItemId: uwi.work_item_id,
            worktreePath: input.worktreePath,
            phase: 'unifier',
            skill: 'developer-unifier',
          }, iteration),
        onIteration: unifierIterationHandler(args, toolSink),
      },
      agent,
    );
  } catch (err) {
    runnerError = err instanceof Error ? err.message : String(err);
  }

  return unifierItemClassify(uwi, loopResult, runnerError);
}

/**
 * G4 (plan item 2.2): one failing composed-gate evaluation, as reported to the
 * caller through `onGateFailure`. `checkId` is the sub-check that blocked
 * (short-circuit order — exactly one per failing evaluation); `exitCode` /
 * `outputTail` carry the evidence where the sub-check ran a command
 * (initiative_gate), or the structural detail string otherwise.
 */
export type UnifierGateFailure = {
  checkId: 'initiative_gate' | 'pr_self_contained' | 'demo_fanin_honesty' | 'branches_in_sync' | 'complete_delivery' | 'gate-timeout';
  /** The failing command's exit code; null for structural checks / killed commands. */
  exitCode: number | null;
  /** Tail of the failing sub-check's output / detail (bounded by the caller's event). */
  outputTail: string;
};

type ComposedUnifierGateInput = {
  worktreePath: string;
  initiativeId: string;
  qualityGateCmd: string[];
  /**
   * R5-02 F2: env var names to strip from the `initiative_gate` sub-check's
   * child process — the project's declared `ci_gate_unset_env`. Absent/empty
   * ⇒ no stripping (unchanged behaviour).
   */
  unsetEnv?: readonly string[];
  logger: EventLogger;
  initiativeIdForEvent: string;
  parentEventId: string;
  /** Wave B (2026-06-04): path to the work-items dir for incomplete-delivery gate. */
  workItemsDir: string;
  /**
   * Worktree-relative demo dir, artifactRoot-resolved (e.g. `demo/<id>` legacy,
   * or `<artifactRoot>/history/<id>/demo` when the project gathers artifacts).
   * The pr_self_contained gate validates `<demoDir>/demo.json` — it MUST match
   * where the unifier was told to author it (projectDemoRelDir), or the gate
   * false-fails "demo.json missing" forever on artifactRoot≠"." projects.
   */
  demoDir: string;
  /**
   * N10: wall-clock bound on the initiative gate command (ms). A gate killed
   * by this timeout is classified as an ENVIRONMENT failure (distinct
   * `unifier.gate.timeout` event, `failure_kind: 'environment'`), never a
   * work failure. Absent ⇒ no timeout (unit-test callers).
   */
  gateTimeoutMs?: number;
  /**
   * ADR 036 / N1 — orchestrator-owned demo capture. When set AND demo.json
   * declares capture-needing checkpoints (a `command`, or an explicit
   * screenshot/video kind), the ORCHESTRATOR spawns this argv in the worktree
   * before validating the demo — so before/after evidence is produced by a
   * process the agent never ran, and hand-written outputs for command
   * checkpoints are overwritten by the real run. Production passes
   * `buildDemoCaptureArgv(initiativeId)` (the forge CLI's `demo capture`);
   * tests substitute a fake script. Environment failures (timeout / non-zero
   * exit / unrunnable) stay best-effort: recorded as an event, gate proceeds.
   * N2 (plan item 2.6) hardens the silent-no-op seams: checkpoint commands
   * must be producible BEFORE the spawn (else pr_self_contained fails with
   * the problems), and a capture run that completes must leave demo.json
   * stamped with the run's env nonce (else the evidence is stale/replayed
   * and pr_self_contained rejects it).
   */
  orchestratedCapture?: { argv: string[]; timeoutMs?: number };
  /**
   * G4 (plan item 2.2): called once per FAILING composed-gate evaluation with
   * the failing sub-check's identity + evidence. The unifier's fix-loop wires
   * this to `createUwiGateFailureTracker`, which (a) emits the
   * `uwi.gate-failed` restart-visibility event and (b) trips the consecutive
   * same-sub-check failure cap that halts the Ralph loop. Absent ⇒ unchanged
   * behaviour (unit-test callers).
   */
  onGateFailure?: (failure: UnifierGateFailure) => void;
};

/**
 * Five-gate composed check the unifier must clear to exit clean:
 *   1. initiative_gate — project quality_gate_cmd against branch tip.
 *   2. pr_self_contained — demo.json valid + pr-description.md present.
 *   3. demo_fanin_honesty — demo.json metadata matches POST-fan-in branch
 *      reality (plan 2.5): stale diffStat is re-derived + committed
 *      (mechanical git truth, orchestrator-owned); a stale liveEvidence id
 *      or foreign initiativeId FAILS honestly with a specific event
 *      (the 2026-07-03 stale-metadata + live-evidence-id themes).
 *   4. branches_in_sync — assertLocalRemoteSynced doesn't throw.
 *   5. incomplete_delivery — every WI's declared `creates[]` paths are
 *      present in `git diff --name-only main...HEAD`. Fails the cycle
 *      before a PR opens when a WI's declared outputs were silently
 *      never written (the INIT-2 release_folder WI-3 scenario).
 *      WIs with empty `creates` are exempt.
 *
 * Returns true ONLY when all five pass. Emits a classified event on each
 * sub-gate failure so the operator sees exactly which gate blocked.
 */

/**
 * The `.forge/pr-description.md` self-contained check.
 *
 * The unifier is instructed to author the git-truth `## Why` / `## What` /
 * `## How` sections and to NOT include a `## Demo` heading — the orchestrator
 * appends the canonical `## Demo` link automatically at PR-open
 * (orchestrator/pr.ts) and even strips any the agent added. So this gate MUST
 * validate the git-truth shape, NEVER `## Demo`: a `## Demo` assertion here is
 * unwinnable (it can only appear downstream) and silently burns the entire
 * unifier iteration budget. That exact contradiction false-failed the
 * release_folder re-run (2026-06-04) — the body was perfect, the gate was wrong.
 */
export function prBodyHasGitTruthSections(body: string): boolean {
  const hasWhat = /^##\s+What\b/im.test(body);
  const hasWhyOrHow = /^##\s+(Why|How)\b/im.test(body);
  return hasWhat && hasWhyOrHow && body.trim().length > 150;
}

export async function composedUnifierGate(input: ComposedUnifierGateInput): Promise<boolean> {
  const { worktreePath, qualityGateCmd, logger, demoDir } = input;

  // Local helper: emit one structured sub-check observation (always — pass OR fail).
  // This is ADDITIVE: existing failure events below are untouched.
  type CheckId = 'initiative_gate' | 'pr_self_contained' | 'demo_fanin_honesty' | 'branches_in_sync' | 'complete_delivery';
  const emitSubCheck = (checkId: CheckId, pass: boolean, detail: string): void => {
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'log',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'unifier.gate.sub-check',
      metadata: { check_id: checkId, pass, detail },
    });
  };

  // Live-gate-feedback seam (ADR 036 / 2026-07 friction): persist the
  // orchestrator's OWN gate verdict for the next agent iteration. The unifier
  // previously had no equivalent of the dev-loop's `.forge/last-gate-failure.md`
  // — the agent learned of composed-gate failures only by re-running gates
  // itself. The file is deleted when the composed gate passes (and at unifier
  // start, per the stale-file theme), so "present ⇒ fresh".
  const failFeedback = (checkId: CheckId | 'gate-timeout', lines: string[]): void => {
    writeUnifierGateFeedback(worktreePath, checkId, lines);
  };

  // 1. initiative_gate
  const initiativeGate = runShellGate(worktreePath, qualityGateCmd, input.gateTimeoutMs, input.unsetEnv);
  if (initiativeGate.timedOut) {
    // N10: killed by OUR timeout — an ENVIRONMENT failure (load / hung live
    // step), categorically distinct from a work failure and from a broken
    // gate. Distinct event + failure_kind so the classifier retries instead
    // of failing the work as wrong.
    emitSubCheck('initiative_gate', false, `gate command timed out after ${input.gateTimeoutMs}ms (environment, not work-failure)`);
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'unifier.gate.timeout',
      metadata: {
        failure_class: 'dev-loop-unifier-gate-timeout',
        failure_kind: 'environment',
        gate_timed_out: true,
        command: qualityGateCmd,
        timeout_ms: input.gateTimeoutMs,
        gate_stderr_tail: initiativeGate.stderr.slice(-2000),
      },
    });
    failFeedback('gate-timeout', [
      `The quality-gate command was KILLED after exceeding its ${input.gateTimeoutMs}ms timeout.`,
      'This is an ENVIRONMENT failure (machine load / a hung step) — the work may be complete.',
      `Command: ${qualityGateCmd.join(' ')}`,
    ]);
    input.onGateFailure?.({
      checkId: 'gate-timeout',
      exitCode: null,
      outputTail: initiativeGate.stderr.slice(-2000) || `gate command timed out after ${input.gateTimeoutMs}ms`,
    });
    return false;
  }
  if (!initiativeGate.passed) {
    emitSubCheck(
      'initiative_gate',
      false,
      initiativeGate.errored
        ? `gate command errored: ${initiativeGate.stderr.slice(-400)}`
        : `gate command failed (exit non-zero): ${initiativeGate.stderr.slice(-400)}`,
    );
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      // A gate that could not RUN is a broken gate, not a delivery failure.
      message: initiativeGate.errored ? 'unifier.gate.errored' : 'unifier.gate.initiative-failed',
      metadata: {
        failure_class: initiativeGate.errored ? 'dev-loop-unifier-gate-errored' : 'dev-loop-unifier-gate-failed',
        command: qualityGateCmd,
        ...(initiativeGate.errored ? { gate_errored: true } : {}),
        gate_stderr_tail: initiativeGate.stderr.slice(-2000),
      },
    });
    failFeedback('initiative_gate', [
      initiativeGate.errored
        ? 'The quality-gate command could not RUN (broken gate — fix the gate/build itself, not the code).'
        : 'The quality-gate command ran and FAILED (non-zero exit). Fix exactly what it reports.',
      `Command: ${qualityGateCmd.join(' ')}`,
      '',
      '## stderr (tail)',
      '```',
      initiativeGate.stderr.slice(-2000),
      '```',
    ]);
    input.onGateFailure?.({
      checkId: 'initiative_gate',
      exitCode: initiativeGate.exitCode,
      outputTail: initiativeGate.stderr.slice(-2000),
    });
    return false;
  }
  emitSubCheck('initiative_gate', true, `gate command exited 0 (${qualityGateCmd.join(' ')})`);

  // ADR 036 / N1 — orchestrator-owned demo capture. Runs BEFORE the demo is
  // validated so the artifacts the gate (and the reviewer) judge are the ones
  // the ORCHESTRATOR produced: `forge demo capture` re-runs every command
  // checkpoint on main AND branch HEAD and back-fills the REAL output over
  // whatever text the agent wrote. Environment failures (timeout, non-zero
  // exit) stay best-effort (recorded, not blocking) — but N2 (plan item 2.6)
  // hardens the two silent-no-op seams:
  //   - PRODUCIBILITY: every checkpoint command must be executable in the
  //     project BEFORE the spawn; otherwise the capture is skipped and the
  //     pr_self_contained gate fails with the actionable problems.
  //   - NONCE: the spawn env carries a per-run nonce the agent never sees;
  //     a capture run that completes (exit 0) must leave demo.json stamped
  //     with it, or the evidence was not produced by this run (stale,
  //     replayed, or hand-written) and pr_self_contained rejects it.
  const demoJsonPathForCapture = join(worktreePath, demoDir, DEMO_JSON_BASENAME);
  let expectedCaptureNonce: string | null = null;
  const captureProblems: string[] = [];
  if (input.orchestratedCapture && demoJsonWantsCapture(demoJsonPathForCapture)) {
    const producibility = preflightDemoCaptureCommands(demoJsonPathForCapture, worktreePath);
    if (!producibility.ok) {
      captureProblems.push(...producibility.problems);
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [demoJsonPathForCapture],
        output_refs: [],
        message: 'unifier.demo-capture',
        metadata: {
          capture_ok: false,
          not_producible: true,
          problems: producibility.problems,
          committed: false,
        },
      });
    } else {
      const captureTimeoutMs = input.orchestratedCapture.timeoutMs ?? resolveDemoCaptureTimeoutMs();
      const nonce = generateCaptureNonce();
      const cap = runOrchestratorCommand(input.orchestratedCapture.argv, {
        cwd: worktreePath,
        timeoutMs: captureTimeoutMs,
        env: { ...process.env, [CAPTURE_NONCE_ENV]: nonce },
      });
      const committed = cap.ok
        ? commitOrchestratedCaptureArtifacts(worktreePath, demoDir, input.initiativeId)
        : false;
      // A run that completed must have produced+stamped the evidence; enforce
      // below. A timed-out / non-zero / unrunnable capture is an environment
      // failure — recorded, not nonce-enforced (best-effort stance stands).
      if (cap.ok) expectedCaptureNonce = nonce;
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [demoJsonPathForCapture],
        output_refs: committed ? [demoJsonPathForCapture] : [],
        duration_ms: cap.durationMs,
        message: 'unifier.demo-capture',
        metadata: {
          capture_ok: cap.ok,
          exit_code: cap.exitCode,
          command: cap.command,
          stdout_tail: cap.stdoutTail,
          stderr_tail: cap.stderrTail,
          committed,
          ...(cap.ok ? { capture_nonce: nonce } : {}),
          ...(cap.timedOut ? { timed_out: true, failure_kind: 'environment', timeout_ms: captureTimeoutMs } : {}),
          ...(cap.errored ? { capture_errored: true } : {}),
        },
      });
    }
  }

  // 2. pr_self_contained (ADR 021: structured demo.json is the contract; DEMO.md
  //    is derived. The gate validates demo.json against the schema — the
  //    structural check that fixes free-form demo inconsistency.)
  const demoJsonPath = join(worktreePath, demoDir, DEMO_JSON_BASENAME);
  const prDescPath = join(worktreePath, '.forge', 'pr-description.md');
  let demoErrors: string[] = ['demo.json missing'];
  if (existsSync(demoJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(demoJsonPath, 'utf8'));
      // Forgiving normalize: coerce a common shape mistake (e.g. testEvidence
      // authored as an object map instead of an array) into the schema shape and
      // PERSIST it, so a single authoring slip can't wedge the unifier loop. The
      // coerced form is what the PR carries + validates.
      const { model, changed } = coerceDemoModel(parsed);
      if (changed) {
        writeFileSync(demoJsonPath, `${JSON.stringify(model, null, 2)}\n`);
        logger.emit({
          initiative_id: input.initiativeIdForEvent,
          parent_event_id: input.parentEventId,
          phase: 'unifier',
          skill: 'developer-unifier',
          event_type: 'log',
          input_refs: [demoJsonPath],
          output_refs: [demoJsonPath],
          message: 'unifier.demo-json-normalized',
          metadata: { detail: 'coerced demo.json into the schema shape before validation' },
        });
      }
      demoErrors = validateDemoModel(model);
      // N2 nonce binding: the orchestrated capture COMPLETED for this run, so
      // the demo.json on disk must carry this run's nonce (stamped by `forge
      // demo capture` from its child env). Anything else is evidence that was
      // not produced by this run — stale, replayed, or hand-written.
      if (expectedCaptureNonce !== null) {
        const stampedNonce = (model as { capture?: { nonce?: unknown } }).capture?.nonce;
        if (stampedNonce !== expectedCaptureNonce) {
          demoErrors.push(
            "demo.json does not embed this run's capture nonce — the evidence was not produced by this orchestrated capture run (stale, replayed, or hand-written; or the capture engine silently no-opped — see the unifier.demo-capture event). Fix the checkpoint commands so `forge demo capture` can produce real evidence; never author beforeOutput/afterOutput by hand.",
          );
        }
      }
    } catch (err) {
      demoErrors = [`demo.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`];
    }
  }
  // N2 producibility: unrunnable checkpoint commands fail the demo contract
  // with the actionable problem list (the capture spawn was skipped above).
  if (captureProblems.length > 0) {
    demoErrors.push(...captureProblems.map((p) => `demo capture command not producible: ${p}`));
  }
  const demoOk = demoErrors.length === 0;
  let prBodyOk = false;
  if (existsSync(prDescPath)) {
    let body = '';
    try {
      body = readFileSync(prDescPath, 'utf8');
    } catch {
      body = '';
    }
    // git-truth Why/What/How shape — NOT `## Demo` (pr.ts appends that at PR-open).
    prBodyOk = prBodyHasGitTruthSections(body);
  }
  if (!demoOk || !prBodyOk) {
    const failReasons: string[] = [];
    if (!demoOk) failReasons.push(`demo.json errors: ${demoErrors.join('; ')}`);
    if (!prBodyOk) failReasons.push('pr-description.md missing or lacks Why/What/How');
    emitSubCheck('pr_self_contained', false, failReasons.join(' | '));
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      // Keep the 'demo.json' token so the failure-classifier catches it.
      message: 'unifier.gate.pr-not-self-contained (demo.json / pr-description)',
      metadata: {
        failure_class: 'dev-loop-unifier-demo-failed',
        demo_json_ok: demoOk,
        demo_errors: demoErrors,
        pr_body_ok: prBodyOk,
      },
    });
    failFeedback('pr_self_contained', [
      'The PR is not self-contained yet:',
      ...(demoOk ? [] : [`- demo.json (${demoDir}/demo.json) errors: ${demoErrors.join('; ')}`]),
      ...(prBodyOk ? [] : ['- .forge/pr-description.md is missing or lacks the ## Why / ## What / ## How sections']),
    ]);
    input.onGateFailure?.({ checkId: 'pr_self_contained', exitCode: null, outputTail: failReasons.join(' | ') });
    return false;
  }
  emitSubCheck('pr_self_contained', true, 'demo.json valid + pr-description.md has Why/What/How');

  // 3. demo_fanin_honesty (plan 2.5) — the demo's metadata must describe the
  //    POST-fan-in branch, not the state some earlier unifier pass authored it
  //    against. Mechanical git metadata (diffStat) is re-derived and refreshed
  //    in place by the ORCHESTRATOR (same ownership rule as capture, ADR 036);
  //    identity claims (liveEvidence ids, the demo's initiativeId) are NEVER
  //    silently fixed — stale ones fail the gate with the stale + fresh ids
  //    named, so nothing merges asserting evidence the branch does not hold.
  {
    const honesty = checkDemoFanInHonesty({
      worktreePath,
      demoJsonPath,
      initiativeId: input.initiativeId,
    });
    if (honesty.refreshedDiffStat) {
      // Commit (and push) the refreshed metadata so the branch — and the PR —
      // carry the re-derived truth, and branches_in_sync keeps holding.
      const committed = commitOrchestratedCaptureArtifacts(
        worktreePath,
        demoDir,
        input.initiativeId,
        `chore(demo): refresh demo metadata after fan-in (${input.initiativeId})`,
      );
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'log',
        input_refs: [demoJsonPath],
        output_refs: [demoJsonPath],
        message: 'unifier.demo-metadata-refreshed',
        metadata: {
          field: 'diffStat',
          from: honesty.refreshedDiffStat.from,
          to: honesty.refreshedDiffStat.to,
          committed,
        },
      });
    }
    if (!honesty.ok) {
      const detail = honesty.failures.join(' | ');
      emitSubCheck('demo_fanin_honesty', false, detail);
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [demoJsonPath],
        output_refs: [],
        // Keep the 'demo.json' token so the failure-classifier catches it.
        message: 'unifier.gate.demo-stale-after-fanin (demo.json)',
        metadata: {
          failure_class: 'dev-loop-unifier-demo-stale',
          failures: honesty.failures,
          stale_evidence: honesty.staleEvidence,
          fresh_evidence_urls: honesty.freshEvidenceUrls,
        },
      });
      failFeedback('demo_fanin_honesty', [
        'demo.json is STALE against the post-fan-in branch — it asserts state from an earlier pass:',
        ...honesty.failures.map((f) => `- ${f}`),
        '',
        `Fix: re-run \`forge demo render ${input.initiativeId}\` from the worktree root against branch tip`,
        '(it back-fills the CURRENT .forge/live-evidence/), verify the demo describes THIS initiative,',
        'then commit and push. Do NOT hand-edit evidence urls or outputs.',
      ]);
      input.onGateFailure?.({ checkId: 'demo_fanin_honesty', exitCode: null, outputTail: detail });
      return false;
    }
    emitSubCheck(
      'demo_fanin_honesty',
      true,
      honesty.refreshedDiffStat
        ? 'demo metadata matches the post-fan-in branch (diffStat re-derived + refreshed)'
        : 'demo metadata matches the post-fan-in branch',
    );
  }

  // 4. branches_in_sync
  try {
    assertLocalRemoteSynced(worktreePath);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emitSubCheck('branches_in_sync', false, `branch divergence: ${errMsg}`);
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'unifier.gate.branches-not-in-sync',
      metadata: {
        failure_class: 'dev-loop-unifier-branch-divergence',
        error: errMsg,
      },
    });
    failFeedback('branches_in_sync', [
      'Local and remote branches have diverged — push the branch so origin matches local HEAD.',
      `Detail: ${errMsg}`,
    ]);
    input.onGateFailure?.({ checkId: 'branches_in_sync', exitCode: null, outputTail: errMsg });
    return false;
  }
  emitSubCheck('branches_in_sync', true, 'local HEAD matches origin HEAD');

  // 5. incomplete_delivery (Wave B, 2026-06-04): every WI's declared
  //    `creates[]` paths must appear in `git diff --name-only main...HEAD`.
  //    WIs with empty `creates` are exempt. This catches the INIT-2
  //    release_folder scenario: WI-3 was skipped (gate-too-loose misfire)
  //    but the unifier's full-gate still passed on WI-1's work, opening
  //    a PR that silently lacked WI-3's declared acc test + docs.
  {
    const delivery = collectMissingDeliveries(worktreePath, input.workItemsDir);
    if (delivery.indeterminate) {
      // re-review #2: fail CLOSED — we could not verify the WIs delivered their
      // declared outputs, so do NOT open a PR that might silently omit work.
      emitSubCheck('complete_delivery', false, `delivery check indeterminate: ${delivery.reason}`);
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [worktreePath],
        output_refs: [],
        message: 'unifier.gate.delivery-indeterminate',
        metadata: { failure_class: 'delivery-indeterminate', reason: delivery.reason },
      });
      failFeedback('complete_delivery', [
        'The delivery-completeness check could not be computed (fails closed).',
        `Reason: ${delivery.reason}`,
      ]);
      input.onGateFailure?.({
        checkId: 'complete_delivery',
        exitCode: null,
        outputTail: `delivery check indeterminate: ${delivery.reason}`,
      });
      return false;
    }
    if (delivery.missing.length > 0) {
      const missingPaths = delivery.missing.map((m) => m.path).join(', ');
      emitSubCheck('complete_delivery', false, `missing declared paths: ${missingPaths}`);
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'unifier',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [worktreePath],
        output_refs: [],
        message: 'unifier.gate.incomplete-delivery',
        metadata: {
          failure_class: 'incomplete-delivery',
          missing: delivery.missing,
        },
      });
      failFeedback('complete_delivery', [
        'Declared WI output paths are MISSING from the branch diff (git diff --name-only main...HEAD):',
        ...delivery.missing.map((m) => `- ${m.path} (${m.work_item_id})`),
        'Create each missing path (a compiling stub satisfies the path check), commit, and push.',
      ]);
      input.onGateFailure?.({
        checkId: 'complete_delivery',
        exitCode: null,
        outputTail: `missing declared paths: ${missingPaths}`,
      });
      return false;
    }
    emitSubCheck('complete_delivery', true, 'all declared creates[] paths present in branch diff');
  }

  // Composed gate PASSED — remove the feedback file so a later session never
  // reads a fossil (the 2026-07-04 stale-last-gate-failure theme).
  clearUnifierGateFeedback(worktreePath);
  return true;
}

/**
 * Persist the composed unifier gate's failing verdict to
 * `.forge/last-gate-failure.md` — the SAME live-gate-feedback seam the
 * dev-loop uses — so the next unifier iteration fixes exactly what the
 * orchestrator's own gate run reported instead of re-deriving it. Deleted on
 * a passing composed gate and at unifier start, so "present ⇒ fresh".
 */
function writeUnifierGateFeedback(worktreePath: string, checkId: string, lines: string[]): void {
  try {
    const body = [
      `# Live quality-gate failure — AUTHORITATIVE (forge unifier composed gate: ${checkId})`,
      '',
      'This is the result of the orchestrator\'s OWN gate run — the same composed gate that',
      'decides whether the PR can open. Forge deletes this file at unifier start and after',
      'every passing gate run, so if you are reading it, it is FRESH. Fix exactly what is',
      'below; the initiative is NOT review-ready until this file disappears.',
      '',
      ...lines,
      '',
    ].join('\n');
    mkdirSync(join(worktreePath, '.forge'), { recursive: true });
    writeFileSync(lastGateFailurePath(worktreePath), body);
  } catch {
    /* best-effort — never throw out of the gate */
  }
}

/** Delete `.forge/last-gate-failure.md` (passing gate / fresh unifier session). */
export function clearUnifierGateFeedback(worktreePath: string): void {
  try {
    const p = lastGateFailurePath(worktreePath);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

/**
 * Wave B (2026-06-04): collect WI-declared `creates[]` paths that are absent
 * from the branch diff. Returns an array of `{ work_item_id, path }` pairs.
 * Empty array means all declared deliverables are present (gate passes).
 *
 * WIs with empty `creates` are exempt — a verify-only or refactoring WI that
 * produces no new files is a valid PM choice and must not block the unifier.
 *
 * Exported for unit testing.
 */
export type MissingDelivery = { work_item_id: string; path: string };

/**
 * Delivery-completeness check result. `indeterminate` means the check could
 * NOT be computed (git base undetectable / git unavailable / WI parse failure).
 *
 * re-review #2: this is the LAST backstop stopping a PR that omits declared
 * outputs (and the only backstop behind the `already-complete` shortcut), so it
 * fails CLOSED — an indeterminate result BLOCKS the PR with a distinct reason,
 * rather than the old fail-OPEN behaviour that returned `[]` and silently let a
 * possibly-incomplete delivery through looking review-ready.
 */
export type DeliveryCheck =
  | { indeterminate: false; missing: MissingDelivery[] }
  | { indeterminate: true; reason: string };

export function collectMissingDeliveries(
  worktreePath: string,
  workItemsDir: string,
): DeliveryCheck {
  // Compute the branch diff once.
  let diffPaths: Set<string>;
  try {
    let base = '';
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' }).trim();
    if (git(['rev-parse', '--verify', 'main']).length > 0) base = 'main';
    else if (git(['rev-parse', '--verify', 'master']).length > 0) base = 'master';
    if (!base) {
      return { indeterminate: true, reason: 'cannot verify delivery: no base branch (neither main nor master) in the worktree' };
    }
    const lines = git(['diff', '--name-only', `${base}...HEAD`])
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    diffPaths = new Set(lines);
  } catch (err) {
    return { indeterminate: true, reason: `cannot verify delivery: git diff failed (${err instanceof Error ? err.message : String(err)})` };
  }

  // Read the WI set and check each WI's creates[].
  let items: import('../work-item.ts').WorkItem[];
  try {
    items = readWorkItemsFromDir(workItemsDir).items;
  } catch (err) {
    return { indeterminate: true, reason: `cannot verify delivery: work items unreadable (${err instanceof Error ? err.message : String(err)})` };
  }

  const missing: MissingDelivery[] = [];
  for (const wi of items) {
    if (!wi.creates || wi.creates.length === 0) continue; // exempt
    for (const p of wi.creates) {
      if (!diffPaths.has(p)) {
        missing.push({ work_item_id: wi.work_item_id, path: p });
      }
    }
  }
  return { indeterminate: false, missing };
}

type ShellGateResult = {
  passed: boolean;
  errored: boolean;
  timedOut: boolean;
  stderr: string;
  /** G4: the gate command's exit code — 0 on pass, null when it never ran / was killed. */
  exitCode: number | null;
};

/**
 * Run a unifier gate command. Distinguishes a gate that RAN and returned
 * non-zero (test/build fail) from a gate that could NOT RUN at all (missing
 * binary / EACCES / killed by signal) — the latter is a broken gate, not a
 * delivery failure (re-review #1) — and (N10) from a gate KILLED by our own
 * `timeoutMs`, which is an ENVIRONMENT failure, never a work failure.
 */
function runShellGate(worktreePath: string, cmd: string[], timeoutMs?: number, unsetEnv?: readonly string[]): ShellGateResult {
  if (cmd.length === 0 || !cmd[0]) return { passed: false, errored: true, timedOut: false, stderr: 'empty gate command', exitCode: null };
  const [head, ...rest] = cmd;
  const startedAt = Date.now();
  // R5-02 F2: strip the project's declared ci_gate_unset_env (e.g. TF_ACC)
  // before this gate's child process runs — mirrors runGateCapturing's strip.
  let gateEnv: NodeJS.ProcessEnv | undefined;
  if (unsetEnv && unsetEnv.length > 0) {
    gateEnv = { ...process.env };
    for (const name of unsetEnv) delete gateEnv[name];
  }
  try {
    execFileSync(head, rest, {
      cwd: worktreePath,
      stdio: 'pipe',
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
      ...(gateEnv ? { env: gateEnv } : {}),
    });
    return { passed: true, errored: false, timedOut: false, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { status?: number | null; code?: string; signal?: string; message?: string; stderr?: Buffer | string };
    const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8')) : (e.message ?? '');
    const killedBySignal = !!e.signal && (e.status === null || e.status === undefined);
    const deadlineElapsed = timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs;
    const timedOut = e.code === 'ETIMEDOUT' || (killedBySignal && deadlineElapsed);
    const errored = !timedOut && (e.code === 'ENOENT' || e.code === 'EACCES' || killedBySignal);
    return { passed: false, errored, timedOut, stderr, exitCode: typeof e.status === 'number' ? e.status : null };
  }
}
