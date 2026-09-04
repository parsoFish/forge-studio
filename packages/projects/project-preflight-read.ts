/**
 * The read-side preflight routes: `GET /api/studio/projects/:id/preflight`,
 * `GET /api/studio/projects/:id/repo-status` and
 * `GET /api/studio/projects/:id/preflight/fix-agent/:runId`.
 *
 * M4 §4 (projects routes carve). Moved VERBATIM out of `apps/forge/bridge-studio.ts`'s
 * `handleStudioRoutes` if-chain into standalone handlers with the
 * `RouteEntry` handler signature. No injected dependency needed here — every
 * import (`runPreflight`, `classifyClause`, `hasPendingStudioChanges`,
 * `STUDIO_BRANCH`) is this package's own, and `discoverProjects`/
 * `resolveProjectsDir`/`defaultConfigPath`/`loadConfig`/`resolveGuardedPath`
 * are kernel (rank 1, always importable).
 *
 * The write-side siblings (`POST .../preflight/fix-auto`,
 * `POST .../preflight/fix-agent`, `POST .../save-repo`) live in
 * `apps/forge/bridge-studio-writes.ts` and are carved separately (a different
 * source file, a different worker in this same PR).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { runPreflight } from '@forge/projects/preflight.ts';
import { classifyClause } from '@forge/projects/preflight-resolve.ts';
import { hasPendingStudioChanges, STUDIO_BRANCH } from '@forge/projects/project-repo-tx.ts';
import {
  discoverProjects,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  resolveGuardedPath,
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  PROJECT_ID_RE,
  SAFE_ID_RE,
  type StudioContext,
} from '@forge/kernel';

/**
 * Read a preflight-fix run's terminal state from its event log. Mirrors
 * readBrainFixState — a local log reader so the bridge needn't import the
 * SDK-laden runner module.
 */
function readPreflightFixState(
  forgeRoot: string,
  runId: string,
): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean } {
  // Containment (forge-2zz): `runId` reaching here is only SAFE_ID_RE-gated
  // (charset only, never realpath) at the calling route above — route it
  // through the shared resolveGuardedPath so a symlinked
  // `_logs/_preflight-fix-<runId>` cannot be read through. `_preflight-fix-
  // <runId>` and 'events.jsonl' are each single, separator-free components,
  // so this is a legal segments[] list — the fixed `<forgeRoot>/_logs` stays
  // the trusted root; runId only ever enters as its OWN segment, never
  // folded into root (see studio-path-guard.ts's CONTRACT section).
  const guarded = resolveGuardedPath(join(forgeRoot, '_logs'), [`_preflight-fix-${runId}`, 'events.jsonl']);
  // Fail-soft by design, unchanged: this helper has no error channel to its
  // caller (spread straight into a 200 response above), so a guard
  // rejection collapses into the SAME 'running' shape a not-yet-started run
  // reports — never a distinct error, which would leak an oracle for
  // exactly the attacker iterating on this guard.
  if (!guarded.ok || !guarded.exists) return { state: 'running', cleared: false };
  const evPath = guarded.realPath;
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('preflight-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      return { state: cleared ? 'cleared' : 'not-cleared', cleared };
    }
    if (ev.event_type === 'error' || ev.message === 'preflight-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

/** GET /api/studio/projects/:id/preflight */
export async function handleProjectPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const preflightMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight$/);
  if (preflightMatch && method === 'GET') {
    try {
      const id = decodeURIComponent(preflightMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      // B1: resolve the project by disk scan rather than the projects.yaml
      // registry. A dir without `.forge/project.json` still preflights (the
      // operator runs preflight to learn WHY it is not yet contract-green).
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      const projectRoot = projectRef.absPath;
      if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
        sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
        return true;
      }
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const clauses = report.clauses.map((c) => {
        const cls = classifyClause(c);
        return {
          id: c.clause,
          title: c.title,
          hard: c.hard,
          pass: c.pass,
          detail: c.detail,
          resolution: cls.resolution,
          route: cls.route,
          fixHint: cls.fixHint,
        };
      });
      sendJson(res, 200, { clauses, ready: report.ok }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  return false;
}

/** GET /api/studio/projects/:id/repo-status (R1-2) — pending studio changes */
export async function handleProjectRepoStatus(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const repoStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/repo-status$/);
  if (repoStatusMatch && method === 'GET') {
    try {
      const id = decodeURIComponent(repoStatusMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      sendJson(res, 200, { pending: hasPendingStudioChanges(projectRef.absPath), branch: STUDIO_BRANCH }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  return false;
}

/** GET /api/studio/projects/:id/preflight/fix-agent/:runId (Stage D) */
export async function handleProjectPreflightFixAgentStatus(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const pfStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-agent\/([^/]+)$/);
  if (pfStatusMatch && method === 'GET') {
    const runId = decodeURIComponent(pfStatusMatch[2]);
    if (!SAFE_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid run id' }, origin);
      return true;
    }
    sendJson(res, 200, { ok: true, runId, ...readPreflightFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }
  return false;
}
