/**
 * KB drain-to-green HTTP route layer.
 *
 * Split out of `bridge-studio-kb-drain.ts` at M4 step 4 so that file returns
 * under its size baseline — this module holds only the HTTP dispatcher and
 * its six route handlers; the drain business logic (`runKbDrain`, the state
 * machine, status persistence, run listing, cancel-flag bookkeeping) stayed
 * behind in `bridge-studio-kb-drain.ts` and is imported from here.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { isSafeRunId } from '@forge/kernel';
import { resolveKbBrainDir } from './brain-paths.ts';
import { createLogger } from '@forge/kernel';
import { KB_ID_RE } from '@forge/kernel';
import { enqueueConsolidate } from './bridge-studio-kb-consolidate.ts';
import { deriveKbActiveJob, activeJobReason, KB_DRAIN_STALE_MS } from './kb-job-state.ts';
import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from '@forge/kernel';
import {
  writeKbDrainStatus,
  readKbDrainStatus,
  findActiveKbDrainRun,
  latestKbDrainRun,
  initialKbDrainStatus,
  listKbRuns,
  requestKbDrainCancel,
  runKbDrain,
} from './bridge-studio-kb-drain.ts';

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Handle the KB drain-to-green routes:
 *   POST /api/studio/kbs/:id/drain             → dispatch, { ok, runId } (409 if active)
 *   GET  /api/studio/kbs/:id/drain/:runId      → a specific run's status
 *   GET  /api/studio/kbs/:id/drain             → the active run, or the latest terminal one
 *
 * Returns false for non-matching URLs (passthrough), never throws.
 */
export async function handleStudioKbDrainRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);

  if (await handleKbDrainCancel(req, res, ctx, url, method)) return true;
  if (await handleKbActiveJob(req, res, ctx, url, method)) return true;
  if (await handleKbRuns(req, res, ctx, url, method)) return true;
  if (await handleKbDrainRun(req, res, ctx, url, method)) return true;
  if (await handleKbDrainStart(req, res, ctx, url, method)) return true;
  if (await handleKbDrainStatus(req, res, ctx, url, method)) return true;

  return false;
}

export async function handleKbDrainCancel(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/studio/kbs/:id/drain/cancel (W7-B2, knowledge-14) --------
  // Cancels the ACTIVE run for this kb. A live loop (fresh heartbeat) gets a
  // cancel-flag it honors between turns (`mode:'requested'`); a run whose
  // status stopped moving past KB_DRAIN_STALE_MS is DEAD (the in-process
  // loop is gone — e.g. the bridge restarted mid-drain) and is terminated
  // directly (`mode:'forced'`), so a wedged 'running' status is always
  // resolvable from the UI.
  const cancelMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain\/cancel$/);
  if (cancelMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(cancelMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const active = findActiveKbDrainRun(ctx.forgeRoot, kbId);
      if (!active) {
        // W7 FIX-B-KB (knowledge-14): refuse HONESTLY — when the latest run
        // is already terminal, SAY so (state + runId), so the operator
        // learns why there is nothing to cancel rather than a bare
        // "no active run". No run at all keeps the bare reason (and no
        // fabricated runId).
        const latest = latestKbDrainRun(ctx.forgeRoot, kbId);
        if (latest) {
          sendJson(res, 409, {
            error: `no active drain run for this kb — the latest run "${latest.runId}" is already terminal (state "${latest.status.state}")`,
            runId: latest.runId,
            state: latest.status.state,
          }, origin);
          return true;
        }
        sendJson(res, 409, { error: 'no active drain run for this kb' }, origin);
        return true;
      }
      const updatedMs = new Date(active.status.updatedAt).getTime();
      const stale = !Number.isFinite(updatedMs) || Date.now() - updatedMs > KB_DRAIN_STALE_MS;
      if (stale) {
        // BOTH signals, always (W7-B2 code-review round). A stale status is
        // NOT proof the loop is dead: a drain that sat QUEUED behind another
        // job on the same per-kbId `enqueueConsolidate` lock never heartbeats
        // either, so it reads stale while being perfectly alive. Writing only
        // the terminal status let such a run start late, re-persist 'running'
        // over the operator's 'cancelled', and execute every agent turn to a
        // real terminal AFTER the operator was told it had been terminated.
        // The FLAG is what a late start actually observes (`cancelRequested`).
        requestKbDrainCancel(ctx.forgeRoot, active.runId);
        writeKbDrainStatus(ctx.forgeRoot, active.runId, { ...active.status, state: 'cancelled', updatedAt: new Date().toISOString() });
        sendJson(res, 200, { ok: true, runId: active.runId, mode: 'forced' }, origin);
        return true;
      }
      requestKbDrainCancel(ctx.forgeRoot, active.runId);
      sendJson(res, 200, { ok: true, runId: active.runId, mode: 'requested' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

export async function handleKbActiveJob(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/active-job (W7-B2, knowledge-05) -----------
  // The KB-level "a job is running" fact the action group gates on — the
  // SAME derivation every mutating route 409s with (kb-job-state.ts).
  const activeJobMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/active-job$/);
  if (activeJobMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(activeJobMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const job = deriveKbActiveJob(ctx.forgeRoot, kbId);
      sendJson(res, 200, { ok: true, job, ...(job ? { reason: activeJobReason(job) } : {}) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

export async function handleKbRuns(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/runs (W7-B2, knowledge-20) ------------------
  // Every drain / consolidate / kb-cleanup run recorded for this KB — the
  // data source for the KB screen's RecentRuns widget. All names are
  // SERVER-enumerated directory listings (same class as findKbDrainRuns
  // above); the kbId only ever selects among them, never builds a path tail.
  const runsMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/runs$/);
  if (runsMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(runsMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, runs: listKbRuns(ctx.forgeRoot, kbId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

export async function handleKbDrainRun(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/drain/:runId — must match BEFORE the bare
  // /drain routes below (more specific path). --------------------------------
  const specificMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain\/([^/]+)$/);
  if (specificMatch && method === 'GET') {
    const kbId = decodeURIComponent(specificMatch[1]);
    const runId = decodeURIComponent(specificMatch[2]);
    if (!KB_ID_RE.test(kbId)) {
      sendJson(res, 400, { error: 'invalid kb id' }, origin);
      return true;
    }
    // Never trust runId alone to reach a dir: charset-gated (isSafeRunId,
    // blocks '/' and '..') AND kbId-prefix-checked (a syntactically valid but
    // foreign-kb runId is treated identically to an unknown one — same
    // "unknown drain run" 404, no information about WHICH check failed).
    if (!isSafeRunId(runId) || !runId.startsWith(`${kbId}-drain-`)) {
      sendJson(res, 404, { error: 'unknown drain run' }, origin);
      return true;
    }
    const status = readKbDrainStatus(ctx.forgeRoot, runId);
    if (!status) {
      sendJson(res, 404, { error: 'unknown drain run' }, origin);
      return true;
    }
    sendJson(res, 200, { ok: true, runId, ...status }, origin);
    return true;
  }

  return false;
}

export async function handleKbDrainStart(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const baseMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain$/);

  // ---- POST /api/studio/kbs/:id/drain — dispatch ---------------------------
  if (baseMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(baseMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      if (!resolveKbBrainDir(ctx.forgeRoot, kbId)) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      const active = findActiveKbDrainRun(ctx.forgeRoot, kbId);
      if (active) {
        sendJson(res, 409, { error: 'a drain run is already active for this kb', runId: active.runId }, origin);
        return true;
      }
      // W7-B2 (knowledge-05): a live CONSOLIDATE also blocks a new drain —
      // queueing behind it invisibly is exactly the confusion the action
      // group exists to end; the 409 carries the same reason the UI shows.
      const otherJob = deriveKbActiveJob(ctx.forgeRoot, kbId);
      if (otherJob && otherJob.kind !== 'drain') {
        sendJson(res, 409, { error: activeJobReason(otherJob), runId: otherJob.runId }, origin);
        return true;
      }

      // Server-minted, kbId-prefixed — mirrors consolidate's own
      // `${kbId}-consolidate-${Date.now().toString(36)}` runId shape
      // (cli/bridge-studio-kbs.ts).
      const runId = `${kbId}-drain-${Date.now().toString(36)}`;

      // Write the initial 'running' snapshot SYNCHRONOUSLY, before queuing —
      // enqueueConsolidate defers real execution (CONSOLIDATE_DISPATCH_DEFER_MS),
      // so without this an immediate second POST would race past the 409
      // check above and see no status file yet. runKbDrain also (re-)writes
      // this same snapshot as its own first step, so a caller that invokes it
      // directly (unit tests) still gets a real initial status.
      writeKbDrainStatus(ctx.forgeRoot, runId, initialKbDrainStatus(kbId));

      // W7-B2 (knowledge-13): create the run's event log SYNCHRONOUSLY too —
      // the UI's one-shot event snapshot fetch fires the instant this route
      // returns a runId, but the queued job (createLogger inside runKbDrain)
      // only writes events.jsonl after the dispatch defer + any queue
      // backlog. Without this the fetch 404s and never retries.
      createLogger(`_kb-drain-${runId}`, join(ctx.forgeRoot, '_logs')).emit({
        initiative_id: `_kb-drain-${runId}`,
        phase: 'reflection',
        skill: 'kb-drain',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'kb-drain.queued',
        metadata: { kind: 'progress', kbId, runId },
      });

      enqueueConsolidate(kbId, async () => {
        await runKbDrain(ctx.forgeRoot, kbId, runId);
      });
      sendJson(res, 200, { ok: true, runId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

export async function handleKbDrainStatus(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: this function is reached BOTH
  // from `handleStudioKbDrainRoutes` (which already stripped) and from
  // `packages/knowledge/routes.ts`'s table, which hands handlers the RAW
  // url so any arm that later needs the query string still has it.
  // `pathOnly` is idempotent, so the pre-stripped call path is unchanged;
  // without this line a query-bearing request fails every anchored regex
  // below and 404s silently.
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const baseMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain$/);

  // ---- GET /api/studio/kbs/:id/drain — active-or-latest (page reattach) ---
  if (baseMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(baseMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const chosen = findActiveKbDrainRun(ctx.forgeRoot, kbId) ?? latestKbDrainRun(ctx.forgeRoot, kbId);
      if (!chosen) {
        sendJson(res, 200, { ok: true, runId: null }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, runId: chosen.runId, ...chosen.status }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
