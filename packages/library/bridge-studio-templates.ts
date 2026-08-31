/**
 * Forge Studio templates-library bridge routes (R3-06, WI-3; write path
 * added W7-B4/library-17).
 *
 * Owns EVERY `/api/studio/templates*` route:
 *
 *   GET    /api/studio/templates      → { templates: TemplateLibraryEntry[] }
 *   GET    /api/studio/templates/:id  → TemplateDetail (404 unknown id, 400 malformed id)
 *   POST   /api/studio/templates      → create / duplicate a single-file template
 *   PUT    /api/studio/templates/:id  → overwrite a single-file template's content
 *   DELETE /api/studio/templates/:id  → remove a single-file template (409 while `usedBy` is non-empty)
 *
 * Mirrors bridge-studio-skills.ts's contract exactly: a single
 * `handleStudioTemplatesRoutes(req, res, ctx, rawUrl, method): Promise<boolean>`,
 * a linear if-chain, an exact-string compare for the collection route and a
 * `match()` regex for the id route, returning `false` on fallthrough. Same
 * convention as the skills/hooks files.
 *
 * These routes are READ-WRITE — EXCEPT `project-scaffold` templates, which
 * stay read-only: a scaffold (`studio/starters/projects/<id>/`) is a whole
 * directory tree curated in the repo, not a single file, so it has no
 * one-file authoring shape (`SCAFFOLD_READONLY` below, returned by every
 * write route on that category). `planning` (`studio/artifact-templates/*.md`)
 * and `demo-output` (`studio/demo-elements/*.md`) are the two single-file
 * categories POST/PUT/DELETE actually write — see `WRITABLE_CATEGORY_DIRS`.
 *
 * Every id is slug-validated (SLUG_RE, orchestrator/studio/validate.ts) BEFORE
 * it ever reaches `templateDetail` or a write. `templateDetail` itself resolves
 * an id by plain string equality against `listTemplateLibrary`'s ids — an
 * unvalidated `../../etc/passwd`-shaped id would merely fail to match (a 404,
 * silently treating a traversal attempt as "not found"), not fail LOUD as the
 * malformed input it actually is. The guard here rejects it with 400 before
 * that lookup — or any write — ever runs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

import { sendJson, allowedOrigin, sanitizeError, readJson, pathOnly, type StudioContext } from '../../cli/bridge-studio.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { SLUG_RE } from '../../orchestrator/studio/validate.ts';
import { listTemplateLibrary, templateDetail, type TemplateCategory } from './studio/template-library.ts';
import { loadArtifactTemplate, loadDemoElement } from '../../orchestrator/studio/registry.ts';
import { MAX_SKILL_ID_LENGTH, isReservedId } from '@forge/agents/skill-path.ts';

/** Hard cap on a template id's length — the same value and rationale as
 *  `MAX_SKILL_ID_LENGTH` (orchestrator/skill-path.ts), imported rather than
 *  re-declared: without it, a charset-valid but absurdly long id sails past
 *  SLUG_RE and only dies later as an opaque fs error instead of an
 *  actionable 400. No real template-library entry is remotely close to this
 *  length. */
const MAX_TEMPLATE_ID_LENGTH = MAX_SKILL_ID_LENGTH;

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
export function invalidTemplateIdReason(id: string): string | null {
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

// ---------------------------------------------------------------------------
// W7-B4 (library-17) — the authoring half. Only the two SINGLE-FILE
// categories are writable; a project scaffold is a whole directory tree with
// no one-file authoring shape, so it stays read-only WITH that reason.
// ---------------------------------------------------------------------------

/** The two template categories actually writable as a single file from
 *  Studio — `project-scaffold` (the third real `TemplateCategory` member) is
 *  deliberately excluded from this type: it is a whole directory tree, never
 *  a single-file write target (`SCAFFOLD_READONLY` below). Exported so
 *  `cli/bridge-studio-authoring.ts`'s `kind:'template'` finalize arm shares
 *  this exact narrowing rather than re-declaring it. */
export type WritableTemplateCategory = Extract<TemplateCategory, 'planning' | 'demo-output'>;

/** The one category → directory mapping the write routes use. Exported for
 *  the SAME reuse reason as `WritableTemplateCategory`. */
export const WRITABLE_CATEGORY_DIRS: Readonly<Record<WritableTemplateCategory, string[]>> = {
  planning: ['studio', 'artifact-templates'],
  'demo-output': ['studio', 'demo-elements'],
};

export const SCAFFOLD_READONLY =
  'project-scaffold templates are whole directory trees curated in the repo (studio/starters/projects) — not authorable as a single file from Studio';

/**
 * Validate a candidate `category` value against the REAL `TemplateCategory`
 * union (template-library.ts) and narrow it to the two WRITABLE members.
 * Every write path that accepts a category — the POST create route below AND
 * `cli/bridge-studio-authoring.ts`'s `kind:'template'` finalize arm — shares
 * this ONE check, so "which categories are writable" and "why
 * project-scaffold isn't" live in exactly one place, never a second
 * re-implementation that could drift from this one's wording.
 */
export function writableCategoryOrReason(category: unknown): { category: WritableTemplateCategory } | { error: string } {
  if (category === 'planning' || category === 'demo-output') return { category };
  return {
    error: category === 'project-scaffold' ? SCAFFOLD_READONLY : 'category must be "planning" or "demo-output"',
  };
}

/**
 * Validate candidate template CONTENT by the REAL category loader — the one
 * enforcement point `forge studio lint` and the registry already use, never a
 * re-implemented field list that could drift. The bytes are staged into a
 * private server-named file, loaded, id-checked, and the staging dir removed
 * in `finally`; invalid bytes never reach the real library directory.
 * Returns null when valid, else the loader's own message. Exported for the
 * SAME reuse reason as `WRITABLE_CATEGORY_DIRS`.
 */
export function invalidTemplateContentReason(
  forgeRoot: string,
  category: WritableTemplateCategory,
  id: string,
  content: string,
): string | null {
  const stagingDir = resolve(forgeRoot, '_template-staging');
  const stagingFile = join(stagingDir, `${id}.md`);
  try {
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(stagingFile, content, 'utf8');
    const loaded = category === 'planning' ? loadArtifactTemplate(stagingFile) : loadDemoElement(stagingFile);
    if (loaded.id !== id) {
      return `frontmatter id "${loaded.id}" must equal the template id "${id}"`;
    }
    return null;
  } catch (err) {
    return sanitizeError(err);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export async function handleStudioTemplatesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/studio/templates — create / duplicate (W7-B4) -------------
  if (url === '/api/studio/templates' && method === 'POST') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;

      const categoryCheck = writableCategoryOrReason(b['category']);
      if ('error' in categoryCheck) {
        sendJson(res, 400, { error: categoryCheck.error }, origin);
        return true;
      }
      const category = categoryCheck.category;

      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      const invalidId = invalidTemplateIdReason(id);
      if (!id || invalidId) { sendJson(res, 400, { error: invalidId ?? 'id is required' }, origin); return true; }
      if (isReservedId(id)) {
        sendJson(res, 400, { error: `template id "${id}" is reserved (the /templates/new builder lives at that path) — choose another id` }, origin);
        return true;
      }

      // Library-wide uniqueness (the duplicate-id lint is an error) — not
      // just this category's directory.
      if (listTemplateLibrary(ctx.forgeRoot).some((e) => e.id === id)) {
        sendJson(res, 409, { error: `template "${id}" already exists` }, origin);
        return true;
      }

      // Resolve the content: verbatim, or duplicated from an existing
      // single-file template with the frontmatter id rewritten.
      let content: string;
      const duplicateOf = typeof b['duplicateOf'] === 'string' ? b['duplicateOf'].trim() : '';
      if (duplicateOf) {
        const invalidSource = invalidTemplateIdReason(duplicateOf);
        if (invalidSource) { sendJson(res, 400, { error: invalidSource }, origin); return true; }
        const source = templateDetail(ctx.forgeRoot, duplicateOf);
        if (!source) { sendJson(res, 404, { error: `unknown template "${duplicateOf}"` }, origin); return true; }
        if (source.category !== category) {
          sendJson(res, 400, { error: `duplicateOf "${duplicateOf}" is a ${source.category} template — the duplicate must stay in the same category` }, origin);
          return true;
        }
        const raw = source.files[0]?.body ?? '';
        const parsed = matter(raw, {});
        content = matter.stringify(parsed.content, { ...(parsed.data as Record<string, unknown>), id });
      } else if (typeof b['content'] === 'string' && b['content']) {
        content = b['content'];
      } else {
        sendJson(res, 400, { error: 'content is required (or duplicateOf naming an existing template)' }, origin);
        return true;
      }

      const invalidContent = invalidTemplateContentReason(ctx.forgeRoot, category, id, content);
      if (invalidContent) { sendJson(res, 400, { error: invalidContent }, origin); return true; }

      const dirSegments = WRITABLE_CATEGORY_DIRS[category];
      const targetGuard = resolveGuardedPath(resolve(ctx.forgeRoot, ...dirSegments), [`${id}.md`]);
      if (!targetGuard.ok) { sendJson(res, 400, { error: 'path traversal detected' }, origin); return true; }
      if (targetGuard.exists) { sendJson(res, 409, { error: `template "${id}" already exists` }, origin); return true; }
      writeFileSync(targetGuard.realPath, content, 'utf8');
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- PUT / DELETE /api/studio/templates/:id (W7-B4) ----------------------
  // One dispatch line per method (not a combined `||`) so the dry-bridge
  // coverage scanner (cli/dry-bridge-coverage.test.ts) derives BOTH
  // candidates — its explicit-method regex reads only the first
  // `method ===` on an if-line. Same convention as the skills/hooks files.
  const writeMatch = url.match(/^\/api\/studio\/templates\/([^/]+)$/);
  const handleTemplateMutation = async (rawId: string): Promise<boolean> => {
    try {
      let id: string;
      try { id = decodeIdSegment(rawId); } catch { sendJson(res, 400, { error: 'invalid template id — malformed URL encoding' }, origin); return true; }
      const invalidId = invalidTemplateIdReason(id);
      if (invalidId) { sendJson(res, 400, { error: invalidId }, origin); return true; }

      const entry = listTemplateLibrary(ctx.forgeRoot).find((e) => e.id === id);
      if (!entry) { sendJson(res, 404, { error: `unknown template "${id}"` }, origin); return true; }
      if (entry.category === 'project-scaffold') {
        sendJson(res, 400, { error: SCAFFOLD_READONLY }, origin);
        return true;
      }
      const category = entry.category as 'planning' | 'demo-output';
      const dirSegments = WRITABLE_CATEGORY_DIRS[category];
      // The leaf is the entry's OWN definitionRef basename (server-derived),
      // still routed through the guard — containment discipline, not trust.
      const leaf = entry.definitionRef.split('/').pop() ?? `${id}.md`;
      const targetGuard = resolveGuardedPath(resolve(ctx.forgeRoot, ...dirSegments), [leaf]);
      if (!targetGuard.ok || !targetGuard.exists) {
        sendJson(res, 404, { error: `unknown template "${id}"` }, origin);
        return true;
      }

      if (method === 'PUT') {
        let body: unknown;
        try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
        const b = (body ?? {}) as Record<string, unknown>;
        const content = typeof b['content'] === 'string' ? b['content'] : '';
        if (!content) { sendJson(res, 400, { error: 'content is required' }, origin); return true; }
        const invalidContent = invalidTemplateContentReason(ctx.forgeRoot, category, id, content);
        if (invalidContent) { sendJson(res, 400, { error: invalidContent }, origin); return true; }
        writeFileSync(targetGuard.realPath, content, 'utf8');
        sendJson(res, 200, { ok: true, id }, origin);
        return true;
      }

      // DELETE — refuse while anything real still uses it (the same derived
      // usedBy the listing renders; an empty list is "scanned N, found none").
      if (entry.usedBy.length > 0) {
        sendJson(res, 409, {
          error: `template "${id}" is still used by: ${entry.usedBy.join(', ')} — detach those first`,
          usedBy: entry.usedBy,
        }, origin);
        return true;
      }
      rmSync(targetGuard.realPath, { force: true });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  };
  if (writeMatch && method === 'PUT') return handleTemplateMutation(writeMatch[1]);
  if (writeMatch && method === 'DELETE') return handleTemplateMutation(writeMatch[1]);

  if (method !== 'GET') return false;

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
