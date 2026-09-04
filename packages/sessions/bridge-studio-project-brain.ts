/**
 * bridge-studio-project-brain.ts — the project-brain session kind's
 * `/api/project-brain/*` routes, carved out of `cli/ui-bridge.ts`.
 *
 * Six routes, arms VERBATIM. Same rules as the architect and instructions
 * modules: `readJson(req)` → `ctx.readBody()` (ruling 30), shared helpers from
 * `bridge-studio-session-helpers.ts`, host spawn/serve surface injected.
 *
 * `approve` and `abandon` share ONE arm (`url === '…/approve' || url === '…/abandon'`)
 * and therefore ONE handler — but they get their OWN table entries, because
 * their dry-bridge classifications genuinely differ: approve is `stub-actions`
 * (it spawns), abandon is `exempt-local` (it does not). Collapsing them into a
 * single entry would have to pick one classification and lie about the other.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';


import { allowedOrigin, sendJson } from '@forge/kernel';
import { guardedReadDir, guardedReadFile, guardedWriteFile, resolveGuardedPath } from '@forge/kernel/path-guard.ts';

import { guardedReadSessionStatus, guardedWriteSessionStatus } from './session-status-io.ts';
import { LEGACY_SESSION_TERMINAL_PHASES } from './session-phases.ts';
import { listProjectBrainSessions } from './bridge-studio-session-index.ts';

import {
  deriveRowLifecycle,
  findSessionKindDescriptorSafe,
  guardedSessionDir,
  newArchitectSessionId,
  rejectStartProjectRepoPath,
  resolveKickoffModelTier,
  unknownProjectReason,
  type SessionHostSurface,
  type SessionRootsContext,
} from './bridge-studio-session-helpers.ts';

/**
 * The row shape this route reads, declared structurally.
 *
 * The real `ProjectBrainRow` still lives in
 * `packages/sessions/kinds/project-brain.ts` — that runner's shell is
 * handoff K21, sessions' own carve-in, and it has not landed yet. Naming the
 * legacy type from here would mint a `package-to-legacy` row for the duration,
 * so the three fields the arm actually reads are declared instead. When K21
 * lands this becomes an import of the real type.
 */
export type ProjectBrainRow = {
  readonly phase: string;
  readonly project: string;
  readonly session_id: string;
  /** Read by the session index when it flattens this kind into the cross-kind
   *  list; typed rather than left to the index signature, because `?? null` on
   *  an `unknown` widens to `{} | null` and loses the row's shape. */
  readonly modelTier?: string | null;
  /** Required, not optional: a real project-brain status always carries it, and
   *  making it optional here would push a `?? ''` into the index and quietly
   *  turn a missing timestamp into an empty one. */
  readonly updated_at: string;
  /** The status document carries more than the arms read; the index signature
   *  keeps the round-trip through `guardedRead/WriteSessionStatus` lossless
   *  rather than silently narrowing a document this module only passes through. */
  readonly [key: string]: unknown;
};

/** What the project-brain arms read off the bridge. */
export type ProjectBrainRouteContext = SessionRootsContext & {
  readonly readBody: () => Promise<unknown>;
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  readonly broadcastProjectBrainChanged: () => void;
} & SessionHostSurface;

/**
 * A PRE-EXISTING ASYMMETRY RECORDED ON THE WAY PAST, NOT FIXED HERE.
 *
 * This route's DEFAULT `project_repo_path` (used when the request omits the
 * field) is `body.projectRepoPath || join(ctx.projectsRoot, body.project)` —
 * built raw. The instructions and demo kinds compute the same default but route
 * it through `resolveGuardedPath(ctx.projectsRoot, [body.project])` first, fixes
 * tagged `forge-osz` and `forge-4vt` whose own comments say the containment
 * they replaced was "an accident of SOURCE ORDER". That back-port never reached
 * this kind or project-brain.
 *
 * It is not exploitable today: `guardedSessionDir(...)` runs earlier in this arm
 * and performs an equivalent per-segment identity check on `body.project`. But
 * that is coincidence — `guardedSessionDir` exists to validate the SESSION dir,
 * not this field — and it is exactly the shape those two beads were filed
 * against. It matters because nothing downstream re-validates:
 * `instructions-runner.ts` calls `mkdirSync(status.project_repo_path)` with no
 * second check, so this is the only gate before a real filesystem write.
 *
 * Found by the adversarial containment review OF this carve. A carve changes no
 * guard — fixing it here would hide a security change inside a move — so it is
 * recorded here, in the PR body, and handed to T1 for a bead.
 */
export async function handleProjectBrainRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProjectBrainRouteContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);
  // POST /api/demo-builder/start {project, mode?, projectRepoPath?} — create a
  // session in the `briefing` phase. It does NOT spawn the agent: the operator
  // lands on the screen, sees the demo process + any existing locked demo, and
  // provides notes; POST /api/demo-builder/brief then kicks off the agent.
  // R1-3b — project-brain builder ops (analyze → review → commit).
  if (method === 'GET' && url === '/api/project-brain/sessions') {
    const statuses = listProjectBrainSessions(ctx.projectsRoot);
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES['project-brain'].has(s.phase)) ctx.ensureSessionTail(ctx.spawnAgentSpecs['project-brain'].logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — this route served `statuses` VERBATIM, with no
    // lifecycle AND no staleness derivation of any kind (unlike the other
    // three bespoke list routes' now-collapsed heartbeat-or-updated_at
    // calc) — the worst of the four. Same seam as the other three.
    const projectBrainDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'project-brain');
    const sessions = statuses.map((s) => {
      const rowLifecycle = projectBrainDescriptor
        ? deriveRowLifecycle(ctx, projectBrainDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      return {
        ...s,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }
  {
    const themesMatch = url.match(/^\/api\/project-brain\/themes\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && themesMatch) {
      // SEC-04 — the route regex captures `[^/]+` per segment, so a
      // `%2F`-smuggled `..` survives the real-slash boundary and only becomes a
      // `/` at decodeURIComponent time. DECODE FIRST, then guard the decoded
      // segments through the per-segment identity walk — an escaping
      // project/sessionId resolves to null and discloses no out-of-root theme.
      const project = decodeURIComponent(themesMatch[1]);
      const sessionId = decodeURIComponent(themesMatch[2]);
      const dir = guardedSessionDir(ctx.projectsRoot, project, '_project-brain', sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
        return true;
      }
      sendJson(res, 200, { themes: readStagedThemes(ctx.projectsRoot, [project, '_project-brain', sessionId]) }, origin);
      return true;
    }
  }
  if (method === 'POST' && url === '/api/project-brain/start') {
    try {
      const body = (await ctx.readBody()) as { project?: string; projectRepoPath?: string; modelTier?: unknown };
      if (!body.project) { sendJson(res, 400, { error: 'project is required' }, origin); return true; }
      // W7-B6 (sessions-kinds-02): roster check — no phantom project dirs.
      const unknownPbProject = unknownProjectReason(ctx, body.project);
      if (unknownPbProject !== null) {
        sendJson(res, 404, { error: unknownPbProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/status write. See
      // invalidProjectRepoPath's header for the defect.
      const badRepoPath = rejectStartProjectRepoPath(body, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot }, ctx.isContainedProjectRepoPath);
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // project-brain-builder SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('project-brain-builder', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // forge-8vfn.5.51 — back-port of forge-osz / forge-4vt. The DEFAULT repo
      // path is resolved through the containment guard rather than folded raw:
      // `guardedSessionDir` above happens to reject a traversal `body.project`
      // first, but it exists to validate the SESSION dir, not this field, and
      // nothing downstream re-validates before `mkdirSync(project_repo_path)`.
      // Relying on that ordering is what forge-osz's own comment calls "an
      // accident of SOURCE ORDER".
      let repoPath: string;
      if (body.projectRepoPath) {
        repoPath = body.projectRepoPath; // already contained by rejectStartProjectRepoPath above
      } else {
        const guardedProject = resolveGuardedPath(ctx.projectsRoot, [body.project]);
        if (!guardedProject.ok) {
          sendJson(res, 400, { error: 'invalid project' }, origin);
          return true;
        }
        repoPath = guardedProject.realPath;
      }
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+status write.
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf sibling.
      if (guardedWriteSessionStatus<ProjectBrainRow>(ctx.projectsRoot, [body.project, '_project-brain', sessionId], {
        session_id: sessionId, project: body.project, project_repo_path: repoPath,
        phase: 'briefing', prompt: '', updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastProjectBrainChanged();
      sendJson(res, 200, { ok: true, sessionId }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }
  if (method === 'POST' && url === '/api/project-brain/brief') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string; brief?: string };
      if (!body.project || !body.sessionId) { sendJson(res, 400, { error: 'project and sessionId are required' }, origin); return true; }
      // SEC-04 (bd forge-ebj) — guard the dir, and route each leaf (prompt.md,
      // status.json) through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_project-brain', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', body.sessionId);
      if (!dir) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      const status = guardedReadSessionStatus<ProjectBrainRow>(ctx.projectsRoot, dirSegs);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], body.brief ?? '') === null ||
        guardedWriteSessionStatus<ProjectBrainRow>(ctx.projectsRoot, dirSegs, { ...status, phase: 'analyzing', prompt: body.brief ?? '' }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'project-brain', body.project, body.sessionId);
      ctx.broadcastProjectBrainChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/project-brain/brief', body.sessionId) }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }
  if (method === 'POST' && (url === '/api/project-brain/approve' || url === '/api/project-brain/abandon')) {
    try {
      const approve = url.endsWith('/approve');
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) { sendJson(res, 400, { error: 'project and sessionId are required' }, origin); return true; }
      // SEC-04 (bd forge-ebj) — guard the dir, and route status.json read+write
      // through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_project-brain', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', body.sessionId);
      if (!dir) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      const status = guardedReadSessionStatus<ProjectBrainRow>(ctx.projectsRoot, dirSegs);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      if (guardedWriteSessionStatus<ProjectBrainRow>(ctx.projectsRoot, dirSegs, { ...status, phase: approve ? 'committing' : 'abandoned' }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      if (approve) ctx.spawnAgentTurn(ctx.forgeRoot, 'project-brain', body.project, body.sessionId);
      ctx.broadcastProjectBrainChanged();
      // Only approve spawns — abandon is exempt-local and carries no marker.
      sendJson(res, 200, { ok: true, ...(approve ? ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/project-brain/approve', body.sessionId) : {}) }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }  return false;
}

/** R1-3b — the staged theme files (name + content) for a session under review.
 *  SEC-04 (bd forge-ebj): the caller's `guardedSessionDir` contains the session
 *  DIRECTORY, but the `themes/` subdir and each `<name>.md` LEAF were then
 *  raw-appended and `readdir`/`readFileSync`'d — a symlinked `themes/` subdir
 *  (git-plantable inside a project repo) OR a symlinked theme leaf was followed
 *  out of root. Takes the TRUSTED `projectsRoot` plus the request-derived
 *  `dirSegments` (project / `_project-brain` / sessionId) as their OWN
 *  elements, and routes the `themes/` readdir + every leaf read through the
 *  per-segment identity guard (leaf included). */
function readStagedThemes(
  projectsRoot: string,
  dirSegments: readonly string[],
): Array<{ name: string; content: string }> {
  const themeSegs = [...dirSegments, 'themes'];
  const names = guardedReadDir(projectsRoot, themeSegs);
  if (names === null) return [];
  const out: Array<{ name: string; content: string }> = [];
  for (const name of names.filter((f) => f.endsWith('.md')).sort()) {
    const content = guardedReadFile(projectsRoot, [...themeSegs, name]);
    if (content !== null) out.push({ name, content });
  }
  return out;
}