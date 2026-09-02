/**
 * Dry-bridge: the env gate and the typed refusal every package needs.
 *
 * The full dry-bridge model — `BRIDGE_ROUTE_CLASSIFICATION`, the per-skip
 * `stub-actions` events, the agent-turn marker — stays in `cli/dry-bridge.ts`,
 * where it belongs: it is a table ABOUT the bridge's own routes, and the
 * coverage guard reads it there. What moved here is only the part five
 * packages already reach for, and could only reach by importing `cli/`:
 * the "is it on" predicate and the 409-plus-event refusal.
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

import { createLogger } from './logging.ts';
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
