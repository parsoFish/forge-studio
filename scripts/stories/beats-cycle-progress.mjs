/**
 * beats-cycle-progress.mjs — what "progress" means for a `cycleOf` agent wait.
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (`check-file-size`,
 * SPLIT NEVER BASELINE) — this is one self-contained question, "when did this
 * cycle last write anything", with no dependency on that file's doors and none
 * of its doors depend on this either. One-way: `beats-agent-proc.mjs` imports
 * this file's export; nothing here imports back.
 *
 * `forge-8vfn` T1 ruling 1471, S10 run 26. Beat 10's `wait: { for: 'agent',
 * cycleOf: … }` hit `MAX_DECLARED_WAIT_MS` at 18:18:10 while a review chunk had
 * been persisted at 18:14:35, four minutes earlier — adversarial review was
 * running serially over four chunks, the product was still progressing, and the
 * wall clock ended the wait anyway, killing the reviewer and the cycle after
 * $14.61. `makeCycleTerminalWatch` (`beats-agent-proc.mjs`) uses this reading to
 * make `upTo` an INACTIVITY window for a `cycleOf` wait rather than an absolute
 * one: it resets on new cycle activity instead of firing on a healthy, busy run.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Idle time of a CYCLE's OWN PROGRESS, in ms, or null when nothing has been
 * written yet.
 *
 * MTIME, NEVER "TIME SINCE THIS POLL LAST SAW IT MOVE". Under host load the
 * event loop runs late, so a window measured between two clock reads can widen
 * with no real inactivity at all — a poll due at t+100ms that actually runs at
 * t+4000ms must not read 3900ms of invented silence. What the PRODUCT wrote is
 * the only honest clock: this reads each file's own mtime, the same idiom
 * `runLogIdleMs` (`beats-agent-proc.mjs`) already uses for a session channel,
 * so a busy host delaying the poller can never manufacture inactivity.
 *
 * TWO SIGNALS, READ SEPARATELY, because they are two different writes. The
 * cycle's own event log — `events.jsonl`, never `.heartbeat` (liveness, not
 * progress) — is one. A review chunk
 * lands at a THIRD path: `writeChunkRecord`
 * (`packages/stations/phases/adversarial-review.ts`) persists
 * `<cycleDir>/artifacts/review-chunks/chunk-<key>.json` as its own write,
 * separate from whatever `events.jsonl` row accompanies it — a reader that
 * trusted only the channel files would report inactivity across whichever gap
 * separates the two, which is exactly the gap run 26 measured.
 *
 * NEVER 0 FOR "NOTHING WRITTEN". `null` says no evidence exists yet — an absent
 * cycle dir, or one with no channel and no chunk — and the caller must read
 * that as "no reading available", never as "just wrote, fully fresh": an
 * absent input to a bound must fail CLOSED, not default to the most permissive
 * value.
 */
export function cycleProgressIdleMs(dir, now = Date.now()) {
  let newest = null;
  const consider = (t) => {
    if (typeof t === 'number' && Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  };
  // NOT `.heartbeat`: a liveness ticker keeps touching it while the agent is
  // hung, and T1 1471 named only events.jsonl growth and persisted review
  // chunks as progress — a heartbeat alone would let a stuck cycle reset the
  // window until the wall ceiling.
  try { consider(statSync(join(dir, 'events.jsonl')).mtimeMs); } catch { /* absent is not silence — nothing to see there yet */ }
  try {
    const chunkDir = join(dir, 'artifacts', 'review-chunks');
    for (const name of readdirSync(chunkDir)) {
      try { consider(statSync(join(chunkDir, name)).mtimeMs); } catch { /* vanished between listing and stat */ }
    }
  } catch { /* no review-chunks dir yet on this cycle — not evidence of silence */ }
  return newest === null ? null : now - newest;
}

/**
 * THE EFFECTIVE DEADLINE for a `cycleOf` agent wait's CURRENT poll — pure, so
 * every bound it composes is testable without a real clock or a real 90-minute
 * wait. `waitForConsequence` (`beats-page.mjs`) calls this once per poll rather
 * than computing it inline, so the arithmetic that decides "has this wait
 * outlived its welcome" is verified on its own, at whatever `wallCeilingMs` a
 * test injects, never only end-to-end against the real
 * `CYCLE_WAIT_WALL_CEILING_MS`.
 *
 * TWO BOUNDS, NEITHER RESET BY THE OTHER:
 *   `inactivityDeadline`  `lastActivityAt + timeoutMs` — an ABSENT
 *                         `lastActivityAt` (no cycle write ever observed)
 *                         fails CLOSED to `startedAt + timeoutMs`, the
 *                         original, unreset deadline — never invented as
 *                         fresh progress.
 *   `wallDeadline`        `startedAt + wallCeilingMs` — counted from the
 *                         WAIT'S OWN START and never reset by progress, so a
 *                         cycle that resets the inactivity window forever is
 *                         still bounded.
 *
 * `firedBy` names which one actually governs at the RETURNED deadline, so a
 * caller can say why a wait ended without re-deriving the comparison (`wait-
 * bound.mjs`'s "THE CLAMP IS NEVER HIDDEN").
 *
 * @param {{startedAt: number, timeoutMs: number, lastActivityAt: number|null, wallCeilingMs: number}} args
 * @returns {{deadline: number, firedBy: 'inactivity'|'wall'}}
 */
export function cycleWaitDeadline({ startedAt, timeoutMs, lastActivityAt, wallCeilingMs }) {
  // Progress only ever EXTENDS the wait: a write that predates the wait's own
  // start (the cycle dir already existed) never pulls the deadline in below
  // the plain `startedAt + timeoutMs` it replaced.
  const inactivityDeadline = lastActivityAt === null ? startedAt + timeoutMs : Math.max(startedAt, lastActivityAt) + timeoutMs;
  const wallDeadline = startedAt + wallCeilingMs;
  const deadline = Math.min(inactivityDeadline, wallDeadline);
  return { deadline, firedBy: deadline === wallDeadline && wallDeadline <= inactivityDeadline ? 'wall' : 'inactivity' };
}
