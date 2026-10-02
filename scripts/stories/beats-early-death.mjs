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

/**
 * @param {string} forgeRoot
 * @param {(runId: string|null, sinceMs: number, boundRunId?: string|null) => string|null} resolveDir
 *   the SAME channel-dir resolution `makeAgentChannelDoor`'s own `door` uses
 *   (named / bound / born-after-the-anchor scan) — injected rather than
 *   imported, so this file never needs `runLogDir`/`runLogIdleMs`/
 *   `channelProvenSince`, all local to `beats-agent-proc.mjs`.
 * @returns {(runId: string|null, sinceMs: number, boundRunId?: string|null) => {reason: string, detail: string}|null}
 */
export function makeEarlyDeathDoor(forgeRoot, resolveDir) {
  // One entry per channel dir this door has looked at: `snapshot` is the
  // previous read `classifyUnmeasuredDispatch` needs to tell a reaped turn
  // from one that simply has not priced itself yet, and `graced` is whether
  // this dir has ALREADY been given its one free poll.
  const death = new Map();
  return (runId, sinceMs, boundRunId = null) => {
    const dir = resolveDir(runId, sinceMs, boundRunId);
    if (dir === null) return null; // nothing to watch yet — the ordinary doors answer this
    const snapshot = readDispatchSnapshot(dir);
    // ROW 184b (forge-8vfn.8.5.21), regression from PR #1058. THE DIR IS NOT
    // THE TURN. Pressing approve-plan makes the bridge spawn a NEW finalize
    // turn for the SAME session — `_architect-<sid>` is identical before and
    // after the press — so `resolveDir` above keeps returning the one dir it
    // always has, and only `turn.pid` INSIDE it says which turn this reading
    // is actually about. Before this fix nothing asked that question: S1
    // beat 11 read the draft turn's own pid, already dead and already
    // GRACED by an EARLIER beat's wait on the identical dir (`stallDoor` is
    // built once per STORY and shared across every beat, `run-story.mjs`),
    // and fired `channel-quiet` 0 s into its OWN bound — zero grace, for a
    // finalize turn that had not even started yet.
    //
    // `turn.pid`'s own mtime (`readDispatchSnapshot`'s `birthMs`) is the one
    // birth signal that survives the pid it names dying — no `/proc` entry
    // outlives the process. Born strictly before THIS wait's own anchor
    // (`sinceMs`, the beat's action press), past the same fs/JS clock skew
    // `FS_CLOCK_SLACK_MS` already covers elsewhere (`sweep-post-stop-logs.mjs`),
    // names the PREVIOUS turn — dead or alive, it can never end THIS wait.
    // Treated exactly like "nothing to watch yet": the ordinary rules keep
    // governing until a turn.pid born at or after the anchor appears. A
    // missing `turn.pid` (`birthMs === null`) has no birth to compare, so it
    // falls through unchanged — there is no fresher reading to prefer.
    if (snapshot.birthMs !== null && snapshot.birthMs < sinceMs - FS_CLOCK_SLACK_MS) return null;
    // A CACHED previous read is this wait's own history only when it ALSO
    // names a turn born at or after the anchor. Otherwise it is a stale
    // grace an EARLIER wait on this same dir already earned about the turn
    // THAT press ended — reusing it here is the exact mechanism measured
    // above, one layer along: never on the CURRENT reading, but just as
    // wrongly on a cache built from a PREVIOUS one.
    const cached = death.get(dir);
    const previous = cached !== undefined
      && cached.snapshot.birthMs !== null
      && cached.snapshot.birthMs < sinceMs - FS_CLOCK_SLACK_MS
      ? undefined
      : cached;
    const { arm } = classifyUnmeasuredDispatch(snapshot, previous?.snapshot);
    if (arm !== 'reaped') {
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
    const terminal = channelTerminalState(forgeRoot, dir);
    const chan = dir.slice(dir.lastIndexOf('/') + 1);
    if (terminal !== null && terminal.unknown !== true) {
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
        'terminal state — nothing published, and nothing left running to publish one.',
    };
  };
}
