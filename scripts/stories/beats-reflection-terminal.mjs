/**
 * beats-reflection-terminal.mjs — the REFLECTION door and its two `wait.terminal`
 * words: `reflected` and `reflected-answered`.
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (ruling 492: SPLIT,
 * NEVER BASELINE) when ruling 1736's answered-reflection gate needed room that
 * file's own headroom could not spare. `terminalWatchAround` — the grace-window
 * wrapper both doors share — stays there, exported, and is imported back here;
 * `cycleDirForInitiative`/`readRunEvents` are imported straight from their own
 * modules, not re-exported through the file this split left.
 *
 * `wait.terminal`'s value for a REFLECT beat is never a real `_queue/` state,
 * so `run-story.mjs`'s `cycleWatchFor` routes it to `makeReflectionWatch`
 * below by a DECLARED NAME rather than by guessing from which beat or act
 * string is asking (T1 1693, bead `forge-8vfn.8.1.31`).
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { cycleDirForInitiative } from './beats-channel-scan.mjs';
import { readRunEvents } from './run-observe.mjs';
import { terminalWatchAround } from './beats-agent-proc.mjs';

/** The FIRST reflection's terminal — success only, no operator answer required. */
export const REFLECTION_TERMINAL_STATE = 'reflected';

/**
 * Ruling 1736, round 3 (bead `forge-8vfn.8.1.34`). S10 proof run 36's beat 21
 * pressed `submit-reflection` and declared `terminal: 'reflected'` — and that
 * word resolved on the FIRST, PRE-ANSWER reflection: the interactive reflector
 * that published `user-questions.json` had already run to `reflector.end`
 * (02:59:43 → 03:04:36 in run 36) before the beat ever pressed anything, so
 * the very next poll after the operator's answer POSTed saw that same,
 * already-terminal event and resolved AT ONCE — racing the detached rerun
 * `fireReflectorRerun` (`bridge-reflect.ts`) had only just fired.
 *
 * `reflected-answered` is a SECOND word for the SAME door (below), not a new
 * mechanism: it adds one more gate — the terminal's own PRECEDING
 * `reflector.start` must be at or after `user-feedback.md`'s mtime, which the
 * POST route writes SYNCHRONOUSLY, before it fires the rerun. `reflected`
 * itself is unchanged; every existing caller keeps today's behaviour exactly.
 */
export const REFLECTION_ANSWERED_TERMINAL_STATE = 'reflected-answered';

const REFLECTOR_START_EVENT = 'reflector.start'; // packages/stations/phases/reflector.ts
const REFLECTOR_END_EVENT = 'reflector.end'; // packages/stations/phases/reflector.ts:355
const REFLECTOR_CRASHED_EVENT = 'reflector.crashed'; // packages/stations/phases/reflector-brain-writes.ts:155
const REFLECTION_LOST_EVENT = 'cycle.reflection-lost'; // packages/flows/cycle-context.ts:176

/** The file the POST route writes synchronously before it fires the detached
 *  rerun (`apps/forge/bridge-reflect.ts`) — the ONE fact `reflected-answered`
 *  gates on. */
const USER_FEEDBACK_FILE = 'user-feedback.md';

/**
 * `user-feedback.md`'s mtime, or the reason it cannot gate `reflected-answered`
 * yet — bead `forge-8vfn.8.1.34`. ABSENT is not UNKNOWN: an operator who has
 * not answered yet is the ordinary "still waiting" a door returns `null` for,
 * never a defect. Any OTHER stat failure (permission, a raced removal that is
 * not a plain ENOENT, …) is genuine doubt and fails open the same way every
 * other UNKNOWN read in this file's sibling doors does (§15.504).
 */
function feedbackMtimeOrReason(feedbackPath) {
  try {
    return { mtimeMs: statSync(feedbackPath).mtimeMs, absent: false, reason: null };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { mtimeMs: null, absent: true, reason: `the answer is not recorded yet — no ${feedbackPath}` };
    }
    const why = err?.code ?? err?.message;
    return { mtimeMs: null, absent: false, reason: `could not stat ${feedbackPath}: ${why}` };
  }
}

/**
 * THE REFLECTION DOOR — bead `forge-8vfn.8.1.31`, T1 ruling 1693 (S10 proof
 * run 35). MEASURED: closure moved the initiative into `_queue/merged/`, the
 * post-merge reflector's own `reflector.start` landed at 23:00:15 and was
 * still running, and `makeAgentChannelDoor`'s generic `channelTerminalState`
 * — which knows only `_queue/` states — read `merged` as the whole channel's
 * terminal word and stopped the REFLECT beat's wait at 23:03:15, 180s later,
 * on a reflection that had barely begun. `merged` is a PRECONDITION of
 * reflection (`finalize-merged.ts`: closure moves the manifest to `merged/`
 * BEFORE firing the reflector, and only promotes it on to `done/` once that
 * reflection has resolved, either way) — never reflection's own terminal — so
 * THIS DOOR NEVER READS THE QUEUE AT ALL.
 *
 * THE REFLECTOR RUNS INSIDE THE SAME CYCLE PROCESS and appends to the SAME
 * cycle `events.jsonl` `cycleDirForInitiative` already resolves BY IDENTITY
 * for every other `cycleOf` wait (`latestCycleId`, `finalize-merged.ts`, names
 * the identical dir the develop cycle wrote to) — never
 * `newestChannelSince`'s born-after-the-anchor scan, which finds nothing for a
 * cycle this press did not mint. So this door reads THAT dir's events for the
 * reflector's own three terminal messages: end, crashed, or the product's own
 * "never got to run or finish" word (constants above, each cited to the line
 * that emits it). THE LAST ONE IN LOG ORDER WINS: a boot-reconcile rerun can
 * recover from an earlier crash with a later `reflector.end`
 * (`run-model.test.ts`'s "reflection lost then RECOVERED"), and latching the
 * first-seen crash over that recovery would be wrong in the opposite
 * direction.
 *
 * `reflected-answered` (bead `forge-8vfn.8.1.34`) asks the SAME question over
 * the SAME scan, plus one gate: the winning terminal's PRECEDING
 * `reflector.start` — the most recent one seen before it, in the SAME
 * chronological pass — must be at or after `user-feedback.md`'s mtime. A
 * terminal that does not qualify DOES NOT COUNT: it is reported exactly like
 * "no terminal yet" (`null`, `lastSeen` says so), never as a ruled-out state.
 * That distinction is load-bearing — `terminalWatchAround` REDS a beat the
 * instant a door returns a NON-null, NON-matching state ("the cycle ended in
 * X, not Y"), and the first (pre-answer) reflection's `reflector.end` is not a
 * final ruling-out of `reflected-answered`; it is simply not that terminal.
 *
 * UNKNOWN NEVER RESOLVES TOWARD PROCEEDING (§15.504): no cycle dir yet, one
 * that could not be read, one carrying none of the three messages, or (for
 * `reflected-answered`) a feedback-file stat failure that is not a plain
 * ENOENT, is `null` — the identical shape `makeCycleTerminalDoor` returns for
 * "nothing resolved this poll", never a manufactured terminal. Only the beat's
 * own declared `upTo` can end a wait like that, and it does so BY NAME:
 * `waitForConsequence`'s "the declared terminal … was never reached — last
 * seen: …", fed straight from `door.lastSeen` below.
 *
 * @returns {null | ((runId: string|null, sinceMs: number, wantState: string) =>
 *   {done: boolean, state: string, detail: string}|null)}
 */
export function makeReflectionDoor(forgeRoot, cycleOf) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  if (typeof cycleOf !== 'string' || cycleOf === '') return null;
  const logsDir = join(forgeRoot, '_logs');
  const door = (_runId, sinceMs, wantState) => {
    // D's review (row 125's hazard class): DEC-2 keeps one cycle dir across rounds, so only a
    // terminal logged at or after THIS beat's anchor is this reflection's. No anchor → keep waiting.
    if (!Number.isFinite(sinceMs)) {
      door.lastSeen = `no anchor for this reflect wait (${String(sinceMs)}) — `
        + "cannot tell this reflection's terminal";
      return null;
    }
    const resolved = cycleDirForInitiative(logsDir, cycleOf);
    if (resolved !== null && typeof resolved !== 'string') {
      door.lastSeen = `could not resolve the cycle dir for ${cycleOf}: ${resolved.detail}`;
      return null;
    }
    if (resolved === null) {
      door.lastSeen = `no cycle directory found yet for ${cycleOf} — the reflector has not appeared`;
      return null;
    }
    door.sawCycle = true;
    const wantsAnswered = wantState === REFLECTION_ANSWERED_TERMINAL_STATE;
    const feedback = wantsAnswered ? feedbackMtimeOrReason(join(resolved, USER_FEEDBACK_FILE)) : null;
    if (feedback !== null && feedback.mtimeMs === null) {
      door.lastSeen = feedback.reason;
      return null;
    }
    const rows = readRunEvents(resolved);
    if (rows.unknown !== undefined) {
      door.lastSeen =
        `could not read ${join(resolved, 'events.jsonl')}: ${rows.unknown.map((u) => u.error).join('; ')}`;
      return null;
    }
    let found = null;
    let foundStartAt = null;
    let lastStartAt = null;
    for (const ev of rows) {
      const at = Date.parse(ev?.started_at ?? '');
      if (!Number.isFinite(at) || at < sinceMs) continue;
      if (ev?.message === REFLECTOR_START_EVENT) {
        lastStartAt = at;
        continue;
      }
      if (ev?.message === REFLECTOR_END_EVENT) {
        found = {
          state: wantsAnswered ? REFLECTION_ANSWERED_TERMINAL_STATE : REFLECTION_TERMINAL_STATE,
          detail: `the reflector's own ${REFLECTOR_END_EVENT} event fired for ${cycleOf}`,
        };
      } else if (ev?.message === REFLECTOR_CRASHED_EVENT) {
        found = {
          state: 'crashed',
          detail:
            `the reflector's own ${REFLECTOR_CRASHED_EVENT} event fired for ${cycleOf} — ` +
            'the reflection crashed rather than completing',
        };
      } else if (ev?.message === REFLECTION_LOST_EVENT) {
        found = {
          state: 'lost',
          detail:
            `the product's own ${REFLECTION_LOST_EVENT} event fired for ${cycleOf} — ` +
            'the reflection was lost, not completed',
        };
      } else {
        continue;
      }
      foundStartAt = lastStartAt;
    }
    if (found === null) {
      door.lastSeen =
        `no ${REFLECTOR_END_EVENT}/${REFLECTOR_CRASHED_EVENT}/${REFLECTION_LOST_EVENT} event since ` +
        `the anchor (${new Date(sinceMs).toISOString()}) in ${join(resolved, 'events.jsonl')} for ${cycleOf}`;
      return null;
    }
    if (feedback !== null && (foundStartAt === null || foundStartAt < feedback.mtimeMs)) {
      // This terminal's own reflection started BEFORE the answer was recorded
      // — the first (pre-answer) round, not the rerun. It does not count: this
      // is reported exactly like "no terminal yet", never a ruled-out state.
      door.lastSeen =
        `only a reflection that started before the answer (${new Date(feedback.mtimeMs).toISOString()}) ` +
        `has finished so far — waiting for the rerun's own terminal in ` +
        `${join(resolved, 'events.jsonl')} for ${cycleOf}`;
      return null;
    }
    door.lastSeen = found.detail;
    return Object.freeze({ done: found.state === wantState, state: found.state, detail: found.detail });
  };
  door.sawCycle = false;
  door.lastSeen = 'no cycle resolved yet';
  return door;
}

/**
 * `makeReflectionDoor` wrapped in the SAME grace window `makeCycleTerminalWatch`
 * uses (`terminalWatchAround`, `beats-agent-proc.mjs`), so a reflect beat gets
 * the identical `cycle-ended` / `cycle-done-ui-stale` split and inactivity-window
 * extension for free rather than a second copy of that machinery for one door.
 * `wantState` defaults to `REFLECTION_TERMINAL_STATE` — every caller before
 * ruling 1736's round 3 named none — and a beat that wants the answered word
 * passes it explicitly (bead `forge-8vfn.8.1.34`).
 */
export function makeReflectionWatch(forgeRoot, cycleOf, wantState = REFLECTION_TERMINAL_STATE) {
  const normalisedCycleOf = typeof cycleOf === 'string' && cycleOf !== '' ? cycleOf : null;
  const door = makeReflectionDoor(forgeRoot, normalisedCycleOf);
  return terminalWatchAround(forgeRoot, door, wantState, normalisedCycleOf);
}
