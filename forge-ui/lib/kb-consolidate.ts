/**
 * R1-06 WI-3 review MINOR 2 (route-works != feature-works): the Knowledge tab's
 * Consolidate button used to fire op=consolidate and immediately show a static
 * "session started" for 6s. Consolidate is genuinely async (it dispatches a run
 * and streams a terminal event), so the operator never saw completion, a
 * cleared/total count, or refreshed health — and the WI-4 kb-maintain journey
 * had no terminal to observe.
 *
 * This helper carries the async lifecycle the button now drives: dispatch →
 * read the returned runId → poll its terminal state (bounded) → return an
 * honest outcome the page renders and uses to refetch KB health. The bridge
 * calls are injected (defaulting to the real studio-client helpers) so the
 * poll-to-terminal logic is unit-pinnable without SSR-driving the client page —
 * the same "extract the async logic to a lib/ helper" pattern WI-2 used for
 * `resolveDevelopStartCeilingToSend` (page named exports would fail `next
 * build`).
 */

import { runKbMaintenance, getAgentFixStatus } from './studio-client';

/** The terminal (or budget-exhausted) result of a consolidate run. */
export type ConsolidateOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      runId: string;
      /** 'running' only when the bounded poll budget was exhausted first. */
      state: 'cleared' | 'not-cleared' | 'failed' | 'running';
      cleared: boolean;
    };

export type RunConsolidateOptions = {
  /** Bounded number of poll attempts before giving up (honest 'running'). */
  maxAttempts?: number;
  /** Delay between polls, ms. */
  intervalMs?: number;
  /** Injected for testability — defaults to the real studio-client helpers. */
  dispatch?: typeof runKbMaintenance;
  poll?: typeof getAgentFixStatus;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_ATTEMPTS = 40;
const DEFAULT_INTERVAL_MS = 250;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch a KB consolidate run and poll its runId to a terminal state.
 *
 * Returns `{ ok: false, error }` if the dispatch failed or returned no runId
 * (never polls in that case). Otherwise returns `{ ok: true, runId, state,
 * cleared }` where `state` is the terminal state — or 'running' if the bounded
 * budget was exhausted first (surfaced honestly, never faked as done).
 */
export async function runConsolidateToTerminal(
  kbId: string,
  opts: RunConsolidateOptions = {},
): Promise<ConsolidateOutcome> {
  const dispatch = opts.dispatch ?? runKbMaintenance;
  const poll = opts.poll ?? getAgentFixStatus;
  const sleep = opts.sleep ?? realSleep;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  const dispatched = await dispatch(kbId, 'consolidate');
  if (!dispatched.ok) {
    return { ok: false, error: dispatched.error ?? 'consolidate dispatch failed' };
  }
  const runId = typeof dispatched.data?.runId === 'string' ? dispatched.data.runId : '';
  if (!runId) {
    return { ok: false, error: 'consolidate dispatch returned no runId' };
  }

  for (let i = 0; i < maxAttempts; i++) {
    const status = await poll(kbId, runId);
    if (status.state !== 'running') {
      return { ok: true, runId, state: status.state, cleared: status.cleared };
    }
    await sleep(intervalMs);
  }
  return { ok: true, runId, state: 'running', cleared: false };
}

/** Short, honest label for a consolidate outcome (for the maintenance result
 *  pill). Pure — no DOM — so it's covered by the same unit suite. */
export function consolidateResultLabel(outcome: ConsolidateOutcome): string {
  if (!outcome.ok) return outcome.error;
  switch (outcome.state) {
    case 'cleared':
      return 'consolidate: cleared ✓';
    case 'not-cleared':
      return 'consolidate: some findings remain';
    case 'failed':
      return 'consolidate: failed';
    default:
      return 'consolidate: still running…';
  }
}
