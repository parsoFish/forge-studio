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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogger } from './logging.ts';
import { createLogger } from './logging.ts';
import { classifyCycleFailure } from './failure-classifier.ts';
import { writeCycleReport } from './cycle-report.ts';
import { readManifestOrigin, readManifestCycleId, readManifestFlowId, persistManifestCycleId, parseManifest } from './manifest.ts';

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

// Phase runners are now invoked via flow-runner.ts (ADR-028 M3-2).
// The six helper functions (openPrInline, commitDevLoopBoundary,
// enforceDevLoopCloseInvariant, enforceFinalCiGate, preservingForgeScratch,
// assertNonEmptyDelivery) live in ./cycle-helpers.ts to break the inside-out
// dependency (flow-runner.ts imports them; cycle.ts imports runFlow from
// flow-runner.ts). Re-exported here so callers that import from './cycle.ts'
// are unaffected.
export {
  openPrInline,
  preservingForgeScratch,
  assertNonEmptyDelivery,
  commitDevLoopBoundary,
  enforceDevLoopCloseInvariant,
  enforceFinalCiGate,
} from './cycle-helpers.ts';

// Flow-runner: the phase-sequencing DAG executor (ADR-028, M3-2).
import { runFlow, forgeCycleFlowPath, flowPathForId } from './flow-runner.ts';
import { loadFlowDefinition } from './studio/registry.ts';
// S4: computeAdaptiveReviewIterationCap removed alongside the Ralph reviewer.
// The unifier sub-phase owns iteration in dev-loop space; the review phase is
// now a thin, non-LLM PR-opener inlined here (REV-6). The operator's verdict
// arrives out-of-band as a UI action: APPROVE is a no-op ack (they merge in
// GitHub; closure confirms); ADD-WORK-ITEMS (ADR 026) appends typed UWIs to the
// unifier queue in the live worktree and the drain re-runs them in the SAME
// cycle (one cycleId) — no requeue, no send-back to a dev phase.

/**
 * P4: emit synthetic architect start+end events into the cycle log.
 *
 * The architect ran OUT-OF-CYCLE (in-UI session before the scheduler claimed
 * this cycle). The manifest carries the session's real cost + duration when
 * the finalize step stamped them; falls back gracefully for legacy manifests.
 *
 * Emitted unconditionally (including dry-run) so the UI can always reflect
 * the architect phase as complete, and so P4 tests can verify the events.
 *
 * Exported for use by flow-runner.ts's default `emitSyntheticArchitect` dep.
 */
export function emitSyntheticArchitectEvents(
  input: CycleInput,
  logger: EventLogger,
  origin?: string,
): void {
  const resolvedOrigin = origin ?? readManifestOrigin(input.manifestPath);
  let architectCostUsd: number | undefined;
  let architectDurationMs: number | undefined;
  let architectSessionId: string | undefined;
  try {
    const mf = parseManifest(readFileSync(input.manifestPath, 'utf8'));
    if (typeof mf.architect_cost_usd === 'number') architectCostUsd = mf.architect_cost_usd;
    if (typeof mf.architect_duration_ms === 'number') architectDurationMs = mf.architect_duration_ms;
    if (mf.architect_session_id) architectSessionId = mf.architect_session_id;
  } catch {
    /* best-effort — a missing/unreadable manifest must not block the cycle */
  }
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'architect',
    skill: 'architect',
    event_type: 'start',
    input_refs: [],
    output_refs: [input.manifestPath],
    message: 'architect.start',
    metadata: {
      origin: resolvedOrigin,
      ...(architectSessionId ? { session_id: architectSessionId } : {}),
      note: 'architect ran out-of-cycle; event emitted by orchestrator so the UI can reflect the phase as complete',
    },
  });
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'architect',
    skill: 'architect',
    event_type: 'end',
    input_refs: [],
    output_refs: [input.manifestPath],
    message: 'architect.end',
    ...(typeof architectCostUsd === 'number' ? { cost_usd: architectCostUsd } : {}),
    ...(typeof architectDurationMs === 'number' ? { duration_ms: architectDurationMs } : {}),
    metadata: {
      origin: resolvedOrigin,
      ...(architectSessionId ? { session_id: architectSessionId } : {}),
    },
  });
}

export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const started = Date.now();
  // ADR 026: keep one initiative on ONE cycleId for its whole life. Prefer an
  // explicitly threaded id (the review→unifier drain + the merge finalizer pass
  // it), then a previously-persisted id (a crash-recovery resume reuses the
  // original cycle's `_logs` dir instead of minting a sibling — the root fix for
  // the cost/status-lineage-blanks defect), else mint a fresh one and anchor it
  // on the manifest now so every later re-entry threads the same id.
  const persistedCycleId = !input.cycleId ? readManifestCycleId(input.manifestPath) : null;
  const cycleId = input.cycleId ?? persistedCycleId ?? newCycleId(input.initiativeId);
  if (!input.dryRun && !input.cycleId && !persistedCycleId) {
    persistManifestCycleId(input.manifestPath, cycleId);
  }
  const logger = createLogger(cycleId, '_logs', {
    tee: input.eventTee,
  });

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

  // P4: emit architect start+end events into the cycle log. The architect ran
  // OUT-OF-CYCLE (in-UI session before the scheduler claimed this cycle). The
  // manifest carries the session's real cost + duration when the finalize step
  // stamped them (P4); fall back to a zero-cost synthetic pair for legacy/
  // hand-authored manifests that lack the fields.
  //
  // Emitted here (not inside runFlow) so dry-run cycles also produce the
  // architect events — the P4 tests verify this unconditional emission.
  emitSyntheticArchitectEvents(input, logger, origin);

  // F-04 / F-06: derive the effective quality-gate command once per cycle so
  // the dev-loop and reviewer use exactly the same gate. Precedence:
  //   1. CycleInput.qualityGateCmd (explicit override — bench harnesses use this)
  //   2. manifest.quality_gate_cmd (per-project config in initiative manifest)
  //   3. ['npm', 'test'] if the worktree has package.json
  //   4. ['true'] (no-op, tests bypassed) — only happens for non-Node repos
  //      that didn't declare a quality_gate_cmd; the dispatch will surface
  //      the absence via a metadata field.
  const effectiveQualityGateCmd = resolveQualityGateCmd(input);
  const inputWithGate: CycleInput = {
    ...input,
    qualityGateCmd: effectiveQualityGateCmd,
  };

  // Final cycle outcome. `merged` is reachable ONLY via the closure step
  // (a GitHub-confirmed merge) — never from the reviewer (G9).
  let cycleOutcome: CycleOutcome = 'ready-for-review';
  let reflectionStatus: ReflectionStatus = 'skipped';
  let lintStatus: LintStatus = 'skipped';
  try {
    if (!input.dryRun) {
      // ADR-028 M3-2: delegate the phase sequence to flow-runner.
      // Route to the flow the initiative manifest names (`flow_id`); default to
      // forge-cycle. A named-but-missing flow file falls back to forge-cycle with
      // a logged warning so a bad id can't strand a cycle. The outer scaffolding
      // (cycleId, logger, cycle.start/end, failure classification, snapshot,
      // report) stays here in runCycle.
      const flowId = readManifestFlowId(input.manifestPath);
      let flowPath = forgeCycleFlowPath();
      if (flowId && flowId !== 'forge-cycle') {
        const candidate = flowPathForId(flowId);
        if (existsSync(candidate)) {
          flowPath = candidate;
        } else {
          logger.emit({
            initiative_id: input.initiativeId,
            phase: 'orchestrator',
            skill: 'cycle',
            event_type: 'log',
            input_refs: [input.manifestPath],
            output_refs: [],
            message: 'cycle.flow-id-missing-fallback',
            metadata: { flow_id: flowId, fallback: 'forge-cycle' },
          });
        }
      }
      const flow = loadFlowDefinition(flowPath);
      const flowResult = await runFlow({ flow, input: inputWithGate, logger });
      cycleOutcome = flowResult.cycleOutcome;
      reflectionStatus = flowResult.reflectionStatus as ReflectionStatus;
      lintStatus = flowResult.lintStatus as LintStatus;
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

  // Snapshot before cycle.end so the report can include the cycle.end
  // metadata and reference durable artefacts.
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

  // PR description draft → into artifacts/ (same dir as demo.json) so the bridge
  // artifact route (which serves _logs/<cycleId>/artifacts/<file>) resolves it;
  // previously written to the cycle-log root, so the monitor's PR chip always
  // 404'd → "artifact not yet produced".
  const prSrc = resolve(input.worktreePath, '.forge', 'pr-description.md');
  if (existsSync(prSrc)) {
    mkdirSync(artifactsDst, { recursive: true });
    cpSync(prSrc, resolve(artifactsDst, 'pr-description.md'), { force: true });
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

function newCycleId(initiativeId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${initiativeId}`;
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

