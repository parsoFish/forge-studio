/**
 * sweep-teardown.mjs — what a run PUTS BACK and STOPS when it ends.
 *
 * Split out of `sweep.mjs` at the 800-line cap (SPLIT, NEVER BASELINE — T1
 * ruling 492). The seam is a real one rather than a line count: `sweep.mjs`
 * decides what a run REMOVES before it starts and what the fence judges
 * afterwards; this file is the paired half — the committed artifacts the
 * leading sweep deleted and did not regenerate, and the daemon the run's own
 * beat started.
 *
 * Both exist because a run that ends badly used to leave the tree lying about
 * itself: files git still tracks reported as deleted, and a scheduler still
 * running that would red the NEXT run's beat 7 at t+0.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

/**
 * Put back the COMMITTED artifacts the leading sweep removed and the run never
 * regenerated — T1 ruling 594's second half.
 *
 * THE SWEEP HAS NO PAIRED RESTORE. `demos/stories/<id>/` is deleted before the
 * bridge boots, so a run cannot inherit dead state, and it is rebuilt as beats
 * pass. Any exit between those two points leaves the repo holding whatever the
 * run reached and MISSING every committed file it had not got to — which
 * `git status` then shows as deliberate deletions.
 *
 * The motivating case is not a crash. Lane C's run refused at preflight because
 * a healthy bridge from another lane's worktree held 4123 — the runner doing
 * exactly the right thing — and that correct refusal still left three committed
 * files deleted: two frames and `story.json`. **A preflight refusal is the most
 * likely abort there is, and it was the one that guaranteed the damage.** Lane A
 * measured the same shape from a kill at beat 6 (frames 06–11 plus
 * `story.json`), and S10 has far more frames than S1.
 *
 * ONLY WHAT IS STILL MISSING. A run that finished regenerated its artifacts, and
 * those legitimately differ from HEAD — restoring them would destroy the very
 * output the run exists to produce. So a path is restored only if git tracks it
 * AND it is absent from the disk right now. That single condition is what makes
 * this safe to run unconditionally on every exit path.
 *
 * @param {string} root the run's own worktree
 * @param {string[]} sweptPaths absolute paths the leading sweep reported removing
 * @returns {{restored: string[], failed: {path: string, error: string}[]}}
 */
export function restoreSweptCommitted(root, sweptPaths) {
  const restored = [];
  const failed = [];
  for (const abs of sweptPaths) {
    const rel = relative(root, abs);
    if (rel === '' || rel.startsWith('..')) continue; // never reach outside the run's own tree
    let tracked = [];
    try {
      tracked = execFileSync('git', ['ls-files', '-z', '--', rel], { cwd: root, encoding: 'utf8' })
        .split('\0').filter((p) => p !== '');
    } catch {
      continue; // not a repo, or git unavailable — nothing to restore against
    }
    const missing = tracked.filter((p) => !existsSync(join(root, p)));
    if (missing.length === 0) continue;
    try {
      execFileSync('git', ['checkout', '--', ...missing], { cwd: root, encoding: 'utf8' });
      restored.push(...missing);
    } catch (e) {
      failed.push({ path: rel, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { restored: restored.sort(), failed };
}

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
 * @param {string} root the run's own worktree
 * @returns {{stopped: number|null, how: string|null, note: string|null}}
 */
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

export function stopOwnScheduler(root, graceMs = DRAIN_GRACE_MS) {
  const pidFile = join(root, DAEMON_PID_FILE);
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return { stopped: null, how: null, drained: false, note: null }; // no daemon was started
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { stopped: null, how: null, drained: false, note: `${DAEMON_PID_FILE} held ${JSON.stringify(pid)}, which is not a pid` };
  }
  let cwd;
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return { stopped: null, how: null, drained: false, note: `pid ${pid} is already gone` };
  }
  if (cwd !== realpathSync(root)) {
    return { stopped: null, how: null, drained: false, note: `pid ${pid} runs in ${cwd}, not this tree — not ours to stop` };
  }

  const log = join(root, DAEMON_LOG_FILE);
  const drainedNow = () => {
    try { return readFileSync(log, 'utf8').includes(DRAIN_DONE_LINE); } catch { return false; }
  };

  try { process.kill(pid, 'SIGTERM'); } catch { return { stopped: pid, how: 'SIGTERM', drained: drainedNow(), note: 'exited before the signal landed' }; }
  if (waitForExit(pid, graceMs)) {
    const drained = drainedNow();
    return {
      stopped: pid,
      how: 'SIGTERM',
      drained,
      note: drained ? null : `exited on SIGTERM without printing ${JSON.stringify(DRAIN_DONE_LINE)} — it did not drain, so its claim may still be in _queue/in-flight/`,
    };
  }

  try { process.kill(pid, 'SIGKILL'); } catch { /* it exited in the gap */ }
  waitForExit(pid, 2000);
  return {
    stopped: pid,
    how: 'SIGKILL',
    drained: false,
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
 * `process.kill(pid, 0)` answers the second question and this file assumed it
 * answered the first. A process that has exited but not been reaped is a ZOMBIE:
 * its pid is still in the table, `kill(pid, 0)` still succeeds, and the wait
 * above would sit there until the grace ran out and then SIGKILL something that
 * had already finished draining — turning a clean shutdown into a reported
 * failure. The test for this caught it on its first run, because a synchronous
 * wait blocks the event loop, so a child of the waiting process can never be
 * reaped while the wait is in progress.
 *
 * The daemon is not the story runner's child in production, so the zombie case
 * is not the common one — but "the pid exists" and "the process is running" are
 * different facts, and reading one for the other is how three of today's other
 * defects happened. `/proc/<pid>/stat`'s state field is the one that answers it,
 * and it is the same `/proc` read `lockHolders` and the `cwd` check already use.
 */
function isRunning(pid) {
  let stat;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return false; // gone entirely
  }
  // `comm` can contain spaces and parentheses, so the state field is the first
  // character after the LAST ')' — never `split(' ')[2]`.
  const at = stat.lastIndexOf(')');
  const state = at === -1 ? '' : stat.slice(at + 2, at + 3);
  return state !== 'Z';
}

/**
 * Release the `_queue/in-flight/` claims this TREE owns — the fallback for a
 * daemon that could not drain.
 *
 * `stopOwnScheduler` gives the daemon a bounded window to finish its cycles and
 * hand its claims back itself, which is always the better outcome because the
 * cycle's own state goes with it. When the window runs out the daemon is killed
 * mid-flight, and what it was holding stays in `in-flight` with a heartbeat
 * frozen at the instant of the kill. S10 run 10 left exactly that, and
 * `_queue/` is gitignored, so `git status` reported a clean tree over it — the
 * next run would have found `start-work-develop` disabled ("nothing is ready to
 * start (blocked, running, or done)") and red at a beat with nothing to do with
 * its own code.
 *
 * ATTRIBUTED FROM THE ARTIFACT, never from a pattern or a time window. Each
 * manifest carries `project_repo_path`, the tree it was minted for, so a
 * concurrent lane's claim in a shared queue is left alone by construction
 * rather than by hoping the windows do not overlap. A companion `.heartbeat`
 * travels with its manifest; anything else in the directory — `.gitkeep`
 * included — is untouched.
 *
 * The caller CAPTURES before calling: these files are the evidence that the
 * develop beat's disabled button was right.
 *
 * @param {string} root the run's own worktree
 * @returns {{released: string[], failed: {path: string, error: string}[]}}
 */
export function releaseOwnInFlight(root) {
  const dir = join(root, '_queue', 'in-flight');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { released: [], failed: [] }; // no queue at all — a run that claimed nothing
  }
  const released = [];
  const failed = [];
  const ours = join(realpathSync(root), 'projects');
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch (e) {
      failed.push({ path: name, error: String(e) });
      continue;
    }
    const m = /^project_repo_path:\s*(.+)$/m.exec(text);
    if (m === null || !m[1].trim().startsWith(ours)) continue;
    for (const f of [name, `${name}.heartbeat`]) {
      if (!existsSync(join(dir, f))) continue;
      try {
        rmSync(join(dir, f));
        released.push(f);
      } catch (e) {
        failed.push({ path: f, error: String(e) });
      }
    }
  }
  return { released: released.sort(), failed };
}
