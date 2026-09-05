/**
 * The studio POST surface: the PLAN verdict, run-id recovery, and the route
 * dispatch that binds them — plus the private architect-session helpers the
 * plan verdict uses.
 *
 * The REVIEW verdict and the context types it owns live in
 * `./bridge-studio-runs-review.ts` (M4-flows exit row 4, the 800-line cap).
 * This file imports from there and never the reverse.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import lockfile from 'proper-lockfile';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseManifest, serializeManifest } from './manifest.ts';
import type { ArchitectStatus } from '@forge/sessions/kinds/architect.ts';
import { getPaths } from './queue.ts';
import { PROJECT_ID_RE } from '@forge/kernel';
import { runRequeue } from './forge-requeue.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { isDryBridge, refuseDryBridge, dryBridgeAgentTurnMarker } from '@forge/kernel';
import { sendJson, allowedOrigin, sanitizeError, SAFE_ID_RE, pathOnly } from '@forge/kernel';

import {
  applyReviewVerdict,
  INIT_ID_RE,
  type StudioPostContext,
  type ReleaseFinalizeHookInput,
} from './bridge-studio-runs-review.ts';

// Re-exported so the package door and every existing importer keep resolving
// these names from `bridge-studio-runs.ts`.
export { applyReviewVerdict, INIT_ID_RE };
export type { StudioPostContext, ReleaseFinalizeHookInput };


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
        body = await ctx.readBody();
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
      body = await ctx.readBody();
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
