/**
 * Forge Studio skills-library bridge routes (R3-01-F3/F4, WI-2).
 *
 * Owns EVERY `/api/studio/skills*` route — one home, per _wave5/specs/R3-01-F3F4.md:
 *
 *   GET  /api/studio/skills            → { skills: SkillLibraryEntry[] }
 *   GET  /api/studio/skills/:id        → detail: { files, scan? } + entry fields
 *   POST /api/studio/skills            → author a plain composable skill
 *                                         (MOVED VERBATIM from bridge-studio-writes.ts;
 *                                         behaviour unchanged, same test coverage)
 *   POST /api/studio/skills/install    → install an already-materialised package (D2)
 *   POST /api/studio/skills/:id/approve → approve a draft (D4: never restores runtime)
 *
 * Matches the existing handler contract exactly: `sendJson`/`allowedOrigin`/
 * `sanitizeError`/`readJson`/`pathOnly` from bridge-studio.ts, returning `true`
 * once a route is handled and `false` for passthrough (mirrors
 * bridge-studio-kbs.ts / bridge-studio-writes.ts).
 *
 * Every id-bearing route resolves the id through `skillPath`/`skillDir`
 * (orchestrator/skill-path.ts), which slug-validates and throws on anything
 * that isn't a bare lowercase-kebab path segment — traversal, absolute paths,
 * and `.`/`..` are rejected there, before any filesystem read, and the throw
 * is caught here and reported as 400 (never a 500, never a raw stack trace).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import matter from 'gray-matter';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
import { skillPath, skillsDir } from '../orchestrator/skill-path.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { isStudioAgent } from '../orchestrator/studio/registry.ts';
import {
  listSkillLibrary,
  readSkillPackage,
  scanSkillPackage,
  skillTrustDetail,
  installSkillPackage,
  approveSkillDraft,
  type SkillLibraryEntry,
} from '../orchestrator/studio/skill-library.ts';

// ---------------------------------------------------------------------------
// Response shaping — never forward an internal absolute host path to the
// browser (house rule: no absolute host paths leaked), even on a 200. Both
// `path` (the absolute SKILL.md path listSkillLibrary carries for its own
// bookkeeping) and a per-entry parse `error` (which embeds that same
// absolute path — see skill-library.ts's malformed-SKILL.md branch) are
// scrubbed here, at the one place responses leave the process.
// ---------------------------------------------------------------------------

function toClientEntry(entry: SkillLibraryEntry): Omit<SkillLibraryEntry, 'path'> {
  const { path: _path, ...rest } = entry;
  return rest.error ? { ...rest, error: sanitizeError(rest.error) } : rest;
}

/** Decode a URL path segment; throws (never silently passes through a raw,
 *  still-encoded id) on malformed percent-encoding. */
function decodeIdSegment(raw: string): string {
  return decodeURIComponent(raw);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleStudioSkillsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' && method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/skills — the library listing -----------------------
  if (method === 'GET' && url === '/api/studio/skills') {
    try {
      const skills = listSkillLibrary(ctx.forgeRoot).map(toClientEntry);
      sendJson(res, 200, { skills }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/skills (P2) — author a plain composable skill -----
  // MOVED VERBATIM from cli/bridge-studio-writes.ts (deleted there in this
  // same commit) — behaviour must not change at all; AT-55 pins it.
  // A "skill" here is a plain SKILL.md (name + description + body, no runtime
  // block) — composable into agents. Distinct from a studio agent (which has a
  // runtime block). Stamped `library: true` so it is palette-visible (R3-01-F2
  // union) and passes the `library`-must-be-explicit lint on the very next run.
  if (method === 'POST' && url === '/api/studio/skills') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      const description = typeof b['description'] === 'string' ? b['description'].trim() : '';
      const skillBody = typeof b['body'] === 'string' ? b['body'] : '';
      if (!name) { sendJson(res, 400, { error: 'name is required' }, origin); return true; }
      if (!description) { sendJson(res, 400, { error: 'description is required' }, origin); return true; }

      const slug = (typeof b['id'] === 'string' && b['id'].trim() ? b['id'].trim() : name)
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!SLUG_RE.test(slug)) { sendJson(res, 400, { error: 'could not derive a valid slug from the name' }, origin); return true; }

      // Guard through the shared containment guard (cli/studio-path-guard.ts
      // — 2026-08-06, this route's own BLOCKER: the prior lexical
      // `skillDirPath.startsWith(skillsDir + sep)` check on the UNRESOLVED,
      // join()-constructed path never resolves symlinks — a `skills/<id>`
      // directory that IS a symlink to an outside location passes it
      // trivially, since the CONSTRUCTED path is always lexically under
      // skills/ regardless of what it actually points at). The guard also
      // subsumes the old `existsSync(skillMdPath)` 409 check via
      // `pathGuard.exists` — a symlink pointing at an outside dir that
      // happens to already contain a SKILL.md now 400s because the guard's
      // per-segment IDENTITY check rejects it, not because `existsSync`
      // followed the symlink and found something there (that was a side
      // effect, not containment; the guard call runs FIRST, before the
      // dedup check, so it fires for the right reason).
      const pathGuard = resolveGuardedPath(skillsDir(ctx.forgeRoot), [slug, 'SKILL.md']);
      if (!pathGuard.ok) { sendJson(res, 400, { error: 'path traversal detected' }, origin); return true; }
      if (pathGuard.exists) { sendJson(res, 409, { error: `skill "${slug}" already exists` }, origin); return true; }
      const skillMdPath = pathGuard.realPath;
      const skillDirPath = dirname(skillMdPath);

      const md = matter.stringify(
        '\n' + (skillBody.trim() || `# ${name}\n\n${description}\n`) + '\n',
        { name, description, library: true },
      );
      if (!existsSync(skillDirPath)) mkdirSync(skillDirPath, { recursive: true });
      writeFileSync(skillMdPath, md, 'utf8');
      sendJson(res, 200, { ok: true, id: slug }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/skills/install -------------------------------------
  // D2: transport-agnostic — consumes an already-materialised package (a local
  // directory path). No network call, no fabricated "vendored upstream"
  // content. Every field is validated at this boundary before it reaches
  // installSkillPackage; every error installSkillPackage itself throws is, by
  // its own contract, a caller-input problem (bad id/packageDir/upstream,
  // traversal, oversize, binary, missing SKILL.md) — reported as 400, never
  // 500, never a bare stack trace.
  if (method === 'POST' && url === '/api/studio/skills/install') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      if (typeof b !== 'object' || b === null || Array.isArray(b)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }

      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      if (!id) { sendJson(res, 400, { error: 'id is required' }, origin); return true; }

      const packageDir = typeof b['packageDir'] === 'string' ? b['packageDir'].trim() : '';
      if (!packageDir) { sendJson(res, 400, { error: 'packageDir is required' }, origin); return true; }
      if (!existsSync(packageDir)) {
        sendJson(res, 400, { error: `packageDir "${packageDir}" does not exist` }, origin); return true;
      }

      const rawUpstream = b['upstream'];
      if (rawUpstream === null || typeof rawUpstream !== 'object' || Array.isArray(rawUpstream)) {
        sendJson(res, 400, { error: 'upstream is required (upstream.source)' }, origin); return true;
      }
      const upstreamObj = rawUpstream as Record<string, unknown>;
      const source = typeof upstreamObj['source'] === 'string' ? upstreamObj['source'].trim() : '';
      if (!source) { sendJson(res, 400, { error: 'upstream.source is required' }, origin); return true; }
      const ref = typeof upstreamObj['ref'] === 'string' && upstreamObj['ref'].trim() ? upstreamObj['ref'].trim() : undefined;

      try {
        const result = installSkillPackage({
          forgeRoot: ctx.forgeRoot,
          id,
          packageDir,
          upstream: ref ? { source, ref } : { source },
        });
        sendJson(res, 200, { ok: true, id, ...result }, origin);
      } catch (err) {
        // Every installSkillPackage throw (bad slug, traversal, cap exceeded,
        // binary file, no SKILL.md at the package root, ...) is a caller-input
        // problem by the module's own contract — never a 500 here.
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
      }
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/skills/:id/approve ---------------------------------
  const approveMatch = url.match(/^\/api\/studio\/skills\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    try {
      let id: string;
      try {
        id = decodeIdSegment(approveMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'invalid skill id — malformed URL encoding' }, origin);
        return true;
      }

      let mdPath: string;
      try {
        mdPath = skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }

      if (!existsSync(mdPath)) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }

      const { trust } = skillTrustDetail(ctx.forgeRoot, id);
      if (trust !== 'draft') {
        sendJson(res, 409, { error: `skill "${id}" is not a draft (trust: ${trust}) — only a draft install can be approved` }, origin);
        return true;
      }

      approveSkillDraft({ forgeRoot: ctx.forgeRoot, id });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/skills/:id — detail ---------------------------------
  const detailMatch = url.match(/^\/api\/studio\/skills\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    try {
      let id: string;
      try {
        id = decodeIdSegment(detailMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'invalid skill id — malformed URL encoding' }, origin);
        return true;
      }

      let mdPath: string;
      try {
        mdPath = skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }

      if (!existsSync(mdPath)) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }

      // MAJOR 1 fix: listSkillLibrary deliberately EXCLUDES studio agents
      // (SKILL.md with a `runtime:` block, AT-5) — mirror that exclusion here
      // so this route cannot confidently report a fabricated `usedBy: []` for
      // an id the library union never carries a real answer for.
      if (isStudioAgent(mdPath)) {
        sendJson(res, 404, { error: `"${id}" is a studio agent, not a library skill` }, origin);
        return true;
      }

      // skillTrustDetail reads the SKILL.md itself — a directory masquerading
      // as SKILL.md (or any other unreadable-file condition) throws here and
      // falls through to the sanitized 500 below, never a raw stack trace.
      const { trust, reason } = skillTrustDetail(ctx.forgeRoot, id);
      const files = readSkillPackage(ctx.forgeRoot, id);
      const { data } = matter(readFileSync(mdPath, 'utf8'), {});
      const d = (data ?? {}) as Record<string, unknown>;

      // WI-3: the forge-ui detail page needs source/usedBy/provenance, which
      // this route did not carry until now. No cli/bridge-studio-skills.test.ts
      // assertion pins an exhaustive key set on this response (checked before
      // making this change), so these are additive fields, not a shape change
      // any existing AT depends on. Reusing listSkillLibrary's own union +
      // derivation here (rather than re-deriving usedBy/provenance a second,
      // divergent way) — house rule: one enforcement point, not two.
      // This route only reaches here when the id resolved to a real on-disk
      // SKILL.md (existsSync(mdPath) above) that is NOT a studio agent (the
      // gate above), so `source` is always 'local' and a matching library
      // entry MUST exist — if it doesn't, that is an internal inconsistency
      // between this route and listSkillLibrary, not a value to guess at.
      const libraryEntry = listSkillLibrary(ctx.forgeRoot).find((e) => e.id === id);
      if (!libraryEntry) {
        throw new Error(`skill "${id}" resolved on disk but is absent from listSkillLibrary — internal inconsistency`);
      }

      const detail: Record<string, unknown> = {
        id,
        name: typeof d['name'] === 'string' && d['name'] ? d['name'] : id,
        description: typeof d['description'] === 'string' ? d['description'] : undefined,
        trust,
        paletteVisible: trust === 'ready',
        files,
        source: 'local',
        usedBy: libraryEntry.usedBy,
        provenance: libraryEntry.provenance,
      };
      if (reason) detail['reason'] = reason;
      // D5: the scan is drafts-only (approval-gate UI) — it reports facts a
      // human reviews before approving, never a verdict for an already-trusted
      // or already-quarantined-and-flagged skill.
      if (trust === 'draft') detail['scan'] = scanSkillPackage(files);

      sendJson(res, 200, detail, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
