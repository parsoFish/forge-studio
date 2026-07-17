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
import { join, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';

import { parseManifest, persistManifestResumeFromUnifier, serializeManifest } from '../orchestrator/manifest.ts';
import {
  appendReviewUnifierItems,
  UnifierItemsCapError,
  ReviewConcernInvalidError,
} from '../orchestrator/unifier-items.ts';
import { UNIFIER_DEFAULT_ITERATION_CAP } from '../orchestrator/unifier-invocation.ts';
import { writeVerdictJson } from '../orchestrator/flow-artifacts.ts';
import { createLogger, type EventLogger } from '../orchestrator/logging.ts';
import type { ArchitectStatus } from '../orchestrator/architect-runner.ts';
import { getPaths } from '../orchestrator/queue.ts';
import { loadProjectConfig } from '../orchestrator/project-config.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { runRequeue } from './forge-requeue.ts';
import { isDryBridge, refuseDryBridge, emitDryBridgeSkip, dryBridgeAgentTurnMarker, type DryBridgeStubAction } from './dry-bridge.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  SAFE_ID_RE,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';

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

function _architectSessionDir(projectsRoot: string, project: string, sessionId: string): string {
  return join(projectsRoot, project, '_architect', sessionId);
}

function _readStatus(dir: string): ArchitectStatus | null {
  const path = join(dir, 'status.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as ArchitectStatus; } catch { return null; }
}

function _writeStatus(dir: string, status: ArchitectStatus): void {
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2));
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
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'architect', 'run', sessionId, '--project', project],
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
    if (!approveWorktreePath || !existsSync(approveWorktreePath)) {
      sendJson(res, 409, {
        error: 'worktree gone — merge the PR on GitHub; the sweep will detect it in ≤5 min',
        initiativeId,
      }, origin);
      return;
    }
    // H2: bounds-check manifest-supplied worktree_path to prevent a tampered
    // manifest from directing mergePr at an arbitrary path. Two legitimate roots:
    // in-place worktrees under projectsRoot, AND forge-managed worktrees under
    // <forgeRoot>/_worktrees/ (forgeRoot is projectsRoot's parent). The original
    // check only allowed projectsRoot, so it 409'd every forge-managed worktree
    // (the default) — blocking the harness auto-approve (2026-06-16).
    const resolvedWt = resolve(approveWorktreePath);
    const projectsRoot = resolve(ctx.projectsRoot);
    const worktreesRoot = resolve(projectsRoot, '..', '_worktrees');
    if (!resolvedWt.startsWith(projectsRoot + sep) && !resolvedWt.startsWith(worktreesRoot + sep)) {
      sendJson(res, 409, { error: 'worktree_path outside allowed root', initiativeId }, origin);
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
  if (!worktreePath || !existsSync(worktreePath)) {
    sendJson(res, 409, { error: 'no live worktree for this cycle (already cleaned up?) — cannot append review work items', initiativeId }, origin);
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
    const { appended } = appendReviewUnifierItems({
      worktreePath,
      initiativeId,
      concern: { rationale, acceptanceCriteria: acs, kind: concernKind, qualityGateCmd: concernGateCmd },
      projectGateCmd,
      estimatedIterations: UNIFIER_DEFAULT_ITERATION_CAP,
    });
    persistManifestResumeFromUnifier(manifestPath);
    // Plan 2.7 — the structured send-back event. Appends to the SAME cycle's
    // events.jsonl the drain re-claims (one lineage), carrying the operator's
    // feedback verbatim so send-backs are auditable from the event log alone.
    // cycle-retention + cycle-recap count `reviewer.verdict.send-back`; this is
    // its (previously missing) emit site. Best-effort: the UWIs are already
    // appended, so a logging failure must not fail the verdict.
    try {
      const logger = createLogger(manifest.cycle_id ?? initiativeId, ctx.logsRoot);
      logger.emit({
        initiative_id: initiativeId,
        phase: 'review-loop',
        skill: 'review-verdict',
        event_type: 'log',
        input_refs: [manifestPath],
        output_refs: appended.map((id) => `.forge/unifier-items/${id}.md`),
        message: 'reviewer.verdict.send-back',
        metadata: {
          decided_by: 'operator',
          rationale,
          acceptance_criteria: acs,
          concern_kind: concernKind ?? 'code-fix',
          quality_gate_cmd: concernGateCmd ?? null,
          appended_uwis: appended,
        },
      });
    } catch { /* best-effort — never block the send-back on logging */ }
    // ADR-027: persist the operator's send-back (rationale + the UWI acceptance
    // criteria) as the durable verdict artifact for the reflector.
    writeVerdictJson(
      ctx.logsRoot,
      {
        kind: 'send-back',
        initiative_id: initiativeId,
        cycleId: manifest.cycle_id ?? initiativeId,
        decidedBy: 'operator',
        rationale,
        acceptanceCriteria: acs,
        at: new Date().toISOString(),
      },
      { overwrite: true },
    );
    sendJson(res, 200, {
      ok: true,
      kind,
      appendedUnifierItems: appended,
      note: 'work items appended to the unifier queue; the drain re-runs them in the same cycle',
    }, origin);
  } catch (appendErr) {
    if (appendErr instanceof UnifierItemsCapError) {
      sendJson(res, 409, { error: (appendErr as Error).message }, origin);
    } else if (appendErr instanceof ReviewConcernInvalidError) {
      sendJson(res, 400, { error: (appendErr as Error).message }, origin);
    } else {
      sendJson(res, 500, { error: `append review work items failed: ${String(appendErr)}` }, origin);
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
  // project uses SLUG_RE (lowercase slug convention, e.g. "betterado").
  // sessionId uses SAFE_ID_RE — real ids are YYYY-MM-DDTHH-mm-ss (uppercase T,
  // digit-leading) which SLUG_RE rejects; SAFE_ID_RE covers both formats.
  if (!SLUG_RE.test(project)) {
    sendJson(res, 400, { error: 'project must match slug format (e.g. my-project)' }, origin);
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

  const dir = _architectSessionDir(ctx.projectsRoot, project, sessionId);
  if (!_readStatus(dir)) {
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
    const status = _readStatus(dir);
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

    if (kind === 'approve') {
      if (rationale) {
        writeFileSync(join(dir, 'feedback.md'), rationale.trim() + '\n');
      }
      _writeStatus(dir, { ...status, phase: 'finalizing' });
      spawnTurn(ctx.forgeRoot, project, sessionId);
    } else if (kind === 'revise') {
      writeFileSync(join(dir, 'feedback.md'), (rationale ?? '').trim() + '\n');
      _writeStatus(dir, { ...status, phase: 'interviewing', round: status.round + 1 });
      spawnTurn(ctx.forgeRoot, project, sessionId);
    } else {
      _writeStatus(dir, { ...status, phase: 'rejected' });
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
      runRequeue(runId, { forgeRoot: ctx.forgeRoot, resumeFromUnifier: true });
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
      // Map to applyReviewVerdict: runId is the initiativeId
      const kind = verdict === 'approve' || verdict === 'send-back' ? verdict : (b['kind'] as string | undefined);
      await applyReviewVerdict(req, res, ctx, {
        initiativeId: runId,
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
