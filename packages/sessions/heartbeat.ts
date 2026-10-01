/**
 * The `.heartbeat` liveness primitives every interactive turn loop shares:
 * the throttle cadence, the message-driven tick, and the file writer itself.
 * Split out of `interactive-session.ts` (file-size budget, 1.0.md §0) so the
 * primitives have one home instead of being buried in that file's larger
 * turn-loop machinery. Every caller — `interactive-session.ts`'s own
 * `runStructuredTurn`/`runAgentTurn`, `interactive-runner.ts`,
 * `kinds/kind-turn.ts`, `kinds/fix-turn.ts` — imports directly from here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Heartbeat cadence — the runner touches its `.heartbeat` file at most this
 *  often during an SDK stream, so the UI staleness checker has a liveness pulse
 *  without flooding the filesystem. */
export const HEARTBEAT_THROTTLE_MS = 2000;

/** Throttled `.heartbeat` tick: fires at most once per HEARTBEAT_THROTTLE_MS,
 *  called only from a progress branch. Shared by every turn loop in
 *  `interactive-session.ts` and `kinds/fix-turn.ts`. */
export function makeHeartbeatTick(onHeartbeat: (() => void) | undefined): () => void {
  let lastHeartbeatMs = 0;
  return () => {
    if (!onHeartbeat) return;
    const now = Date.now();
    if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
      onHeartbeat();
      lastHeartbeatMs = now;
    }
  };
}

/**
 * Row 164 (bead forge-8vfn.8.1.51, S10 run 43) — an INTERVAL heartbeat
 * ticker, independent of the SDK stream's own message flow.
 *
 * `makeHeartbeatTick` above only fires from a progress branch inside a
 * turn's stream loop, so a turn whose SDK call is genuinely alive but streams
 * NOTHING for minutes (run 43: six minutes, one long StructuredOutput, zero
 * events) never touched `.heartbeat` once in that whole window. The Studio
 * session lifecycle (`bridge-studio-lifecycle.ts`) read that silence as
 * `stalled` past the architect ceiling (120 s) even though the turn was
 * healthy the entire time and succeeded at 6:04.
 *
 * This ticker is started right before the SDK call/stream begins and stopped
 * by its caller (in a `finally`) once the call ends — by a result, a throw,
 * or an abort — regardless of what the stream itself produces. While it
 * runs, `.heartbeat` stays warm on the SAME cadence every runner already
 * throttles writes to (`HEARTBEAT_THROTTLE_MS`), so a LIVE in-flight call
 * never reads `stalled`. The ONE authority on an actual hang stays
 * `withIdleDeadline` (`packages/agents/stream-deadline.ts`): once IT aborts,
 * the call is no longer in flight, the caller stops this ticker, and the
 * thrown `StreamDeadlineError` already routes to a classified `failed`
 * terminal phase (`cmdAgentRun`'s catch → `writeSessionTerminalPhase`,
 * `apps/forge/agent-run.ts`) — which `isTerminalPhase`
 * (`session-resolution.ts`) treats as terminal for every kind, universally,
 * before any per-kind table is even consulted. Never a silent death.
 *
 * ONE shared helper for every SDK-call path that feeds the Studio lifecycle's
 * `.heartbeat` channel: `runStructuredTurn` / `runAgentTurn`
 * (`interactive-session.ts`), and `kinds/fix-turn.ts`'s own stream loop.
 *
 * Implemented as a self-rescheduling `setTimeout` (not `setInterval`) so it
 * composes with the SAME `t.mock.timers.enable({apis: ['setTimeout']})`
 * convention every idle-deadline test in this package already uses —
 * `withIdleDeadline` itself is timed the same way.
 */
export function startHeartbeatTicker(onHeartbeat: (() => void) | undefined): () => void {
  if (!onHeartbeat) {
    return () => { /* nothing to tick */ };
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      onHeartbeat();
      scheduleNext();
    }, HEARTBEAT_THROTTLE_MS);
    if (typeof timer.unref === 'function') timer.unref();
  };
  scheduleNext();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * Build a throttled heartbeat writer for `<heartbeatDir>/.heartbeat`. Each call
 * writes the current ISO timestamp at most once per HEARTBEAT_THROTTLE_MS;
 * best-effort (never throws). The directory is created up front.
 */
export function makeHeartbeatWriter(heartbeatDir: string): () => void {
  mkdirSync(heartbeatDir, { recursive: true });
  const heartbeatPath = join(heartbeatDir, '.heartbeat');
  let lastMs = 0;
  return () => {
    const now = Date.now();
    if (now - lastMs < HEARTBEAT_THROTTLE_MS) return;
    lastMs = now;
    try {
      writeFileSync(heartbeatPath, new Date().toISOString());
    } catch {
      /* best-effort */
    }
  };
}
