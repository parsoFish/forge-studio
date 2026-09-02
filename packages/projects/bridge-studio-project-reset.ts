/**
 * bridge-studio-project-reset.ts — Studio's "Rebuild contract" HTTP routes
 * (S3, 1.0.md §3; M4-projects, the last product piece of the projects lane).
 *
 *   POST /api/studio/projects/:id/contract-reset          — dry-run
 *   POST /api/studio/projects/:id/contract-reset/apply     — apply
 *
 * Both routes are thin HTTP wiring over the capability `reset.ts` already
 * ships: `computeContractDrift` (pure — reads the tree, writes nothing) and
 * `applyContractReset` (writes only the sections the drift it is handed
 * names). Neither route is handed a client-supplied `DriftReport` back —
 * that would let a request body dictate exactly what gets written to
 * `.forge/project.json` and which skill directories get renamed, bypassing
 * every invariant `computeContractDrift` enforces (the row-level
 * never-regenerate-to-undefined guard, the containment-checked skill probe).
 * `apply` therefore computes its OWN fresh drift, from the SAME optional
 * `appType` override the request carries, immediately before applying it —
 * mirroring `cmdProjectReset`'s own single-call shape (compute, then act on
 * that same in-memory report; nothing is round-tripped through a client).
 *
 * APP-TYPE. `computeContractDrift` hard-throws `AppTypeUnresolvedError` when
 * it cannot pin the project to a starter (an onboarded project with no
 * persisted `config.appType` — `terraform-provider-betterado`, S3's own
 * ground). Studio's "Rebuild contract" control is exactly the caller
 * `AppTypeUnresolvedError`'s header anticipates: both routes accept an
 * optional `appType` in the JSON body (the operator's explicit choice,
 * populated client-side from a PRIOR unresolved response's own
 * `availableAppTypes`) and pass it straight through as `opts.appType`. A
 * project with a persisted `appType` never needs it — `resolveAppType`
 * (reset.ts) already prefers the explicit body value only when one is given,
 * falling back to the persisted one otherwise.
 *
 * ERROR SHAPE. `AppTypeUnresolvedError` is caught explicitly and answered
 * 400 with `{ error, availableAppTypes }` — the same typed-catch-then-4xx
 * convention `FixConcernInvalidError`/`FixLoopCapError` use
 * (`packages/flows/bridge-studio-runs.ts`) — never a bare 500 that would
 * hide the one condition here with a concrete, actionable remedy. Every
 * other throw (a malformed on-disk config, a path-guard containment
 * rejection) falls through to the generic `sanitizeError` 500, unchanged
 * from every other route in this package.
 *
 * CONTAINMENT. `id` is resolved the SAME way `cmdProjectReset` resolves it
 * (reset.ts's own header explains why): `resolveGuardedPath(projectsDir,
 * [id])`, never `join(projectsDir, id)` plus a lexical `startsWith` check —
 * a planted symlink at `projects/<id>` must be caught by the guard's
 * `realpathSync` walk, not waved through because the joined string merely
 * LOOKS contained.
 *
 * DRY-BRIDGE. Both routes are `exempt-local` in `cli/dry-bridge.ts`'s
 * `BRIDGE_ROUTE_CLASSIFICATION` — dry-run writes nothing at all (a POST only
 * because the app-type override arrives as a body, the same shape
 * `/api/studio/agents/:slug/instructions-draft` already carries that
 * classification for); apply commits ONLY to the local `forge-studio`
 * branch via `withStudioWrite`/`commitStudioChange` (no push — the same
 * shape `preflight/fix-auto` already carries `exempt-local` for).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  resolveGuardedPath,
  PROJECT_ID_RE,
  type RouteContext,
} from '@forge/kernel';

import { computeContractDrift, applyContractReset, AppTypeUnresolvedError, type DriftReport } from './reset.ts';

const DRY_RUN_RE = /^\/api\/studio\/projects\/([^/]+)\/contract-reset$/;
const APPLY_RE = /^\/api\/studio\/projects\/([^/]+)\/contract-reset\/apply$/;

/**
 * Resolve `id` to its absolute, containment-checked project root, or send an
 * error response and return `null`. Mirrors `cmdProjectReset`'s own
 * resolution (reset.ts) exactly — see this file's header for why that shape,
 * not `resolveManagedProject`'s `discoverProjects` + `startsWith` check
 * (`bridge-studio-project-preflight-write.ts`), is the one this route uses.
 */
function resolveProjectRootForReset(
  ctx: { forgeRoot: string },
  id: string,
  res: ServerResponse,
  origin: string,
): string | null {
  if (!PROJECT_ID_RE.test(id)) {
    sendJson(res, 400, { error: 'invalid project id' }, origin);
    return null;
  }
  const forgeRoot = resolve(ctx.forgeRoot);
  const projectsDir = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
  const guarded = resolveGuardedPath(projectsDir, [id]);
  if (!guarded.ok) {
    sendJson(res, 400, { error: `project path containment check failed: ${guarded.reason}` }, origin);
    return null;
  }
  if (!guarded.exists) {
    sendJson(res, 404, { error: `no project directory for ${id}` }, origin);
    return null;
  }
  return guarded.realPath;
}

/** The wire shape both routes return for a computed drift report — the same
 *  fields `DriftReport` carries, minus `projectDir`/`forgeRoot` (server-local
 *  filesystem paths a client has no use for and must not see echoed back). */
function driftDto(drift: DriftReport): {
  projectId: string;
  appType: string | null;
  rows: DriftReport['rows'];
  skillMoves: DriftReport['skillMoves'];
} {
  return { projectId: drift.projectId, appType: drift.appType, rows: drift.rows, skillMoves: drift.skillMoves };
}

/** Read the optional `{ appType?: string }` body both routes accept. An
 *  empty string reads as "not given" (undefined) — same "not a value worth
 *  passing through" rule the create-project appType field already applies,
 *  and it keeps `resolveAppType`'s persisted-value fallback live for a body
 *  the client sent with the field blank rather than omitted. */
async function readAppTypeBody(ctx: RouteContext): Promise<{ ok: true; appType: string | undefined } | { ok: false }> {
  let body: unknown;
  try {
    body = await ctx.readBody();
  } catch {
    return { ok: false };
  }
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).appType : undefined;
  return { ok: true, appType: typeof raw === 'string' && raw.trim() !== '' ? raw : undefined };
}

// ---------------------------------------------------------------------------
// POST /api/studio/projects/:id/contract-reset — dry-run
// ---------------------------------------------------------------------------

export async function handleProjectContractResetDryRun(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const match = url.match(DRY_RUN_RE);
  if (!(match && method === 'POST')) return false;

  const id = decodeURIComponent(match[1]!);
  const projectRoot = resolveProjectRootForReset(ctx, id, res, origin);
  if (!projectRoot) return true;

  const parsedBody = await readAppTypeBody(ctx);
  if (!parsedBody.ok) {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return true;
  }

  try {
    const drift = computeContractDrift(projectRoot, {
      forgeRoot: ctx.forgeRoot,
      ...(parsedBody.appType !== undefined ? { appType: parsedBody.appType } : {}),
    });
    sendJson(res, 200, { ok: true, drift: driftDto(drift) }, origin);
  } catch (err) {
    if (err instanceof AppTypeUnresolvedError) {
      sendJson(res, 400, { error: err.message, availableAppTypes: err.availableAppTypes }, origin);
      return true;
    }
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/studio/projects/:id/contract-reset/apply — apply
// ---------------------------------------------------------------------------

export async function handleProjectContractResetApply(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const match = url.match(APPLY_RE);
  if (!(match && method === 'POST')) return false;

  const id = decodeURIComponent(match[1]!);
  const projectRoot = resolveProjectRootForReset(ctx, id, res, origin);
  if (!projectRoot) return true;

  const parsedBody = await readAppTypeBody(ctx);
  if (!parsedBody.ok) {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return true;
  }

  try {
    // A FRESH compute, immediately before applying it — never a report the
    // client sent back (see this file's header). The operator already saw a
    // drift report from the dry-run route; this recomputes rather than
    // trusting that one is still accurate, exactly as `cmdProjectReset`'s own
    // single `--apply` call does.
    const drift = computeContractDrift(projectRoot, {
      forgeRoot: ctx.forgeRoot,
      ...(parsedBody.appType !== undefined ? { appType: parsedBody.appType } : {}),
    });
    const result = applyContractReset(projectRoot, drift);
    sendJson(res, 200, { ok: true, drift: driftDto(drift), result }, origin);
  } catch (err) {
    if (err instanceof AppTypeUnresolvedError) {
      sendJson(res, 400, { error: err.message, availableAppTypes: err.availableAppTypes }, origin);
      return true;
    }
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
