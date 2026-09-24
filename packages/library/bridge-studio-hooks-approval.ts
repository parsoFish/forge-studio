/**
 * Forge Studio hooks-library bridge routes — approval-lifecycle WRITES
 * (R3-03-F4, carved out of `bridge-studio-hooks.ts` by forge-8vfn.5.39,
 * which sat AT the 800-line cap with zero headroom).
 *
 *   POST /api/studio/hooks/:id/approve         → approve (refuses "blocked", D-7)
 *   POST /api/studio/hooks/:id/override        → distinct recorded override
 *   POST /api/studio/hooks/:id/revoke-approval  → drop a live approval (W7-B4, library-08)
 *
 * The shared contract decisions (D-1..D-7), the id-resolution/containment
 * discipline, and the transport shape live in `bridge-studio-hooks.ts`'s own
 * header — that file stays this category's spec. `decodeIdSegment` and
 * `locateHook` are IMPORTED from there (exported for exactly this reuse,
 * the same precedent `bridge-studio-hooks-decline.ts` already set) rather
 * than duplicated, so id resolution/containment stays the ONE place it has
 * always been.
 *
 * Approve and override now go through `locateHook(forgeRoot, id)` (default
 * `requireScript: true`) instead of the hand-rolled two-guard sequence
 * (hookYamlPath shape-check → yamlGuard existence → hookScriptIsContained)
 * each used to repeat inline — byte-for-byte the same checks in the same
 * order, returning the same 400/404 shape `locateHook` already returns, so
 * this is a dedup, not a behaviour change; it is also what keeps
 * `hookScriptIsContained` module-local to `bridge-studio-hooks.ts` (the
 * "WI's zero-new-exports bound" its own doc comment records) rather than
 * growing a THIRD file's worth of surface for a function with exactly one
 * caller.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext, type RouteContext } from '@forge/kernel';
import { decodeIdSegment, locateHook } from './bridge-studio-hooks.ts';
import {
  hookRunState,
  readHookApprovalLedger,
  approveHook,
  overrideHookBlock,
  revokeHookApproval,
} from './studio/hook-approval-ledger.ts';

export const HOOK_APPROVE_RE = /^\/api\/studio\/hooks\/([^/]+)\/approve$/;
export const HOOK_OVERRIDE_RE = /^\/api\/studio\/hooks\/([^/]+)\/override$/;
export const HOOK_REVOKE_RE = /^\/api\/studio\/hooks\/([^/]+)\/revoke-approval$/;

/** POST /api/studio/hooks/:id/approve — refuses a blocked verdict (D-7). */
export async function handleHookApprove(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const approveMatch = url.match(HOOK_APPROVE_RE);
  if (approveMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(approveMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }

      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      const runState = hookRunState(ctx.forgeRoot, id);
      if (runState.verdict === 'blocked') {
        sendJson(res, 409, {
          error: `hook "${id}" scan verdict is "blocked" — approve refuses a blocked hook; use override instead`,
        }, origin);
        return true;
      }

      approveHook({ forgeRoot: ctx.forgeRoot, id });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/** POST /api/studio/hooks/:id/override — distinct recorded act. */
export async function handleHookOverride(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const overrideMatch = url.match(HOOK_OVERRIDE_RE);
  if (overrideMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(overrideMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }

      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      const reason = typeof b['reason'] === 'string' ? b['reason'] : '';
      if (!reason.trim()) {
        sendJson(res, 400, { error: 'a non-empty reason is required — the override must be explainable, not silent' }, origin);
        return true;
      }

      overrideHookBlock({ forgeRoot: ctx.forgeRoot, id, reason });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * POST /api/studio/hooks/:id/revoke-approval (W7-B4, library-08).
 *
 * The inverse of approve/override that never existed: drops the LIVE ledger
 * entry (hookRunState honestly reads needs-review again) and RECORDS the
 * revocation in the ledger's `revoked` list. 409 when nothing is approved.
 */
export async function handleHookRevokeApproval(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const revokeMatch = url.match(HOOK_REVOKE_RE);
  if (revokeMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(revokeMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      if (!readHookApprovalLedger(ctx.forgeRoot).get(id)) {
        sendJson(res, 409, { error: `hook "${id}" has no approval on record — nothing to revoke` }, origin);
        return true;
      }
      revokeHookApproval({ forgeRoot: ctx.forgeRoot, id });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
