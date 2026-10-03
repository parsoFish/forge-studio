/**
 * serve-wait.mjs — the one place both harness drivers
 * (`scripts/verify-cycle.mjs`, `scripts/stories/d12-demo-runs.mjs`) wait on
 * `forge serve`'s progress.
 *
 * `forge studio` starts and supervises a forever-mode `forge serve` the same
 * way it supervises the bridge and the UI (ADR 011/031, M7-E row 205):
 * whenever serve is live it claims every eligible manifest in
 * `_queue/pending/` on its own. Neither driver spawns `forge serve` itself —
 * both wait on the SAME two observables the product exposes: the queue
 * directory a manifest sits in (`scripts/lib/queue-state.mjs`'s
 * `manifestQueueState`, mirroring `packages/flows/queue.ts`'s own
 * `QueueState`) and the cycle's own `_logs/<cycleId>/events.jsonl`
 * (classified by `scripts/verify-cycle-stage-outcome.mjs`'s
 * `classifyCycleEventLog`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { manifestQueueState } from './queue-state.mjs';
import { classifyCycleEventLog } from '../verify-cycle-stage-outcome.mjs';

/** How long `GET /api/health` is given to answer before `assertServeRunning`
 *  gives up and refuses — short, mirroring the other health-probe timeouts
 *  in this tree (e.g. `apps/studio/lib/bridge-client-core.ts`'s
 *  `BRIDGE_HEALTH_PROBE_TIMEOUT_MS`). */
export const HEALTH_PROBE_TIMEOUT_MS = 4000;

/** The default interval a wait loop sleeps between polls of queue state +
 *  the event log. Short: both reads are local filesystem checks, not a
 *  network round trip, so polling often costs nothing. */
export const DEFAULT_POLL_MS = 3000;

/**
 * Refuse to start a stage wait unless `forge studio`'s supervised serve is
 * actually live — a stage that waits against a serve that was never going
 * to claim anything would otherwise hang silently until its own deadline,
 * reporting a timeout that looks like a stuck cycle rather than what it
 * really is: no serve to claim the manifest at all.
 *
 * Throws a clear, named `Error` when `GET <bridgeUrl>/api/health` cannot be
 * read, or answers with a `serve.state` other than `expect` (`'running'`;
 * a dry-bridge studio that must claim nothing expects `'unsupervised'`).
 * Never returns a value — callers treat a resolved promise as the assertion
 * holding.
 */
export async function assertServeRunning(bridgeUrl, { fetchImpl = fetch, expect = 'running' } = {}) {
  const url = `${bridgeUrl}/api/health`;
  let body;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    throw new Error(
      `assertServeRunning: could not read ${url} (${err.message}) — forge studio must be up and ` +
        'supervising a live serve before a stage waits on it.',
    );
  }
  const state = body?.serve?.state;
  if (state !== expect) {
    throw new Error(
      `assertServeRunning: serve is "${state ?? '(missing)'}", not "${expect}" ` +
        `(GET ${url} → serve: ${JSON.stringify(body?.serve ?? null)}).`,
    );
  }
}

/** Raw JSONL lines for a cycle's own event log, or `[]` when the log does
 *  not exist yet (the cycle has not been claimed, or was claimed this
 *  instant and has not written its first event). Never throws. */
export function readCycleEventLines(forgeRoot, cycleId) {
  if (!cycleId) return [];
  try {
    return readFileSync(join(forgeRoot, '_logs', cycleId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll one initiative's manifest + cycle log until the manifest leaves
 * `pending`/`in-flight`/`absent` for a resolved queue state, OR the cycle's
 * own event log shows a decisive failure (`classifyCycleEventLog`), OR
 * `deadlineMs` passes.
 *
 * `cycleId` may be a fixed string (the caller already knows it — e.g.
 * `verify-cycle.mjs`'s architect hand-off, whose manifest carries `cycle_id`
 * from the moment it is promoted) or a function re-resolved on every poll
 * (the caller does NOT know it yet — e.g. `d12-demo-runs.mjs`'s
 * hand-authored manifest, whose `cycle_id` is minted fresh, inside the
 * product, only once serve actually claims it).
 *
 * @param {string} forgeRoot
 * @param {{ initiativeId: string, cycleId?: string | null | (() => string | null), deadlineMs: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} opts
 * @returns {Promise<{ outcome: 'ok' | 'failed' | 'timeout', state: string, errors: string[] }>}
 */
export async function waitForManifestOutcome(forgeRoot, opts) {
  const { initiativeId, cycleId = null, deadlineMs, pollMs = DEFAULT_POLL_MS, sleep = defaultSleep } = opts;
  const resolveCycleId = typeof cycleId === 'function' ? cycleId : () => cycleId;
  for (;;) {
    const state = manifestQueueState(forgeRoot, initiativeId);
    const lines = readCycleEventLines(forgeRoot, resolveCycleId());
    const classified = classifyCycleEventLog(lines);
    if (classified.errors.length > 0) {
      return { outcome: 'failed', state, errors: classified.errors };
    }
    if (state === 'failed') {
      return {
        outcome: 'failed',
        state,
        errors: ['manifest moved to _queue/failed/ with no decisive event-log marker — see its events.jsonl directly'],
      };
    }
    if (state !== 'pending' && state !== 'inFlight' && state !== 'absent') {
      return { outcome: 'ok', state, errors: [] };
    }
    if (Date.now() >= deadlineMs) {
      return { outcome: 'timeout', state, errors: [] };
    }
    await sleep(pollMs);
  }
}
