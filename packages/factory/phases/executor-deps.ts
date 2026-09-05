/**
 * The injectable phase set behind the `PhaseExecutor` port, and the real
 * implementations it defaults to.
 *
 * Every import of a phase module lives in this file and its sibling
 * `executor-table.ts`; `orchestrator/flow-runner.ts` has none — that IS the
 * port (`docs/roadmaps/1.0.md` §4 M2 Lane B, SPEC.md §2 Station). At M3 both
 * files move to `@forge/factory` with the phases they wire.
 */

import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { EventLogger } from '@forge/kernel';
import { parseManifest } from '@forge/flows/manifest.ts';
import { FORGE_ROOT } from '@forge/agents/skill-path.ts';
import { runPreflight } from '@forge/projects/preflight.ts';
import type { ProjectGate } from '@forge/kernel';
import { type ClosureResult, type CycleInput, type ReviewerOutcome } from '@forge/flows/cycle-context.ts';
import { WedgeDetector, WedgeKillError } from '@forge/flows/flow-budgets.ts';
import { runProjectManager as realRunProjectManager } from '@forge/factory/phases/project-manager.ts';
import { runDeveloperLoop as realRunDeveloperLoop, emitDeliverySummary } from '@forge/factory/phases/developer-loop.ts';
import { runDemoAgentPipeline, type DemoAgentPipelineResult } from '@forge/factory/phases/demo-agent.ts';
import { runAdversarialReview, type AdversarialReviewResult } from '@forge/factory/phases/adversarial-review.ts';
import type { ChangeClass } from '@forge/factory/class-profiles.ts';
import { runClosure, promoteMergedToDone } from '@forge/flows/phases/closure.ts';
import { runReflector } from '@forge/factory/phases/reflector.ts';
import { rebasePreservedBranchOntoMain } from '@forge/flows/pr.ts';
import { openPrInline, assertNonEmptyDelivery, commitDevLoopBoundary, enforceDevLoopCloseInvariant, enforceFinalCiGate, runMergeBoundaryGate, preservingForgeScratch, type MergeGateResult } from '@forge/flows/cycle-helpers.ts';


/**
 * Injectable executor set for testability. Every field defaults to the real
 * implementation. Tests supply spies so the DAG walk can be asserted without
 * touching the filesystem or spawning agents.
 */
export type FlowRunnerDeps = {
  runProjectManager: (input: CycleInput, logger: EventLogger, signal?: AbortSignal) => Promise<void>;

  runDeveloperLoop: (
    input: CycleInput,
    logger: EventLogger,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * R4-10-F1 demo node: the R4-07 demo pipeline (author demo.json + the
   * relocated `.forge/pr-description.md`, render, orchestrated capture, AC
   * judgment). Wrapped by execDemo, which relocates the close-contract gates
   * around it. Returns the pipeline result so execDemo can gate on `failed`
   * and drive the demo-fix loop on `complete-with-misses`.
   */
  runDemoAgent: (
    input: CycleInput,
    logger: EventLogger,
    signal?: AbortSignal,
  ) => Promise<DemoAgentPipelineResult>;

  /**
   * R4-10-F1 review node: the R4-08 adversarial-review pipeline (assemble the
   * diff, critique, persist the `review-findings` artifact for the verdict
   * gate). Wrapped by execAdversarialReview.
   */
  runAdversarialReview: (
    input: CycleInput,
    logger: EventLogger,
    signal?: AbortSignal,
  ) => Promise<AdversarialReviewResult>;

  /**
   * Branch delivery ground-truth (commits-ahead / files-changed / insertions),
   * emitted as the reflector's `dev-loop.delivered` grounding event and fed to
   * `assertNonEmptyDelivery`. Formerly returned by the unifier phase; the demo
   * node computes it now (execDemo). Injectable so hermetic tests need no git.
   */
  computeDeliveryStats: (
    input: CycleInput,
    logger: EventLogger,
  ) => { commitsAhead: number; filesChanged: number; insertions: number };

  /**
   * R4-10-F2 merge-boundary full-suite gate: runs testProcess.local (the
   * relocated composedUnifierGate.initiative_gate — the full suite, unscoped) +
   * testProcess.ci on the integrated branch tip, and RETURNS the verdict (never
   * throws) so execDemo can drive the bounded gate-fix loop. Injectable so
   * hermetic tests need no real suite run.
   */
  runMergeBoundaryGate: (input: CycleInput, logger: EventLogger) => MergeGateResult;

  openPrInline: (input: CycleInput, logger: EventLogger) => Promise<ReviewerOutcome>;

  runClosure: (
    input: CycleInput,
    logger: EventLogger,
    reviewerOutcome: ReviewerOutcome,
  ) => Promise<ClosureResult>;

  runReflector: (
    input: CycleInput,
    logger: EventLogger,
  ) => Promise<{ reflection_status: string; lint_status: string }>;

  /**
   * R4-11-F1 — the second terminal move of a confirmed merge: promotes the
   * manifest `merged/ → done/`. `orchestrator/finalize-merged.ts` is the
   * production caller for the normal (deferred) merge-confirmation path; a
   * flow that combines a review node with a downstream reflect node in ONE
   * DAG pass (the retired forge-cycle monolith shape, kept as a generic
   * DAG-engine fixture) needs this call too — finalize-merged.ts only scans
   * `ready-for-review/`, and closure's own terminal move already left this
   * manifest sitting in `merged/`, not there. `phases/closure.ts` remains
   * the single terminal-move authority (this is that same function, not a
   * duplicate); injectable so tests needn't touch the fs.
   */
  promoteMergedToDone: (input: CycleInput, logger: EventLogger, parentEventId?: string) => void;

  /**
   * Dev-loop close contract helpers. Injected for testability (tests supply
   * no-ops; production uses the real implementations from cycle.ts).
   */
  commitDevLoopBoundary: (worktreePath: string, logger: EventLogger, initiativeId: string) => void;
  enforceDevLoopCloseInvariant: (worktreePath: string, logger: EventLogger, initiativeId: string) => void;
  assertNonEmptyDelivery: (
    outcome: { commitsAhead: number; filesChanged: number; insertions: number },
    initiativeId: string,
    worktreePath: string,
    logger: EventLogger,
  ) => void;
  enforceFinalCiGate: (input: CycleInput, logger: EventLogger) => void;

  /**
   * Resume rebase: preserving .forge scratch dirs, rebase the preserved branch
   * onto main. Returns the rebase result object.
   */
  rebaseForResume: (
    input: CycleInput,
    logger: EventLogger,
  ) => void;

};

/**
 * Item 3 (ported from cycle.ts:176-209): rebase the preserved branch onto
 * main for a unifier resume, preserving .forge scratch dirs across the rebase.
 */
function defaultRebaseForResume(input: CycleInput, logger: EventLogger): void {
  const rebase = preservingForgeScratch(
    input.worktreePath,
    ['.forge/work-items', '.forge/unifier-items'],
    () => rebasePreservedBranchOntoMain(input.worktreePath),
  );
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: rebase.ok ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: rebase.ok
      ? (rebase.rebased ? 'cycle.resume-rebased' : 'cycle.resume-no-rebase-needed')
      : 'cycle.resume-needs-rebase',
    metadata: { base: rebase.base, rebased: rebase.rebased, reason: rebase.reason ?? null },
  });
  if (!rebase.ok) {
    throw new Error(
      `resume-needs-rebase: ${rebase.reason ?? 'the preserved branch must be rebased onto current main before resuming'}`,
    );
  }
}


/** Best-effort manifest `cost_budget_usd` read (resolves a def's declared
 *  share cap; a fixture/dry manifest simply yields undefined → flat floor). */
function readCostBudgetUsd(input: CycleInput): number | undefined {
  try {
    return parseManifest(readFileSync(input.manifestPath, 'utf8')).cost_budget_usd;
  } catch {
    return undefined;
  }
}

/**
 * The initiative's change class, read from its manifest. NOT best-effort like the
 * budget above: the class selects the review lenses (ADR 051, spec §5 item 5), so
 * an unreadable manifest here has no honest default — reviewing under a guessed
 * policy is worse than refusing to review.
 */
function readChangeClass(input: CycleInput): ChangeClass {
  return parseManifest(readFileSync(input.manifestPath, 'utf8')).class;
}

/**
 * A1 (handoff, agents s4): this was `resolve('_logs')` at the two call sites
 * below — relative to the PROCESS's cwd, so a cycle started from anywhere but
 * the repo root wrote its demo and review evidence into a `_logs` tree beside
 * whatever directory the operator happened to be in, and every later reader
 * looked in the checkout and found nothing. Same class as 5.37.
 *
 * `FORGE_ROOT` resolves from this module's own dirname, so it is the checkout
 * whatever the cwd. Named once here rather than inlined twice: two call sites
 * computing the same path independently is how the first one drifted.
 * `executor-deps-logs-root.test.ts` pins it from a child process with a
 * different cwd, which is the only vantage point that can tell the two
 * implementations apart.
 */
export const DEFAULT_LOGS_ROOT = join(FORGE_ROOT, '_logs');

export const DEFAULT_DEPS: FlowRunnerDeps = {
  // Thread the optional wedge-abort signal into real phase functions.
  runProjectManager: (input, logger, signal?) =>
    realRunProjectManager(input, logger, { signal }),
  runDeveloperLoop: (input, logger, signal?) =>
    realRunDeveloperLoop(input, logger, signal),
  runDemoAgent: (input, logger, signal?) =>
    runDemoAgentPipeline(
      {
        initiativeId: input.initiativeId,
        worktreePath: input.worktreePath,
        cycleId: input.cycleId ?? input.initiativeId,
        logsRoot: DEFAULT_LOGS_ROOT,
        costBudgetUsd: readCostBudgetUsd(input),
        forgeRoot: FORGE_ROOT,
      },
      logger,
      { signal },
    ),
  runAdversarialReview: (input, logger, signal?) =>
    runAdversarialReview(
      {
        initiativeId: input.initiativeId,
        worktreePath: input.worktreePath,
        cycleId: input.cycleId ?? input.initiativeId,
        logsRoot: DEFAULT_LOGS_ROOT,
        costBudgetUsd: readCostBudgetUsd(input),
        projectName: basename(input.projectRepoPath),
        changeClass: readChangeClass(input),
        forgeRoot: FORGE_ROOT,
      },
      logger,
      { signal },
    ),
  computeDeliveryStats: (input, logger) => {
    const s = emitDeliverySummary(input, logger);
    return { commitsAhead: s.commits, filesChanged: s.filesChanged, insertions: s.insertions };
  },
  runMergeBoundaryGate,
  openPrInline,
  runClosure,
  runReflector,
  promoteMergedToDone,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  assertNonEmptyDelivery,
  enforceFinalCiGate,
  rebaseForResume: defaultRebaseForResume,
};

/**
 * Race an executor promise against a concurrent wedge-kill timer.
 * Returns the executor result when it wins. Throws WedgeKillError when
 * the wedge timer wins (even if the executor never resolves — this is the
 * gap-closing path).
 *
 * The wedgeAbort signal is passed to the executor for best-effort SDK cancel.
 * The poll interval is 100ms — accurate enough for minute-scale wedge windows,
 * imperceptible overhead.
 *
 * Only called when wedgeDetector.active is true (wedgeKillMs is set).
 * Cleans up the poll timer on BOTH outcomes.
 */
export async function raceWithWedge<T>(
  executorFn: (signal: AbortSignal) => Promise<T>,
  wedgeDetector: WedgeDetector,
  onKill: (err: WedgeKillError) => void,
): Promise<T> {
  const wedgeAbort = new AbortController();
  let pollHandle: ReturnType<typeof setInterval> | undefined;

  const wedgePromise = new Promise<never>((_, reject) => {
    pollHandle = setInterval(() => {
      if (wedgeDetector.check(Date.now())) {
        const killErr = wedgeDetector.buildKillError(Date.now());
        onKill(killErr);
        // Reject BEFORE abort so the race rejects with WedgeKillError even
        // if the executor's abort listener resolves its promise synchronously.
        reject(killErr);
        wedgeAbort.abort();
      }
    }, 100);
  });

  try {
    return await Promise.race([executorFn(wedgeAbort.signal), wedgePromise]);
  } finally {
    if (pollHandle !== undefined) clearInterval(pollHandle);
  }
}

/**
 * The shipped `ProjectGate`: the real contract preflight (ADR 017). It lives
 * here, beside the real phase implementations, because `flow-runner.ts` may
 * hold only the port (SPEC.md §6 Project).
 */
export function createProjectGate(): ProjectGate {
  return { runPreflight };
}

/**
 * The shipped early-terminate closure. `runFlow` takes it directly (not through
 * the phase port) because stopping the walk is the runner's own act; exporting
 * it here keeps the runner's caller free of a phase import.
 */
export const defaultRunClosure = DEFAULT_DEPS.runClosure;
