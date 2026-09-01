/**
 * POST /api/studio/agents/:slug/instructions-draft (R2-09 D8/D9).
 *
 * A sibling module to bridge-studio-writes.ts (that file is already past the
 * 800-line hard cap — see its header — so this route, which carries its own
 * substantial security section, lives here instead and is delegated from
 * cli/ui-bridge.ts, matching how bridge-studio-sessions.ts is delegated).
 *
 * Composes a deterministic instructions-draft charter from the CURRENT
 * (possibly unsaved) builder state carried in the request body — never from
 * the on-disk SKILL.md, never via an LLM call — and writes ABSOLUTELY
 * NOTHING to disk (D9). The on-disk SKILL.md is touched only to confirm the
 * agent exists; its bytes are never read into the response.
 *
 * Single route:
 *   POST /api/studio/agents/:slug/instructions-draft
 *     → { ok: true, draft: string, derivation: InstructionsDraftDerivation }
 *
 * Returns false for a non-matching URL/method so the caller can chain to the
 * next handler. Never throws — every error path is caught and returned as a
 * 4xx/5xx JSON body.
 *
 * Security — the SAME bar as the sibling PUT /api/studio/agents/:slug route
 * (cli/bridge-studio-writes.ts) — both routes resolve their SKILL.md path
 * through the ONE shared, generalized choke point, `resolveGuardedPath`
 * (cli/studio-path-guard.ts; generalized 2026-08-06, R2-09 WI-fix2, from the
 * SKILL.md-only `resolveGuardedSkillMdPath` this route originally called).
 * A prior lexical `startsWith(skillsDir + sep)` check on the unresolved path
 * was defeated live by a real symlink escape (verified BLOCKER) before the
 * first realpath-based fix; this paragraph describes the actual shared
 * implementation, not an aspiration:
 *   - `slug` is validated against the SAME `SLUG_RE` as the PUT route, before
 *     any fs call.
 *   - The SKILL.md path is resolved via `realpathSync` at the choke point
 *     (`resolveGuardedPath`), never a lexical `startsWith(dir+sep)` compare
 *     on the UNRESOLVED path — `join()`/`skillPath()` already normalizes
 *     `..` before a prefix check would even run, and a long repeated `../`
 *     chain can clamp past the filesystem root entirely. Both shapes are
 *     blocked upstream by `SLUG_RE` (a slug cannot contain `.` or `/`), and
 *     `realpathSync`-based per-segment identity is the second, independent
 *     layer in case that ever changes.
 *   - The escape session directory can be REAL while only the `SKILL.md`
 *     FILE inside it is a symlink pointing outside the forge root — a prior
 *     finding in this campaign was exactly this shape, and a fix that only
 *     re-checked the directory resolver left it open. `realpathSync` on the
 *     full candidate path resolves the FILE component too, closing that gap.
 *   - A missing agent and an escaping symlink are collapsed into the SAME
 *     404 "unknown agent" response — an attacker can never distinguish "no
 *     such slug" from "blocked escape" from the response shape.
 *   - The bridge's global anti-CSRF guard (`x-forge-csrf`, cli/ui-bridge.ts)
 *     fires before route dispatch for every non-GET path, so this route
 *     inherits it for free — confirmed empirically by
 *     cli/bridge-studio-instructions-draft.test.ts's CSRF-parity cases, not
 *     just assumed.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { SLUG_RE } from '../../orchestrator/studio/validate.ts';
import { composeInstructionsDraft } from './studio/instructions-draft.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { skillsDir } from './skill-path.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from '../../cli/bridge-studio.ts';

const INSTRUCTIONS_DRAFT_ROUTE_RE = /^\/api\/studio\/agents\/([^/]+)\/instructions-draft$/;

/**
 * Resolve `<forgeRoot>/skills/<slug>/SKILL.md` via the shared
 * `resolveGuardedPath` choke point (cli/studio-path-guard.ts).
 * Returns `null` for a missing file AND for an escaping symlink alike (see
 * header) — never distinguishable from the response. This route only ever
 * needs the EXISTING-file case (D9: it confirms the agent exists, never
 * creates one), so a not-yet-created SKILL.md — which the shared guard
 * otherwise tolerates for the PUT route's create flow — is treated the same
 * as "unknown agent" here.
 */
function resolveSafeSkillMdPath(forgeRoot: string, slug: string): string | null {
  const guard = resolveGuardedPath(skillsDir(forgeRoot), [slug, 'SKILL.md']);
  if (!guard.ok || !guard.exists) return null;
  return guard.realPath;
}

export async function handleStudioInstructionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const match = url.match(INSTRUCTIONS_DRAFT_ROUTE_RE);
  if (!match) return false;

  const origin = allowedOrigin(req);

  try {
    let slug: string;
    try {
      slug = decodeURIComponent(match[1]);
    } catch {
      sendJson(res, 400, { error: 'invalid slug — malformed URL encoding' }, origin);
      return true;
    }

    // Slug-guard BEFORE any fs call — identical rule to the PUT route.
    if (!SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'invalid slug — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
      return true;
    }

    // Existence check ONLY — realpathSync-guarded, never read into the
    // response (D9: this route is not permitted to leak or persist any file
    // content; the draft is composed purely from the request body below).
    const realSkillMdPath = resolveSafeSkillMdPath(ctx.forgeRoot, slug);
    if (!realSkillMdPath) {
      sendJson(res, 404, { error: `unknown agent "${slug}"` }, origin);
      return true;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' }, origin);
      return true;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
      return true;
    }

    // D8/D9: compose from the REQUEST BODY (the builder's current, possibly
    // unsaved state) — never from disk. No write follows.
    const { draft, derivation } = composeInstructionsDraft(body as Record<string, unknown>);
    sendJson(res, 200, { ok: true, draft, derivation }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
