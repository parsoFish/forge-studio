/**
 * verify-cycle-stage2.mjs — stage 2's hand-off and the wait that counts an
 * initiative as LANDED, for whichever flow `--flow` selected.
 *
 * Split out of `verify-cycle.mjs` (baselined over the 800-line cap; an
 * exemption is a ceiling, not a licence) when `--flow` made both halves
 * flow-dependent: forge-develop keeps its batch door and its reflector.end
 * wait; any other flow goes through the generic per-flow door and, when it
 * declares no `on: merged` reflect, is landed on its manifest reaching
 * `_queue/merged/` OR `_queue/done/` — R4-11-F1's confirmed-remote-merge
 * queue states (packages/flows/queue.ts's `QueueState`; `merged/ → done/` is
 * a same-sweep promotion, not a second merge) — the same authoritative merge
 * signal `assessOutcomes` reads (T3 M7-A fix round, 2026-09-25: a manifest
 * that lands in `merged/` and never gets promoted, because the reflector that
 * would trigger the promotion was killed first, is STILL a landed cycle).
 *
 * Collaborators are injected (`bridgePost`, `log`, `sleep`) so the harness's
 * own transport and logger stay the only ones.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from '@forge/flows';
import { classifyReflectorProgress } from './lib/verify-outcomes.mjs';
import { stageTwoRequest } from './verify-cycle-flow.mjs';

/**
 * @param {object} deps
 * @param {string} deps.forgeRoot
 * @param {{ flowId: string, door: 'develop-start' | 'flow-run' }} deps.flow
 * @param {boolean} deps.flowReflects  the flow declares `{on: merged, ref: reflector}`
 * @param {(bridgeUrl: string, path: string, payload: unknown) => Promise<{ ok: boolean, status: number, body: any }>} deps.bridgePost
 * @param {(msg: string) => void} deps.log
 * @param {(ms: number) => Promise<void>} deps.sleep
 */
export function createStageTwo({ forgeRoot, flow, flowReflects, bridgePost, log, sleep }) {
  /** Stage 2 hand-off — POST /api/develop/start to repoint the initiative onto
   *  forge-develop (same cycle_id, reusing the architect worktree + work items).
   *  plan-everything-before-kickoff: the endpoint is now batch-shaped
   *  ({initiativeIds: string[]} -> {ok, results}); this caller sends a single-
   *  id batch and unwraps the one result. */
  async function handoffToDevelop(bridgeUrl, initiativeIds) {
    log(`hand-off — POST /api/develop/start [${initiativeIds.join(', ')}]…`);
    const r = await bridgePost(bridgeUrl, '/api/develop/start', { initiativeIds });
    if (!r.ok) throw new Error(`develop start failed (${r.status}): ${JSON.stringify(r.body)}`);
    const results = r.body?.results ?? [];
    for (const result of results) {
      if (!result.ok) throw new Error(`develop start failed for ${result.initiativeId}: ${JSON.stringify(result)}`);
      log(`develop run enqueued: ${result.initiativeId} (cycle_id ${result.cycleId ?? '?'})`);
    }
    return results;
  }

  /** Any other flow: the generic per-flow door, one initiative per request,
   *  confirming the repoint from the plan flow. */
  async function handoff(bridgeUrl, initiativeIds) {
    if (flow.door === 'develop-start') return handoffToDevelop(bridgeUrl, initiativeIds);
    const results = [];
    for (const initiativeId of initiativeIds) {
      const { path, payload } = stageTwoRequest(flow, initiativeId);
      log(`hand-off — POST ${path} ${initiativeId} (confirming the repoint from ${payload.confirmRepointFrom})…`);
      const r = await bridgePost(bridgeUrl, path, payload);
      if (!r.ok || r.body?.ok !== true) throw new Error(`${flow.flowId} hand-off failed for ${initiativeId} (${r.status}): ${JSON.stringify(r.body)}`);
      log(`${flow.flowId} run enqueued: ${initiativeId}`);
      results.push(r.body);
    }
    return results;
  }

  /** Wait for the reflector to FINISH or DIE (`reflector.end` / `cycle.reflection-lost`).
   *  The bridge fires finalize→reflect detached after the approve; the old harness
   *  tore the bridge down ~3 s later, killing reflect mid-start. Bounded; true only
   *  when reflection genuinely `ended`.
   *
   *  M0-A round-2 defect B: scanning only for `reflector.end` meant a reflector that
   *  died loudly burned the FULL deadline and then logged the neutral "not seen
   *  before deadline" — slow-looking rather than dead (12 of run 1's 47 minutes).
   *  `classifyReflectorProgress` returns the moment the outcome is known, and a
   *  `lost` is always named with its cause.
   *
   *  T3 M7-A fix round (2026-09-25): the caller passes `deadlineMs` as
   *  `resolveReflectWaitDeadlineMs(approvedAtMs)` (verify-outcomes.mjs's
   *  `REFLECT_LANDED_WAIT_MS`) — this function never reads a run-start value
   *  or tears anything down itself; it only stops POLLING at the deadline and
   *  says, BY NAME, whether a still-running reflector (not lost, not ended)
   *  is what the deadline cut off — the exact ambiguity that let the harness's
   *  teardown read a live reflector as "the run is done". */
  async function waitForReflectorEnd(cycleId, deadlineMs) {
    const logFile = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
    let loggedStart = false;
    while (Date.now() < deadlineMs) {
      let lines = [];
      try {
        lines = readFileSync(logFile, 'utf8').split('\n');
      } catch { /* log not yet present */ }
      const progress = classifyReflectorProgress(lines);
      if (progress.state === 'started' && !loggedStart) {
        loggedStart = true;
        log('reflector.start seen — waiting for reflector.end…');
      }
      if (progress.state === 'ended') {
        log('reflector.end seen — reflection complete');
        return true;
      }
      if (progress.state === 'lost') {
        log(`reflection LOST (not merely slow) — ${progress.detail}`);
        return false;
      }
      await sleep(3000);
    }
    if (loggedStart) {
      log('REFLECT-WAIT-BOUND-EXCEEDED: reflector.start was seen but no reflector.end/loss before the deadline — reflection is still in flight, not lost; tearing down anyway');
    } else {
      log('REFLECT-WAIT-BOUND-EXCEEDED: no reflector activity observed at all before the deadline');
    }
    return false;
  }

  /** A flow that fires no reflect is landed when finalize moves its manifest to
   *  EITHER `_queue/merged/` or `_queue/done/` (R4-11-F1: `merged` is itself the
   *  confirmed-remote-merge state; the same-sweep `merged/ → done/` promotion
   *  can be prevented by a killed reflector on a flow that DOES reflect, but a
   *  flow with none declared never depends on that promotion happening at all). */
  async function waitForManifestLanded(initiativeId, deadlineMs) {
    const paths = getPaths(join(forgeRoot, '_queue'));
    const filename = `${initiativeId}.md`;
    const merged = join(paths.merged, filename);
    const done = join(paths.done, filename);
    while (Date.now() < deadlineMs) {
      if (existsSync(done)) { log(`finalize landed ${initiativeId} in _queue/done/`); return true; }
      if (existsSync(merged)) { log(`finalize landed ${initiativeId} in _queue/merged/`); return true; }
      await sleep(3000);
    }
    log(`${initiativeId} not in _queue/merged/ or _queue/done/ before deadline`);
    return false;
  }

  /** After an approved verdict: the bridge merges and finalizes detached — wait
   *  for what THIS flow ends on before counting the initiative as landed (S9). */
  async function waitLanded(init, deadlineMs) {
    if (flowReflects) {
      log(`verdict approved for ${init.initiativeId} — waiting for finalize + reflector.end…`);
      return waitForReflectorEnd(init.cycleId, deadlineMs);
    }
    log(`verdict approved for ${init.initiativeId} — ${flow.flowId} declares no on:merged reflect; waiting for finalize…`);
    return waitForManifestLanded(init.initiativeId, deadlineMs);
  }

  return { handoff, waitLanded };
}
