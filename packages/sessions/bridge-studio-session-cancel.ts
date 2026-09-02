/**
 * W7-A2 — the ONE generic session cancel route, for EVERY session kind:
 *
 *   POST /api/studio/sessions/:kind/:sessionId/cancel   { project?: string }
 *     → 200 { ok: true, kind, sessionId, project, phase: 'cancelled', previousPhase, killed }
 *     | 400 malformed sessionId / project
 *     | 403 (the bridge's global x-forge-csrf guard, cli/ui-bridge.ts — this
 *            route is a plain non-GET, so it is covered without any per-route
 *            wiring)
 *     | 404 unknown kind (naming the registry) / unknown or escaping session
 *     | 409 already terminal (naming the phase) — never re-terminalised
 *
 * Findings: home-sessions-04/21, sessions-kinds-10/16, community-20,
 * flows-28 (session half), knowledge-17 (a drafting kb-cleanup now has a
 * reachable action).
 *
 * Semantics (operator-locked, README §4 Wave 7 + ADR-043 2026-08-19
 * amendment §1): cancel writes the ONE universal reserved terminal phase
 * `CANCELLED_PHASE` (cli/bridge-studio.ts) onto status.json —
 * `{ ...status, phase: 'cancelled', cancelled_at, cancelled_from }` — through
 * `guardedWriteSessionStatus` (the SAME primitive every affordance write
 * uses), after signalling the session's tracked turn process if one is
 * alive (`killTrackedTurn`, packages/sessions/bridge-studio-lifecycle.ts — SIGTERM to the
 * detached runner's process group, so the SDK's `claude` child dies too).
 * `cancelled_from` is the transition's own fact (the phase the operator
 * gave up at), not a mirror of anything derivable — every DERIVED signal
 * (terminal, needsYou, state) is recomputed from `phase` on read.
 *
 * DISPATCH ORDER (load-bearing): cli/ui-bridge.ts's `handleHttp` must call
 * this handler BEFORE `handleStudioAffordanceRoutes` — that route's regex
 * (`/^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/([^/]+)$/`) would otherwise
 * swallow the literal `cancel` segment as an affordance id and 409 it as
 * "not available". Pinned by packages/sessions/bridge-studio-lifecycle.test.ts.
 *
 * Security mirrors cli/bridge-studio-affordances.ts's own chain: kind →
 * registry (never a switch); sessionId → `invalidSessionIdReason` before any
 * fs call; project → `invalidProjectReason` when supplied, else resolved
 * server-side by `findSessionProject` (server-enumerated names, each checked
 * through the guard); the session dir through `resolveGuardedPath` (a
 * symlinked/escaping dir collapses into the same 404 as an absent one — no
 * filesystem oracle); status through `guardedReadSessionStatus`. The
 * response never echoes a resolved path.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, readJson, pathOnly, CANCELLED_PHASE, type StudioContext } from '../../cli/bridge-studio.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from './interactive-session.ts';
import { invalidSessionIdReason, invalidProjectReason, findSessionProject, isTerminalPhase } from './bridge-studio-sessions.ts';
import { killTrackedTurn } from './bridge-studio-lifecycle.ts';

export type SessionCancelRouteContext = StudioContext & {
  /** Optional per-kind "list changed" broadcasts (the legacy kinds' WS
   *  signals) — invoked after a successful cancel so an open bespoke panel
   *  (architect/instructions/demo) refetches without waiting for its poll. */
  broadcastKindChanged?: (kind: string) => void;
};

export async function handleSessionCancelRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SessionCancelRouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;
  const url = pathOnly(rawUrl);
  // Inline regex (not a named const) so cli/dry-bridge-coverage.test.ts's
  // dispatch scanner can pair this route with its BRIDGE_ROUTE_CLASSIFICATION
  // row (`/api/studio/sessions/:kind/:sessionId/cancel`, exempt-local).
  const routeMatch = url.match(/^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/cancel$/);
  if (!routeMatch) return false;
  const origin = allowedOrigin(req);

  try {
    let kind: string;
    let sessionId: string;
    try {
      kind = decodeURIComponent(routeMatch[1]);
      sessionId = decodeURIComponent(routeMatch[2]);
    } catch {
      sendJson(res, 400, { error: 'invalid session cancel route — malformed URL encoding' }, origin);
      return true;
    }

    // Body is optional (an empty POST is fine); when present it must be a
    // JSON object. `project` is the only field read.
    let body: unknown = {};
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid or oversized JSON body' }, origin);
      return true;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
      return true;
    }
    const projectRaw = (body as Record<string, unknown>).project;
    if (projectRaw !== undefined && typeof projectRaw !== 'string') {
      sendJson(res, 400, { error: 'body.project must be a string when supplied' }, origin);
      return true;
    }
    if (typeof projectRaw === 'string') {
      const projectReason = invalidProjectReason(projectRaw);
      if (projectReason !== null) {
        sendJson(res, 400, { error: projectReason }, origin);
        return true;
      }
    }

    // --- 1. kind -> registry (never a switch) --------------------------
    let descriptors: SessionKindDescriptor[];
    try {
      descriptors = loadSessionKinds(ctx.forgeRoot);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }
    const descriptor = descriptors.find((d) => d.id === kind);
    if (!descriptor) {
      const allowed = descriptors.map((d) => d.id).join(', ');
      sendJson(res, 404, { error: `unknown session kind "${kind}" — must be one of: ${allowed}` }, origin);
      return true;
    }

    // --- 2. sessionId charset/length BEFORE any fs call ------------------
    const sidReason = invalidSessionIdReason(sessionId);
    if (sidReason !== null) {
      sendJson(res, 400, { error: sidReason }, origin);
      return true;
    }

    const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
    const kindDirName = `_${descriptor.id}`;

    // --- 3. project: supplied and valid, or resolved server-side ---------
    let project: string;
    if (typeof projectRaw === 'string') {
      project = projectRaw;
    } else {
      const found = findSessionProject(projectsRoot, kindDirName, sessionId);
      if (!found.ok) {
        if (found.reason === 'ambiguous') {
          sendJson(res, 409, { error: `session "${sessionId}" (kind "${kind}") exists under more than one project — pass body.project to disambiguate` }, origin);
        } else {
          sendJson(res, 404, { error: 'session not found' }, origin);
        }
        return true;
      }
      project = found.project;
    }

    // --- 4. session dir + status through the guard (404 collapse) --------
    const dirSegs = [project, kindDirName, sessionId];
    const guard = resolveGuardedPath(projectsRoot, dirSegs);
    if (!guard.ok || !guard.exists) {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return true;
    }
    const status = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegs);
    if (!status || typeof status.phase !== 'string') {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return true;
    }
    const previousPhase = status.phase;

    // --- 5. terminal? refuse — never re-terminalise -----------------------
    if (isTerminalPhase(descriptor, previousPhase)) {
      sendJson(
        res,
        409,
        { error: `session "${sessionId}" (kind "${kind}") is already terminal at phase "${previousPhase}" — nothing to cancel`, phase: previousPhase },
        origin,
      );
      return true;
    }

    // --- 6. kill the tracked turn (if any), then write the terminal phase.
    // SYNC INVARIANT: no await between the status read above and this write
    // (mirrors cli/bridge-studio-affordances.ts's own handlers) — two
    // concurrent cancels cannot interleave; the second reads `cancelled`
    // and 409s above.
    const killed = killTrackedTurn(ctx.logsRoot, descriptor.id, sessionId);
    const written = guardedWriteSessionStatus(projectsRoot, dirSegs, {
      ...status,
      phase: CANCELLED_PHASE,
      cancelled_at: new Date().toISOString(),
      cancelled_from: previousPhase,
    });
    if (written === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return true;
    }
    ctx.broadcastKindChanged?.(descriptor.id);
    sendJson(res, 200, { ok: true, kind: descriptor.id, sessionId, project, phase: CANCELLED_PHASE, previousPhase, killed }, origin);
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
