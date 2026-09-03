/**
 * bridge-studio-instructions.ts — the instructions session kind's
 * `/api/instructions/*` routes, carved out of `cli/ui-bridge.ts` (M4 §4 step 2).
 *
 * Same shape and the same rules as `bridge-studio-architect.ts`: the six arms
 * are VERBATIM, the only edits are `readJson(req)` → `ctx.readBody()`
 * (ruling 30), the shared helpers now imported from
 * `bridge-studio-session-helpers.ts`, and the host's spawn/serve surface
 * arriving through the injected context.
 *
 * `listInstructionsSessions` travels with these routes rather than staying in
 * the host: after the carve its only remaining caller in `cli/ui-bridge.ts` is
 * the session index collector, which is itself sessions-owned and carves too.
 *
 * A behaviour note worth carrying, because it looks like a bug and is not: the
 * verdict arm spawns a turn for EVERY verdict including `reject` — the spawn
 * sits outside the branch. That is pre-existing and is preserved exactly; a
 * carve is the wrong place to change it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';



import { allowedOrigin, sendJson } from '@forge/kernel';
import { guardedFile, guardedReadFile, guardedWriteFile, resolveGuardedPath } from '@forge/kernel/path-guard.ts';

import { readAgentInstructionsFile } from '@forge/projects/project-config.ts';

import { DRAFT_FILENAME, type InstructionsStatus } from './instructions-runner.ts';
import { listInstructionsSessions } from './bridge-studio-session-index.ts';
import {
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  type InterviewQuestion,
} from './interactive-session.ts';
import { MAX_ANSWER_FIELD_BYTES } from './session-answer-limits.ts';
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

  // POST /api/instructions/brief {project, sessionId, brief} — record the
  // operator's brief / change-notes and kick off the agent (briefing → interviewing).
  if (method === 'POST' && url === '/api/instructions/brief') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string; brief?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — the dir guard below contains the DIRECTORY,
      // but each leaf (`status.json`, `prompt.md`) was then raw-appended and
      // read/written through `join(dir, leaf)`, which FOLLOWS a symlinked leaf.
      // Route every leaf — request ids as their OWN segments under the trusted
      // projectsRoot, leaf included — through the guarded siblings so a
      // symlinked/hardlinked `status.json`/`prompt.md` inside a real session
      // dir is refused (read ⇒ null ⇒ 404; write ⇒ null ⇒ 400, nothing written).
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      // W6-B9 reviewer fix (parity): the generic `briefing-question-form`
      // affordance's equivalent field (`handleInstructionsBrief`,
      // cli/bridge-studio-affordances.ts) already caps at
      // MAX_ANSWER_FIELD_BYTES — this bespoke route writes the SAME
      // prompt.md/status.prompt target and must cap identically, one shared
      // constant, not two hand-kept limits (one bounded, one not).
      const briefBytes = Buffer.byteLength(brief, 'utf8');
      if (briefBytes > MAX_ANSWER_FIELD_BYTES) {
        sendJson(res, 400, { error: `brief is ${briefBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
        return true;
      }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
        guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: 1, prompt: brief }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/brief', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/answer {project, sessionId, answers} — append an
  // interview round and re-spawn a turn.
  if (method === 'POST' && url === '/api/instructions/answer') {
    try {
      const body = (await ctx.readBody()) as {
        project?: string;
        sessionId?: string;
        answers?: { question: string; answer: string }[];
      };
      if (!body.project || !body.sessionId || !Array.isArray(body.answers)) {
        sendJson(res, 400, { error: 'project, sessionId, answers[] are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — guard the request-derived session dir, and
      // route every leaf (status.json, answers.json) through the guarded leaf
      // siblings so a symlinked leaf inside a real dir is refused, not followed.
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const priorRaw = guardedReadFile(ctx.projectsRoot, [...dirSegs, 'answers.json']);
      const prior = (priorRaw !== null ? ctx.safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
      const round = prior.length + 1;
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: body.answers }], null, 2)) === null ||
        guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, round, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/answer', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/verdict {project, sessionId, kind, feedback?} —
  // approve → finalizing; revise → write feedback.md + drafting; reject → rejected.
  if (method === 'POST' && url === '/api/instructions/verdict') {
    try {
      const body = (await ctx.readBody()) as {
        project?: string;
        sessionId?: string;
        kind?: 'approve' | 'revise' | 'reject';
        feedback?: string;
      };
      if (!body.project || !body.sessionId || !body.kind) {
        sendJson(res, 400, { error: 'project, sessionId, kind are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — guard the dir, and route each leaf (status.json,
      // feedback.md) through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      let wrote: string | null;
      if (body.kind === 'approve') {
        wrote = guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'finalizing' });
      } else if (body.kind === 'revise') {
        // W7-C2 T1 review (A12) — parity with the generic route: an EMPTY
        // revise is refused here too. `body.feedback ?? ''` used to accept
        // one, so the bespoke surface re-ran the drafting turn with no
        // guidance (which regenerates the same draft) where the generic
        // route 400s — two routes onto the same on-disk state disagreeing
        // about the same rule.
        if (typeof body.feedback !== 'string' || body.feedback.trim().length === 0) {
          sendJson(res, 400, { error: `feedback is required for kind "revise" — say what to change, got ${JSON.stringify(body.feedback)}` }, origin);
          return true;
        }
        const wroteFeedback = guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'feedback.md'], body.feedback);
        wrote = wroteFeedback === null ? null : guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'drafting' });
      } else {
        wrote = guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'rejected' });
      }
      if (wrote === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/verdict', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  return false;
}
