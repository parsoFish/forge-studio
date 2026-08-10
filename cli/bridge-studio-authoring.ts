/**
 * Forge Studio authoring-session finalize route (R4-21, WI-2: the OOTB
 * authoring agent / skill-hook package producer, save path).
 *
 * Owns the ONE `/api/studio/authoring*` route:
 *
 *   POST /api/studio/authoring/finalize   → save the creation-agent
 *                                            session's drafted package into
 *                                            the real skill or hook library
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS (mirrored from cli/bridge-studio-authoring.test.ts's own
 * header — that file is this module's spec):
 *
 *  D-1. ONE route: `POST /api/studio/authoring/finalize`. A `kind` field
 *       discriminates skill vs. hook — the two existing library write paths
 *       this route composes stay entirely unchanged and unmoved.
 *  D-2. Skill finalize (`kind:'skill'`) reuses EXACTLY the existing inline-
 *       upload contract `POST /api/studio/skills/install` already accepts
 *       (SEC-05 q80): `{ id, entries: [{path, contentBase64}], upstream:
 *       {source, ref?} }`, staged via the same server-side guarded stage
 *       (cli/skill-staging.ts) and installed via the SAME
 *       `installSkillPackage` (orchestrator/studio/skill-library.ts) —
 *       check-then-write, whole-package validation BEFORE any write, so a
 *       rejected draft leaves no half-written `skills/<id>/`.
 *  D-3. Hook finalize (`kind:'hook'`) reuses EXACTLY the existing
 *       `POST /api/studio/hooks` body shape (`name, description, on,
 *       scriptBody, matcher?, permissions?`) and its write contract: always
 *       writes the script to the fixed relative path `scripts/run.sh` inside
 *       the new hook's directory, and rejects (400) any body carrying one of
 *       `hook-library.ts`'s `FORBIDDEN_HOOK_BINDING_KEYS` before any
 *       filesystem write.
 *  D-4. Response envelope: `{ ok: true, kind, id }` on success — mirrors both
 *       source routes' flat `{ ok: true, id }` shape, with `kind` added so a
 *       caller that only has the finalize response (not the request it sent)
 *       can still tell which library the id landed in.
 *  D-5. Finalize installs a skill as a DRAFT (`status: 'draft', library:
 *       false`) — it NEVER auto-approves. Palette visibility is gated behind
 *       the EXISTING, SEPARATE `POST /api/studio/skills/:id/approve` route —
 *       a skill finalized through this route is listSkillLibrary-visible
 *       immediately but `paletteVisible:false` until that separate act.
 *  D-6. Containment for BOTH kinds goes through the SAME choke points the
 *       existing routes already use — `resolveGuardedPath`/`guardedFile`
 *       (cli/studio-path-guard.ts) for the id-derived destination, and
 *       `stageSkillPackage`'s own guarded stage for skill entries — never a
 *       fresh lexical `startsWith` reimplementation specific to this route.
 *
 * The validation/write STEPS for each kind are intentionally re-stated here
 * (not cross-imported handler-to-handler) rather than factored out of
 * cli/bridge-studio-skills.ts / cli/bridge-studio-hooks.ts — the underlying
 * PRIMITIVES those routes write through (`stageSkillPackage`,
 * `installSkillPackage`, `resolveGuardedPath`, `hooksDir`/`hookDir`,
 * `HOOK_LIFECYCLE_EVENTS`, `FORBIDDEN_HOOK_BINDING_KEYS`) are the SAME ones
 * this route calls — there is exactly one write path per kind, just reached
 * from two request shapes.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import yaml from 'js-yaml';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';
import { stageSkillPackage } from './skill-staging.ts';
import { installSkillPackage } from '../orchestrator/studio/skill-library.ts';
import {
  hookDir,
  hooksDir,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from '../orchestrator/studio/hook-library.ts';

const FINALIZE_URL = '/api/studio/authoring/finalize';

// SEC-05 q80 (d1) mirror: total decoded-bytes cap on an inline-upload
// finalize, same value and rationale as cli/bridge-studio-skills.ts's
// MAX_STAGED_PACKAGE_BYTES (kept at or below the transport's MAX_BODY_BYTES
// so a staged package can never exceed what the body reader already admits).
const MAX_STAGED_PACKAGE_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Server-minted, unpredictable staging id — mirrors
 *  cli/bridge-studio-skills.ts's own `newSourceId` exactly (never derived
 *  from client input: the guarded stage's containment proof rests on this
 *  being fully server-controlled). */
function newSourceId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// kind:"skill" — D-2, reuses the EXACT inline-upload contract + write path
// POST /api/studio/skills/install already uses.
// ---------------------------------------------------------------------------

async function finalizeSkill(
  b: Record<string, unknown>,
  ctx: StudioContext,
  res: ServerResponse,
  origin: string,
): Promise<void> {
  const sourceId = newSourceId();
  const stagingRoot = resolve(ctx.forgeRoot, '_skill-staging');
  try {
    const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
    if (!id) { sendJson(res, 400, { error: 'id is required' }, origin); return; }

    const rawEntries = b['entries'];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      sendJson(res, 400, { error: 'entries is required (a non-empty array of { path, contentBase64 })' }, origin); return;
    }
    const entries: Array<{ path: string; contentBase64: string }> = [];
    let totalDecodedBytes = 0;
    for (const raw of rawEntries) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        sendJson(res, 400, { error: 'each entry must be an object { path, contentBase64 }' }, origin); return;
      }
      const e = raw as Record<string, unknown>;
      const entryPath = typeof e['path'] === 'string' ? e['path'] : '';
      if (!entryPath) { sendJson(res, 400, { error: 'each entry.path must be a non-empty string' }, origin); return; }
      if (entryPath.startsWith('/')) { sendJson(res, 400, { error: `entry.path "${entryPath}" must not be absolute` }, origin); return; }
      if (entryPath.split('/').includes('..')) { sendJson(res, 400, { error: `entry.path "${entryPath}" must not contain a ".." segment` }, origin); return; }
      if (typeof e['contentBase64'] !== 'string') { sendJson(res, 400, { error: `entry "${entryPath}" contentBase64 must be a string` }, origin); return; }
      const contentBase64 = e['contentBase64'];
      totalDecodedBytes += Buffer.from(contentBase64, 'base64').length;
      if (totalDecodedBytes > MAX_STAGED_PACKAGE_BYTES) {
        sendJson(res, 413, { error: `staged package exceeds the ${MAX_STAGED_PACKAGE_BYTES}-byte cap` }, origin); return;
      }
      entries.push({ path: entryPath, contentBase64 });
    }

    const rawUpstream = b['upstream'];
    if (rawUpstream === null || typeof rawUpstream !== 'object' || Array.isArray(rawUpstream)) {
      sendJson(res, 400, { error: 'upstream is required (upstream.source)' }, origin); return;
    }
    const upstreamObj = rawUpstream as Record<string, unknown>;
    const source = typeof upstreamObj['source'] === 'string' ? upstreamObj['source'].trim() : '';
    if (!source) { sendJson(res, 400, { error: 'upstream.source is required' }, origin); return; }
    const ref = typeof upstreamObj['ref'] === 'string' && upstreamObj['ref'].trim() ? upstreamObj['ref'].trim() : undefined;

    try {
      // stagingRoot must exist before the guard resolves against it
      // (resolveGuardedPath realpath's its root and refuses a missing one).
      mkdirSync(stagingRoot, { recursive: true });
      const stagedDir = stageSkillPackage(stagingRoot, sourceId, entries);
      // D-5: installSkillPackage always lands status:draft/library:false —
      // finalize never calls approveSkillDraft. Palette visibility is the
      // operator's separate, later act at POST /api/studio/skills/:id/approve.
      installSkillPackage({
        forgeRoot: ctx.forgeRoot,
        id,
        packageDir: stagedDir,
        upstream: ref ? { source, ref } : { source },
      });
      sendJson(res, 200, { ok: true, kind: 'skill', id }, origin);
    } catch (err) {
      // Every stageSkillPackage / installSkillPackage throw (traversal entry,
      // duplicate target, bad slug, cap exceeded, binary file, no SKILL.md at
      // the package root, escaping skills/<id> destination, ...) is a
      // caller-input problem by contract — 400, never a 500 here.
      sendJson(res, 400, { error: sanitizeError(err) }, origin);
    }
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  } finally {
    // Clean the private staging dir on BOTH success and throw — sourceId is
    // server-minted, so this join targets exactly this request's dir; force
    // makes it a no-op when staging never wrote (e.g. a body-validation 400
    // that returned before the mkdir above).
    rmSync(join(stagingRoot, sourceId), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// kind:"hook" — D-3, reuses the EXACT 2-file write contract + D-6 rejection
// POST /api/studio/hooks already uses.
// ---------------------------------------------------------------------------

function parseFinalizeHookPermissions(raw: unknown): HookPermissionManifest | { error: string } {
  if (raw === undefined) return { env: [], read: [], network: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'permissions must be an object' };
  }
  const p = raw as Record<string, unknown>;
  const env = p['env'];
  const read = p['read'];
  const network = p['network'];
  if (env !== undefined && (!Array.isArray(env) || !env.every((x) => typeof x === 'string'))) {
    return { error: 'permissions.env must be an array of strings' };
  }
  if (read !== undefined && (!Array.isArray(read) || !read.every((x) => typeof x === 'string'))) {
    return { error: 'permissions.read must be an array of strings' };
  }
  if (network !== undefined && typeof network !== 'boolean') {
    return { error: 'permissions.network must be a boolean' };
  }
  return {
    env: Array.isArray(env) ? (env as string[]) : [],
    read: Array.isArray(read) ? (read as string[]) : [],
    network: network === true,
  };
}

async function finalizeHook(
  b: Record<string, unknown>,
  ctx: StudioContext,
  res: ServerResponse,
  origin: string,
): Promise<void> {
  try {
    // D-6: the SAME forbidden-binding-key rejection POST /api/studio/hooks
    // enforces, checked BEFORE any filesystem write.
    for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
      if (key in b) {
        sendJson(res, 400, {
          error: `hook creation must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
        }, origin);
        return;
      }
    }

    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    const description = typeof b['description'] === 'string' ? b['description'].trim() : '';
    const on = typeof b['on'] === 'string' ? b['on'] : '';
    const scriptBody = typeof b['scriptBody'] === 'string' ? b['scriptBody'] : '';
    const matcher = typeof b['matcher'] === 'string' && b['matcher'].trim() ? b['matcher'].trim() : undefined;

    if (!name) { sendJson(res, 400, { error: 'name is required' }, origin); return; }
    if (!description) { sendJson(res, 400, { error: 'description is required' }, origin); return; }
    if (!on) { sendJson(res, 400, { error: 'on is required' }, origin); return; }
    if (!(HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(on)) {
      sendJson(res, 400, { error: `"on" must be one of ${HOOK_LIFECYCLE_EVENTS.join(', ')} — got "${on}"` }, origin);
      return;
    }
    if (!scriptBody) { sendJson(res, 400, { error: 'scriptBody is required' }, origin); return; }

    const permissions = parseFinalizeHookPermissions(b['permissions']);
    if ('error' in permissions) { sendJson(res, 400, { error: permissions.error }, origin); return; }

    const slug = (typeof b['id'] === 'string' && b['id'].trim() ? b['id'].trim() : name)
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Layer 1 — SHAPE: `hookDir` runs `assertSkillSlug` (charset only).
    try {
      hookDir(slug, ctx.forgeRoot);
    } catch (err) {
      sendJson(res, 400, { error: sanitizeError(err) }, origin);
      return;
    }

    // Layer 2 — CONTAINMENT (D-6): the SAME guarded choke point
    // POST /api/studio/hooks uses — never a fresh lexical startsWith.
    const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [slug, 'hook.yaml']);
    if (!yamlGuard.ok) {
      sendJson(res, 400, { error: 'path traversal detected' }, origin);
      return;
    }
    if (yamlGuard.exists) {
      sendJson(res, 409, { error: `hook "${slug}" already exists` }, origin);
      return;
    }
    const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [slug, 'scripts', 'run.sh']);
    if (!scriptGuard.ok) {
      sendJson(res, 400, { error: 'path traversal detected' }, origin);
      return;
    }
    const hookYaml = yamlGuard.realPath;
    const hookScript = scriptGuard.realPath;

    const doc: Record<string, unknown> = {
      name,
      description,
      on: on as HookLifecycleEvent,
      ...(matcher ? { matcher } : {}),
      // D-3: the SAME fixed relative script path POST /api/studio/hooks
      // always writes — no client-supplied script path, ever.
      script: 'scripts/run.sh',
      permissions,
    };

    mkdirSync(dirname(hookScript), { recursive: true });
    writeFileSync(hookScript, scriptBody, 'utf8');
    writeFileSync(hookYaml, yaml.dump(doc), 'utf8');

    sendJson(res, 200, { ok: true, kind: 'hook', id: slug }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleStudioAuthoringRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  if (url !== FINALIZE_URL) return false;

  const origin = allowedOrigin(req);

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return true;
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
    return true;
  }

  const kind = b['kind'];
  if (kind === 'skill') {
    await finalizeSkill(b, ctx, res, origin);
    return true;
  }
  if (kind === 'hook') {
    await finalizeHook(b, ctx, res, origin);
    return true;
  }
  sendJson(res, 400, { error: 'kind is required and must be "skill" or "hook"' }, origin);
  return true;
}
