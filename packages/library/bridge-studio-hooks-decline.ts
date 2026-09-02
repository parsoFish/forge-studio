/**
 * POST /api/studio/hooks/:id/decline (bead forge-8vfn.5.2).
 *
 * The THIRD review-outcome route, alongside `bridge-studio-hooks.ts`'s
 * approve/override/revoke-approval arms — but living in its OWN file rather
 * than joining them there: `bridge-studio-hooks.ts` sits AT the repo's
 * 800-line hard cap (`scripts/check-file-size.mjs`) with no headroom left
 * for a whole new route. This is the SAME residue-carve precedent
 * `bridge-studio-community-crud.ts` already set for one category split
 * across two files (see that module's own header) — the route table
 * (`routes.ts`) is what makes the two files one logical surface again.
 *
 * `decodeIdSegment`/`locateHook` are IMPORTED from bridge-studio-hooks.ts
 * (exported there for exactly this reuse) rather than duplicated, so id
 * resolution/containment stays the ONE place it has always been.
 *
 * Records a `declined` ledger entry (`declineHook`, hook-approval-ledger.ts)
 * — a review OUTCOME, not an approval. It grants nothing: `hookRunState`
 * never consults the declined ledger, so a declined hook is exactly as
 * un-runnable as a never-reviewed one; only its `trust` LABEL changes (from
 * 'needs-review' to 'declined', computeTrust in bridge-studio-hooks.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type RouteContext } from '@forge/kernel';
import { declineHook } from './studio/hook-approval-ledger.ts';
import { decodeIdSegment, locateHook } from './bridge-studio-hooks.ts';

export const HOOK_DECLINE_RE = /^\/api\/studio\/hooks\/([^/]+)\/decline$/;

/** POST /api/studio/hooks/:id/decline — reviewed and rejected. An optional
 *  `reason` in the body is the only field read; a malformed/absent body is
 *  treated as "no reason given", never a 400 (mirrors override's REQUIRED
 *  reason only in spirit — decline's reason is a nice-to-have, not a gate). */
export async function handleHookDecline(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const declineMatch = url.match(HOOK_DECLINE_RE);
  if (declineMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(declineMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      let body: unknown;
      try { body = await ctx.readBody(); } catch { body = undefined; }
      const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const reason = typeof b['reason'] === 'string' && b['reason'].trim() ? b['reason'].trim() : undefined;

      declineHook({ forgeRoot: ctx.forgeRoot, id, reason });
      sendJson(res, 200, { ok: true, id, trust: 'declined' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
