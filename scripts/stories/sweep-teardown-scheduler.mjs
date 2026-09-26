/**
 * sweep-teardown-scheduler.mjs — the scheduler daemon THIS RUN started: find
 * it, own it, stop it.
 *
 * Split out of `sweep-teardown.mjs` at the 800-line cap (SPLIT, NEVER
 * BASELINE — T1 ruling 492, the same reason that file split from
 * `sweep.mjs`). The seam is real: this half is the daemon-ownership test and
 * the stop sequence; `sweep-teardown.mjs` keeps the census/release machinery
 * that gates and follows it. `scheduler-preflight.mjs` and
 * `sweep-teardown-plant.mjs` import `DAEMON_PID_FILE`/`isRunning` from
 * `sweep-teardown.mjs` today, which re-exports them from here unchanged —
 * this split moves no import.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
// The ONE `/proc`-based liveness rule (`forge-8vfn.8.1.6` follow-up) — a
// relative .ts import, proven to work under the plain `node` this runner is
// launched with (Node 22.21.1 strips erasable TS syntax with no flag).
import { isProcessRunning } from '../../packages/kernel/process-liveness.ts';

/**
 * The daemon pid file, as the product names it.
 *
 * `daemonPaths()` (`packages/flows/daemon.ts:46-52`) defines
 * `_logs/daemon/forge.pid`, and this runner cannot import it — `run.mjs` is
 * plain node with no type stripping. So the path is written once here and
 * BOUND BY TEST to the product's own function, the same way `STALL_CEILING_MS`
 * is bound to `DEFAULT_STALL_CEILING_MS`.
 *
 * I looked for `_logs/.scheduler.pid` after S10 run 9 and reported a product
 * gap that did not exist. The pid was there the whole time, at the name the
 * product had always used. A path written from memory is the same class as a
 * fixture written from memory.
 */
export const DAEMON_PID_FILE = join('_logs', 'daemon', 'forge.pid');

/** The daemon's own log, the only place it says whether it finished draining. */
export const DAEMON_LOG_FILE = join('_logs', 'daemon', 'serve.log');

/**
 * The line `scheduler.ts:301` prints after `await Promise.allSettled(inFlight)`
 * — i.e. after every in-flight cycle has finished and the daemon has released
 * what it claimed. Nothing else in `serve.log` means "the claim is back".
 */
export const DRAIN_DONE_LINE = '[serve] exited cleanly';

/**
 * How long the sweep waits for that drain before escalating.
 *
 * DECLARED, NOT MEASURED, and deliberately not large enough for a full PM pass.
 * S10 run 10 SIGTERMed a daemon that had a cycle in flight; the old window was
 * four seconds, the daemon printed `waiting on 1 in-flight cycle(s) before
 * exit…`, and the SIGKILL landed mid-drain — so the claim was never released and
 * `_queue/in-flight/` kept a manifest whose heartbeat would never advance, which
 * reds the NEXT run at a beat unrelated to the code under test.
 *
 * Thirty seconds buys a short cycle its clean exit. A long one still gets
 * killed, on purpose: a teardown that waits out a ten-minute PM pass is a
 * teardown that holds the run-lock for ten minutes. The sweep's in-flight
 * clearing is the fallback for that case, and the returned `drained: false`
 * plus its note are how the operator learns which of the two happened.
 */
export const DRAIN_GRACE_MS = 30_000;

/**
 * Tri-state read behind `ownSchedulerPid` — ROW 101 / M7-D finding 2. A
 * pidfile, `/proc/<pid>/cwd` or `/proc/<pid>/cmdline` read that fails for a
 * reason OTHER than the pid/file being genuinely gone (ENOENT) must not read
 * as "no daemon": `reapCensusAndSweep`'s census would then silently exclude a
 * live scheduler's whole descendant tree and clear `_queue/`, `_worktrees/`
 * or this run's ground while it is still writing.
 *
 * Binds on the two tokens `spawnServeDetached` (`packages/flows/daemon.ts`)
 * writes into every daemon's own argv (`[…, <forgeRoot>/apps/forge/cli.ts,
 * serve]`, review finding 2) — a `cwd` match alone answers "does a process
 * run inside our tree", never "is it our daemon", and a RECYCLED pid whose
 * new owner happens to share `cwd` (any other process this same run spawned)
 * would pass a cwd-only test and seed the census with a stranger's tree.
 *
 * @param {string} root the run's own worktree
 * @returns {{pid: number|null, unknown: boolean, error?: string}}
 */
export function ownSchedulerPidState(root) {
  let raw;
  try {
    raw = readFileSync(join(root, DAEMON_PID_FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { pid: null, unknown: false }; // no daemon was started
    return { pid: null, unknown: true, error: `could not read ${DAEMON_PID_FILE}: ${e.message}` };
  }
  const pid = Number(raw.trim());
  if (!Number.isInteger(pid) || pid <= 0) return { pid: null, unknown: false }; // not a pid file — no daemon
  let cwd;
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
  } catch (e) {
    if (e.code === 'ENOENT') return { pid: null, unknown: false }; // already gone
    return { pid: null, unknown: true, error: `could not read /proc/${pid}/cwd: ${e.message}` };
  }
  let ownRoot;
  try {
    ownRoot = realpathSync(root);
  } catch (e) {
    return { pid: null, unknown: true, error: `could not resolve ${root}: ${e.message}` };
  }
  if (cwd !== ownRoot) return { pid: null, unknown: false }; // runs elsewhere — not ours
  let cmdlineRaw;
  try {
    cmdlineRaw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { pid: null, unknown: false }; // gone — never trusted as a match
    return { pid: null, unknown: true, error: `could not read /proc/${pid}/cmdline: ${e.message}` };
  }
  const tokens = cmdlineRaw.split('\0').filter((t) => t !== '');
  const match = tokens.includes(join(root, 'apps', 'forge', 'cli.ts')) && tokens.includes('serve');
  return { pid: match ? pid : null, unknown: false };
}

/**
 * The scheduler daemon pid THIS RUN started, or `null` — T1 1418.
 *
 * The SAME ownership test `stopOwnScheduler` applies below (pid file, then a
 * `cwd` match against `root`), PLUS the argv check (review finding 2) —
 * factored out so a caller that only needs to KNOW whether this tree owns a
 * running scheduler — never to stop it — does not re-derive the check.
 * `reapCensusAndSweep` reads `ownSchedulerPidState` directly rather than this
 * bare-pid wrapper, so an UNKNOWN read can refuse instead of silently
 * defaulting to null; this wrapper stays for any caller that only ever wanted
 * a pid or null.
 *
 * @param {string} root the run's own worktree
 * @returns {number|null}
 */
export function ownSchedulerPid(root) {
  return ownSchedulerPidState(root).pid;
}

/**
 * Stop the scheduler daemon THIS RUN started — T1 ruling 657(ii).
 *
 * S10 run 9's beat 7 pressed Start and a real daemon came up
 * (`{"running":true,"pid":1868172}`, the same second the beat pressed). The
 * sweep then ran and the daemon was still alive afterwards. A scheduler left
 * running is not cosmetic residue: `scheduler-start` renders ONLY at
 * `status: stopped` (`lib/scheduler-view.ts:44`), so the NEXT run's beat 7
 * reds at t+0 on a missing handle while the state it wants already holds —
 * and the run after this one would have inherited exactly that.
 *
 * BY PID, FROM THE PID FILE, AND ONLY IF IT IS OURS. The cwd is checked
 * against the run's own tree before signalling: another lane's daemon is
 * never this run's to stop, and `pkill -f` has matched the searcher's own
 * shell three times in this campaign. TERM first, then KILL if TERM does not
 * take — run 9's did not — and BOTH are logged, because a kill nobody can see
 * in the log is indistinguishable from a daemon that exited on its own.
 *
 * `unknown: true` (ROW 102b/18-19) — a read/signal failed for a reason OTHER
 * than genuinely gone (ENOENT/ESRCH); never folded into "no daemon"/"already
 * gone"/"exited". `stopSchedulerCensusAndRelease` refuses the step on it.
 *
 * @param {string} root the run's own worktree
 * @returns {{stopped: number|null, how: string|null, drained: boolean, unknown: boolean, note: string|null}}
 */
export function stopOwnScheduler(root, graceMs = DRAIN_GRACE_MS) {
  const pidFile = join(root, DAEMON_PID_FILE);
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch (e) {
    if (e.code === 'ENOENT') return { stopped: null, how: null, drained: false, unknown: false, note: null }; // no daemon was started
    return { stopped: null, how: null, drained: false, unknown: true, note: `could not read ${DAEMON_PID_FILE}: ${e.message} — scheduler state UNKNOWN` };
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { stopped: null, how: null, drained: false, unknown: false, note: `${DAEMON_PID_FILE} held ${JSON.stringify(pid)}, which is not a pid` };
  }
  let cwd;
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
  } catch (e) {
    if (e.code === 'ENOENT') return { stopped: null, how: null, drained: false, unknown: false, note: `pid ${pid} is already gone` };
    return { stopped: null, how: null, drained: false, unknown: true, note: `could not read /proc/${pid}/cwd: ${e.message} — scheduler state UNKNOWN` };
  }
  let ownRoot;
  try {
    ownRoot = realpathSync(root);
  } catch (e) {
    return { stopped: null, how: null, drained: false, unknown: true, note: `could not resolve ${root}: ${e.message} — scheduler state UNKNOWN` };
  }
  if (cwd !== ownRoot) {
    return { stopped: null, how: null, drained: false, unknown: false, note: `pid ${pid} runs in ${cwd}, not this tree — not ours to stop` };
  }

  const log = join(root, DAEMON_LOG_FILE);
  const drainedNow = () => {
    try { return readFileSync(log, 'utf8').includes(DRAIN_DONE_LINE); } catch { return false; }
  };

  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    if (e.code === 'ESRCH') return { stopped: pid, how: 'SIGTERM', drained: drainedNow(), unknown: false, note: 'exited before the signal landed' };
    // EPERM means the pid EXISTS and is alive, not that it exited — never marked stopped.
    return { stopped: null, how: null, drained: false, unknown: true, note: `SIGTERM failed: ${e.message} — state UNKNOWN, never marked stopped` };
  }
  if (waitForExit(pid, graceMs)) {
    const drained = drainedNow();
    return {
      stopped: pid,
      how: 'SIGTERM',
      drained,
      unknown: false,
      note: drained ? null : `exited on SIGTERM without printing ${JSON.stringify(DRAIN_DONE_LINE)} — it did not drain, so its claim may still be in _queue/in-flight/`,
    };
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    // Same split as SIGTERM above; ESRCH alone means it exited in the gap.
    if (e.code !== 'ESRCH') {
      return { stopped: null, how: null, drained: false, unknown: true, note: `SIGKILL failed: ${e.message} — state UNKNOWN, never marked stopped` };
    }
  }
  waitForExit(pid, 2000);
  return {
    stopped: pid,
    how: 'SIGKILL',
    drained: false,
    unknown: false,
    note: `still draining after ${graceMs} ms — killed, so it did not drain and could not release its claim; _queue/in-flight/ is the fallback`,
  };
}

/**
 * Wait for `pid` to disappear, up to `ms`. True when it is gone.
 *
 * `Atomics.wait` rather than a `while (Date.now() < until)` poll: the previous
 * shape spun a core flat out for the whole window, which was survivable at four
 * seconds and would not be at thirty.
 */
function waitForExit(pid, ms) {
  const until = Date.now() + ms;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    if (!isRunning(pid)) return true;
    if (Date.now() >= until) return false;
    Atomics.wait(idle, 0, 0, Math.min(50, Math.max(1, until - Date.now())));
  }
}

/**
 * Is `pid` a RUNNING process — not merely a pid that exists?
 *
 * `process.kill(pid, 0)` answers the second question, not the first: a
 * process that has exited but not been reaped is a ZOMBIE — its pid is still
 * in the table, `kill(pid, 0)` still succeeds, and the wait above would sit
 * there until the grace ran out and then SIGKILL something that had already
 * finished draining, turning a clean shutdown into a reported failure.
 *
 * MOVED to `packages/kernel/process-liveness.ts`'s `isProcessRunning`
 * (`forge-8vfn.8.1.6` follow-up, T1 review): this file's own `/proc`-based
 * reading and `packages/flows/daemon.ts`'s `isAlive` used to be two
 * INDEPENDENT implementations that had drifted — `isAlive`'s old
 * `kill(pid, 0)` counted a zombie as alive, this file's never did — and a
 * zombie scheduler pid could pass this file's own liveness read while the
 * product's `spawnServeDetached` (which used `isAlive`) still treated it as
 * "already running" and started nothing new. Delegating to ONE shared rule
 * closes that by construction. See the kernel module's own header for the
 * full ENOENT/Z/X reasoning — it applies unchanged; only its address moved.
 *
 * `procRoot` is a seam for the fixture door this bug bought itself — real
 * callers never pass it and get the real `/proc`.
 */
export function isRunning(pid, procRoot = '/proc') {
  return isProcessRunning(pid, procRoot);
}
