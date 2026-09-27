/**
 * beats-reflection-terminal.mjs — the REFLECTION door (`makeReflectionDoor`)
 * and its watch (`makeReflectionWatch`), moved unchanged out of
 * `beats-agent-proc.mjs`, which had 17 lines left under the 800-line cap
 * (ruling 492: split, never baseline). `terminalWatchAround`, the grace-window
 * wrapper both files' doors share, stays there and is exported for this file.
 */
import { join } from 'node:path';
import { cycleDirForInitiative } from './beats-channel-scan.mjs';
import { readRunEvents } from './run-observe.mjs';
import { terminalWatchAround } from './beats-agent-proc.mjs';

/**
 * `wait.terminal`'s value for a REFLECT beat — never a real `_queue/` state,
 * so `run-story.mjs`'s `cycleWatchFor` can route a reflection wait to
 * `makeReflectionWatch` (below) by a DECLARED NAME rather than by guessing
 * from which beat or act string is asking (T1 1693, bead `forge-8vfn.8.1.31`).
 */
export const REFLECTION_TERMINAL_STATE = 'reflected';

const REFLECTOR_END_EVENT = 'reflector.end'; // packages/stations/phases/reflector.ts:355
const REFLECTOR_CRASHED_EVENT = 'reflector.crashed'; // packages/stations/phases/reflector-brain-writes.ts:155
const REFLECTION_LOST_EVENT = 'cycle.reflection-lost'; // packages/flows/cycle-context.ts:176

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
 * UNKNOWN NEVER RESOLVES TOWARD PROCEEDING (§15.504): no cycle dir yet, one
 * that could not be read, or one carrying none of the three messages is
 * `null` — the identical shape `makeCycleTerminalDoor` returns for "nothing
 * resolved this poll", never a manufactured terminal. Only the beat's own
 * declared `upTo` can end a wait like that, and it does so BY NAME:
 * `waitForConsequence`'s "the declared terminal … was never reached — last
 * seen: …", fed straight from `door.lastSeen` below.
 *
 * @returns {null | ((runId: string|null, sinceMs: number, wantState: string) => {done: boolean, state: string, detail: string}|null)}
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
    const rows = readRunEvents(resolved);
    if (rows.unknown !== undefined) {
      door.lastSeen = `could not read ${join(resolved, 'events.jsonl')}: ${rows.unknown.map((u) => u.error).join('; ')}`;
      return null;
    }
    let found = null;
    for (const ev of rows) {
      const at = Date.parse(ev?.started_at ?? '');
      if (!Number.isFinite(at) || at < sinceMs) continue;
      if (ev?.message === REFLECTOR_END_EVENT) {
        found = { state: REFLECTION_TERMINAL_STATE, detail: `the reflector's own ${REFLECTOR_END_EVENT} event fired for ${cycleOf}` };
      } else if (ev?.message === REFLECTOR_CRASHED_EVENT) {
        found = {
          state: 'crashed',
          detail: `the reflector's own ${REFLECTOR_CRASHED_EVENT} event fired for ${cycleOf} — the reflection crashed rather than completing`,
        };
      } else if (ev?.message === REFLECTION_LOST_EVENT) {
        found = {
          state: 'lost',
          detail: `the product's own ${REFLECTION_LOST_EVENT} event fired for ${cycleOf} — the reflection was lost, not completed`,
        };
      }
    }
    if (found === null) {
      door.lastSeen =
        `no ${REFLECTOR_END_EVENT}/${REFLECTOR_CRASHED_EVENT}/${REFLECTION_LOST_EVENT} event since the anchor ` +
        `(${new Date(sinceMs).toISOString()}) in ${join(resolved, 'events.jsonl')} for ${cycleOf}`;
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
 * uses (`terminalWatchAround`, above), so a reflect beat gets the identical
 * `cycle-ended` / `cycle-done-ui-stale` split and inactivity-window extension
 * for free rather than a second copy of that machinery for one door.
 * `wantState` is fixed at `REFLECTION_TERMINAL_STATE` — reflection has exactly
 * one success state, never a story-chosen value the way a queue wait's is.
 */
export function makeReflectionWatch(forgeRoot, cycleOf) {
  const normalisedCycleOf = typeof cycleOf === 'string' && cycleOf !== '' ? cycleOf : null;
  return terminalWatchAround(forgeRoot, makeReflectionDoor(forgeRoot, normalisedCycleOf), REFLECTION_TERMINAL_STATE, normalisedCycleOf);
}
