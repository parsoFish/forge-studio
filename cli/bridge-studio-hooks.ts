/**
 * Forge Studio hooks-library bridge routes (R3-03-F4).
 *
 * Owns EVERY `/api/studio/hooks*` route — one home, mirroring how
 * cli/bridge-studio-skills.ts owns every `/api/studio/skills*` route:
 *
 *   GET  /api/studio/hooks               → { hooks: HookLibraryEntry[] }
 *   GET  /api/studio/hooks/:id           → detail: entry fields + files + scan
 *   POST /api/studio/hooks               → author a new library hook
 *   POST /api/studio/hooks/:id/approve   → approve (refuses a blocked verdict)
 *   POST /api/studio/hooks/:id/override  → distinct recorded override
 *
 * Over the ALREADY-SHIPPED core (orchestrator/studio/hook-library.ts F1,
 * hook-scan.ts F2/F3). The bridge COMPOSES `listHookLibrary` (F1) with
 * `hookRunState` / `readHookApprovalLedger` (F2/F3) per entry — those stay
 * separate core modules; this composition is this bridge module's own job.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS (mirrored from cli/bridge-studio-hooks.test.ts's own
 * header — that file is this module's spec):
 *
 *  D-1. Response envelope: `{ hooks: [...] }` (list) / a flat detail object
 *       (entry fields + `files` + `scan`).
 *  D-2. Every ok:true entry additionally carries `scanVerdict` (the raw F2
 *       scan verdict), `trust` (D-3), and `runnable` (F2/F3's
 *       `hookRunState().runnable`). The raw `script` relative path is NEVER
 *       forwarded on the transport — the detail route's `files` array is the
 *       one place a hook's actual script content is exposed.
 *  D-3. `trust`: needsReview → 'needs-review'; a ledger entry present, hashes
 *       match, overridden:false → 'approved'; overridden:true → 'overridden'
 *       (verdict is whatever it was at override time — OVERRIDE NEVER
 *       LAUNDERS IT).
 *  D-4. A malformed on-disk hook (ok:false in listHookLibrary) is VISIBLE in
 *       the LIST route but the DETAIL route 404s for it — "cannot be loaded
 *       as a valid hook" reads the same as "doesn't exist" from the detail
 *       route's perspective, making a fabricated 200-with-invented-scan/files
 *       structurally impossible.
 *  D-5. POST /api/studio/hooks always writes the script to the fixed
 *       relative path `scripts/run.sh` inside the new hook's directory — no
 *       client-supplied script path is ever accepted.
 *  D-6. POST /api/studio/hooks rejects (400) a body carrying any of
 *       hook-library.ts's `FORBIDDEN_HOOK_BINDING_KEYS` — never silently
 *       drops them, and validation happens before any filesystem write so a
 *       rejected create leaves no half-written package on disk.
 *  D-7. Approve on a blocked verdict → 409 (state conflict) — checked at the
 *       route level BEFORE calling `approveHook` (rather than string-matching
 *       its thrown message), so the ledger is provably left untouched.
 *
 * Every id-bearing route resolves the id through `assertSkillSlug` /
 * `hookYamlPath` / `hookDir` (orchestrator/skill-path.ts +
 * orchestrator/studio/hook-library.ts), which slug-validate and throw on
 * anything that isn't a bare lowercase-kebab path segment — traversal,
 * absolute paths, encoded/double-encoded escapes, null bytes, and
 * over-length ids are all rejected there, before any filesystem read, and
 * the throw is reported as 400 (never a 500, never a raw stack trace).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveGuardedPath } from './studio-path-guard.ts';
import yaml from 'js-yaml';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
import { assertSkillSlug } from '../orchestrator/skill-path.ts';
import {
  hookDir,
  hooksDir,
  hookYamlPath,
  listHookLibrary,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from '../orchestrator/studio/hook-library.ts';
import {
  scanHookPackage,
  hookRunState,
  readHookApprovalLedger,
  approveHook,
  overrideHookBlock,
  type HookApprovalLedgerEntry,
  type HookRunState,
} from '../orchestrator/studio/hook-scan.ts';

// ---------------------------------------------------------------------------
// trust derivation (D-3) — the bridge's own composition, not a core export:
// the two source-of-truth primitives (hookRunState / the ledger entry) stay
// in hook-scan.ts; only the label mapping lives here.
// ---------------------------------------------------------------------------

export type HookTrust = 'needs-review' | 'approved' | 'overridden';

function computeTrust(runState: HookRunState, ledgerEntry: HookApprovalLedgerEntry | undefined): HookTrust {
  if (runState.needsReview) return 'needs-review';
  return ledgerEntry?.overridden === true ? 'overridden' : 'approved';
}

/** Compose one ok:true library entry with its live trust/runnable facts.
 *  Deliberately builds a NEW object with an explicit field list — the raw
 *  `script` relative path is never forwarded (D-2). */
function toClientListEntry(forgeRoot: string, entry: ReturnType<typeof listHookLibrary>[number]): Record<string, unknown> {
  if (!entry.ok) {
    return {
      ok: false,
      id: entry.id,
      carriedBy: entry.carriedBy,
      carriedByDerivation: entry.carriedByDerivation,
      error: sanitizeError(entry.error ?? 'malformed hook'),
    };
  }
  const runState = hookRunState(forgeRoot, entry.id);
  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(entry.id);
  return {
    ok: true,
    id: entry.id,
    name: entry.name,
    description: entry.description,
    on: entry.on,
    ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
    permissions: entry.permissions,
    carriedBy: entry.carriedBy,
    carriedByDerivation: entry.carriedByDerivation,
    scanVerdict: runState.verdict,
    trust: computeTrust(runState, ledgerEntry),
    runnable: runState.runnable,
  };
}

/** Decode a URL path segment; throws (never silently passes through a raw,
 *  still-encoded id) on malformed percent-encoding. */
function decodeIdSegment(raw: string): string {
  return decodeURIComponent(raw);
}

// ---------------------------------------------------------------------------
// POST body validation — create route
// ---------------------------------------------------------------------------

function parseCreatePermissions(raw: unknown): HookPermissionManifest | { error: string } {
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleStudioHooksRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' && method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/hooks — the library listing -----------------------
  if (method === 'GET' && url === '/api/studio/hooks') {
    try {
      const hooks = listHookLibrary(ctx.forgeRoot).map((entry) => toClientListEntry(ctx.forgeRoot, entry));
      sendJson(res, 200, { hooks }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/hooks — author a new library hook (D-5, D-6) ------
  if (method === 'POST' && url === '/api/studio/hooks') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      if (b === null || typeof b !== 'object' || Array.isArray(b)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }

      for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
        if (key in b) {
          sendJson(res, 400, {
            error: `hook creation must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
          }, origin);
          return true;
        }
      }

      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      const description = typeof b['description'] === 'string' ? b['description'].trim() : '';
      const on = typeof b['on'] === 'string' ? b['on'] : '';
      const scriptBody = typeof b['scriptBody'] === 'string' ? b['scriptBody'] : '';
      const matcher = typeof b['matcher'] === 'string' && b['matcher'].trim() ? b['matcher'].trim() : undefined;

      if (!name) { sendJson(res, 400, { error: 'name is required' }, origin); return true; }
      if (!description) { sendJson(res, 400, { error: 'description is required' }, origin); return true; }
      if (!on) { sendJson(res, 400, { error: 'on is required' }, origin); return true; }
      if (!(HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(on)) {
        sendJson(res, 400, { error: `"on" must be one of ${HOOK_LIFECYCLE_EVENTS.join(', ')} — got "${on}"` }, origin);
        return true;
      }
      if (!scriptBody) { sendJson(res, 400, { error: 'scriptBody is required' }, origin); return true; }

      const permissions = parseCreatePermissions(b['permissions']);
      if ('error' in permissions) { sendJson(res, 400, { error: permissions.error }, origin); return true; }

      const slug = (typeof b['id'] === 'string' && b['id'].trim() ? b['id'].trim() : name)
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      // Layer 1 — SHAPE: `hookDir` runs `assertSkillSlug` (charset only).
      try {
        hookDir(slug, ctx.forgeRoot);
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return true;
      }

      // Layer 2 — CONTAINMENT (bd `forge-wze` sweep). `hookDir`/`hookYamlPath`
      // are `assertSkillSlug` + a bare `join()`, so a pre-planted symlinked
      // `studio/hooks/<slug>` directory was followed and this route CREATED
      // `hook.yaml` + `scripts/run.sh` through it, outside the repo (confirmed
      // live). `studio/hooks/` is the fixed root; `slug` is its own segment,
      // never folded into that root (./studio-path-guard.ts, CONTRACT).
      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [slug, 'hook.yaml']);
      if (!yamlGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      if (yamlGuard.exists) {
        sendJson(res, 409, { error: `hook "${slug}" already exists` }, origin);
        return true;
      }
      const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [slug, 'scripts', 'run.sh']);
      if (!scriptGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const hookYaml = yamlGuard.realPath;
      const hookScript = scriptGuard.realPath;

      const doc: Record<string, unknown> = {
        name,
        description,
        on: on as HookLifecycleEvent,
        ...(matcher ? { matcher } : {}),
        script: 'scripts/run.sh',
        permissions,
      };

      mkdirSync(dirname(hookScript), { recursive: true });
      writeFileSync(hookScript, scriptBody, 'utf8');
      writeFileSync(hookYaml, yaml.dump(doc), 'utf8');

      sendJson(res, 200, { ok: true, id: slug }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/hooks/:id/approve — refuses a blocked verdict (D-7) --
  const approveMatch = url.match(/^\/api\/studio\/hooks\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(approveMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }

      // Layer 1 — SHAPE (assertSkillSlug); layer 2 — CONTAINMENT via the shared
      // realpath identity guard, closing the symlinked-`studio/hooks/<id>`
      // write-through. A guard rejection returns the SAME 404 as a genuinely
      // unknown hook, so this route is not a probe for planted ids.
      try { hookYamlPath(id, ctx.forgeRoot); } catch (err) { sendJson(res, 400, { error: sanitizeError(err) }, origin); return true; }

      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, 'hook.yaml']);
      if (!yamlGuard.ok || !yamlGuard.exists) { sendJson(res, 404, { error: `unknown hook "${id}"` }, origin); return true; }

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

  // ---- POST /api/studio/hooks/:id/override — distinct recorded act --------
  const overrideMatch = url.match(/^\/api\/studio\/hooks\/([^/]+)\/override$/);
  if (overrideMatch && method === 'POST') {
    try {
      let id: string;
      try { id = decodeIdSegment(overrideMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }

      // Layer 1 — SHAPE (assertSkillSlug); layer 2 — CONTAINMENT via the shared
      // realpath identity guard, closing the symlinked-`studio/hooks/<id>`
      // write-through. A guard rejection returns the SAME 404 as a genuinely
      // unknown hook, so this route is not a probe for planted ids.
      try { hookYamlPath(id, ctx.forgeRoot); } catch (err) { sendJson(res, 400, { error: sanitizeError(err) }, origin); return true; }

      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, 'hook.yaml']);
      if (!yamlGuard.ok || !yamlGuard.exists) { sendJson(res, 404, { error: `unknown hook "${id}"` }, origin); return true; }

      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
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

  // ---- GET /api/studio/hooks/:id — detail (D-4: malformed reads as absent) --
  const detailMatch = url.match(/^\/api\/studio\/hooks\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    try {
      let id: string;
      try { id = decodeIdSegment(detailMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      try { assertSkillSlug(id); } catch (err) { sendJson(res, 400, { error: sanitizeError(err) }, origin); return true; }

      const entry = listHookLibrary(ctx.forgeRoot).find((e) => e.id === id);
      if (!entry || entry.ok !== true) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }

      // CONTAINMENT: read only through the identity-verified real paths. The
      // `listHookLibrary` lookup above filters on dirent type, which excludes
      // a symlinked hook DIR by accident — but not a symlinked or hardlinked
      // LEAF inside a real dir, and `entry.script` is a hook.yaml-supplied
      // relative path, so it is walked as segments rather than joined blind.
      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, 'hook.yaml']);
      const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, ...entry.script.split('/')]);
      if (!yamlGuard.ok || !yamlGuard.exists || !scriptGuard.ok || !scriptGuard.exists) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }
      const yamlBody = readFileSync(yamlGuard.realPath, 'utf8');
      const scriptBody = readFileSync(scriptGuard.realPath, 'utf8');
      const scan = scanHookPackage(ctx.forgeRoot, id);
      const runState = hookRunState(ctx.forgeRoot, id);
      const ledgerEntry = readHookApprovalLedger(ctx.forgeRoot).get(id);

      sendJson(res, 200, {
        ok: true,
        id: entry.id,
        name: entry.name,
        description: entry.description,
        on: entry.on,
        ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
        permissions: entry.permissions,
        carriedBy: entry.carriedBy,
        carriedByDerivation: entry.carriedByDerivation,
        scanVerdict: runState.verdict,
        trust: computeTrust(runState, ledgerEntry),
        runnable: runState.runnable,
        files: [
          { path: 'hook.yaml', body: yamlBody },
          { path: entry.script, body: scriptBody },
        ],
        scan,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
