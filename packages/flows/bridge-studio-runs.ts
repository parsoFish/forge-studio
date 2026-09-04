/**
 * Forge Studio POST route handlers — run start/resume and gate verdicts (M3-4).
 *
 * Extracted from bridge-studio.ts to keep both modules under 800 LOC.
 * Imports shared helpers (sendJson, allowedOrigin, CSRF_HEADER, sanitizeError,
 * SAFE_ID_RE, readJson, pathOnly) from bridge-studio.ts — no duplication, no
 * circular import (this module imports FROM bridge-studio, not vice versa).
 *
 * Routes:
 *   POST /api/runs                          → start a planned run
 *   POST /api/runs/:id/resume               → resume a failed run
 *   POST /api/runs/:id/gates/:gateId        → dispatch a gate verdict
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { parseManifest, persistManifestSendBack, persistManifestSpecs, serializeManifest } from './manifest.ts';
import {
  compileFixWorkItems,
  writeReviewCapExhaustedMarker,
  hasReviewCapExhaustedMarker,
  FixLoopCapError,
  FixConcernInvalidError,
} from './fix-work-items.ts';
import { loadConfig, resolveReviewLoopCaps } from '@forge/kernel';
import { notify } from './notify.ts';
/** Default per-WI iteration budget for compiled review-fix work items (was the
 *  unifier's default cap before R4-01-F4 retired that module). */
const REVIEW_FIX_DEFAULT_ITERATIONS = 15;
import { writeVerdictJson } from './flow-artifacts.ts';
import { createLogger, type EventLogger } from '@forge/kernel';
import type { ArchitectStatus } from '@forge/sessions/kinds/architect.ts';
import { getPaths } from './queue.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { PROJECT_ID_RE } from '../../orchestrator/studio/validate.ts';
import { runRequeue } from './forge-requeue.ts';
import { isContainedWorktreePath, isContainedProjectRepoPath, isSafeCycleId } from './manifest-path-guard.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { isDryBridge, refuseDryBridge, emitDryBridgeSkip, dryBridgeAgentTurnMarker, type DryBridgeStubAction } from '../../apps/forge/dry-bridge.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  SAFE_ID_RE,
  readJson,
  pathOnly,
  type StudioContext,
} from '../../apps/forge/bridge-studio.ts';

// ---------------------------------------------------------------------------
// Context surface needed by POST routes
// ---------------------------------------------------------------------------

export type StudioPostContext = StudioContext & {
  queueRoot: string;
  projectsRoot: string;
  mergePr: (worktreePath: string) => boolean;
  finalizeAfterMerge: (deps: { queueRoot: string; logsRoot: string }) => Promise<unknown>;
  /**
   * WS-A (release): post-approval, pre-merge release finalisation. Injectable
   * for tests; in production defaults (in ui-bridge.ts) to a wrapper around the
   * real `runReleaseFinalize` phase. Opt-in: a project without `releaseProcess`
   * resolves to `release_status: 'skipped'`. Log-and-continue: a failure here
   * does NOT block the merge (the in-cycle DRAFT changelog is the fallback).
   */
  runReleaseFinalize?: (input: ReleaseFinalizeHookInput) => Promise<{ release_status: string }>;
  broadcastArchitectChanged: () => void;
  spawnArchitectTurnFn?: (forgeRoot: string, project: string, sessionId: string) => void;
};

/** The manifest-derived input the approve handler hands the release-finalize hook. */
export type ReleaseFinalizeHookInput = {
  initiativeId: string;
  cycleId: string;
  projectName: string;
  worktreePath: string;
  projectRepoPath: string;
  logsRoot: string;
};

// ---------------------------------------------------------------------------
// Architect session helpers (private copies — avoids circular import from ui-bridge)
// ---------------------------------------------------------------------------

// SEC-04 (bd forge-ebj): both helpers take the TRUSTED `projectsRoot` plus the
// request-derived session directory segments (`project`, `'_architect'`,
// `sessionId`) as their OWN `segments[]` elements — never folded into the root —
// and route the WHOLE path, `status.json` leaf included, through the guarded
// primitives, so a symlinked/hardlinked `status.json` leaf inside an otherwise
// real, identity-verified session dir is refused (the "guard the dir,
// raw-append the leaf" hole SEC-04 closes). `_readStatus` returns `null` (its
// existing "unavailable" contract) on a containment rejection; `_writeStatus`
// returns the written path, or `null` when the guard refuses the write (the
// write never happens — fail closed).
function _readStatus(projectsRoot: string, dirSegments: readonly string[]): ArchitectStatus | null {
  const raw = guardedReadFile(projectsRoot, [...dirSegments, 'status.json']);
  if (raw === null) return null;
  try { return JSON.parse(raw) as ArchitectStatus; } catch { return null; }
}

function _writeStatus(projectsRoot: string, dirSegments: readonly string[], status: ArchitectStatus): string | null {
  return guardedWriteFile(projectsRoot, [...dirSegments, 'status.json'], JSON.stringify(status, null, 2));
}

/** Spawn one architect-runner turn as a detached child.
 *  `FORGE_ARCHITECT_NO_SPAWN=1` disables spawn for test harnesses. */
function _spawnArchitectTurn(forgeRoot: string, project: string, sessionId: string): void {
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  // M1: defence-in-depth — sessionId must be safe before it enters the log dir path.
  if (!SAFE_ID_RE.test(sessionId)) return;
  try {
    const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'apps/forge/cli.ts', 'architect', 'run', sessionId, '--project', project],
      { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] },
    );
    closeSync(stderrFd);
    proc.unref();
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Shared verdict implementations — called by both the legacy aliases in
// ui-bridge.ts (POST /api/verdict, POST /api/plan-verdict) and the new
// generalised gate handler (POST /api/runs/:id/gates/:gateId).
// ---------------------------------------------------------------------------

/**
 * Apply a review verdict (approve or send-back) for the given initiativeId.
 *
 * Returns true and writes the HTTP response; never throws (all errors caught).
 */
export async function applyReviewVerdict(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioPostContext,
  body: {
    initiativeId: string;
    kind: 'approve' | 'send-back';
    rationale: string;
    acceptanceCriteria?: Array<{ given: string; when: string; then: string }>;
    concernKind?: 'packaging' | 'code-fix';
    qualityGateCmd?: string[];
  },
): Promise<void> {
  const origin = allowedOrigin(req);
  const { initiativeId, kind, rationale } = body;
  const acs = body.acceptanceCriteria ?? [];

  // C1: validate initiativeId format BEFORE any path construction to block path traversal.
  // The INIT_ID_RE enforces the manifest id convention (INIT-YYYY-MM-DD-slug).
  if (!initiativeId || !INIT_ID_RE.test(initiativeId)) {
    sendJson(res, 400, { error: 'initiativeId must match INIT-YYYY-MM-DD-slug format' }, origin);
    return;
  }
  if (!kind || !rationale) {
    sendJson(res, 400, { error: 'initiativeId, kind, rationale required' }, origin);
    return;
  }
  if (kind !== 'approve' && kind !== 'send-back') {
    sendJson(res, 400, { error: `unknown kind: ${kind}` }, origin);
    return;
  }
  if (kind === 'send-back' && acs.length === 0) {
    sendJson(res, 400, { error: 'send-back requires at least one acceptanceCriteria' }, origin);
    return;
  }

  const inFlightPath = join(ctx.queueRoot, 'in-flight', `${initiativeId}.md`);
  const readyForReviewPath = join(ctx.queueRoot, 'ready-for-review', `${initiativeId}.md`);
  if (!existsSync(inFlightPath) && !existsSync(readyForReviewPath)) {
    sendJson(res, 409, {
      error: 'no manifest for initiative in in-flight/ or ready-for-review/ (already resolved?)',
      initiativeId,
    }, origin);
    return;
  }
  const manifestPath = existsSync(inFlightPath) ? inFlightPath : readyForReviewPath;

  if (kind === 'approve') {
    const approveManifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    const approveWorktreePath = approveManifest.worktree_path ?? '';
    if (!approveWorktreePath) {
      sendJson(res, 409, {
        error: 'worktree gone — merge the PR on GitHub; the sweep will detect it in ≤5 min',
        initiativeId,
      }, origin);
      return;
    }
    // H2 (SEC-02, forge-d1f): bounds-check manifest-supplied worktree_path to
    // prevent a tampered manifest from directing mergePr at an arbitrary path.
    // REAL per-segment containment (isContainedWorktreePath), not a lexical
    // resolve().startsWith() on an unresolved path — resolve() normalises ".."
    // before the comparison ever runs and never follows symlinks, so that
    // shape is worthless against a symlinked escape. Two legitimate roots:
    // in-place worktrees under <forgeRoot>/projects/, AND forge-managed
    // worktrees identity-bound to THIS initiative under <forgeRoot>/_worktrees/.
    // Deliberately moved AHEAD of the existsSync probe below (was previously
    // checked first) — an out-of-bounds path must never even be stat'd through
    // this route.
    if (!isContainedWorktreePath(approveWorktreePath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, initiativeId })) {
      sendJson(res, 409, { error: 'worktree_path outside allowed root', initiativeId }, origin);
      return;
    }
    if (!existsSync(approveWorktreePath)) {
      sendJson(res, 409, {
        error: 'worktree gone — merge the PR on GitHub; the sweep will detect it in ≤5 min',
        initiativeId,
      }, origin);
      return;
    }
    // SEC-02 round 2 (Finding 1, guard-symmetry hole): project_repo_path feeds
    // ctx.runReleaseFinalize -> loadProjectConfig(projectRepoPath) below — the
    // send-back branch already containment-checks this identical field for the
    // identical sink; the approve branch never did. Mirrored here, BEFORE any
    // use of the value, using the same "outside allowed root" 409 shape.
    if (
      approveManifest.project_repo_path &&
      !isContainedProjectRepoPath(approveManifest.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })
    ) {
      sendJson(res, 409, { error: 'project_repo_path outside allowed root', initiativeId }, origin);
      return;
    }
    // R5-01-F1: dry-bridge — the incident (2026-07-16, self-merge with the
    // operator's real gh token) was exactly these three real-acting steps.
    // In dry mode the verdict application itself (state transition, artifact
    // writes below) still proceeds, but release-finalize / the real merge /
    // finalize-after-merge are individually skipped with a typed marker + one
    // JSONL event each, so the ui:journey approve beat can keep progressing
    // run state without ever touching a real remote.
    const dryBridgeActive = isDryBridge();
    const skipped: DryBridgeStubAction[] = [];
    const approveCycleId = approveManifest.cycle_id ?? initiativeId;
    // SEC-02 round 2 (Finding 2, headline): cycle_id feeds
    // resolve(logsRoot, cycleId) at TWO write sites downstream — the
    // dry-bridge createLogger call immediately below (the EARLIEST
    // cycleId-derived path in this branch) and writeVerdictJson further down.
    // Validate the SAME derived value used at both, before either is reached.
    // The `?? initiativeId` fallback is already safe (INIT_ID_RE-gated,
    // checked above) — checking the post-fallback value covers both cases in
    // one place and means no unvalidated value can ever reach a path.
    if (!isSafeCycleId(approveCycleId)) {
      sendJson(res, 409, { error: 'cycle_id outside allowed root', initiativeId }, origin);
      return;
    }
    // Task A-finalfix FIX 5: mirror send-back's best-effort logging pattern
    // (see the try/catch around the reviewer.verdict.send-back emit below) —
    // createLogger touches the filesystem (creates/opens the cycle's
    // events.jsonl) and must never block verdict application if that I/O
    // fails. emitDryBridgeSkip itself already never throws (dry-bridge.ts),
    // so only the logger's own construction needs guarding here.
    let dryBridgeLogger: EventLogger | null = null;
    if (dryBridgeActive) {
      try {
        dryBridgeLogger = createLogger(approveCycleId, ctx.logsRoot);
      } catch { /* best-effort — never block the verdict on dry-bridge logger setup */ }
    }
    const skip = (action: DryBridgeStubAction): void => {
      skipped.push(action);
      if (dryBridgeLogger) emitDryBridgeSkip(dryBridgeLogger, initiativeId, action);
    };

    // WS-A (release): finalise the release on the PR branch BEFORE merging.
    // Opt-in on the project's `releaseProcess` (skips cleanly otherwise) and
    // log-and-continue on failure — the merge MUST still fire (the in-cycle
    // DRAFT changelog is the fallback), so this is awaited but never gates the
    // merge. Present ⇒ finalise-then-merge; absent ⇒ straight-to-merge.
    if (ctx.runReleaseFinalize) {
      if (dryBridgeActive) {
        skip('release-finalize');
      } else {
        try {
          await ctx.runReleaseFinalize({
            initiativeId,
            cycleId: approveCycleId,
            projectName: approveManifest.project,
            worktreePath: approveWorktreePath,
            projectRepoPath: approveManifest.project_repo_path,
            logsRoot: ctx.logsRoot,
          });
        } catch {
          // Defence in depth: the phase itself log-and-continues, but a hook-level
          // throw must never block the merge either.
        }
      }
    }
    let merged: boolean;
    if (dryBridgeActive) {
      skip('merge-pr');
      // Treat as succeeded so the verdict state transition below still
      // proceeds — dry mode must not silently do nothing (that's the whole
      // point), it must keep the run's state moving without the real gh call.
      merged = true;
    } else {
      merged = ctx.mergePr(approveWorktreePath);
    }
    if (!merged) {
      sendJson(res, 409, {
        error: 'gh pr merge failed — merge the PR manually on GitHub',
        initiativeId,
      }, origin);
      return;
    }
    // Task A-finalfix ride-along 3: record finalize-after-merge's skip BEFORE
    // writing verdict.json, so `skipped` below is the complete set for this
    // verdict rather than missing whichever step comes textually after the
    // write. Safe in the non-dry path ONLY because both this detached-dispatch
    // and the writeVerdictJson below are synchronous up to their first await:
    // finalizeMergedReadyForReview's sync prefix writes a merge-path verdict.json
    // (overwrite:false) then yields, so the operator's overwrite:true write on
    // the same tick still wins. Do NOT insert an `await` between here and the
    // write — it would let finalize's fallback verdict race the operator's.
    if (dryBridgeActive) {
      skip('finalize-after-merge');
    } else {
      // Ride-along 1: fire-and-forget must not become an unhandled rejection
      // — mirrors the release-finalize block's log-and-continue above.
      void ctx.finalizeAfterMerge({ queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot }).catch(() => {
        // Defence in depth: finalizeAfterMerge log-and-continues internally
        // on its own failures; this only guards against an unhandled
        // rejection escaping the detached call.
      });
    }
    // ADR-027: persist the operator's approve as the durable verdict artifact
    // before finalize/reflection runs (overwrite a prior merge-path fallback).
    // Ride-along 3: carry the dry-bridge marker into the durable artifact too
    // — a reflector reading verdict.json later must be able to tell a
    // dry-bridge-recorded approve apart from a real merge.
    writeVerdictJson(
      ctx.logsRoot,
      {
        kind: 'approve',
        initiative_id: initiativeId,
        cycleId: approveCycleId,
        decidedBy: 'operator',
        rationale,
        at: new Date().toISOString(),
        ...(dryBridgeActive ? { dryBridge: true, skipped } : {}),
      },
      { overwrite: true },
    );
    // FIX-3: the note must not claim a real merge/finalization under dry-bridge.
    const responseBody: Record<string, unknown> = {
      ok: true,
      kind,
      note: dryBridgeActive
        ? 'dry-bridge: verdict recorded; real-acting steps skipped (see dryBridge.skipped)'
        : 'PR merged and finalization triggered',
    };
    if (skipped.length > 0) responseBody.dryBridge = { skipped };
    sendJson(res, 200, responseBody, origin);
    return;
  }

  // send-back path
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const worktreePath = manifest.worktree_path ?? '';
  // SEC-02 round 5 — ORDERING IS THE FIX, not the check itself. This branch
  // used to read `if (!worktreePath || !existsSync(worktreePath))`, so an
  // OUT-OF-BOUNDS path was stat'd before containment ever ran and the reply
  // then differed by whether it existed ('no live worktree…' when absent vs
  // 'worktree_path outside allowed root' when present) — a one-bit existence
  // probe for ANY absolute path on the server, which is exactly the oracle
  // class `forge-b2k` exists to close. The approve branch above was already
  // ordered correctly; this is the symmetry fix. Empty-check only here; the
  // existence probe moves BELOW containment, mirroring approve exactly.
  if (!worktreePath) {
    sendJson(res, 409, { error: 'no live worktree for this cycle (already cleaned up?) — cannot append review work items', initiativeId }, origin);
    return;
  }
  // H2 (SEC-02, forge-d1f; guard symmetry with the approve branch): the
  // send-back path writes fix work items + the cap-exhausted marker under
  // manifest-supplied worktree_path — REAL per-segment containment
  // (isContainedWorktreePath), not a lexical resolve().startsWith() check on
  // an unresolved path, against the two legitimate roots (in-place worktrees
  // under <forgeRoot>/projects/, forge-managed worktrees identity-bound to
  // THIS initiative under <forgeRoot>/_worktrees/).
  if (!isContainedWorktreePath(worktreePath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, initiativeId })) {
    sendJson(res, 409, { error: 'worktree_path outside allowed root', initiativeId }, origin);
    return;
  }
  // SEC-02: project_repo_path previously had ZERO bounds check here even
  // though it feeds loadProjectConfig below — an out-of-bounds path would
  // read an arbitrary project.json off the filesystem through this route.
  if (
    manifest.project_repo_path &&
    !isContainedProjectRepoPath(manifest.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })
  ) {
    sendJson(res, 409, { error: 'project_repo_path outside allowed root', initiativeId }, origin);
    return;
  }
  // SEC-02 round 5: the existence probe, now strictly AFTER containment — a
  // legitimately-contained worktree that has been cleaned up still reports the
  // ordinary 'no live worktree' 409, so the fix does not collapse that signal
  // into the containment rejection (pinned by its own positive control).
  if (!existsSync(worktreePath)) {
    sendJson(res, 409, { error: 'no live worktree for this cycle (already cleaned up?) — cannot append review work items', initiativeId }, origin);
    return;
  }
  // SEC-02 round 2 (Finding 2, headline): cycle_id feeds
  // resolve(logsRoot, cycleId) at THREE write sites downstream (the two
  // createLogger calls + writeVerdictJson, all below) — validate the SAME
  // derived value used at all three, before any is reached, and reuse it at
  // each call site rather than re-deriving `manifest.cycle_id ?? initiativeId`
  // unchecked each time.
  const sendBackCycleId = manifest.cycle_id ?? initiativeId;
  if (!isSafeCycleId(sendBackCycleId)) {
    sendJson(res, 409, { error: 'cycle_id outside allowed root', initiativeId }, origin);
    return;
  }
  let projectGateCmd: string[] = manifest.quality_gate_cmd && manifest.quality_gate_cmd.length > 0 ? manifest.quality_gate_cmd : [];
  try {
    const cfg = loadProjectConfig(manifest.project_repo_path);
    if (cfg?.quality_gate_cmd && cfg.quality_gate_cmd.length > 0) projectGateCmd = cfg.quality_gate_cmd;
  } catch { /* fall back */ }
  if (projectGateCmd.length === 0) {
    projectGateCmd = existsSync(join(worktreePath, 'package.json')) ? ['npm', 'test'] : ['true'];
  }
  const concernKind = body.concernKind;
  const concernGateCmd = body.qualityGateCmd;

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(manifestPath, { retries: { retries: 5, minTimeout: 50 } });
  } catch (lockErr) {
    sendJson(res, 503, { error: 'manifest is locked by another writer', detail: String(lockErr) }, origin);
    return;
  }
  try {
    // R4-10-F1: honour the shared REVIEW-CAP-EXHAUSTED marker. The demo node is
    // now a SECOND writer of it (demo-fix-loop.ts) — and the drain skips ANY
    // marker-bearing manifest before it reads pending WIs. If this handler
    // enqueued a WI while the marker is present (its own per-WI cap still has
    // headroom), that WI would be silently stranded (drainable never). Reject
    // with the same reject-then-park path so marker ⟹ no new fix work, for both
    // origins — and the operator gets an honest 409, not a false 200.
    if (hasReviewCapExhaustedMarker(worktreePath)) {
      throw new FixLoopCapError(
        `initiative is parked needs-operator — a prior fix-loop cap was hit (.forge/REVIEW-CAP-EXHAUSTED.md present). ` +
          `Delete the marker after taking action (or raise review.maxSendBackRounds / review.maxTotalFixWorkItems) to re-enable send-backs.`,
      );
    }
    // ADR 040: the round this send-back opens + the config-owned caps. The
    // compiler enforces both caps BEFORE writing (reject-then-park — accepting
    // would enqueue work that never runs).
    const caps = resolveReviewLoopCaps();
    const currentRound = (manifest.review_rounds ?? 0) + 1;
    const { appended } = compileFixWorkItems({
      worktreePath,
      initiativeId,
      source: { origin: 'review-fix', rationale, acceptanceCriteria: acs, concernKind, qualityGateCmd: concernGateCmd },
      projectGateCmd,
      estimatedIterations: REVIEW_FIX_DEFAULT_ITERATIONS,
      caps,
      currentRound,
    });
    // Keep the manifest's specs back-reference truthful (roadmap WI lists, the
    // planned-gate consumers) — append, never overwrite PM's list. Best-effort
    // like persistManifestSpecs itself.
    persistManifestSpecs(manifestPath, [...(manifest.specs ?? []), ...appended]);
    // Stamp resume_from:'develop' + increment review_rounds in ONE locked write
    // — throws on failure (a send-back the manifest doesn't record would leave
    // the fix WIs undrainable).
    const { round } = persistManifestSendBack(manifestPath);
    // Plan 2.7 — the structured send-back event. Appends to the SAME cycle's
    // events.jsonl the fix-loop drain re-claims (one lineage), carrying the
    // operator's feedback verbatim so send-backs are auditable from the event
    // log alone. cycle-retention + cycle-recap count `reviewer.verdict.send-back`.
    // Best-effort: the fix WIs are already compiled, so a logging failure must
    // not fail the verdict. The per-WI `pm.work-item-emitted` emits give the
    // run page its hex + drawer spec for each fix WI before dispatch
    // (run-model-derive matches that exact message).
    try {
      const logger = createLogger(sendBackCycleId, ctx.logsRoot);
      logger.emit({
        initiative_id: initiativeId,
        phase: 'review-loop',
        skill: 'review-verdict',
        event_type: 'log',
        input_refs: [manifestPath],
        output_refs: appended.map((id) => `.forge/work-items/${id}.md`),
        message: 'reviewer.verdict.send-back',
        metadata: {
          decided_by: 'operator',
          rationale,
          acceptance_criteria: acs,
          concern_kind: concernKind ?? 'code-fix',
          quality_gate_cmd: concernGateCmd ?? null,
          appended_work_items: appended,
          origin: 'review-fix',
          round,
        },
      });
      for (const id of appended) {
        logger.emit({
          initiative_id: initiativeId,
          phase: 'review-loop',
          skill: 'review-verdict',
          event_type: 'log',
          input_refs: [],
          output_refs: [`.forge/work-items/${id}.md`],
          message: 'pm.work-item-emitted',
          metadata: {
            work_item_id: id,
            task: rationale.split('\n')[0]?.slice(0, 120) ?? id,
            depends_on: [],
            origin: 'review-fix',
          },
        });
      }
    } catch { /* best-effort — never block the send-back on logging */ }
    // ADR-027: persist the operator's send-back (rationale + the fix-WI
    // acceptance criteria + the round it opened) as the durable verdict artifact.
    writeVerdictJson(
      ctx.logsRoot,
      {
        kind: 'send-back',
        initiative_id: initiativeId,
        cycleId: sendBackCycleId,
        decidedBy: 'operator',
        rationale,
        acceptanceCriteria: acs,
        round,
        at: new Date().toISOString(),
      },
      { overwrite: true },
    );
    sendJson(res, 200, {
      ok: true,
      kind,
      appendedWorkItems: appended,
      round,
      note: 'fix work items appended to the initiative queue; the fix loop re-dispatches the develop agent in the same cycle',
    }, origin);
  } catch (appendErr) {
    if (appendErr instanceof FixLoopCapError) {
      // ADR 040: reject-then-park, LOUDLY — the 409 (UI error surface), the
      // greppable worktree marker (the drain reports needs-operator while it
      // exists), a `sendback.cap-exhausted` event, and an operator
      // notification. All best-effort except the 409 itself.
      const capMsg = (appendErr as Error).message;
      try { writeReviewCapExhaustedMarker(worktreePath, capMsg); } catch { /* best-effort */ }
      try {
        const logger = createLogger(sendBackCycleId, ctx.logsRoot);
        logger.emit({
          initiative_id: initiativeId,
          phase: 'review-loop',
          skill: 'review-verdict',
          event_type: 'error',
          input_refs: [manifestPath],
          output_refs: [],
          message: 'sendback.cap-exhausted',
          metadata: { detail: capMsg },
        });
      } catch { /* best-effort */ }
      try {
        const uc = loadConfig();
        void notify(
          {
            type: 'failed',
            title: `${initiativeId} — send-back cap exhausted`,
            body: capMsg,
          },
          { desktop: uc.notify?.desktop ?? true, webhook_url: uc.notify?.webhook_url ?? null },
        ).catch(() => { /* best-effort */ });
      } catch { /* best-effort */ }
      sendJson(res, 409, { error: capMsg, parked: 'needs-operator' }, origin);
    } else if (appendErr instanceof FixConcernInvalidError) {
      sendJson(res, 400, { error: (appendErr as Error).message }, origin);
    } else {
      sendJson(res, 500, { error: `append fix work items failed: ${String(appendErr)}` }, origin);
    }
  } finally {
    if (release) { try { await release(); } catch { /* ignore */ } }
  }
}

/**
 * Apply a plan verdict (approve / revise / reject) for an architect session.
 *
 * Writes the HTTP response and never throws.
 */
export async function applyPlanVerdict(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioPostContext,
  body: {
    project: string;
    sessionId: string;
    kind: 'approve' | 'revise' | 'reject';
    rationale?: string;
    /**
     * Task A-finalfix ride-along 2: the two real HTTP routes that reach this
     * shared handler — POST /api/plan-verdict and POST
     * /api/runs/:id/gates/plan — must each report THEIR OWN route on the
     * dry-bridge marker/event, not a hardcoded '/api/plan-verdict' regardless
     * of which one the operator actually called.
     */
    entryRoute: string;
  },
): Promise<void> {
  const origin = allowedOrigin(req);
  const { project, sessionId, kind, rationale, entryRoute } = body;

  if (!project || !sessionId || !kind) {
    sendJson(res, 400, { error: 'project, sessionId, kind are required' }, origin);
    return;
  }
  // C2: validate project + sessionId BEFORE any path construction to block path
  // traversal into _architectSessionDir(<projectsRoot>/<project>/_architect/<sessionId>).
  // project uses PROJECT_ID_RE (W7-A4: the case-preserving directory name,
  // e.g. "betterado" or "trafficGame"). sessionId uses SAFE_ID_RE — real ids
  // are YYYY-MM-DDTHH-mm-ss (uppercase T, digit-leading).
  if (!PROJECT_ID_RE.test(project)) {
    sendJson(res, 400, { error: `project must match ${PROJECT_ID_RE} (the project directory name)` }, origin);
    return;
  }
  if (!SAFE_ID_RE.test(sessionId)) {
    sendJson(res, 400, { error: 'sessionId contains invalid characters' }, origin);
    return;
  }
  if (!['approve', 'revise', 'reject'].includes(kind)) {
    sendJson(res, 400, { error: `unknown kind: ${kind}` }, origin);
    return;
  }

  // SEC-04 (AT-47): the PROJECT_ID_RE/SAFE_ID_RE charset gates above are defense in
  // depth, but charset does NOT catch a symlinked `_architect` DIR — a
  // valid-charset project+sessionId can still resolve, through the symlink, to
  // an out-of-root session whose status.json would be read AND mutated (a
  // reject rewrites phase:'rejected'). Gate every subsequent read/write on a
  // per-segment IDENTITY guard of project + `_architect` + sessionId (each its
  // own segment against the fixed projectsRoot base); any escape — a symlinked
  // `_architect`, a cross-object alias — collapses to a 404, indistinguishable
  // from a genuinely missing session (no oracle). Only once the guard has
  // proven the bare-joined `dir` is contained is it safe to read/write.
  const dirSegments: readonly string[] = [project, '_architect', sessionId];
  const guarded = resolveGuardedPath(ctx.projectsRoot, dirSegments);
  if (!guarded.ok) {
    sendJson(res, 404, { error: 'session not found', sessionId }, origin);
    return;
  }
  // Use the guard's realpath-verified directory for the lockfile mutex below —
  // never a bare `_architectSessionDir()` re-derive that discards the
  // containment result. Every leaf read/write under it rides the guard, leaf
  // included, via `_readStatus`/`_writeStatus`/`guardedWriteFile` (SEC-04), not
  // a raw `join(dir, leaf)`.
  const dir = guarded.realPath;
  if (!_readStatus(ctx.projectsRoot, dirSegments)) {
    sendJson(res, 404, { error: 'session not found', sessionId }, origin);
    return;
  }

  // Double-finalize guard: serialize verdicts on the session's status.json
  // (the same proper-lockfile pattern applyReviewVerdict uses on the manifest)
  // and re-check the phase UNDER the lock — a verdict is only actionable while
  // the session still awaits one. The loser of a double-approve gets a 409
  // instead of re-arming finalize (a second critic run / double promotion).
  const statusPath = join(dir, 'status.json');
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(statusPath, { retries: { retries: 5, minTimeout: 50 } });
  } catch (lockErr) {
    sendJson(res, 503, { error: 'session status is locked by another writer', detail: String(lockErr) }, origin);
    return;
  }
  try {
    const status = _readStatus(ctx.projectsRoot, dirSegments);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', sessionId }, origin);
      return;
    }
    if (status.phase !== 'awaiting-verdict') {
      sendJson(
        res,
        409,
        { error: `session is not awaiting a verdict (phase: ${status.phase})`, sessionId },
        origin,
      );
      return;
    }

    const spawnTurn = ctx.spawnArchitectTurnFn ?? _spawnArchitectTurn;

    // A guarded write refusal (a symlinked/hardlinked leaf inside the otherwise
    // real, identity-verified session dir) collapses to the same 404 as a
    // genuinely missing session — no oracle, and NOTHING is written / no turn
    // spawned.
    const refuse = (): void => sendJson(res, 404, { error: 'session not found', sessionId }, origin);
    if (kind === 'approve') {
      if (rationale) {
        if (guardedWriteFile(ctx.projectsRoot, [...dirSegments, 'feedback.md'], rationale.trim() + '\n') === null) {
          refuse();
          return;
        }
      }
      if (_writeStatus(ctx.projectsRoot, dirSegments, { ...status, phase: 'finalizing' }) === null) {
        refuse();
        return;
      }
      spawnTurn(ctx.forgeRoot, project, sessionId);
    } else if (kind === 'revise') {
      if (guardedWriteFile(ctx.projectsRoot, [...dirSegments, 'feedback.md'], (rationale ?? '').trim() + '\n') === null) {
        refuse();
        return;
      }
      if (_writeStatus(ctx.projectsRoot, dirSegments, { ...status, phase: 'interviewing', round: status.round + 1 }) === null) {
        refuse();
        return;
      }
      spawnTurn(ctx.forgeRoot, project, sessionId);
    } else {
      if (_writeStatus(ctx.projectsRoot, dirSegments, { ...status, phase: 'rejected' }) === null) {
        refuse();
        return;
      }
    }
    ctx.broadcastArchitectChanged();
    // R5-01-F1 stub-actions: approve/revise spawn a turn (reject never does),
    // so only those kinds carry the dry-bridge agent-turn marker. Serves both
    // POST /api/plan-verdict and POST /api/runs/:id/gates/plan (same handler)
    // — entryRoute (ride-along 2) reports whichever one the caller actually hit.
    const dryMarker = kind === 'reject' ? {} : dryBridgeAgentTurnMarker(ctx.logsRoot, entryRoute, sessionId);
    sendJson(res, 200, { ok: true, kind, ...dryMarker }, origin);
  } finally {
    if (release) { try { await release(); } catch { /* ignore */ } }
  }
}

// ---------------------------------------------------------------------------
// POST routes — generalised run + gate write endpoints (M3-4)
// ---------------------------------------------------------------------------

/**
 * Validates the INIT-YYYY-MM-DD-slug format used as initiativeId in manifest
 * file paths.  Exported so callers (applyReviewVerdict, POST /api/runs) share
 * one source of truth for path-traversal prevention (C1).
 */
export const INIT_ID_RE = /^INIT-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * W7-B7 (artifact-plan-18): recover the initiative id from a run handle.
 * Run ids posted to the gate route are routinely CYCLE ids
 * (`<timestamp>_INIT-…` — the monitor pill and GateBar both post the `?run=`
 * handle); `applyReviewVerdict` validates INIT_ID_RE, so the embedded id is
 * recovered by stripping the `<timestamp>_` prefix when the tail matches the
 * manifest id convention. Anything unrecoverable is returned verbatim — the
 * downstream 400 is unchanged. Pure; mirrors the client's
 * `effectiveInitiativeId` (apps/studio/lib/initiative-id.ts) as defence in depth.
 */
export function recoverInitiativeId(runId: string): string {
  if (INIT_ID_RE.test(runId)) return runId;
  const idx = runId.indexOf('_');
  if (idx < 0) return runId;
  const tail = runId.slice(idx + 1);
  return INIT_ID_RE.test(tail) ? tail : runId;
}

/**
 * Handle Forge Studio POST write routes (run start, run resume, gate verdicts).
 *
 * Routes:
 *   POST /api/runs                          → start a planned run
 *   POST /api/runs/:id/resume               → resume a failed run
 *   POST /api/runs/:id/gates/:gateId        → dispatch a gate verdict
 *
 * Returns true iff handled; false for unrecognised URLs.
 * Never throws — all errors caught and returned as JSON.
 */
export async function handleStudioPostRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioPostContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/runs — start a planned run --------------------------------
  if (url === '/api/runs') {
    try {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;
      const initiativeId = typeof b['initiativeId'] === 'string' ? b['initiativeId'] : '';
      const originTag = typeof b['origin'] === 'string' ? b['origin'] : 'human-directed';

      if (!initiativeId || !INIT_ID_RE.test(initiativeId)) {
        sendJson(res, 400, { error: 'initiativeId is required and must match INIT-YYYY-MM-DD-slug format' }, origin);
        return true;
      }

      const queuePaths = getPaths(ctx.queueRoot);
      const filename = `${initiativeId}.md`;

      // Check if already in-flight or done → 409
      if (existsSync(join(queuePaths.inFlight, filename))) {
        sendJson(res, 409, { error: 'initiative is already in-flight', initiativeId }, origin);
        return true;
      }
      if (existsSync(join(queuePaths.done, filename))) {
        sendJson(res, 409, { error: 'initiative is already done', initiativeId }, origin);
        return true;
      }

      // Already pending → 200 immediately
      if (existsSync(join(queuePaths.pending, filename))) {
        sendJson(res, 200, { ok: true, runId: initiativeId, note: 'already pending' }, origin);
        return true;
      }

      // In failed or ready-for-review → move to pending with origin tag
      const srcCandidates = [queuePaths.readyForReview, queuePaths.failed];
      let srcPath: string | null = null;
      for (const dir of srcCandidates) {
        const candidate = join(dir, filename);
        if (existsSync(candidate)) { srcPath = candidate; break; }
      }

      if (!srcPath) {
        sendJson(res, 404, { error: 'initiative not found in any queue dir', initiativeId }, origin);
        return true;
      }

      // Parse, annotate with origin, move to pending
      const raw = readFileSync(srcPath, 'utf8');
      const manifest = parseManifest(raw);
      const safeOrigin: 'architect' | 'human-directed' =
        originTag === 'architect' ? 'architect' : 'human-directed';
      const updated = { ...manifest, origin: safeOrigin };
      const toPath = join(queuePaths.pending, filename);
      const tmpPath = toPath + '.tmp';
      writeFileSync(tmpPath, serializeManifest(updated));
      renameSync(tmpPath, toPath);
      // Remove from source (best-effort)
      try { rmSync(srcPath, { force: true }); } catch { /* best-effort */ }

      sendJson(res, 200, { ok: true, runId: initiativeId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/runs/:id/resume — resume a run ----------------------------
  const resumeMatch = url.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (resumeMatch) {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/runs/:id/resume', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
    const runId = decodeURIComponent(resumeMatch[1]);
    if (!runId || !SAFE_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid run id' }, origin);
      return true;
    }
    try {
      runRequeue(runId, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, resumeFromDemo: true });
      sendJson(res, 200, { ok: true, runId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/runs/:id/gates/:gateId — gate verdict --------------------
  const gateMatch = url.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/gates\/([A-Za-z0-9_-]+)$/);
  if (gateMatch) {
    const runId = decodeURIComponent(gateMatch[1]);
    const gateId = decodeURIComponent(gateMatch[2]);

    if (!runId || !SAFE_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid run id' }, origin);
      return true;
    }
    if (!gateId || !SAFE_ID_RE.test(gateId)) {
      sendJson(res, 400, { error: 'invalid gate id' }, origin);
      return true;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' }, origin);
      return true;
    }
    const b = body as Record<string, unknown>;
    const verdict = typeof b['verdict'] === 'string' ? b['verdict'] : '';

    if (gateId === 'verdict') {
      // Map to applyReviewVerdict. W7-B7 (artifact-plan-18): runId is the
      // UI's run handle — routinely a CYCLE id — so recover the embedded
      // initiative id before the INIT_ID_RE check 400s it.
      const kind = verdict === 'approve' || verdict === 'send-back' ? verdict : (b['kind'] as string | undefined);
      await applyReviewVerdict(req, res, ctx, {
        initiativeId: recoverInitiativeId(runId),
        kind: (kind as 'approve' | 'send-back') ?? 'send-back',
        rationale: typeof b['rationale'] === 'string' ? b['rationale'] : '',
        acceptanceCriteria: Array.isArray(b['acceptanceCriteria'])
          ? (b['acceptanceCriteria'] as Array<{ given: string; when: string; then: string }>)
          : undefined,
        concernKind: b['concernKind'] as 'packaging' | 'code-fix' | undefined,
        qualityGateCmd: Array.isArray(b['qualityGateCmd']) ? (b['qualityGateCmd'] as string[]) : undefined,
      });
      return true;
    }

    if (gateId === 'plan') {
      // Map to applyPlanVerdict: runId is the sessionId; body must carry project + kind
      await applyPlanVerdict(req, res, ctx, {
        project: typeof b['project'] === 'string' ? b['project'] : '',
        sessionId: runId,
        kind: (verdict === 'approve' || verdict === 'revise' || verdict === 'reject'
          ? verdict
          : (b['kind'] as string | undefined) ?? '') as 'approve' | 'revise' | 'reject',
        rationale: typeof b['rationale'] === 'string' ? b['rationale'] : undefined,
        entryRoute: '/api/runs/:id/gates/plan',
      });
      return true;
    }

    // Unknown gateId
    sendJson(res, 404, { error: `unknown gate: ${gateId}` }, origin);
    return true;
  }

  return false;
}
