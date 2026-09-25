/**
 * bridge-review-comments — the review-comment sidecar + verdict routes on
 * the bridge (S7 / DEC-5, M2-C).
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change).
 *
 *   GET  /api/review-comments/<cycleId>         → { ...sidecar, derivedVerdict }
 *   POST /api/review-comments/<cycleId>         → append a comment
 *   POST /api/review-comments/<cycleId>/edit    → edit an authored comment
 *   POST /api/review-comments/<cycleId>/delete  → delete an authored comment
 *   POST /api/review-comments/<cycleId>/resolve → mark one resolved
 *   POST /api/verdict                           → the M2-C intervention
 *                                                  surface, delegates to
 *                                                  `applyReviewVerdict`
 *
 * The comment store is platform code (`@forge/flows/review-comments.ts`), so
 * these routes answer with or without the example factory installed. `ctx`
 * is the SAME `StudioPostContext` `handleHttp` already builds for
 * `handleStudioPostRoutes` and `applyReviewVerdict` — passed through
 * verbatim rather than re-declared, since `/api/verdict` needs it exactly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';

import { sendJson, allowedOrigin, sanitizeError } from '@forge/kernel';
import * as rc from '@forge/flows/review-comments.ts';
import { isSafeCycleId } from '@forge/flows/manifest-path-guard.ts';
import { applyReviewVerdict, type StudioPostContext } from '@forge/flows/bridge-studio-runs.ts';

/** True when `v` is a `{given, when, then}` shape (all string fields present). */
function isAcShape(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.given === 'string' && typeof o.when === 'string' && typeof o.then === 'string';
}

/**
 * Atomically read-modify-write the review-comment sidecar for a cycle under a
 * proper-lockfile guard (mirrors applyReviewVerdict). The sidecar file is
 * created empty first so the lock has a target even on the first comment.
 * `mutate` is a pure transform; the write persists its result.
 */
async function withReviewCommentLock(
  logsRoot: string,
  cycleId: string,
  mutate: (sidecar: rc.ReviewCommentsSidecar) => rc.ReviewCommentsSidecar,
): Promise<rc.ReviewCommentsSidecar> {
  // Ensure the sidecar exists so proper-lockfile has a target (rc.writeReviewComments
  // throws on a traversal cycleId — that propagates as a 500, never a write).
  if (!existsSync(rc.reviewCommentsPath(logsRoot, cycleId))) {
    rc.writeReviewComments(logsRoot, cycleId, { cycleId, comments: [] });
  }
  const release = await lockfile.lock(rc.reviewCommentsPath(logsRoot, cycleId), { retries: { retries: 5, minTimeout: 50 } });
  try {
    const next = mutate(rc.readReviewComments(logsRoot, cycleId));
    rc.writeReviewComments(logsRoot, cycleId, next);
    return next;
  } finally {
    try { await release(); } catch { /* ignore */ }
  }
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
 * The review-comments + verdict family. Dispatched from `handleHttp` after
 * the run-trigger routes and before the final 404 fallback — same position
 * the arms held inline. Returns `false` on no match.
 */
export async function handleReviewCommentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioPostContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // Review-comment sidecar (S7 / DEC-5) — the visual review page's anchored
  // comments. GET reads them + the derived verdict; POST appends one; POST
  // .../resolve marks one resolved. Writes are proper-lockfile guarded (the
  // read-modify-write is atomic per cycle). Verdict derivation is over the set:
  // any blocking, unresolved comment ⇒ send-back; else ⇒ approve.
  // The store is platform code (`@forge/flows/review-comments.ts`), so these
  // routes answer with or without the example — this stopped being its surface.
  if (method === 'GET' && url.startsWith('/api/review-comments/')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length));
    if (!cycleId || !isSafeCycleId(cycleId)) { sendJson(res, 400, { error: 'expected /api/review-comments/<cycleId>' }, origin); return true; }
    const sidecar = rc.readReviewComments(ctx.logsRoot, cycleId);
    sendJson(res, 200, { ...sidecar, derivedVerdict: rc.deriveVerdictFromComments(sidecar.comments) }, origin);
    return true;
  }
  // W7-B7 (artifact-plan-15): edit + delete for authored comments. A
  // non-blocking comment has no resolve affordance, so delete is the only way
  // to clear it; edit fixes a typo'd concern without losing its anchor id.
  // Same lock + derive-on-every-mutate shape as append/resolve.
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/edit')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/edit'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return true; }
      const patchBody = typeof body['body'] === 'string' ? body['body'].trim() : undefined;
      const patchBlocking = typeof body['blocking'] === 'boolean' ? body['blocking'] : undefined;
      if (patchBody === '') { sendJson(res, 400, { error: 'body must be non-empty when provided' }, origin); return true; }
      if (patchBody === undefined && patchBlocking === undefined) { sendJson(res, 400, { error: 'nothing to edit — provide body and/or blocking' }, origin); return true; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) =>
        rc.editComment(sidecar, commentId, { body: patchBody, blocking: patchBlocking }),
      );
      sendJson(res, 200, { ...result, derivedVerdict: rc.deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/delete')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/delete'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return true; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) => rc.deleteComment(sidecar, commentId));
      sendJson(res, 200, { ...result, derivedVerdict: rc.deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/resolve')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/resolve'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return true; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) => rc.resolveComment(sidecar, commentId));
      sendJson(res, 200, { ...result, derivedVerdict: rc.deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const region = typeof body['region'] === 'string' ? body['region'].trim() : '';
      const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !region || !text) { sendJson(res, 400, { error: 'cycleId, region, body required' }, origin); return true; }
      if (rc.readReviewComments(ctx.logsRoot, cycleId).comments.length >= rc.REVIEW_COMMENTS_MAX) {
        sendJson(res, 409, { error: `review-comment cap reached (${rc.REVIEW_COMMENTS_MAX}) for this cycle` }, origin);
        return true;
      }
      const ac = isAcShape(body['ac']) ? (body['ac'] as { given: string; when: string; then: string }) : undefined;
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) =>
        rc.appendReviewComment(sidecar, { region, body: text, blocking: Boolean(body['blocking']), ac }),
      );
      sendJson(res, 200, {
        ...result,
        comment: result.comments[result.comments.length - 1],
        derivedVerdict: rc.deriveVerdictFromComments(result.comments),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // Review verdict — the M2-C intervention surface. Delegates to applyReviewVerdict.
  if (method === 'POST' && url === '/api/verdict') {
    try {
      const body = await readJson(req);
      const b = body as Record<string, unknown>;
      await applyReviewVerdict(req, res, ctx, {
        initiativeId: typeof b['initiativeId'] === 'string' ? b['initiativeId'] : '',
        kind: (b['kind'] as 'approve' | 'send-back') ?? 'send-back',
        rationale: typeof b['rationale'] === 'string' ? b['rationale'] : '',
        acceptanceCriteria: Array.isArray(b['acceptanceCriteria'])
          ? (b['acceptanceCriteria'] as Array<{ given: string; when: string; then: string }>)
          : undefined,
        concernKind: b['concernKind'] as 'packaging' | 'code-fix' | undefined,
        qualityGateCmd: Array.isArray(b['qualityGateCmd']) ? (b['qualityGateCmd'] as string[]) : undefined,
      });
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
