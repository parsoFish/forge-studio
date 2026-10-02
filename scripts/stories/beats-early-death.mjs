/**
 * beats-early-death.mjs — EARLY DEATH gets exactly one grace poll.
 *
 * Row 184 (forge-8vfn.8.5.20, measured twice). Split out of
 * `beats-agent-proc.mjs` at the 800-line cap (T1 ruling 492: SPLIT, NEVER
 * BASELINE) — the seam is the one `makeAgentChannelDoor`'s own `door` already
 * draws between ITSELF (silence past `STALL_CEILING_MS`) and this (a dispatch
 * that has already been REAPED, however little time has passed).
 *
 * THE RULE THIS FILE IS FOR: the session's/run's PUBLISHED state is the
 * authority, in both directions. `door` (`beats-agent-proc.mjs`) only ever
 * looks past 180 s of quiet, because that is the product's own definition of
 * "stalled" and a shorter look would be a second, invented ceiling. But a
 * one-shot flow — a KB drain, say — can finish and have its process reaped in
 * under a second, long before `idle` ever passes that ceiling, so the
 * published terminal state for a dead process deserves the same early look a
 * session's own crash already gets (`stopReasonFor`, `beats-page.mjs`)
 * rather than sitting out the rest of the ceiling learning nothing new.
 *
 * PROCESS DEATH NEVER ENDS A WAIT ON ITS OWN. One dead reading proves nothing
 * (`makeAgentProcProbe`'s own rule, `beats-agent-proc.mjs`): a dispatch gets
 * exactly ONE free poll after the first sighting of REAPED before this ever
 * reports anything — never zero, and never a second free poll either, or a
 * wait could be held open forever by re-arming the same grace on every later
 * poll. The free poll is what lets the page's NEXT read show whatever the
 * dispatch already wrote before this reports a verdict about it.
 *
 * UNGATED BY `doorWorthRunning` on purpose, unlike `door`: that gate exists
 * because `door` fires at a fixed 180 s and would BE the verdict on a short
 * bound (664(i)). This costs at most one extra `CONSEQUENCE_POLL_MS`, never
 * enough to need the same guard.
 */
import { channelTerminalState, FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';
// The SAME pid/event-growth reading the spend diagnosis already trusts to
// tell a reaped dispatch from a healthy one that simply has not priced
// itself yet — reused rather than a second pid probe invented here.
import { readDispatchSnapshot } from './run-observe.mjs';
// The pure judgement over two `readDispatchSnapshot` reads.
import { classifyUnmeasuredDispatch } from './spend.mjs';
import { CONSEQUENCE_POLL_MS } from './beats-page-read.mjs';

/**
 * ROW 184c (forge-8vfn.8.5.22), T1 ruling 1973dv — how long after the beat's
 * LAST press this door stays shut: two page polls. Replayed on S1 run 5's
 * real capture (`early-death-real-capture.test.ts`), the finalize turn the
 * approve press started was spawned 79 ms after the press and wrote its
 * first event 529 ms after THAT; the door must give the press's own turn
 * room to appear before it may judge anything at all.
 */
export const PRESS_GRACE_MS = 2 * CONSEQUENCE_POLL_MS;

/**
 * ROW 184d (forge-8vfn.8.5.24), T1 ruling 1973dz — the PAGE's own poll of the
 * session it renders: `useArchitectSessionPoll`'s default `intervalMs`
 * (`apps/studio/lib/use-architect-session.ts`), which is what `/artifact`'s
 * plan gate re-reads `phase` on. Copied, not imported (this harness is plain
 * `.mjs` with no type stripping, `TERMINAL_STOPPED_PHASES`' own reason);
 * `early-death-run6-capture.test.ts` asserts the two never drift apart.
 */
export const STUDIO_SESSION_POLL_MS = 2_000;

/**
 * How long after a turn's OWN published terminal (its `end` event's
 * `metadata.phase`, `kind-turn.ts`) this door stays shut: two of the PAGE's
 * polls, measured from the terminal's own timestamp. S1 run 6 beat 11 reded
 * 317 ms after `phase=committed` with the page still on `awaiting-verdict` —
 * a page that re-reads every 2 s had simply not looked yet. Two runner polls
 * (`PRESS_GRACE_MS`, 200 ms) would not have been enough on that capture; two
 * page polls are the shortest grace in which a page that is going to catch up
 * provably has.
 */
export const PUBLISHED_TERMINAL_GRACE_MS = 2 * STUDIO_SESSION_POLL_MS;

/**
 * @param {string} forgeRoot
 * @param {(runId: string|null, sinceMs: number, boundRunId?: string|null) => string|null} resolveDir
 *   the SAME channel-dir resolution `makeAgentChannelDoor`'s own `door` uses
 *   (named / bound / born-after-the-anchor scan) — injected rather than
 *   imported, so this file never needs `runLogDir`/`runLogIdleMs`/
 *   `channelProvenSince`, all local to `beats-agent-proc.mjs`.
 * @returns {(runId: string|null, sinceMs: number, boundRunId?: string|null, pressMs?: number, nowMs?: number) => {reason: string, detail: string}|null}
 *   `pressMs` is the beat's LAST press (row 184c; defaults to `sinceMs`),
 *   `nowMs` the poll's own clock (defaults to `Date.now()`; a seam for the
 *   real-capture replay, `early-death-real-capture.test.ts`).
 */
export function makeEarlyDeathDoor(forgeRoot, resolveDir) {
  // One entry per channel dir this door has looked at: `snapshot` is the
  // previous read `classifyUnmeasuredDispatch` needs to tell a reaped turn
  // from one that simply has not priced itself yet, and `graced` is whether
  // this dir has ALREADY been given its one free poll.
  const death = new Map();
  return (runId, sinceMs, boundRunId = null, pressMs = sinceMs, nowMs = Date.now()) => {
    const dir = resolveDir(runId, sinceMs, boundRunId);
    if (dir === null) return null; // nothing to watch yet — the ordinary doors answer this
    // ROW 184c (forge-8vfn.8.5.22), T1 ruling 1973dv — THE ANCHOR FOR DEATH
    // IS THE BEAT'S LAST PRESS, not `sinceMs`. `sinceMs` is where EVIDENCE
    // begins (718(1)): for S1 beat 11 that is the beat's START, twelve
    // minutes before its approve press, so every turn the interview spawned
    // in between — the draft turn included — counted as "born after the
    // anchor" and #1060's birth rule excluded none of them. `pressMs` is the
    // instant this beat's own last act ran (`performSteps`' `lastActMs`).
    const sincePress = nowMs - pressMs;
    if (sincePress < PRESS_GRACE_MS) return null; // the press's own turn has not had two polls to appear
    const snapshot = readDispatchSnapshot(dir);
    // ROW 184b (forge-8vfn.8.5.21). THE DIR IS NOT THE TURN: pressing
    // approve-plan spawns a NEW finalize turn into the SAME `_architect-<sid>`
    // dir, and only `turn.pid`'s own mtime (`birthMs`, the one birth signal
    // that survives its pid dying) says which turn a reading is about. A
    // turn.pid born before the press (past `FS_CLOCK_SLACK_MS` of fs/JS clock
    // skew) names the PREVIOUS turn — dead or alive, it never ends THIS wait.
    if (snapshot.birthMs !== null && snapshot.birthMs < pressMs - FS_CLOCK_SLACK_MS) return null;
    // No turn.pid at all: nothing written after the press either, so the
    // two-poll grace must elapse AGAIN before the dir alone is judged.
    if (snapshot.birthMs === null && sincePress < 2 * PRESS_GRACE_MS) return null;
    // A CACHED previous read is this wait's own history only when it ALSO
    // names a turn born at or after the press — otherwise it is a stale grace
    // an EARLIER wait on this same dir earned about the turn THAT press ended
    // (`stallDoor` is built once per STORY, `run-story.mjs`).
    const cached = death.get(dir);
    const previous = cached !== undefined
      && cached.snapshot.birthMs !== null
      && cached.snapshot.birthMs < pressMs - FS_CLOCK_SLACK_MS
      ? undefined
      : cached;
    const { arm } = classifyUnmeasuredDispatch(snapshot, previous?.snapshot);
    // ROW 184c — DEATH MEANS THE PID IS GONE. `classifyUnmeasuredDispatch`
    // also calls an ALIVE pid over a static log `reaped` (a stuck shape, for
    // the spend diagnosis), and that is exactly what S1 run 5 beat 11 read:
    // pid 2777163, the finalize turn, alive and between spawn and its first
    // event — it wrote `phase=committed` 180 ms after this door called it
    // REAPED. A live process that is quiet is the idle-ceiling door's
    // question (`STALL_CEILING_MS`), never this one's.
    if (arm !== 'reaped' || snapshot.alive) {
      death.set(dir, { snapshot, graced: false });
      return null;
    }
    if (previous === undefined || !previous.graced) {
      death.set(dir, { snapshot, graced: true });
      return null; // the one free poll — the page's NEXT read may already show what the process already wrote
    }
    // Graced once already and STILL reaped on this second look: the
    // product's own terminal word, read now rather than after
    // `STALL_CEILING_MS` of silence nobody needed to sit through for a
    // dispatch that has been gone since before this door ever looked.
    const read = channelTerminalState(forgeRoot, dir);
    const chan = dir.slice(dir.lastIndexOf('/') + 1);
    // ROW 184d (forge-8vfn.8.5.24), T1 ruling 1973dz. A terminal carrying its
    // own timestamp (`atMs` — the turn's `end` event, or an `error` row) that
    // PREDATES this beat's press is the previous turn's word, not this one's:
    // S1 run 6's draft turn left `phase=awaiting-verdict` three seconds before
    // the approve press, and a finalize turn that died without writing must
    // still read as quiet. Fine event clocks on both sides, so no fs slack.
    const stale = read !== null && read.unknown !== true && typeof read.atMs === 'number' && read.atMs < pressMs;
    const terminal = stale ? null : read;
    if (terminal !== null && terminal.unknown !== true) {
      // THE PAGE GETS ITS FULL GRACE FROM THE TERMINAL'S OWN TIMESTAMP. S1
      // run 6 beat 11 reded 317 ms after `phase=committed` with the page still
      // rendering `awaiting-verdict`: the page re-reads the session every
      // `STUDIO_SESSION_POLL_MS` and had not looked yet. Returning null here
      // lets `waitForConsequence`'s own green check (`beats-page.mjs`, ahead
      // of this door on every poll) pass the beat the moment the page catches
      // up; only a page still behind after two of its own polls is told so.
      // A terminal with no timestamp (a `_queue/` move) keeps the old rule.
      if (typeof terminal.atMs === 'number' && nowMs - terminal.atMs < PUBLISHED_TERMINAL_GRACE_MS) return null;
      return {
        reason: 'channel-ended',
        detail:
          `the agent channel ${chan}'s own process was REAPED and the product published ${terminal.detail}. ` +
          'One grace poll already let the page catch up; this is the product\'s own word, not a stall.',
      };
    }
    return {
      reason: 'channel-quiet',
      detail:
        `the agent channel ${chan}'s own process has been REAPED and, one poll later, it still carries no ` +
        'terminal state — nothing published, and nothing left running to publish one.' +
        (stale ? ` (Its last published word, ${read.state}, predates this beat's press.)` : ''),
    };
  };
}
