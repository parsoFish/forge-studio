/**
 * Run one initiative end-to-end:
 *   PM → developer-loop (per work item) → review-prep
 *
 * The orchestrator's only job is to thread phase outputs into the next phase's
 * inputs. Each phase is invoked by calling its skill via the Claude Agent SDK
 * (or, for the developer loop, via loops/ralph/runner.ts).
 *
 * STATUS: skeleton. Each phase invocation is a no-op stub that emits start/end
 * events to the log so the wiring is provable. Implementation lands per
 * docs/phases/<phase>.md.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from './logging.ts';
import { createLogger } from './logging.ts';
import {
  REVIEWER_ALLOWED_TOOLS,
  REVIEWER_DISALLOWED_TOOLS,
  REVIEWER_MODEL,
  buildReviewerSystemPrompt,
  prepareReviewerWorkspace,
  tallyToolUse as tallyReviewerToolUse,
  wipeRalphScratch,
  type ReviewerToolUseSummary,
} from './reviewer-invocation.ts';
import {
  makeReviewerQualityGate,
  type GetVerdict,
  type ReviewerGateState,
} from './reviewer-stage2.ts';
import { moveTo as moveQueueItem } from './queue.ts';
import { notify } from './notify.ts';
import { readWorkItemsFromDir } from './work-item.ts';
import { createClaudeAgent, type QueryFn } from '../loops/ralph/claude-agent.ts';
import { run as runRalph, type LoopResult } from '../loops/ralph/runner.ts';
import { classifyCycleFailure } from './failure-classifier.ts';
import { writeCycleReport } from './cycle-report.ts';
import { openPullRequest, mergePullRequest } from './pr.ts';
import { resolveNotifyConfig } from './config.ts';

// Shared cycle types + cross-runner helpers live in cycle-context.ts (the
// phase runners import them from there, never from this module — keeps the
// import graph acyclic). Re-exported here so the external surface
// (benchmarks/e2e, cli, scheduler, tests) keeps importing them from
// `./cycle.ts` unchanged.
export type {
  CycleInput,
  CycleResult,
  ReflectionStatus,
  ReviewerOutcome,
} from './cycle-context.ts';
export { recordBrainGateResult } from './cycle-context.ts';

// Internal uses within this module (re-export above doesn't bind names locally).
import type {
  CycleInput,
  CycleResult,
  ReflectionStatus,
  ReviewerOutcome,
} from './cycle-context.ts';
import { resolveQualityGateCmd } from './cycle-context.ts';

// Phase runners (extracted from this module — cycle.ts is the thin spine).
import { runProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop } from './phases/developer-loop.ts';
import { runReflector } from './phases/reflector.ts';

export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const started = Date.now();
  const cycleId = input.cycleId ?? newCycleId(input.initiativeId);
  const logger = createLogger(cycleId, '_logs', { tee: input.eventTee });

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
    message: input.dryRun ? 'cycle.start (dry run)' : 'cycle.start',
  });

  // F-04 / F-06: derive the effective quality-gate command once per cycle so
  // the dev-loop and reviewer use exactly the same gate. Precedence:
  //   1. CycleInput.qualityGateCmd (explicit override — bench harnesses use this)
  //   2. manifest.quality_gate_cmd (per-project config in initiative manifest)
  //   3. ['npm', 'test'] if the worktree has package.json
  //   4. ['true'] (no-op, tests bypassed) — only happens for non-Node repos
  //      that didn't declare a quality_gate_cmd; the dispatch will surface
  //      the absence via a metadata field.
  const effectiveQualityGateCmd = resolveQualityGateCmd(input);
  const inputWithGate: CycleInput = { ...input, qualityGateCmd: effectiveQualityGateCmd };

  let reviewerOutcome: ReviewerOutcome = 'ready-for-review';
  let reflectionStatus: ReflectionStatus = 'skipped';
  try {
    if (!input.dryRun) {
      await runProjectManager(inputWithGate, logger);
      await runDeveloperLoop(inputWithGate, logger);
      // Safety net: commit any uncommitted dev-loop work before the reviewer
      // starts. The dev-loop's prompt tells the agent to commit per
      // iteration, but if it skips, the reviewer's gh-shim does
      // `git reset --hard HEAD` and the source files vanish. This
      // boundary commit catches any drift. Files matching .gitignore
      // (Ralph scratch: PROMPT.md / AGENT.md / fix_plan.md, node_modules)
      // are excluded by `git add` automatically.
      commitDevLoopBoundary(inputWithGate.worktreePath, logger, inputWithGate.initiativeId);
      reviewerOutcome = await runReviewer(inputWithGate, logger);

      // Reflection: only fires after a successful merge. Log-and-continue —
      // a thrown reflector does not change the cycle's `status` (the merge
      // already happened; reflection cannot un-merge). Surface as separate
      // `reflection_status` telemetry instead.
      if (reviewerOutcome === 'merged') {
        reflectionStatus = await runReflector(inputWithGate, logger);
      }
    }
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: err instanceof Error ? err.message : String(err),
    });
    reviewerOutcome = 'ready-for-review'; // sentinel; overridden below to 'failed'
    // F-27: classify the failure mode from the event log so the scheduler
    // (and humans reading the cycle report) can see a concrete diagnosis
    // instead of grepping events.jsonl. The classifier reads the log we
    // just finished writing — including the orchestrator-level error event
    // emitted above.
    emitFailureClassification(logger, input.initiativeId, cycleId);
    const result: CycleResult = {
      cycle_id: cycleId,
      initiative_id: input.initiativeId,
      status: 'failed',
      reflection_status: reflectionStatus,
      duration_ms: Date.now() - started,
      log_path: logger.logFilePath,
    };
    // Snapshot artefacts + write report even on failure — failed cycles
    // still produce useful evidence for diagnosis. AWAIT the snapshot so
    // the report's "decomposition" / "verification" sections find the
    // copied work-items + demo dirs (otherwise the report runs before the
    // copy completes and silently shows the no-snapshot fallback).
    await snapshotCycleArtefacts(input, cycleId).catch(() => { /* best-effort */ });
    writeCycleReportSafely(cycleId);
    return result;
  }

  // Success path (no throw). Snapshot before cycle.end so the report can
  // include the cycle.end metadata and reference durable artefacts.
  await snapshotCycleArtefacts(input, cycleId).catch(() => { /* best-effort */ });

  const result: CycleResult = {
    cycle_id: cycleId,
    initiative_id: input.initiativeId,
    status: reviewerOutcome,
    reflection_status: reflectionStatus,
    duration_ms: Date.now() - started,
    log_path: logger.logFilePath,
  };

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'end',
    input_refs: [input.manifestPath],
    output_refs: [logger.logFilePath],
    duration_ms: result.duration_ms,
    message: 'cycle.end',
    metadata: { status: result.status, reflection_status: result.reflection_status },
  });

  // Generate the human-facing report as the final cycle step. Best-effort —
  // a failed report write does not fail the cycle (the merge already
  // happened; the report is meta).
  writeCycleReportSafely(cycleId);

  return result;
}

/**
 * Snapshot ephemeral cycle artefacts from the worktree to durable
 * `_logs/<cycleId>/` paths so they survive `worktree.cleanup()` and are
 * available for the cycle report (and re-generation later).
 *
 * Best-effort: missing dirs are skipped silently, copy failures are
 * surfaced via the returned promise rejection so the caller can decide
 * whether to log them.
 */
async function snapshotCycleArtefacts(
  input: CycleInput,
  cycleId: string,
): Promise<void> {
  const forgeRoot = resolve(import.meta.dirname, '..');
  const cycleLogDir = resolve(forgeRoot, '_logs', cycleId);
  if (!existsSync(cycleLogDir)) mkdirSync(cycleLogDir, { recursive: true });

  // Work-item specs: the PM's output, valuable evidence for the report's
  // "How the system decomposed it" section.
  const wiSrc = resolve(input.worktreePath, '.forge', 'work-items');
  if (existsSync(wiSrc)) {
    const wiDst = resolve(cycleLogDir, 'work-items-snapshot');
    cpSync(wiSrc, wiDst, { recursive: true, force: true });
  }

  // Demo bundle: the reviewer's recording + source script + README. Real
  // showcase content for the report's "Verification" section.
  const demoSrc = resolve(input.worktreePath, '.forge', 'demos', input.initiativeId);
  if (existsSync(demoSrc)) {
    const demoDst = resolve(cycleLogDir, 'demo');
    cpSync(demoSrc, demoDst, { recursive: true, force: true });
  }

  // PR description draft: useful for the report's "What landed" section.
  const prSrc = resolve(input.worktreePath, '.forge', 'pr-description.md');
  if (existsSync(prSrc)) {
    cpSync(prSrc, resolve(cycleLogDir, 'pr-description.md'), { force: true });
  }
}

/**
 * Best-effort report write at end of cycle. Catches all errors so a failure
 * to render the report (missing data, malformed event log, etc.) cannot
 * fail the cycle itself — the merge has already happened by the time we
 * reach this point.
 */
function writeCycleReportSafely(cycleId: string): void {
  try {
    writeCycleReport({ cycleId });
  } catch (err) {
    process.stderr.write(
      `[cycle-report] failed to write report for ${cycleId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// runProjectManager + its PM_LIVE_* defaults moved to
// ./phases/project-manager.ts (Phase 3.4c step 3). Imported at the top.

// runDeveloperLoop + its DEV_LIVE_* defaults + prerequisiteFailed +
// the dev-only emitGateEvent helper moved to ./phases/developer-loop.ts
// (Phase 3.4c step 4). Imported at the top.

/**
 * Defaults for the live reviewer Ralph loop. The agent runs as a Ralph loop
 * on the initiative branch; the orchestrator's quality-gate function calls
 * `getVerdict` between iterations. On `approve`, the orchestrator merges +
 * moves the manifest to `_queue/done/` + fires the notification. On
 * `send-back`, the gate appends feedback to fix_plan.md and the loop
 * continues. Cap: 3 iterations (1 prep + 2 send-back rounds).
 */
const REVIEWER_LIVE_DEFAULT_ITERATIONS = 3;
const REVIEWER_LIVE_DEFAULT_USD_PER_ITERATION = 1.0;
const REVIEWER_LIVE_MAX_TURNS_PER_ITERATION = 40;
const REVIEWER_LIVE_MAX_BUDGET_USD_PER_ITERATION = 0.6;

/**
 * Infer project type from the worktree contents. Used to give the reviewer
 * agent the right demo-tool default in its iteration prompt.
 */
function inferProjectType(worktreePath: string): 'browser' | 'cli' | 'lib' | 'rest' {
  if (
    existsSync(resolve(worktreePath, 'playwright.config.ts')) ||
    existsSync(resolve(worktreePath, 'playwright.config.js'))
  ) {
    return 'browser';
  }
  if (existsSync(resolve(worktreePath, 'index.html'))) return 'browser';
  if (
    existsSync(resolve(worktreePath, 'openapi.yaml')) ||
    existsSync(resolve(worktreePath, 'openapi.json'))
  ) {
    return 'rest';
  }
  if (existsSync(resolve(worktreePath, 'bin')) || existsSync(resolve(worktreePath, 'cmd'))) {
    return 'cli';
  }
  return 'lib';
}

/**
 * Default verdict-provider used when CycleInput.getVerdict is omitted. The
 * per-phase review-loop bench (which only tests stage 1) omits getVerdict —
 * we approve immediately so the loop terminates after iteration 1, matching
 * the prior closure's behaviour. Production / e2e bench supplies a real
 * verdict-provider.
 */
const defaultGetVerdict: GetVerdict = async () => ({
  kind: 'approve',
  rationale:
    'default verdict-provider — supply CycleInput.getVerdict to drive stage 2 properly.',
});

async function runReviewer(input: CycleInput, logger: EventLogger): Promise<ReviewerOutcome> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'review-loop',
    skill: 'reviewer',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
  });

  const forgeRoot = resolve(import.meta.dirname, '..');
  const projectType = inferProjectType(input.worktreePath);
  const qualityGateCmd =
    input.qualityGateCmd ??
    (existsSync(resolve(input.worktreePath, 'package.json')) ? ['npm', 'test'] : ['true']);
  // F-30: adaptive reviewer iteration cap. The default of 3 (1 prep + 2
  // send-back rounds) is right for small diffs, but for large structural
  // refactors (100+ files renamed/deleted) the reviewer needs more rounds
  // just to summarise and demo. Scale by the count of changed files between
  // the merge-base and HEAD, capped to avoid runaway budgets.
  const adaptiveCap = computeAdaptiveReviewIterationCap(input.worktreePath);
  const iterationCap = input.reviewIterationCap ?? adaptiveCap;
  const usdBudget =
    input.reviewIterationBudgetUsd ?? REVIEWER_LIVE_DEFAULT_USD_PER_ITERATION;

  // Read the completed work items the reviewer will be reviewing.
  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const { items: workItems } = readWorkItemsFromDir(workItemsDir);

  // F-15: wipe the dev-loop's leftover PROMPT.md / AGENT.md / fix_plan.md
  // before stamping the reviewer's. The dev-loop's stamps are per-WI scratch
  // state for THAT phase; the review-Ralph is a different mission with a
  // different iteration prompt. Without this, prepareReviewerWorkspace's
  // idempotency would leave the agent reading stale dev-loop content and
  // hallucinating its role. Logic extracted to `wipeRalphScratch` in
  // reviewer-invocation.ts for direct unit testing.
  wipeRalphScratch(input.worktreePath);

  // Stamp PROMPT.md / AGENT.md / fix_plan.md into the worktree.
  const { promptPath, agentMdPath, fixPlanPath } = prepareReviewerWorkspace({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreeRelPath: input.worktreePath,
    worktreePath: input.worktreePath,
    projectName: basename(input.worktreePath),
    projectType,
    qualityGateCmd: qualityGateCmd.join(' '),
    isStackedPr: false,
    workItems,
  });

  // Build the SDK agent invocation closure that Ralph calls each iteration.
  const toolUseSummary: ReviewerToolUseSummary = {
    brainReads: 0,
    writes: 0,
    bashCalls: 0,
    recorderInvocations: 0,
  };

  const systemPrompt = buildReviewerSystemPrompt(forgeRoot);
  const tallyingQueryFn: QueryFn = ({ prompt, options }) => {
    const inner = sdkQuery({ prompt, options }) as AsyncIterable<unknown>;
    return (async function* () {
      for await (const msg of inner) {
        const m = msg as {
          type?: string;
          message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        };
        if (m.type === 'assistant') {
          tallyReviewerToolUse(m.message, toolUseSummary);
        }
        yield msg;
      }
    })();
  };
  const agent = createClaudeAgent({
    model: REVIEWER_MODEL,
    allowedTools: [...REVIEWER_ALLOWED_TOOLS],
    disallowedTools: [...REVIEWER_DISALLOWED_TOOLS],
    permissionMode: 'acceptEdits',
    systemPrompt,
    maxTurnsPerIteration: REVIEWER_LIVE_MAX_TURNS_PER_ITERATION,
    maxBudgetUsdPerIteration: REVIEWER_LIVE_MAX_BUDGET_USD_PER_ITERATION,
    queryFn: tallyingQueryFn,
  });

  // Build the orchestrator-side verdict gate.
  const gateState: ReviewerGateState = {
    invocations: 0,
    verdicts: [],
    qualityGateResults: [],
  };
  const qualityGate = makeReviewerQualityGate(
    {
      initiativeId: input.initiativeId,
      worktreePath: input.worktreePath,
      manifestPath: input.manifestPath,
      workItems,
      fixPlanPath,
      agentMdPath,
      qualityGateCmd,
    },
    input.getVerdict ?? defaultGetVerdict,
    gateState,
  );

  // Drive the review-Ralph loop. workItemSpecPath is unused by reviewer-Ralph
  // (we don't have a single WI; the manifest references the whole set), so we
  // hand promptPath as a stand-in — Ralph's runner only reads it for
  // template-stamping fallbacks, and prepareReviewerWorkspace already stamped
  // PROMPT.md so the runner's fallback path won't be taken.
  let loopResult: LoopResult;
  try {
    loopResult = await runRalph(
      {
        workItemSpecPath: promptPath, // unused; PROMPT.md already exists
        worktreePath: input.worktreePath,
        initiativeBudget: { iterations: iterationCap, usd: usdBudget * iterationCap },
        brainQueryResults:
          '_(seeded by skill step 1; v1 leaves this empty — the agent has the brain index in its system prompt and can Read themes itself during iteration 1.)_',
        cycleId: 'live',
        initiativeId: input.initiativeId,
        qualityGate,
        // F-14: emit per-iteration events for the reviewer-Ralph as well.
        // F-23: include rich tool-use + agent-text observability fields.
        onIteration: (iteration, info) => {
          logger.emit({
            initiative_id: input.initiativeId,
            parent_event_id: start.event_id,
            phase: 'review-loop',
            skill: 'reviewer',
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
        },
      },
      agent,
    );
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'reviewer',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'reviewer.crashed',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  // F-41c: brain-first runtime gate REMOVED from the review-loop. Same
  // reasoning as F-34 for dev: the reviewer's job is verify + write-PR
  // anchored on the git log / diff / spec already in the worktree. Brain
  // themes about PR conventions (squash-merge-stacked-prs, etc.) are
  // forge-system patterns the orchestrator already enforces — the agent
  // doesn't need to read them every iteration. Diagnosed in the 22:17
  // cycle: reviewer re-read the same 4 brain themes in all 6 iterations,
  // burning $0.10-0.20 per iter before doing real PR work, then panicked
  // about budget. brainReads tally remains for telemetry; just not gated.

  // Emit per-verdict events post-loop.
  for (const verdict of gateState.verdicts) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'reviewer',
      event_type: 'log',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: verdict.kind === 'approve' ? 'reviewer.verdict.approve' : 'reviewer.verdict.send-back',
      metadata: {
        rationale: verdict.rationale,
        feedback_count: verdict.kind === 'send-back' ? verdict.feedback.length : 0,
      },
    });
  }

  const lastVerdict = gateState.verdicts.at(-1);
  const approved = lastVerdict?.kind === 'approve' && loopResult.status === 'complete';

  let outcome: ReviewerOutcome;
  let prUrl: string | null = null;

  if (approved) {
    // Open the PR (best-effort) and immediately merge.
    const prDescriptionPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
    // Prefer a human-readable PR title pulled from the PR description's
    // first heading. Falls back to the initiative ID when the description
    // is absent or malformed (machine-readable but at least scoped to the
    // initiative — better than the worktree's basename).
    const prTitle = extractPrTitle(prDescriptionPath, input.initiativeId);
    prUrl = openPullRequest(input.worktreePath, prDescriptionPath, prTitle);
    const merged = mergePullRequest(input.worktreePath);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'reviewer',
      event_type: merged ? 'log' : 'error',
      input_refs: [prDescriptionPath],
      output_refs: prUrl ? [prUrl] : [],
      message: merged ? 'reviewer.merged' : 'reviewer.merge-failed',
      metadata: { url: prUrl, merged, pr_created: prUrl !== null },
    });

    if (!merged) {
      // gh merge failed — leave the manifest in in-flight, treat as ready-for-review.
      // Operator can pick up via the production CLI (or a follow-up cycle).
      try {
        moveQueueItem(basename(input.manifestPath), 'ready-for-review');
      } catch {
        /* best-effort */
      }
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'review-loop',
        skill: 'reviewer',
        event_type: 'end',
        input_refs: [input.worktreePath],
        output_refs: prUrl ? [prUrl] : [],
        duration_ms: loopResult.duration_ms,
        cost_usd: loopResult.cost_usd,
        metadata: {
          outcome: 'ready-for-review',
          iterations: loopResult.iterations,
          stop_reason: loopResult.stop_reason,
          gate_invocations: gateState.invocations,
          verdicts_summary: gateState.verdicts.map((v) => v.kind),
          tool_use: toolUseSummary,
          pr_url: prUrl,
          merge_failed: true,
        },
      });
      return 'ready-for-review';
    }

    // Move manifest to _queue/done/ and fire notification.
    try {
      moveQueueItem(basename(input.manifestPath), 'done');
    } catch (err) {
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: start.event_id,
        phase: 'review-loop',
        skill: 'reviewer',
        event_type: 'error',
        input_refs: [input.manifestPath],
        output_refs: [],
        message: 'reviewer.queue-move-failed',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    try {
      await notify(
        {
          type: 'review-ready',
          title: input.initiativeId,
          body: prUrl ? `Merged: ${prUrl}` : 'Initiative merged to main',
          url: prUrl ?? undefined,
          metadata: { initiative_id: input.initiativeId, outcome: 'merged' },
        },
        resolveNotifyConfig(),
      );
    } catch {
      /* best-effort */
    }
    outcome = 'merged';
  } else if (loopResult.stop_reason === 'iteration-budget') {
    // F-11: send-back cap exhausted is NOT a phantom value any more. Move the
    // manifest to `ready-for-review/` so the operator can pick up via
    // `forge review` (PR draft exists; the agent ran out of send-back rounds
    // before reaching an approved verdict). Return outcome cleanly — the
    // dispatch helper notifies as 'failed' to surface the cap exhaustion.
    outcome = 'send-back-cap-exhausted';
    // F-29: fall-through PR description. The reviewer-Ralph may have run out
    // of iterations before writing pr-description.md (or written a stub);
    // either way, the human picking this up via `forge review <id>` should
    // see a usable description even if the agent didn't produce one. Write
    // a deterministic version from git log + diff stat — no LLM call, no
    // chance of fabrication. If the file already exists with real content,
    // leave it alone.
    try {
      ensureMinimalPrDescription(input.worktreePath, input.initiativeId);
    } catch {
      /* best-effort — never break the cycle for a description fallback */
    }
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'reviewer',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'reviewer.send-back-cap-exhausted',
      metadata: { rounds: gateState.invocations },
    });
    try {
      moveQueueItem(basename(input.manifestPath), 'ready-for-review');
    } catch {
      /* best-effort — manifest may already have been moved */
    }
  } else {
    // Loop ended without approval AND not via iteration budget — wedged or
    // another stop condition. Treat as ready-for-review (PR draft exists but
    // not approved); operator can pick up manually.
    outcome = 'ready-for-review';
    try {
      moveQueueItem(basename(input.manifestPath), 'ready-for-review');
    } catch {
      /* best-effort */
    }
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'reviewer',
    event_type: outcome === 'send-back-cap-exhausted' ? 'error' : 'end',
    input_refs: [input.worktreePath],
    output_refs: prUrl ? [prUrl] : [input.worktreePath],
    duration_ms: loopResult.duration_ms,
    cost_usd: loopResult.cost_usd,
    metadata: {
      outcome,
      iterations: loopResult.iterations,
      stop_reason: loopResult.stop_reason,
      gate_invocations: gateState.invocations,
      verdicts_summary: gateState.verdicts.map((v) => v.kind),
      tool_use: toolUseSummary,
      pr_url: prUrl,
    },
  });

  // F-11: removed the throw on `send-back-cap-exhausted` — manifest is already
  // moved to `ready-for-review/` above and the cycle returns the status
  // cleanly. The scheduler dispatch handles the 'send-back-cap-exhausted'
  // status as a failed-with-PR-draft case (operator picks up via
  // `forge review <id>`).
  return outcome;
}

// runReflector + its REFLECTOR_LIVE_* defaults + resolveCurrentManifestPath
// moved to ./phases/reflector.ts (Phase 3.4c step 2). Imported at the top.

function newCycleId(initiativeId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${initiativeId}`;
}

/**
 * F-30: scale the reviewer iteration cap to the size of the diff. The
 * baseline (3 rounds = 1 prep + 2 send-back) is fine for typical 5-20 file
 * diffs; larger refactors need proportionally more rounds for the reviewer
 * to read, summarise, gate, demo, and write the PR description. Without
 * scaling, a 107-file diff (e.g., trafficGame's test-suite quarantine)
 * exhausts the cap before the reviewer can produce anything usable.
 *
 * Mapping (changed-file count → iteration cap):
 *   ≤   20 files  →  3   (default)
 *   ≤   50 files  →  4
 *   ≤  100 files  →  5
 *   ≤  200 files  →  6
 *   >  200 files  →  8   (hard cap; no runaway budgets)
 *
 * Errors during diff inspection (no merge-base, git failure, etc.) fall back
 * to the baseline 3 — same as today.
 */
export function computeAdaptiveReviewIterationCap(worktreePath: string): number {
  let changed = 0;
  try {
    // `--name-only` between merge-base and HEAD; line count = changed-file count.
    const out = execFileSync(
      'git',
      ['-C', worktreePath, 'diff', '--name-only', 'main...HEAD'],
      { stdio: 'pipe' },
    ).toString('utf8');
    changed = out.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return REVIEWER_LIVE_DEFAULT_ITERATIONS;
  }
  if (changed <= 20) return 3;
  if (changed <= 50) return 4;
  if (changed <= 100) return 5;
  if (changed <= 200) return 6;
  return 8;
}

/**
 * F-29: ensure `<worktree>/.forge/pr-description.md` exists with a usable
 * draft, generated deterministically from git log + diff stat. Called when
 * the reviewer-Ralph runs out of iterations and the human is about to pick
 * up the cycle via `forge review <id>` — without this, they may inherit an
 * empty / fabricated description.
 *
 * Idempotent: leaves an existing description untouched if it has real content
 * (≥ 300 chars, the same threshold the reviewer mandate uses). Only stamps a
 * fallback when the existing description is missing or too thin to be useful.
 *
 * No LLM call; no risk of hallucinated content. Worst-case the human edits it.
 */
function ensureMinimalPrDescription(worktreePath: string, initiativeId: string): void {
  const prPath = resolve(worktreePath, '.forge', 'pr-description.md');
  if (existsSync(prPath)) {
    const existing = readFileSync(prPath, 'utf8');
    if (existing.length >= 300) return;
  }
  // Pull a deterministic summary from git: last 20 commits + diff stat.
  let commits = '';
  let diffStat = '';
  try {
    commits = execFileSync(
      'git',
      ['-C', worktreePath, 'log', '--no-color', '--format=- %s', '-n', '20'],
      { stdio: 'pipe' },
    ).toString('utf8').trim();
  } catch {
    commits = '_(no commits captured)_';
  }
  try {
    diffStat = execFileSync(
      'git',
      ['-C', worktreePath, 'diff', '--stat', 'HEAD~1', 'HEAD'],
      { stdio: 'pipe' },
    ).toString('utf8').trim();
  } catch {
    diffStat = '_(no diff stat available)_';
  }
  if (!existsSync(resolve(worktreePath, '.forge'))) {
    mkdirSync(resolve(worktreePath, '.forge'), { recursive: true });
  }
  const body = [
    `# ${initiativeId} (auto-drafted)`,
    '',
    '> ⚠️ **Reviewer-Ralph ran out of iterations before producing a hand-crafted PR description.** This draft was generated deterministically from `git log` + `git diff --stat`. Please review and edit before merging.',
    '',
    '## Why',
    '',
    `Initiative ${initiativeId} reached the review phase but the agent could not converge within the iteration cap. The work below was committed during the dev-loop; verify each commit lands what its message claims, and either approve via \`forge review ${initiativeId} --approve\` or send back via the verdict prompt at \`_queue/ready-for-review/${initiativeId}.md.verdict-prompt\`.`,
    '',
    '## What',
    '',
    'Recent commits on this branch:',
    '',
    commits,
    '',
    '## How',
    '',
    'Diff stat (HEAD~1..HEAD):',
    '',
    '```',
    diffStat,
    '```',
    '',
    '## Demo',
    '',
    '_(automated demo not produced — reviewer-Ralph exhausted iterations before generating one. Run the project locally and verify the changes manually before merging, or send-back to request a re-attempt.)_',
    '',
  ].join('\n');
  writeFileSync(prPath, body);
}

/**
 * F-27: read the cycle's event log, classify the failure mode, and emit a
 * `failure_classification` event. Best-effort — never throws (a malformed
 * log shouldn't break the failure-path return).
 */
function emitFailureClassification(
  logger: EventLogger,
  initiativeId: string,
  cycleId: string,
): void {
  try {
    const events: import('./logging.ts').EventLogEntry[] = [];
    const raw = readFileSync(logger.logFilePath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* skip malformed line */
      }
    }
    const cls = classifyCycleFailure(events);
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      input_refs: [logger.logFilePath],
      output_refs: [],
      message: 'failure_classification',
      metadata: {
        cycle_id: cycleId,
        failure_mode: cls.mode,
        recoverable: cls.recoverable,
        recommendation: cls.recommendation,
        evidence_event_ids: cls.evidence_event_ids,
      },
    });
  } catch {
    /* best-effort */
  }
}

// emitGateEvent moved to ./phases/developer-loop.ts (Phase 3.4c step 4).

/**
 * Extract a human-readable PR title from the reviewer's pr-description.md.
 * The reviewer convention is `# <title>` as the first line; we pluck that.
 * Falls back to the initiativeId if the file is missing/malformed/empty.
 */
function extractPrTitle(prDescriptionPath: string, initiativeId: string): string {
  try {
    const content = readFileSync(prDescriptionPath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    if (match && match[1].trim().length > 0) return match[1].trim();
  } catch {
    /* fall through */
  }
  return initiativeId;
}

/**
 * Boundary commit between dev-loop and reviewer phases. Catches any
 * uncommitted work from the dev-loop (the agent's per-iteration commit is
 * prompt-only, not enforced; this is the safety net). Best-effort —
 * `--allow-empty` so a no-op cycle doesn't error, and `|| true`-style
 * try/catch so non-git worktrees (e.g. early dry-runs) don't fail the cycle.
 */
function commitDevLoopBoundary(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  try {
    execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    execFileSync(
      'git',
      [
        'commit',
        '--allow-empty',
        '-m',
        'chore(developer-loop): pre-review boundary snapshot',
      ],
      { cwd: worktreePath, stdio: 'pipe' },
    );
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'cycle.dev-boundary-commit',
    });
  } catch {
    // Not a git repo, or no changes to commit, or git failed — non-fatal.
  }
}
