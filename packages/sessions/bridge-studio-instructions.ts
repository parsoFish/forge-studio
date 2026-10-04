/**
 * bridge-studio-instructions.ts — the instructions session kind's
 * `/api/instructions/*` routes, carved out of `apps/forge/ui-bridge.ts` (M4 §4 step 2).
 *
 * Three arms: `GET /sessions`, `GET /file/...` and `POST /start`. The
 * generic question-form/verdict affordance route
 * (`/api/studio/sessions/:kind/:id/:affordance`) is the one write surface
 * for briefing, the interview round and the verdict (row 206,
 * forge-8vfn.8.5.56, `_1.0/plans/M7-E-r206-design.md` — measured at the
 * `return false` at the bottom of this function: no forge-ui caller reaches
 * a bespoke `/api/instructions/{brief,answer,verdict}` here).
 *
 * `listInstructionsSessions` travels with these routes rather than staying in
 * the host: after the carve its only remaining caller in `apps/forge/ui-bridge.ts` is
 * the session index collector, which is itself sessions-owned and carves too.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';



import { allowedOrigin, sendJson } from '@forge/kernel';
import { guardedFile, guardedReadFile, resolveGuardedPath } from '@forge/kernel';

import { readAgentInstructionsFile } from '@forge/projects';

import { DRAFT_FILENAME, type InstructionsStatus } from './kinds/instructions.ts';
import { listInstructionsSessions } from './bridge-studio-session-index.ts';
import { guardedWriteSessionStatus, type InterviewQuestion } from './session-status-io.ts';
import { LEGACY_SESSION_TERMINAL_PHASES } from './session-phases.ts';
import {
  deriveRowLifecycle,
  findSessionKindDescriptorSafe,
  guardedSessionDir,
  newArchitectSessionId,
  rejectStartProjectRepoPath,
  resolveKickoffModelTier,
  sessionStaleMs,
  unknownProjectReason,
  type SessionHostSurface,
  type SessionRootsContext,
} from './bridge-studio-session-helpers.ts';

/** What the instructions arms read off the bridge; structural, so this package
 *  never names the host's `HttpContext`. */
export type InstructionsRouteContext = SessionRootsContext & {
  readonly readBody: () => Promise<unknown>;
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  readonly broadcastInstructionsChanged: () => void;
} & SessionHostSurface;



export async function handleInstructionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: InstructionsRouteContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // GET /api/instructions/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/instructions/sessions') {
    const statuses = listInstructionsSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.instructions.has(s.phase)) ctx.ensureSessionTail(ctx.spawnAgentSpecs.instructions.logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — see the architect route's identical comment.
    const instructionsDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'instructions');
    const sessions = statuses.map((s) => {
      // SEC-04 — resolve through the shared guard (the enumeration is already
      // guarded, so this is the same contained dir; keeps this file free of
      // bare request-derived session-dir builders).
      // SEC-04 (bd forge-ebj) — route each leaf through the guard (the dir was
      // already contained, but the `questions.json`/draft leaves were then
      // raw-appended and would follow a symlinked leaf).
      const dirSegs = [s.project, '_instructions', s.session_id];
      const questionsRaw =
        s.phase === 'awaiting-answers'
          ? guardedReadFile(ctx.projectsRoot, [...dirSegs, 'questions.json'])
          : null;
      const questions = questionsRaw !== null ? ctx.safeParseJson<InterviewQuestion[]>(questionsRaw) : null;
      const draftUrl = guardedFile(ctx.projectsRoot, [...dirSegs, DRAFT_FILENAME], 'read') !== null
        ? `/api/instructions/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/${encodeURIComponent(DRAFT_FILENAME)}`
        : null;

      // W8-A2 (ON-7 defect 1) — see the architect route: the derived lifecycle,
      // and `staleMs` from the runner's own heartbeat/`updated_at`, never the
      // status file's mtime.
      const rowLifecycle = instructionsDescriptor
        ? deriveRowLifecycle(ctx, instructionsDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'instructions', s.session_id, s.updated_at, rowLifecycle);

      // Surface the current AGENTS.md so the briefing screen can show the file
      // the operator is editing (and the read-only context for their notes).
      const current = readAgentInstructionsFile(s.project_repo_path);
      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        mode: s.mode ?? 'init',
        round: s.round,
        prompt: s.prompt,
        questions,
        draftUrl,
        currentInstructions: current ? current.content : null,
        currentInstructionsFile: current ? current.file : null,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/instructions/file/<project>/<sid>/<filename> — serve a session-dir
  // file (AGENTS.draft.md etc.) with a path-escape guard + content-type sniff.
  if (method === 'GET' && url.startsWith('/api/instructions/file/')) {
    const rest = url.slice('/api/instructions/file/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, ...fileParts] = rest;
    const filename = fileParts.join('/');
    if (!project || !sessionId || !filename) {
      sendJson(res, 400, { error: 'expected /api/instructions/file/<project>/<sid>/<filename>' }, origin);
      return true;
    }
    // SEC-04 — same self-defeating `startsWith(base)` defect as the architect
    // /file route; resolve the whole path (project, `_instructions`, sessionId,
    // filename) through the per-segment identity guard instead.
    const guarded = resolveGuardedPath(ctx.projectsRoot, [project, '_instructions', sessionId, ...filename.split('/')]);
    if (!guarded.ok) {
      // A containment escape — rejected BEFORE any existence probe, so
      // out-of-root existence is never leaked.
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!guarded.exists) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename }, origin);
      return true;
    }
    const requested = guarded.realPath;
    try {
      res.writeHead(200, ctx.servedFileHeaders(filename, origin));
      res.end(readFileSync(requested, 'utf8'));
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/start {project, mode?, projectRepoPath?} — create a
  // session in the `briefing` phase. It does NOT spawn the agent: the operator
  // lands on the screen, reviews the current AGENTS.md (edit mode), and provides
  // notes; POST /api/instructions/brief then kicks off the agent.
  if (method === 'POST' && url === '/api/instructions/start') {
    try {
      const body = (await ctx.readBody()) as { project?: string; mode?: 'init' | 'edit'; projectRepoPath?: string; modelTier?: unknown };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      // W7-B6 (sessions-kinds-02): roster check — a typo'd project used to
      // mkdir a phantom projects/<typo>/_instructions/<sid>/ forever.
      const unknownInstrProject = unknownProjectReason(ctx, body.project);
      if (unknownInstrProject !== null) {
        sendJson(res, 404, { error: unknownInstrProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE the readAgentInstructionsFile read
      // below (an unvalidated READ through the field, not just a write
      // target) and before any mkdirSync/status write. See
      // invalidProjectRepoPath's header for the defect.
      const badRepoPath = rejectStartProjectRepoPath(body, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot }, ctx.isContainedProjectRepoPath);
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // instructions-creator SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('instructions-creator', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // forge-osz — the `projectRepoPath || join(projectsRoot, project)` fallback
      // reaches readAgentInstructionsFile with a repoPath folded from the untrusted
      // `body.project`; guardedSessionDir below only guards the WRITE, and runs
      // AFTER this read. Guard the `body.project` segment through the SAME
      // resolveGuardedPath choke point the four sibling /start routes use, BEFORE
      // the read, so an untrusted project cannot fold an out-of-root read into a
      // trusted root.
      let repoPath: string;
      if (body.projectRepoPath) {
        repoPath = body.projectRepoPath;
      } else {
        const guardedProject = resolveGuardedPath(ctx.projectsRoot, [body.project]);
        if (!guardedProject.ok) {
          sendJson(res, 400, { error: 'invalid project' }, origin);
          return true;
        }
        repoPath = guardedProject.realPath;
      }
      // Default the mode by whether an agent-instruction file already exists.
      const mode: 'init' | 'edit' =
        body.mode ?? (readAgentInstructionsFile(repoPath) ? 'edit' : 'init');
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+status write: a traversal
      // `project` must create no out-of-root `_instructions` session.
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf
      // sibling (leaf included; mkdirs the parent, refuses a symlinked leaf).
      if (guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, [body.project, '_instructions', sessionId], {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'briefing',
        mode,
        round: 1,
        prompt: '',
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, sessionId, mode }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // Row 206 (forge-8vfn.8.5.56) — every instructions affordance POSTs
  // through the generic `question-form`/`verdict` affordance
  // (`postSessionAffordance`, `packages/sessions/kinds/instructions.ts`'s
  // `handleInstructionsBrief`/`handleInstructionsAnswer`/`handleInstructionsVerdict`,
  // phase-gated via `deriveSessionAffordances`) — the one dispatching write
  // path for `/api/instructions/*`. Measured: no forge-ui caller reaches a
  // bespoke `brief`/`answer`/`verdict` arm here
  // (`apps/studio/lib/bridge-client-interviews.ts`'s own "W6-B9" comment
  // names `postSessionAffordance` as `SessionInstructionsPanel`'s successor
  // for every one of these writes).
  return false;
}
