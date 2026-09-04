/**
 * bridge-agents-runs.ts — the three `/api/agents/runs/*` handlers.
 *
 * Carved out of `apps/forge/ui-bridge.ts` (M4-agents, exit row 2), converted from
 * if-chain arms returning `void` into `RouteEntry` handlers returning
 * `Promise<boolean>`: every `return;` that answered the request is now
 * `return true;`, and an arm that declines returns `false` so dispatch
 * continues — mirroring the fall-through the if-chain relied on.
 *
 * ORDER IS LOAD-BEARING and is pinned in `tests/contract/routes-table.test.ts`:
 * `runs/recent` and `runs/:runId/cancel` must both be matched BEFORE
 * `runs/:runId`, which would otherwise claim the literal `recent` and the
 * `cancel` suffix as run ids. The if-chain relied on the same order; the table
 * preserves it rather than re-deriving it.
 *
 * CSRF is NOT re-implemented here. `apps/forge/ui-bridge.ts`'s `handleHttp` applies
 * the `x-forge-csrf` gate to every non-GET request BEFORE it calls
 * `dispatchRoute`, so the cancel POST inherits that check by dispatch order.
 * The ordering is asserted by a test, not trusted to a comment.
 */

import { allowedOrigin, createLogger, resolveGuardedPath, sanitizeError, sendJson } from '@forge/kernel';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { isSafeRunId } from './run-agent.ts';
import { deriveStandaloneRunState, STANDALONE_RUN_DIR_PREFIX } from './bridge-agents-run-state.ts';
import { collectRecentAgentRuns, RECENT_AGENT_RUNS_DEFAULT_LIMIT, RECENT_AGENT_RUNS_MAX_LIMIT } from './bridge-agents-history-rows.ts';
import type { RouteContext } from '@forge/kernel';
import type { AgentHistoryDeps } from './bridge-agents-history-rows.ts';

/**
 * Bridge-instance state and the rank-4 calls these three handlers need.
 * `ensureAgentRunTail`/`releaseAgentRunTail` are the bridge's OWN
 * `ensureTailFor`/`stopTailFor` closures — the same pair that backs session and
 * live-cycle tailing. They are injected, never duplicated: a second tail
 * registry would silently diverge from the one the rest of the bridge uses.
 */
export type AgentRunsDeps = AgentHistoryDeps & {
  /** `killTrackedRun` (`@forge/sessions`) — kills a dispatch child only when its
   *  argv proves ownership; a dead/unowned/absent pid is an honest `false`. */
  killTrackedRun(logsRoot: string, runId: string): boolean;
  ensureAgentRunTail(runId: string): void;
  releaseAgentRunTail(runId: string): void;
};

type Handler = (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => Promise<boolean>;

/**
 * W7-B5 (agents-03/04/39) — the aggregate recent-runs route. Matched BEFORE
 * the per-runId detail route ('recent' is not a real run id; real ids are
 * `_agent-*` or cycle-shaped, so no collision is possible, but the table's
 * order makes it structural rather than lucky).
 */
export const handleAgentRunsRecent = (deps: AgentRunsDeps): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  const url = req.url ?? '';
  try {
    const qs = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : new URLSearchParams();
    const rawLimit = qs.get('limit');
    let limit = RECENT_AGENT_RUNS_DEFAULT_LIMIT;
    if (rawLimit !== null) {
      const parsedLimit = Number(rawLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > RECENT_AGENT_RUNS_MAX_LIMIT) {
        sendJson(res, 400, { error: `invalid limit: ${JSON.stringify(rawLimit)} (must be an integer 1..${RECENT_AGENT_RUNS_MAX_LIMIT})` }, origin);
        return true;
      }
      limit = parsedLimit;
    }
    // Review round 1 — `kind` is a SERVER-SIDE filter, applied before the
    // bound. Home merges this ledger with its OWN flow-run rows and drops
    // every duplicate, so on an install with `limit` or more recent flow
    // runs the entire window came back as rows Home already had and threw
    // away, leaving zero standalone agent rows on the page. Asking the
    // server for rows the caller will discard is the bug; `kind` lets Home
    // spend its budget on the rows only this route can supply.
    const rawKind = qs.get('kind');
    if (rawKind !== null && rawKind !== 'flow' && rawKind !== 'standalone' && rawKind !== 'all') {
      sendJson(res, 400, { error: `invalid kind: ${JSON.stringify(rawKind)} (must be "flow", "standalone" or "all")` }, origin);
      return true;
    }
    const kind = (rawKind ?? 'all') as 'flow' | 'standalone' | 'all';
    sendJson(res, 200, { ok: true, rows: collectRecentAgentRuns(deps, ctx.forgeRoot, ctx.logsRoot, limit, kind) }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
  return true;
};

/**
 * W7-B5 (agents-30 / projects-29) — cancel a dispatched standalone run.
 * CSRF: the host's global `x-forge-csrf` guard gates every POST before
 * `dispatchRoute` is reached. Containment: `runId` passes `isSafeRunId` (a
 * single `_logs/` segment) and the SAME `resolveGuardedPath` choke point the
 * detail route uses; a rejected guard and a genuinely absent run collapse into
 * ONE 404.
 */
export const handleAgentRunCancel = (deps: AgentRunsDeps): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  const url = req.url ?? '';
  // Review round 1: `decodeURIComponent` throws `URIError` on a malformed
  // escape (`%E0%A4%A`), and `handleHttp` is invoked as `void handleHttp(…)`
  // with no top-level catch — an unhandled rejection that never writes a
  // response and, under `--unhandled-rejections=throw`, takes the bridge
  // down. Same guard shape the sibling history route in this file already
  // applies to its own decode.
  let runId: string;
  try {
    runId = decodeURIComponent(url.slice('/api/agents/runs/'.length, url.length - '/cancel'.length));
  } catch {
    sendJson(res, 400, { error: 'invalid runId: malformed percent-encoding' }, origin);
    return true;
  }
  if (!isSafeRunId(runId)) {
    sendJson(res, 400, { error: `invalid runId: ${JSON.stringify(runId)}` }, origin);
    return true;
  }
  // Review round 1 — SCOPE. `isSafeRunId` gates CHARSET, not identity:
  // every cycle id under `_logs/` passes it too. Without this check,
  // cancelling a live develop cycle's id found a real `_logs/<cycleId>`,
  // derived `running` (no `end` event yet), found no `turn.pid`, and
  // answered `200 {ok:true, killed:false}` — having appended an
  // `agent-dispatch.cancelled` line into the RUNNING cycle's own
  // events.jsonl. The cycle kept going, the operator was told it had been
  // cancelled, and a marker no flow-run derivation expects was left in a
  // real cycle log. Reachable, not hypothetical: `GET /api/agents/runs/
  // recent` serves flow-run rows whose `id` IS a cycle id. This route
  // cancels STANDALONE dispatches only — a flow run is cancelled through
  // its own flow/scheduler surface.
  if (!runId.startsWith(STANDALONE_RUN_DIR_PREFIX)) {
    sendJson(
      res,
      400,
      { error: `not a standalone agent run: ${JSON.stringify(runId)} (this route cancels ${JSON.stringify(STANDALONE_RUN_DIR_PREFIX)}* dispatches; cancel a flow run from its flow)` },
      origin,
    );
    return true;
  }
  const cancelDirGuard = resolveGuardedPath(ctx.logsRoot, [runId]);
  if (!cancelDirGuard.ok || !cancelDirGuard.exists) {
    sendJson(res, 404, { error: `no run found for id ${JSON.stringify(runId)}` }, origin);
    return true;
  }
  try {
    const current = deriveStandaloneRunState(deps, ctx.logsRoot, runId);
    // W8-A2 (ON-7 defect 4) — 'stalled' is NOT terminal (applyStandaloneStaleness's
    // own doc comment: it only ever narrows 'running'). A stalled run is
    // exactly the shape an operator most wants to cancel — a wedged or
    // zombie process — so this MUST stay cancellable, or 'stalled' becomes
    // a state an operator can see but never act on. Before this fix every
    // non-'running' state WAS terminal; that implicit equivalence broke
    // the moment 'stalled' stopped being one — caught here, not shipped.
    if (current.state !== 'running' && current.state !== 'stalled') {
      sendJson(res, 409, { error: `run is already terminal (${current.state}) — nothing to cancel` }, origin);
      return true;
    }
    // Kill the tracked dispatch child if one is alive AND provably ours
    // (its argv carries this runId as a whole element — the `--run-id`
    // value `spawnAgentDispatch` passed). A dead/unowned/absent pid is an
    // honest `killed:false`; the marker below still lands either way, so
    // the run reads `cancelled` (sticky) rather than `running` forever.
    const killed = deps.killTrackedRun(ctx.logsRoot, runId);
    createLogger(runId, ctx.logsRoot).emit({
      initiative_id: runId,
      phase: 'orchestrator',
      skill: 'ui-bridge',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'agent-dispatch.cancelled',
      metadata: { killed, cancelled_by: 'operator' },
    });
    sendJson(res, 200, { ok: true, killed }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
  return true;
};

/**
 * R6-04 D22 follow-up: a genuinely unknown runId (no `_logs/<runId>` directory
 * at all — never dispatched) 404s instead of fabricating `state: 'running'`, so
 * `RunView.tsx`'s `found:false` prop has a real signal. Keyed off the run
 * DIRECTORY, not `events.jsonl` — a freshly-dispatched run's directory exists
 * before its first event lands, and that case must keep reporting
 * 200/`running`/`lines: []`, never 404.
 */
export const handleAgentRunDetail = (deps: AgentRunsDeps): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  const url = req.url ?? '';
  const runId = decodeURIComponent(url.slice('/api/agents/runs/'.length));
  if (!isSafeRunId(runId)) {
    sendJson(res, 400, { error: `invalid runId: ${JSON.stringify(runId)}` }, origin);
    return true;
  }
  // R6-06 round 6: this route's `runId` reaches `_logs/<runId>` the SAME
  // way an enumerated history-route entry does — `isSafeRunId` gates
  // charset/shape only, never containment, so a poisoned `_logs/<runId>`
  // (a directory symlink, mirroring escape 1) would previously have been
  // followed by a plain `existsSync`. Guarded here with the SAME
  // `resolveGuardedPath` choke point `deriveStandaloneRunState` now uses
  // internally for the leaf — a rejected guard and a genuinely absent
  // directory both collapse into the SAME 404 (never dispatched), never a
  // distinguishable error.
  const runDirGuard = resolveGuardedPath(ctx.logsRoot, [runId]);
  if (!runDirGuard.ok || !runDirGuard.exists) {
    sendJson(res, 404, { error: `no run found for id ${JSON.stringify(runId)}` }, origin);
    return true;
  }
  try {
    // D3.5/shared-derivation (R6-06 WI-1): the SAME function the new
    // history route's standalone-path rows use — see
    // `deriveStandaloneRunState`'s own doc comment. `costUsd: null` (not a
    // fabricated `0`) once a run has no `end` event yet — Amendment 2.
    const derived = deriveStandaloneRunState(deps, ctx.logsRoot, runId);
    // W7-B5 (agents-20): a LIVE standalone run must be tailed so the
    // thinking drawer/run page stream instead of freezing. Re-armed here
    // (the panel/run page poll this route) so a WS reconnect — which
    // resets every tail — recovers on the next poll tick.
    // Arm while live, RELEASE once terminal (review round 1) — otherwise
    // a finished run's immutable log keeps being polled for the whole life
    // of the Studio session.
    if (derived.state === 'running') deps.ensureAgentRunTail(runId);
    else deps.releaseAgentRunTail(runId);
    sendJson(res, 200, {
      ok: true,
      state: derived.state,
      costUsd: derived.costUsd,
      events: derived.events,
      lines: derived.lines,
      // W7-B5: outputRefs (agents-06) + errorText (agents-19) + ceilingUsd
      // (agents-31) — see StandaloneRunState's field docs.
      outputRefs: derived.outputRefs,
      ...(derived.errorText !== undefined ? { errorText: derived.errorText } : {}),
      ...(derived.ceilingUsd !== undefined ? { ceilingUsd: derived.ceilingUsd } : {}),
    }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
  return true;
};
