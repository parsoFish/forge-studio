/**
 * bridge-run-triggers — the operator-facing enqueue routes on the bridge.
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change).
 *
 *   POST /api/develop/start           → batch: repoint N initiatives at the
 *                                        forge-develop flow and make them
 *                                        claimable
 *   POST /api/initiatives/:id/plan    → repoint ONE WI-less initiative at the
 *                                        forge-architect flow (decompose only)
 *   POST /api/flows/:id/run           → enqueue an EXISTING initiative onto
 *                                        the named flow (ADR-041 generic
 *                                        per-flow claimable enqueue)
 *
 * Each is a manifest-move queue-state transition; none spawns in-request —
 * the scheduler daemon claims the manifest and runs the flow later.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError } from '@forge/kernel';
import { MAX_KICKOFF_COST_CEILING_USD } from '@forge/kernel';
import { flowRoots, resolveIdAcrossRoots } from '@forge/kernel/discovery-roots.ts';
import { getPaths } from '@forge/flows/queue.ts';
import { persistManifestCostCeiling } from '@forge/flows/manifest.ts';
import { enqueueDevelopRun } from '@forge/flows/enqueue-develop-run.ts';
import { enqueuePlanRun } from '@forge/flows/enqueue-plan-run.ts';
import { enqueueFlowRun } from '@forge/flows/enqueue-flow-run.ts';

/** The context these run-trigger routes need from the host. */
export type RunTriggerContext = {
  forgeRoot: string;
  queueRoot: string;
};

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB, mirrors ui-bridge.ts's own readJson

/** Private per-module copy — mirrors `readJson` in `ui-bridge.ts` (T1 ruling
 *  30's shape does not apply here: this file lives beside the host, not
 *  behind a package boundary, and follows the same sibling-copy convention
 *  `apps/forge/bridge-studio.ts` already uses). */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
}

/**
 * The develop/plan/flow run-trigger family. Dispatched from `handleHttp`
 * after the scheduler-lifecycle routes and before the review-comments family
 * — same position the arms held inline. Returns `false` on no match
 * (passthrough to the next handler).
 */
export async function handleRunTriggerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RunTriggerContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // Start development (S7 / DEC-3) — the roadmap "start development" button.
  // Repoints each initiative's manifest at the forge-develop flow and makes it
  // claimable (the real enqueue behind the develop trigger). Batch (plan-
  // everything-before-kickoff): the roadmap can decompose N initiatives up
  // front, so kickoff accepts N ids at once and reports a per-id result
  // rather than one HTTP status for the whole request. The global CSRF guard
  // above (x-forge-csrf) already gates this POST.
  if (method === 'POST' && url === '/api/develop/start') {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const rawIds = body['initiativeIds'];
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        sendJson(res, 400, { error: 'initiativeIds required (non-empty string array)' }, origin);
        return true;
      }
      // Validate the WHOLE batch before any enqueue — a mixed-validity request
      // is rejected outright (no silent filtering, no partial side effects).
      const invalid = rawIds
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => typeof v !== 'string' || v.length === 0);
      if (invalid.length > 0) {
        const named = invalid.map(({ v, i }) => `[${i}]=${JSON.stringify(v)}`).join(', ');
        sendJson(res, 400, { error: `initiativeIds contains invalid entries (must be non-empty strings): ${named}` }, origin);
        return true;
      }
      // Dedupe, preserving first-occurrence order — one enqueue + one result per id.
      const initiativeIds = [...new Set(rawIds as string[])];

      // forge-shc WI-1 (T1 ruling): an operator per-run cost-ceiling override
      // is accepted ONLY on a single-id batch — a single scalar can't map
      // onto N manifests unambiguously. Validated fully BEFORE any enqueue
      // side effect (mirrors the 3-stage discipline at
      // `POST /api/agents/:slug/run` — batch-shape, then value bounds — a
      // refused request never repoints or stamps any manifest).
      let costCeilingUsd: number | undefined;
      if (body.costCeilingUsd !== undefined) {
        if (initiativeIds.length > 1) {
          sendJson(
            res,
            400,
            { error: `costCeilingUsd may only be supplied with a single initiativeId (got ${initiativeIds.length})` },
            origin,
          );
          return true;
        }
        const v = body.costCeilingUsd;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return true;
        }
        costCeilingUsd = v;
      }

      // W8-A3 (`flows-37`, review round 2 finding 2): the operator's answer to a
      // repoint, forwarded like the other two doors. Without it NO client could
      // confirm through this route at all — the per-card "Start development"
      // control posts exactly ONE named initiative and was left telling the
      // operator to "confirm the repoint" through a route with no way to.
      //
      // Review round 3, S2-4: it is REFUSED for a multi-id batch, before any
      // enqueue runs — the same shape `costCeilingUsd` uses 30 lines above, and
      // for the same reason. A confirmation that accompanies N ids rubber-stamps
      // N moves the calling surface cannot show, which is the shape this lane
      // exists to remove; leaving that as a client-side convention while the
      // route accepted it is precisely the doctrine this module writes down and
      // would then have violated.
      const developConfirmRepointFrom = typeof (body as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
        ? ((body as Record<string, unknown>)['confirmRepointFrom'] as string)
        : undefined;
      if (developConfirmRepointFrom !== undefined && initiativeIds.length > 1) {
        sendJson(
          res,
          400,
          { error: 'confirmRepointFrom is only valid for a single-initiative request — a batch cannot confirm a move it cannot show' },
          origin,
        );
        return true;
      }

      const results = initiativeIds.map((initiativeId) => {
        // Per-item isolation: a throw on one item must not 500 away the
        // results of items whose side effects already applied.
        try {
          const result = enqueueDevelopRun(initiativeId, { queueRoot: ctx.queueRoot, confirmRepointFrom: developConfirmRepointFrom });
          if (result.status === 'enqueued' && costCeilingUsd !== undefined) {
            // Single-id-only invariant (checked above) means this fires at
            // most once per request — stamp only when the operator supplied
            // an explicit, already-validated ceiling; never fabricate one.
            // shc review finding 2: fold the REAL outcome into the per-item
            // result as `ceilingStamped` — a silently-failed stamp (the
            // manifest went missing/unwritable between enqueue and stamp)
            // must stay distinguishable from a landed one, never reported as
            // an unconditional success.
            const pendingPath = join(getPaths(ctx.queueRoot).pending, `${initiativeId}.md`);
            const ceilingStamped = persistManifestCostCeiling(pendingPath, costCeilingUsd);
            return { ...result, ok: result.status === 'enqueued', ceilingStamped };
          }
          return { ...result, ok: result.status === 'enqueued' };
        } catch (err) {
          return { status: 'error' as const, initiativeId, ok: false, detail: sanitizeError(err) };
        }
      });
      const ok = results.every((r) => r.ok);
      sendJson(res, 200, { ok, results }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }


  // Plan (R4-05 / F4) — the roadmap's per-initiative "Plan" trigger. Repoints
  // ONE WI-less initiative's manifest at the forge-architect flow (decompose
  // only) and makes it claimable — the same manifest-move queue-state
  // transition as "start development" above, just single-id: unlike the batch
  // develop/start route, there is exactly one outcome per request here, so it
  // maps directly onto real HTTP statuses instead of a per-id results array.
  // No in-request spawn — the scheduler claims it later and runs
  // execPm -> runProjectManager.
  if (method === 'POST' && url.startsWith('/api/initiatives/') && url.endsWith('/plan')) {
    const initiativeId = decodeURIComponent(url.slice('/api/initiatives/'.length, url.length - '/plan'.length));
    if (!initiativeId) {
      sendJson(res, 400, { error: 'initiativeId required' }, origin);
      return true;
    }
    // W8-A3 (`flows-37`, review round 1 S2-2): the third door onto a repoint.
    // Same compare-and-swap forward as `POST /api/flows/:id/run`; the rule
    // itself lives on `enqueuePlanRun`.
    let planBody: unknown;
    try {
      planBody = await readJson(req);
    } catch {
      planBody = {};
    }
    const planConfirmRepointFrom = typeof (planBody as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
      ? ((planBody as Record<string, unknown>)['confirmRepointFrom'] as string)
      : undefined;
    try {
      const result = enqueuePlanRun(initiativeId, { queueRoot: ctx.queueRoot, confirmRepointFrom: planConfirmRepointFrom });
      const httpStatus =
        result.status === 'enqueued' ? 200 :
        result.status === 'not-found' ? 404 :
        result.status === 'already-running' || result.status === 'repoint-requires-confirm' ? 409 :
        500;
      sendJson(res, httpStatus, { ...result, ok: result.status === 'enqueued' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // W7-A3 (flows-02/03) — per-flow run trigger: enqueue an EXISTING
  // initiative onto THIS flow (`enqueueFlowRun`, the ADR-041 generic per-flow
  // claimable enqueue). The flow monitor's generic "Start Run" used to POST the
  // flow id as an initiativeId to /api/runs (always 400, silently). Same
  // status→HTTP mapping as the plan route above; the scheduler claims it later.
  if (method === 'POST' && url.startsWith('/api/flows/') && url.endsWith('/run')) {
    const flowId = decodeURIComponent(url.slice('/api/flows/'.length, url.length - '/run'.length));
    if (!/^[a-z0-9][a-z0-9-]*$/.test(flowId)) {
      sendJson(res, 400, { error: 'invalid flow id' }, origin);
      return true;
    }
    // Existence through the guard family (never a raw fs probe on a
    // request-derived segment): the flow id is a single slug segment,
    // searched across every flow root (SEAM F1) — `studio/flows` AND every
    // `packages/<pkg>/flows`. `resolveIdAcrossRoots` THROWS, naming both
    // paths, if the id is a real flow under more than one root — never
    // "first root wins" — so this is wrapped (every other branch below sends
    // its own 500 on throw; `handleHttp` has no single top-level catch).
    let flowMatch;
    try {
      flowMatch = resolveIdAcrossRoots(flowRoots(ctx.forgeRoot), flowId, ['flow.yaml']);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }
    if (flowMatch === null) {
      sendJson(res, 404, { error: 'flow not found', flowId }, origin);
      return true;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' }, origin);
      return true;
    }
    const initiativeId = typeof (body as Record<string, unknown>)?.['initiativeId'] === 'string'
      ? ((body as Record<string, unknown>)['initiativeId'] as string)
      : '';
    if (!initiativeId) {
      sendJson(res, 400, { error: 'initiativeId required' }, origin);
      return true;
    }
    // W8-A3 (`flows-37`): the operator's confirmation, forwarded verbatim as the
    // FLOW they were shown — a compare-and-swap, not a boolean override (review
    // round 3, S2-3). A non-string is carried as `undefined`, i.e. no
    // confirmation at all, so an accidental client serialization fails closed.
    // The RULE is the enqueue's; this line only carries the operator's answer.
    const confirmRepointFrom = typeof (body as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
      ? ((body as Record<string, unknown>)['confirmRepointFrom'] as string)
      : undefined;
    try {
      // W7-FIX-A3 (A3-01, round-2 finding 6): the OPERATOR route refuses a
      // shipped initiative — and the rule now lives ON `enqueueFlowRun`
      // (`allowFinishedSource`, default off) rather than as a pre-check bolted
      // onto this one route, so the sibling operator route
      // (`POST /api/develop/start`) is closed by the same guard instead of
      // still yanking a merged manifest out of `done/`. The route only maps
      // the status onto its HTTP code; the id rule + the fs probe are the
      // enqueue's own (one INIT predicate, no third copy of the regex here).
      const result = enqueueFlowRun(initiativeId, flowId, { queueRoot: ctx.queueRoot, confirmRepointFrom });
      const httpStatus =
        result.status === 'enqueued' ? 200 :
        result.status === 'not-found' ? 404 :
        result.status === 'already-running' || result.status === 'already-done' ||
          result.status === 'not-planned' || result.status === 'repoint-requires-confirm' ? 409 :
        500;
      sendJson(res, httpStatus, { ...result, ok: result.status === 'enqueued' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
