/**
 * bridge-studio-project-preflight-write.ts — the WRITE-side preflight routes (Stage D),
 * carved out of `apps/forge/bridge-studio-writes.ts` (M4 §4 step 2, projects lane,
 * worker B):
 *
 *   POST /api/studio/projects/:id/save-repo
 *   POST /api/studio/projects/:id/preflight/fix-auto
 *   POST /api/studio/projects/:id/preflight/fix-agent   — PROJECTS HALF ONLY
 *
 * `fix-agent` SPLITS BY OWNERSHIP, NOT INTO TWO ROWS (M4-projects routes
 * budget row 12 / row 12b). The clause validate/classify half — resolve the
 * project, parse the body, run preflight, classify the clause via
 * `classifyClause` — is projects'. The USER-tier tail — `spawnPreflightFix`,
 * which launches a detached `forge preflight fix` agent turn — is
 * SESSIONS-owned (it mints an agent run the same way `POST
 * /api/studio/onboarding/start` does). Both halves stay ONE handler and ONE
 * `dryClassification: 'stub-actions'` route-table row (T1 rulings 27/29: no
 * `matches` predicate may read the clause tier — that is server/body state,
 * not something a `(url) => boolean` can see); the split here is an
 * INJECTED DEPENDENCY, not a second row. `classifyPreflightFixAgentClause`
 * below is exported standalone so the eventual owner of the route-table
 * ENTRY (open question — sessions or projects; M4-projects routes budget
 * open question 2) can import the pure half without reaching into this
 * file's handler at all.
 *
 * `spawnPreflightFix`'s concrete implementation is NOT moved here: it is
 * sessions-owned (budget row 12b) and sessions has not carved yet. It stays,
 * exported, in `apps/forge/bridge-studio-writes.ts` (the same file it always lived
 * in) until the sessions lane relocates it; `handleProjectPreflightFixAgent`
 * below calls it through `deps.spawnPreflightFix` — the SAME injection shape
 * `bridge-studio-project-onboard.ts` uses for `seedProjectBrain` — so this module never
 * imports a sessions-owned symbol directly.
 *
 * `resolveManagedProject`/`toClauseDto` moved here because both write routes
 * (`save-repo`, `fix-auto`) and the fix-agent validate half all call them;
 * they are file-local, not exported to any other module (verbatim from the
 * original, which never exported them either).
 *
 * Bodies come from `ctx.readBody()` (T1 ruling 30) — the ORIGINAL fix-agent
 * arm called `readJson(req)` directly (`apps/forge/bridge-studio.ts`'s helper);
 * that import is exactly the `package-to-legacy` row this carve deletes, so
 * this is the one mandatory, mechanical adaptation in this file. It is
 * called at most once per request, same as before.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  discoverProjects,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  PROJECT_ID_RE,
  type StudioContext,
  type RouteContext,
} from '@forge/kernel';
// Legacy `cli/dry-bridge.ts` reach: the same accepted shape as every other
// carved package (`packages/knowledge/bridge-studio-kb-routes-maintenance.ts`,
// `packages/flows/bridge-recovery.ts`, `packages/library/bridge-studio-
// community.ts`, …) — all already baselined `package-to-legacy` rows in
// `scripts/baselines/boundaries.json`. `dry-bridge.ts` has not moved to
// kernel; this is a new row of the SAME already-accepted shape, reported for
// T2's bookkeeping, not a fresh design decision.
import { isDryBridge, refuseDryBridge, dryBridgeAgentTurnMarker } from '@forge/kernel';

import { classifyClause, type ClauseClassification } from './preflight-resolve.ts';
import { applyPreflightAutoFixes } from './preflight-fix-auto.ts';
import { ensureStudioBranch, commitStudioChange, saveProjectRepo } from './project-repo-tx.ts';
import { runPreflight, type ClauseResult } from './preflight.ts';

/** Resolve a managed-project id to its absolute root, or send an error + return null. */
function resolveManagedProject(
  ctx: StudioContext,
  id: string,
  res: ServerResponse,
  origin: string | undefined,
): string | null {
  if (!PROJECT_ID_RE.test(id)) {
    sendJson(res, 400, { error: 'invalid project id' }, origin);
    return null;
  }
  const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
  const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
  if (!projectRef) {
    sendJson(res, 404, { error: 'unknown project' }, origin);
    return null;
  }
  const projectRoot = projectRef.absPath;
  if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
    sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
    return null;
  }
  return projectRoot;
}

function toClauseDto(c: ClauseResult): {
  id: string; title: string; hard: boolean; pass: boolean; detail: string;
  resolution: string; route?: string; fixHint?: string;
} {
  const cls = classifyClause(c);
  return { id: c.clause, title: c.title, hard: c.hard, pass: c.pass, detail: c.detail, resolution: cls.resolution, route: cls.route, fixHint: cls.fixHint };
}

// ---------------------------------------------------------------------------
// The pure validate/classify half of fix-agent — importable standalone.
// ---------------------------------------------------------------------------

/** Discriminated result of classifying one clause for `fix-agent`. Mirrors
 *  the four response shapes the original inline handler sent, named instead
 *  of re-derived at each call site. */
export type FixAgentClauseClassification =
  | { kind: 'not-found' }
  | { kind: 'auto' }
  | { kind: 'agent'; route: ClauseClassification['route']; fixHint: ClauseClassification['fixHint'] }
  | { kind: 'user'; detail: string };

/**
 * The PROJECTS half of `POST /api/studio/projects/:id/preflight/fix-agent`:
 * run preflight, find the clause, classify its resolution tier. Exported
 * standalone (not only as part of `handleProjectPreflightFixAgent` below) so
 * whichever package's route table ultimately registers this route's ENTRY —
 * an open question the M4-projects routes budget leaves to the sessions lane
 * — can reuse this half without importing this file's handler or its
 * `PreflightWriteDeps` factory at all.
 */
export function classifyPreflightFixAgentClause(
  projectRoot: string,
  forgeRoot: string,
  clauseId: string,
): FixAgentClauseClassification {
  const report = runPreflight(projectRoot, { forgeRoot });
  const clause = report.clauses.find((c) => c.clause === clauseId);
  if (!clause) return { kind: 'not-found' };
  const cls = classifyClause(clause);
  if (cls.resolution === 'auto') return { kind: 'auto' };
  if (cls.resolution === 'agent') return { kind: 'agent', route: cls.route, fixHint: cls.fixHint };
  return { kind: 'user', detail: clause.detail };
}

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

export type PreflightWriteDeps = {
  /**
   * `apps/forge/bridge-studio-writes.ts`'s `spawnPreflightFix` — sessions-owned
   * (M4-projects routes budget row 12b), kept in its original file and
   * exported from there rather than moved. Spawns ONE detached `forge
   * preflight fix` agent turn; events stream to
   * `_logs/_preflight-fix-<runId>/events.jsonl`.
   */
  spawnPreflightFix: (
    forgeRoot: string,
    p: { project: string; clause: string; instruction: string; detail: string; runId: string },
  ) => void;
};

/**
 * Builds the three write-side preflight route handlers. A factory rather
 * than plain exports because `handleProjectPreflightFixAgent`'s USER-tier
 * branch needs `spawnPreflightFix` — see this file's header and
 * `PreflightWriteDeps` above for why that is an injected dependency rather
 * than a direct import.
 */
export function makePreflightWriteHandlers(deps: PreflightWriteDeps): {
  handleProjectSaveRepo: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
  handleProjectPreflightFixAuto: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
  handleProjectPreflightFixAgent: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
} {
  // ---- POST /api/studio/projects/:id/save-repo (R1-2) ----------------------
  // Merge the project's accumulated forge-studio changes into main + push.
  async function handleProjectSaveRepo(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    const saveRepoMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/save-repo$/);
    if (!(saveRepoMatch && method === 'POST')) return false;

    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/studio/projects/:id/save-repo', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
    try {
      const projectRoot = resolveManagedProject(ctx, decodeURIComponent(saveRepoMatch[1]), res, origin);
      if (!projectRoot) return true;
      const result = saveProjectRepo(projectRoot);
      sendJson(res, 200, { ok: true, ...result }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/:id/preflight/fix-auto (Stage D) ----------
  async function handleProjectPreflightFixAuto(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    const pfAutoMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-auto$/);
    if (!(pfAutoMatch && method === 'POST')) return false;

    try {
      const projectRoot = resolveManagedProject(ctx, decodeURIComponent(pfAutoMatch[1]), res, origin);
      if (!projectRoot) return true;
      const before = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      try { ensureStudioBranch(projectRoot); } catch { /* non-git */ }
      const result = applyPreflightAutoFixes({ projectDir: projectRoot, forgeRoot: ctx.forgeRoot, clauses: before.clauses });
      try { commitStudioChange(projectRoot, 'forge-studio: preflight auto-fix'); } catch { /* best-effort */ }
      const after = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      sendJson(res, 200, { ok: true, applied: result.applied, skipped: result.skipped, clauses: after.clauses.map(toClauseDto), ready: after.ok }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/:id/preflight/fix-agent (Stage D) ---------
  async function handleProjectPreflightFixAgent(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    const pfAgentMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-agent$/);
    if (!(pfAgentMatch && method === 'POST')) return false;

    try {
      const id = decodeURIComponent(pfAgentMatch[1]);
      const projectRoot = resolveManagedProject(ctx, id, res, origin);
      if (!projectRoot) return true;
      let body: Record<string, unknown>;
      try {
        body = (await ctx.readBody()) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      const clauseId = typeof body.clauseId === 'string' ? body.clauseId : '';
      const instruction = typeof body.instruction === 'string' ? body.instruction : '';
      if (!clauseId) {
        sendJson(res, 400, { error: 'fix-agent requires clauseId' }, origin);
        return true;
      }
      const cls = classifyPreflightFixAgentClause(projectRoot, ctx.forgeRoot, clauseId);
      if (cls.kind === 'not-found') {
        sendJson(res, 404, { error: `unknown clause ${clauseId}` }, origin);
        return true;
      }
      if (cls.kind === 'auto') {
        sendJson(res, 400, { error: `${clauseId} is auto-tier — use fix-auto`, route: 'auto' }, origin);
        return true;
      }
      if (cls.kind === 'agent') {
        // C8→instructions, DEMO/DEMO-SKILL→demo-builder, BRAIN→brain-fix. The UI
        // navigates to the existing builder surface; no spawn here.
        sendJson(res, 200, { ok: true, resolution: 'agent', route: cls.route, fixHint: cls.fixHint }, origin);
        return true;
      }
      // USER-tier — spawn the generic preflight-fix agent with the operator's decision.
      const runId = `${id}-${clauseId}-${Date.now().toString(36)}`;
      try {
        deps.spawnPreflightFix(ctx.forgeRoot, { project: id, clause: clauseId, instruction, detail: cls.detail, runId });
      } catch (err) {
        sendJson(res, 500, { error: `failed to dispatch preflight-fix: ${sanitizeError(err)}` }, origin);
        return true;
      }
      sendJson(res, 200, {
        ok: true, resolution: 'user', route: 'preflight-fix', runId,
        // R5-01-F1 stub-actions: only this user-tier branch spawns; the
        // auto/agent-tier branches above return without a marker.
        ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/studio/projects/:id/preflight/fix-agent', runId),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return { handleProjectSaveRepo, handleProjectPreflightFixAuto, handleProjectPreflightFixAgent };
}
