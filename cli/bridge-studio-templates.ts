/**
 * Forge Studio templates-library bridge routes (R3-06, WI-3).
 *
 * Owns EVERY `/api/studio/templates*` route:
 *
 *   GET /api/studio/templates      → { templates: TemplateLibraryEntry[] }
 *   GET /api/studio/templates/:id  → TemplateDetail (404 unknown id, 400 malformed id)
 *
 * Mirrors bridge-studio-skills.ts's contract exactly: a single
 * `handleStudioTemplatesRoutes(req, res, ctx, rawUrl, method): Promise<boolean>`,
 * a linear if-chain, an exact-string compare for the collection route and a
 * `match()` regex for the id route, returning `false` on fallthrough. These
 * are READ-ONLY routes — the template library (orchestrator/studio/template-library.ts)
 * has no write path, so no POST/PUT/DELETE belongs here.
 *
 * Every id is slug-validated (SLUG_RE, orchestrator/studio/validate.ts) BEFORE
 * it ever reaches `templateDetail`. `templateDetail` itself resolves an id by
 * plain string equality against `listTemplateLibrary`'s ids — an unvalidated
 * `../../etc/passwd`-shaped id would merely fail to match (a 404, silently
 * treating a traversal attempt as "not found"), not fail LOUD as the malformed
 * input it actually is. The guard here rejects it with 400 before that lookup
 * ever runs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from './bridge-studio.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { listTemplateLibrary, templateDetail } from '../orchestrator/studio/template-library.ts';

/** Hard cap on a template id's length — mirrors `MAX_SKILL_ID_LENGTH`
 *  (orchestrator/skill-path.ts): without it, a charset-valid but absurdly long
 *  id sails past SLUG_RE and only dies later as an opaque fs error instead of
 *  an actionable 400. No real template-library entry is remotely close to
 *  this length. */
const MAX_TEMPLATE_ID_LENGTH = 100;

/** Decode a URL path segment; throws (never silently passes through a raw,
 *  still-encoded id) on malformed percent-encoding — mirrors
 *  bridge-studio-skills.ts's `decodeIdSegment`. */
function decodeIdSegment(raw: string): string {
  return decodeURIComponent(raw);
}

/** Returns an error message when `id` is not a bare lowercase-kebab slug (no
 *  `/`, `\`, `.`, `..`, uppercase, whitespace, or over-length id can pass),
 *  or `null` when it is valid. Never throws — the caller reports the message
 *  as a 400. */
function invalidTemplateIdReason(id: string): string | null {
  if (id.length > MAX_TEMPLATE_ID_LENGTH) {
    return `invalid template id "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_TEMPLATE_ID_LENGTH}-character length limit`;
  }
  if (!SLUG_RE.test(id)) {
    return `invalid template id "${id}" — must match ${SLUG_RE} (a single lowercase-kebab path segment; no "/", "\\", ".", or "..")`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response shaping — a malformed on-disk definition surfaces on its entry as
// `error` text that embeds the absolute path it failed to read (D7,
// template-library.ts's listPlanningEntries/listDemoOutputEntries catch
// arms). House rule: no absolute host path leaked to the browser, even on a
// 200. Sanitized here, at the one place responses leave the process — mirrors
// bridge-studio-skills.ts's `toClientEntry`.
// ---------------------------------------------------------------------------

function toClientEntry<T extends { error?: string }>(entry: T): T {
  return entry.error ? { ...entry, error: sanitizeError(entry.error) } : entry;
}

export async function handleStudioTemplatesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/templates — the library listing ---------------------
  if (url === '/api/studio/templates') {
    try {
      const templates = listTemplateLibrary(ctx.forgeRoot).map((e) => toClientEntry(e));
      sendJson(res, 200, { templates }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/templates/:id — detail -------------------------------
  const detailMatch = url.match(/^\/api\/studio\/templates\/([^/]+)$/);
  if (detailMatch) {
    try {
      let id: string;
      try {
        id = decodeIdSegment(detailMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'invalid template id — malformed URL encoding' }, origin);
        return true;
      }

      const invalidReason = invalidTemplateIdReason(id);
      if (invalidReason) {
        sendJson(res, 400, { error: invalidReason }, origin);
        return true;
      }

      const detail = templateDetail(ctx.forgeRoot, id);
      if (!detail) {
        sendJson(res, 404, { error: `unknown template "${id}"` }, origin);
        return true;
      }

      sendJson(res, 200, toClientEntry(detail), origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
