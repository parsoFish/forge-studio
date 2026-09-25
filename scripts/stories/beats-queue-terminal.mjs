/**
 * beats-queue-terminal.mjs — the queue's own terminal, read by IDENTITY and BY
 * MTIME.
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (T1 ruling 492:
 * SPLIT, NEVER BASELINE). `makeCycleTerminalDoor` there imports
 * `queueManifestTerminal`; nothing here calls back, so the dependency runs
 * one way.
 *
 * T1 1503 (row 98, S10 run 27). MEASURED. `makeCycleTerminalDoor`'s `cycleOf`
 * form only ever reads a terminal once `cycleStartedSince` finds a
 * `cycle.start` at or after the beat's anchor. S10 run 27's develop cycle
 * failed at 20:53:47Z, `_queue/failed/` held the manifest, and the wait NEVER
 * ENDED: the develop run's own `cycle.start` was stamped 20:44:07.280Z while
 * the beat's anchor read ~20:44:08.0Z, so `started` stayed false forever and
 * the door never got as far as reading the queue at all.
 *
 * THE GATE IS THE WRONG QUESTION FOR A TERMINAL THE PRODUCT ALREADY WROTE.
 * `cycleStartedSince` exists to stop a STALE terminal — the architect run's
 * leftover `ready-for-review`, S10 run 22's hazard (T1 1231) — from reading as
 * THIS press's verdict. But a manifest the product moves into a terminal
 * `_queue/` directory carries its OWN timestamp: the file's mtime, set the
 * moment the product wrote it there. That is exactly as trustworthy a stamp as
 * `cycle.start`'s `started_at` — both are the product's own word, not the
 * runner's guess — so the same rule applies without waiting on a SEPARATE
 * event to corroborate it first. This reads the queue directly, BY IDENTITY,
 * never re-deriving an initiative name from a dispatch dir's own filename the
 * way `channelTerminalState` must for the born-after-the-anchor form —
 * `cycleOf` already names it.
 *
 * `>= sinceMs` WINS; `< sinceMs` IS IGNORED, on purpose, and both matter:
 *
 *   >= sinceMs   the product moved this initiative into a terminal state at or
 *                after THIS press's own anchor — nothing else could have
 *                written it, so it is this press's verdict, whether or not
 *                `cycle.start` ever proved a run "started" for the same
 *                anchor.
 *   <  sinceMs   the S10 run 22 hazard, one layer down: a terminal the
 *                PREVIOUS run left sitting in the queue, older than this
 *                press. Reading it would be exactly the mistake T1 1231
 *                already ruled out, so it is left for the started-gate to
 *                handle as it already does.
 *
 * UNREADABLE IS NAMED, NEVER SILENT (§15.504). A queue this could not read
 * reports `unknown: true` with the path and the OS error; the caller treats
 * that exactly as "no queue terminal found here" and falls through to the
 * started-gate — an unreadable queue must never MANUFACTURE a false terminal,
 * so it only ever forfeits the early exit this adds, never fabricates one.
 *
 * @returns {null | {unknown: true, detail: string} | {state: string, detail: string, mtimeMs: number}}
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function queueManifestTerminal(forgeRoot, initiativeId) {
  const queue = join(forgeRoot, '_queue');
  let states;
  try {
    states = readdirSync(queue, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    return { unknown: true, detail: `could not read ${queue}: ${err?.code ?? err?.message}` };
  }
  // The SAME open/terminal split `channelTerminalState` uses: `pending` and
  // `in-flight` are states of a channel still doing something, and anything
  // else the product moved it INTO is the product's own terminal word.
  const OPEN_STATES = new Set(['pending', 'in-flight']);
  for (const state of states) {
    if (OPEN_STATES.has(state)) continue;
    const stateDir = join(queue, state);
    let names;
    try {
      names = readdirSync(stateDir);
    } catch (err) {
      return { unknown: true, detail: `could not read ${stateDir}: ${err?.code ?? err?.message}` };
    }
    const match = names.find((n) => n.includes(initiativeId));
    if (match === undefined) continue;
    const filePath = join(stateDir, match);
    let mtimeMs;
    try {
      ({ mtimeMs } = statSync(filePath));
    } catch (err) {
      return { unknown: true, detail: `could not stat ${filePath}: ${err?.code ?? err?.message}` };
    }
    return { state, mtimeMs, detail: `the product moved ${initiativeId} into _queue/${state}/` };
  }
  return null;
}
