/**
 * The reaper control's PLANT — its record, its heartbeat, and the sentence it
 * prints when it dies before the measurement. Bead `forge-8vfn.7.6.94`.
 *
 * WHY THESE ARE A MODULE AND NOT THREE LINES IN THE TEST. The branch they serve
 * fires only when something kills a `setInterval` child that cannot exit on its
 * own — which nobody can make happen on demand, so a branch left inline would be
 * a branch no door ever reached. §15.507: a case that does not run is a green for
 * nothing. Pure functions can be driven straight at their inputs, so the message
 * is proven even though the condition that produces it is not reproducible.
 *
 * THE PROPERTY THE MESSAGE MUST HAVE is not "it is informative" — it is that it
 * CANNOT BE READ AS THE CONTROL'S OWN PROPERTY FAILING. On D's run at `415f1be5`
 * the control reported the reaper had failed to report a kill, when the truth was
 * that the plant had vanished and the reaper said so honestly. A dead subject and
 * an absent property are two facts, and the whole bead is refusing to print them
 * the same. The door asserts the words of the other two failures are absent from
 * this one.
 */
import { readFileSync } from 'node:fs';

/** What the turn recorded at spawn, or `null` when it never got that far —
 *  which is itself worth printing rather than crashing on. */
export function readPlantRecord(path) {
  try {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    return typeof r?.plantedAtMs === 'number' ? r : null;
  } catch {
    return null;
  }
}

/** When the plant last PROVED it was alive, epoch ms, or `null`. The stamp is
 *  written every 100 ms, so its age dates a death nobody witnessed. */
export function readLastBeat(path) {
  try {
    const ms = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * The failure text for a plant that died before the reap.
 *
 * UNMEASURED, NEVER "THE REAPER FAILED". This run learned nothing about the
 * reaper: the subject was gone before the instrument was applied. Saying so in
 * the reaper's words would send a reader to the teardown path a costed run
 * depends on — #720's "HALTS with teardown" IS `reapAgentRuns` — for a defect
 * that has not been shown.
 *
 * @param {{pid: number, plantedAtMs: number|null, lastBeatMs: number|null, nowMs: number, artefactDir: string}} a
 */
export function plantDiedMessage({ pid, plantedAtMs, lastBeatMs, nowMs, artefactDir }) {
  const age = plantedAtMs === null ? 'an unknown time' : `${nowMs - plantedAtMs} ms`;
  const beat = lastBeatMs === null
    ? 'it never wrote a heartbeat, so it died before its first 100 ms stamp or never started'
    : `last heartbeat ${nowMs - lastBeatMs} ms ago` +
      (plantedAtMs === null ? '' : `, ${lastBeatMs - plantedAtMs} ms after planting`);
  return (
    `PLANT DIED before the reap: pid ${pid} (planted ${age} earlier; ${beat}). ` +
    'This run MEASURED NOTHING about the reaper and is NOT evidence of a reaper defect: a `setInterval` ' +
    'child cannot exit on its own, so something else killed it, and the mechanism is open on ' +
    `forge-8vfn.7.6.94. Artefacts kept for the post-mortem at ${artefactDir}`
  );
}
