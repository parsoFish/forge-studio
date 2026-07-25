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
 * so the initiative lands in `merged/` (closure), fires reflection, then this
 * module promotes it on to `done/` — all in the SAME sweep (R4-11-F1: `merged`
 * is a transient pass-through, never a parking state; no new periodic sweep
 * does the second move) — local↔remote is aligned, the merged branch is
 * deleted, and reflection becomes available in the UI.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { confirmPrMerged } from './pr.ts';
import { pendingFixWorkItems } from './fix-work-items.ts';
import { runClosure, promoteMergedToDone } from './phases/closure.ts';
import { runReflector } from './phases/reflector.ts';
import { writeCycleReport } from './cycle-report.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { writeVerdictJson } from './flow-artifacts.ts';
import { fireFlowTriggers } from './flow-trigger.ts';
import { loadFlowDefinition, loadAgentDefinition } from './studio/registry.ts';
import { flowPathForId } from './flow-runner.ts';
import { resolveBandHook } from './agent-bands.ts';
import { skillPath } from './skill-path.ts';
import { DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';
import { REFLECTION_LOST_EVENT } from './cycle-context.ts';
import { classifyCrash } from './failure-classifier.ts';
import type { ClosureResult } from './phases/closure.ts';
import type { CycleInput, ReviewerOutcome } from './cycle-context.ts';
import type { AgentDefinition, FlowTrigger, TriggerTarget } from './studio/types.ts';

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
  /** Reflector action an `on: merged` agent-target dispatches to. Injectable. */
  runReflector?: (input: CycleInput, logger: EventLogger) => Promise<void>;
  /**
   * Resolve an agent-target `ref` (slug) to its `AgentDefinition` so the
   * dispatch can read its declared band hook (R4-09-F1: registry-driven, not a
   * hardcoded slug). Defaults to the real skills/ registry; injectable so a
   * trigger-dispatch test needn't depend on a SKILL.md on disk.
   */
  loadAgentDef?: (ref: string) => AgentDefinition;
  /**
   * R4-11-F1 — the second terminal move of a confirmed merge: promotes the
   * manifest `merged/ → done/`, invoked AFTER the reflect trigger fires
   * (success or lost) in the SAME sweep. Closure (`phases/closure.ts`) is the
   * single terminal-move authority; injectable so tests needn't touch the fs.
   */
  promoteMergedToDone?: (input: CycleInput, logger: EventLogger) => void;
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

/** Default agent-def resolution for an agent-target `ref` (slug). */
function defaultLoadAgentDef(ref: string): AgentDefinition {
  return loadAgentDefinition(skillPath(ref));
}

/**
 * R4-09-F1 — resolve an `on: merged` trigger target to its standalone
 * merge-time handler. The resolution is REGISTRY-DRIVEN, not a hardcoded slug:
 * a `{kind: agent}` target whose `AgentDefinition` declares the
 * `reflection-close` band (`agent-bands.ts`) is forge's standalone reflect
 * consumer — the same band-hook indirection `flow-runner`'s `execReflect` uses.
 * Returns the reflect action for that case, else `null` (a flow target, or an
 * agent whose band is not a merge-time handler) so the caller logs it loud +
 * unhandled rather than silently dispatching. Replaces the pre-R4-09 hardcoded
 * `target.ref === 'forge-reflect'` flow-string special case.
 */
function resolveMergeAgentHandler(
  target: TriggerTarget,
  runReflectorFn: (input: CycleInput, logger: EventLogger) => Promise<unknown>,
  loadAgentDef: (ref: string) => AgentDefinition,
): ((input: CycleInput, logger: EventLogger) => Promise<unknown>) | null {
  if (target.kind !== 'agent') return null;
  let def: AgentDefinition;
  try {
    def = loadAgentDef(target.ref);
  } catch {
    return null;
  }
  if (resolveBandHook(def) === 'reflection-close') return runReflectorFn;
  return null;
}

/**
 * Default per-cycle finalize: closure confirms+aligns+moves, then — on a
 * confirmed merge — fires the merged flow's declared `on: merged` triggers
 * through the generic FlowTrigger path. The SINGLE source of "merge fires
 * reflect" is forge-develop's `{on: merged, target: {kind: agent, ref:
 * reflector}}` declaration in its flow.yaml (R4-09-F1 standalone-reflect
 * cutover), resolved here through the registry band hook — NOT a hardcoded
 * runReflector call. Built from `deps` so a test can inject the closure +
 * reflector + trigger source + agent-def resolver.
 */
function makeDefaultFinalizeOne(
  deps: FinalizeDeps,
): (input: CycleInput, logger: EventLogger) => Promise<boolean> {
  const runClosureFn = deps.runClosure ?? runClosure;
  const runReflectorFn = deps.runReflector ?? runReflector;
  const loadFlowTriggers = deps.loadFlowTriggers ?? defaultLoadFlowTriggers;
  const loadAgentDef = deps.loadAgentDef ?? defaultLoadAgentDef;
  const promoteMergedToDoneFn = deps.promoteMergedToDone ?? promoteMergedToDone;

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
            metadata: { on: t.on, target: t.target, source_flow: flowId },
          }),
        dispatch: async (t) => {
          // R4-09-F1: resolve the declared target to its standalone merge-time
          // handler via the registry band hook (an agent whose def declares
          // `reflection-close` is the reflect consumer) — not a hardcoded slug.
          const handler = resolveMergeAgentHandler(t.target, runReflectorFn, loadAgentDef);
          if (handler) {
            // R4-09-F3: the trigger's declared reflect mode rides on CycleInput
            // (absent ⇒ interactive) — no handler/runReflector signature change.
            const reflectInput = { ...input, mode: t.mode ?? 'interactive' } as const;
            // 2.10 reflector pipeline honesty: closure already moved the
            // manifest to done/ — a reflector throw from here on used to
            // bubble to the per-manifest catch as a bare 'error' result with
            // the cycle ALREADY closed and nothing in events.jsonl marking
            // the loss (the July silent-loss pattern). Record the loss in the
            // cycle's own event log and let the finalize complete: the merge
            // finalization DID succeed; only the reflection was lost. No
            // auto-retry — recovery stays with `forge reflect --rerun` / the
            // boot reconcile.
            try {
              await handler(reflectInput, logger);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              const crash = classifyCrash(errMsg, null);
              logger.emit({
                initiative_id: input.initiativeId,
                phase: 'reflection',
                skill: 'reflector',
                event_type: 'error',
                input_refs: [],
                output_refs: [],
                message: REFLECTION_LOST_EVENT,
                metadata: { cause: 'crash', detail: errMsg, crash_kind: crash.kind, crash_reason: crash.reason },
              });
              deps.notify?.(`${input.initiativeId} · reflection LOST after merge (${errMsg}) — recorded cycle.reflection-lost; recover via forge reflect --rerun`);
            }
          } else {
            logger.emit({
              initiative_id: input.initiativeId,
              phase: 'orchestrator',
              skill: 'finalize-merged',
              event_type: 'log',
              input_refs: [],
              output_refs: [],
              message: 'finalize.trigger-unhandled-target',
              // A flow target, or an agent target whose band is not a merge-time
              // handler, lands here (loud, never silent). The only shipped
              // merge-time handler is the `reflection-close`-band standalone
              // reflect agent (R4-09-F1).
              metadata: { on: t.on, target: t.target, note: 'no standalone merge-time handler for this target' },
            });
          }
        },
      },
    );

    // R4-11-F1: `merged` is a transient pass-through, never a parking state —
    // promote merged/ → done/ NOW, in this SAME sweep, regardless of whether
    // a reflect trigger was declared or whether reflection succeeded or was
    // lost (handled above via cycle.reflection-lost). Closure remains the
    // single terminal-move authority for both the →merged and merged→done
    // moves; this is the ONLY caller of the second move in production.
    promoteMergedToDoneFn(input, logger);

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
      // ADR 040 merge-vs-loop: a merged PR is terminal — finalize WINS over the
      // fix-loop drain (running fix WIs against a merged branch is pointless).
      // But if the operator merged with fix work-items still pending, surface it
      // so the drop is never SILENT (the merge overrides the unrun concerns).
      const pendingFix = pendingFixWorkItems(worktreePath);
      if (pendingFix.length > 0) {
        deps.notify?.(
          `${initiativeId} · merged with ${pendingFix.length} pending fix work-item(s) unrun (${pendingFix.map((p) => p.work_item_id).join(', ')}) — the operator's merge overrides them`,
        );
      }
      // Re-claim to in-flight/ so closure's terminal move (in-flight → merged,
      // R4-11-F1) has a source. If closure decides NOT merged after all it
      // moves the manifest back to ready-for-review/, so this round-trip is
      // safe.
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
