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

import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync, existsSync } from 'node:fs';

/** Env name → the campaign's full-suite lock, excluded by a story run. */
export const SUITE_LOCK_ENV = 'FORGE_SUITE_LOCK';
/** Env name → the campaign's story-run lock, excluded by the test suite. */
export const RUN_LOCK_ENV = 'FORGE_RUN_LOCK';

/**
 * The exit code a refused suite carries: 75, `EX_TEMPFAIL` (sysexits.h), "try
 * again later" — and DISTINCT from 1 on purpose (T1 ruling 699). A refusal and
 * a failure are different facts, and every layer above was flattening them into
 * one word: `gate.sh` recorded `FAIL npm test (0s)`, which reads exactly like a
 * suite that ran and went red. Measured by M6-C three times in one night and by
 * M6-A three times in one afternoon; each cost a step log to learn nothing ran.
 *
 * It lives HERE rather than in `test-guard.mjs` because that file runs the
 * guard at module scope: importing it to read a constant would evaluate the
 * verdict and could `process.exit` out of whatever imported it.
 */
export const EXIT_LOCK_REFUSED = 75;

/**
 * Who the KERNEL says holds `lockPath`, and who is blocked waiting for it.
 *
 * THE FD WALK BELOW CANNOT TELL THEM APART, and that is not a subtlety — it is
 * a wrong answer with a lane's name on it. A process blocked in `flock(2)` keeps
 * the descriptor open exactly like the owner does, so `/proc/<pid>/fd` reports
 * both. Measured on 2026-09-11: `.run-lock` had A's holder, A's costed S1, and
 * MY `flock -w … true` queued behind them; the fd census named all three, D's
 * gate refusal told A's lane I was in the way, and I had already sent T1 the
 * same wrong shape twice from the same method.
 *
 * `/proc/locks` separates them. The `->` prefix marks a BLOCKED waiter:
 *
 *   7:    FLOCK ADVISORY WRITE 2667935 08:30:2313312 0 EOF   ← holder
 *   7: -> FLOCK ADVISORY WRITE 2683133 08:30:2313312 0 EOF   ← waiter
 *
 * MATCHED ON THE INODE, never on the pid or the path (D's caveat, and it is
 * right twice over): filtering by pid finds every lock that process holds
 * anywhere, and the inode is the only stable identity if the lock file is ever
 * replaced rather than truncated. `/proc/locks` gives no `cwd`, which is why
 * the fd walk stays — each source supplies exactly what the other cannot, and
 * the sentence a lane needs ("held by pid N (cwd X); K waiting") requires both.
 *
 * NARROWED BY ROW 80B: this table is no longer the source of who HOLDS a
 * lock. Measured on two kernels: a lock taken through a shared descriptor
 * whose locker has exited (`exec 8>lock; flock -n 8`) has NO row at all on
 * this WSL host, and the row survives under the EXITED pid on a standard
 * kernel (the GitHub runner). Either reading, trusted as holder truth, is
 * wrong. `lockHolders` / `lockOpeners` now classify by walking every live
 * pid's own fd + fdinfo (`fdOccupants`, below) and treat this table as
 * corroboration only. WAITERS are unaffected — a blocked `flock(2)` call's own
 * fdinfo carries no `lock:` line on this host (measured), so this table stays
 * the one place that can separate a waiter from a holder, exactly as it
 * always has.
 *
 * @returns {{holders: {pid: string}[], waiters: {pid: string}[]}|null} null when
 *   the lock file is absent — the caller distinguishes "nothing holds it" from
 *   "there is nothing to hold".
 */
function kernelLockRows(lockPath, procRoot = '/proc') {
  let ino;
  try {
    ino = statSync(lockPath).ino;
  } catch {
    return null;
  }
  let raw;
  try {
    raw = readFileSync(`${procRoot}/locks`, 'utf8');
  } catch {
    // Unreadable /proc/locks is NOT "nothing is locked". Say so by returning
    // null so the caller reports a guard that cannot check, exactly as it does
    // for a missing lock file.
    return null;
  }
  const holders = [];
  const waiters = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    // `<n>: [->] FLOCK ADVISORY WRITE <pid> <maj>:<min>:<ino> <start> <end>`
    const m = /^\s*\d+:\s*(->)?\s*\S+\s+\S+\s+\S+\s+(\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/.exec(line);
    if (m === null) continue;
    if (Number(m[3]) !== ino) continue;
    (m[1] === '->' ? waiters : holders).push({ pid: m[2] });
  }
  return { holders, waiters };
}

/** `cwd` for a pid, which `/proc/locks` does not carry. */
function cwdOf(pid, procRoot) {
  try {
    return readlinkSync(`${procRoot}/${pid}/cwd`);
  } catch {
    return null; // a process we cannot introspect is still worth naming
  }
}

/**
 * The `lock:` line inside `/proc/<pid>/fdinfo/<fd>` for one fd that has ALREADY
 * been confirmed (by `readlink`) to resolve to the lock file — row 80b's
 * instrument, and ground truth in a way `/proc/locks` is not. Measured on this
 * host: a lock taken through a shared descriptor whose locking process has
 * EXITED (`exec 8>lock; flock -n 8`) carries this line on the ancestor's own
 * fd, exactly when the lock is truly held, with NO `/proc/locks` row at all.
 *
 * THREE OUTCOMES, not two. A fd whose fdinfo vanishes between the fd census
 * and this read (`ENOENT`) is GONE — the same ordinary race every other walk
 * in this file treats as "correct to skip", never as a fact about the lock.
 * Anything else unreadable (permissions, or anything this box can throw) is
 * UNREADABLE, and the caller must NOT read that as "no lock": that is exactly
 * how "cannot check" becomes "free" (the Refusal rule this row exists to
 * enforce). A readable fdinfo with no `lock:` line is a real, positive answer:
 * this descriptor is open and not locked.
 */
function fdLockLine(procRoot, pid, fd) {
  let raw;
  try {
    raw = readFileSync(`${procRoot}/${pid}/fdinfo/${fd}`, 'utf8');
  } catch (err) {
    return { state: err && err.code === 'ENOENT' ? 'gone' : 'unreadable' };
  }
  const found = raw.split('\n').find((l) => l.startsWith('lock:'));
  return found === undefined ? { state: 'open' } : { state: 'locked', line: found.slice('lock:'.length).trim() };
}

/**
 * A `lock:` line's own shape mirrors a `/proc/locks` row minus the fd's own
 * identity: `<n>: [->] TYPE ADVISORY MODE <pid> <maj>:<min>:<ino> <start> <end>`.
 *
 * THE PID FIELD IS NOT TRUSTED. Measured on this host: it reads `0` for a lock
 * taken through a shared descriptor (heavy-slot's `exec 8>lock; flock -n 8`),
 * because a BSD flock is a property of the open file description, not of
 * whichever process's fd happens to be read. The fd's OWN pid — the
 * `/proc/<pid>` directory this line was already read from — is the holder;
 * only the inode (so a stale line naming a different file is never trusted)
 * and the `->` marker (a blocked waiter, never a holder) are read here.
 */
export function classifyFdLock(line, ino) {
  const m = /^\d+:\s*(->)?\s*\S+\s+\S+\s+\S+\s+\d+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/.exec(line);
  if (m === null || Number(m[2]) !== ino) return null; // unparseable, or names a different file
  return m[1] === '->' ? 'waiter' : 'holder';
}

/**
 * ONE walk of every LIVE pid's fd table, classifying each fd that resolves to
 * `lockPath` by ITS OWN fdinfo — never by a `/proc/locks` row (row 80b, T1
 * 1366). That table is corroboration at most: it can lose a real hold entirely
 * (this WSL host, a shared descriptor whose locker exited) or keep it under
 * the EXITED pid (a standard kernel, the GitHub runner). A live pid's own
 * fd + fdinfo is the one signal measured to be right on both.
 *
 * `lockHolders` and `lockOpeners` are both thin wrappers over this — ONE
 * walker, one classifier, so the two functions can never disagree about which
 * pid is which class (948's error was two classifiers for one walk).
 *
 * @returns {{holders,waiters,openers}: {pid,cwd}[]} | null — null when the
 *   lock path cannot be resolved, `/proc` cannot be listed, or a fd already
 *   confirmed to be the lock's own descriptor has UNREADABLE fdinfo: that fd
 *   might be the holder, so the whole census refuses rather than reporting
 *   the rest as though it were complete.
 */
function fdOccupants(lockPath, procRoot = '/proc') {
  let ino;
  try {
    ino = statSync(lockPath).ino;
  } catch {
    return null;
  }
  let target;
  try {
    target = realpathSync(lockPath);
  } catch {
    return null;
  }
  let pids;
  try {
    pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  const holders = [];
  const waiters = [];
  const openers = [];
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
      const info = fdLockLine(procRoot, pid, fd);
      if (info.state === 'gone') continue; // raced away between the two reads — honestly gone
      if (info.state === 'unreadable') return null; // this fd might be the holder; refuse rather than guess
      const cwd = cwdOf(pid, procRoot);
      if (info.state === 'open') {
        openers.push({ pid, cwd });
      } else {
        const cls = classifyFdLock(info.line, ino);
        if (cls === 'holder') holders.push({ pid, cwd });
        else if (cls === 'waiter') waiters.push({ pid, cwd });
        else openers.push({ pid, cwd }); // a lock: line that does not name THIS lock — cannot vouch for a hold
      }
      break; // one matching fd is enough to classify this pid
    }
  }
  return { holders, waiters, openers };
}

/**
 * Processes holding the DESCRIPTOR with no fdinfo `lock:` line naming this
 * file — the third class (T1 743, D's measurement), now read by `fdOccupants`
 * above rather than a second walk.
 *
 * `exec 9>lock; flock 9` OPENS BEFORE IT LOCKS. D reproduced the window in four
 * lines: `( exec 9>"$T"; sleep 3 ) &` gives `/proc/locks` zero rows while
 * `fuser` names the pid. A process merely holding the file open is not holding
 * the lock, and calling it a holder is how the original defect read. They are
 * named as what they are, and the verdict still REFUSES on them, because
 * refusing inside the pre-flock window is the safe direction.
 *
 * @returns {{pid,cwd}[]|null} null when `lockPath` cannot be resolved or the
 *   census could not vouch for a fd that IS the lock's own descriptor.
 */
export function lockOpeners(lockPath, procRoot = '/proc') {
  const occ = fdOccupants(lockPath, procRoot);
  return occ === null ? null : occ.openers;
}

/** Processes BLOCKED waiting for `lockPath` — never the ones holding it.
 *  UNCHANGED by row 80b: a blocked `flock(2)` call's own fdinfo carries no
 *  `lock:` line on this host (measured), so `/proc/locks`'s `->` rows remain
 *  the one instrument that can see a waiter at all. */
export function lockWaiters(lockPath, procRoot = '/proc') {
  const rows = kernelLockRows(lockPath, procRoot);
  if (rows === null) return existsSync(lockPath) ? [] : null;
  return rows.waiters.map((w) => ({ pid: w.pid, cwd: cwdOf(w.pid, procRoot) }));
}

/**
 * The one sentence a lane needs to choose between waiting and investigating.
 *
 * Waiters are COUNTED, not named: naming them is what sent D to my lane for a
 * process that was itself queued. A reader acts on who holds; how many wait
 * tells them how long the queue is, and nothing more.
 */
export function describeLockOccupants(holders, waiters, openers = []) {
  if (holders.length === 0 && waiters.length === 0 && openers.length === 0) return 'nothing holds it';
  const parts = [];
  if (holders.length > 0) {
    parts.push(holders.map((h) => `held by pid ${h.pid} (cwd ${h.cwd ?? '<unreadable>'})`).join(', '));
  }
  // Openers ARE named, unlike waiters. A waiter is queued behind a holder and a
  // reader can do nothing about it; an open-not-locked process is either inside
  // the pre-flock window (about to hold) or leaking a descriptor it never
  // locked — and those need chasing, so the reader needs the pid.
  if (openers.length > 0) {
    parts.push(`${openers.map((o) => `pid ${o.pid} (cwd ${o.cwd ?? '<unreadable>'})`).join(', ')} has it open but NOT locked`);
  }
  if (parts.length === 0) parts.push('nothing holds it');
  return waiters.length === 0 ? parts.join('; ') : `${parts.join('; ')}; ${waiters.length} waiting`;
}

/**
 * Who HOLDS `lockPath` — row 80b's fix. A LIVE pid with a fd that `readlink`s
 * to the lock file AND whose `/proc/<pid>/fdinfo/<fd>` carries a `lock:` line
 * naming the lock's inode, not prefixed `->`, IS the holder. `/proc/locks`
 * (`kernelLockRows`) is never consulted here any more: it is the table that
 * went blind on this WSL host (a shared descriptor whose locker exited leaves
 * NO row) and misleading on a standard kernel (the same shape keeps a row
 * under the EXITED pid) — see `kernelLockRows`'s own doc for both measurements.
 * A process that merely has the descriptor open with no `lock:` line is
 * `lockOpeners`' class, not this one (T1 743).
 *
 * @returns {{pid,cwd}[]|null} null when `lockPath` does not exist or cannot be
 *   resolved, or the census could not vouch for a fd that IS the lock's own
 *   descriptor — never `[]` standing in for "cannot check".
 */
export function lockHolders(lockPath, procRoot = '/proc') {
  if (!existsSync(lockPath)) return null;
  const occ = fdOccupants(lockPath, procRoot);
  return occ === null ? null : occ.holders;
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
  if (holders === null) {
    // NAMED, never silent. The guard is configured and cannot do its job.
    // Two distinct causes now share this branch (row 80b widened it): the
    // path it was told to watch does not exist — a stale campaign dir, a
    // typo, a resolve site that changed — or the path DOES exist but a fd
    // already confirmed to be its own descriptor has unreadable fdinfo, so
    // the census cannot vouch for the rest either. Saying "does not exist"
    // for the second cause would be a claim this branch is not entitled to
    // make, which is exactly the shape the Refusal rule exists to close.
    // Either way work proceeds (an unconfigured checkout must still be able
    // to run) but the verdict says exactly what is NOT being enforced.
    const missing = !existsSync(lockPath);
    return {
      ok: true,
      reason: missing
        ? `overlap guard CANNOT CHECK: ${envName} names ${lockPath}, which does not exist, so ` +
          `${thisKind} is NOT excluded from ${otherKind}. A campaign lock is created by its first ` +
          'holder and persists, so a missing one means the path is wrong rather than idle.'
        : `overlap guard CANNOT CHECK: ${envName} names ${lockPath}, which exists but a descriptor ` +
          `on it could not be classified (unreadable /proc), so ${thisKind} is NOT excluded from ` +
          `${otherKind}.`,
    };
  }
  // All THREE classes refuse. A waiter means someone is queued for the same
  // exclusion; an open-not-locked process is inside the pre-flock window or
  // leaking a descriptor. Either way the lock is not free, and a guard that
  // only counted kernel holders would start a run in the window D measured.
  const waitersNow = lockWaiters(lockPath, procRoot) ?? [];
  const openersNow = lockOpeners(lockPath, procRoot) ?? [];
  if (holders.length === 0 && waitersNow.length === 0 && openersNow.length === 0) {
    return { ok: true, reason: `overlap ok — nothing holds ${lockPath}` };
  }
  // 7.6.33: the refusal names the HOLDER and COUNTS the waiters. It used to
  // list both undifferentiated, so a lane queued behind the real holder was
  // reported as being in the way — which sent D to my lane for a process that
  // was itself waiting, while the lane actually holding the lock went unnamed.
  const who = describeLockOccupants(holders, waitersNow, openersNow);
  return {
    ok: false,
    reason:
      `refusing to start ${thisKind}: ${otherKind} holds ${lockPath} — ${who}. ` +
      'The suite writes into projects/, which a story run hashes before and after to prove its ground ' +
      'did not drift, so the two overlapping makes both verdicts unsafe. Wait for it and re-run; ' +
      'this refusal never sleeps.',
  };
}

/**
 * The story-run side: refuse while the full suite holds its lock.
 *
 * T1 ruling 1211(b). The launch recipe is `flock .suite-lock flock .run-lock
 * … npm run stories`: the SUITE-lock is taken FIRST, by this run's own
 * ancestor, before `npm run stories` (and this module) ever starts. So while
 * that hold stands, every full suite queued behind it is correctly blocked —
 * but the same hold, read blind, looks to THIS run like a full suite in its
 * own way, and refuses a run that was never racing anything. The exemption
 * checks the kernel holders before delegating so an unconfigured or
 * unresolvable lock path still falls straight through to `overlapVerdict`
 * and keeps its existing reasons unchanged; it names the ancestor pid, never
 * a bare "ok", so the reason still says why waiters do not matter here.
 *
 * ROW 80B COLLAPSED THIS TO ONE RULE. `holders` now comes from `lockHolders`'
 * fdinfo walk, which correctly names the ancestor for heavy-slot's exact shape
 * (`exec 8>lock; flock -n 8`) on BOTH kernels measured — the WSL host that
 * used to leave `/proc/locks` empty and the standard kernel that used to keep
 * the row under the EXITED flock pid. Naming the ancestor is therefore always
 * the FIRST branch's job now; the second branch that used to paper over
 * `lockHolders`' blind spot with an opener check plus a fresh `flock -n`
 * probe is deleted along with the blind spot it existed to patch. When
 * `lockHolders` genuinely cannot classify (unreadable fdinfo on a fd that IS
 * the lock's own descriptor) it returns `null`, this function falls straight
 * through, and `overlapVerdict` reports CANNOT CHECK rather than inventing an
 * exemption from a probe that could just as easily be racing the same fd.
 */
export function suiteLockVerdict(env = process.env, procRoot = '/proc', selfPid = process.pid) {
  const lockPath = env[SUITE_LOCK_ENV];
  if (lockPath) {
    const holders = lockHolders(lockPath, procRoot);
    if (holders !== null) {
      const ancestors = ancestorPids(selfPid, { procRoot });
      const mine = holders.find((h) => ancestors.has(h.pid));
      if (mine) {
        return Object.freeze({
          ok: true,
          reason:
            `${lockPath} is held by pid ${mine.pid}, this story run's OWN ANCESTOR — the launch recipe ` +
            "takes the suite-lock first in the run's own process tree, so anything else waiting on it " +
            "is blocked by THIS run's hold, not the other way round; refusing here would refuse a run " +
            'for a queue only its own ancestor is causing.',
        });
      }
    }
  }
  return overlapVerdict({
    lockPath,
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

/**
 * THE ORDER CHECK — refuses a launch that holds the run-lock without ALSO
 * holding the suite-lock, both via THIS PROCESS'S OWN ANCESTRY.
 *
 * Finding row 73 (2026-09-19 14:5x): a story-replica launcher took the
 * run-lock and then queued for the suite-lock — the reverse of
 * `with-locks.sh`'s ratified order (suite first, run-lock inside it). A build
 * meanwhile held the suite-lock and waited on the run-lock: deadlock, nine
 * suites queued behind it, bounded only by `flock -w 900`.
 *
 * ANCESTRY, NEVER MERE PRESENCE. `runLockVerdict` above already refuses a
 * suite that starts while a STRANGER holds the run-lock — a different fact
 * from THIS launch holding it. A run-lock some other lane's process holds is
 * that guard's territory, left untouched here: this check fires only when one
 * of `selfPids` — this process's own ancestor chain (`ancestorPids`) — is
 * itself a run-lock holder, which is the shape a launch produces by taking
 * the run-lock and then spawning the story runner as its own descendant
 * (directly, or through `with-locks.sh <campaign> run --`, or a launcher that
 * bypasses both and takes the lock by hand — the incident's own shape, opaque
 * to any check that only reads command words).
 *
 * A launch with NEITHER lock set is unaffected: today's costless local runs
 * and CI's smoke/proof keep running exactly as before. A launch holding only
 * the suite-lock is fine too — suite-then-run is the point, not a mandate
 * that every run go through the wrapper.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} procRoot
 * @param {Set<string>} selfPids  this process's own ancestor chain (`ancestorPids`)
 * @returns {{ok: boolean, reason: string}}
 */
export function lockOrderVerdict(env = process.env, procRoot = '/proc', selfPids = ancestorPids(process.pid, { procRoot })) {
  const runLockPath = env[RUN_LOCK_ENV];
  if (!runLockPath) {
    return { ok: true, reason: `lock order ok — ${RUN_LOCK_ENV} names no lock, so this launch holds none` };
  }
  const runHolders = lockHolders(runLockPath, procRoot) ?? [];
  const runHeldBySelf = runHolders.some((h) => selfPids.has(String(h.pid)));
  if (!runHeldBySelf) {
    // Not held by THIS launch's own ancestry — a stranger's hold, or nobody's,
    // is runLockVerdict's fact to report, not this check's to reinterpret.
    return {
      ok: true,
      reason: `lock order ok — ${RUN_LOCK_ENV} (${runLockPath}) is not held by this launch's own ancestry`,
    };
  }
  const suiteLockPath = env[SUITE_LOCK_ENV];
  const suiteHolders = suiteLockPath ? (lockHolders(suiteLockPath, procRoot) ?? []) : [];
  const suiteHeldBySelf = suiteHolders.some((h) => selfPids.has(String(h.pid)));
  if (suiteHeldBySelf) {
    return {
      ok: true,
      reason: `lock order ok — this launch holds both ${SUITE_LOCK_ENV} (${suiteLockPath}) and ${RUN_LOCK_ENV} (${runLockPath})`,
    };
  }
  return {
    ok: false,
    reason:
      `refusing to start: this launch holds ${RUN_LOCK_ENV} (${runLockPath}) but not ${SUITE_LOCK_ENV} ` +
      `(${suiteLockPath || 'not set'}) — suite-lock first, run-lock inside it, is the one ratified order, ` +
      'and a launch holding only the run-lock is exactly the shape that can wait for the suite-lock while ' +
      'holding the run-lock. Launch through `with-locks.sh <campaign> both -- <cmd>`.',
  };
}

/*
 * 7.6.93's two pure halves live HERE, not in `lock-state.mjs`, for the reason
 * `test-guard.mjs` records at the top of itself: **importing a CLI runs it.**
 * `lock-state.mjs` evaluates `process.argv` at module scope, so a door that
 * imported it to reach one function printed the usage line and exited 2 —
 * taking the whole test file with it. This module is pure and already imported
 * everywhere, which is exactly why A moved `EXIT_LOCK_REFUSED` here when the
 * same hazard bit them.
 */
/**
 * Every pid from this process up to init — `save-instrument.sh`'s `self_chain`,
 * ported, and the exclusion `who-runs` needs.
 *
 * `process.pid` ALONE IS NOT ENOUGH, and the reason is this tool's own shape. A
 * caller runs `lock-state who-runs /abs/path/x.sh`, so **the absolute path being
 * searched for sits in the invoker's own argv**. The shim `exec`s, which removes
 * one hop — but `save-instrument.sh`, or any wrapper that passed the path along,
 * is still an ancestor carrying the needle. Excluding only this process reports
 * the caller as a process executing the target.
 *
 * That is the sixth costume of one error in this campaign and the first found
 * BEFORE the code: five `/proc` censuses matched their own command line, one
 * orphan-kill under-matched, and each time the cause was guessing what a command
 * line looks like instead of reading one.
 *
 * `procRoot` IS A PARAMETER, and not for symmetry: this walk ALWAYS adds `'1'`
 * before it terminates, so a fixture `/proc` tree with a `1/` row would have that
 * row silently excluded by a real ancestor chain. `whoRuns` therefore derives its
 * default `self` from the SAME `procRoot` it scans — the exclusion set and the
 * census must read one tree, or the seam that makes this module doorable quietly
 * eats a fixture's rows (A's R3: a thin fixture fences off a seam while every
 * door around it stays green).
 *
 * `PPid:` from `/proc/<pid>/status`, never field 4 of `stat` split from the left
 * — a `comm` can contain spaces and parentheses, and that parse returned the
 * literal `S` when this lane first wrote it. The 64-hop bound is not decoration:
 * a walk that trusts the chain to terminate wedges on a cycle it should never
 * see.
 */
export function ancestorPids(startPid = process.pid, { procRoot = '/proc' } = {}) {
  const out = new Set();
  let p = String(startPid);
  for (let guard = 0; guard < 64; guard += 1) {
    if (p === '' || p === '0') break;
    out.add(p);
    if (p === '1') break;
    let next = null;
    try {
      const m = /^PPid:\s+(\d+)/m.exec(readFileSync(`${procRoot}/${p}/status`, 'utf8'));
      next = m === null ? null : m[1];
    } catch { /* vanished mid-walk: the chain ends here, honestly */ }
    if (next === null) break;
    p = next;
  }
  return out;
}

/**
 * Who is EXECUTING `absPath` — 7.6.93's mode, delegating its per-pid facts to
 * the same helpers `who-holds` uses so there is one reader and one walker.
 *
 * THE FILTER IS THE ABSOLUTE PATH (7.6.90). A bare name matches a sibling's copy
 * in another worktree, and resolving a RELATIVE argument against the caller's
 * cwd is a guess about which tree was meant — so a relative argument is refused
 * rather than resolved.
 *
 * VANISHED AND UNREADABLE ARE KEPT APART. A pid whose directory is gone between
 * the listing and the read is correct to skip; one that EXISTS and cannot be
 * read is UNKNOWN and is reported, because a census that silently drops what it
 * could not see reports a clean box (§15.504).
 */
export function whoRuns(absPath, { procRoot = '/proc', self = ancestorPids(process.pid, { procRoot }) } = {}) {
  const rows = [];
  const unknown = [];
  let pids;
  try {
    pids = readdirSync(procRoot).filter((n) => /^[0-9]+$/.test(n));
  } catch (err) {
    return { ok: false, rows, unknown, reason: `${procRoot} could not be read (${err?.code ?? err}) — refusing rather than reporting nobody` };
  }
  for (const pid of pids) {
    if (self.has(pid)) continue;
    let cmd;
    try {
      cmd = readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8');
    } catch {
      // Vanished vs unreadable, kept apart exactly as `save-instrument.sh` does.
      try {
        readFileSync(`${procRoot}/${pid}/status`, 'utf8');
        unknown.push(pid);
      } catch { /* genuinely gone — correct to skip */ }
      continue;
    }
    if (!cmd.split('\0').some((tok) => tok === absPath) && !cmd.replace(/\0/g, ' ').includes(absPath)) continue;
    let cwd = null;
    try { cwd = readlinkSync(`${procRoot}/${pid}/cwd`); } catch { /* unreadable cwd is not a reason to drop the row */ }
    rows.push({ pid, cwd, cmd: cmd.replace(/\0/g, ' ').trim() });
  }
  return { ok: true, rows, unknown, reason: '' };
}

/**
 * `who-runs`'s THREE-STATE exit, pure and here rather than inline in the CLI so
 * it can be doored without a real `/proc`.
 *
 * It was written inline as `rows.length > 0 ? 3 : 0`, which spells UNKNOWN as 0
 * — "nobody runs it" — directly under a comment promising the opposite. A
 * mapping that lives in the branch it decides is a mapping nothing can test, and
 * this one was wrong for as long as it was untestable.
 */
export function whoRunsExit({ rows = [], unknown = [] } = {}) {
  if (rows.length > 0) return 3;
  return unknown.length > 0 ? 4 : 0;
}
