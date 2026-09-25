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
 *   GET  /api/reflect/<cycleId>         → { questions, answered, mode? }
 *   POST /api/reflect/<cycleId>/answer  → write user-feedback.md, fire the
 *                                          reflector rerun (detached)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { sendJson, allowedOrigin } from '@forge/kernel';
import { isDryBridge, dryBridgeAgentTurnMarker } from '@forge/kernel';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { fireReflectorRerun } from './example-hooks.ts';
import type { InstalledFactory } from './factory-wiring.ts';

type RerunReflectorFn = InstalledFactory['rerunReflector'];

/** The context the reflection routes need from the host. */
export type ReflectContext = {
  logsRoot: string;
  queueRoot: string;
  /** D — re-run the reflector on operator feedback. Injectable; defaults to the real helper. */
  rerunReflector: RerunReflectorFn;
};

/** Parse an already-read JSON string; null on malformed content. Companion to
 *  the guarded read primitives (which return raw contents, not parsed JSON) so
 *  a SEC-04 guarded read can replace a `readJsonFile(join(dir, leaf))` call
 *  without re-following the leaf: the guard read the bytes, this parses them.
 *  Exported: `startBridge` (ui-bridge.ts) imports it back to wire into
 *  `makeRouteTable`'s deps, which `handleReflect` also called this file. */
export function safeParseJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB, mirrors ui-bridge.ts's own readJson

/** Private per-module copy — mirrors `readJson` in `ui-bridge.ts` (same
 *  sibling-copy convention `apps/forge/bridge-studio.ts` already uses). */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
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

  if (method === 'GET' && url.startsWith('/api/reflect/') && !url.endsWith('/answer')) {
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length));
    if (!cycleId) { sendJson(res, 400, { error: 'expected /api/reflect/<cycleId>' }, origin); return true; }
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
    const questions = questionsRaw !== null ? (safeParseJson<unknown[]>(questionsRaw) ?? []) : [];
    const answered = guardedFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], 'read') !== null;
    // R4-09-F3: the durable reflect mode (REFLECT_MODE_FILE) — the authoritative
    // signal the UI uses to render the automated read-only view, independent of
    // per-question inferred-marker compliance.
    const modeRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'reflect-mode.json']);
    const modeDoc = modeRaw !== null ? safeParseJson<{ mode?: string }>(modeRaw) : null;
    const mode = modeDoc?.mode === 'automated' ? 'automated' : modeDoc?.mode === 'interactive' ? 'interactive' : undefined;
    sendJson(res, 200, { cycleId, questions, answered, ...(mode ? { mode } : {}) }, origin);
    return true;
  }

  if (method === 'POST' && url.startsWith('/api/reflect/') && url.endsWith('/answer')) {
    // R5-01-F1 (task A-finalfix FIX 1): reflect-answer is `stub-actions`, not
    // `refuse` — it does two things, writing user-feedback.md (bookkeeping)
    // and detached-firing rerunReflector (the real agent turn). Only the
    // latter is dry-bridge-gated below; the write always proceeds so the
    // route's normal 200 stays truthful ("feedback captured").
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length, url.length - '/answer'.length));
    try {
      const body = (await readJson(req)) as { answers?: { question: string; answer: string }[]; freeform?: string };
      // SEC-04 (bd forge-ebj) — the WRITE twin of the reflect GET read. cycleId
      // was folded raw into `join(logsRoot, cycleId)` and `user-feedback.md`
      // raw-appended: a `%2F`-smuggled `../..` cycleId overwrote an out-of-root
      // user-feedback.md, and a symlinked leaf was followed. Gate the cycleId
      // (its OWN segment under the trusted logsRoot) first — reject a
      // traversed/symlinked dir (400, no write) and keep the "cycle not found"
      // 404 for a genuinely absent in-root cycle.
      const dirGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
      if (!dirGuard.ok) { sendJson(res, 400, { error: 'invalid cycleId', cycleId }, origin); return true; }
      if (!dirGuard.exists) { sendJson(res, 404, { error: 'cycle not found', cycleId }, origin); return true; }
      const dir = dirGuard.realPath;
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
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}
