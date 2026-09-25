/**
 * process-liveness.ts — the ONE rule for "is this pid actually running?",
 * shared by the story runner's scheduler preflight and the product's own
 * daemon liveness check.
 *
 * GAP `forge-8vfn.8.1.6` follow-up (T1 review of the story-ceiling-env work).
 * Before this module the two readings had DRIFTED apart:
 * `scripts/stories/sweep-teardown.mjs`'s `isRunning` read `/proc/<pid>/stat`
 * and treated states `Z` (zombie) and `X` (dead) as gone, while
 * `packages/flows/daemon.ts`'s `isAlive` used `process.kill(pid, 0)`, which
 * counts a ZOMBIE as alive — the kernel still holds its pid table entry
 * until something reaps it. A zombie scheduler pid therefore PASSED the
 * story runner's own preflight (`scripts/stories/scheduler-preflight.mjs`)
 * while making `spawnServeDetached` (`daemon.ts`) return `null` and start
 * nothing new: the run's cost ceiling landed on a bridge whose
 * `scheduler-start` was a silent no-op, in an env nothing would ever read.
 * ONE rule, used by BOTH, closes that gap by construction rather than by
 * keeping two independent readings in sync by hand.
 *
 * `ENOENT` — AND ONLY `ENOENT` — MEANS GONE (T1 1372, RP's load repro). Any
 * OTHER read failure reports "still running": a transient, unexplained
 * `/proc` read failure on a pid there is every reason to believe is alive is
 * not the same fact as that pid having exited, and reading it as exited is
 * the conflation that let a caller signal a daemon that had never stopped
 * ignoring its SIGTERM (measured — see `sweep-teardown.mjs`'s own history).
 *
 * The state char is the first character after the LAST `)` — a process's
 * `comm` field can itself contain spaces and parentheses, so it is never
 * `stat.split(' ')[2]`.
 *
 * `Z` (zombie — exited, not yet reaped) and `X` (dead — a kernel state so
 * transient `man proc` calls it one that "should never be seen", but a
 * starved host can stretch the window a read actually lands in) both mean
 * NOT RUNNING.
 *
 * `procRoot` is a seam for tests; every real caller gets the real `/proc`.
 */
import { readFileSync } from 'node:fs';

const NOT_RUNNING_STATES = new Set(['Z', 'X']);

/**
 * Is `pid` a RUNNING process — not merely a pid that exists in the process
 * table (a zombie's does, until it is reaped)?
 *
 * @param pid the process id, as a number or a string
 * @param procRoot the `/proc`-shaped root to read from (tests only)
 */
export function isProcessRunning(pid: number | string, procRoot = '/proc'): boolean {
  let stat: string;
  try {
    stat = readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
  } catch (err) {
    // ENOENT: gone. Anything else: unknown, so NOT concluded gone.
    return (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
  const at = stat.lastIndexOf(')');
  const state = at === -1 ? '' : stat.slice(at + 2, at + 3);
  return !NOT_RUNNING_STATES.has(state);
}
