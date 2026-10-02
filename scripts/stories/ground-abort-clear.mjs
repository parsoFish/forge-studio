/**
 * ground-abort-clear.mjs — the own-ground capture+clear a SIGINT/SIGTERM
 * mid-story still needs — forge-8vfn.8.5.21 (Defect B, row 184b fold).
 *
 * `run-story.mjs`'s own end-of-story path already captures and clears every
 * session a run minted inside its project ground ("own ground: CAPTURED …
 * CLEARED …", `ground-minted.mjs` + `ground-clear.mjs`). An operator Ctrl-C
 * mid-story skips `runStory` entirely — `run.mjs`'s SIGINT/SIGTERM handler
 * (`onStopSignal`) calls `process.exit()` directly, before `runStory`'s own
 * teardown ever runs — so a session the IN-PROGRESS story minted survived in
 * the REAL ground, moving its method-C hash off the pin the next run's
 * launcher checks.
 *
 * REUSES THE SAME PRIMITIVES `run-story.mjs` already does
 * (`mintedSessionPaths`/`groundMintedSessionPaths` to find what was minted,
 * `captureAndClearMintedSessions` to capture-then-remove it), minus the drift
 * CLASSIFICATION (`classifyOwnGroundDrift`) that only matters for a FINISHED
 * run's containment report. A session this run minted has no history before
 * this run at all — there is nothing to tell "added" from "modified" about
 * it, so every minted path is its own `home`, by construction, and that is
 * all `captureAndClearMintedSessions` needs to find and remove it.
 */
import { mintedSessionPaths, groundMintedSessionPaths } from './ground-minted.mjs';
import { captureAndClearMintedSessions } from './ground-clear.mjs';

/**
 * @param {object} input
 * @param {string} input.root this run's own worktree
 * @param {string} input.project the ground project the in-progress story declared
 * @param {string} input.storyId
 * @param {string} input.runStamp this run's own evidence stamp
 * @param {{files: Map<string,string>}|null} input.groundBefore the project's
 *   own ground manifest, read before the story's first beat
 * @param {{files: Map<string,string>}|null} input.groundAfter the SAME read,
 *   taken now — at the moment the abort path runs
 * @param {string[]} input.logsBefore `_logs/` entry names before the story started
 * @param {string[]} input.logsAfter the SAME read, taken now
 * @param {string} input.logsDir the `_logs/` dir itself
 * @param {Set<string>} input.registeredKindIds `loadRegisteredSessionKindIds(root)`
 * @returns {ReturnType<typeof captureAndClearMintedSessions>}
 */
export function captureAndClearMintedSessionsSince({
  root, project, storyId, runStamp, groundBefore, groundAfter, logsBefore, logsAfter, logsDir, registeredKindIds,
}) {
  const minted = [...new Set([
    ...mintedSessionPaths(logsBefore, logsAfter, logsDir),
    ...groundMintedSessionPaths(groundBefore, groundAfter, registeredKindIds),
  ])].sort();
  // Every minted path IS its own home — a session that did not exist before
  // this run has nothing else it could be "added inside".
  const producedPaths = minted.map((path) => ({ kind: 'added', path, home: path, writers: [] }));
  return captureAndClearMintedSessions({ root, project, storyId, runStamp, producedPaths });
}
