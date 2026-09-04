/**
 * Forge Studio connections-library bridge routes (R3-04-F2/F3,
 * `_wave5/specs/R3-04.md`).
 *
 * Owns EVERY `/api/studio/connections*` route, mirroring the one-module-
 * per-category precedent (packages/library/bridge-studio-hooks.ts, cli/bridge-studio-
 * templates.ts):
 *
 *   GET  /api/studio/connections           → { connections: ConnectionWire[] }
 *   GET  /api/studio/connections/:id       → one ConnectionWire (full detail)
 *   POST /api/studio/connections/:id/probe   → re-runs the real probe, returns it
 *   POST /api/studio/connections/:id/install → the D6 security core
 *
 * D1 (structural negative AC): there is NO create/update/delete route for a
 * connection, anywhere. This module exports no write-verb-named function
 * (`packages/library/connections-no-authoring.test.ts` asserts the export
 * surface directly); every other method/URL falls through (`return false`)
 * to the real bridge dispatcher's final 404.
 *
 * M4 §4 step 2 — carved into one exported handler per route (the table
 * `packages/library/routes.ts` assembles). The handlers have not moved;
 * what has moved is the DISPATCH, out of this module's own if-chain and into
 * that table. Order preserved below — see each handler's own comment for the
 * source line it lived at before the carve.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS made here that the spec did not fully dictate (mirrors
 * the AT file's own header — see packages/library/bridge-studio-connections.test.ts):
 *
 *  D-1. Response envelope: `{ connections: [...] }` (list) / a flat
 *       `ConnectionWire` object (detail) — same shape at both depths (D5:
 *       config carries NAMES only, so nothing needs hiding at list depth).
 *  D-2. `GET /api/studio/connections` (and the detail route) run a REAL probe
 *       per entry on every request — no caching layer this round (D3: state
 *       must be EXECUTED, never declared/cached). A connection's `probe`
 *       *spec* (command/args/kind — `ConnectionDefinition.probe`) is
 *       deliberately NOT forwarded; the wire `probe` field is replaced with
 *       that request's live `ProbeResult` (state/exitCode/stdout/stderr/...).
 *  D-3. `POST .../:id/probe` returns `{ ok: true, probe: ProbeResult }`.
 *  D-4. `POST .../:id/install` (D6/D7): a `system-provided` or `external`
 *       entry (both `installable: false`, D13) → 400. Unknown id → 404. The
 *       request body is read for EXACTLY ONE thing — the `confirm` flag
 *       (forge-6gv.8.2) — and never for package/version/registry, which is
 *       what makes "a body carrying package/version/registry changes
 *       nothing" trivially true rather than merely tested: `installArgvFor`/
 *       `installPreviewFor` take only `(def, connectionsRoot)`, so there is
 *       no parameter through which a body value could reach the argv even in
 *       principle.
 *         - UNCONFIRMED (no body, or a body without `confirm: true`): 200,
 *           `{ ok: true, preview: InstallPreview }` — ZERO network calls,
 *           ZERO executor invocations. `installConnection` is not called at
 *           all on this path.
 *         - CONFIRMED (`{ confirm: true }`): the pre-existing behaviour,
 *           unchanged — including the suppression seam below.
 *       Suppressed (FORGE_DRY_BRIDGE=1 or FORGE_ARCHITECT_NO_SPAWN=1,
 *       mirroring orchestrator/run-agent.ts's own double-env check):
 *       `{ ok: true, suppressed: true, wouldInstall: {command, args} }` — no
 *       execution, argv only. A real (non-suppressed) install returns a
 *       structurally DISTINCT shape (no `suppressed` key): `{ ok, installed,
 *       argv, probe }`. All three shapes — preview / suppressed / real — are
 *       pairwise disjoint in their key sets, so none can ever be mistaken for
 *       another.
 *  D-5. Every id-bearing route resolves through `resolveConnectionOrRespond`:
 *       decode → `assertSkillSlug` → `connectionById`. A malformed/traversal-
 *       shaped id is rejected (400) before any read; an unknown-but-valid id
 *       is a 404, never a fabricated entry.
 */

import type { AgentFacts } from './studio/agent-facts.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, isDryBridge, type StudioContext, type RouteContext } from '@forge/kernel';
import { assertSkillSlug } from '@forge/kernel/ids.ts';
import { catalogConnectionById, connectionById, listConnections, type ConnectionDefinition } from './studio/connection-library.ts';
import { probeConnection, buildProbeChildEnv, CONNECTIONS_DIR } from './studio/connection-probe.ts';
import { installArgvFor, installConnection, installPreviewFor } from './studio/connection-install.ts';

/** Bounded wall-clock budget for the real `npm install` child (production
 *  only — every AT that exercises this route pins FORGE_ARCHITECT_NO_SPAWN=1
 *  and never reaches this branch). Generous: unlike a probe, a real package
 *  install can legitimately take a while. */
const INSTALL_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Id resolution — decode, slug-validate, look up. Writes its own 400/404 and
// returns null on failure so every route below checks the result once.
// Mirrors bridge-studio-writes.ts's `resolveManagedProject` pattern.
// ---------------------------------------------------------------------------

/**
 * Decode, slug-validate, look up — one 400/404 path for every connection
 * route. The LOOKUP is a parameter because the routes need two different
 * reads: probe and install take the catalog half (they never surface
 * `usedBy`), detail takes the usage-decorated one because it forwards the
 * whole definition on the wire. Passing the read in keeps that difference at
 * the four call sites and leaves ONE copy of the error handling — a second
 * resolver would be a shape a later route could half-update.
 */
function resolveConnectionOrRespond<T>(
  rawIdSegment: string,
  res: ServerResponse,
  origin: string,
  lookup: (id: string) => T | undefined,
): T | null {
  let id: string;
  try {
    id = decodeURIComponent(rawIdSegment);
  } catch {
    sendJson(res, 400, { error: 'invalid connection id — malformed URL encoding' }, origin);
    return null;
  }
  try {
    assertSkillSlug(id, 'connection');
  } catch (err) {
    sendJson(res, 400, { error: sanitizeError(err) }, origin);
    return null;
  }
  const def = lookup(id);
  if (!def) {
    sendJson(res, 404, { error: `unknown connection "${id}"` }, origin);
    return null;
  }
  return def;
}

// ---------------------------------------------------------------------------
// Wire shaping (D-2): every field of a composed ConnectionDefinition is safe
// to forward as-is EXCEPT `probe` — the catalog probe SPEC is dropped and
// replaced with that request's live ProbeResult under the same key.
// ---------------------------------------------------------------------------

function toWireConnection(forgeRoot: string, def: ConnectionDefinition): Record<string, unknown> {
  const { probe: _spec, ...rest } = def;
  return { ...rest, probe: probeConnection(forgeRoot, def) };
}

// ---------------------------------------------------------------------------
// GET /api/studio/connections — the library listing (D-2). Formerly the
// first arm of handleStudioConnectionsRoutes, :129.
// ---------------------------------------------------------------------------

export async function handleConnectionsList(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string, facts: AgentFacts): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  if (url === '/api/studio/connections' && method === 'GET') {
    try {
      const connections = listConnections(ctx.forgeRoot, facts).map((def) => toWireConnection(ctx.forgeRoot, def));
      sendJson(res, 200, { connections }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// POST /api/studio/connections/:id/probe — explicit re-check (D-3). Formerly
// the second arm of handleStudioConnectionsRoutes, :140.
// ---------------------------------------------------------------------------

export const PROBE_RE = /^\/api\/studio\/connections\/([^/]+)\/probe$/;

export async function handleConnectionsProbe(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const probeMatch = url.match(PROBE_RE);
  if (method === 'POST' && probeMatch) {
    try {
      const def = resolveConnectionOrRespond(probeMatch[1], res, origin, (id) => catalogConnectionById(ctx.forgeRoot, id));
      if (!def) return true;
      sendJson(res, 200, { ok: true, probe: probeConnection(ctx.forgeRoot, def) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// POST /api/studio/connections/:id/install — the D6 security core. Formerly
// the third arm of handleStudioConnectionsRoutes, :153.
// ---------------------------------------------------------------------------

export const INSTALL_RE = /^\/api\/studio\/connections\/([^/]+)\/install$/;

export async function handleConnectionsInstall(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const installMatch = url.match(INSTALL_RE);
  if (method === 'POST' && installMatch) {
    try {
      const def = resolveConnectionOrRespond(installMatch[1], res, origin, (id) => catalogConnectionById(ctx.forgeRoot, id));
      if (!def) return true;

      if (!def.installable) {
        sendJson(res, 400, {
          error: `connection "${def.id}" has install method "${def.install.method}" — no install action exists for a "${def.install.method}" entry (D13: system-provided and external are both non-installable)`,
        }, origin);
        return true;
      }

      // D6: the argv is derived from the catalog pin ONLY — a body value is
      // consulted for the `confirm` flag alone, below, and NEVER for
      // package/version/registry: installArgvFor/installPreviewFor take only
      // (def, connectionsRoot), so a client-supplied field cannot influence
      // the argv even in principle.
      const connectionsRoot = resolve(ctx.forgeRoot, CONNECTIONS_DIR);

      // forge-6gv.8.2 — confirm gate. Read ONLY for `confirm`; a malformed
      // body is treated the same as an absent one (unconfirmed), never a 500
      // for a route whose whole point on this path is to execute nothing.
      let body: unknown;
      try { body = await ctx.readBody(); } catch { body = undefined; }
      const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const confirmed = b['confirm'] === true;

      if (!confirmed) {
        // ZERO network calls, ZERO executor invocations — installConnection
        // is never reached on this path. Structurally distinct from both the
        // suppressed and the real-install shapes (no `suppressed`/`installed`
        // key), mirroring the precedent that shape sets below.
        sendJson(res, 200, { ok: true, preview: installPreviewFor(def, connectionsRoot) }, origin);
        return true;
      }

      const argv = installArgvFor(def, connectionsRoot);

      // D7: both suppression seams, exactly mirroring run-agent.ts's own
      // double check — a suppressed install executes NOTHING and returns a
      // shape that can never be mistaken for a completed install.
      if (isDryBridge() || process.env.FORGE_ARCHITECT_NO_SPAWN === '1') {
        sendJson(res, 200, {
          ok: true,
          suppressed: true,
          wouldInstall: { command: argv.command, args: argv.args },
        }, origin);
        return true;
      }

      const result = installConnection(ctx.forgeRoot, def, {
        executor: (command, args) => {
          // The install child's env is stripped the SAME way the probe
          // child's is (D11's `HOOK_ENV_BASE_ALLOWLIST`, reused via
          // `buildProbeChildEnv` — no second filter): an install child runs
          // arbitrary third-party npm package code, which is at least as
          // untrusted as a probe child. `--ignore-scripts` (installArgvFor)
          // blocks lifecycle-script EXECUTION; it does nothing to keep a
          // credential like ANTHROPIC_API_KEY out of the child's environment
          // — without this, the operator's real API key would be inherited
          // by every npm install this route runs.
          const spawned = spawnSync(command, args, {
            shell: false,
            timeout: INSTALL_TIMEOUT_MS,
            encoding: 'utf8',
            env: buildProbeChildEnv(process.env),
          });
          return { exitCode: spawned.status };
        },
      });
      sendJson(res, 200, { ok: result.ok, installed: result.ok, argv: result.argv, probe: result.probeAfter }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// GET /api/studio/connections/:id — detail (D-1/D-5). Formerly the fourth
// arm of handleStudioConnectionsRoutes, :212.
// ---------------------------------------------------------------------------

export const DETAIL_RE = /^\/api\/studio\/connections\/([^/]+)$/;

export async function handleConnectionsDetail(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string, facts: AgentFacts): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const detailMatch = url.match(DETAIL_RE);
  if (method === 'GET' && detailMatch) {
    try {
      const def = resolveConnectionOrRespond(detailMatch[1], res, origin, (id) => connectionById(ctx.forgeRoot, id, facts));
      if (!def) return true;
      sendJson(res, 200, toWireConnection(ctx.forgeRoot, def), origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
