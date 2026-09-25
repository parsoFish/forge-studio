/**
 * POST /api/studio/hooks/:id/test-fire (forge-6gv.8.1, library-33) — runs a
 * hook through the SAME prepare step production dispatch uses
 * (`runHookScriptAsync`'s `prepareHookRun`: approval + package pin + env
 * fence, hook-runtime.ts) — never a second, divergent execution path. No
 * event payload reaches the script here OR in a real dispatch (hook-
 * dispatch.ts: the script never learns which tool call fired it), so this
 * only labels the run with the hook's REAL declared `on` event.
 * Binding is NOT required; approval IS — an unapproved/blocked hook is
 * refused with a clear 409, the same `hookRunState` decision a real
 * dispatch uses. The run (outcome, exit code, time, truncated output) is
 * recorded in a small bounded per-hook log (`@forge/kernel`'s
 * `appendBoundedLog`), read back by `bridge-studio-hooks-detail.ts`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  sendJson, allowedOrigin, sanitizeError, pathOnly, createLogger, isDryBridge, refuseDryBridge, appendBoundedLog, isSafeRunId, type RouteContext,
} from '@forge/kernel';
import { loadHookDefinition, type HookLifecycleEvent } from './studio/hook-library.ts';
import { HookRunError, runHookScriptAsync } from './studio/hook-runtime.ts';
import { decodeIdSegment, locateHook } from './bridge-studio-hooks.ts';

export const HOOK_TEST_FIRE_RE = /^\/api\/studio\/hooks\/([^/]+)\/test-fire$/;
/** At most this many past test-fire runs are kept per hook. */
export const HOOK_TEST_FIRE_LOG_MAX = 10;
const TAIL_CHARS = 2000;
function tail(s: string): string {
  return s.length > TAIL_CHARS ? `${s.slice(0, TAIL_CHARS)}…(truncated)` : s;
}

export type HookTestFireLogEntry = {
  at: string;
  event: HookLifecycleEvent;
  outcome: 'ran' | 'timeout' | 'error';
  exitCode: number | null;
  durationMs: number | null;
  stdoutTail: string;
  stderrTail: string;
};

/** The bounded log's path for one hook — shared with the detail route. */
export function hookTestFireLogSegments(id: string): string[] {
  return ['_hook-test-fires', `${id}.json`];
}

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

  // `locateHook` already proved `id` is a valid slug (`assertSkillSlug` via
  // `hookYamlPath` — lowercase/digits/hyphens only, no `/`, `.`, `..`), a
  // strict subset of `isSafeRunId`'s charset. Checked again here anyway,
  // never trusting a composed cycle id to inherit its part's safety by
  // construction alone (the same discipline `bridge-agents-slug.ts` applies
  // to its own `_agent-<slug>-<stamp>` ids) — security review, forge-6gv.8.1.
  const cycleId = `_hook-test-fire-${id}`;
  if (!isSafeRunId(cycleId)) { sendJson(res, 500, { error: 'internal: unsafe test-fire cycle id' }, origin); return true; }

  try {
    const def = loadHookDefinition(id, ctx.forgeRoot);
    // ONE dir per HOOK (not per test-fire), mirroring the `_agent-*`/
    // `_bridge-*` standalone-run convention — prepareHookRun's own start/end
    // bookkeeping only; the UI-facing run HISTORY is the bounded log below.
    const logger = createLogger(cycleId, ctx.logsRoot);
    let entry: HookTestFireLogEntry;
    try {
      const result = await runHookScriptAsync({ forgeRoot: ctx.forgeRoot, id, logger, initiativeId: `test-fire-${id}` });
      entry = { at: new Date().toISOString(), event: def.on, outcome: 'ran', exitCode: result.exitCode, durationMs: result.durationMs, stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr) };
    } catch (err) {
      if (err instanceof HookRunError && err.reason === 'not-runnable') {
        sendJson(res, 409, { error: `hook "${id}" is not approved — test-fire refuses an unapproved hook (${err.message})` }, origin);
        return true;
      }
      const outcome = err instanceof HookRunError && err.reason === 'timeout' ? 'timeout' as const : 'error' as const;
      entry = { at: new Date().toISOString(), event: def.on, outcome, exitCode: null, durationMs: null, stdoutTail: '', stderrTail: err instanceof Error ? tail(err.message) : String(err) };
    }
    appendBoundedLog(ctx.logsRoot, hookTestFireLogSegments(id), entry, HOOK_TEST_FIRE_LOG_MAX);
    sendJson(res, 200, { ok: true, ...entry }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
