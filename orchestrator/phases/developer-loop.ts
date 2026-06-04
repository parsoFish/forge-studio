/**
 * Developer-loop phase runner. Extracted from cycle.ts (Phase 3.4c step 4).
 *
 * Walks the work items in topological order, running a Ralph loop per WI and
 * skipping dependents of failed prerequisites. Behaviour is identical to the
 * prior in-cycle implementation — this module only relocates the code so the
 * orchestration spine stays thin.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from '../logging.ts';
import {
  DEV_ALLOWED_TOOLS,
  DEV_DISALLOWED_TOOLS,
  DEV_MODEL,
  buildDevSystemPrompt,
  prepareDevWorkspace,
  tallyToolUse as tallyDevToolUse,
  type DevToolUseSummary,
} from '../dev-invocation.ts';
import {
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItemStatus,
  type WorkItem,
} from '../work-item.ts';
import { createClaudeAgent, type QueryFn } from '../../loops/ralph/claude-agent.ts';
import { makeToolEventSink } from '../tool-event-emit.ts';
import { run as runRalph, type LoopResult } from '../../loops/ralph/runner.ts';
import { makeQualityGateFromCmd, type GateRunInfo } from '../../loops/ralph/stop-conditions.ts';
import { assertLocalRemoteSynced, checkLocalRemoteSynced, pushInitiativeBranch } from '../pr.ts';
import {
  buildUnifierSystemPrompt,
  prepareUnifierWorkspace,
  UNIFIER_DEFAULT_ITERATION_CAP,
  unifierAgentSpec,
} from '../unifier-invocation.ts';
import { modelForSpec } from '../phase-agent.ts';
import { loadProjectConfig, type ProjectConfig } from '../project-config.ts';
import { validateDemoModel } from '../../cli/demo-model.ts';
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

export async function runDeveloperLoop(
  input: CycleInput,
  logger: EventLogger,
): Promise<{ unifierSucceeded: boolean; unifierFailureClass: string | null; commitsAhead: number; filesChanged: number; insertions: number }> {
  const workItemsDir = resolve(input.worktreePath, '.forge/work-items');
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'start',
    input_refs: [workItemsDir],
    output_refs: [],
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

  const wiOutcomes: Array<{ id: string; status: WorkItem['status']; result: LoopResult | null }> = [];

  for (const wi of toRun) {
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

    if (prerequisiteFailed(wi, wiOutcomes)) {
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
      wiOutcomes.push({ id: wi.work_item_id, status: 'failed', result: null });
      continue;
    }

    const specPath = resolve(workItemsDir, `${wi.work_item_id}.md`);
    const wiToolUse: DevToolUseSummary = { reads: 0, brainReads: 0, writes: 0, bashCalls: 0, testRuns: 0 };

    // F-40: wipe AGENT.md / fix_plan.md / PROMPT.md between WIs. The dev-loop
    // runs N WIs sequentially against the same worktree; without this, WI-2's
    // agent inherits WI-1's institutional memory and ticked-off fix_plan,
    // looks at the satisfied checklist, and exits immediately with "all ACs
    // verified" — never reading its own WI.md. Reviewer already calls
    // wipeRalphScratch for the same reason (different role, different state);
    // the dev-loop needs the same treatment per WI. Diagnosed from the
    // 2026-05-10T21:32 cycle where WI-2..7 had 0 writes each because the
    // agent read WI-1.md, not WI-2.md.
    wipeRalphScratch(input.worktreePath);

    prepareDevWorkspace({
      initiativeId: input.initiativeId,
      workItemSpecPath: specPath,
      workItemSpecRelPath: `.forge/work-items/${wi.work_item_id}.md`,
      worktreePath: input.worktreePath,
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

    // Phase A — per-tool live telemetry sink for this WI. Emits sampled
    // `tool_use` / `file_change` / `agent_heartbeat` events mid-iteration so
    // the operator UI pulses live; coalesced summary flushed per iteration.
    const wiToolSink = makeToolEventSink(logger, {
      initiativeId: input.initiativeId,
      parentEventId: wiStart.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      workItemId: wi.work_item_id,
    });

    const agent = createClaudeAgent({
      model: DEV_MODEL,
      allowedTools: [...DEV_ALLOWED_TOOLS],
      disallowedTools: [...DEV_DISALLOWED_TOOLS],
      permissionMode: 'acceptEdits',
      systemPrompt,
      maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
      // Per CONTRACTS.md C19: no $ cap on the per-WI Ralph.
      queryFn: tallyingQueryFn,
      onToolUse: wiToolSink.onToolUse,
      onHeartbeat: wiToolSink.onHeartbeat,
    });

    let result: LoopResult | null = null;
    let runnerError: { kind: string; message: string } | undefined;
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
          worktreePath: input.worktreePath,
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
            return makeQualityGateFromCmd(
              input.worktreePath,
              effective,
              (gateInfo) => { lastGateErrored = gateInfo.errored ?? false; emitGateEvent(logger, input.initiativeId, wiStart.event_id, wi.work_item_id, gateInfo); },
              // Wave B (2026-06-04): enforce that declared output paths land.
              // If the WI declares `creates` paths those MUST appear in the
              // branch diff before the gate can pass — independently of whether
              // a sibling WI already produced tests. The `already-complete`
              // 3-way runner check handles the "sibling beat us" case upstream;
              // this layer catches "agent exited without writing declared files".
              { requiredPaths: wi.creates ?? [] },
            );
          })(),
          // re-review #3: the runner only takes the `already-complete` shortcut
          // when ALL of THIS WI's declared outputs are on the branch (a sibling
          // genuinely delivered them) — not on a bare "branch has a commit".
          requiredPaths: wi.creates ?? [],
          // re-review #1: stop early if the gate command can't RUN (broken
          // gate) rather than iterating against it and burning the budget.
          gateErrored: () => lastGateErrored,
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
    const finalStatus: WorkItem['status'] = runnerError
      ? 'failed'
      : result?.status === 'complete'
        ? 'complete'
        : 'failed';
    writeWorkItemStatus(specPath, finalStatus);

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
      },
    });

    // G8: push the initiative branch to origin after every WI so local ==
    // remote throughout the dev-loop (no divergence → no stacked-PR merge
    // conflict at the review boundary). The agent's per-iteration commit
    // (backstopped by commitDevLoopBoundary) is already on the branch;
    // publishing it now keeps origin in lock-step.
    //
    // Push failure is a HARD EARLY-EXIT (post-2026-05-23 dogfood pushback):
    // if the push fails (e.g. remote ahead from a prior cycle's stale
    // state), every subsequent WI runs on a branch that won't merge
    // cleanly. The previous best-effort posture wasted tokens by
    // continuing through 4-5 more WIs on a broken branch before the close
    // invariant caught it.
    const push = pushInitiativeBranch(input.worktreePath);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: wiStart.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: push.pushed ? 'log' : 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: push.pushed ? 'dev-loop.branch-pushed' : 'dev-loop.branch-push-failed',
      metadata: push.pushed
        ? { work_item_id: wi.work_item_id, branch: push.branch }
        : { work_item_id: wi.work_item_id, reason: push.reason, early_exit: true },
    });

    wiOutcomes.push({ id: wi.work_item_id, status: finalStatus, result });

    if (!push.pushed) {
      // Mark every WI we won't reach as 'failed' with reason
      // 'branch-push-failed-early-exit' — mirrors the prerequisiteFailed
      // path's shape so metrics + cycle report stay accurate. Then break
      // out of the loop; the close-step invariant + failure classifier
      // take it from here.
      const currentIndex = ordered.findIndex((w) => w.work_item_id === wi.work_item_id);
      for (let i = currentIndex + 1; i < ordered.length; i++) {
        const skipped = ordered[i]!;
        writeWorkItemStatus(resolve(workItemsDir, `${skipped.work_item_id}.md`), 'failed');
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: start.event_id,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'log',
          input_refs: [resolve(workItemsDir, `${skipped.work_item_id}.md`)],
          output_refs: [],
          message: 'ralph.skipped',
          metadata: { work_item_id: skipped.work_item_id, reason: 'branch-push-failed-early-exit' },
        });
        wiOutcomes.push({ id: skipped.work_item_id, status: 'failed', result: null });
      }
      break;
    }
  }

  const completeCount = wiOutcomes.filter((o) => o.status === 'complete').length;
  const totalCost = wiOutcomes.reduce((acc, o) => acc + (o.result?.cost_usd ?? 0), 0);

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

  // S4: run the unifier sub-phase. The unifier owns the initiative-level
  // ACs, the tracked demo bundle, and the PR description. It runs once per
  // dev-loop (initial-prep mode) or once per send-back round
  // (`--feedback-ref` mode triggered by the review router). The Ralph
  // runner is reused with a different system prompt + iteration cap +
  // composed quality gates. Failures are classified per council 04 F7:
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
  // Note: `cycle.ts:enforceDevLoopCloseInvariant` ALSO asserts this same
  // invariant immediately after `runDeveloperLoop` returns. The two calls
  // are deliberately additive (not duplicative): this one is the
  // dev-loop-PHASE'S own boundary check (phase-scoped event), the
  // cycle-level one runs AFTER `commitDevLoopBoundary` may have added
  // one more commit + push. Both are idempotent reads against git state.
  assertDevLoopCloseSync(input.worktreePath, logger, input.initiativeId);

  // cascade-v4 #1: emit the authoritative DELIVERY ground truth (git
  // diff-stat of the branch's net contribution) while the branch + base still
  // exist. The reflector grounds "what was delivered" in THIS event, not in
  // per-WI status counts — which can read stale `failed:N` on a resume even
  // though the branch carries merged, tested code (the cascade-v4 wrong-theme).
  const deliveryStat = emitDeliverySummary(input, logger, start.event_id);

  // cascade-v4 #3: surface the unifier outcome so cycle.ts can gate PR
  // creation — a unifier that did not pass its composed gate must NOT yield a
  // reviewable (mergeable) PR.
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
 * this only via `runDeveloperLoop`'s close path.
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

function prerequisiteFailed(
  wi: WorkItem,
  outcomes: Array<{ id: string; status: WorkItem['status'] }>,
): boolean {
  if (wi.depends_on.length === 0) return false;
  const byId = new Map(outcomes.map((o) => [o.id, o.status] as const));
  for (const dep of wi.depends_on) {
    const status = byId.get(dep);
    if (status === 'failed') return true;
  }
  return false;
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
  const isExpectedIter0Fail = !info.passed && !info.errored && info.iteration === 0;
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: parentEventId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: info.passed || isExpectedIter0Fail ? 'log' : 'error',
    input_refs: [],
    output_refs: [],
    duration_ms: info.durationMs,
    message: info.errored
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
      ...(info.rejectReason ? { reject_reason: info.rejectReason } : {}),
      ...(info.iteration !== undefined ? { iteration: info.iteration } : {}),
      ...(isExpectedIter0Fail ? { expected_fail: true } : {}),
    },
  });
}

/**
 * S4 — run the developer-unifier sub-phase. Treats the initiative as one PR;
 * proves every AC against branch tip; authors demo + PR body; pushes; asserts
 * branch sync. The unifier reuses the Ralph runner with:
 *
 *   - System prompt: `buildUnifierSystemPrompt()` (SKILL.md + Ralph discipline)
 *   - Iteration cap: 3 (per CONTRACTS.md C19; no $ cap)
 *   - Quality gate: a composed `unifierQualityGate` checking all four
 *     gates (initiative, demo, pr-self-contained, branches-in-sync).
 *
 * In send-back mode (`input.unifierFeedbackRef` set per C3b), the prompt is
 * augmented and the iteration cap reset — every nudge is a fresh 3-iter run.
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

  // Pure exit-code check (noWorkIndicators: null) — the baseline question is
  // "is HEAD green", not "does the gate discriminate" (that is the per-WI
  // gate's job, enforced by the iter-0 hollow check).
  let info: GateRunInfo | undefined;
  const passed = makeQualityGateFromCmd(
    input.worktreePath,
    [...baselineCmd],
    (i) => { info = i; },
    { noWorkIndicators: null },
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
 * Send-back rounds keep the full cap (operator feedback may need several
 * passes). Best-effort: any measurement failure falls back to the full cap so a
 * real change is never under-budgeted. Exported for unit testing.
 */
export function unifierIterationCap(worktreePath: string, sendBackMode: boolean): number {
  if (sendBackMode) return UNIFIER_DEFAULT_ITERATION_CAP;
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
  // Wipe per-WI scratch files before stamping the unifier's prompts. The
  // unifier is a fresh mission with a different role; without this the
  // agent would inherit the last WI's ticked checklist.
  wipeRalphScratch(input.worktreePath);

  // Load the project config (mandatory per CONTRACTS.md C1 + council 04 F8).
  // The config tells the unifier which demo.shape to author and which
  // quality_gate_cmd to run.
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(input.projectRepoPath);
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'developer-loop',
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

  const demoShape = projectConfig?.demo.shape ?? 'none';
  const qualityGateCmd =
    projectConfig?.quality_gate_cmd ??
    input.qualityGateCmd ??
    (['npm', 'test'] as string[]);
  const feedbackRef = input.unifierFeedbackRef;

  // betterado #5: right-size the unifier loop to the diff. A trivial change (a
  // one-file test add) was burning ~15 iters / ~$11 packaging-only because the
  // cap was a flat 15. Scale it to the branch's diff size so packaging-only work
  // can't thrash for 9× the actual work. Send-back rounds keep the full cap
  // (the operator's feedback may legitimately need several passes).
  const iterationCap = unifierIterationCap(input.worktreePath, feedbackRef != null);

  const start = logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'developer-loop',
    skill: 'developer-unifier',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
    message: feedbackRef ? 'unifier.start (send-back)' : 'unifier.start',
    metadata: {
      demo_shape: demoShape,
      feedback_ref: feedbackRef ?? null,
      iteration_cap: iterationCap,
      // ADR 024 seam observability: the agent + tier the orchestrator spawned.
      agent_skill: unifierAgentSpec.skill,
      agent_tier: unifierAgentSpec.tier,
      model: modelForSpec(unifierAgentSpec),
    },
  });

  // Stamp PROMPT.md / AGENT.md / fix_plan.md for the unifier.
  const { promptPath } = prepareUnifierWorkspace({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreePath: input.worktreePath,
    iterationBudget: iterationCap,
    demoShape,
    qualityGateCmd,
    feedbackRef,
  });

  const systemPrompt = buildUnifierSystemPrompt();
  const sdkQueryFn = sdkQuery as unknown as QueryFn;

  // Phase A — per-tool live telemetry sink for the unifier (no work_item_id).
  const unifierToolSink = makeToolEventSink(logger, {
    initiativeId: input.initiativeId,
    parentEventId: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-unifier',
  });

  // ADR 024 seam: spawn the unifier from its declarative PhaseAgentSpec — the
  // orchestrator picks the model tier + tool policy and points the clean agent
  // at the skill it composes; it authors no intent here.
  const agent = createClaudeAgent({
    model: modelForSpec(unifierAgentSpec),
    allowedTools: [...unifierAgentSpec.allowedTools],
    disallowedTools: [...unifierAgentSpec.disallowedTools],
    permissionMode: 'acceptEdits',
    systemPrompt,
    maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
    // Per CONTRACTS.md C19: no $ cap on the unifier. Iteration cap is the only bound.
    queryFn: sdkQueryFn,
    onToolUse: unifierToolSink.onToolUse,
    onHeartbeat: unifierToolSink.onHeartbeat,
  });

  // Composed quality gate per plan 04 (5 gates after Wave B):
  //   1. initiative_gate (project quality_gate_cmd against branch tip)
  //   2. demo_runs_clean (demo.command exits 0 — excused for shape "none")
  //   3. pr_self_contained (demo.json valid + pr-description.md present)
  //   4. branches_in_sync (assertLocalRemoteSynced doesn't throw)
  //   5. incomplete_delivery (every WI's creates[] paths in diff)
  const unifierGate = async (): Promise<boolean> =>
    composedUnifierGate({
      worktreePath: input.worktreePath,
      initiativeId: input.initiativeId,
      qualityGateCmd,
      demoShape,
      demoCommand: projectConfig?.demo.command,
      logger,
      initiativeIdForEvent: input.initiativeId,
      parentEventId: start.event_id,
      workItemsDir: resolve(input.worktreePath, '.forge/work-items'),
    });

  let loopResult: LoopResult | null = null;
  let runnerError: string | null = null;
  try {
    loopResult = await runRalph(
      {
        workItemSpecPath: promptPath,
        worktreePath: input.worktreePath,
        initiativeBudget: {
          iterations: iterationCap,
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
        onIteration: (iteration, info) => {
          // Phase A — flush the per-tool sampler's coalesced remainder first.
          unifierToolSink.flushIteration(iteration);
          logger.emit({
            initiative_id: input.initiativeId,
            parent_event_id: start.event_id,
            phase: 'developer-loop',
            skill: 'developer-unifier',
            event_type: 'iteration',
            iteration,
            input_refs: [input.worktreePath],
            output_refs: info.filesChanged,
            cost_usd: info.costUsd,
            tokens_in: info.tokensIn,
            tokens_out: info.tokensOut,
            metadata: {
              tools_used: info.toolsUsed,
              bash_commands: info.bashCommands,
              last_assistant_text: info.lastAssistantText,
            },
          });
          // Finding #2 (2026-05-31 dogfood): the runner's per-iteration
          // autocommit (loops/ralph/runner.ts) commits a `forge-autocommit:` WIP
          // safety-net WITHOUT pushing, and the unifier loop previously only
          // pushed once at close — so mid-loop local HEAD sat one commit ahead of
          // origin and the gate's strict `branches_in_sync` sub-check
          // (origin == HEAD, orchestrator/pr.ts) was unsatisfiable for the rest of
          // the loop. The unifier then looped to its cap on `branches-not-in-sync`
          // even though the work was delivered. Push after every iteration (the
          // strip is append-only, so this is always a fast-forward) so the NEXT
          // gate check sees origin == HEAD. Mirrors the per-WI loop, which already
          // pushes per WI. No-origin projects (claude-harness) no-op the push.
          const iterSync = pushInitiativeBranch(input.worktreePath);
          if (!iterSync.pushed) {
            logger.emit({
              initiative_id: input.initiativeId,
              parent_event_id: start.event_id,
              phase: 'developer-loop',
              skill: 'developer-unifier',
              event_type: 'log',
              input_refs: [input.worktreePath],
              output_refs: [],
              message: 'unifier.iter-sync-push-skipped',
              metadata: { iteration, reason: iterSync.reason },
            });
          }
        },
      },
      agent,
    );
  } catch (err) {
    runnerError = err instanceof Error ? err.message : String(err);
  }

  // Push once more at unifier close, then assert sync. The unifier may have
  // committed the demo bundle + closing commit; push so origin matches local.
  const push = pushInitiativeBranch(input.worktreePath);
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-unifier',
    event_type: push.pushed ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: push.pushed ? 'unifier.branch-pushed' : 'unifier.branch-push-failed',
    metadata: push.pushed ? { branch: push.branch } : { reason: push.reason },
  });

  // Classify the unifier outcome.
  const succeeded = loopResult?.status === 'complete' && runnerError === null;
  let failureClass: string | null = null;
  if (!succeeded) {
    // Default classification — the composed gate's own events specialise
    // this further (dev-loop-unifier-{gate,demo}-failed are emitted from
    // inside composedUnifierGate when the relevant sub-gate fails).
    failureClass = 'dev-loop-unifier-gate-failed';
  }

  // Branch-divergence check (last). If branches aren't in sync, that
  // dominates the failure class — surface it specifically.
  try {
    assertLocalRemoteSynced(input.worktreePath);
  } catch {
    failureClass = 'dev-loop-unifier-branch-divergence';
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-unifier',
    event_type: succeeded ? 'end' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [input.worktreePath],
    duration_ms: loopResult?.duration_ms ?? 0,
    cost_usd: loopResult?.cost_usd ?? 0,
    message: succeeded ? 'unifier.end' : 'unifier.failed',
    metadata: {
      status: loopResult?.status ?? 'crashed',
      iterations: loopResult?.iterations ?? 0,
      stop_reason: loopResult?.stop_reason ?? 'crashed',
      demo_shape: demoShape,
      runner_error: runnerError,
      failure_class: failureClass,
    },
  });

  return { succeeded, failureClass };
}

type ComposedUnifierGateInput = {
  worktreePath: string;
  initiativeId: string;
  qualityGateCmd: string[];
  demoShape: import('../project-config.ts').DemoShape;
  demoCommand: string[] | undefined;
  logger: EventLogger;
  initiativeIdForEvent: string;
  parentEventId: string;
  /** Wave B (2026-06-04): path to the work-items dir for incomplete-delivery gate. */
  workItemsDir: string;
};

/**
 * Five-gate composed check the unifier must clear to exit clean:
 *   1. initiative_gate — project quality_gate_cmd against branch tip.
 *   2. demo_runs_clean — demo.command exits 0 (excused for shape "none").
 *   3. pr_self_contained — demo.json valid + pr-description.md present.
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

async function composedUnifierGate(input: ComposedUnifierGateInput): Promise<boolean> {
  const { worktreePath, initiativeId, qualityGateCmd, demoShape, demoCommand, logger } = input;

  // 1. initiative_gate
  const initiativeGate = runShellGate(worktreePath, qualityGateCmd);
  if (!initiativeGate.passed) {
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'developer-loop',
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
    return false;
  }

  // 2. demo_runs_clean — excused for shape "none"
  if (demoShape !== 'none' && demoCommand && demoCommand.length > 0) {
    const demoGate = runShellGate(worktreePath, demoCommand);
    if (!demoGate.passed) {
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'developer-loop',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [worktreePath],
        output_refs: [],
        message: demoGate.errored ? 'unifier.gate.errored' : 'unifier.gate.demo-failed',
        metadata: {
          failure_class: demoGate.errored ? 'dev-loop-unifier-gate-errored' : 'dev-loop-unifier-demo-failed',
          command: demoCommand,
          ...(demoGate.errored ? { gate_errored: true } : {}),
          gate_stderr_tail: demoGate.stderr.slice(-2000),
        },
      });
      return false;
    }
  }

  // 3. pr_self_contained (ADR 021: structured demo.json is the contract; DEMO.md
  //    is derived. The gate validates demo.json against the schema — the
  //    structural check that fixes free-form demo inconsistency.)
  const demoJsonPath = join(worktreePath, 'demo', initiativeId, 'demo.json');
  const prDescPath = join(worktreePath, '.forge', 'pr-description.md');
  let demoErrors: string[] = ['demo.json missing'];
  if (existsSync(demoJsonPath)) {
    try {
      demoErrors = validateDemoModel(JSON.parse(readFileSync(demoJsonPath, 'utf8')));
    } catch (err) {
      demoErrors = [`demo.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`];
    }
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
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'developer-loop',
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
    return false;
  }

  // 4. branches_in_sync
  try {
    assertLocalRemoteSynced(worktreePath);
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeIdForEvent,
      parent_event_id: input.parentEventId,
      phase: 'developer-loop',
      skill: 'developer-unifier',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'unifier.gate.branches-not-in-sync',
      metadata: {
        failure_class: 'dev-loop-unifier-branch-divergence',
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }

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
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'developer-loop',
        skill: 'developer-unifier',
        event_type: 'error',
        input_refs: [worktreePath],
        output_refs: [],
        message: 'unifier.gate.delivery-indeterminate',
        metadata: { failure_class: 'delivery-indeterminate', reason: delivery.reason },
      });
      return false;
    }
    if (delivery.missing.length > 0) {
      logger.emit({
        initiative_id: input.initiativeIdForEvent,
        parent_event_id: input.parentEventId,
        phase: 'developer-loop',
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
      return false;
    }
  }

  return true;
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

type ShellGateResult = { passed: boolean; errored: boolean; stderr: string };

/**
 * Run a unifier gate command. Distinguishes a gate that RAN and returned
 * non-zero (test/build fail) from a gate that could NOT RUN at all (missing
 * binary / EACCES / killed by signal) — the latter is a broken gate, not a
 * delivery failure (re-review #1). Callers emit a distinct `gate-errored`
 * class for the errored case and stop discarding stderr.
 */
function runShellGate(worktreePath: string, cmd: string[]): ShellGateResult {
  if (cmd.length === 0 || !cmd[0]) return { passed: false, errored: true, stderr: 'empty gate command' };
  const [head, ...rest] = cmd;
  try {
    execFileSync(head, rest, { cwd: worktreePath, stdio: 'pipe' });
    return { passed: true, errored: false, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; code?: string; signal?: string; message?: string; stderr?: Buffer | string };
    const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8')) : (e.message ?? '');
    const errored = e.code === 'ENOENT' || e.code === 'EACCES' || (!!e.signal && (e.status === null || e.status === undefined));
    return { passed: false, errored, stderr };
  }
}
