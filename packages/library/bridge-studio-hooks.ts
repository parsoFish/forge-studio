/**
 * Forge Studio hooks-library bridge routes (R3-03-F4).
 *
 * Owns the LIST / CREATE / DELETE routes plus every shared containment,
 * wire-projection and body-validation helper the whole category uses.
 * `POST .../:id/decline` lives in `bridge-studio-hooks-decline.ts`,
 * approve/override/revoke-approval in `bridge-studio-hooks-approval.ts`, and
 * PUT/detail in `bridge-studio-hooks-detail.ts` — this file sat AT the
 * 800-line cap with zero headroom (forge-8vfn.5.39), so the category is now
 * carved by responsibility (mirroring `bridge-studio-community-crud.ts`'s
 * precedent, and `bridge-studio-hooks-decline.ts`'s own split before it),
 * exactly how `bridge-studio-skills.ts` owns every `/api/studio/skills*`
 * route:
 *
 *   GET  /api/studio/hooks               → { hooks: HookLibraryEntry[] }         (handleHooksList, HERE)
 *   POST /api/studio/hooks               → author a new library hook             (handleHookCreate, HERE)
 *   DELETE /api/studio/hooks/:id         → delete                                (handleHookDelete, HERE)
 *   GET  /api/studio/hooks/:id           → detail: entry fields + files + scan   (bridge-studio-hooks-detail.ts)
 *   PUT  /api/studio/hooks/:id           → edit                                  (bridge-studio-hooks-detail.ts)
 *   POST /api/studio/hooks/:id/approve   → approve (refuses a blocked verdict)   (bridge-studio-hooks-approval.ts)
 *   POST /api/studio/hooks/:id/override  → distinct recorded override            (bridge-studio-hooks-approval.ts)
 *   POST /api/studio/hooks/:id/revoke-approval → drop a live approval            (bridge-studio-hooks-approval.ts)
 *
 * `decodeIdSegment`/`locateHook`/`parseCreatePermissions`/`hookWireFields`
 * stay HERE and are exported for the sibling files to import — id
 * resolution/containment and the wire-projection stay the ONE place each has
 * always been, never duplicated per file (the same reuse decline.ts already
 * documents for the first two). `handleHookDelete` (the one route in this
 * category that combines a destroy call with the `hooksDir` containment
 * idiom) stays HERE alongside `locateHook`, which is what it resolves
 * through — `packages/agents/tests/contract/destroy-prunes-ledger.test.ts`'s
 * census keys off that co-occurrence by file, not by symbol.
 *
 * Over the ALREADY-SHIPPED core (packages/library/studio/hook-library.ts F1,
 * hook-scan.ts F2/F3). The bridge COMPOSES `listHookLibrary` (F1) with
 * `hookRunState` / `readHookApprovalLedger` (F2/F3) per entry — those stay
 * separate core modules; this composition is this bridge module's own job.
 *
 * M4 route-carve: each route above used to be one arm of a single dispatcher,
 * `handleStudioHooksRoutes`, that `apps/forge/ui-bridge.ts` called directly. That
 * dispatcher is now gone — `packages/library/routes.ts` is what dispatches
 * these, as a table. Each handler below keeps the SAME five-parameter
 * contract the dispatcher's arms ran under —
 * `(req, res, ctx, rawUrl, method): Promise<boolean>` — normalises its own
 * url via `pathOnly` (a handler that skipped this would fail its own
 * anchored regex against `/api/studio/hooks?x=1` and 404 silently), computes
 * its own `origin` via `allowedOrigin`, and returns `false` on a non-match so
 * it still composes as a passthrough. `sendJson`/`allowedOrigin`/
 * `sanitizeError`/`pathOnly`/`StudioContext`/`RouteContext` come from
 * `@forge/kernel` — never the legacy host module, which would be a
 * `package-to-legacy` boundary violation. The old body reader import is gone
 * entirely; every route that reads a body now calls `ctx.readBody()` (the
 * host-supplied reader `RouteContext` carries) instead.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS (mirrored from packages/library/tests/integration/bridge-studio-hooks.test.ts's own
 * header — that file is this module's spec, covering EVERY file in the
 * category, not just this one):
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
 * packages/library/studio/hook-library.ts), which slug-validate and throw on
 * anything that isn't a bare lowercase-kebab path segment — traversal,
 * absolute paths, encoded/double-encoded escapes, null bytes, and
 * over-length ids are all rejected there, before any filesystem read, and
 * the throw is reported as 400 (never a 500, never a raw stack trace).
 */

import type { AgentFacts } from './studio/agent-facts.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveGuardedPath } from '@forge/kernel';
import yaml from 'js-yaml';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  originOfHookOrTemplate,
  type StudioContext,
  type RouteContext,
} from '@forge/kernel';
import { isReservedId } from '@forge/kernel';
import {
  hookDir,
  hooksDir,
  hookYamlPath,
  listHookLibrary,
  loadHookDefinition,
  HOOK_LIFECYCLE_EVENTS, FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
  hookTriggerError,
} from './studio/hook-library.ts';
import { hookRunState, readHookApprovalLedger, readHookDeclinedLedger, revokeHookApprovalIfPresent, type HookApprovalLedgerEntry, type HookDeclinedLedgerEntry, type HookRunState } from './studio/hook-approval-ledger.ts';

// ---------------------------------------------------------------------------
// trust derivation (D-3) — the bridge's own composition, not a core export:
// the two source-of-truth primitives (hookRunState / the ledger entry) stay
// in hook-scan.ts; only the label mapping lives here.
// ---------------------------------------------------------------------------

export type HookTrust = 'needs-review' | 'approved' | 'overridden' | 'declined';

// `declined` (forge-8vfn.5.2) is reachable ONLY inside `needsReview` — a display label, it never widens what runState already grants.
function computeTrust(runState: HookRunState, ledgerEntry: HookApprovalLedgerEntry | undefined, declinedEntry?: HookDeclinedLedgerEntry): HookTrust {
  if (runState.needsReview) return declinedEntry ? 'declined' : 'needs-review';
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
  let runState, ledgerEntry, declinedEntry;
  try {
    runState = hookRunState(forgeRoot, entry.id);
    ledgerEntry = readHookApprovalLedger(forgeRoot).get(entry.id);
    declinedEntry = readHookDeclinedLedger(forgeRoot).get(entry.id);
  } catch (err) {
    return {
      ok: false,
      id: entry.id,
      carriedBy: entry.carriedBy,
      carriedByDerivation: entry.carriedByDerivation,
      error: sanitizeError(err),
    };
  }
  return { ok: true, ...hookWireFields(entry, runState, ledgerEntry, declinedEntry) };
}

/** The hook's wire projection, in ONE place — written out twice before, twelve
 *  identical fields each. Costs 5 lines net: the point is the drift (608).
 *  Exported: `bridge-studio-hooks-detail.ts`'s detail route reuses it rather
 *  than duplicating the field list a second time. */
export function hookWireFields(
  entry: ReturnType<typeof listHookLibrary>[number],
  runState: ReturnType<typeof hookRunState>,
  ledgerEntry: Parameters<typeof computeTrust>[1],
  declinedEntry: Parameters<typeof computeTrust>[2],
): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    on: entry.on,
    ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
    permissions: entry.permissions,
    // forge-8vfn.8.3.7: server-attested, never client-inferred — the ONE
    // shared mapping every hook/template bridge route uses (kernel's own
    // charter, mirrors provenanceOfOrigin's role for Flow/KB).
    origin: originOfHookOrTemplate(entry.origin),
    carriedBy: entry.carriedBy,
    carriedByDerivation: entry.carriedByDerivation,
    scanVerdict: runState.verdict,
    trust: computeTrust(runState, ledgerEntry, declinedEntry),
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
 *  still-encoded id) on malformed percent-encoding. Exported: bridge-studio-
 *  hooks-decline.ts reuses this rather than duplicating it. */
export function decodeIdSegment(raw: string): string {
  return decodeURIComponent(raw);
}

/**
 * W7-B4 — the shared two-layer prologue every id-bearing WRITE route runs:
 * shape (assertSkillSlug via hookYamlPath → 400), containment (the realpath
 * identity guard → 404), and the script-leaf containment oracle-closer
 * (→ the SAME 404). Returns the verified hook.yaml real path on success.
 * Exported for the same reason as `decodeIdSegment` above.
 */
export function locateHook(
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

/** Exported: `bridge-studio-hooks-detail.ts`'s PUT route reuses this for the
 *  same body-shape rules create uses (D-6 sibling), never a second copy. */
export function parseCreatePermissions(raw: unknown): HookPermissionManifest | { error: string } {
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
// Route handlers
// ---------------------------------------------------------------------------

/** GET /api/studio/hooks — the library listing. */
/** Route matcher, hoisted so `routes.ts` and every handler that matches an
 *  `:id`-only path (HERE and in `bridge-studio-hooks-detail.ts`) share ONE
 *  source — see `bridge-studio-skills.ts` for the silent drift this
 *  prevents. The approve/override/revoke-approval matchers live beside
 *  their own handlers in `bridge-studio-hooks-approval.ts`. */
export const HOOK_ID_RE = /^\/api\/studio\/hooks\/([^/]+)$/;

export async function handleHooksList(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string, facts: AgentFacts): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  if (method === 'GET' && url === '/api/studio/hooks') {
    try {
      const hooks = listHookLibrary(ctx.forgeRoot, facts).map((entry) => toClientListEntry(ctx.forgeRoot, entry));
      sendJson(res, 200, { hooks }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/** POST /api/studio/hooks — author a new library hook (D-5, D-6). */
export async function handleHookCreate(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  if (method === 'POST' && url === '/api/studio/hooks') {
    try {
      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
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
        // forge-8vfn.8.3.7: stamped server-side, unconditionally — any
        // "origin" the client sent in the request body was never read above
        // and is discarded here; the server, never the caller, attests it.
        origin: 'operator',
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

  return false;
}

/**
 * DELETE /api/studio/hooks/:id (W7-B4, library-08).
 *
 * Refuses (409, naming them) while any agent still carries the hook.
 */
export async function handleHookDelete(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string, facts: AgentFacts): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const putMatch = url.match(HOOK_ID_RE);
  if (putMatch && method === 'DELETE') {
    try {
      let id: string;
      try { id = decodeIdSegment(putMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      // requireScript:false — removal must stay possible for a hook whose yaml
      // is malformed or whose script leaf is gone (review finding 4).
      const located = locateHook(ctx.forgeRoot, id, { requireScript: false });
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      const entry = listHookLibrary(ctx.forgeRoot, facts).find((e) => e.id === id);
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

  return false;
}
