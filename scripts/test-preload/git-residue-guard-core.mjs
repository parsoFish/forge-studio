/**
 * git-residue-guard-core.mjs — the pure half of a test-run residue guard: any
 * TRACKED file `npm test` leaves dirty is exactly the class `ground-hash.mjs`
 * exists to catch for a story run (it hashes `projects/` before and after to
 * prove a run's ground did not drift), and a full suite has no fence of its
 * own for the WHOLE repo. M7-D handoff, T1's "cheap fence" ask.
 *
 * `git status --porcelain -uno` lists only non-clean TRACKED paths (`-uno`
 * hides untracked files, a different, much noisier class this guard is not
 * for) — a clean checkout reports nothing, so this needs no allowlist and
 * never nags an operator's own pre-existing dirty tree: only a line that is
 * NEW between the before- and after-snapshot is residue.
 *
 * PURE ON PURPOSE, same shape as `logs-residue-guard-core.mjs`: no
 * import-time I/O and no reference to this repo's own root — a caller hands
 * in `cwd` explicitly, so a unit test can drive it against a throwaway repo
 * without ever touching this checkout's real tree. The actual preload wiring
 * (snapshot-at-import + fail-at-exit, git invoked against THIS repo) lives in
 * the sibling `git-residue-guard.mjs`.
 */
import { execFileSync } from 'node:child_process';

/**
 * Every non-clean TRACKED path `git status --porcelain -uno` reports under
 * `cwd`, as a `Set` of full porcelain lines (the two-character status code
 * plus the path). The status code is part of the line on purpose: a path
 * that goes from `' M'` to `'MM'` between snapshots is a real state change
 * and must count as new, not be masked by matching on the path alone.
 *
 * Never swallows a `git` failure — an unreadable tree is a louder problem
 * than a false-clean residue check, so a spawn failure propagates as an
 * uncaught throw, the same discipline this audit set for every guard in
 * `scripts/stories/`.
 */
export function trackedPorcelainLines(cwd) {
  const out = execFileSync('git', ['status', '--porcelain', '-uno'], { cwd, encoding: 'utf8' });
  return new Set(
    out
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0),
  );
}

/**
 * The lines present in `after` but absent from `before`, sorted for a
 * deterministic report — the same "only appearances are reported" rule as
 * `newInitDirs`: a line already dirty before the suite ran is the operator's
 * own pre-existing state, not something this run caused.
 */
export function newTrackedChanges(before, after) {
  return [...after].filter((line) => !before.has(line)).sort();
}
