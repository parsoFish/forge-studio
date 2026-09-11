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
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
export function stopOwnScheduler(root) {
  const pidFile = join(root, DAEMON_PID_FILE);
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return { stopped: null, how: null, note: null }; // no daemon was started
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { stopped: null, how: null, note: `${DAEMON_PID_FILE} held ${JSON.stringify(pid)}, which is not a pid` };
  }
  let cwd;
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return { stopped: null, how: null, note: `pid ${pid} is already gone` };
  }
  if (cwd !== realpathSync(root)) {
    return { stopped: null, how: null, note: `pid ${pid} runs in ${cwd}, not this tree — not ours to stop` };
  }
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try { process.kill(pid, sig); } catch { return { stopped: pid, how: sig, note: 'exited before the signal landed' }; }
    const until = Date.now() + (sig === 'SIGTERM' ? 4000 : 2000);
    while (Date.now() < until) {
      try { process.kill(pid, 0); } catch { return { stopped: pid, how: sig, note: null }; }
    }
  }
  return { stopped: null, how: null, note: `pid ${pid} survived SIGTERM and SIGKILL` };
}
