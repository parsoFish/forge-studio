/**
 * The REVIEW verdict — the largest single handler in the studio POST surface,
 * and the reason `bridge-studio-runs.ts` was 947 lines.
 *
 * Carved out under the 800-line cap (M4-flows exit row 4). The membership was
 * MEASURED, not chosen: the context types and `REVIEW_FIX_DEFAULT_ITERATIONS`
 * come here because `applyReviewVerdict` is what uses them, and the three
 * private architect-session helpers deliberately do NOT — `applyPlanVerdict`
 * uses those, so they stay with it. `INIT_ID_RE` comes because this handler is
 * where it is enforced; the parent re-exports it for the package door.
 *
 * The parent imports from here and never the reverse.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import lockfile from 'proper-lockfile';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest, persistManifestSendBack, persistManifestSpecs } from './manifest.ts';
import { compileFixWorkItems, writeReviewCapExhaustedMarker, hasReviewCapExhaustedMarker, FixLoopCapError, FixConcernInvalidError } from './fix-work-items.ts';
import { loadConfig, resolveReviewLoopCaps, sendJson, allowedOrigin, type StudioContext } from '@forge/kernel';
import { notify } from './notify.ts';
import { writeVerdictJson } from './flow-artifacts.ts';
import { createLogger, type EventLogger } from '@forge/kernel';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { isContainedWorktreePath, isContainedProjectRepoPath, isSafeCycleId } from './manifest-path-guard.ts';
import { isDryBridge, emitDryBridgeSkip, type DryBridgeStubAction } from '@forge/kernel';

/** Default per-WI iteration budget for compiled review-fix work items (was the
 *  unifier's default cap before R4-01-F4 retired that module). */
const REVIEW_FIX_DEFAULT_ITERATIONS = 15;
// ---------------------------------------------------------------------------
// Context surface needed by POST routes
// ---------------------------------------------------------------------------

export type StudioPostContext = StudioContext & {
  /** The RESULT of the host's body policy, never the policy itself — the closure
   *  `kernel/route-entry.ts` declares as `RouteContext.readBody`, whose header
   *  carries T1 ruling 30's reasoning. */
  readBody: () => Promise<unknown>;
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
/**
 * Validates the INIT-YYYY-MM-DD-slug format used as initiativeId in manifest
 * file paths.  Exported so callers (applyReviewVerdict, POST /api/runs) share
 * one source of truth for path-traversal prevention (C1).
 */
export const INIT_ID_RE = /^INIT-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
