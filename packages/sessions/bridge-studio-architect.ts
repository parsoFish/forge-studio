/**
 * bridge-studio-architect.ts — the architect session kind's `/api/architect/*`
 * routes, carved out of `cli/ui-bridge.ts` (M4 §4 step 2).
 *
 * The five arms below are VERBATIM. A carve that re-specifies a hand-written
 * matcher or re-derives a guard while it moves is how behaviour changes with
 * every test still green, so the only edits here are mechanical: `readJson(req)`
 * became `ctx.readBody(req)` (ruling 30), the host's module-private helpers are
 * now imported from `bridge-studio-session-helpers.ts`, and the host's spawn
 * surface arrives through `deps` rather than as a free symbol.
 *
 * `POST /api/plan-verdict` is NOT here. It sat inside the same host function,
 * but it is flows-owned: `ctx.mergePr`, `ctx.finalizeAfterMerge` and
 * `ctx.queueRoot` appear in that whole function ONLY inside that one arm, which
 * is a dependency measurement rather than an ownership opinion. It stays in the
 * host.
 *
 * Each arm keeps its own `if` rather than becoming five separate exported
 * functions: the table in `routes.ts` carries one ENTRY per route (so
 * `dry-bridge-coverage` still sees a classification per URL), and each entry
 * delegates here — the shape `handleStudioSessionsRoutes` already set in PR 4a.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import lockfile from 'proper-lockfile';

import { allowedOrigin, sendJson, MAX_KICKOFF_COST_CEILING_USD } from '@forge/kernel';
import { guardedFile, guardedReadDir, guardedReadFile, guardedWriteFile, resolveGuardedPath } from '@forge/kernel/path-guard.ts';

import {
  guardedReadStatus,
  guardedWriteStatus,
  listArchitectSessions,
  type ArchitectQuestion,
  type ArchitectStatus,
} from './architect-runner.ts';
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

/**
 * What the architect arms read off the bridge. Declared structurally so this
 * package never names the host's `HttpContext`.
 */
export type ArchitectRouteContext = SessionRootsContext & {
  readonly readBody: () => Promise<unknown>;
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  readonly broadcastArchitectChanged: () => void;
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
export async function handleArchitectRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ArchitectRouteContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // GET /api/architect/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/architect/sessions') {
    const statuses = listArchitectSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.architect.has(s.phase)) ctx.ensureSessionTail(ctx.spawnAgentSpecs.architect.logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — loaded ONCE per request (a single YAML parse),
    // not once per row; `deriveRowLifecycle` below takes the already-resolved
    // descriptor. `undefined` only if the registry itself lacks 'architect'
    // (never true for the real studio/session-kinds.yaml — architect is
    // "permanently bespoke", isTerminalPhase's own doc comment) — degrades to
    // no lifecycle on the row rather than 500ing the whole list.
    const architectDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'architect');
    const sessions = statuses.map((s) => {
      // SEC-04 (bd forge-ebj) — this used a RAW `architectSessionDir` join and
      // then raw-appended each leaf (worse than dir-guarded): a symlinked
      // `_architect`/session dir OR a symlinked `questions.json`/`PLAN.html`
      // leaf (git-plantable inside a project repo) was followed out of root.
      // Route each leaf through the guard, request ids as their OWN segments
      // under the trusted projectsRoot.
      const dirSegs = [s.project, '_architect', s.session_id];
      const questionsRaw =
        s.phase === 'awaiting-answers'
          ? guardedReadFile(ctx.projectsRoot, [...dirSegs, 'questions.json'])
          : null;
      const questions = questionsRaw !== null ? ctx.safeParseJson<ArchitectQuestion[]>(questionsRaw) : null;
      const planUrl = guardedFile(ctx.projectsRoot, [...dirSegs, 'PLAN.html'], 'read') !== null
        ? `/api/architect/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/PLAN.html`
        : null;
      // W7-A3 (sessions-kinds-08/12, artifact-plan-22/23): the initiative ids
      // this session drafted — DERIVED at read time from its `manifests/*.md`
      // (the same files finalize promotes to `_queue/pending`), never stored
      // on status.json. Same guard family as the leaves above: a symlinked
      // `manifests` dir yields [] rather than being followed out of root.
      const initiativeIds = (guardedReadDir(ctx.projectsRoot, [...dirSegs, 'manifests']) ?? [])
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -'.md'.length))
        .sort();

      // W8-A2 (ON-7 defect 1) — the derived lifecycle (state/needsYou/error/
      // idleMs/cancellable): the SAME derivation the aggregate `/api/studio/
      // sessions` index already carried per row — this dedicated route never
      // called it before (`deriveSessionLifecycleFor` was imported once,
      // called once, by that other route alone).
      //
      // `staleMs` deliberately does NOT come from `lifecycle.idleMs`.
      // Collapsing it into idleMs was tried and REVERTED: idleMs is
      // `now - max(status.json MTIME, .heartbeat, events.jsonl)`, and the
      // runner rewrites status.json on every phase transition, so a dead
      // runner whose file was merely touched reads FRESH. The runner's own
      // `updated_at` is its CLAIM about when it last made progress, which is
      // the honest signal and the one this panel has always used; the file's
      // mtime is a weaker proxy that fails OPEN. Caught by the flows-run
      // stall cameo, whose fixture writes status.json NOW with an
      // `updated_at` 200s old and deletes the heartbeat — precisely the
      // divergence. `isSessionStale` (apps/studio/lib/architect-hex.ts) reads
      // this field against STALE_THRESHOLD_MS (120s), matched by
      // STALL_CEILING_MS_BY_KIND.architect.
      const rowLifecycle = architectDescriptor
        ? deriveRowLifecycle(ctx, architectDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'architect', s.session_id, s.updated_at, rowLifecycle);

      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        round: s.round,
        idea: s.idea,
        questions,
        planUrl,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
        completenessCritic: s.completenessCritic ?? null,
        initiativeIds,
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/architect/file/<project>/<sid>/<filename> — serve a session-dir
  // file (PLAN.html etc.) with a path-escape guard + content-type sniff.
  if (method === 'GET' && url.startsWith('/api/architect/file/')) {
    const rest = url.slice('/api/architect/file/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, ...fileParts] = rest;
    const filename = fileParts.join('/');
    if (!project || !sessionId || !filename) {
      sendJson(res, 400, { error: 'expected /api/architect/file/<project>/<sid>/<filename>' }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — the old `startsWith(base)` check was
    // self-defeating: `base` and `requested` were BOTH built from the same
    // untrusted `project`/`sessionId`, so a traversal in either was invisible
    // to the comparison (`join` only normalises `..` inside `filename`).
    // Resolve the WHOLE path — project, `_architect`, sessionId AND the
    // filename segments — through the per-segment identity guard; `!ok` (any
    // escape) and `!exists` (contained but absent) both collapse to 404.
    const guarded = resolveGuardedPath(ctx.projectsRoot, [project, '_architect', sessionId, ...filename.split('/')]);
    if (!guarded.ok) {
      // A containment escape (traversed project/sessionId, or a `..`/absolute
      // filename) — rejected BEFORE any existence probe, so out-of-root
      // existence is never leaked.
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

  // POST /api/architect/start {project, idea, projectRepoPath?} — create a new
  // session and kick off the first interview turn.
  if (method === 'POST' && url === '/api/architect/start') {
    try {
      const body = (await ctx.readBody()) as { project?: string; idea?: string; projectRepoPath?: string; modelTier?: unknown; costCeilingUsd?: unknown };
      if (!body.project || !body.idea) {
        sendJson(res, 400, { error: 'project and idea are required' }, origin);
        return true;
      }
      // W7-B6 (projects-15 / crosscut-21): the most expensive kickoff used to
      // accept ANY project string — a typo created a phantom project dir AND
      // spawned a real agent turn against it. Roster check BEFORE anything.
      const unknownReason = unknownProjectReason(ctx, body.project);
      if (unknownReason !== null) {
        sendJson(res, 404, { error: unknownReason }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/writeFileSync/status
      // write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = rejectStartProjectRepoPath(body, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot }, ctx.isContainedProjectRepoPath);
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // architect SKILL.md envelope. See resolveKickoffModelTier's header.
      const modelTierResult = resolveKickoffModelTier('architect', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // W7-B6 (projects-14 / sessions-kinds-03): an operator cost ceiling for
      // the whole architect session — same validation envelope as the agent
      // dispatch route; enforced by the runner at every turn start (a turn
      // that would START past the ceiling is refused with the reason in the
      // session's own error surface — never a silent overrun).
      let costCeilingUsd: number | undefined;
      if (body.costCeilingUsd !== undefined) {
        const v = body.costCeilingUsd;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return true;
        }
        costCeilingUsd = v;
      }
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+write: a traversal
      // `project` must create NOTHING out of root (the old code wrote
      // idea.md=body.idea to `<outside>/_architect/<sid>/`).
      const dirSegs = [body.project, '_architect', sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
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
      const status: ArchitectStatus = {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'interviewing',
        round: 1,
        idea: body.idea,
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
        ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
      };
      // SEC-04 (bd forge-ebj) — route both leaf writes (`idea.md`, `status.json`)
      // through the guard (leaf included) rather than raw-appending onto the
      // contained dir; guardedWriteFile/guardedWriteStatus mkdir the parent and
      // refuse a symlinked/hardlinked leaf (⇒ null ⇒ 400, nothing written).
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'idea.md'], body.idea) === null ||
        guardedWriteStatus(ctx.projectsRoot, dirSegs, status) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, sessionId, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/start', sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/architect/answer {project, sessionId, answers} — append an
  // interview round and re-spawn a turn.
  if (method === 'POST' && url === '/api/architect/answer') {
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
      // SEC-04 — guard BEFORE the lockfile.lock (which would otherwise create
      // a `.lock` at an out-of-root traversed path) and before any read/write.
      const dirSegs = [body.project, '_architect', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      // R4-04 review finding: guard + serialize like applyPlanVerdict — the
      // interview→exploring→drafting turn is longer now, and an answer
      // landing mid-turn would yank a live session back to 'interviewing'
      // (a stray double-submit could previously do the same). The lock
      // serializes against the runner's own status writes; the phase guard
      // 409s anything that isn't actually waiting for answers.
      // The lock path sits in the already-contained dir; the status/answers
      // CONTENT reads+writes below go through the SEC-04 guarded leaf siblings
      // (leaf included) so a symlinked `status.json`/`answers.json` is refused.
      const statusPath = join(dir, 'status.json');
      let round = 0;
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lockfile.lock(statusPath, { retries: { retries: 5, minTimeout: 50 } });
      } catch {
        sendJson(res, 409, { error: 'session is busy — try again' }, origin);
        return true;
      }
      try {
        const status = guardedReadStatus(ctx.projectsRoot, dirSegs);
        if (!status) {
          sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
          return true;
        }
        if (status.phase !== 'awaiting-answers') {
          sendJson(res, 409, { error: `session is not awaiting answers (phase: ${status.phase})` }, origin);
          return true;
        }
        const priorRaw = guardedReadFile(ctx.projectsRoot, [...dirSegs, 'answers.json']);
        const prior = (priorRaw !== null ? ctx.safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
        round = prior.length + 1;
        if (
          guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: body.answers }], null, 2)) === null ||
          guardedWriteStatus(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
        ) {
          sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
          return true;
        }
      } finally {
        if (release) await release().catch(() => {});
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, body.sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, round, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/answer', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/architect/rerun {project, sessionId} — StuckWarning's one-click
  // re-run affordance (R4-11-T5). Re-invokes the EXISTING session's turn
  // as-is: unlike /api/architect/answer, no round is appended and no
  // answers.json write happens — the runner re-reads status.json fresh at
  // turn start and resumes wherever it left off, so there's nothing to
  // rewrite here beyond confirming the session exists before spawning.
  if (method === 'POST' && url === '/api/architect/rerun') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      // SEC-04 — guard the request-derived session dir before resolving/reading
      // it: a traversal `project` must not resolve to an out-of-root session,
      // and the status.json READ goes through the guarded leaf sibling so a
      // symlinked status leaf inside a real dir is refused, not followed.
      const dirSegs = [body.project, '_architect', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadStatus(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, body.sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/rerun', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  return false;
}
