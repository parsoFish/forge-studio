/**
 * The KB LIFECYCLE routes — create, delete, and the guidance note — plus the
 * three helpers that exist only for them: the guidance size cap, the guarded
 * resolution of a path nested under a kb dir, and the project-brain session id.
 *
 * Split out of `bridge-studio-kbs.ts` in M4 PR 4b. These three arms are the
 * package's only writes to a KB's own directory, which is why the path guard
 * travels with them rather than staying in the base module.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  resolveGuardedPath,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  type PathGuardResult,
} from '@forge/kernel';
import { listFlowIds, discoverProjects } from '../../orchestrator/studio/registry.ts';
import { loadKbDescriptor, serializeKbDescriptor } from './studio/kb-descriptor.ts';
import { resolveKbBrainDir } from './brain-paths.ts';
import { KB_BINDING_KINDS, type KbBinding } from '@forge/contracts/studio/types.ts';
import { listFlowBandIds } from '@forge/flows/flow-band-vocab.ts';
import { deriveKbActiveJob, activeJobReason } from './kb-job-state.ts';
import { KB_ID_RE, isReservedId, sendJson, allowedOrigin, sanitizeError, pathOnly, type RouteContext } from '@forge/kernel';
import { KB_SEEDING_ANCHOR_PREFIX, loadKbDescriptors, mintProjectBrainSeedingSession } from './bridge-studio-kbs.ts';

// ---------------------------------------------------------------------------
// Guidance size cap
// ---------------------------------------------------------------------------

const GUIDANCE_MAX_BYTES = 8 * 1024; // 8 KiB

/**
 * Guarded resolution of a path NESTED under a kb dir that
 * `resolveKbBrainDir` already identity-verified (bd `forge-wze`).
 *
 * Every "path traversal detected" check this file used to carry was
 * `resolve(base, id).startsWith(base + sep)` on an UNRESOLVED path — VACUOUS,
 * structurally incapable of failing for a `KB_ID_RE`-valid id, because
 * `resolve()` normalizes `..` before the comparison and a symlink's own
 * location is lexically inside the root even when it points elsewhere. A
 * guard that cannot fail is not a guard; they are replaced, not supplemented.
 *
 * `kbDir` is split back into its trusted base + its own id rather than passed
 * as the guard's `root`, so the id re-enters as a `segments[]` element and is
 * identity-checked — the root-folding prohibition in the CONTRACT section of
 * `./studio-path-guard.ts`. Returns the raw guard result because the write
 * routes need `exists` to distinguish create-mode from edit-mode.
 */
function guardKbTail(kbDir: string, ...tail: readonly string[]): PathGuardResult {
  return resolveGuardedPath(dirname(kbDir), [basename(kbDir), ...tail]);
}


/**
 * POST /api/studio/kbs — create a knowledge base (M5-4).
 *
 * The largest arm in the surface. Writes kb.yaml, seeds the anchor layer and
 * (for a project-bound KB) mints a project-brain session.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbCreate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/studio/kbs (create a new KB) (M5-4) ---------------------
  if (url === '/api/studio/kbs' && method === 'POST') {
    try {
      // 1. Parse request body
      let body: unknown;
      try {
        body = await ctx.readBody();
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 2. Validate id (slug-guard blocks path traversal)
      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      if (!id) {
        sendJson(res, 400, { error: 'id is required' }, origin);
        return true;
      }
      if (!KB_ID_RE.test(id)) {
        sendJson(res, 400, { error: `invalid kb id — must match ${KB_ID_RE} (one path segment, case-preserving)` }, origin);
        return true;
      }
      if (isReservedId(id)) {
        sendJson(res, 400, { error: `kb id "${id}" is reserved (the /knowledge/new builder lives at that path) — choose another id` }, origin);
        return true;
      }

      // 3. Validate name + desc (non-empty strings)
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'name is required and must be non-empty' }, origin);
        return true;
      }
      // W7-B2 (knowledge-22): the form has ALWAYS marked Description
      // optional — honour it. The KB descriptor contract (ADR-027 §4 / R1-01)
      // keeps `desc` a required non-empty field, so an omitted description
      // gets an honest, binding-derived default instead of a 400.
      const descInput = typeof b['desc'] === 'string' ? b['desc'].trim() : '';

      // 4. Validate binding (R1-01 KB contract — replaces the old scope enum)
      const bindingRaw = b['binding'];
      if (bindingRaw === null || typeof bindingRaw !== 'object' || Array.isArray(bindingRaw)) {
        sendJson(res, 400, { error: 'binding is required and must be an object' }, origin);
        return true;
      }
      const bindingObj = bindingRaw as Record<string, unknown>;
      const kind = typeof bindingObj['kind'] === 'string' ? bindingObj['kind'] : '';
      if (!(KB_BINDING_KINDS as readonly string[]).includes(kind)) {
        sendJson(res, 400, { error: `binding.kind must be one of: ${KB_BINDING_KINDS.join(', ')}` }, origin);
        return true;
      }
      let binding: KbBinding;
      if (kind === 'unique') {
        binding = { kind: 'unique' };
      } else {
        const ref = typeof bindingObj['ref'] === 'string' ? bindingObj['ref'].trim() : '';
        if (!ref) {
          sendJson(res, 400, { error: `binding.ref is required for binding.kind "${kind}"` }, origin);
          return true;
        }
        if (kind === 'flow') {
          const flowIds = listFlowIds(ctx.forgeRoot);
          if (!flowIds.includes(ref)) {
            sendJson(res, 400, { error: `binding.ref "${ref}" is not a registered flow id` }, origin);
            return true;
          }

          // R1-06: an optional band scope, meaningful only on a flow binding.
          // Reject an unknown band up front, naming the flow's real band
          // vocabulary — mirrors the ref-existence check just above.
          const bandRaw = bindingObj['band'];
          if (bandRaw !== undefined && bandRaw !== null) {
            if (typeof bandRaw !== 'string' || bandRaw.length === 0) {
              sendJson(res, 400, { error: 'binding.band must be a non-empty string when present' }, origin);
              return true;
            }
            const realBands = listFlowBandIds(ctx.forgeRoot, ref);
            if (!realBands.includes(bandRaw)) {
              sendJson(
                res,
                400,
                { error: `binding.band "${bandRaw}" is not one of flow "${ref}"'s real bands: ${realBands.join(', ')}` },
                origin,
              );
              return true;
            }
            binding = { kind: 'flow', ref, band: bandRaw };
          } else {
            binding = { kind: 'flow', ref };
          }
        } else {
          const projectsDir = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));
          const projectIds = discoverProjects(projectsDir, ctx.forgeRoot).map((p) => p.id);
          if (!projectIds.includes(ref)) {
            sendJson(res, 400, { error: `binding.ref "${ref}" is not a discovered project id` }, origin);
            return true;
          }
          binding = { kind: 'project', ref };
        }
      }

      // 4b. Default the description from the binding when omitted (see the
      // knowledge-22 note above) — binding is fully validated by here.
      const desc = descInput !== ''
        ? descInput
        : binding.kind === 'project'
          ? `Project knowledge base for ${binding.ref}.`
          : binding.kind === 'flow'
            ? `Flow knowledge base for ${binding.ref}${'band' in binding && binding.band ? ` (band ${binding.band})` : ''}.`
            : `Knowledge base "${name}".`;

      // 5. Containment: `brain/` is the fixed, forgeRoot-derived root and `id`
      // is its own segment (never folded into the root — see the CONTRACT
      // section of ./studio-path-guard.ts). Replaces a vacuous lexical check.
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbGuard = resolveGuardedPath(brainBase, [id]);
      if (!kbGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const kbDir = kbGuard.realPath;

      // 6. Reject if already exists (409). `exists` is lstat-based, so a
      // DANGLING symlink occupying the slot is a 400 from the guard above
      // rather than the EEXIST-500 the old `existsSync` produced — and can
      // never become a create-through-the-link.
      if (kbGuard.exists) {
        sendJson(res, 409, { error: `kb already exists: ${id}` }, origin);
        return true;
      }
      // 6b. W7-B2 (knowledge-V01): the id must be unique across BOTH
      // containment roots — brain/<id> (checked above) AND the central
      // per-project root brain/projects/<id> (ADR 035). Without this, a new
      // KB named after an already-onboarded project scaffolded a second,
      // empty kb.yaml at brain/<id> that resolveKbBrainDir (roots tried in
      // order [brain/, brain/projects/]) then resolved FIRST — silently
      // shadowing the project's real central brain everywhere.
      if (resolveKbBrainDir(ctx.forgeRoot, id)) {
        sendJson(res, 409, { error: `kb already exists: ${id} (its brain lives at brain/projects/${id})` }, origin);
        return true;
      }

      // 7. Scaffold: mkdir brain/<id>/ + brain/<id>/themes/ + brain/<id>/_raw/
      mkdirSync(join(kbDir, 'themes'), { recursive: true });
      mkdirSync(join(kbDir, '_raw'), { recursive: true });

      // 8. Write brain/<id>/kb.yaml via the canonical serializer (leaves
      // `processes` absent — the KB resolves every obligation to its default
      // via resolveKbProcesses until an operator opts into an override).
      // forge-3oq: stamp `origin: 'studio'` on every KB created through this
      // route — mirrors the flow write path's `origin: existing?.origin ??
      // 'studio'` stamp (cli/bridge-studio-writes.ts). Never 'seed' — that
      // token is reserved for the two shipped OOTB brains, committed by
      // hand, so an operator-created KB can never claim OOTB provenance.
      const kbYamlPath = join(kbDir, 'kb.yaml');
      writeFileSync(kbYamlPath, serializeKbDescriptor({ id, name, binding, desc, path: kbYamlPath, origin: 'studio' }), 'utf8');

      // 9. Verify loadKbDescriptor can round-trip it
      loadKbDescriptor(kbYamlPath);

      // 10. R1-06-F2: hand off to a project-brain seeding session — mirrors
      // POST /api/project-brain/start's `{ ok: true, sessionId }` contract
      // (cli/ui-bridge.ts:3797-3826) plus its status.json write, so the new,
      // still-empty KB gets a REAL agentic seeding pass through the SAME
      // shell (GET /api/studio/sessions/project-brain/:sessionId) rather
      // than a separate, competing seed path (T1 ruling Q3 removed the old
      // POST .../bootstrap route for exactly this reason). The session
      // carries the created KB's OWN descriptor (kb_id/kb_binding) so a
      // flow/band-scoped KB seeds against its real scope, not a re-derived
      // `{kind:'project'}` guess (T1 ruling Q4).
      //
      // Session-dir anchor: a project binding nests the session under its
      // own (real, discovered) project dir — the established architect/
      // instructions/demo-builder shape, and a real project so it is a
      // legitimate discovered project, not a phantom. Every other binding kind
      // has no natural project home; anchoring it under the bare KB id created a
      // top-level `projects/<kbId>/` dir that `discoverProjects` surfaced as a
      // PHANTOM project (MAJOR 2). It nests under a dot-prefixed anchor instead,
      // which `discoverProjects` filters out while the runner still finds its
      // status there (via the anchored `projectRoot`).
      const projectsRoot = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const sessionProject = binding.kind === 'project' ? binding.ref : `${KB_SEEDING_ANCHOR_PREFIX}${id}`;
      // The write itself lives in `bridge-studio-kbs.ts`, which already owns
      // this package's coupling to `@forge/sessions` (approveKbCleanup reads
      // and writes session status there). Keeping the create route's one
      // session write in the same module means the KB surface has ONE edge to
      // sessions rather than one per file that happens to need a session —
      // the split must not multiply the package's boundary rows.
      const sessionId = mintProjectBrainSeedingSession(projectsRoot, sessionProject, id, binding);

      // W7-B2 (knowledge-23): `project` (the seeding session's anchor) rides
      // along so the create form can LINK the operator to the session it
      // just spawned instead of silently discarding the sessionId.
      sendJson(res, 200, { ok: true, id, sessionId, project: sessionProject }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * DELETE /api/studio/kbs/:id — remove a knowledge base (R1-5).
 *
 * Declared as an honest DELETE (T1 ruling 28): the method is what the host
 * dispatches on, so the table row states the method the handler actually
 * guards rather than the POST-shaped approximation a mutating-route table
 * would otherwise imply.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbDelete(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- DELETE /api/studio/kbs/:id (R1-5) — remove a knowledge base --------
  const kbDeleteMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbDeleteMatch && method === 'DELETE') {
    try {
      const id = decodeURIComponent(kbDeleteMatch[1]);
      if (!KB_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      // Guard the forge-owned core brains (the three-brain model) from deletion.
      if (id === 'cycles' || id === 'forge-dev') {
        sendJson(res, 403, { error: `the forge-owned brain "${id}" cannot be deleted` }, origin);
        return true;
      }
      const dir = resolveKbBrainDir(ctx.forgeRoot, id);
      if (!dir || !existsSync(dir)) {
        sendJson(res, 404, { error: `unknown kb: ${id}` }, origin);
        return true;
      }
      // W7-B2 (knowledge-05): never delete a KB out from under a live job.
      const deleteActiveJob = deriveKbActiveJob(ctx.forgeRoot, id);
      if (deleteActiveJob) {
        sendJson(res, 409, { error: activeJobReason(deleteActiveJob), runId: deleteActiveJob.runId }, origin);
        return true;
      }
      // Containment is enforced at the choke point: `resolveKbBrainDir` now
      // runs the per-segment realpath identity walk, so `dir` is either a
      // verified real directory under `brain/` (or `brain/projects/`) or
      // null. The lexical `resolve(dir).startsWith(brainBase + sep)` check
      // that stood here was vacuous — it compared a path the same function
      // had just built against that path's own prefix — and is removed rather
      // than kept as false assurance.
      rmSync(dir, { recursive: true, force: true });
      // W7-B2 (knowledge-24): tidy the sessions anchored to this KB instead
      // of orphaning them in the sessions index. A NON-project KB's sessions
      // all live under its own dot-anchor pseudo-project
      // (`projects/.kb-<id>/`) — server-derived, safe to remove wholesale. A
      // project-bound KB shares its REAL project's dir, so its kb-cleanup
      // sessions are only REPORTED (their kb_id names a dead KB now), never
      // swept along with the project's own state.
      const projectsRootForDelete = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const anchorGuard = resolveGuardedPath(projectsRootForDelete, [`${KB_SEEDING_ANCHOR_PREFIX}${id}`]);
      let removedSessionAnchor = false;
      if (anchorGuard.ok && anchorGuard.exists) {
        rmSync(anchorGuard.realPath, { recursive: true, force: true });
        removedSessionAnchor = true;
      }
      const orphanedSessions: string[] = [];
      try {
        for (const projName of readdirSync(projectsRootForDelete)) {
          if (projName.startsWith('.')) continue; // dot-anchors handled above
          const cleanupDir = join(projectsRootForDelete, projName, '_kb-cleanup');
          if (!existsSync(cleanupDir)) continue;
          for (const sid of readdirSync(cleanupDir)) {
            try {
              const st = JSON.parse(readFileSync(join(cleanupDir, sid, 'status.json'), 'utf8')) as { kb_id?: unknown };
              if (st.kb_id === id) orphanedSessions.push(`${projName}/_kb-cleanup/${sid}`);
            } catch {
              // unreadable session — not attributable to this KB
            }
          }
        }
      } catch {
        // best-effort reporting only — the delete itself already succeeded
      }
      sendJson(res, 200, { ok: true, id, removedSessionAnchor, orphanedSessions }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * POST /api/studio/kbs/:id/guidance — write a KB guidance note (M5-3).
 *
 * Size-capped at GUIDANCE_MAX_BYTES and path-guarded through guardKbTail,
 * whose header records why the lexical `startsWith` guard it replaced was
 * structurally incapable of failing.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbGuidance(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/studio/kbs/:id/guidance (M5-3) -------------------------
  const guidanceMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/guidance$/);
  if (guidanceMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(guidanceMatch[1]);

      // 1. Slug-guard kbId before any fs operation (blocks path traversal)
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // 2. Containment: resolve the kb dir through the guarded choke point.
      // This replaces a vacuous `resolve(brainBase, kbId).startsWith(...)`
      // check AND fixes a second, latent bug it was hiding — that check built
      // `brain/<id>` unconditionally, so guidance for a per-project brain
      // (`brain/projects/<id>`, ADR 035) was written to the wrong directory.
      const kbDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
      if (!kbDir) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // 3. Resolve kb (must have a kb.yaml — use loadKbDescriptors to find it)
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      const kb = kbs.find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // 4. Parse request body
      let body: unknown;
      try {
        body = await ctx.readBody();
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 5. Validate text (non-empty)
      const text = typeof b['text'] === 'string' ? b['text'].trim() : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required and must be non-empty' }, origin);
        return true;
      }

      // 5b. Guidance length cap (Fix #2)
      if (Buffer.byteLength(text, 'utf8') > GUIDANCE_MAX_BYTES) {
        sendJson(res, 400, { error: 'guidance text too large' }, origin);
        return true;
      }

      // 6. Validate targetNode if present (charset + path guard)
      const targetNodeRaw = b['targetNode'];
      let targetNode: string | undefined;
      if (targetNodeRaw !== undefined && targetNodeRaw !== null && targetNodeRaw !== '') {
        if (typeof targetNodeRaw !== 'string') {
          sendJson(res, 400, { error: 'targetNode must be a string' }, origin);
          return true;
        }
        // Node ids may have 'raw:' prefix — allow alphanumeric, dash, underscore, colon, dot
        const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
        if (!NODE_ID_RE.test(targetNodeRaw)) {
          sendJson(res, 400, { error: 'invalid targetNode — must be a valid node id' }, origin);
          return true;
        }
        targetNode = targetNodeRaw;
      }

      // 7. Resolve `_guidance/` with a real per-segment identity check.
      // THIS IS THE ARBITRARY-FILE-WRITE FIX (bd `forge-wze`): a genuinely
      // real `brain/<id>/` whose `_guidance` is a SYMLINK pointing outside
      // `brain/` was confirmed live writing an attacker-supplied payload to an
      // attacker-chosen location, 200 OK. The two checks removed here compared
      // a string against itself and could never fire.
      const guidanceGuard = guardKbTail(kbDir, '_guidance');
      if (!guidanceGuard.ok) {
        // Fixed, generic message — the guard's own `reason` names which
        // segment failed, which is a fingerprinting aid for an attacker
        // iterating on it, so it is never forwarded to the client.
        sendJson(res, 400, { error: 'path traversal detected in guidance dir' }, origin);
        return true;
      }
      const guidanceDir = guidanceGuard.realPath;

      // 8. Mkdir _guidance/ if absent (create-mode: the guard proved the tail
      // does not exist yet, so it cannot currently be a symlink or hardlink).
      if (!guidanceGuard.exists) {
        mkdirSync(guidanceDir, { recursive: true });
      }

      // 9. Build filename: ISO-timestamp slug (e.g. 2026-06-13T14-30-00-000Z.md)
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${ts}.md`;

      // Re-guard the full tail now that `_guidance/` exists — closes a planted
      // symlink/hardlink AT the leaf, not merely at its parent.
      const fileGuard = guardKbTail(kbDir, '_guidance', filename);
      if (!fileGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected in guidance file' }, origin);
        return true;
      }
      const filePath = fileGuard.realPath;

      // 10. Write frontmatter + body
      const frontmatterLines = [
        '---',
        `created_at: "${new Date().toISOString()}"`,
        ...(targetNode ? [`target_node: "${targetNode}"`] : []),
        '---',
        '',
        text,
      ];
      writeFileSync(filePath, frontmatterLines.join('\n'), 'utf8');

      sendJson(res, 200, { ok: true, file: `brain/${kbId}/_guidance/${filename}` }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
