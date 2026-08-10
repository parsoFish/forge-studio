/**
 * Forge Studio authoring-session finalize route (R4-21 phase 2, WI-2 — the
 * OOTB authoring agent / skill-hook package producer, save path).
 *
 * Owns the ONE `/api/studio/authoring*` route:
 *
 *   POST /api/studio/authoring/finalize   → the operator's COMMIT act: drive
 *                                            the creation-agent session's
 *                                            `committing` turn and install
 *                                            the LANDED package into the real
 *                                            skill or hook library
 *
 * ---------------------------------------------------------------------------
 * CONTRACT (D5, `_wave5/unit-specs/R4-21-phase2.md`; mirrored from
 * `cli/bridge-studio-authoring.test.ts`'s own header — that file is this
 * module's spec):
 *
 *  Wire contract: `POST /api/studio/authoring/finalize { project, sessionId,
 *  kind: 'skill'|'hook', id }` — NOTHING ELSE is read from the body. The
 *  installed artifact's bytes come from the server-landed package, never the
 *  request body (closes the client-supplied-content sink the phase-1 shape
 *  had).
 *
 *  Sequence:
 *   1. Resolve the projects root the SAME way every other bridge route does
 *      (`resolveProjectsDir` + `loadConfig`/`defaultConfigPath`) — never a
 *      hardcoded `<cwd>/projects`.
 *   2. Resolve the session dir with `project` and `sessionId` EACH riding as
 *      their own guarded segment — `resolveGuardedPath(projectsRoot,
 *      [project, '_authoring', sessionId])`. Never folded into the root (that
 *      would make containment tautological — see
 *      `cli/studio-path-guard.ts`'s own CONTRACT section).
 *   3. Read `status.json` through the guarded read (leaf included, via
 *      `orchestrator/interactive-session.ts`'s `guardedReadSessionStatus` —
 *      the SAME primitive `runInteractiveTurn` itself uses). Require
 *      `phase === 'awaiting-review'` → 409 naming the current AND required
 *      phase otherwise. Never a silent 200.
 *   4. Guarded-write the status with `package_id: id` and `phase:
 *      'committing'` (`guardedWriteSessionStatus`).
 *   5. Run ONE turn on the SAME spine the CLI dispatches to —
 *      `runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot })`
 *      — imported DYNAMICALLY (see below). The `committing` step performs no
 *      SDK spawn (it runs `copyStagingToLibrary`), so this call is fast and
 *      deterministic. Assert the returned phase is `committed`; anything else
 *      fails loud (5xx), never a silent success on an unfinished turn.
 *   6. Read the LANDED package at `<forgeRoot>/_interactive-library/<id>/`
 *      through the guard and install:
 *        - `kind:'skill'` → `installSkillPackage` with a SERVER-MINTED
 *          `upstream: { source: 'forge-authoring', ref: sessionId }` — never
 *          read from the request body (a client cannot supply its own
 *          provenance). Lands a DRAFT; `approveSkillDraft` is NEVER called
 *          here — palette visibility stays the operator's separate, later
 *          act at `POST /api/studio/skills/:id/approve` (D6).
 *        - `kind:'hook'` → hook metadata is read from the LANDED
 *          `hook.yaml` (parsed server-side), never from body fields: refuse
 *          (400, nothing written) on a `FORBIDDEN_HOOK_BINDING_KEYS` key, an
 *          `on` outside `HOOK_LIFECYCLE_EVENTS`, or a hook.yaml that is
 *          missing/unparseable/not a mapping — fail loud, never fabricate a
 *          default. Otherwise write the existing 2-file shape (`hook.yaml` +
 *          the fixed relative `scripts/run.sh`) through the SAME guarded
 *          choke points `POST /api/studio/hooks` already uses.
 *   7. `{ ok: true, kind, id }`.
 *
 *  Design call: a hook-specific validation failure at step 6 does NOT roll
 *  back step 5's already-successful generic copy — nothing in D5 describes a
 *  rollback, and `interactive-finalizers.ts`'s own header disclaims any
 *  hook-shape awareness at that layer (it is a generic COPY primitive). The
 *  negative hook paths below therefore assert the ARTIFACT step 6 alone owns
 *  (`hooks/<id>/` absent), not whether the session's `status.json` phase gets
 *  reverted — an unspecified, implementation-owned detail.
 *
 *  Every refusal leaves the filesystem untouched at the layer it owns — the
 *  pinned tests assert the ARTIFACT (file/dir absence), not just the status
 *  code.
 * ---------------------------------------------------------------------------
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
import { resolveGuardedPath, guardedReadFile } from './studio-path-guard.ts';
import { installSkillPackage } from '../orchestrator/studio/skill-library.ts';
import {
  hookDir,
  hooksDir,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from '../orchestrator/studio/hook-library.ts';
import { reqString, optString, oneOf } from '../orchestrator/studio/yaml-fields.ts';
import { resolveProjectsDir, loadConfig, defaultConfigPath } from '../orchestrator/config.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import { loadSessionKinds } from '../orchestrator/studio/session-kinds.ts';
// Type-only — erased by --experimental-strip-types, so this does NOT pull the
// Claude Agent SDK into bridge start-up. The runtime function is imported
// DYNAMICALLY, inside runFinalize, below (mirrors cli/agent-run.ts's own
// project-brain-builder-runner dynamic-import precedent).
import type { InteractiveTurnStatus, RunInteractiveTurnResult } from '../orchestrator/interactive-runner.ts';

const FINALIZE_URL = '/api/studio/authoring/finalize';

/** Server-minted provenance for every package this route installs — the
 *  provenance of an authored package IS the session that authored it. Never
 *  read from the request body (a client-supplied upstream is unverifiable). */
const AUTHORING_UPSTREAM_SOURCE = 'forge-authoring';

/** The dedicated, non-scanned landing root `runInteractiveTurn`'s
 *  `copyStagingToLibrary` finalizer writes into (`orchestrator/
 *  interactive-runner.ts`'s own `INTERACTIVE_LIBRARY_DIRNAME` constant,
 *  mirrored here since that one is module-private). */
const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

const REQUIRED_PHASE = 'awaiting-review';

function parseFinalizeHookPermissions(raw: unknown): HookPermissionManifest | { error: string } {
  if (raw === undefined) return { env: [], read: [], network: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'hook.yaml permissions must be an object' };
  }
  const p = raw as Record<string, unknown>;
  const env = p['env'];
  const read = p['read'];
  const network = p['network'];
  if (env !== undefined && (!Array.isArray(env) || !env.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.env must be an array of strings' };
  }
  if (read !== undefined && (!Array.isArray(read) || !read.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.read must be an array of strings' };
  }
  if (network !== undefined && typeof network !== 'boolean') {
    return { error: 'hook.yaml permissions.network must be a boolean' };
  }
  return {
    env: Array.isArray(env) ? (env as string[]) : [],
    read: Array.isArray(read) ? (read as string[]) : [],
    network: network === true,
  };
}

// ---------------------------------------------------------------------------
// kind:"skill" — installs the LANDED package (_interactive-library/<id>/) via
// the SAME installSkillPackage every other skill-install path uses.
// ---------------------------------------------------------------------------

async function finalizeSkillFromLanded(
  forgeRoot: string,
  packageDir: string,
  id: string,
  sessionId: string,
  res: ServerResponse,
  origin: string,
): Promise<void> {
  try {
    // D-5/D6: always lands a DRAFT (status:'draft', library:false) —
    // approveSkillDraft is never called from this route. Upstream is
    // SERVER-MINTED, never read from the request body.
    installSkillPackage({
      forgeRoot,
      id,
      packageDir,
      upstream: { source: AUTHORING_UPSTREAM_SOURCE, ref: sessionId },
    });
    sendJson(res, 200, { ok: true, kind: 'skill', id }, origin);
  } catch (err) {
    // Every installSkillPackage throw (bad slug, no SKILL.md at the package
    // root, cap exceeded, binary file, escaping destination, ...) is a
    // caller-input problem by contract — 400, never a 500 here.
    sendJson(res, 400, { error: sanitizeError(err) }, origin);
  }
}

// ---------------------------------------------------------------------------
// kind:"hook" — hook METADATA comes from the LANDED, DRAFTED hook.yaml,
// parsed server-side, never from parallel request-body fields.
// ---------------------------------------------------------------------------

function finalizeHookFromLanded(forgeRoot: string, id: string, res: ServerResponse, origin: string): void {
  const yamlRaw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, 'hook.yaml']);
  if (yamlRaw === null) {
    sendJson(res, 400, { error: `drafted hook.yaml is missing from the landed package "${id}"` }, origin);
    return;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlRaw);
  } catch (err) {
    sendJson(res, 400, { error: `drafted hook.yaml is not valid YAML: ${sanitizeError(err)}` }, origin);
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendJson(res, 400, { error: 'drafted hook.yaml must be a YAML mapping (object), not a scalar/array/null' }, origin);
    return;
  }
  const doc = parsed as Record<string, unknown>;

  // The SAME forbidden-binding-key rejection POST /api/studio/hooks
  // enforces, checked BEFORE any filesystem write — now against the LANDED
  // hook.yaml's own fields.
  for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
    if (key in doc) {
      sendJson(res, 400, {
        error: `drafted hook.yaml must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
      }, origin);
      return;
    }
  }

  let name: string;
  let description: string;
  let on: HookLifecycleEvent;
  try {
    name = reqString(doc, 'name', 'hook.yaml');
    description = reqString(doc, 'description', 'hook.yaml');
    on = oneOf(reqString(doc, 'on', 'hook.yaml'), HOOK_LIFECYCLE_EVENTS, 'hook.yaml', 'on');
  } catch (err) {
    sendJson(res, 400, { error: sanitizeError(err) }, origin);
    return;
  }
  const matcher = optString(doc, 'matcher');

  const permissions = parseFinalizeHookPermissions(doc['permissions']);
  if ('error' in permissions) {
    sendJson(res, 400, { error: permissions.error }, origin);
    return;
  }

  const scriptRaw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, 'scripts', 'run.sh']);
  if (scriptRaw === null) {
    sendJson(res, 400, { error: `drafted scripts/run.sh is missing from the landed package "${id}"` }, origin);
    return;
  }

  // Layer 1 — SHAPE: `hookDir` runs `assertSkillSlug` (charset only).
  try {
    hookDir(id, forgeRoot);
  } catch (err) {
    sendJson(res, 400, { error: sanitizeError(err) }, origin);
    return;
  }

  // Layer 2 — CONTAINMENT: the SAME guarded choke point
  // POST /api/studio/hooks uses — never a fresh lexical startsWith.
  const yamlGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'hook.yaml']);
  if (!yamlGuard.ok) {
    sendJson(res, 400, { error: 'path traversal detected' }, origin);
    return;
  }
  if (yamlGuard.exists) {
    sendJson(res, 409, { error: `hook "${id}" already exists` }, origin);
    return;
  }
  const scriptGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'scripts', 'run.sh']);
  if (!scriptGuard.ok) {
    sendJson(res, 400, { error: 'path traversal detected' }, origin);
    return;
  }

  const outDoc: Record<string, unknown> = {
    name,
    description,
    on,
    ...(matcher ? { matcher } : {}),
    // The SAME fixed relative script path POST /api/studio/hooks always
    // writes — never the drafted hook.yaml's own (unvalidated) script field.
    script: 'scripts/run.sh',
    permissions,
  };

  mkdirSync(dirname(scriptGuard.realPath), { recursive: true });
  writeFileSync(scriptGuard.realPath, scriptRaw, 'utf8');
  writeFileSync(yamlGuard.realPath, yaml.dump(outDoc), 'utf8');

  sendJson(res, 200, { ok: true, kind: 'hook', id }, origin);
}

// ---------------------------------------------------------------------------
// D5 — the finalize sequence.
// ---------------------------------------------------------------------------

async function runFinalize(
  ctx: StudioContext,
  res: ServerResponse,
  origin: string,
  input: { project: string; sessionId: string; kind: 'skill' | 'hook'; id: string },
): Promise<void> {
  const { project, sessionId, kind, id } = input;

  try {
    // Step 1 — the projects root, resolved the way every other bridge route
    // does. Never a hardcoded `<cwd>/projects`.
    const projectsRoot = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));

    // Step 2 — `project` and `sessionId` EACH ride as their OWN guarded
    // segment. Never folded into the root.
    const dirSegments = [project, '_authoring', sessionId];
    const sessionGuard = resolveGuardedPath(projectsRoot, dirSegments);
    if (!sessionGuard.ok) {
      sendJson(res, 400, { error: 'invalid project or session' }, origin);
      return;
    }
    if (!sessionGuard.exists) {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return;
    }

    // Step 3 — the guarded read (leaf included) — the SAME primitive
    // runInteractiveTurn itself uses for its own status reads.
    const status = guardedReadSessionStatus<InteractiveTurnStatus>(projectsRoot, dirSegments);
    if (!status) {
      sendJson(res, 404, { error: 'session status not found' }, origin);
      return;
    }
    if (status.phase !== REQUIRED_PHASE) {
      sendJson(res, 409, {
        error: `cannot finalize: session is in phase "${status.phase}", required phase is "${REQUIRED_PHASE}"`,
      }, origin);
      return;
    }

    // Step 4 — guarded-write package_id + phase:'committing'.
    const written = guardedWriteSessionStatus(projectsRoot, dirSegments, { ...status, package_id: id, phase: 'committing' });
    if (written === null) {
      sendJson(res, 500, { error: 'failed to advance session status to "committing"' }, origin);
      return;
    }

    // sessionGuard.realPath === <projectsRoot realpath>/<project>/_authoring/
    // <sessionId> (resolveGuardedPath's own per-segment join order) — the
    // project root is the same value with the trailing two segments
    // stripped. No second guard call needed: the identity of `project` was
    // already fully verified by the walk above.
    const projectRoot = dirname(dirname(sessionGuard.realPath));

    // Step 5 — run ONE turn on the SAME spine the CLI dispatches to.
    // Dynamically imported so a static import never pulls the Claude Agent
    // SDK into bridge start-up (cli/ui-bridge.ts does not import
    // cli/agent-run.ts today) — mirrors cli/agent-run.ts's own
    // project-brain-builder-runner dynamic-import precedent.
    const descriptor = loadSessionKinds(ctx.forgeRoot).find((d) => d.id === 'authoring');
    if (!descriptor) {
      sendJson(res, 500, { error: 'authoring session-kind descriptor not found' }, origin);
      return;
    }
    const { runInteractiveTurn } = await import('../orchestrator/interactive-runner.ts');
    let turnResult: RunInteractiveTurnResult;
    try {
      turnResult = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot: ctx.forgeRoot });
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return;
    }
    if (turnResult.phase !== 'committed') {
      // Never report success on an unfinished turn.
      sendJson(res, 500, { error: `finalize turn did not reach phase "committed" (got "${turnResult.phase}")` }, origin);
      return;
    }

    // Step 6 — read the LANDED package through the guard and install. The
    // bytes come from here, NEVER from the request body.
    const landedGuard = resolveGuardedPath(ctx.forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id]);
    if (!landedGuard.ok || !landedGuard.exists) {
      sendJson(res, 500, { error: 'landed package not found after commit' }, origin);
      return;
    }

    if (kind === 'skill') {
      await finalizeSkillFromLanded(ctx.forgeRoot, landedGuard.realPath, id, sessionId, res, origin);
    } else {
      finalizeHookFromLanded(ctx.forgeRoot, id, res, origin);
    }
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

  // The wire contract is EXACTLY {project, sessionId, kind, id} — nothing
  // else is ever read from the body (D5, WI2-4-wire).
  const project = typeof b['project'] === 'string' ? b['project'] : '';
  const sessionId = typeof b['sessionId'] === 'string' ? b['sessionId'] : '';
  const kind = b['kind'];
  const id = typeof b['id'] === 'string' ? b['id'].trim() : '';

  if (!project) {
    sendJson(res, 400, { error: 'project is required' }, origin);
    return true;
  }
  if (!sessionId) {
    sendJson(res, 400, { error: 'sessionId is required' }, origin);
    return true;
  }
  if (kind !== 'skill' && kind !== 'hook') {
    sendJson(res, 400, { error: 'kind is required and must be "skill" or "hook"' }, origin);
    return true;
  }
  if (!id) {
    sendJson(res, 400, { error: 'id is required' }, origin);
    return true;
  }

  await runFinalize(ctx, res, origin, { project, sessionId, kind, id });
  return true;
}
