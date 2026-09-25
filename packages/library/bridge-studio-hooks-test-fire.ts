/**
 * POST /api/studio/hooks/:id/test-fire (forge-6gv.8.1, library-33) — runs a
 * hook through the SAME prepare step production dispatch uses
 * (`runHookScriptAsync`'s `prepareHookRun`: approval + package pin + env
 * fence) — never a second, divergent path. No event payload reaches the
 * script here OR in a real dispatch (hook-dispatch.ts), so this only labels
 * the run with the hook's REAL declared `on` event. Binding is NOT
 * required; approval IS (a clear 409, the same `hookRunState` decision a
 * real dispatch uses). Recorded in a bounded per-hook log (`@forge/kernel`'s
 * `appendBoundedLog`), read back by `bridge-studio-hooks-detail.ts`. Generic
 * pieces (segments/truncation/safe-id) live in `@forge/kernel` (headroom).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  sendJson, allowedOrigin, sanitizeError, pathOnly, createLogger, isDryBridge, refuseDryBridge,
  appendBoundedLog, boundedLogSegments, composeSafeRunId, truncateTail, type RouteContext,
} from '@forge/kernel';
import { loadHookDefinition, type HookLifecycleEvent } from './studio/hook-library.ts';
import { HookRunError, runHookScriptAsync } from './studio/hook-runtime.ts';
import { decodeIdSegment, locateHook } from './bridge-studio-hooks.ts';

export const HOOK_TEST_FIRE_RE = /^\/api\/studio\/hooks\/([^/]+)\/test-fire$/;
/** At most this many past test-fire runs are kept per hook. */
export const HOOK_TEST_FIRE_LOG_MAX = 10;
/** The bounded log's directory namespace — shared with the detail route. */
export const HOOK_TEST_FIRE_LOG_DIR = '_hook-test-fires';
const TEST_FIRE_TAIL_CHARS = 2000;

export type HookTestFireLogEntry = {
  at: string;
  event: HookLifecycleEvent;
  outcome: 'ran' | 'timeout' | 'error';
  exitCode: number | null;
  durationMs: number | null;
  stdoutTail: string;
  stderrTail: string;
};

export async function handleHookTestFire(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const match = url.match(HOOK_TEST_FIRE_RE);
  if (!(match && method === 'POST')) return false;

  let id: string;
  try { id = decodeIdSegment(match[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
  const located = locateHook(ctx.forgeRoot, id);
  if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }
  if (isDryBridge()) {
    refuseDryBridge(res, origin, { route: '/api/studio/hooks/:id/test-fire', method, action: 'spawn-hook', logsRoot: ctx.logsRoot });
    return true;
  }

  // `locateHook` already validated `id`'s slug shape; re-checked anyway —
  // never trust a composed id to inherit its parts' safety (security review).
  const cycleId = composeSafeRunId('_hook-test-fire-', id);
  if (cycleId === null) { sendJson(res, 500, { error: 'internal: unsafe test-fire cycle id' }, origin); return true; }

  try {
    const def = loadHookDefinition(id, ctx.forgeRoot);
    const logger = createLogger(cycleId, ctx.logsRoot); // one dir per HOOK, mirroring `_agent-*`/`_bridge-*`.
    let entry: HookTestFireLogEntry;
    try {
      const result = await runHookScriptAsync({ forgeRoot: ctx.forgeRoot, id, logger, initiativeId: `test-fire-${id}` });
      entry = { at: new Date().toISOString(), event: def.on, outcome: 'ran', exitCode: result.exitCode, durationMs: result.durationMs, stdoutTail: truncateTail(result.stdout, TEST_FIRE_TAIL_CHARS), stderrTail: truncateTail(result.stderr, TEST_FIRE_TAIL_CHARS) };
    } catch (err) {
      if (err instanceof HookRunError && err.reason === 'not-runnable') {
        sendJson(res, 409, { error: `hook "${id}" is not approved — test-fire refuses an unapproved hook (${err.message})` }, origin);
        return true;
      }
      const outcome = err instanceof HookRunError && err.reason === 'timeout' ? 'timeout' as const : 'error' as const;
      entry = { at: new Date().toISOString(), event: def.on, outcome, exitCode: null, durationMs: null, stdoutTail: '', stderrTail: err instanceof Error ? truncateTail(err.message, TEST_FIRE_TAIL_CHARS) : String(err) };
    }
    appendBoundedLog(ctx.logsRoot, boundedLogSegments(HOOK_TEST_FIRE_LOG_DIR, id), entry, HOOK_TEST_FIRE_LOG_MAX);
    sendJson(res, 200, { ok: true, ...entry }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
