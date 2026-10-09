/**
 * Preload — `node --import=./scripts/test-preload/git-residue-guard.mjs`
 * (wired into package.json's `test` script as a third `--import`, loaded
 * before every test file `npm test` runs).
 *
 * M7-D handoff, T1's "cheap fence" ask — a full suite has no fence of its
 * own: a story run hashes `projects/` before and after to prove its ground
 * did not drift (`ground-hash.mjs`), but nothing does the equivalent for the
 * WHOLE repo when `npm test` runs. This is that fence, scoped to TRACKED
 * files only (`git status --porcelain -uno`) — an untracked scratch file a
 * test forgets to clean up is real but a different, much noisier class this
 * preload is not for.
 *
 * WHY PER-TEST-FILE, NOT A `pretest`/`posttest` PAIR. `npm`'s lifecycle skips
 * `posttest` whenever `test` itself exits non-zero — exactly the run an
 * operator most wants this fence checked on, since a suite with a real
 * failure is also the one likeliest to have aborted mid-write. `node --test`
 * already isolates each test file into its own subprocess
 * (`logs-residue-guard.mjs`'s own doc), so — same design as that guard —
 * this snapshots `git status` at import (before this FILE's own tests) and
 * diffs it at `exit` (after): a residue this file's own run caused always
 * falls inside its own process's window, and a child's non-zero exit already
 * fails the suite overall with no extra wiring.
 *
 * The decision logic (parsing porcelain lines, diffing before/after) is pure
 * and unit-tested in `../git-residue-guard.test.ts` against a throwaway
 * `git init` repo — never this file's own real tree — because driving THIS
 * file's git calls from a unit test would mean writing into the real
 * checkout from a test, the exact thing this guard exists to catch
 * elsewhere.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackedPorcelainLines, residueReport } from './git-residue-guard-core.mjs';

// This file's own location, not `process.cwd()` — same reasoning as
// `logs-residue-guard.mjs`: `npm test` always runs from the repo root today,
// but a preload that trusted the cwd would silently mis-root the moment that
// stopped being true, and there is no reason this constant needs a caller at
// all.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const before = trackedPorcelainLines(REPO_ROOT);

// `kill(pid, 0)` sends nothing, it only probes. ESRCH = gone; EPERM = exists but
// owned by another user, still alive. Any other error propagates to
// `liveRunVerdict`, which reports it as inconclusive rather than "no live run".
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return false;
    if (err?.code === 'EPERM') return true;
    throw err;
  }
}

process.on('exit', () => {
  const report = residueReport({
    root: REPO_ROOT,
    before,
    after: trackedPorcelainLines(REPO_ROOT),
    isPidAlive,
  });
  if (report === null) return;
  // Same late-failure discipline as `logs-residue-guard.mjs`: set
  // `process.exitCode` inside the `exit` listener, never `process.exit()`,
  // so a sibling listener's own cleanup (a fixture's `rmSync` in a
  // `finally`/`after`) is never cut off mid-run.
  process.exitCode = 1;
  // A live-run or inconclusive verdict still fails the file: a tree that
  // changed under a suite is not clean evidence.
  process.stderr.write(report);
});
