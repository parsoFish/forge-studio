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
 *   POST /api/studio/skills/:id/approve → approve a draft (D4: never restores runtime), OR
 *                                         re-pin a needs-review skill (W8-B4, library-36) —
 *                                         see the dispatch comment at the route itself
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import matter from 'gray-matter';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from '../../cli/bridge-studio.ts';
import { skillPath, skillsDir } from './skill-path.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { stageSkillPackage } from './skill-staging.ts';
import { SLUG_RE, isReservedId } from '../../orchestrator/studio/validate.ts';
import { isStudioAgent } from '../../orchestrator/studio/registry.ts';
import { listSkillLibrary, skillTrustDetail, type SkillLibraryEntry } from './studio/skill-trust.ts';
import { readSkillPackage, scanSkillPackage } from './studio/skill-package.ts';
import { installSkillPackage, approveSkillDraft, repinSkillPackage } from './studio/skill-install.ts';
import { removeInstallLedgerEntry } from './studio/skill-install-ledger.ts';

// SEC-05 q80 (d1): total decoded-bytes cap on an inline-upload install. Kept
// at or below the transport's MAX_BODY_BYTES (~1 MiB, cli/bridge-studio.ts) so
// a staged package can never exceed what the body reader already admits; a
// request over this cap is refused before any staging write.
const MAX_STAGED_PACKAGE_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Server-minted, unpredictable staging id — mirrors `newRunStamp` in
 *  cli/ui-bridge.ts (ISO-8601 stamp to ms precision + 4 base36 chars, so two
 *  installs in the same millisecond never collide onto one staging dir). NEVER
 *  derived from client input: the guarded stage's containment proof rests on
 *  this being fully server-controlled. */
function newSourceId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

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
  // PUT/DELETE joined in W7-B4 (library-05): the edit/delete half of CRUD.
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return false;

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
      // W7-A4 (crosscut-20): `new` is the /skills/new builder segment, never a skill.
      if (isReservedId(slug)) { sendJson(res, 400, { error: `skill id "${slug}" is reserved (the /skills/new builder lives at that path) — choose another name` }, origin); return true; }

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
  // SEC-05 q80 (d1): inline-upload contract. The route NO LONGER accepts a
  // client-supplied `packageDir` — a caller-controlled absolute host path
  // handed straight into installSkillPackage's filesystem walk was the P1 this
  // fix closes. Instead it consumes inline-uploaded bytes:
  //   { id, entries: [{ path, contentBase64 }], upstream: { source, ref? } }
  // Every field is validated at this boundary; a SERVER-derived sourceId (never
  // from the client) names a private staging dir under
  // <forgeRoot>/_skill-staging; stageSkillPackage (cli/skill-staging.ts) writes
  // each entry through the shared realpath containment guard, and the returned
  // server-trusted staged realpath is what installSkillPackage copies from. The
  // staging dir is rm'd in a `finally` on BOTH success and failure. Every
  // stage/install throw is, by contract, a caller-input problem — reported 400,
  // never 500, never a bare stack trace.
  if (method === 'POST' && url === '/api/studio/skills/install') {
    const sourceId = newSourceId();
    const stagingRoot = resolve(ctx.forgeRoot, '_skill-staging');
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      if (typeof b !== 'object' || b === null || Array.isArray(b)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }

      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      if (!id) { sendJson(res, 400, { error: 'id is required' }, origin); return true; }

      // entries — a non-empty array of { path, contentBase64 }. Each path is an
      // untrusted, possibly-nested package-relative path: it must be a non-empty
      // string, must NOT be absolute, and must contain no ".." segment. This is
      // the fail-fast boundary layer in front of the guarded stage, not a
      // substitute for it — stageSkillPackage re-checks containment on the
      // resolved realpath of every entry.
      const rawEntries = b['entries'];
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        sendJson(res, 400, { error: 'entries is required (a non-empty array of { path, contentBase64 })' }, origin); return true;
      }
      const entries: Array<{ path: string; contentBase64: string }> = [];
      let totalDecodedBytes = 0;
      for (const raw of rawEntries) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          sendJson(res, 400, { error: 'each entry must be an object { path, contentBase64 }' }, origin); return true;
        }
        const e = raw as Record<string, unknown>;
        const entryPath = typeof e['path'] === 'string' ? e['path'] : '';
        if (!entryPath) { sendJson(res, 400, { error: 'each entry.path must be a non-empty string' }, origin); return true; }
        if (entryPath.startsWith('/')) { sendJson(res, 400, { error: `entry.path "${entryPath}" must not be absolute` }, origin); return true; }
        if (entryPath.split('/').includes('..')) { sendJson(res, 400, { error: `entry.path "${entryPath}" must not contain a ".." segment` }, origin); return true; }
        if (typeof e['contentBase64'] !== 'string') { sendJson(res, 400, { error: `entry "${entryPath}" contentBase64 must be a string` }, origin); return true; }
        const contentBase64 = e['contentBase64'];
        totalDecodedBytes += Buffer.from(contentBase64, 'base64').length;
        if (totalDecodedBytes > MAX_STAGED_PACKAGE_BYTES) {
          sendJson(res, 413, { error: `staged package exceeds the ${MAX_STAGED_PACKAGE_BYTES}-byte cap` }, origin); return true;
        }
        entries.push({ path: entryPath, contentBase64 });
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
        // stagingRoot must exist before the guard resolves against it
        // (resolveGuardedPath realpath's its root and refuses a missing one).
        // Mirrors the stageMaterials caller in cli/ui-bridge.ts, which mkdir's
        // the run dir before staging.
        mkdirSync(stagingRoot, { recursive: true });
        const stagedDir = stageSkillPackage(stagingRoot, sourceId, entries);
        const result = installSkillPackage({
          forgeRoot: ctx.forgeRoot,
          id,
          packageDir: stagedDir,
          upstream: ref ? { source, ref } : { source },
        });
        sendJson(res, 200, { ok: true, id, ...result }, origin);
      } catch (err) {
        // Every stageSkillPackage / installSkillPackage throw (traversal entry,
        // duplicate target, bad slug, cap exceeded, binary file, no SKILL.md at
        // the package root, ...) is a caller-input problem by contract — 400,
        // never a 500 here.
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
      }
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    } finally {
      // Clean the private staging dir on BOTH success and throw. `sourceId` is
      // server-minted, so this join targets exactly this request's dir; the
      // force flag makes it a no-op when staging never wrote (e.g. a
      // body-validation 400 that returned before the mkdir above).
      rmSync(join(stagingRoot, sourceId), { recursive: true, force: true });
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

      // Guard symmetry (bd `forge-wze` sweep): `POST /api/studio/skills` was
      // hardened onto the shared realpath identity guard, but this route still
      // resolved through `skillPath()` — `assertSkillSlug` (charset only) plus
      // a bare `join()`. Confirmed live: a symlinked `skills/<id>` directory
      // was followed, and the approve route WROTE THROUGH it, mutating a
      // SKILL.md outside the repo. Same guard, `skills/` as the fixed root,
      // `id` as its own segment (never folded into the root — see the CONTRACT
      // section of ./studio-path-guard.ts).
      // Layer 1 — SHAPE. `skillPath` runs `assertSkillSlug`, which 400s a
      // malformed id. Kept as the independent first layer (the guard below
      // never validates slug shape, only containment), and because a
      // malformed id is a malformed request, not a probe for planted objects.
      try {
        skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }
      // Layer 2 — CONTAINMENT. A guard rejection collapses into the SAME 404
      // as a genuinely unknown skill: distinguishable responses would hand an
      // attacker a probe for which ids are planted.
      const pathGuard = resolveGuardedPath(skillsDir(ctx.forgeRoot), [id, 'SKILL.md']);
      if (!pathGuard.ok || !pathGuard.exists) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }

      // W8-B4 (library-36 regate): `SkillTrust` has exactly three arms
      // ('draft' | 'needs-review' | 'ready' — skill-library.ts). A sibling
      // fix (227ca073) made /skills/<id> RENDER an Approve control for
      // needs-review, but this route still refused every non-draft — a
      // surfaced-but-unbacked control, the campaign's dominant
      // declared-data-fails-open defect. Each arm now gets its own dispatch:
      //   draft        -> approveSkillDraft (unchanged; do not widen its own
      //                    contract, the dispatch belongs here)
      //   needs-review -> repinSkillPackage — the operator's review act ("I
      //                    looked at this edit, it is mine, pin it"),
      //                    re-anchoring the pinned contentHash to the
      //                    current on-disk bytes and keeping the
      //                    install-ledger row's pin in step
      //   ready        -> still 409, naming the real trust value
      const { trust } = skillTrustDetail(ctx.forgeRoot, id);
      if (trust === 'draft') {
        approveSkillDraft({ forgeRoot: ctx.forgeRoot, id });
        sendJson(res, 200, { ok: true, id }, origin);
        return true;
      }
      if (trust === 'needs-review') {
        // `repinSkillPackage` throws when the skill has no provenance block
        // to re-pin — a hand-authored needs-review skill (or one whose
        // provenance block was itself stripped, the `provenance-tampered`
        // reason with nothing left) has nothing for a re-pin to anchor to.
        // That is a caller-facing 409 naming the real reason, never a 500.
        try {
          repinSkillPackage({ forgeRoot: ctx.forgeRoot, id });
        } catch (err) {
          sendJson(res, 409, { error: `skill "${id}" cannot be approved: ${sanitizeError(err)}` }, origin);
          return true;
        }
        sendJson(res, 200, { ok: true, id }, origin);
        return true;
      }
      sendJson(res, 409, { error: `skill "${id}" is not a draft or needs-review skill (trust: ${trust}) — only a draft install or a needs-review skill can be approved` }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- PUT /api/studio/skills/:id — edit / rename (W7-B4, library-05) ------
  // The edit half of CRUD the create-only surface never had. Edits the THREE
  // operator-authorable fields of a plain composable skill — display `name`,
  // `description`, and the SKILL.md body — never the id (the directory) and
  // never runtime/frontmatter machinery. Editing a community-installed skill
  // is legitimate; the trust pipeline already answers honestly (the pinned
  // content hash no longer matches ⇒ needs-review), nothing here launders it.
  const putMatch = url.match(/^\/api\/studio\/skills\/([^/]+)$/);
  if (putMatch && method === 'PUT') {
    try {
      let id: string;
      try {
        id = decodeIdSegment(putMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'invalid skill id — malformed URL encoding' }, origin);
        return true;
      }
      // Layer 1 — SHAPE (assertSkillSlug via skillPath); layer 2 — CONTAINMENT
      // (same two-layer idiom as GET/approve above; rejection reads as 404).
      try {
        skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }
      const pathGuard = resolveGuardedPath(skillsDir(ctx.forgeRoot), [id, 'SKILL.md']);
      if (!pathGuard.ok || !pathGuard.exists) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }
      const mdPath = pathGuard.realPath;
      // Studio AGENTS are edited via PUT /api/studio/agents/:slug — mirroring
      // the GET exclusion so this route cannot silently rewrite an agent.
      if (isStudioAgent(mdPath)) {
        sendJson(res, 404, { error: `"${id}" is a studio agent, not a library skill` }, origin);
        return true;
      }

      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      const name = typeof b['name'] === 'string' ? b['name'].trim() : undefined;
      const description = typeof b['description'] === 'string' ? b['description'].trim() : undefined;
      const skillBody = typeof b['body'] === 'string' ? b['body'] : undefined;
      if (name === undefined && description === undefined && skillBody === undefined) {
        sendJson(res, 400, { error: 'nothing to update — provide at least one of name, description, body' }, origin);
        return true;
      }
      if (name !== undefined && !name) { sendJson(res, 400, { error: 'name must be non-empty' }, origin); return true; }
      if (description !== undefined && !description) { sendJson(res, 400, { error: 'description must be non-empty' }, origin); return true; }

      const { data, content } = matter(readFileSync(mdPath, 'utf8'), {});
      const d = { ...(data as Record<string, unknown>) };
      if (name !== undefined) d['name'] = name;
      if (description !== undefined) d['description'] = description;
      const nextContent = skillBody !== undefined ? '\n' + skillBody.trim() + '\n' : content;
      writeFileSync(mdPath, matter.stringify(nextContent, d), 'utf8');
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- DELETE /api/studio/skills/:id (W7-B4, library-05) -------------------
  // Refuses (409, naming them) while any agent still composes the skill —
  // the same real `usedBy` derivation the listing renders, one source.
  if (putMatch && method === 'DELETE') {
    try {
      let id: string;
      try {
        id = decodeIdSegment(putMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'invalid skill id — malformed URL encoding' }, origin);
        return true;
      }
      try {
        skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }
      const pathGuard = resolveGuardedPath(skillsDir(ctx.forgeRoot), [id, 'SKILL.md']);
      if (!pathGuard.ok || !pathGuard.exists) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }
      if (isStudioAgent(pathGuard.realPath)) {
        sendJson(res, 404, { error: `"${id}" is a studio agent, not a library skill — delete it from the agent builder` }, origin);
        return true;
      }
      const entry = listSkillLibrary(ctx.forgeRoot).find((e) => e.id === id);
      const usedBy = entry?.usedBy ?? [];
      if (usedBy.length > 0) {
        sendJson(res, 409, {
          error: `skill "${id}" is still composed by ${usedBy.length} agent(s): ${usedBy.join(', ')} — unbind it from their builders first`,
          usedBy,
        }, origin);
        return true;
      }
      // W8-B4 (library-35): prune BEFORE removing the directory — a crash
      // between the two steps then fails CLOSED (an orphaned package that
      // still needs re-review, since its own on-disk provenance.contentHash
      // no longer agrees with a ledger that has already forgotten it) rather
      // than fails OPEN (a gone package whose stale ledger row would taint a
      // future hand-authored skill reusing the id). Tolerant / idempotent —
      // removeInstallLedgerEntry never throws on "nothing to prune", the
      // common case for a hand-authored skill that was never installed
      // through installSkillPackage.
      removeInstallLedgerEntry(ctx.forgeRoot, id);
      // rm the whole package dir, derived from the ALREADY-GUARDED real path.
      rmSync(dirname(pathGuard.realPath), { recursive: true, force: true });
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

      // Guard symmetry (bd `forge-wze` sweep): `POST /api/studio/skills` was
      // hardened onto the shared realpath identity guard, but this route still
      // resolved through `skillPath()` — `assertSkillSlug` (charset only) plus
      // a bare `join()`. Confirmed live: a symlinked `skills/<id>` directory
      // was followed, and the approve route WROTE THROUGH it, mutating a
      // SKILL.md outside the repo. Same guard, `skills/` as the fixed root,
      // `id` as its own segment (never folded into the root — see the CONTRACT
      // section of ./studio-path-guard.ts).
      // Layer 1 — SHAPE. `skillPath` runs `assertSkillSlug`, which 400s a
      // malformed id. Kept as the independent first layer (the guard below
      // never validates slug shape, only containment), and because a
      // malformed id is a malformed request, not a probe for planted objects.
      try {
        skillPath(id, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }
      // Layer 2 — CONTAINMENT. A guard rejection collapses into the SAME 404
      // as a genuinely unknown skill: distinguishable responses would hand an
      // attacker a probe for which ids are planted.
      const pathGuard = resolveGuardedPath(skillsDir(ctx.forgeRoot), [id, 'SKILL.md']);
      if (!pathGuard.ok || !pathGuard.exists) {
        sendJson(res, 404, { error: `unknown skill "${id}"` }, origin);
        return true;
      }
      const mdPath = pathGuard.realPath;

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
