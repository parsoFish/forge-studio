/**
 * Ralph loop driver.
 *
 * Implements the LoopInput / LoopResult interface declared in loops/README.md.
 * One run = one work item driven to a stop condition.
 *
 * Wired end-to-end. The Claude Agent SDK adapter lives in claude-agent.ts; the
 * runner accepts any AgentInvocation (default = stubAgent for tests; pass
 * createClaudeAgent() for production). Per-fixture quality-gate commands are
 * injectable via LoopInput.qualityGate; the bench harness uses this to run
 * pytest / bats / node:test as appropriate. Live cycle leaves it undefined and
 * gets the default `npm test --silent`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoCommitWorktreeIfDirty,
  branchHasAllCreates,
  checkBranchHasCommitsVsBase,
  checkStopConditions,
  defaultQualityGates,
  type StopCondition,
  type LoopState,
} from './stop-conditions.ts';

export type LoopInput = {
  workItemSpecPath: string;
  worktreePath: string;
  initiativeBudget: { iterations: number; usd: number };
  brainQueryResults: string;
  cycleId: string;
  initiativeId: string;
  /**
   * Per-cycle quality-gate function. Called between iterations; a return of
   * true exits the loop with status 'complete'. May be sync or async — the
   * review-loop's gate calls a verdict-provider that may invoke an SDK call.
   * Defaults to `() => defaultQualityGates(worktreePath)` (shells `npm test
   * --silent`). The bench harness injects per-fixture commands (pytest / bats
   * / etc.).
   */
  qualityGate?: (ctx?: { iteration: number }) => boolean | Promise<boolean>;
  /**
   * F-14: optional per-iteration callback. Called immediately after each
   * agent invocation completes (before the next stop-condition check), with
   * the iteration counter and the agent's per-iteration outputs. The cycle
   * orchestrator uses this to emit `event_type: 'iteration'` events so
   * downstream metrics aggregation has per-iteration cost + file-change
   * data, not just the LoopResult totals.
   *
   * F-23: rich-info fields (`toolsUsed`, `bashCommands`, `lastAssistantText`,
   * `tokensIn`, `tokensOut`) are populated by `createClaudeAgent` so cycle
   * post-mortems can see what the agent actually did per iteration. Stub /
   * test agents may omit them; `onIteration` callers should treat them as
   * optional.
   */
  onIteration?: (
    iteration: number,
    info: AgentIterationInfo,
  ) => void | Promise<void>;
  /**
   * Default `true` — see runner main loop. The per-WI Ralph WANTS
   * this on (catches PM-emitted hollow gates per 2026-05-24
   * claude-harness audit: a gate passing before any agent work means
   * it doesn't exercise the AC). Set to `false` for callers whose
   * gate is naturally always-true at iter 0 — currently no such
   * caller, but the unifier might want it if a re-run finds a leftover
   * DEMO.md.
   */
  failOnHollowIter0Gate?: boolean;
  /**
   * 2026-06-05 (re-review #3): THIS work item's declared `creates[]` paths. The
   * runner only takes the `already-complete` shortcut when ALL of these are
   * already on the branch (a sibling genuinely delivered this WI's outputs) —
   * not on a bare "the branch has some commit". A WI with no creates[] never
   * shortcuts; it runs its own iteration.
   */
  requiredPaths?: string[];
  /**
   * 2026-06-05 (re-review #1): predicate returning whether the LAST gate run
   * could not RUN (missing binary / EACCES / killed by signal), as opposed to
   * running and returning non-zero. When true the runner stops EARLY with
   * `gate-errored` rather than iterating against an unrunnable gate (the agent
   * cannot make a broken command pass, so iterating only burns the budget).
   * The developer-loop wires this to the captured GateRunInfo.errored.
   */
  gateErrored?: () => boolean;
  /**
   * G4 (2026-07-11, plan item 2.2): predicate returning whether the CALLER's
   * fix-loop failure ceiling has been hit — e.g. the unifier's cap on
   * consecutive same-sub-check composed-gate failures. Checked at the same
   * point as `gateErrored` (after every gate evaluation, BEFORE the next agent
   * invocation): when true the runner stops EARLY with `loop-cap-exhausted`
   * instead of burning the remaining iteration budget re-invoking the agent
   * against a gate it has repeatedly failed to clear (the 2026-07-04
   * 16-restart / $84.56 unifier spins).
   */
  loopCapExhausted?: () => boolean;
  /**
   * G1 rescope (2026-07-11, plan item 2.6): called when the post-iteration
   * autocommit safety net actually SWEPT uncommitted agent work into a
   * `forge-autocommit:` commit. The net stays (it closes the
   * scratch-dead-ends-the-gate failure mode), but the agent's
   * commit-discipline failure must be VISIBLE: the caller emits a distinct
   * `ralph.uncommitted-work-swept` event so reflectors see the gap instead
   * of it being silently absorbed.
   */
  onAutoCommit?: (iteration: number) => void;
};

/**
 * F-23: per-iteration agent observability payload. All rich fields are
 * optional so stub / test agents that only return `filesChanged + costUsd`
 * continue to type-check.
 */
export type AgentIterationInfo = {
  filesChanged: string[];
  costUsd: number;
  toolsUsed?: ToolUseDetail[];
  bashCommands?: string[];
  lastAssistantText?: string;
  tokensIn?: number;
  tokensOut?: number;
  /**
   * S8 / C23 — prompt-cache hit telemetry. Populated by `createClaudeAgent`
   * from the SDK's `result.usage.cache_read_input_tokens`. Stub / test
   * agents may omit; consumers treat as optional and default to 0.
   */
  cacheReadTokens?: number;
  /**
   * S8 / C23 — prompt-cache write telemetry. Populated by
   * `createClaudeAgent` from the SDK's
   * `result.usage.cache_creation_input_tokens`. Optional; defaults to 0.
   */
  cacheCreationTokens?: number;
};

export type ToolUseDetail = {
  name: string;
  /** Truncated JSON of the tool's input — enough to identify the call without bloating logs. */
  inputSummary: string;
};

export type LoopResult = {
  status: 'complete' | 'failed';
  iterations: number;
  cost_usd: number;
  duration_ms: number;
  artifacts: { agentMdPath: string; fixPlanPath: string };
  filesChanged: string[];
  stop_reason: StopCondition['kind'];
  /**
   * G2 rescope (plan item 2.6): total tool invocations across all agent
   * iterations (0 when the agent reported none). Paired with the
   * diff-presence check that classifies `hollow-no-work` — the evidence
   * distinguishing "the agent did nothing" (≈0 tools, no diff) from "the
   * agent worked but produced nothing durable" (many tools, no diff).
   */
  toolUseTotal: number;
};

export type AgentInvocation = (params: {
  promptPath: string;
  agentMdPath: string;
  fixPlanPath: string;
  worktreePath: string;
  iteration: number;
}) => Promise<AgentIterationInfo>;

/** Stub agent invocation — replace with @anthropic-ai/claude-agent-sdk query() call. */
const stubAgent: AgentInvocation = async () => {
  return { filesChanged: [], costUsd: 0 };
};

export type DevWorkspacePaths = {
  promptPath: string;
  agentMdPath: string;
  fixPlanPath: string;
};

/**
 * Stamp PROMPT.md / AGENT.md / fix_plan.md into the worktree from templates if
 * they don't exist yet, and return their absolute paths. Idempotent — already-
 * stamped files are left alone (a re-entrant cycle inherits prior state).
 *
 * Exported so the bench harness and the live cycle wiring can prepare a
 * workspace without going through `run()` (e.g., for inspection in tests).
 */
export function prepareWorkspace(input: LoopInput): DevWorkspacePaths {
  const promptPath = join(input.worktreePath, 'PROMPT.md');
  const agentMdPath = join(input.worktreePath, 'AGENT.md');
  const fixPlanPath = join(input.worktreePath, 'fix_plan.md');
  ensureScaffolded(input, promptPath, agentMdPath, fixPlanPath);
  return { promptPath, agentMdPath, fixPlanPath };
}

export async function run(input: LoopInput, agent: AgentInvocation = stubAgent): Promise<LoopResult> {
  const startedAt = Date.now();
  const { promptPath, agentMdPath, fixPlanPath } = prepareWorkspace(input);

  // Tier 2 thinning (2026-05-26): the wedged-no-progress check was
  // removed. The magic 3-iteration window was diagnostic guesswork
  // that false-fired on the unifier's legitimate read-only iterations
  // (it had to be disabled via Infinity for the unifier — sign that
  // the check was fragile, not load-bearing). The iteration budget
  // is the principled cap; if an agent wedges it eats its budget
  // and exits naturally on `iteration-budget`.
  const conditions: StopCondition[] = [
    { kind: 'quality-gates-pass' },
    { kind: 'iteration-budget', max: input.initiativeBudget.iterations },
    { kind: 'cost-budget', maxUsd: input.initiativeBudget.usd },
  ];

  const qualityGate = input.qualityGate ?? ((ctx) => defaultQualityGates(input.worktreePath, undefined, ctx));

  const state: LoopState = {
    worktreePath: input.worktreePath,
    iteration: 0,
    costUsdSoFar: 0,
    filesChangedHistory: [],
  };
  // G2 rescope: tool-use tally across iterations — evidence for the
  // hollow-no-work classification below.
  let toolUseTotal = 0;

  // Caller-overridable iter-0 hollow-gate detection. Defaults to TRUE
  // for per-WI Ralphs (per the 2026-05-24 claude-harness audit: a gate
  // that passes BEFORE the agent has done any work is by definition
  // not exercising the WI's acceptance criteria; fail the WI early
  // with a clear classification rather than wasting iters on a hollow
  // gate). The unifier sets this FALSE because its gate (`pr_self_
  // contained`) checks for DEMO.md + pr-description.md, neither of
  // which can exist before the agent writes them — the unifier's
  // iter-0 gate-pass condition would be a no-op false positive.
  const failOnHollowGate = input.failOnHollowIter0Gate ?? true;

  for (;;) {
    // Iter-0: 3-way gate decision (Wave B, 2026-06-04).
    //
    // If the gate passes before the agent has done any work:
    //   A) branch already has commits vs base → a sibling WI delivered this
    //      WI's work ahead of us → `already-complete` (status: complete).
    //   B) branch is empty vs base → the gate doesn't exercise its ACs →
    //      `gate-too-loose` (status: failed — PM must rewrite the gate).
    //
    // If the gate fails → proceed to iterate normally.
    if (state.iteration === 0 && failOnHollowGate) {
      const passed = await Promise.resolve(qualityGate({ iteration: 0 }));
      if (passed) {
        const branchHasWork = checkBranchHasCommitsVsBase(input.worktreePath);
        if (!branchHasWork) {
          // Hollow gate — gate passes on a clean branch with no agent work.
          return finalize(state, startedAt, 'gate-too-loose', agentMdPath, fixPlanPath, toolUseTotal);
        }
        // re-review #3: the branch has SOME work, but `already-complete` is only
        // honest when a sibling delivered THIS WI's OWN declared outputs — not on
        // a bare "branch has a commit". If this WI declares creates[] and they're
        // all present, it's genuinely done; otherwise (partial, or no creates[])
        // fall through and let the agent attempt this WI's own AC. The unifier's
        // (fail-closed) incomplete-delivery gate is the backstop if it doesn't.
        if (branchHasAllCreates(input.worktreePath, input.requiredPaths ?? [])) {
          return finalize(state, startedAt, 'already-complete', agentMdPath, fixPlanPath, toolUseTotal);
        }
      }
      // re-review #1: the gate FAILED at iter-0 — but did it fail because the
      // tests failed (expected: the agent will write them), or because the gate
      // command could not RUN? A broken gate errors every iteration; iterating
      // only burns the budget and then mis-reports as a code failure. Stop now.
      if (input.gateErrored?.()) {
        return finalize(state, startedAt, 'gate-errored', agentMdPath, fixPlanPath, toolUseTotal);
      }
    }

    const conditionsForThisCheck =
      state.iteration === 0
        ? conditions.filter((c) => c.kind !== 'quality-gates-pass')
        : conditions;
    const stop = await checkStopConditions(state, conditionsForThisCheck, qualityGate);
    if (stop.stop) {
      // G2 rescope (plan item 2.6): a gate that passes after ≥1 agent
      // iteration while the branch has ZERO diff/commits vs base is HOLLOW —
      // no durable work exists (the autocommit net has already swept any
      // uncommitted work by this point, so an empty branch means an empty
      // worktree too). The deterministic tool-use + diff-presence replacement
      // for the deleted NO_WORK_INDICATORS output-string heuristics; the
      // iter-0 equivalent is `gate-too-loose` above.
      if (
        stop.condition === 'quality-gates-pass' &&
        state.iteration > 0 &&
        !checkBranchHasCommitsVsBase(input.worktreePath)
      ) {
        return finalize(state, startedAt, 'hollow-no-work', agentMdPath, fixPlanPath, toolUseTotal);
      }
      return finalize(state, startedAt, stop.condition, agentMdPath, fixPlanPath, toolUseTotal);
    }
    // A gate that broke mid-run (binary vanished / OOM-killed) is also
    // unrunnable — don't keep iterating against it.
    if (input.gateErrored?.()) {
      return finalize(state, startedAt, 'gate-errored', agentMdPath, fixPlanPath, toolUseTotal);
    }
    // G4: the caller's own fix-loop ceiling fired (e.g. the unifier's
    // consecutive same-sub-check gate-failure cap) — stop honestly instead
    // of re-invoking the agent against a gate it keeps failing the same way.
    if (input.loopCapExhausted?.()) {
      return finalize(state, startedAt, 'loop-cap-exhausted', agentMdPath, fixPlanPath, toolUseTotal);
    }

    state.iteration += 1;
    const result = await agent({
      promptPath,
      agentMdPath,
      fixPlanPath,
      worktreePath: input.worktreePath,
      iteration: state.iteration,
    });
    state.costUsdSoFar += result.costUsd;
    state.filesChangedHistory.push(result.filesChanged);
    toolUseTotal += result.toolsUsed?.length ?? 0;
    // Safety net (surfaced by claude-harness cycle 1, 2026-05-24): if
    // the agent left WIP uncommitted, commit it under a clearly-tagged
    // `forge-autocommit:` message before the next gate check so the
    // required-paths-against-main diff sees the work. The agent's
    // intent IS still "commit your own work" (per dev-invocation
    // system prompt) — this just guarantees the gate doesn't dead-end
    // on iteration-budget when the work is otherwise complete.
    // G1 rescope (plan item 2.6): the net staying silent was hiding the
    // agent's commit-discipline failure — when it actually sweeps, report it
    // so the caller emits `ralph.uncommitted-work-swept`.
    const swept = autoCommitWorktreeIfDirty(input.worktreePath, state.iteration, deriveWorkItemId(input.workItemSpecPath));
    if (swept) input.onAutoCommit?.(state.iteration);
    if (input.onIteration) {
      // F-23: forward all rich-info fields the agent populated. Plain assignment
      // (no field-by-field copy) keeps onIteration backward compatible with the
      // narrow `{ filesChanged, costUsd }` shape used by stub/test agents.
      await input.onIteration(state.iteration, result);
    }
  }
}

/** Pulls `WI-N` out of a workItemSpecPath like `.forge/work-items/WI-3.md`. */
function deriveWorkItemId(specPath: string): string | undefined {
  const m = specPath.match(/(WI-\d+)\.md$/);
  return m ? m[1] : undefined;
}

function ensureScaffolded(
  input: LoopInput,
  promptPath: string,
  agentMdPath: string,
  fixPlanPath: string,
): void {
  if (!existsSync(promptPath)) {
    const tmpl = readFileSync(join(import.meta.dirname, 'PROMPT.md.tmpl'), 'utf8');
    writeFileSync(
      promptPath,
      tmpl
        .replace(/{{WORK_ITEM_ID}}/g, basename(input.workItemSpecPath, '.md'))
        .replace(/{{INITIATIVE_ID}}/g, input.initiativeId)
        .replace(/{{ITERATION}}/g, '0')
        .replace(/{{ITERATION_BUDGET}}/g, String(input.initiativeBudget.iterations))
        .replace(/{{WORKTREE_PATH}}/g, input.worktreePath)
        .replace(/{{WORK_ITEM_SPEC_BODY}}/g, readFileSync(input.workItemSpecPath, 'utf8')),
    );
  }
  if (!existsSync(agentMdPath)) {
    const tmpl = readFileSync(join(import.meta.dirname, 'AGENT.md.tmpl'), 'utf8');
    writeFileSync(
      agentMdPath,
      tmpl
        .replace(/{{WORK_ITEM_ID}}/g, basename(input.workItemSpecPath, '.md'))
        .replace(/{{BRAIN_QUERY_RESULTS}}/g, input.brainQueryResults),
    );
  }
  if (!existsSync(fixPlanPath)) {
    writeFileSync(fixPlanPath, '# Fix Plan\n\n_(populate from acceptance criteria)_\n');
  }
}

function finalize(
  state: LoopState,
  startedAt: number,
  stopReason: StopCondition['kind'],
  agentMdPath: string,
  fixPlanPath: string,
  toolUseTotal: number,
): LoopResult {
  const status: LoopResult['status'] =
    stopReason === 'quality-gates-pass' || stopReason === 'already-complete'
      ? 'complete'
      : 'failed';
  // gate-too-loose surfaces as a failed WI; the caller (developer-loop)
  // reads stop_reason and classifies the failure mode for the cycle
  // report + the failure-classifier.
  // already-complete surfaces as a complete WI — a sibling delivered
  // this WI's work; no agent invocation is needed or desirable.
  // hollow-no-work (G2) surfaces as a failed WI — the gate passed after
  // agent iterations that left zero durable work on the branch.
  const filesChanged = uniqueFiles(state.filesChangedHistory);
  return {
    status,
    iterations: state.iteration,
    cost_usd: state.costUsdSoFar,
    duration_ms: Date.now() - startedAt,
    artifacts: { agentMdPath, fixPlanPath },
    filesChanged,
    stop_reason: stopReason,
    toolUseTotal,
  };
}

function uniqueFiles(history: string[][]): string[] {
  const seen = new Set<string>();
  for (const iter of history) {
    for (const f of iter) seen.add(f);
  }
  return [...seen].sort();
}

function basename(p: string, ext: string): string {
  const last = p.split('/').pop() ?? p;
  return last.endsWith(ext) ? last.slice(0, -ext.length) : last;
}
