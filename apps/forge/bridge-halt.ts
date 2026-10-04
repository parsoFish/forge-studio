/**
 * bridge-halt.ts — the one emergency halt at the bridge (ADR 011).
 *
 * `POST /api/halt` writes `<forgeRoot>/_queue/halt.json`; `POST /api/halt/release`
 * removes it. `haltStatus` is the read the health route folds into `serve.halt`.
 * Both writes target one fixed path derived from `forgeRoot`, never from the
 * request. The CSRF guard in `ui-bridge.ts` runs before `handleHaltRoutes`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { allowedOrigin, sendJson, sanitizeError, forgeQueueRoot, readHalt, writeHalt, releaseHalt } from '@forge/kernel';

export type HaltStatus = { since: string | null; actor: string | null; active: number; queued: number };

/** Manifest count (`*.md`) in one queue state directory; heartbeat/stop sidecars are not counted. */
function countManifests(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

/** `null` when not halted; the record plus the drain counts when halted. */
export function haltStatus(forgeRoot: string): HaltStatus | null {
  const queueRoot = forgeQueueRoot(forgeRoot);
  const halt = readHalt(queueRoot);
  if (halt === null) return null;
  return {
    since: halt.since,
    actor: halt.actor,
    active: countManifests(join(queueRoot, 'in-flight')),
    queued: countManifests(join(queueRoot, 'pending')),
  };
}

export async function handleHaltRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { forgeRoot: string },
  url: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;
  const origin = allowedOrigin(req);
  const queueRoot = forgeQueueRoot(ctx.forgeRoot);
  if (url === '/api/halt') {
    try {
      writeHalt(queueRoot, 'operator');
      sendJson(res, 200, { halt: haltStatus(ctx.forgeRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  if (url === '/api/halt/release') {
    try {
      releaseHalt(queueRoot);
      sendJson(res, 200, { halt: null }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  return false;
}
