/**
 * sweep-agent-logs — the `_logs/_agent-<slug>-*` residue a PREVIOUS run of a
 * story left behind, captured and then claimed by the next run's LEADING sweep.
 *
 * ITS OWN FILE BECAUSE THE CAP SAID SO, AND THE CAP WAS RIGHT. These two
 * functions lived in `sweep.mjs` and took it from 706 lines to 805 — past the
 * 800-line hard cap (`scripts/check-file-size.mjs`, 1.0.md §0), which failed
 * the gate and three `npm test` cases with it. The 22 lines that crossed the
 * line were a doc comment M6-C's review asked for, and the choice was to trim
 * the reasoning or to split the file. Trimming would have bought 17 lines of
 * headroom in a file another lane owns, which is a trap for whoever adds the
 * next function. So: split, as the checker's own message says to.
 *
 * `sweep.mjs` keeps the PATH-DELTA fence and the fixture sweeps — things
 * expressed as a set of repo-relative paths. This file is about a different
 * kind of residue: dirs named for an AGENT rather than for the story, which no
 * path rule in `sweep.mjs` can claim, and which are dangerous for a reason the
 * fence never had to think about — they are READABLE STATE, not just records.
 */
import { readdirSync, mkdirSync, cpSync } from 'node:fs';
import { join, basename } from 'node:path';
import { assertSafeStoryId, storyFixtureNames, removePaths } from './sweep.mjs';

/**
 * The `_logs/_agent-<slug>-*` dirs a PREVIOUS run of this story left behind.
 *
 * Bead `forge-8vfn.7.6.24` (T1 ruling 714(a)). A story that dispatches a
 * standalone agent mints a log dir named for the AGENT, not for the story, so
 * none of the paths above claim it. S5 run 3 met run 2b's:
 *
 *     ✗ 12. … data-ledger-count: expected "1", got "2"
 *     ✓ 13. Read the row: what it cost, where it ran, and how it ended   ← 146 ms
 *
 * Beat 12 asserts the COUNT and failed honestly. Beat 13 asserts the row's
 * CONTENT and matched the OLD row — so a beat that had been red all campaign
 * went green by reading a different run's artefact. `studio/flows/story-<id>`
 * is in this file for the same class (S4 run 1, bead `2.26`), and the
 * difference is the one that matters: that residue REDS a run, so someone
 * notices. This one passes quietly. A residue that fails loudly costs a run; one
 * that passes quietly costs a conclusion.
 *
 * LEADING SWEEP ONLY, and that is what makes "never a dir born during this run"
 * exact rather than a judgement call: this runs BEFORE the story starts, so at
 * that instant no such dir can belong to this run. No birth-time comparison and
 * no window to get wrong. The trailing sweep must never take them — by then the
 * run's own dispatch log is evidence.
 *
 * @returns {string[]} absolute dirs, sorted; empty when the story dispatches none
 */
export function previousAgentLogDirs(storyId, root) {
  assertSafeStoryId(storyId);
  const logs = join(root, '_logs');
  const prefixes = storyFixtureNames(storyId).map((n) => `_agent-${n}-`);
  let entries;
  try {
    entries = readdirSync(logs, { withFileTypes: true });
  } catch {
    return []; // no `_logs` yet is a real answer: a first run has no residue
  }
  return entries
    .filter((e) => e.isDirectory() && prefixes.some((p) => e.name.startsWith(p)))
    .map((e) => join(logs, e.name))
    .sort();
}

/**
 * Capture each previous-run agent log to this run's own stamped evidence dir,
 * then remove it.
 *
 * `runStamp` is REQUIRED, never defaulted — `redEvidenceDir`'s header records
 * what a call-time default cost: two runs' captures in one directory,
 * distinguishable only by reading a session id out of the JSON, which reads as
 * one run.
 *
 * WHAT THIS DOES NOT BUY, SAID PLAINLY (M6-C, reviewing the bead): it does not
 * raise the STORAGE CLASS. `_logs/*` is gitignored, so the capture and the
 * thing it documents die together under one `rm -rf _logs`. Nothing in the tree
 * deletes `_story-swept` — the fence classifies `git status --porcelain`
 * entries and no fence read passes `--ignored`, which is the same blindness
 * that let `_agent-*` accumulate unseen — but "nothing deletes it" is not
 * "it is durable".
 *
 * What it buys is that THE EVIDENCE LEAVES THE READ PATH. The residue was
 * always durable; the defect was that it was also READABLE by the next run's
 * assertions. S5 run 3's beat 13 went green in 146ms against run 2b's row.
 * Same bytes, one directory deeper, enumerated by no preflight and no beat.
 *
 * A run's OWN agent dirs therefore survive its teardown and are swept by the
 * NEXT run — correct for the previous-run case, and it means every run now
 * begins by claiming the last run's agent evidence. That is why the capture
 * precedes the removal and why a failed copy leaves the directory standing.
 * For a RED run the human-level rule is unchanged and stronger: §15.241 copies
 * the capture to the campaign evidence dir before anything restores. This code
 * cannot do that for you — product code must not know a gitignored campaign
 * path — so it makes that copy cheap and well-named instead of automatic.
 *
 * @returns {{captured: string[], removed: string[], failed: {path: string, error: string}[]}}
 */
/**
 * `runStamp` is interpolated into a path, so it gets the same treatment
 * `assertSafeStoryId` gives the story id, and for the same reason.
 *
 * FOUND BY REVIEWING MY OWN DIFF, not by a test failing. `storyId` was guarded
 * from the first line because it names a directory that gets removed
 * recursively; `runStamp` names a directory too, one segment further down, and
 * arrived guarded only against empty. Today's only caller computes it from
 * `toISOString()`, so nothing could reach it — which is exactly the argument
 * that keeps an unguarded boundary unguarded until a second caller appears.
 * The guard costs three lines; the reasoning for skipping it costs a sentence
 * every future reader has to re-derive.
 */
function assertSafeRunStamp(runStamp) {
  if (typeof runStamp !== 'string' || runStamp === '') {
    throw new Error('captureAndSweepAgentLogs: runStamp is required — an unstamped capture mixes runs');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runStamp) || runStamp.includes('..')) {
    throw new Error(
      `captureAndSweepAgentLogs: unsafe runStamp ${JSON.stringify(runStamp)}: expected a single path segment of [A-Za-z0-9._-]`,
    );
  }
}

export function captureAndSweepAgentLogs(storyId, root, runStamp) {
  assertSafeStoryId(storyId);
  assertSafeRunStamp(runStamp);
  const dest = join(root, '_logs', '_story-swept', storyId, runStamp);
  const captured = [];
  const failed = [];
  const dirs = previousAgentLogDirs(storyId, root);
  for (const d of dirs) {
    try {
      mkdirSync(dest, { recursive: true });
      cpSync(d, join(dest, basename(d)), { recursive: true });
      captured.push(d);
    } catch (err) {
      // A capture that failed must NOT be followed by a removal — losing the
      // bytes is worse than carrying the residue one more run.
      failed.push({ path: d, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const { removed, failed: rmFailed } = removePaths(captured);
  return { captured, removed, failed: [...failed, ...rmFailed] };
}
