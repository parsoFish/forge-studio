/**
 * Dry-bridge: the env gate and the typed refusal every package needs.
 *
 * `BRIDGE_ROUTE_CLASSIFICATION` stays in `apps/forge/dry-bridge.ts`, where it
 * belongs: it is a table ABOUT the bridge's own routes, and the coverage guard
 * reads it there. Everything that is an EVENT SHAPE lives here — the "is it on"
 * predicate, the 409-plus-event refusal, the per-skip `stub-actions` event and
 * the agent-turn marker.
 *
 * M5-A, bead forge-8vfn.24 — AMENDMENT. This header used to say the per-skip
 * events and the agent-turn marker stayed with the table. They did, and the
 * consequence was measured: `packages/flows` and `packages/projects` could only
 * reach them by importing the ASSEMBLY, which is five `package-to-assembly`
 * boundary rows (handoff F3) for three functions that emit JSONL exactly the way
 * `emitDryBridgeRefusal` beside them already does. The table is a fact about
 * routes; these three are facts about the event log. The split now follows that
 * line rather than the file they happened to be written in.
 *
 * Both are kernel-shaped by kernel's own charter — "the facts every other
 * package needs and none of them owns". Neither drags anything down:
 * `createLogger` and `sendJson` already live here.
 *
 * `cli/dry-bridge.ts` re-exports all of it, so its own legacy callers and the
 * classification table are untouched, and the coverage guard — which finds
 * `refuseDryBridge(res, origin, {route: '…'})` CALL SITES by regex over the
 * dispatch files' source text, never by import specifier — cannot tell the
 * difference. That was checked against the guard, not assumed.
 */
import type { ServerResponse } from 'node:http';

import { createLogger, type EventLogger } from './logging.ts';
import { sendJson } from './http-envelope.ts';

/** The env var that activates dry-bridge mode. Single source of truth — no
 *  string literals scattered at call sites. */
export const DRY_BRIDGE_ENV = 'FORGE_DRY_BRIDGE';

/** Shared JSONL bucket for refusal events and the spawn families' agent-turn
 *  skip events (no natural per-cycle id exists at those points — e.g.
 *  scheduler start/stop, an architect session). */
export const DRY_BRIDGE_LOG_BUCKET = '_dry-bridge';

/** True iff dry-bridge mode is active. Reads `process.env` by default;
 *  callers (and tests) may pass an explicit env map. */
export function isDryBridge(env: Record<string, string | undefined> = process.env): boolean {
  return env[DRY_BRIDGE_ENV] === '1';
}

/** The real-world reach a `refuse` route would have had. Kept as a closed
 *  union for the same reason the classification table is closed: a new kind of
 *  reach should force a decision, not be absorbed by an existing label. */
export type DryBridgeAction = 'spawn-agent' | 'git-remote' | 'daemon' | 'network';

export type DryBridgeRefusalInput = {
  /** For HTTP routes the route path; for non-HTTP spawn paths a stable
   *  identifier (e.g. `startup:reflect-reconcile`). */
  route: string;
  /** HTTP method, or a non-HTTP trigger label (e.g. `BOOT`). */
  method: string;
  action: DryBridgeAction;
  logsRoot: string;
};

/**
 * Emit the JSONL refusal event (into the shared DRY_BRIDGE_LOG_BUCKET — most
 * refuse points have no natural per-resource cycleId). Standalone so non-HTTP
 * suppression points (the boot-time reflect-reconcile) can emit the SAME
 * typed refusal without an HTTP response. Never throws — best-effort.
 */
export function emitDryBridgeRefusal(input: DryBridgeRefusalInput): void {
  try {
    const logger = createLogger(DRY_BRIDGE_LOG_BUCKET, input.logsRoot);
    logger.emit({
      initiative_id: DRY_BRIDGE_LOG_BUCKET,
      phase: 'orchestrator',
      skill: 'dry-bridge',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'dry-bridge.refuse',
      metadata: { route: input.route, method: input.method, action: input.action },
    });
  } catch { /* best-effort — never break the caller on a logging failure */ }
}

/**
 * Write the typed 409 refusal AND emit a JSONL event. Never silent success.
 * Never throws — a logging failure must not prevent the HTTP response (the
 * response is written FIRST, the event emit is best-effort after).
 */
export function refuseDryBridge(res: ServerResponse, origin: string, input: DryBridgeRefusalInput): void {
  sendJson(res, 409, { error: 'dry-bridge', route: input.route, method: input.method, action: input.action }, origin);
  emitDryBridgeRefusal(input);
}

// ---------------------------------------------------------------------------
// emitDryBridgeSkip — the stub-actions per-skip event
// ---------------------------------------------------------------------------

/** The real-acting sub-steps a `stub-actions` route can individually skip in
 *  dry-bridge mode. The first three are `applyReviewVerdict`'s approve chain —
 *  exactly the actions that self-merged the PR on 2026-07-16. `agent-turn` is
 *  the spawn families' suppressed SDK-agent/runner turn (architect,
 *  instructions, project-brain, demo-builder, preflight-fix). */
export type DryBridgeStubAction = 'release-finalize' | 'merge-pr' | 'finalize-after-merge' | 'agent-turn';

/**
 * Emit one JSONL event for a single skipped stub-action, into the SAME
 * cycle's events.jsonl the rest of that cycle's history lives in (the caller
 * already has a `createLogger`-derived logger for this cycle — reused here,
 * not re-derived). `extra` merges additional metadata (e.g. the route for
 * agent-turn skips, which log into the shared bucket). Never throws —
 * best-effort, matching its siblings (`emitDryBridgeRefusal`,
 * `dryBridgeAgentTurnMarker`): a logging failure must never fail the caller's
 * response (e.g. a verdict approve/merge already in flight).
 */
export function emitDryBridgeSkip(
  logger: EventLogger,
  initiativeId: string,
  action: DryBridgeStubAction,
  extra: Record<string, unknown> = {},
): void {
  try {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'dry-bridge',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'dry-bridge.skip',
      metadata: { action, ...extra },
    });
  } catch { /* best-effort — never break the caller on a logging failure */ }
}

// ---------------------------------------------------------------------------
// dryBridgeAgentTurnMarker — the stub-actions marker for the spawn families
// ---------------------------------------------------------------------------

/**
 * bead forge-8nw — the ONE `dryBridgeAgentTurnMarker` caller (POST
 * `/api/agents/:slug/run`, `apps/forge/ui-bridge.ts`) whose 3rd argument is not a
 * session id at all but the STANDALONE dispatch's own `runId` (minted
 * `` `_agent-${slug}-${stamp}` ``, then handed to this function verbatim as
 * `sessionId`). `runId` doubles as the run's OWN `_logs/` directory NAME —
 * the exact string `deriveStandaloneRunState`/`GET /api/agents/runs/:runId`
 * (`apps/forge/ui-bridge.ts`) reads back. Every OTHER call site (architect/
 * instructions/demo-builder/project-brain/onboarding/authoring/kb-cleanup —
 * see `BRIDGE_ROUTE_CLASSIFICATION` in `apps/forge/dry-bridge.ts`) passes a
 * session id whose own terminal state lives in `status.json`
 * (`writeSessionTerminalPhase`, `packages/agents/agent-run.ts`), not in an
 * events.jsonl any standalone-run deriver ever reads — so only THIS route
 * gets the extra write below.
 */
const STANDALONE_DISPATCH_ROUTE = '/api/agents/:slug/run';

/**
 * For the spawn-route families (classification 'stub-actions', guard
 * 'spawn-helper'): when dry-bridge is active, emit one `dry-bridge.skip`
 * agent-turn event and return the `dryBridge` fragment to spread into the
 * route's 200 body. When inactive — including under
 * FORGE_ARCHITECT_NO_SPAWN-only, whose legacy silent-skip semantics stay
 * byte-identical — returns `{}` and emits nothing. Call exactly once per
 * response, only on branches that would have spawned.
 *
 * bead forge-8nw / forge-720 — beyond the shared-bucket skip event above,
 * a standalone dispatch (`STANDALONE_DISPATCH_ROUTE`) ALSO gets a terminal
 * marker written into ITS OWN `<logsRoot>/<runId>/events.jsonl` — the file
 * `deriveStandaloneRunState` (`apps/forge/ui-bridge.ts`) actually reads to derive
 * `GET /api/agents/runs/:runId`'s state. Without this, a dispatch under
 * dry-bridge wrote only into the shared `DRY_BRIDGE_LOG_BUCKET`, so its own
 * run directory never recorded a terminal fact and the run derived
 * `state: 'running'` FOREVER — the measured root cause of the zombie
 * `_agent-onboarding-agent-*` / `_agent-w7-throwaway-agent-*` directories
 * bead forge-720 found on disk. The message reuses the EXACT literal
 * `'run-agent.spawn-suppressed'` a REAL (non-dry-bridge) suppressed spawn
 * already writes into this same run's log (`packages/agents/run-agent.ts`,
 * its own `FORGE_DRY_BRIDGE_ENV`/`FORGE_ARCHITECT_NO_SPAWN_ENV` early
 * return) — no new marker vocabulary, exactly what
 * `deriveStandaloneStateFromEvents` (`apps/forge/ui-bridge.ts`) already checks via
 * `parsed.some((e) => e['message'] === 'run-agent.spawn-suppressed')` to
 * derive `state: 'suppressed'`. `createLogger` appends (never truncates),
 * so this lands safely after the route's own t0 `agent-run.dispatched`
 * marker (`apps/forge/ui-bridge.ts`, written the instant `runId` is minted, before
 * this function is ever called).
 */
export function dryBridgeAgentTurnMarker(
  logsRoot: string,
  route: string,
  sessionId?: string,
): { dryBridge?: { skipped: DryBridgeStubAction[] } } {
  if (!isDryBridge()) return {};
  try {
    const logger = createLogger(DRY_BRIDGE_LOG_BUCKET, logsRoot);
    emitDryBridgeSkip(logger, DRY_BRIDGE_LOG_BUCKET, 'agent-turn', {
      route,
      ...(sessionId ? { sessionId } : {}),
    });
  } catch { /* best-effort — never break the route response on a logging failure */ }

  if (sessionId && route === STANDALONE_DISPATCH_ROUTE) {
    try {
      createLogger(sessionId, logsRoot).emit({
        initiative_id: sessionId,
        phase: 'orchestrator',
        skill: 'dry-bridge',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'run-agent.spawn-suppressed',
        metadata: { reason: DRY_BRIDGE_ENV, route },
      });
    } catch { /* best-effort — never break the route response on a logging failure */ }
  }

  return { dryBridge: { skipped: ['agent-turn'] } };
}
