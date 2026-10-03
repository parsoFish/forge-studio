/**
 * process-liveness.ts — the ONE rule for "is this pid actually running?",
 * shared by the story runner's scheduler preflight and the product's own
 * daemon liveness check.
 *
 * GAP `forge-8vfn.8.1.6` follow-up (T1 review of the story-ceiling-env work).
 * `scripts/stories/sweep-teardown.mjs`'s `isRunning` reads `/proc/<pid>/stat`
 * and treats states `Z` (zombie) and `X` (dead) as gone; a reading based on
 * `process.kill(pid, 0)` alone disagrees — it counts a ZOMBIE as alive, since
 * the kernel still holds its pid table entry until something reaps it. A
 * zombie daemon pid could therefore PASS the story runner's own preflight
 * while `spawnServeDetached` (`packages/flows/daemon.ts`) still treats it as
 * live and starts nothing new: a daemon-start route landing on a bridge that
 * silently no-ops, in an env nothing would ever read. ONE rule, used by
 * BOTH, closes that gap by construction rather than by keeping two
 * independent readings in sync by hand.
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
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const NOT_RUNNING_STATES = new Set(['Z', 'X']);

/**
 * Is `pid` a RUNNING process — not merely a pid that exists in the process
 * table (a zombie's does, until it is reaped)?
 *
 * @param pid the process id, as a number or a string
 * @param procRoot the `/proc`-shaped root to read from (tests only)
 */
export function isProcessRunning(pid: number | string, procRoot = '/proc'): boolean {
  // Only a positive integer can name a process; nothing else reaches the path.
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  let stat: string;
  try {
    stat = readFileSync(`${procRoot}/${n}/stat`, 'utf8');
  } catch (err) {
    // ENOENT: gone. Anything else: unknown, so NOT concluded gone.
    return (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
  const at = stat.lastIndexOf(')');
  const state = at === -1 ? '' : stat.slice(at + 2, at + 3);
  return !NOT_RUNNING_STATES.has(state);
}

/**
 * Is `pid` genuinely OUR `forge serve`, rooted at `forgeRoot` — not merely
 * alive (M7-E review, pid reuse)? A pid file or stop marker names a pid at
 * write time; by the time a later boot or poll reads it, the OS may have
 * handed that same number to an unrelated process. Same ownership test
 * `scripts/stories/sweep-teardown-scheduler.mjs`'s `ownSchedulerPidState`
 * already applies to the scheduler's own pid — a recycled pid that merely
 * shares an argv token never passes.
 *
 * M7-E HIGH (row 205 follow-up): accepts EITHER documented launch form —
 * `<forgeRoot>/apps/forge/cli.ts` (spawnServeDetached) or
 * `<forgeRoot>/bin/forge.mjs` (hand/systemd/pm2, docs/reference/serve-
 * supervision.md) — as a cmdline token, ALONGSIDE `serve`; a relative token
 * resolves against the pid's own `/proc/<pid>/cwd` first. `/proc/<pid>/cwd`
 * must ALSO resolve to `forgeRoot` itself (cli.ts `chdir`s there on boot,
 * whichever form launched it), so a stranger sharing an argv token by
 * coincidence still never passes.
 *
 * ANY read failure (gone, or unreadable for any other reason) reads as
 * `false`. This is deliberately NOT the same ENOENT-only split
 * `isProcessRunning` uses: callers combine this with `isProcessRunning`
 * (`isProcessRunning(pid) && isForgeServePid(pid, forgeRoot)`), so a false
 * here only ever demotes an already-"alive" pid to "not ours" — worst case
 * a redundant respawn, never a signal sent to, or a wait on, a stranger.
 *
 * `procRoot` is a test seam; real callers get the real `/proc`.
 */
export function isForgeServePid(pid: number, forgeRoot: string, procRoot = '/proc'): boolean {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  let cmdlineRaw: string;
  try {
    cmdlineRaw = readFileSync(`${procRoot}/${n}/cmdline`, 'utf8');
  } catch {
    return false;
  }
  const tokens = cmdlineRaw.split('\0').filter((t) => t !== '');
  if (!tokens.includes('serve')) return false;

  let cwd: string;
  let root: string;
  try {
    cwd = realpathSync(`${procRoot}/${n}/cwd`);
    root = realpathSync(forgeRoot);
  } catch {
    return false;
  }
  if (cwd !== root) return false;

  const cliPath = resolve(forgeRoot, 'apps', 'forge', 'cli.ts');
  const binPath = resolve(forgeRoot, 'bin', 'forge.mjs');
  return tokens.some((t) => {
    const abs = isAbsolute(t) ? t : resolve(cwd, t);
    return abs === cliPath || abs === binPath;
  });
}
