/**
 * bridge-reflect — the reflection routes on the bridge (the third human
 * moment, in-UI).
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change).
 *
 * The reflector emits `_logs/<cycleId>/user-questions.json`
 * (StructuredQuestion[]) as its Stage-2 file handoff; the operator's answers
 * land in `user-feedback.md`. The /reflect/<cycleId> page renders the
 * questions and POSTs the answers here — converting the old reflect slash
 * command into an in-UI page, consistent with the in-UI architect + review
 * moments.
 *
 *   GET  /api/reflect/<cycleId>         → { questions, answered, filed, unreadable?, mode? }
 *   POST /api/reflect/<cycleId>/answer  → write user-feedback.md, fire the
 *                                          reflector rerun (detached)
 *        body { close: true }            → forge-nk1y.3: close an interactive
 *                                          reflection that asked nothing — writes
 *                                          reflection-closed.json, no rerun;
 *                                          anything else is a named 409
 *   GET  /api/reflections/pending       → { pending } — reflections waiting
 *                                          on the operator (reflection-pending.ts)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, decodeUrlPart } from '@forge/kernel';
import { isDryBridge, dryBridgeAgentTurnMarker } from '@forge/kernel';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedWriteFile, guardedWriteFileExclusive } from '@forge/kernel';
import { fireReflectorRerun } from './example-hooks.ts';
import type { InstalledFactory } from './factory-wiring.ts';
import { readJson } from './bridge-http.ts';
import { findRun } from './bridge-studio.ts';
import { listPendingReflections, REFLECTION_CLOSED_FILE } from './reflection-pending.ts';

type RerunReflectorFn = InstalledFactory['rerunReflector'];

/** The context the reflection routes need from the host. */
export type ReflectContext = {
  logsRoot: string;
  queueRoot: string;
  /** ruling 1736 (bead forge-8vfn.8.1.34) — needed by `findRun`'s resolution below. */
  forgeRoot: string;
  /** D — re-run the reflector on operator feedback. Injectable; defaults to the real helper. */
  rerunReflector: RerunReflectorFn;
};

/**
 * Ruling 1736 / bead forge-8vfn.8.1.34. A run's id CHANGES on claim (planned:
 * initiativeId, claimed: cycleId — W7-A3, bridge-studio.ts:273-279), and this
 * route family is keyed on whatever id the operator's browser is standing on,
 * which for a DONE run can be either one. `_logs/` is keyed by cycleId only,
 * so an initiativeId request used to read a directory that never existed and
 * got back `{ questions: [] }` — the exact shape that made S10 proof run 36's
 * beat 21 find no `submit-reflection` control at all.
 *
 * THE CHAIN IS EXPLICIT, and returning `null` on the third step is load
 * bearing: this function names what it KNOWS, never what it guesses.
 *   1. `id` names an existing `_logs/<id>/` dir — that IS the cycle (cheap:
 *      one guard call, no queue walk — the shape every existing caller
 *      already relies on, including this file's own fixture tests, which
 *      write straight to a literal `_logs/<id>/` with no queue manifest
 *      behind it at all).
 *   2. Otherwise, `findRun` (bridge-studio.ts) — the SAME lookup `/api/runs/
 *      <id>` already uses, never a second heuristic, no glob, no
 *      timestamp-prefix guess, so the two routes cannot disagree about what
 *      an id means.
 *   3. Otherwise, `null` — an id this function cannot vouch for. Each CALLER
 *      decides what that means for its own route, rather than this function
 *      silently handing back the unverified literal as though it had been
 *      resolved (bought by a review finding: an earlier draft returned
 *      `findRun(...)?.id ?? id`, which let a bogus id flow into the POST
 *      route's rerun trigger as if it named a real cycle).
 */
function resolveCycleId(ctx: ReflectContext, id: string): string | null {
  const literal = resolveGuardedPath(ctx.logsRoot, [id]);
  if (literal.ok && literal.exists) return id;
  const run = findRun(ctx.forgeRoot, id);
  return run !== null ? run.id : null;
}

/** Parse an already-read JSON string; null on malformed content. Companion to
 *  the guarded read primitives (which return raw contents, not parsed JSON) so
 *  a SEC-04 guarded read can replace a `readJsonFile(join(dir, leaf))` call
 *  without re-following the leaf: the guard read the bytes, this parses them.
 *  Exported: `startBridge` (ui-bridge.ts) imports it back to wire into
 *  `makeRouteTable`'s deps, which `handleReflect` also called this file. */
export function safeParseJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * The reflection route family. Dispatched from `handleHttp` right after the
 * architect route and before the recovery/studio routes — same position the
 * arms held inline. Returns `false` on no match.
 */
export async function handleReflect(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ReflectContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // forge-nk1y.3 — Studio's Waiting on you reads this; derived per request.
  if (method === 'GET' && url === '/api/reflections/pending') {
    try {
      sendJson(res, 200, { pending: listPendingReflections(ctx.logsRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  if (method === 'GET' && url.startsWith('/api/reflect/') && !url.endsWith('/answer')) {
    const requestedCycleId = decodeUrlPart(url.slice('/api/reflect/'.length));
    if (!requestedCycleId) {
      sendJson(res, 400, { error: 'expected /api/reflect/<cycleId>' }, origin);
      return true;
    }
    // SEC-04 first: an unsafe request segment is a 400 with no read, before any
    // resolution is attempted.
    const requestGuard = resolveGuardedPath(ctx.logsRoot, [requestedCycleId]);
    if (!requestGuard.ok) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return true;
    }
    // Ruling 1736 (bead forge-8vfn.8.1.34) — an initiativeId for a DONE run
    // reads its real `_logs/<cycleId>/`, never a directory that does not exist.
    // An id nothing resolves to is a 404, never a 200 with an empty question
    // list: that empty answer is what hid S10 run 36's missing reflect form.
    // `fetchReflection` (apps/studio) already reads this route through
    // `bridgeReadOr404`.
    const cycleId = resolveCycleId(ctx, requestedCycleId);
    if (cycleId === null) {
      sendJson(res, 404, { error: 'cycle not found', cycleId: requestedCycleId }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — cycleId was folded raw into `join(logsRoot,
    // cycleId)` and each leaf raw-appended: a `%2F`-smuggled `../..` cycleId
    // disclosed an out-of-root user-questions.json, and a symlinked leaf inside
    // a real cycle dir was followed. Gate the request-derived cycleId (its OWN
    // segment under the trusted logsRoot) through the per-segment identity
    // guard first — a traversed/symlinked cycle dir is a 400 with NO read —
    // then route every leaf read through the guard too (leaf-symlink close).
    const reflectCycleGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
    if (!reflectCycleGuard.ok) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return true;
    }
    const questionsRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'user-questions.json']);
    const parsedQuestions = questionsRaw !== null ? safeParseJson<unknown>(questionsRaw) : null;
    // forge-nk1y.3: a filed list that does not parse is named, never passed
    // off as "asked nothing" (the gate would offer a close that cannot succeed).
    const unreadable = questionsRaw !== null && !Array.isArray(parsedQuestions);
    const questions = Array.isArray(parsedQuestions) ? parsedQuestions : [];
    // A reflection closed with no questions (reflection-closed.json) reads as
    // answered: the gate shows it done.
    const answered = guardedFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], 'read') !== null
      || guardedFile(ctx.logsRoot, [cycleId, REFLECTION_CLOSED_FILE], 'read') !== null;
    // R4-09-F3: the durable reflect mode (REFLECT_MODE_FILE) — the authoritative
    // signal the UI uses to render the automated read-only view, independent of
    // per-question inferred-marker compliance.
    const modeRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'reflect-mode.json']);
    const modeDoc = modeRaw !== null ? safeParseJson<{ mode?: string }>(modeRaw) : null;
    const mode = modeDoc?.mode === 'automated' ? 'automated' : modeDoc?.mode === 'interactive' ? 'interactive' : undefined;
    // The response echoes the id the CLIENT asked with, never the resolved
    // one — the same convention `/api/runs/<id>/phases/.../log`'s 404 uses
    // (bridge-studio.ts) — so a caller comparing against its own request sees
    // no surprise substitution.
    // forge-nk1y.3: `filed` separates "the reflector has not filed its
    // questions yet" (still running) from "it filed none" (asked nothing —
    // the gate offers the one close act).
    const filed = questionsRaw !== null;
    sendJson(res, 200, { cycleId: requestedCycleId, questions, answered, filed, ...(unreadable ? { unreadable } : {}), ...(mode ? { mode } : {}) }, origin);
    return true;
  }

  if (method === 'POST' && url.startsWith('/api/reflect/') && url.endsWith('/answer')) {
    // R5-01-F1 (task A-finalfix FIX 1): reflect-answer is `stub-actions`, not
    // `refuse` — it does two things, writing user-feedback.md (bookkeeping)
    // and detached-firing rerunReflector (the real agent turn). Only the
    // latter is dry-bridge-gated below; the write always proceeds so the
    // route's normal 200 stays truthful ("feedback captured").
    const requestedCycleId = decodeUrlPart(url.slice('/api/reflect/'.length, url.length - '/answer'.length));
    try {
      const body = (await readJson(req)) as { answers?: { question: string; answer: string }[]; freeform?: string; close?: boolean };
      // Ruling 1736 (bead forge-8vfn.8.1.34) — same resolution as the GET
      // route above, and load-bearing here in a second way: `fireReflectorRerun`
      // below needs the REAL `_logs/<cycleId>/` dir name, not the initiativeId
      // — `reflector-rerun.ts`'s own resolution only recovers an initiativeId
      // FROM a cycleId, never the other way round, so a write under the wrong
      // id would strand the feedback where the rerun can never find it.
      //
      // UNLIKE GET, an unresolved id here reports "cycle not found" directly —
      // never `requestedCycleId` treated as though it were a real cycle dir.
      // This route WRITES and fires a detached rerun; substituting a borrowed
      // literal for either would be a silent action against the wrong id
      // (or, for the rerun, no id at all), not a safe empty read.
      const resolvedCycleId = resolveCycleId(ctx, requestedCycleId);
      if (resolvedCycleId === null) {
        sendJson(res, 404, { error: 'cycle not found', cycleId: requestedCycleId }, origin);
        return true;
      }
      const cycleId = resolvedCycleId;
      // SEC-04 (bd forge-ebj) — the WRITE twin of the reflect GET read. cycleId
      // was folded raw into `join(logsRoot, cycleId)` and `user-feedback.md`
      // raw-appended: a `%2F`-smuggled `../..` cycleId overwrote an out-of-root
      // user-feedback.md, and a symlinked leaf was followed. Gate the cycleId
      // (its OWN segment under the trusted logsRoot) first — reject a
      // traversed/symlinked dir (400, no write) and keep the "cycle not found"
      // 404 for a genuinely absent in-root cycle.
      const dirGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
      if (!dirGuard.ok) {
        sendJson(res, 400, { error: 'invalid cycleId', cycleId: requestedCycleId }, origin);
        return true;
      }
      if (!dirGuard.exists) {
        sendJson(res, 404, { error: 'cycle not found', cycleId: requestedCycleId }, origin);
        return true;
      }
      const dir = dirGuard.realPath;
      if (body.close === true) {
        // forge-nk1y.3 — the one close act for an INTERACTIVE reflection that
        // asked nothing. Recorded in its own file, never user-feedback.md: the
        // boot reconcile re-runs the reflector for fresh feedback, and a close
        // is not feedback (no agent turn is spent on it). Every other case is
        // refused by name.
        const refuse = (error: string): true => {
          sendJson(res, 409, { error, cycleId: requestedCycleId }, origin);
          return true;
        };
        const modeRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'reflect-mode.json']);
        if (safeParseJson<{ mode?: string }>(modeRaw ?? '')?.mode !== 'interactive') {
          return refuse('close refused: not an interactive reflection');
        }
        if (guardedFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], 'read') !== null) {
          return refuse('close refused: the reflection is already answered');
        }
        const questionsRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'user-questions.json']);
        const questions = questionsRaw !== null ? safeParseJson<unknown>(questionsRaw) : null;
        if (!Array.isArray(questions)) {
          return refuse('close refused: the reflection has no readable question list');
        }
        if (questions.length > 0) {
          return refuse(`close refused: ${questions.length} questions unanswered`);
        }
        const record = JSON.stringify({ closedAt: new Date().toISOString(), reason: 'no-questions' });
        let written: string | null;
        try {
          written = guardedWriteFileExclusive(ctx.logsRoot, [cycleId, REFLECTION_CLOSED_FILE], record);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') return refuse('close refused: the reflection is already closed');
          throw err;
        }
        if (written === null) {
          sendJson(res, 400, { error: 'invalid cycle path', cycleId }, origin);
          return true;
        }
        sendJson(res, 200, { ok: true, closed: true }, origin);
        return true;
      }
      const lines = [`# Reflection feedback — ${cycleId}`, '', '## Answers to numbered questions', ''];
      for (const a of body.answers ?? []) {
        lines.push(`### ${a.question}`, '', a.answer || '_(skipped)_', '');
      }
      lines.push('## Free-form feedback', '', (body.freeform ?? '').trim() || '_(none)_', '');
      // Route the leaf through the guard too: a symlinked user-feedback.md
      // inside the (now identity-verified) real cycle dir is refused, never
      // followed out of root. A rejected leaf writes NOTHING (fail closed).
      if (guardedWriteFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], lines.join('\n')) === null) {
        sendJson(res, 400, { error: 'invalid cycle path', cycleId }, origin);
        return true;
      }
      const dryMarker = dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/reflect/:cycleId/answer', cycleId);
      sendJson(res, 200, { ok: true, ...dryMarker }, origin);
      if (!isDryBridge()) {
        // D — auto-rerun the reflector so the feedback is distilled into retro.md +
        // brain themes. Detached (don't block the HTTP response on a full reflector
        // pass), but observable: fired, skipped or failed, it emits into the cycle's
        // events.jsonl (not console), so a lost rerun is visible and the startup
        // reconcile can recover it. The UI owns reflection without the CLI.
        //
        // Absence of the example, and a synchronous throw from the rerun, are both
        // `example-hooks.ts`'s to handle — its header carries the measured incident.
        fireReflectorRerun({
          rerunReflector: ctx.rerunReflector,
          cycleId,
          logsRoot: ctx.logsRoot,
          queueRoot: ctx.queueRoot,
          feedbackPath: join(dir, 'user-feedback.md'),
        });
      }
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
