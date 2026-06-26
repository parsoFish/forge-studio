/**
 * F-W5-7 — auto-finalize a ready-for-review cycle once the operator has merged
 * its PR.
 *
 * The review phase NEVER merges; the operator merges the PR in GitHub, and
 * closure only fires the merge-confirmation + reflection when it RUNS. In the
 * unattended flow the cycle reaches `ready-for-review` (PR open) and the cycle
 * process ends — so a merge that lands AFTER that is never re-confirmed, and the
 * initiative sits in `ready-for-review/` forever even though it's merged (no
 * `done/` move, no local↔remote align / branch delete, no reflection).
 *
 * The closure design already anticipates this: `CycleInput.confirmMerge`'s doc
 * says "a later re-trigger re-checks and proceeds once the operator has merged".
 * This module IS that re-trigger. The scheduler calls it on a timer (and at
 * startup): for each `ready-for-review/` manifest whose PR is now MERGED, it
 * re-claims the manifest and runs closure → (on confirmed merge) the reflector,
 * so the initiative lands in `done/`, local↔remote is aligned, the merged branch
 * is deleted, and reflection becomes available in the UI.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { confirmPrMerged } from './pr.ts';
import { pendingUnifierItems } from './unifier-items.ts';
import { runClosure } from './phases/closure.ts';
import { runReflector } from './phases/reflector.ts';
import { writeCycleReport } from './cycle-report.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { writeVerdictJson } from './flow-artifacts.ts';
import { fireFlowTriggers } from './flow-trigger.ts';
import { loadFlowDefinition } from './studio/registry.ts';
import { flowPathForId } from './flow-runner.ts';
import { DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { CycleInput, ReviewerOutcome } from './cycle-context.ts';
import type { FlowTrigger } from './studio/types.ts';

export type FinalizeStatus = 'finalized' | 'still-open' | 'no-worktree' | 'error';
export type FinalizeResult = { initiativeId: string; status: FinalizeStatus; detail?: string };

export type FinalizeDeps = {
  /** Queue root. Defaults to the cwd-based queue (matches the scheduler). */
  queueRoot?: string;
  /** `<forge>/_logs`. Defaults to `<cwd>/_logs`. */
  logsRoot?: string;
  /** Merge probe. Defaults to `confirmPrMerged` (gh pr view state == MERGED). */
  confirmMerge?: (worktreePath: string) => boolean | Promise<boolean>;
  /**
   * Per-cycle finalize action: run closure + (on confirmed merge) fire the
   * flow's declared `on: merged` triggers. Returns whether the merge was
   * confirmed. Injectable for tests; defaults to the real closure→trigger chain.
   */
  finalizeOne?: (input: CycleInput, logger: EventLogger) => Promise<boolean>;
  /** Closure step. Injectable so a trigger-firing test needn't run real git/gh. */
  runClosure?: (input: CycleInput, logger: EventLogger, reviewerOutcome: ReviewerOutcome) => Promise<ClosureResult>;
  /** Reflector action a `forge-reflect` merge-trigger dispatches to. Injectable. */
  runReflector?: (input: CycleInput, logger: EventLogger) => Promise<void>;
  /** Resolve a flow's declared triggers by id. Default loads the flow.yaml. */
  loadFlowTriggers?: (flowId: string) => FlowTrigger[];
  notify?: (msg: string) => void;
};

/** The timestamped log-dir cycle id for an initiative (most-recent), so the
 *  reflector writes `user-questions.json` where the UI's /api/reflect reads it.
 *  Exported so the ADR 026 drain shares the same `_logs`-dir resolution. */
export function latestCycleId(logsRoot: string, initiativeId: string): string | null {
  if (!existsSync(logsRoot)) return null;
  let best: { id: string; mtime: number } | null = null;
  for (const name of readdirSync(logsRoot)) {
    if (!name.endsWith(`_${initiativeId}`)) continue;
    let mtime = 0;
    try { mtime = statSync(join(logsRoot, name)).mtimeMs; } catch { continue; }
    if (!best || best.mtime < mtime) best = { id: name, mtime };
  }
  return best?.id ?? null;
}

/** Read a manifest's flow_id (the flow the merged cycle ran); null on any failure. */
function readManifestFlowId(manifestPath: string): string | null {
  try {
    return parseManifest(readFileSync(manifestPath, 'utf8')).flow_id ?? null;
  } catch {
    return null;
  }
}

/** Default trigger resolution: load the flow.yaml and return its declared triggers. */
function defaultLoadFlowTriggers(flowId: string): FlowTrigger[] {
  try {
    return loadFlowDefinition(flowPathForId(flowId)).triggers;
  } catch {
    return [];
  }
}

/**
 * Default per-cycle finalize: closure confirms+aligns+moves, then — on a
 * confirmed merge — fires the merged flow's declared `on: merged` triggers
 * through the generic FlowTrigger path. The SINGLE source of "merge fires
 * reflect" is forge-develop's `{on: merged, flow: forge-reflect}` declaration in
 * its flow.yaml, NOT a hardcoded runReflector call here. Built from `deps` so a
 * test can inject the closure + reflector + trigger source.
 */
function makeDefaultFinalizeOne(
  deps: FinalizeDeps,
): (input: CycleInput, logger: EventLogger) => Promise<boolean> {
  const runClosureFn = deps.runClosure ?? runClosure;
  const runReflectorFn = deps.runReflector ?? runReflector;
  const loadFlowTriggers = deps.loadFlowTriggers ?? defaultLoadFlowTriggers;

  return async (input, logger) => {
    const closure = await runClosureFn(input, logger, 'pr-open');
    if (!closure.merged) return false;

    const flowId = readManifestFlowId(input.manifestPath) ?? DEVELOP_FLOW_ID;
    await fireFlowTriggers(
      { id: flowId, triggers: loadFlowTriggers(flowId) },
      'merged',
      {
        onFire: (t) =>
          logger.emit({
            initiative_id: input.initiativeId,
            phase: 'orchestrator',
            skill: 'finalize-merged',
            event_type: 'log',
            input_refs: [],
            output_refs: [],
            message: 'finalize.trigger-firing',
            metadata: { on: t.on, target_flow: t.flow, source_flow: flowId },
          }),
        dispatch: async (t) => {
          if (t.flow === 'forge-reflect') {
            await runReflectorFn(input, logger);
          } else {
            logger.emit({
              initiative_id: input.initiativeId,
              phase: 'orchestrator',
              skill: 'finalize-merged',
              event_type: 'log',
              input_refs: [],
              output_refs: [],
              message: 'finalize.trigger-unhandled-target',
              metadata: { on: t.on, target_flow: t.flow, note: 'only forge-reflect has a merge-time handler' },
            });
          }
        },
      },
    );

    // report.md was written once at cycle.end (pr-open). Now that the merge is
    // confirmed + finalized, regenerate it so the report reflects the MERGED
    // state (baseline/diff render against the merge commit) instead of staying
    // permanently "Status: pr-open / no merge event recorded".
    if (input.cycleId) {
      try {
        writeCycleReport({ cycleId: input.cycleId });
      } catch {
        /* report regeneration is best-effort — never block finalize on it */
      }
    }
    return true;
  };
}

export async function finalizeMergedReadyForReview(deps: FinalizeDeps = {}): Promise<FinalizeResult[]> {
  const paths = getPaths(deps.queueRoot);
  const logsRoot = deps.logsRoot ? resolve(deps.logsRoot) : resolve('_logs');
  const confirmMerge = deps.confirmMerge ?? confirmPrMerged;
  const finalizeOne = deps.finalizeOne ?? makeDefaultFinalizeOne(deps);

  const out: FinalizeResult[] = [];
  if (!existsSync(paths.readyForReview)) return out;

  for (const file of readdirSync(paths.readyForReview)) {
    if (!file.endsWith('.md')) continue;
    const manifestPath = join(paths.readyForReview, file);
    let initiativeId = file.replace(/\.md$/, '');
    try {
      const m = parseManifest(readFileSync(manifestPath, 'utf8'));
      initiativeId = m.initiative_id || initiativeId;
      const worktreePath = m.worktree_path ?? '';
      const projectRepoPath = m.project_repo_path ?? '';
      if (!worktreePath || !existsSync(worktreePath)) {
        out.push({ initiativeId, status: 'no-worktree' });
        continue;
      }
      if (!(await confirmMerge(worktreePath))) {
        out.push({ initiativeId, status: 'still-open' });
        continue;
      }
      // ADR 026 merge-vs-drain: a merged PR is terminal — finalize WINS over the
      // drain (running review UWIs against a merged branch is pointless). But if
      // the operator merged with review work-items still pending, surface it so
      // the drop is never SILENT (the merge overrides the unrun concerns).
      const pendingUwis = pendingUnifierItems(worktreePath);
      if (pendingUwis.length > 0) {
        deps.notify?.(
          `${initiativeId} · merged with ${pendingUwis.length} pending review work-item(s) unrun (${pendingUwis.map((p) => p.work_item_id).join(', ')}) — the operator's merge overrides them`,
        );
      }
      // Re-claim to in-flight/ so closure's terminal move (in-flight → done)
      // has a source. If closure decides NOT merged after all it moves the
      // manifest back to ready-for-review/, so this round-trip is safe.
      const inFlightPath = join(paths.inFlight, file);
      renameSync(manifestPath, inFlightPath);

      // ADR 026: prefer the cycle_id persisted on the manifest (the authoritative
      // anchor written at first claim) so finalize appends to the SAME `_logs`
      // dir the cycle used; fall back to the latest matching dir for legacy
      // manifests that never persisted one.
      const cycleId = m.cycle_id ?? latestCycleId(logsRoot, initiativeId) ?? initiativeId;
      const logger = createLogger(cycleId, logsRoot);
      const input: CycleInput = { initiativeId, manifestPath: inFlightPath, projectRepoPath, worktreePath, cycleId };

      // ADR-027: a confirmed GitHub merge is an implicit approve — persist the
      // verdict artifact (the operator merged silently, no UI verdict) so the
      // reflector that runs inside finalizeOne has a durable record. overwrite:
      // false keeps an explicit UI approve/send-back, if one was already written.
      writeVerdictJson(
        logsRoot,
        { kind: 'approve', initiative_id: initiativeId, cycleId, decidedBy: 'merge', at: new Date().toISOString() },
        { overwrite: false },
      );

      const merged = await finalizeOne(input, logger);
      if (merged) {
        deps.notify?.(`${initiativeId} · merged PR confirmed → finalized (done + reflection)`);
        out.push({ initiativeId, status: 'finalized' });
      } else {
        out.push({ initiativeId, status: 'still-open' });
      }
    } catch (err) {
      out.push({ initiativeId, status: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
