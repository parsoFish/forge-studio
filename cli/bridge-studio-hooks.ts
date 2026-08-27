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
 *       (entry fields + `files` + `packageHash` + `scan`). `files` is EVERY
 *       real file under the package directory (`readHookPackage`, hook-
 *       package.ts), each carrying a `sha256:<hex>` content hash
 *       (`hashHookScript`); `packageHash` is the whole-package fingerprint
 *       (`hashHookPackage`) — the exact value the approval ledger pins
 *       (PIN E, 2026-08-28 hostile review: the file list used to be two
 *       hardcoded reads, hook.yaml + the declared entry script, so a sibling
 *       file a script sources — e.g. `scripts/lib.sh` — was invisible to the
 *       approving operator even though the ledger already covered it).
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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { assertSkillSlug, isReservedId } from '../orchestrator/skill-path.ts';
import {
  hookDir,
  hooksDir,
  hookYamlPath,
  listHookLibrary,
  loadHookDefinition,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
  hookTriggerError,
} from '../orchestrator/studio/hook-library.ts';
import {
  scanHookPackage,
  hookRunState,
  readHookApprovalLedger,
  approveHook,
  overrideHookBlock,
  revokeHookApproval,
  revokeHookApprovalIfPresent,
  type HookApprovalLedgerEntry,
  type HookRunState,
} from '../orchestrator/studio/hook-scan.ts';
// PIN E (2026-08-28 hostile review): the whole-package read/hash primitives
// the detail route's `files`/`packageHash` are now built from — the SAME
// primitives the approval ledger's `packageHash` pin is computed from (see
// hook-package.ts's own header), so what this route lists and what the
// ledger pins are structurally the same file set, never two independently
// maintained views that can drift.
import { readHookPackage, hashHookPackage, hashHookScript } from '../orchestrator/studio/hook-package.ts';

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
  // FAULT ISOLATION (SEC-01 round 4). `listHookLibrary` already degrades a
  // malformed hook to `{ok:false, error}` per entry — and this function used
  // to throw that isolation away, because `hookRunState` reads the script off
  // disk and can throw (EISDIR on `script: "scripts/."`, ENOTDIR on
  // `"scripts/run.sh/"`, ENOENT on a backslash component, or a containment
  // rejection). Called inside the listing route's bare `.map()`, one such hook
  // made the whole map throw and the operator's ENTIRE hook library vanished
  // behind a 500. An element-level fault must never become a collection-level
  // claim; degrade this one entry exactly as listHookLibrary already does.
  let runState;
  let ledgerEntry;
  try {
    runState = hookRunState(forgeRoot, entry.id);
    ledgerEntry = readHookApprovalLedger(forgeRoot).get(entry.id);
  } catch (err) {
    return {
      ok: false,
      id: entry.id,
      carriedBy: entry.carriedBy,
      carriedByDerivation: entry.carriedByDerivation,
      error: sanitizeError(err),
    };
  }
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

/**
 * Is this hook's declared `script:` genuinely contained within its own package
 * directory, by per-segment identity rather than a lexical prefix test?
 *
 * Module-local on purpose (the WI's zero-new-exports bound). Empty and `.`
 * components are dropped because `path.resolve` tolerates them everywhere else
 * — rejecting a legitimate `scripts//run.sh` would 404 a valid hook — while a
 * `..` is left in place so `isSafeSegment` rejects it. Any failure to load or
 * resolve reports `false`, so the caller answers 404 rather than surfacing a
 * distinguishable error.
 */
function hookScriptIsContained(forgeRoot: string, id: string): boolean {
  try {
    const def = loadHookDefinition(id, forgeRoot);
    const segments = def.script.split('/').filter((seg) => seg !== '' && seg !== '.');
    const guard = resolveGuardedPath(hooksDir(forgeRoot), [id, ...segments]);
    return guard.ok && guard.exists;
  } catch {
    return false;
  }
}

/** Decode a URL path segment; throws (never silently passes through a raw,
 *  still-encoded id) on malformed percent-encoding. */
function decodeIdSegment(raw: string): string {
  return decodeURIComponent(raw);
}

/**
 * W7-B4 — the shared two-layer prologue every id-bearing WRITE route runs:
 * shape (assertSkillSlug via hookYamlPath → 400), containment (the realpath
 * identity guard → 404), and the script-leaf containment oracle-closer
 * (→ the SAME 404). Returns the verified hook.yaml real path on success.
 */
function locateHook(
  forgeRoot: string,
  id: string,
  opts: { requireScript?: boolean } = {},
): { ok: true; yamlPath: string } | { ok: false; status: number; error: string } {
  try {
    hookYamlPath(id, forgeRoot);
  } catch (err) {
    return { ok: false, status: 400, error: sanitizeError(err) };
  }
  const yamlGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'hook.yaml']);
  if (!yamlGuard.ok || !yamlGuard.exists) return { ok: false, status: 404, error: `unknown hook "${id}"` };
  // W7-B4 review finding 4: `hookScriptIsContained` is a SCRIPT-path oracle —
  // it returns false both for a genuinely escaping script AND for any hook
  // whose hook.yaml fails to parse or whose declared script leaf is simply
  // missing. Routes that touch the script path need it; DELETE does NOT (it
  // removes the guarded directory and never resolves `script:`), and running
  // it there made every broken hook permanently unremovable from Studio while
  // the library kept rendering it. `requireScript: false` is that exemption,
  // never a relaxation for a route that goes on to use the script path.
  if (opts.requireScript !== false && !hookScriptIsContained(forgeRoot, id)) {
    return { ok: false, status: 404, error: `unknown hook "${id}"` };
  }
  return { ok: true, yamlPath: yamlGuard.realPath };
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
  // PUT/DELETE joined in W7-B4 (library-08): the edit/delete half of CRUD.
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return false;

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
      // W8-B6 — the SAME predicate lintHookDefinitions and hook dispatch use.
      // Gated on BOTH write routes: gating create alone would leave PUT as the
      // open door, which is the one-of-N shape this repo keeps paying for.
      {
        const triggerError = hookTriggerError(on as HookLifecycleEvent, matcher);
        if (triggerError) { sendJson(res, 400, { error: triggerError }, origin); return true; }
      }

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
      // W7-A4 (crosscut-20): `new` is the /hooks/new builder segment, never a hook.
      if (isReservedId(slug)) {
        sendJson(res, 400, { error: `hook id "${slug}" is reserved (the /hooks/new builder lives at that path) — choose another name` }, origin);
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

      // The hook.yaml guard above does not cover the SCRIPT leaf. Without this,
      // a hook whose hook.yaml is real but whose script symlinks outside its
      // package threw out of hookRunState into the generic 500 handler — a
      // distinguishable status where every other route in this change returns
      // 404, i.e. a working oracle for "an id exists here and its script
      // escapes containment". Nothing leaked (sanitizeError redacts the path),
      // but the status code alone was the signal.
      if (!hookScriptIsContained(ctx.forgeRoot, id)) { sendJson(res, 404, { error: `unknown hook "${id}"` }, origin); return true; }

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

      // The hook.yaml guard above does not cover the SCRIPT leaf. Without this,
      // a hook whose hook.yaml is real but whose script symlinks outside its
      // package threw out of hookRunState into the generic 500 handler — a
      // distinguishable status where every other route in this change returns
      // 404, i.e. a working oracle for "an id exists here and its script
      // escapes containment". Nothing leaked (sanitizeError redacts the path),
      // but the status code alone was the signal.
      if (!hookScriptIsContained(ctx.forgeRoot, id)) { sendJson(res, 404, { error: `unknown hook "${id}"` }, origin); return true; }

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

  // ---- POST /api/studio/hooks/:id/revoke-approval (W7-B4, library-08) ------
  // The inverse of approve/override that never existed: drops the LIVE ledger
  // entry (hookRunState honestly reads needs-review again) and RECORDS the
  // revocation in the ledger's `revoked` list. 409 when nothing is approved.
  const revokeMatch = url.match(/^\/api\/studio\/hooks\/([^/]+)\/revoke-approval$/);
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

  // ---- PUT /api/studio/hooks/:id — edit (W7-B4, library-08) ----------------
  // Edits the definition fields and/or the script. An edit to an APPROVED
  // hook is legitimate — the pinned hashes no longer match, so hookRunState
  // honestly reads needs-review again; nothing here launders trust. The same
  // D-5/D-6 rules as create: no client script path, no binding keys.
  const putMatch = url.match(/^\/api\/studio\/hooks\/([^/]+)$/);
  if (putMatch && method === 'PUT') {
    try {
      let id: string;
      try { id = decodeIdSegment(putMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      if (b === null || typeof b !== 'object' || Array.isArray(b)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }
      for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
        if (key in b) {
          sendJson(res, 400, {
            error: `hook edit must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
          }, origin);
          return true;
        }
      }

      // W7-B4 review finding 9: an ABSENT field means "leave it alone"; a
      // field that is PRESENT but empty is a request the route cannot honour.
      // Both used to collapse to the same `&& value` falsy test, so clearing
      // the editor answered ok:true and kept the old bytes — a save the
      // operator watched succeed and which changed nothing.
      for (const key of ['name', 'description', 'scriptBody'] as const) {
        if (key in b && (typeof b[key] !== 'string' || !(b[key] as string).trim())) {
          sendJson(res, 400, {
            error: `"${key}" was sent empty — send a non-empty value to change it, or omit the field to leave it unchanged`,
          }, origin);
          return true;
        }
      }

      const def = loadHookDefinition(id, ctx.forgeRoot);

      const name = typeof b['name'] === 'string' && b['name'].trim() ? b['name'].trim() : def.name;
      const description = typeof b['description'] === 'string' && b['description'].trim() ? b['description'].trim() : def.description;
      let on = def.on;
      if (b['on'] !== undefined) {
        if (typeof b['on'] !== 'string' || !(HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(b['on'])) {
          sendJson(res, 400, { error: `"on" must be one of ${HOOK_LIFECYCLE_EVENTS.join(', ')} — got "${String(b['on'])}"` }, origin);
          return true;
        }
        on = b['on'] as HookLifecycleEvent;
      }
      let matcher = def.matcher;
      if ('matcher' in b) {
        matcher = typeof b['matcher'] === 'string' && b['matcher'].trim() ? b['matcher'].trim() : undefined;
      }
      {
        const triggerError = hookTriggerError(on, matcher);
        if (triggerError) { sendJson(res, 400, { error: triggerError }, origin); return true; }
      }
      let permissions = def.permissions;
      if (b['permissions'] !== undefined) {
        const parsed = parseCreatePermissions(b['permissions']);
        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }, origin); return true; }
        permissions = parsed;
      }
      const scriptBody = typeof b['scriptBody'] === 'string' && b['scriptBody'] ? b['scriptBody'] : undefined;

      // Script leaf: the EXISTING declared script path, re-guarded segment by
      // segment (D-5: a client can never supply a script path).
      if (scriptBody !== undefined) {
        const scriptSegments = def.script.split('/').filter((s) => s !== '' && s !== '.');
        const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, ...scriptSegments]);
        if (!scriptGuard.ok || !scriptGuard.exists) {
          sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
          return true;
        }
        writeFileSync(scriptGuard.realPath, scriptBody, 'utf8');
      }

      const doc: Record<string, unknown> = {
        name,
        description,
        on,
        ...(matcher ? { matcher } : {}),
        script: def.script,
        permissions,
      };
      writeFileSync(located.yamlPath, yaml.dump(doc), 'utf8');
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- DELETE /api/studio/hooks/:id (W7-B4, library-08) --------------------
  // Refuses (409, naming them) while any agent still carries the hook.
  if (putMatch && method === 'DELETE') {
    try {
      let id: string;
      try { id = decodeIdSegment(putMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      // requireScript:false — removal must stay possible for a hook whose yaml
      // is malformed or whose script leaf is gone (review finding 4).
      const located = locateHook(ctx.forgeRoot, id, { requireScript: false });
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      const entry = listHookLibrary(ctx.forgeRoot).find((e) => e.id === id);
      const carriedBy = entry?.ok === true ? entry.carriedBy : [];
      if (carriedBy.length > 0) {
        sendJson(res, 409, {
          error: `hook "${id}" is still carried by ${carriedBy.length} agent(s): ${carriedBy.join(', ')} — unbind it from their builders first`,
          carriedBy,
        }, origin);
        return true;
      }
      // W8-B4 (library-34): revoke BEFORE removing the directory — a crash
      // between the two steps then fails CLOSED (an orphaned package that
      // still needs re-review) rather than fails OPEN (a gone package whose
      // stale ledger row would bless a future byte-identical recreation).
      // Tolerant of "nothing to revoke" (revokeHookApprovalIfPresent, not
      // revokeHookApproval) — deleting a never-approved hook is the common
      // case, not an error, and must not 500.
      revokeHookApprovalIfPresent({ forgeRoot: ctx.forgeRoot, id });
      rmSync(dirname(located.yamlPath), { recursive: true, force: true });
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
      try { assertSkillSlug(id, 'hook'); } catch (err) { sendJson(res, 400, { error: sanitizeError(err) }, origin); return true; }

      const entry = listHookLibrary(ctx.forgeRoot).find((e) => e.id === id);
      if (!entry || entry.ok !== true) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }

      // CONTAINMENT (unknown-hook 404, D-4): the two guards below establish
      // "this hook genuinely exists" — `listHookLibrary`'s dirent-type filter
      // excludes a symlinked hook DIR by accident, but not a symlinked or
      // hardlinked LEAF inside a real dir, and `entry.script` is a
      // hook.yaml-supplied relative path, so it is walked as segments rather
      // than joined blind.
      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, 'hook.yaml']);
      // Split `script` into guard segments, dropping only the components that
      // carry no meaning — an empty string (from `scripts//run.sh`, which
      // `path.resolve` tolerates everywhere else, so rejecting it here would
      // 404 a perfectly valid hook) and `.`. A `..` is deliberately NOT
      // dropped: it must reach `isSafeSegment` and be rejected.
      const scriptSegments = entry.script.split('/').filter((s) => s !== '' && s !== '.');
      const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, ...scriptSegments]);
      if (!yamlGuard.ok || !yamlGuard.exists || !scriptGuard.ok || !scriptGuard.exists) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }
      // PIN E (2026-08-28 hostile review): the file BODIES are no longer read
      // through the two guards above alone. `readHookPackage` is the SAME
      // whole-package primitive the approval ledger's `packageHash` pin is
      // computed from — it walks and leaf-guards EVERY file under the
      // package directory on its own (independent of yamlGuard/scriptGuard,
      // which only establish "this id exists"), so what this route lists and
      // what the ledger pins are now, structurally, the same file set: no
      // sibling file can be invisible here while still counting toward the
      // pinned fingerprint. A planted symlink/socket/etc. leaf ANYWHERE in
      // the package makes `readHookPackage` THROW — refusing to silently omit
      // an unreadable file from a listing that claims to be complete — and
      // that throw is caught by this route's own try/catch below and
      // reported as a plain 500, exactly like any other unexpected failure
      // past this point (never a fabricated 200 with a partial file list).
      const packageFiles = readHookPackage(ctx.forgeRoot, id);
      const files = packageFiles.map((f) => ({ path: f.path, body: f.body, hash: hashHookScript(f.body) }));
      const packageHash = hashHookPackage(packageFiles);
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
        // W7-B4 (library-09): the approval RECORD the resolved-state panel
        // renders — approvedAt + the distinct overridden act + its reason.
        // Present iff a live ledger entry exists; never fabricated.
        ...(ledgerEntry
          ? {
              approval: {
                approvedAt: ledgerEntry.approvedAt,
                overridden: ledgerEntry.overridden,
                ...(ledgerEntry.reason ? { reason: ledgerEntry.reason } : {}),
              },
            }
          : {}),
        files,
        packageHash,
        scan,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
