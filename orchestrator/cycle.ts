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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogger } from './logging.ts';
import { createLogger } from './logging.ts';
import { classifyCycleFailure } from './failure-classifier.ts';
import { writeCycleReport } from './cycle-report.ts';
import { readManifestOrigin } from './manifest.ts';
import { loadProjectConfig } from './project-config.ts';

// Shared cycle types + cross-runner helpers live in cycle-context.ts (the
// phase runners import them from there, never from this module — keeps the
// import graph acyclic). Re-exported here so the external surface
// (benchmarks/e2e, cli, scheduler, tests) keeps importing them from
// `./cycle.ts` unchanged.
export type {
  CycleInput,
  CycleResult,
  CycleOutcome,
  ReflectionStatus,
  LintStatus,
  ReflectorPhaseResult,
  ReviewerOutcome,
} from './cycle-context.ts';
export { recordBrainGateResult } from './cycle-context.ts';

// Internal uses within this module (re-export above doesn't bind names locally).
import type {
  CycleInput,
  CycleResult,
  CycleOutcome,
  ReflectionStatus,
  LintStatus,
} from './cycle-context.ts';
import { resolveQualityGateCmd } from './cycle-context.ts';

// Phase runners (extracted from this module — cycle.ts is the thin spine).
import { runProjectManager } from './phases/project-manager.ts';
import { runDeveloperLoop } from './phases/developer-loop.ts';
import { runReflector } from './phases/reflector.ts';
import { runClosure } from './phases/closure.ts';
import { assertLocalRemoteSynced, openPullRequest, pushInitiativeBranch, rebasePreservedBranchOntoMain } from './pr.ts';
// S4: computeAdaptiveReviewIterationCap removed alongside the Ralph reviewer.
// The unifier sub-phase owns iteration in dev-loop space; the review phase is
// now a thin, non-LLM PR-opener inlined here (REV-6). The operator's verdict
// arrives out-of-band as a UI action: APPROVE is a no-op ack (they merge in
// GitHub; closure confirms), SEND-BACK (D1) writes `<id>.pr-feedback.md` and
// requeues with resume_from: unifier — the resumed unifier reads that feedback.

export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const started = Date.now();
  const cycleId = input.cycleId ?? newCycleId(input.initiativeId);
  const logger = createLogger(cycleId, '_logs', { tee: input.eventTee });

  // G6: tag the cohort on the cycle's first event so `forge metrics` (which
  // reconstructs everything from the JSONL log) and the reflector can
  // separate autonomous-progress cycles from hand-directed project surgery.
  // Single read of the manifest's `origin` field; defaults to `architect`.
  const origin = readManifestOrigin(input.manifestPath);

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
    message: input.dryRun ? 'cycle.start (dry run)' : 'cycle.start',
    metadata: { origin },
  });

  // 2026-05-25: the architect phase runs OUT-OF-CYCLE (operator invokes
  // /forge-architect in their own Claude session before the scheduler
  // claims this cycle). So the architect emits no events into this
  // cycle's log — yet the UI's six-phase state machine has an architect
  // row that stays pending forever without them. The cycle would not
  // exist without architect having already produced the manifest, so we
  // emit a synthetic architect start+end pair at cycle.start that
  // records this truth. metadata.origin tracks who triggered the cycle
  // (architect vs reflector vs operator). Input ref is the manifest;
  // output ref is the manifest itself (architect's product).
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'architect',
    skill: 'architect',
    event_type: 'start',
    input_refs: [],
    output_refs: [input.manifestPath],
    message: 'architect.synthetic-start',
    metadata: { origin, note: 'architect ran out-of-cycle; synthetic event emitted by orchestrator so the UI can reflect the phase as complete' },
  });
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'architect',
    skill: 'architect',
    event_type: 'end',
    input_refs: [],
    output_refs: [input.manifestPath],
    message: 'architect.synthetic-end',
    metadata: { origin },
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
  // D1: a UI send-back writes `<id>.pr-feedback.md` beside the manifest and
  // requeues with resume_from: unifier. When that feedback file is present on a
  // resume, run the unifier in send-back mode (developer-loop already threads
  // unifierFeedbackRef → the unifier prompt). A manual `forge requeue
  // --resume-from=unifier` (no feedback file) stays a plain re-prep.
  const prFeedbackPath = input.manifestPath.replace(/\.md$/, '.pr-feedback.md');
  const unifierFeedbackRef =
    (input.resumeFrom === 'unifier' || input.resumeFrom === 'developer') && existsSync(prFeedbackPath)
      ? prFeedbackPath
      : input.unifierFeedbackRef;
  const inputWithGate: CycleInput = {
    ...input,
    qualityGateCmd: effectiveQualityGateCmd,
    unifierFeedbackRef,
  };

  // Final cycle outcome. `merged` is reachable ONLY via the closure step
  // (a GitHub-confirmed merge) — never from the reviewer (G9).
  let cycleOutcome: CycleOutcome = 'ready-for-review';
  let reflectionStatus: ReflectionStatus = 'skipped';
  let lintStatus: LintStatus = 'skipped';
  try {
    if (!input.dryRun) {
      // ADR 019: on EITHER resume mode (unifier or developer) the architect + PM
      // already ran in the prior (stalled) cycle and their output (the WI specs)
      // survives in the preserved worktree's `.forge/work-items/`. Skip PM and
      // rebase the preserved branch onto current main. The dev-loop then keys on
      // `resumeFrom`: 'unifier' runs only the unifier against the existing per-WI
      // commits; 'developer' re-runs the dev-loop over ALL work items (newly-added
      // pending WIs get built) before re-unifying.
      if (input.resumeFrom === 'unifier' || input.resumeFrom === 'developer') {
        // cascade-v4 #4: another cycle may have merged to main during the stall,
        // so the preserved branch no longer has main as its merge-base — the
        // dev-loop-close invariant would fail at the END of this resumed cycle,
        // wasting the unifier run. Rebase the preserved branch onto current main
        // NOW (clean → force-with-lease push the initiative branch; conflict →
        // fail fast with a clear, actionable resume-needs-rebase signal).
        //
        // resume_from:developer reads the per-WI specs from `.forge/work-items/`,
        // but that dir is gitignored — the rebase replay clobbers untracked files,
        // wiping the work items the dev-loop is about to run. Snapshot the dir
        // OUTSIDE the git worktree (so the rebase can't touch the backup) and
        // restore it afterward. (Unifier resume runs zero WIs → harmless no-op.)
        const wiResumeDir = resolve(inputWithGate.worktreePath, '.forge', 'work-items');
        const wiResumeBak = `${inputWithGate.worktreePath}.work-items-resume-bak`;
        const preserveWorkItems = existsSync(wiResumeDir);
        if (preserveWorkItems) {
          rmSync(wiResumeBak, { recursive: true, force: true });
          cpSync(wiResumeDir, wiResumeBak, { recursive: true });
        }
        const rebase = rebasePreservedBranchOntoMain(inputWithGate.worktreePath);
        if (preserveWorkItems) {
          if (!existsSync(wiResumeDir) || readdirSync(wiResumeDir).length === 0) {
            mkdirSync(wiResumeDir, { recursive: true });
            cpSync(wiResumeBak, wiResumeDir, { recursive: true });
          }
          rmSync(wiResumeBak, { recursive: true, force: true });
        }
        logger.emit({
          initiative_id: input.initiativeId,
          phase: 'orchestrator',
          skill: 'cycle',
          event_type: rebase.ok ? 'log' : 'error',
          input_refs: [inputWithGate.worktreePath],
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
      } else {
        await runProjectManager(inputWithGate, logger);
      }
      const devLoopOutcome = await runDeveloperLoop(inputWithGate, logger);
      // D1: consume-once — the send-back feedback has now been read by the
      // unifier; remove it so a later resume doesn't re-enter send-back mode
      // with stale feedback (a fresh UI send-back writes a new one).
      if (unifierFeedbackRef) {
        try { rmSync(unifierFeedbackRef, { force: true }); } catch { /* best-effort */ }
      }
      // Safety net: commit any uncommitted dev-loop work before the reviewer
      // starts. The dev-loop's prompt tells the agent to commit per
      // iteration, but if it skips, source files would not reach the PR.
      // This boundary commit catches any drift. Files matching .gitignore
      // (Ralph scratch: PROMPT.md / AGENT.md / fix_plan.md, node_modules)
      // are excluded by `git add` automatically.
      commitDevLoopBoundary(inputWithGate.worktreePath, logger, inputWithGate.initiativeId);
      // G8: the boundary commit may have added a commit on top of the
      // dev-loop's last per-WI push, so push once more and then assert the
      // local↔remote invariant. This is the precondition the review
      // redesign depends on: at dev-loop close `origin/<branch>` == local
      // HEAD and `main` == merge-base (no divergence). A violation throws
      // and is classified — the branch is not in a reviewable state.
      enforceDevLoopCloseInvariant(inputWithGate.worktreePath, logger, inputWithGate.initiativeId);

      // cascade-v4 #3: DELIVERY GATE. A unifier that did not pass its composed
      // gate (project tests green + structured demo + self-contained PR +
      // branches synced) has NOT produced a review-ready branch. Letting the
      // reviewer open a PR here is the quality escape an inattentive operator
      // could merge (final gate fails, mergeable PR still appears). Block PR
      // creation with a classified failure instead — the manifest routes to
      // triage, not to a misleading "ready" PR. (Demo-missing was already
      // blocked by openPullRequest's assertTrackedDemoExists; this closes the
      // demo-present-but-gate-failed gap.)
      if (!devLoopOutcome.unifierSucceeded) {
        throw new Error(
          `delivery gate: unifier did not pass (${devLoopOutcome.unifierFailureClass ?? 'dev-loop-unifier-gate-failed'}) — ` +
            `the branch is not review-ready, so no PR is opened. Triage the unifier failure before re-running.`,
        );
      }

      // DEV-1: empty-branch guard. A branch with zero commits ahead of base AND
      // zero insertions has nothing to review — opening a PR against it is
      // misleading and was the root cause of the empty PR #1 incident (a
      // resume-from-unifier cycle with complete:0 and no commits ahead of base).
      assertNonEmptyDelivery(devLoopOutcome, inputWithGate.initiativeId, inputWithGate.worktreePath, logger);

      // FINAL CI DELIVERY GATE. The dev-loop's gates are SCOPED per-WI, so a
      // cycle can reach here with the project's FULL CI (whole-module test +
      // gofmt/terrafmt + lint) red — which shipped a real PR with formatting +
      // lint red at review. Before opening the PR, auto-apply the project's
      // formatters then run its operator-configured `ci_gate` DIRECTLY; a red
      // gate throws `ci-gate-failed` so the manifest routes to triage instead
      // of producing a CI-red "ready" PR. The ci_gate is a trusted
      // `["bash","-c","…&&…"]` chain — run via execFileSync here, NOT through
      // the pipe-banned per-WI gate runner (runShellGate / gateIsShellPipeline).
      enforceFinalCiGate(inputWithGate, logger);

      // Open the PR inline (REV-6: the reviewer phase is now just PR-opening;
      // inlined here so the spine is: dev-loop → delivery gate → open PR → closure).
      // All reviewer.* events are preserved verbatim so the forge-ui phase hexes
      // and e2e harness keep working without change.
      const reviewerOutcome = await openPrInline(inputWithGate, logger);

      // Closure: reflection fires ONLY on a GitHub-confirmed merge (G10),
      // and `_queue/done/` ⇒ the PR is MERGED (G1). The closure step asks
      // GitHub `gh pr view --json state`; on MERGED it aligns local↔remote
      // (ff main, prune the initiative branch) and moves the manifest to
      // `done/`; otherwise the manifest stays in `ready-for-review/`
      // flagged and reflection is skipped. The operator merging the PR in
      // GitHub is what closes the review phase — nothing here auto-merges.
      const closure = await runClosure(inputWithGate, logger, reviewerOutcome);
      cycleOutcome = closure.outcome;
      if (closure.merged) {
        const reflectorResult = await runReflector(inputWithGate, logger);
        reflectionStatus = reflectorResult.reflection_status;
        lintStatus = reflectorResult.lint_status;
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
      lint_status: lintStatus,
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
    status: cycleOutcome,
    reflection_status: reflectionStatus,
    lint_status: lintStatus,
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
    metadata: {
      status: result.status,
      reflection_status: result.reflection_status,
      lint_status: result.lint_status,
    },
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
export async function snapshotCycleArtefacts(
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

  // Demo bundle (ADR 021): the unifier writes the TRACKED demo at
  // <worktree>/demo/<initiativeId>/ (demo.json + derived DEMO.md/DEMO.html +
  // any media). Mirror it into _logs/<cycleId>/artifacts/ so the bridge can
  // serve it to the in-UI review screen (`/api/artifact/<cycleId>/<file>`).
  // (Previously copied a stale `.forge/demos/` path into `_logs/<cycleId>/demo/`,
  // which nothing populated or served — the root cause of the blank review demo.)
  const artifactsDst = resolve(cycleLogDir, 'artifacts');
  const demoSrc = resolve(input.worktreePath, 'demo', input.initiativeId);
  if (existsSync(demoSrc)) {
    cpSync(demoSrc, artifactsDst, { recursive: true, force: true });
  }

  // Architect PLAN.html (best-effort): resolve the session that produced this
  // initiative by finding the `_architect/<sid>/` whose `manifests/` holds it,
  // so the review screen's "view plan" link works too.
  try {
    const archRoot = resolve(input.projectRepoPath, '_architect');
    if (existsSync(archRoot)) {
      for (const sid of readdirSync(archRoot)) {
        const draftManifest = resolve(archRoot, sid, 'manifests', `${input.initiativeId}.md`);
        const planHtml = resolve(archRoot, sid, 'PLAN.html');
        if (existsSync(draftManifest) && existsSync(planHtml)) {
          mkdirSync(artifactsDst, { recursive: true });
          cpSync(planHtml, resolve(artifactsDst, 'PLAN.html'), { force: true });
          break;
        }
      }
    }
  } catch { /* best-effort — never block the cycle on plan mirroring */ }

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

// REV-6: runReviewer was a near-empty wrapper around openPullRequest. Its
// logic is now inlined into openPrInline (below) so the spine is simply
// dev-loop → delivery gate → open PR → closure. The reviewer.ts file is
// deleted; its events are preserved verbatim so the UI + e2e harness are
// unaffected.

// runReflector + its REFLECTOR_LIVE_* defaults + resolveCurrentManifestPath
// moved to ./phases/reflector.ts (Phase 3.4c step 2). Imported at the top.

/**
 * REV-6: inline PR-opening (previously `runReviewer`). Opens the PR from the
 * unifier-authored `.forge/pr-description.md`, emitting every event the old
 * `runReviewer` emitted (verbatim phase/skill/message values) so the forge-ui
 * phase hexes and e2e harness remain unaffected.
 *
 * Returns `ReviewerOutcome` — always `'pr-open'` on success, or throws with a
 * structured `unifier.prerequisite-missing` event on failure (matching the
 * former reviewer.ts behaviour exactly).
 */
async function openPrInline(
  input: CycleInput,
  logger: EventLogger,
): Promise<import('./cycle-context.ts').ReviewerOutcome> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
  });

  const prDescriptionPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
  const prTitle = `forge: ${input.initiativeId}`;
  const prUrl = openPullRequest(input.worktreePath, prDescriptionPath, prTitle);

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: prUrl ? 'log' : 'error',
    input_refs: [prDescriptionPath],
    output_refs: prUrl ? [prUrl] : [],
    message: prUrl ? 'reviewer.pr-opened' : 'reviewer.pr-open-failed',
    metadata: { url: prUrl, pr_created: prUrl !== null },
  });

  if (!prUrl) {
    const demoMdPath = resolve(input.worktreePath, 'demo', input.initiativeId, 'DEMO.md');
    const prDescPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
    const missing: string[] = [];
    if (!existsSync(demoMdPath)) missing.push(`demo/${input.initiativeId}/DEMO.md`);
    if (!existsSync(prDescPath)) missing.push('.forge/pr-description.md');
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'review-router',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'unifier.prerequisite-missing',
      metadata: { missing, demo_md_path: demoMdPath, pr_description_path: prDescPath },
    });
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'review-router',
      event_type: 'end',
      input_refs: [input.worktreePath],
      output_refs: [input.worktreePath],
      metadata: { outcome: 'failed', pr_url: null, missing_prerequisites: missing },
    });
    throw new Error(
      `reviewer.pr-open-failed: unifier did not author a PR — missing prerequisites: ${missing.join(', ')}. ` +
        `Dev-loop work items must produce their declared \`creates:\` paths before the unifier can build a demo bundle.`,
    );
  }

  const outcome: import('./cycle-context.ts').ReviewerOutcome = 'pr-open';
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'end',
    input_refs: [input.worktreePath],
    output_refs: [prUrl],
    metadata: { outcome, pr_url: prUrl },
  });

  return outcome;
}

function newCycleId(initiativeId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${initiativeId}`;
}

/**
 * DEV-1: empty-branch delivery guard. Throws with a `zero-delivery`
 * classification and emits a `delivery-gate.empty-branch` error event when
 * the branch has 0 commits ahead of base AND 0 insertions — nothing to
 * review. Exported for direct unit testing (no SDK, no git).
 */
export function assertNonEmptyDelivery(
  outcome: { commitsAhead: number; filesChanged: number; insertions: number },
  initiativeId: string,
  worktreePath: string,
  logger: EventLogger,
): void {
  if (outcome.commitsAhead === 0 && outcome.insertions === 0) {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'delivery-gate.empty-branch',
      metadata: {
        failure_class: 'zero-delivery',
        commits_ahead: outcome.commitsAhead,
        files_changed: outcome.filesChanged,
        insertions: outcome.insertions,
        note: 'branch has no commits ahead of base and no insertions — no PR opened',
      },
    });
    throw new Error(
      `delivery gate: branch has 0 commits ahead of base and 0 insertions — ` +
        `nothing to review (zero-delivery). Triage why the dev-loop produced no commits.`,
    );
  }
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
        // `failure_mode` retained for backward compatibility with archived
        // log readers; value is now 'transient' | 'terminal' (was a
        // 14-mode enum pre-2026-05-24).
        failure_mode: cls.kind,
        failure_kind: cls.kind,
        recoverable: cls.recoverable,
        reason: cls.reason,
        evidence_event_ids: cls.evidence_event_ids,
      },
    });
  } catch {
    /* best-effort */
  }
}

// emitGateEvent moved to ./phases/developer-loop.ts (Phase 3.4c step 4).
// extractPrTitle moved to ./phases/reviewer.ts (Phase 3.4c step 5).

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
    // Second guard (linkProjectDeps writes the primary one to the worktree's
    // git exclude): never let the forge-created `node_modules` symlink into
    // the boundary commit. A project .gitignore of `node_modules/` does not
    // match a symlink named `node_modules`; `--ignore-unmatch` keeps this a
    // no-op when it isn't staged.
    try {
      execFileSync('git', ['reset', '-q', '--', 'node_modules'], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
    } catch {
      /* best-effort — not staged / nothing to unstage */
    }
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

/**
 * G8: enforce the local↔remote invariant at dev-loop close. Pushes once
 * more (the boundary commit may have added a commit on top of the
 * dev-loop's last per-WI push), then asserts:
 *   - `origin/<branch>` == local HEAD  (branch fully published)
 *   - `main` == merge-base(main, branch)  (main did not diverge)
 *
 * On violation this THROWS — a diverged / unpublished branch is not a
 * reviewable state, and the failure-classifier surfaces it. The branch
 * sync is the precondition the review-phase redesign depends on
 * (architecture.md §G / brain theme `review-phase-target-design`).
 */
function enforceDevLoopCloseInvariant(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  const push = pushInitiativeBranch(worktreePath);
  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: push.pushed ? 'log' : 'error',
    input_refs: [worktreePath],
    output_refs: [],
    message: push.pushed ? 'cycle.dev-close-pushed' : 'cycle.dev-close-push-failed',
    metadata: push.pushed ? { branch: push.branch } : { reason: push.reason },
  });
  const inv = assertLocalRemoteSynced(worktreePath);
  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [worktreePath],
    output_refs: [],
    message: 'cycle.dev-close-invariant-ok',
    metadata: {
      branch: inv.branch,
      local_head: inv.localHead,
      origin_head: inv.originHead,
      main_head: inv.mainHead,
      merge_base: inv.mergeBase,
    },
  });
}

/** Result of running one operator-configured command vector. */
export type CiCommandResult = { ok: boolean; output: string };

/**
 * Injectable command runner so `decideFinalCiGate` is unit-testable without
 * spawning real processes. The production runner (`execCommandVector`) wraps
 * `execFileSync`; tests pass a stub. `kind` distinguishes the fixer (best-effort)
 * from the gate (verdict) so the runner can pick an appropriate timeout.
 */
export type CiCommandRunner = (
  cmd: string[],
  worktreePath: string,
  kind: 'fix' | 'gate',
  /**
   * Env-var names to strip from the child env so the CI gate mirrors GitHub
   * CI regardless of the cycle env (e.g. `TF_ACC`). Empty/undefined ⇒ inherit
   * `process.env` unchanged.
   */
  unsetEnv?: string[],
) => CiCommandResult;

const CI_FIX_TIMEOUT_MS = 5 * 60_000;
const CI_GATE_TIMEOUT_MS = 20 * 60_000;

/**
 * Production command runner. Runs the vector DIRECTLY via `execFileSync`
 * (`["bash","-c","…&&…"]` is run as `bash -c …`) — deliberately NOT routed
 * through the per-WI gate runner (runShellGate / gateIsShellPipeline), whose
 * pipe-ban would reject the operator's `&&` CI chain. The operator authored
 * `ci_gate`, so it is trusted. Exported for a focused real-spawn test of the
 * A3 env-stripping (the rest of the gate logic is tested via `decideFinalCiGate`
 * with a stubbed runner).
 */
export function execCommandVector(
  cmd: string[],
  worktreePath: string,
  kind: 'fix' | 'gate',
  unsetEnv?: string[],
): CiCommandResult {
  const [head, ...rest] = cmd;
  const timeout = kind === 'fix' ? CI_FIX_TIMEOUT_MS : CI_GATE_TIMEOUT_MS;
  // A3 (2026-06-06): strip the project's declared live-test triggers (e.g.
  // `TF_ACC`) so the CI delivery gate mirrors GitHub CI even when the serve
  // env set them for the per-WI live-acceptance gates. No list ⇒ inherit env.
  let env: NodeJS.ProcessEnv | undefined;
  if (unsetEnv && unsetEnv.length > 0) {
    env = { ...process.env };
    for (const name of unsetEnv) delete env[name];
  }
  try {
    const out = execFileSync(head, rest, {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout,
      ...(env ? { env } : {}),
    });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = e.stdout ? e.stdout.toString() : '';
    const stderr = e.stderr ? e.stderr.toString() : '';
    return { ok: false, output: (stdout + stderr) || (e.message ?? '') };
  }
}

/**
 * Pure decision core for the final CI gate. Exported for direct unit testing
 * with a stubbed `run` (no real `make test`). Given the project's `ciGate` +
 * optional `ciFixCmd`:
 *   1. Best-effort apply the formatters (`ciFixCmd`) — never throws on a fixer
 *      error (a broken formatter must not block delivery).
 *   2. Run the full `ciGate`; return its ok + (tail of) output.
 * No-op (returns `null`) when `ciGate` is absent/empty — the caller then skips
 * committing/pushing fmt changes and the gate entirely. This function performs
 * NO git/IO of its own; the orchestrator commits+pushes any fmt changes around
 * it (it cannot know whether the fixer changed files).
 */
export function decideFinalCiGate(
  args: {
    ciGate: string[] | null;
    ciFixCmd: string[] | null;
    worktreePath: string;
    run: CiCommandRunner;
    /** Env-var names to strip from both fixer + gate runs (A3, e.g. `TF_ACC`). */
    unsetEnv?: string[];
  },
): { ranFixer: boolean; gateOk: boolean; gateOutput: string } | null {
  const { ciGate, ciFixCmd, worktreePath, run, unsetEnv } = args;
  if (!ciGate || ciGate.length === 0) return null;

  let ranFixer = false;
  if (ciFixCmd && ciFixCmd.length > 0) {
    // Best-effort: a fixer that errors must never throw — the gate below is the
    // real verdict, and an un-formatted tree just fails that gate cleanly.
    try {
      run(ciFixCmd, worktreePath, 'fix', unsetEnv);
      ranFixer = true;
    } catch {
      /* swallow — formatter failure is non-fatal */
    }
  }

  const gate = run(ciGate, worktreePath, 'gate', unsetEnv);
  return { ranFixer, gateOk: gate.ok, gateOutput: gate.output };
}

/**
 * Final CI delivery gate (orchestrator wiring around `decideFinalCiGate`).
 * Reads the project's `ci_gate` + `ci_fix_cmd` from `.forge/project.json`;
 * when a `ci_gate` is configured (and not a dry run), applies the formatters,
 * commits+pushes any resulting fmt changes so the PR is fmt-clean, then runs
 * the full CI gate. A red gate emits a classified `cycle.ci-gate` event and
 * throws `ci-gate-failed` so the cycle routes to triage rather than opening a
 * CI-red PR. Best-effort config read — a missing/unreadable project.json
 * simply skips the gate (the dev-loop's scoped gates still ran).
 */
function enforceFinalCiGate(input: CycleInput, logger: EventLogger): void {
  if (input.dryRun) return;

  let ciGate: string[] | null = null;
  let ciFixCmd: string[] | null = null;
  let ciGateUnsetEnv: string[] = [];
  try {
    const cfg = loadProjectConfig(input.projectRepoPath);
    ciGate = cfg?.ci_gate && cfg.ci_gate.length > 0 ? cfg.ci_gate : null;
    ciFixCmd = cfg?.ci_fix_cmd && cfg.ci_fix_cmd.length > 0 ? cfg.ci_fix_cmd : null;
    ciGateUnsetEnv = cfg?.ci_gate_unset_env && cfg.ci_gate_unset_env.length > 0 ? cfg.ci_gate_unset_env : [];
  } catch (err) {
    // A malformed project.json is fail-closed elsewhere (dev-loop loads it);
    // here we log-and-skip rather than mask a real config error at PR-open.
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      input_refs: [input.projectRepoPath],
      output_refs: [],
      message: 'cycle.ci-gate-skipped',
      metadata: { reason: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  if (!ciGate) return;

  const decision = decideFinalCiGate({
    ciGate,
    ciFixCmd,
    worktreePath: input.worktreePath,
    run: execCommandVector,
    unsetEnv: ciGateUnsetEnv,
  });
  // decision is non-null because ciGate is non-empty.
  if (!decision) return;

  // Commit + push any formatting changes the fixer produced so the PR is
  // fmt-clean. Guard on a dirty tree so a no-op fixer adds no empty commit.
  if (decision.ranFixer) {
    commitAndPushCiFix(input.worktreePath, logger, input.initiativeId);
  }

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: decision.gateOk ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: 'cycle.ci-gate',
    metadata: {
      ok: decision.gateOk,
      ran_fixer: decision.ranFixer,
      ci_gate: ciGate,
      ...(ciGateUnsetEnv.length > 0 ? { ci_gate_unset_env: ciGateUnsetEnv } : {}),
      output_tail: decision.gateOutput.slice(-1200),
    },
  });

  if (!decision.gateOk) {
    throw new Error(
      `ci-gate-failed: the project ci_gate is red — not opening a PR (triage before re-running).\n` +
        decision.gateOutput.slice(-1200),
    );
  }
}

/**
 * Commit + push any working-tree changes the CI auto-formatter produced.
 * Guarded by `git status --porcelain` so a no-op fixer adds no empty commit.
 * Best-effort push — a push failure is logged but does not throw (the gate
 * already passed against the local tree; the PR open will surface a real sync
 * problem via the existing invariants).
 */
function commitAndPushCiFix(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).toString().trim();
    if (dirty.length === 0) return;

    execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    try {
      execFileSync('git', ['reset', '-q', '--', 'node_modules'], { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      /* best-effort — not staged */
    }
    execFileSync('git', ['commit', '-m', 'style: apply ci_fix_cmd (auto-format)'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    let pushed = true;
    let pushReason: string | null = null;
    try {
      execFileSync('git', ['push'], { cwd: worktreePath, stdio: 'pipe' });
    } catch (err) {
      pushed = false;
      pushReason = err instanceof Error ? err.message : String(err);
    }
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: pushed ? 'log' : 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: pushed ? 'cycle.ci-fix-committed' : 'cycle.ci-fix-push-failed',
      metadata: pushed ? undefined : { reason: pushReason },
    });
  } catch {
    // Not a git repo / nothing to commit / git failed — non-fatal: the gate
    // ran against the local tree regardless.
  }
}
