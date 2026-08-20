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
 * already render `status` from. It keeps both call sites' cadence constants
 * (poll immediately, then every 2s, give up after 90 non-terminal polls ≈
 * 3 min) but is NOT a byte-identical port of the mechanics — two deliberate
 * differences:
 *   - the originals drove `setInterval` (which can pile up overlapping
 *     fetches if a single poll takes longer than `intervalMs`); this uses a
 *     sequential `setTimeout` chain instead, scheduling each next poll only
 *     after the current one resolves.
 *   - that sequencing means giving up costs one fewer real fetch than
 *     before: the originals fired a 91st fetch (the immediate poll plus 90
 *     interval fetches) whose still-'running' result was the stale value
 *     left on screen forever; here the 90th fetch's result is what's
 *     relabelled `'timed-out'` — no wasted 91st fetch chasing a decision
 *     already made.
 */
import {
  getAgentRunStatus, getAgentFixStatus, fetchKbDrainRun, preflightFixStatus,
  type AgentRunStatus, type AgentFixStatus, type KbDrainStatus,
} from './studio-client';

/**
 * ⚑ W7-B5 (projects-29): `pollAgentRun` no longer OVERWRITES the run's state
 * with a fabricated `'timed-out'` token when the poll budget runs out — the
 * walkthrough caught the onboarding panel declaring a live run "timed-out"
 * 50s before it finished successfully, because the POLL's exhaustion was
 * being rendered as the RUN's state. Poll exhaustion is now its own flag
 * (`pollExhausted`), the last REAL observed state is preserved, and
 * `pollDisplayState` derives the visible 'timed-out' chip from the flag —
 * so `data-run-status` stays honest ('running') while `data-poll-state`
 * says the WATCHER gave up.
 */
export type PolledAgentRunStatus = AgentRunStatus & { pollExhausted?: boolean };

/** Both original call sites polled every 2s. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Both original call sites capped at 90 interval polls (~3 min @ 2s). */
export const DEFAULT_POLL_MAX_ATTEMPTS = 90;

// ---------------------------------------------------------------------------
// pollUntilTerminal — the generic bounded-poll core, extracted (W6-B13) so a
// SECOND fragile hand-rolled poll loop never gets a chance to exist. Every
// consumer below (`pollAgentRun`, and the two W6-B13 additions
// `pollKbDrain`/`pollAgentFix`) is a thin, status-shape-specific wrapper
// around this one mechanism: fetch immediately, then every `intervalMs`
// while `isRunning(status)` holds, until either a real terminal status
// arrives or `maxAttempts` is exhausted — in which case `onTimeout` fires
// EXACTLY ONCE with the last real status this loop actually observed (never
// a silent stop, never a fabricated status for one it never saw). A
// throwing `fetchStatus` counts as one failed attempt and keeps polling,
// same as a still-running status — never an unhandled rejection.
// ---------------------------------------------------------------------------

export type PollUntilTerminalOptions<S> = {
  fetchStatus: () => Promise<S>;
  /** True while `status` should keep being polled. */
  isRunning: (status: S) => boolean;
  intervalMs?: number;
  maxAttempts?: number;
  /** Called with every polled status, including the immediate first poll. */
  onUpdate: (status: S) => void;
  /** Called EXACTLY ONCE, instead of `onUpdate`, once `maxAttempts` is
   *  reached while still running — `lastStatus` is the last real status this
   *  loop observed (`null` if every attempt threw). The caller derives its
   *  own `'timed-out'`-shaped status from it. */
  onTimeout: (lastStatus: S | null) => void;
};

/**
 * W7-FIX-A1 (A1-10): the ONE "keep watching" rule for the status-shaped
 * polls — still `'running'`, OR the read itself FAILED TRANSIENTLY (`ok:false`
 * + `state:'unknown'`, the fail-closed shape from studio-client, with NO
 * status = transport failure, or a 5xx = the bridge is up but faltered).
 * Such a read is not a terminal fact about the run: the wrapper keeps polling
 * (bounded by `maxAttempts`) and reports it via `onUpdate` so the panel can
 * show the bridge's text — never a fabricated `'running'`, never a run
 * rendered as stopped because ONE read blipped. Two things ARE terminal: a
 * bridge-ANSWERED `state:'unknown'` (`ok:true`, "no state recorded"), and a
 * failed read the bridge answered with a 4xx (`status < 500` — R6-04 D22: a
 * 404 "no run found" is a definitive "never dispatched", not a blip; polling
 * it for three minutes would render a not-found as a live run).
 */
export function isStillWatching(s: { state: string; ok?: boolean; status?: number }): boolean {
  if (s.state === 'running') return true;
  if (s.ok !== false || s.state !== 'unknown') return false;
  return s.status === undefined || s.status >= 500;
}

export function pollUntilTerminal<S>(opts: PollUntilTerminalOptions<S>): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;

  let cancelled = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStatus: S | null = null;

  const tick = async (): Promise<void> => {
    let s: S;
    try {
      s = await opts.fetchStatus();
    } catch {
      if (cancelled) return;
      attempts += 1;
      if (attempts >= maxAttempts) {
        opts.onTimeout(lastStatus);
        return;
      }
      timer = setTimeout(() => { void tick(); }, intervalMs);
      return;
    }
    if (cancelled) return;
    lastStatus = s;
    opts.onUpdate(s);
    if (!opts.isRunning(s)) return; // terminal (or honestly unknown) — stop

    attempts += 1;
    if (attempts >= maxAttempts) {
      opts.onTimeout(s);
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
  return pollUntilTerminal<AgentRunStatus>({
    fetchStatus: () => fetchStatus(runId),
    isRunning: isStillWatching,
    intervalMs: opts.intervalMs,
    maxAttempts: opts.maxAttempts,
    onUpdate: (s) => opts.onUpdate(s),
    // W7-B5 (projects-29): keep the last REAL state (a run last seen
    // 'running' is still honestly 'running' — only the WATCHER stopped);
    // `pollExhausted` is what the UI's 'timed-out' chip derives from.
    onTimeout: (last) => opts.onUpdate({ ...(last ?? { ok: false, costUsd: 0, events: 0, state: 'unknown' }), pollExhausted: true }),
  });
}

// ---------------------------------------------------------------------------
// pollKbDrain (W6-B13) — the drain-to-green panel's live poll. Same bounded/
// explicit-timeout mechanics as `pollAgentRun`, over the drain status shape
// (`cli/bridge-studio-kb-drain.ts`'s `KbDrainStatus`, mirrored client-side in
// `./studio-client.ts`). A drain run keeps running server-side regardless of
// whether anything is watching it (it is driven by `enqueueConsolidate`, not
// this poll) — `'timed-out'` here means only "this browser stopped
// watching," never "the run stopped."
// ---------------------------------------------------------------------------

export type PolledKbDrainState = KbDrainStatus['state'] | 'timed-out';
export type PolledKbDrainStatus = Omit<KbDrainStatus, 'state'> & { state: PolledKbDrainState };

export type PollKbDrainOptions = {
  fetchStatus?: (kbId: string, runId: string) => Promise<KbDrainStatus>;
  intervalMs?: number;
  maxAttempts?: number;
  onUpdate: (status: PolledKbDrainStatus) => void;
};

function timedOutKbDrainStatus(kbId: string, runId: string): KbDrainStatus {
  return {
    ok: false, runId, kbId, state: 'running', round: 0,
    counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

export function pollKbDrain(kbId: string, runId: string, opts: PollKbDrainOptions): () => void {
  const fetchStatus = opts.fetchStatus ?? fetchKbDrainRun;
  return pollUntilTerminal<KbDrainStatus>({
    fetchStatus: () => fetchStatus(kbId, runId),
    isRunning: (s) => s.state === 'running',
    intervalMs: opts.intervalMs,
    maxAttempts: opts.maxAttempts,
    onUpdate: (s) => opts.onUpdate(s),
    onTimeout: (last) => opts.onUpdate({ ...(last ?? timedOutKbDrainStatus(kbId, runId)), state: 'timed-out' }),
  });
}

// ---------------------------------------------------------------------------
// pollAgentFix (W6-B13) — the ONE surviving per-finding poll from the old
// LintResolutionPanel (its `pollFix`, deleted with the rest of that
// component): dispatching a single agent turn for a USER-tier finding the
// drain-to-green loop itself never resolves. The old `pollFix` silently
// returned a still-'running' status forever once its 45×2s budget was
// exhausted (W6 sweep finding C9#2 — the operator saw the "Apply answer"
// button just re-enable with no feedback); this fixes that the same way
// `pollAgentRun` already does, with an explicit `'timed-out'` state.
// ---------------------------------------------------------------------------

export type PolledAgentFixState = AgentFixStatus['state'] | 'timed-out';
export type PolledAgentFixStatus = Omit<AgentFixStatus, 'state'> & { state: PolledAgentFixState };

export type PollAgentFixOptions = {
  fetchStatus?: (kbId: string, runId: string) => Promise<AgentFixStatus>;
  intervalMs?: number;
  maxAttempts?: number;
  onUpdate: (status: PolledAgentFixStatus) => void;
};

export function pollAgentFix(kbId: string, runId: string, opts: PollAgentFixOptions): () => void {
  const fetchStatus = opts.fetchStatus ?? getAgentFixStatus;
  return pollUntilTerminal<AgentFixStatus>({
    fetchStatus: () => fetchStatus(kbId, runId),
    isRunning: isStillWatching,
    intervalMs: opts.intervalMs,
    maxAttempts: opts.maxAttempts,
    onUpdate: (s) => opts.onUpdate(s),
    onTimeout: (last) => opts.onUpdate({ ...(last ?? { ok: false, cleared: false }), state: 'timed-out' }),
  });
}

// ---------------------------------------------------------------------------
// pollPreflightFix (W6-B14) — ContractResolutionPanel.tsx's `submitUser` used
// to `await` a hand-rolled 45×2s loop (its own module-local `poll()`) DIRECTLY
// inside the click handler: the awaited promise, and therefore the run's
// result, was simply discarded if the operator navigated away before it
// settled — the THIRD independent instance of the exact bug class
// `pollAgentRun`/`pollKbDrain`/`pollAgentFix` above already fixed (W6-B13).
// `preflightFixStatus` (./studio-client.ts) returns `AgentFixStatus` itself
// (`{ok, state: 'running'|'cleared'|'not-cleared'|'failed'|'unknown', cleared,
// error?}`) — this wrapper is `pollAgentFix`'s twin, over the preflight-fix
// run shape instead of the brain-fix one.
// ---------------------------------------------------------------------------

export type PolledPreflightFixState = PolledAgentFixState;
export type PolledPreflightFixStatus = PolledAgentFixStatus;

export type PollPreflightFixOptions = {
  fetchStatus?: (projectId: string, runId: string) => Promise<AgentFixStatus>;
  intervalMs?: number;
  maxAttempts?: number;
  onUpdate: (status: PolledPreflightFixStatus) => void;
};

export function pollPreflightFix(projectId: string, runId: string, opts: PollPreflightFixOptions): () => void {
  const fetchStatus = opts.fetchStatus ?? preflightFixStatus;
  return pollUntilTerminal<AgentFixStatus>({
    fetchStatus: () => fetchStatus(projectId, runId),
    isRunning: isStillWatching,
    intervalMs: opts.intervalMs,
    maxAttempts: opts.maxAttempts,
    onUpdate: (s) => opts.onUpdate(s),
    onTimeout: (last) => opts.onUpdate({ ...(last ?? { ok: false, cleared: false }), state: 'timed-out' }),
  });
}

// ---------------------------------------------------------------------------
// pollDisplayState (W6-B14) — the ONE shared mapping from any of the above
// polled statuses to the three visible states the operator-intent rule
// requires every multi-step dispatch+poll surface to render: 'watching'
// (still running), 'timed-out' (the poll ceiling gave up but the run is
// very likely still going server-side — never rendered as if it silently
// stopped), or 'terminal' (a real done/cleared/failed/etc outcome). Returns
// `null` when no run has ever been dispatched/attached — callers render
// their own idle state and omit the `data-poll-state` attribute entirely
// rather than emit a stale/fabricated value for "nothing happened yet".
// ---------------------------------------------------------------------------

export type PollDisplayState = 'watching' | 'timed-out' | 'terminal';

export function pollDisplayState(state: { state: string; ok?: boolean; status?: number; pollExhausted?: boolean } | null | undefined): PollDisplayState | null {
  if (!state) return null;
  // W7-B5 (projects-29): poll exhaustion is a fact about the WATCHER, not
  // the run — it wins the display slot (the Re-check affordance keys off
  // it) while the run's own state stays whatever was last truly observed.
  if (state.pollExhausted) return 'timed-out';
  // W7-FIX-A1 A1-10: a FAILED read (`ok:false` + 'unknown') is still being
  // watched (the poll continues) — the panel renders the read failure text
  // beside it, never a stopped run.
  if (isStillWatching(state)) return 'watching';
  if (state.state === 'timed-out') return 'timed-out';
  return 'terminal';
}
