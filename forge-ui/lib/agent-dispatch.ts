/**
 * Shared agent-run poll loop — extracted from the two hand-rolled,
 * byte-identical `useEffect`+`setInterval` polls in
 * `components/studio/agent-builder/RunPanel.tsx` and
 * `app/projects/[id]/page.tsx`'s `OnboardWithAgent` (its own comment used to
 * admit the duplication: "Bounded like RunPanel."). Both loops shared one
 * silent defect: once the bounded attempt ceiling was hit while a run was
 * STILL `'running'`, the loop just stopped polling and left that stale
 * `'running'` status on screen forever — an operator watching the panel saw
 * a run that looked eternally in-flight, with no signal the poll itself had
 * given up.
 *
 * `pollAgentRun` fixes that by making the ceiling an explicit `'timed-out'`
 * state, delivered through the same `onUpdate` callback the two call sites
 * already render `status` from — no other visible behaviour changes: the
 * fetch cadence, the attempt ceiling (90 attempts @ 2s ≈ 3 min, both
 * call sites' own prior constants), and the immediate first poll are all
 * preserved exactly.
 */
import { getAgentRunStatus, type AgentRunStatus } from './studio-client';

/** `AgentRunStatus['state']` plus the one state this module adds: the poll
 *  gave up after `maxAttempts` while the run was still genuinely running. */
export type PolledRunState = AgentRunStatus['state'] | 'timed-out';

/** Same shape as `AgentRunStatus`, with `state` widened to admit
 *  `'timed-out'`. */
export type PolledAgentRunStatus = Omit<AgentRunStatus, 'state'> & { state: PolledRunState };

/** Both original call sites polled every 2s. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Both original call sites capped at 90 interval polls (~3 min @ 2s). */
export const DEFAULT_POLL_MAX_ATTEMPTS = 90;

export type PollAgentRunOptions = {
  /** Injectable for tests; defaults to the real `getAgentRunStatus`
   *  (`./studio-client.ts`), which reads `_logs/<runId>/` via the bridge. */
  fetchStatus?: (runId: string) => Promise<AgentRunStatus>;
  intervalMs?: number;
  maxAttempts?: number;
  /** Called with every polled status, including the immediate first poll
   *  and the final `'timed-out'` status if the ceiling is reached. */
  onUpdate: (status: PolledAgentRunStatus) => void;
};

/**
 * Start polling `runId`'s status. Polls immediately, then every
 * `intervalMs` while the state stays `'running'`, until either:
 *   - the state leaves `'running'` (a real terminal/unknown state), or
 *   - `maxAttempts` interval polls have all still come back `'running'`,
 *     in which case ONE final `onUpdate` fires with the last known
 *     cost/events but `state: 'timed-out'` — never a silent stop.
 *
 * Returns a cleanup function (mirrors the `useEffect` cleanup contract) —
 * call it from the caller's own effect cleanup to cancel any in-flight
 * polling (e.g. on unmount, or when `runId` changes).
 */
export function pollAgentRun(runId: string, opts: PollAgentRunOptions): () => void {
  const fetchStatus = opts.fetchStatus ?? getAgentRunStatus;
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  const onUpdate = opts.onUpdate;

  let cancelled = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    const s = await fetchStatus(runId);
    if (cancelled) return;
    onUpdate(s);
    if (s.state !== 'running') return; // terminal (or honestly unknown) — stop

    attempts += 1;
    if (attempts >= maxAttempts) {
      onUpdate({ ...s, state: 'timed-out' });
      return;
    }
    timer = setTimeout(() => { void tick(); }, intervalMs);
  };

  void tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
