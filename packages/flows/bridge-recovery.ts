/**
 * bridge-recovery — the operator RECOVERY surface on the bridge (DEC-6).
 *
 * S9 retires the CLI as an operator surface; the recovery verbs that used to live
 * on `forge review --inspect / --abandon` + `forge requeue` + `forge enqueue` move
 * here as bridge routes the UI recovery screen drives:
 *
 *   GET  /api/recovery/:id          → inspect a stuck cycle (read-only: worktree /
 *                                     branch / commits / diff-stat / PR draft)
 *   POST /api/recovery/:id/abandon  → move it to failed/ + clean worktree + branch
 *   POST /api/recovery/:id/requeue  → move it back to pending/ (resetRetries /
 *                                     resumeFromDemo), wrapping runRequeue
 *   POST /api/initiatives           → enqueue a fresh manifest from a spec body
 *                                     (recovery-grade; the architect flow is the
 *                                     canonical authoring path)
 *
 * All git invocations use execFileSync with arg arrays (no shell) and every :id is
 * validated against INIT_ID_RE before any path construction, so a malformed id can
 * never traverse out of the queue dir. POSTs are CSRF-guarded upstream in ui-bridge.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from './queue.ts';
import { parseManifest, validateManifest, writeManifest } from './manifest.ts';
import { runRequeue } from './forge-requeue.ts';
import { sendJson, pathOnly, allowedOrigin, sanitizeError } from '@forge/kernel';
import { INIT_ID_RE } from './bridge-studio-runs.ts';
import { isDryBridge, refuseDryBridge } from '@forge/kernel';
import {
  validateManifestPathFields,
  isContainedWorktreePath,
  isContainedProjectRepoPath,
} from './manifest-path-guard.ts';

/**
 * `projectsRoot` (R4-17 round-4, pin 7) is the bridge's snapshot —
 * `ctx.projectsRoot`, resolved ONCE at `startBridge` and held for the
 * process's lifetime. Threaded verbatim into every containment check on these
 * routes so a live `forge.config.json` edit cannot make the guard re-derive a
 * DIFFERENT root than the bridge is actually running against (see
 * `packages/flows/manifest-path-guard.ts`'s `ProjectsRootOpt`).
 */
export type RecoveryContext = {
  forgeRoot: string;
  queueRoot: string;
  logsRoot: string;
  projectsRoot: string;
  /** The RESULT of the host's body policy, never the policy itself (T1 ruling 30;
   *  the same closure `kernel/route-entry.ts`'s `RouteContext.readBody` carries).
   *  These arms used to call the assembly's body reader directly, which was two
   *  `package-to-assembly` boundary rows for a request-parsing decision the host
   *  is the single place to make. */
  readBody: () => Promise<unknown>;
};

type QueueState = 'pending' | 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed';

/**
 * Locate a manifest by id across all queue states. `merged` is included
 * defensively (R4-11-F1): it's a transient pass-through promoted to `done/`
 * in the same sweep as closure's confirmed-merge move, but a crash between
 * that move and the promotion would otherwise strand the manifest somewhere
 * recovery can't find it.
 */
function locate(initiativeId: string, queueRoot: string): { path: string; state: QueueState } | null {
  const paths = getPaths(queueRoot);
  const states: Array<{ dir: string; state: QueueState }> = [
    { dir: paths.pending, state: 'pending' },
    { dir: paths.inFlight, state: 'in-flight' },
    { dir: paths.readyForReview, state: 'ready-for-review' },
    { dir: paths.merged, state: 'merged' },
    { dir: paths.done, state: 'done' },
    { dir: paths.failed, state: 'failed' },
  ];
  for (const { dir, state } of states) {
    const candidate = join(dir, `${initiativeId}.md`);
    if (existsSync(candidate)) return { path: candidate, state };
  }
  return null;
}

/** Best-effort git read (no shell; empty string on any failure). */
function git(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export type RecoveryInspect = {
  found: boolean;
  initiativeId: string;
  state?: QueueState;
  worktree?: string | null;
  worktreeExists?: boolean;
  branch?: string;
  commits?: string[];
  diffStat?: string;
  prDraftChars?: number;
};

/** Port of cmdReviewInspect — read-only state of a preserved worktree. */
export function recoveryInspect(initiativeId: string, ctx: RecoveryContext): RecoveryInspect {
  const located = locate(initiativeId, ctx.queueRoot);
  if (!located) return { found: false, initiativeId };
  const m = parseManifest(readFileSync(located.path, 'utf8'));
  const wt = (m as { worktree_path?: string }).worktree_path ?? null;
  const branch = `forge/${initiativeId}`;
  const out: RecoveryInspect = { found: true, initiativeId, state: located.state, worktree: wt, branch };
  // SEC-02 (forge-d1f): a worktree_path that fails containment must not be
  // treated as a live worktree — `git -C <wt> log/diff` would turn this
  // read-only inspect route into an arbitrary-directory git-log oracle, and
  // reading `<wt>/.forge/pr-description.md` would leak an arbitrary file's
  // length (prDraftChars). Falls into the SAME existing shape the "no
  // worktree" case already uses (worktreeExists:false) rather than a new one.
  const wtContained = wt !== null && isContainedWorktreePath(wt, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, initiativeId });
  if (wt && wtContained && existsSync(wt)) {
    out.worktreeExists = true;
    out.commits = git(wt, ['log', '--no-color', '--format=%h %s', '-n', '20', 'main..HEAD'])
      .split('\n').filter((l) => l.length > 0);
    out.diffStat = git(wt, ['diff', '--stat', 'main...HEAD']);
    const prPath = join(wt, '.forge', 'pr-description.md');
    out.prDraftChars = existsSync(prPath) ? readFileSync(prPath, 'utf8').length : 0;
  } else {
    out.worktreeExists = false;
  }
  return out;
}

/** Port of cmdReviewAbandon — move to failed/ + clean worktree + branch (local + remote). */
export function recoveryAbandon(initiativeId: string, ctx: RecoveryContext): { ok: boolean; movedTo?: string; detail?: string } {
  const located = locate(initiativeId, ctx.queueRoot);
  if (!located) return { ok: false, detail: 'no manifest found' };
  const m = parseManifest(readFileSync(located.path, 'utf8'));
  const wt = (m as { worktree_path?: string }).worktree_path;
  const projectRepoPath = m.project_repo_path;
  // SEC-02 (forge-d1f): refuse the whole abandon — no git op, no queue move —
  // rather than run `git -C <projectRepoPath> worktree remove/branch -D/push
  // --delete` against an out-of-bounds path. Reuses the SAME error shape this
  // function already returns for "no manifest found" rather than inventing a
  // new one, and never echoes the offending path back to the caller.
  if (wt && !isContainedWorktreePath(wt, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, initiativeId })) {
    return { ok: false, detail: 'no manifest found' };
  }
  if (projectRepoPath && !isContainedProjectRepoPath(projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })) {
    return { ok: false, detail: 'no manifest found' };
  }
  const branch = `forge/${initiativeId}`;
  if (projectRepoPath && existsSync(projectRepoPath)) {
    if (wt && existsSync(wt)) {
      try { execFileSync('git', ['-C', projectRepoPath, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }); } catch { /* */ }
    }
    try { execFileSync('git', ['-C', projectRepoPath, 'branch', '-D', branch], { stdio: 'ignore' }); } catch { /* never created / already gone */ }
    // Remote branch — best-effort (no origin / never pushed silently skip).
    try { execFileSync('git', ['-C', projectRepoPath, 'push', 'origin', '--delete', branch], { stdio: 'ignore' }); } catch { /* */ }
  }
  const failedDir = getPaths(ctx.queueRoot).failed;
  mkdirSync(failedDir, { recursive: true });
  renameSync(located.path, join(failedDir, `${initiativeId}.md`));
  // Drop any stale verdict sidecars in in-flight.
  const inFlight = getPaths(ctx.queueRoot).inFlight;
  for (const suffix of ['.verdict-prompt.md', '.verdict-response.md']) {
    const p = join(inFlight, `${initiativeId}${suffix}`);
    if (existsSync(p)) { try { rmSync(p, { force: true }); } catch { /* */ } }
  }
  // Return a queue-relative reference (not an absolute fs path) — same convention
  // as the rest of the bridge's sanitised responses (security review, S9).
  return { ok: true, movedTo: `failed/${initiativeId}.md` };
}

/**
 * Handle the recovery + initiatives routes. Returns true iff handled. Never throws
 * (errors → JSON). GET is read-only; POSTs are CSRF-guarded upstream (ui-bridge).
 */
export async function handleRecoveryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RecoveryContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // GET /api/recovery/:id — inspect (read-only)
  const inspectMatch = url.match(/^\/api\/recovery\/([^/]+)$/);
  if (method === 'GET' && inspectMatch) {
    const id = decodeURIComponent(inspectMatch[1]);
    if (!INIT_ID_RE.test(id)) { sendJson(res, 400, { error: 'invalid initiative id' }, origin); return true; }
    try { sendJson(res, 200, recoveryInspect(id, ctx), origin); }
    catch (err) { sendJson(res, 500, { error: sanitizeError(err) }, origin); }
    return true;
  }

  // POST /api/recovery/:id/abandon
  const abandonMatch = url.match(/^\/api\/recovery\/([^/]+)\/abandon$/);
  if (method === 'POST' && abandonMatch) {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/recovery/:id/abandon', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
    const id = decodeURIComponent(abandonMatch[1]);
    if (!INIT_ID_RE.test(id)) { sendJson(res, 400, { error: 'invalid initiative id' }, origin); return true; }
    try {
      const result = recoveryAbandon(id, ctx);
      sendJson(res, result.ok ? 200 : 404, result, origin);
    } catch (err) { sendJson(res, 500, { error: sanitizeError(err) }, origin); }
    return true;
  }

  // POST /api/recovery/:id/requeue {resetRetries?, resumeFromDemo?}
  const requeueMatch = url.match(/^\/api\/recovery\/([^/]+)\/requeue$/);
  if (method === 'POST' && requeueMatch) {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/recovery/:id/requeue', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
    const id = decodeURIComponent(requeueMatch[1]);
    if (!INIT_ID_RE.test(id)) { sendJson(res, 400, { error: 'invalid initiative id' }, origin); return true; }
    try {
      const body = (await ctx.readBody().catch(() => ({}))) as Record<string, unknown>;
      const result = runRequeue(id, {
        resetRetries: body['resetRetries'] === true,
        resumeFromDemo: body['resumeFromDemo'] === true,
        forgeRoot: ctx.forgeRoot,
        projectsRoot: ctx.projectsRoot,
      });
      sendJson(res, 200, { ok: true, ...result }, origin);
    } catch (err) { sendJson(res, 409, { error: sanitizeError(err) }, origin); }
    return true;
  }

  // POST /api/initiatives — enqueue a fresh manifest from a spec body
  if (method === 'POST' && url === '/api/initiatives') {
    try {
      const body = (await ctx.readBody().catch(() => null)) as { manifest?: string } | null;
      if (!body || typeof body.manifest !== 'string') {
        sendJson(res, 400, { error: 'body must be { manifest: "<manifest markdown>" }' }, origin);
        return true;
      }
      let manifest;
      try { manifest = parseManifest(body.manifest); }
      catch (err) { sendJson(res, 400, { error: `unparseable manifest: ${sanitizeError(err)}` }, origin); return true; }
      const errors = validateManifest(manifest);
      if (errors.length > 0) { sendJson(res, 400, { error: 'invalid manifest', detail: errors }, origin); return true; }
      // SEC-02 (forge-d1f): reject an out-of-bounds worktree_path /
      // project_repo_path / cycle_id / project BEFORE writeManifest ever
      // runs, so the ingest route reports a clean 400 instead of the
      // writeManifest guard's throw surfacing as a 500.
      const pathErrors = validateManifestPathFields(manifest, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (pathErrors.length > 0) { sendJson(res, 400, { error: 'invalid manifest', detail: pathErrors }, origin); return true; }
      const paths = getPaths(ctx.queueRoot);
      const filename = `${manifest.initiative_id}.md`;
      if (existsSync(join(paths.inFlight, filename)) || existsSync(join(paths.pending, filename))) {
        sendJson(res, 409, { error: 'initiative already pending or in-flight', initiativeId: manifest.initiative_id }, origin);
        return true;
      }
      const out = writeManifest(manifest, { queueRoot: ctx.queueRoot, projectsRoot: ctx.projectsRoot });
      sendJson(res, 201, { ok: true, initiativeId: manifest.initiative_id, path: out }, origin);
    } catch (err) { sendJson(res, 500, { error: sanitizeError(err) }, origin); }
    return true;
  }

  return false;
}
