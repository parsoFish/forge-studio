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
