/**
 * lock-guard.mjs — the two kinds of work in this checkout that must not overlap.
 *
 * Bead `forge-8vfn.7.6.13`, T1 rulings 596 and 634. MEASURED from another
 * lane's fence rather than from a review: lane A's story-run fence reported
 *
 *     fence: UNATTRIBUTABLE projects/_r4-17-dispatch-fixture-proj — appeared in
 *     /home/parso/forge-m6-d while pid 1235057 was working there
 *
 * and the pid was a `node --test` worker from a full suite.
 * `packages/agents/tests/integration/agent-run-dispatch.test.ts` builds a
 * fixture at `<root>/projects/_r4-17-dispatch-fixture-proj` and sweeps it in a
 * module-level `after()`. Benign — and beside the point.
 *
 * THE DEFECT IS THE LOCKING. A full suite and a story run take DIFFERENT locks,
 * so neither excludes the other, and the suite writes into `projects/` — the
 * directory a story run hashes before and after to prove its ground did not
 * drift. The two overlap BY CONSTRUCTION.
 *
 * It is the third distinct source of the ground-drift class and the only one
 * that needs no agent: the other two are an onboarding agent writing into a
 * project repo, and a dot-prefixed `.kb-*` session dir the preflight's glob
 * could not see. **This one the harness does to itself**, from a second process
 * the run has no reason to know exists.
 *
 * WHY THE LOCK PATHS ARRIVE BY ENVIRONMENT. The locks this guards are the
 * CAMPAIGN's, and they live in the campaign directory. A permanent artifact in
 * this repo never cites a path inside it (CLAUDE.md), and inventing a third
 * lock here would be worse than the defect — two processes would then agree
 * about a file neither of them takes. So the caller names the lock it wants
 * excluded, and a checkout with nothing declared SAYS SO rather than implying
 * an exclusion it is not enforcing.
 *
 * HOLDERS ARE FOUND BY OPEN FILE DESCRIPTOR, NEVER BY PATTERN (§15.344). A
 * `pgrep -f` on a command string matches the searcher's own command line and
 * returns fresh pids each time it is run; this walks `/proc/<pid>/fd` and keeps
 * the pids whose descriptors resolve to the lock file itself, then reads each
 * one's `cwd`. A process is named only when the kernel says it holds that file
 * open.
 *
 * FAIL FAST, NEVER SLEEP (§15.335). Neither caller waits for the other lock to
 * clear: waiting inside a gate is how a 120-second harness timeout turns a
 * queued job into a reaped one. The refusal exits non-zero with one line, and
 * the lane's own Monitor is what waits.
 */

import { readdirSync, readlinkSync, realpathSync, existsSync } from 'node:fs';

/** Env name → the campaign's full-suite lock, excluded by a story run. */
export const SUITE_LOCK_ENV = 'FORGE_SUITE_LOCK';
/** Env name → the campaign's story-run lock, excluded by the test suite. */
export const RUN_LOCK_ENV = 'FORGE_RUN_LOCK';

/**
 * Every process holding `lockPath` open, by file descriptor.
 *
 * @returns {{pid: string, cwd: string|null}[]} — empty when nothing holds it,
 *          which is indistinguishable from "nobody is running", as it should be.
 */
export function lockHolders(lockPath, procRoot = '/proc') {
  if (!existsSync(lockPath)) return [];
  let target;
  try {
    target = realpathSync(lockPath);
  } catch {
    return [];
  }
  const holders = [];
  let pids;
  try {
    pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  for (const pid of pids) {
    let fds;
    try {
      fds = readdirSync(`${procRoot}/${pid}/fd`);
    } catch {
      continue; // not ours to read, or it exited between readdir and here
    }
    for (const fd of fds) {
      let resolved;
      try {
        resolved = readlinkSync(`${procRoot}/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (resolved !== target) continue;
      let cwd = null;
      try {
        cwd = readlinkSync(`${procRoot}/${pid}/cwd`);
      } catch {
        /* a process we cannot introspect is still a holder worth naming */
      }
      holders.push({ pid, cwd });
      break;
    }
  }
  return holders;
}

/**
 * Should this kind of work refuse to start?
 *
 * @param {object} args
 * @param {string|undefined} args.lockPath   the OTHER kind's lock, from the environment
 * @param {string} args.envName              which variable should have named it
 * @param {string} args.thisKind             what is being started ("a story run")
 * @param {string} args.otherKind            what would overlap ("a full test suite")
 * @returns {{ok: boolean, reason: string}}
 */
export function overlapVerdict({ lockPath, envName, thisKind, otherKind, procRoot = '/proc' }) {
  if (!lockPath) {
    // Declared absence. A guard that says nothing when it is not configured is
    // indistinguishable from a guard that checked and found nothing — the exact
    // shape this campaign keeps finding in tests and waits.
    return {
      ok: true,
      reason: `overlap guard not configured: ${envName} names no lock, so ${thisKind} is NOT excluded from ${otherKind}`,
    };
  }
  const holders = lockHolders(lockPath, procRoot);
  if (holders.length === 0) {
    return { ok: true, reason: `overlap ok — nothing holds ${lockPath}` };
  }
  const who = holders.map((h) => `pid ${h.pid} (cwd ${h.cwd ?? '<unreadable>'})`).join(', ');
  return {
    ok: false,
    reason:
      `refusing to start ${thisKind}: ${otherKind} holds ${lockPath} — ${who}. ` +
      'The suite writes into projects/, which a story run hashes before and after to prove its ground ' +
      'did not drift, so the two overlapping makes both verdicts unsafe. Wait for it and re-run; ' +
      'this refusal never sleeps.',
  };
}

/** The story-run side: refuse while the full suite holds its lock. */
export function suiteLockVerdict(env = process.env, procRoot = '/proc') {
  return overlapVerdict({
    lockPath: env[SUITE_LOCK_ENV],
    envName: SUITE_LOCK_ENV,
    thisKind: 'a story run',
    otherKind: 'a full test suite',
    procRoot,
  });
}

/** The suite side: refuse while a story run holds its lock. */
export function runLockVerdict(env = process.env, procRoot = '/proc') {
  return overlapVerdict({
    lockPath: env[RUN_LOCK_ENV],
    envName: RUN_LOCK_ENV,
    thisKind: 'the test suite',
    otherKind: 'a story run',
    procRoot,
  });
}
