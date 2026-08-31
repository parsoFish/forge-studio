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
import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';

import type { EventLogger } from '@forge/kernel';
import { classifyCrash } from '@forge/agents/failure-classifier.ts';
import {
  DEV_ALLOWED_TOOLS,
  DEV_DISALLOWED_TOOLS,
  DEV_FANOUT_CONCURRENCY_CAP,
  DEV_MODEL,
  devAgentSpec,
  buildDevSystemPrompt,
  prepareDevWorkspace,
  tallyToolUse as tallyDevToolUse,
  type DevToolUseSummary,
} from './dev-binding.ts';
import {
  gateRequiredPaths,
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItemStatus,
  type WorkItem,
} from '@forge/flows/work-item.ts';
import { type QueryFn, type ClaudeAgentOptions } from '@forge/agents/ralph/claude-agent.ts';
import { getAdapter, resolveSdkId } from '@forge/agents/_adapters/registry.ts';
import type { AgentInvocation } from '@forge/agents/_adapters/types.ts';
import { makeToolEventSink } from '@forge/agents/tool-event-emit.ts';
import { run as runRalph, type LoopResult } from '@forge/agents/ralph/runner.ts';
import { matchesRateLimitSignature } from '@forge/agents/failure-classifier.ts';
import { createWiWorktree, removeWiWorktree } from '@forge/flows/wi-worktree.ts';
import { createMergeQueue, mergeAndPublish, type MergeConflictDetail } from '@forge/flows/wi-merge-back.ts';
import { makeQualityGateFromCmd, resolveGateTimeoutMs, type GateRunInfo } from '@forge/agents/ralph/stop-conditions.ts';
import { assertLocalRemoteSynced, checkLocalRemoteSynced, type PushResult } from '@forge/flows/pr.ts';
import {
  resolveDevWiConcurrency,
  ralphGitIdentity,
  UNIFIER_GIT_IDENTITY,
  type GitIdentity,
} from '@forge/kernel';
import { runConcurrentDispatch, type DispatchOutcome } from '@forge/flows/wi-dispatch-scheduler.ts';
import { loadProjectConfig, type AcceptanceGateConfig, type ProjectConfig } from '@forge/projects/project-config.ts';
import type { CycleInput } from '@forge/flows/cycle-context.ts';

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
  // R2-03-F4: the flow node's wedge-kill signal, now CHAINED into each per-WI
  // Ralph iteration (claude-agent.ts `externalSignal`) so a wedge-kill cancels
  // the in-flight per-item CLI subprocesses, not just the outer phase promise.
  signal?: AbortSignal,
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
  // ADR 019: resume-from-demo skips the per-WI dev-loop entirely — the WI
  // commits already exist on the preserved branch from the prior cycle. We
  // still read + validate the WI set above (the post-develop band uses it for
  // context), but run the per-WI loop over an empty list so the walk re-enters
  // at the `demo` node without rebuilding any WI.
  // ADR 040: resume-from-develop (the fix loop) RUNS the full list — prior WIs
  // fast-exit via the iter-0 already-complete shortcut, fix WIs build.
  const resumeFromDemo = input.resumeFrom === 'demo';
  const toRun = resumeFromDemo ? [] : ordered;

  // cascade-v4 #2: establish a known-green baseline ONCE before any WI work.
  // On a fresh (non-resume) dev-loop the worktree sits at the initiative
  // branch's base (== main's HEAD) before any WI commit, so the project-level
  // gate here measures the *baseline*. A pre-existing red suite (or missing
  // deps / a gitignored fixture) is otherwise invisible until the unifier,
  // which then can't tell "my changes broke it" from "it was already broken"
  // and burns its whole budget. Fail fast with a distinct diagnosis instead.
  // Skipped on ANY resume (the branch already carries the WI commits — not a
  // baseline; ADR 040's develop re-entry included).
  if (!input.resumeFrom) {
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
  let localGateTimeoutMs: number | undefined;
  try {
    const projectCfg = loadProjectConfig(input.worktreePath);
    accGate = projectCfg?.acceptance_gate;
    ciGateUnsetEnv = projectCfg?.ci_gate_unset_env;
    localGateTimeoutMs = projectCfg?.testProcess.local.timeoutMs;
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
        // W8-B6 — developer-ralph's own bound library hooks, derived from its
        // SKILL.md path (never a copy carried on the spec). The dev loop
        // spawns one SDK session per Ralph iteration, so hooks fire per
        // iteration, which is the SDK's own session semantics.
        ...(() => {
          const hooks = sdkHooksForAgent({
            skill: devAgentSpec.skill,
            logger,
            initiativeId: input.initiativeId,
          });
          return hooks !== undefined ? { hooks } : {};
        })(),
        maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
        // Per CONTRACTS.md C19: no $ cap on the per-WI Ralph.
        queryFn: tallyingQueryFn,
        // R2-03-F4: chain the node wedge-kill into this WI's Ralph iterations.
        ...(signal ? { externalSignal: signal } : {}),
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
      // R2-03-F4: a wedge-kill mid-flight must not spawn a fresh retry attempt.
      if (signal?.aborted) { runnerError = { kind: 'aborted', message: 'wedge-kill: node aborted' }; break; }
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
                // R1-03-F1: env override > declared testProcess.local.timeoutMs > default.
                timeoutMs: resolveGateTimeoutMs(localGateTimeoutMs),
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

      // R2-03-F4: a wedge-kill that fires MID-attempt surfaces here as a thrown
      // abort — it must not be misclassified as a transient agent crash and
      // retried (that would re-spawn the very work the kill was meant to stop).
      // Reclassify to `aborted` and break, mirroring the between-attempt guard
      // at the top of this loop.
      if (runnerError && signal?.aborted) {
        runnerError = { kind: 'aborted', message: 'wedge-kill: node aborted mid-attempt' };
        break;
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
    // M0-A Task 1: consult the flow's cost ceiling BEFORE this WI's worktree
    // is created — a per-WI boundary check, reusing the SAME "skip before
    // any work starts" shape as the environment-failure skip above
    // (leave the status file untouched — i.e. still `pending` — so the WI
    // stays resumable; never mark it `failed`). Absent ⇒ today's behaviour
    // exactly (no dev-loop caller wires this in yet outside flow-runner).
    const costStopReason = input.shouldStopBeforeWorkItem?.() ?? null;
    if (costStopReason) {
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
        output_refs: [],
        message: 'ralph.skipped',
        metadata: {
          work_item_id: wi.work_item_id,
          reason: costStopReason,
          failure_kind: 'cost-ceiling',
        },
      });
      // Mirrors the `environment-failure` skip (above, in
      // runWiDispatchTask): status 'pending' + `environment: true` so
      // dependents are blocked-not-failed and the whole wave stays
      // resumable, never cascading a false `failed`.
      settleWiOutcome(wiOutcomes, { id: wi.work_item_id, status: 'pending', result: null, environment: true });
      return { requeue: false };
    }
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
    // R2-03-F4: the fanout agent's declared concurrencyCap is the definition-
    // level source (env still overrides). developer-ralph declares 1 ⇒
    // byte-identical to the pre-F4 default.
    cap: resolveDevWiConcurrency(undefined, DEV_FANOUT_CONCURRENCY_CAP),
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
      resumed: resumeFromDemo,
      // ADR 040: which resume kind, when any — 'develop' is the fix-loop
      // re-entry (full list run, prior WIs fast-exit).
      ...(input.resumeFrom ? { resumed_from: input.resumeFrom } : {}),
    },
  });

  // Partial dev-loop completion is NOT fatal to the cycle. The reviewer's
  // send-back loop is the gap-filler — once gates flip green from any WI
  // and src/ is non-empty, the reviewer can run, the simulator/human can
  // identify what's missing, and feedback rounds can complete the work.
  // Only throw when ZERO WIs succeeded (total dev-loop failure); otherwise
  // emit the partial outcome and hand off to the post-develop band.
  // ADR 019: on resume-from-demo zero WIs run by design (their commits are
  // already on the branch), so the total-failure guard must not fire.
  if (!resumeFromDemo && completeCount === 0 && items.length > 0) {
    throw new Error(
      `developer-loop: 0/${items.length} work items completed — total failure`,
    );
  }

  // The dev-loop phase ends here, with only the per-WI work on the branch. The
  // post-develop band (demo → adversarial-review → verdict, R4-10-F1) runs as
  // its own flow nodes after this; on a resume the flow-runner skips this dev
  // node entirely and re-enters at the demo node (resume_from:'demo', R4-10-F6).
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
 * `developer-loop-close-sync.test.ts`). Production callers reach this via the
 * post-develop band's close contract (execDemo, R4-10-F1).
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
  // Optional so the R4-10-F1 demo node can emit the delivery ground-truth
  // (the reflector's grounding event) without threading a per-node parent id.
  parentEventId?: string,
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
      // R1-03-F1: env override > declared testProcess.local.timeoutMs > default.
      timeoutMs: resolveGateTimeoutMs(projectConfig?.testProcess.local.timeoutMs),
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
