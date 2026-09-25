/**
 * Bead `forge-8vfn.7.6.13` (T1 rulings 596/634) — a full suite and a story run
 * must not overlap, and each refuses the other by NAME.
 *
 * The defect was measured from lane A's fence, not from a review:
 * `fence: UNATTRIBUTABLE projects/_r4-17-dispatch-fixture-proj — appeared in
 * /home/parso/forge-m6-d while pid 1235057 was working there`. That pid was a
 * `node --test` worker. `npm test` and a story run took DIFFERENT locks, so
 * neither excluded the other, while the suite writes into `projects/` — the
 * directory a story run hashes before and after to prove its ground did not
 * drift.
 *
 * The two DOOR tests are the ones that matter, and both drive a real process:
 * a story run must refuse BEFORE booting a bridge, and the suite must refuse
 * BEFORE the first test file. A guard that refuses after either has already
 * spent the thing it exists to protect.
 *
 * Holders are found by OPEN FILE DESCRIPTOR, never by pattern (§15.344): this
 * test process opens the lock itself and then asserts the guard names IT, with
 * its own pid and cwd.
 *
 * RUN: node --experimental-strip-types --test scripts/stories/lock-guard.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

import { lockHolders, lockWaiters, lockOpeners, describeLockOccupants, suiteLockVerdict, runLockVerdict, lockOrderVerdict, SUITE_LOCK_ENV, RUN_LOCK_ENV, EXIT_LOCK_REFUSED } from './lock-guard.mjs';

const REPO = new URL('../..', import.meta.url).pathname;

/** A lock file this process holds open, exactly as `flock` would. */
function heldLock(): { path: string; release: () => void; unhold: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'lock-guard-'));
  const path = join(dir, '.some-lock');
  writeFileSync(path, 'held by a test\n');
  const fd = openSync(path, 'r');
  let closed = false;
  const unhold = () => {
    if (!closed) closeSync(fd);
    closed = true;
  };
  return {
    path,
    // `unhold` drops the HOLD and leaves the file — a real campaign lock nobody
    // is using. `release` removes the file too, which is a different state and
    // the whole point of `forge-e8dn`.
    unhold,
    release: () => {
      unhold();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// RETITLED for 7.6.33 / T1 743. This test opens the lock file and never calls
// `flock`, so the process it creates is OPEN-NOT-LOCKED — the third class D
// measured (`( exec 9>T; sleep 3 ) &` gives `/proc/locks` zero rows while
// `fuser` names the pid). It was asserted against `lockHolders` because before
// tonight there was only one class and "has the descriptor" was all we could
// see. It is `lockOpeners` now; the property it pins — found by FD, named with
// pid and cwd, never by matching a command string — is unchanged and is still
// the point.
test('an OPEN-NOT-LOCKED process is found by FD and named with its pid and cwd — never by matching a command string', () => {
  const lock = heldLock();
  try {
    const holders = lockOpeners(lock.path);
    const me = holders.find((h) => h.pid === String(process.pid));
    assert.ok(me, `this process holds ${lock.path} open, so it must be named — got ${JSON.stringify(holders)}`);
    assert.equal(me!.cwd, process.cwd(), 'the cwd comes from /proc/<pid>/cwd, which is what tells an operator WHICH tree');
  } finally {
    lock.release();
  }
});

test('an EXISTING lock nobody holds yields an empty list — a real answer about a real file', () => {
  const lock = heldLock();
  try {
    lock.unhold();
    assert.deepEqual(lockHolders(lock.path), [], 'the file is there and free: [] is the honest answer');
    assert.deepEqual(lockOpeners(lock.path), [], 'and nobody has it merely open either');
  } finally {
    lock.release();
  }
});

test('a path that is NOT a lock yields null — absence is a state, and not the same one', () => {
  const lock = heldLock();
  lock.release(); // the file is gone, not merely unheld
  assert.equal(
    lockHolders(lock.path),
    null,
    'this used to return [], byte-identical to "nobody is running" — so no observation could ' +
      'tell a free lock from a path that is not a lock, and the guard could not be falsified',
  );
});

test('m7-d-guard-unknown-audit.md row 12: a CANNOT-CHECK verdict REFUSES and names the path it could not resolve', () => {
  const lock = heldLock();
  lock.release();
  const v = suiteLockVerdict({ [SUITE_LOCK_ENV]: lock.path });
  assert.equal(v.ok, false, 'a CONFIGURED-but-missing path must refuse — CANNOT CHECK is UNKNOWN, never folded into ok:true');
  assert.match(v.reason, /CANNOT CHECK/, 'but it must say it could not check, not imply it checked');
  assert.match(v.reason, new RegExp(lock.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'and NAME the path it could not find');
  assert.equal(
    /nothing holds/.test(v.reason),
    false,
    'it must never claim nothing holds a file it could not even resolve — that sentence is the defect',
  );
});

test('a story run REFUSES while the suite lock is held, and the reason names the holder', () => {
  const lock = heldLock();
  try {
    const v = suiteLockVerdict({ [SUITE_LOCK_ENV]: lock.path });
    assert.equal(v.ok, false);
    assert.match(v.reason, new RegExp(`pid ${process.pid}`), 'the operator is told which process to wait for');
    assert.match(v.reason, /never sleeps/, 'and that this refusal does not queue');
  } finally {
    lock.release();
  }
});

test('the suite REFUSES while the run lock is held', () => {
  const lock = heldLock();
  try {
    const v = runLockVerdict({ [RUN_LOCK_ENV]: lock.path });
    assert.equal(v.ok, false);
    assert.match(v.reason, new RegExp(`pid ${process.pid}`));
  } finally {
    lock.release();
  }
});

test('NOT CONFIGURED says so out loud — a silent guard is indistinguishable from one that checked', () => {
  const v = suiteLockVerdict({});
  assert.equal(v.ok, true, 'an unconfigured checkout must still be able to run');
  assert.match(v.reason, /not configured/, 'but it must never imply an exclusion it is not enforcing');
  assert.match(v.reason, new RegExp(SUITE_LOCK_ENV), 'and must name the variable that would configure it');
});

test('DOOR: a story run refuses BEFORE booting a bridge', () => {
  const lock = heldLock();
  try {
    let stdout = '';
    let code = 0;
    try {
      stdout = execFileSync(process.execPath, ['scripts/stories/run.mjs', '--story', 'S8', '--approve-spend'], {
        cwd: REPO,
        env: { ...process.env, [SUITE_LOCK_ENV]: lock.path },
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      code = err.status ?? -1;
      stdout = err.stdout ?? '';
    }

    assert.notEqual(code, 0, 'a refused run must exit non-zero — a zero exit is a run nobody knows did not happen');
    assert.match(stdout, /refusing to start a story run/, 'and say why in one line');
    assert.equal(
      stdout.includes('booting our own bridge'),
      false,
      'the refusal must land BEFORE the bridge boots — a guard that fires after has spent what it protects',
    );
  } finally {
    lock.release();
  }
});

test('DOOR: the suite refuses BEFORE the first test file', () => {
  const lock = heldLock();
  try {
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['scripts/test-guard.mjs'], {
        cwd: REPO,
        env: { ...process.env, [RUN_LOCK_ENV]: lock.path },
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      code = err.status ?? -1;
      stderr = err.stderr ?? '';
    }

    // AMENDED by T1 ruling 699. The property this asserted — a NON-ZERO exit, so
    // `node scripts/test-guard.mjs && node --test …` never reaches the suite —
    // is unchanged. The code is now 75 (`EX_TEMPFAIL`, "try again later") and
    // DISTINCT from 1 on purpose: every layer above was flattening a refusal
    // into a failure, and `gate.sh` recorded `FAIL npm test (0s)`, which reads
    // exactly like a suite that ran and went red. Measured by M6-C three times
    // in one night and by M6-A three times in one afternoon.
    assert.equal(code, EXIT_LOCK_REFUSED, 'non-zero, so the suite is never reached — and distinct, so a refusal is not read as a failure');
    assert.match(stderr, /refusing to start the test suite/);
    assert.match(stderr, new RegExp(`pid ${process.pid}`));
  } finally {
    lock.release();
  }
});

test('7.6.33: a WAITER is not a holder — /proc/locks decides, the fd walk cannot', async () => {
  // MEASURED, not theorised. At 14:2xZ tonight `.run-lock` had three processes
  // with the file open: A's `flock -w` (holding, costed S1 live), A's story run,
  // and MY `flock -w … true` queued behind it. An fd census reported all three,
  // so D's gate refusal named me as a holder and told A's lane to wait for a
  // process that was itself waiting. I had already reported the same wrong
  // shape to T1 twice using the same method.
  //
  // A process blocked in `flock(2)` holds the descriptor open exactly like the
  // owner does. `/proc/locks` is the only source that separates them:
  //
  //   7:    FLOCK ADVISORY WRITE 2667935 08:30:2313312 0 EOF   ← holder
  //   7: -> FLOCK ADVISORY WRITE 2683133 08:30:2313312 0 EOF   ← waiter
  //
  // The `->` prefix marks a blocked waiter. Corroborated per-process by
  // `wchan` = `locks_lock_inode_wait`.
  const dir = mkdtempSync(join(tmpdir(), 'forge-lockwait-'));
  const lock = join(dir, '.run-lock');
  writeFileSync(lock, '');

  // A real holder, and a real waiter queued behind it.
  const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const waiter = spawn('flock', ['-w', '30', lock, 'true'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));

  try {
    const held = lockHolders(lock);
    const waiting = lockWaiters(lock);

    // ROW 80B WIDENED "exactly one holder" TO "at least the flock pid, honestly".
    // `lockHolders` now reads fdinfo, and `flock LOCK sleep N` (no `-c`) forks:
    // the flock binary calls flock(2) then forks a CHILD that execs "sleep",
    // inheriting the already-locked fd. Both pids reference the SAME open file
    // description and both carry a `lock:` line in their own fdinfo, so BOTH are
    // correctly named holders — measured, not assumed (`ps --ppid` confirms the
    // parent/child pair). This is a widening, not a regression: killing either
    // pid alone would leave the lock held by the other, so a reader told only
    // the old single pid could wait on a holder that was never the true barrier.
    const heldPids = held.map((h) => String(h.pid));
    assert.ok(heldPids.includes(String(holder.pid)), `the flock pid must be named a holder: ${JSON.stringify(held)}`);
    assert.equal(waiting.length, 1, `and exactly one is WAITING: ${JSON.stringify(waiting)}`);
    assert.equal(String(waiting[0].pid), String(waiter.pid));
    assert.ok(!heldPids.includes(String(waiter.pid)), 'a queued pid must never appear as a holder');
    const mine = held.find((h) => String(h.pid) === String(holder.pid));
    assert.ok(mine.cwd !== undefined, 'cwd still comes from /proc/<pid>/cwd — /proc/locks does not carry it');
  } finally {
    holder.kill('SIGKILL');
    waiter.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('7.6.33: the refusal says who holds and HOW MANY wait', () => {
  // "pid N (cwd X), pid M (cwd Y)" told a reader two lanes were in the way when
  // one was queued behind the other. What a lane needs in order to choose
  // between waiting and investigating is which is which.
  const line = describeLockOccupants(
    [{ pid: '111', cwd: '/home/parso/forge-m6-a' }],
    [{ pid: '222', cwd: '/home/parso/forge-m6-c' }, { pid: '333', cwd: '/home/parso/forge-m6-d' }],
  );
  assert.match(line, /held by pid 111 \(cwd \/home\/parso\/forge-m6-a\)/, line);
  assert.match(line, /2 waiting/, line);
  assert.doesNotMatch(line, /pid 222/, 'a waiter is counted, not named — naming it invites chasing the wrong lane');
});

test('7.6.33: no holder and no waiter reads as free, not as unknown', () => {
  assert.equal(describeLockOccupants([], []), 'nothing holds it');
});

/**
 * `lockOrderVerdict` — finding row 73 (2026-09-19 14:5x): a launcher took the
 * run-lock first and queued for the suite-lock, the reverse of `with-locks.sh`'s
 * ratified order (suite first, run inside it); a build meanwhile held the
 * suite-lock and waited on the run-lock. Deadlock.
 *
 * THE FIXTURE IS A REAL LOCK FILE (for its inode) UNDER A FAKE `/proc`. The
 * check reasons about ANCESTRY — is one of `selfPids` itself a holder — not
 * about a live `flock`, so no real process needs to actually take the lock;
 * a chosen pid's fd + fdinfo are fabricated directly, naming it a holder.
 *
 * ROW 80B: this used to fabricate ONLY a `/proc/locks` row, because
 * `lockHolders` read that table directly. It no longer does — `/proc/locks`
 * is corroboration only now, and `lockHolders` names a holder solely from a
 * live pid's own fd + fdinfo (`fdOccupants`). A fixture that populated only
 * the table `lockHolders` no longer consults could never produce a holder,
 * so every row here is now a real fd + fdinfo pair; `/proc/locks` itself is
 * left empty on purpose, to prove it plays no part.
 */
function fixtureLock(): { path: string; ino: number; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lock-order-lock-'));
  const path = join(dir, '.lock');
  writeFileSync(path, '');
  return { path, ino: statSync(path).ino, dir };
}

/** A fake `/proc`: `/proc/locks` stays EMPTY (corroboration this fixture
 *  proves unnecessary); each row gets a real fd + fdinfo `lock:` line on the
 *  named lock file, which is what `lockHolders` now actually reads. */
function fixtureProcRoot(rows: Array<{ pid: string; lockPath: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'lock-order-proc-'));
  writeFileSync(join(root, 'locks'), '');
  for (const { pid, lockPath } of rows) {
    const ino = statSync(lockPath).ino;
    const target = realpathSync(lockPath);
    mkdirSync(join(root, pid, 'fd'), { recursive: true });
    symlinkSync(target, join(root, pid, 'fd', '8'));
    const fdinfoDir = join(root, pid, 'fdinfo');
    mkdirSync(fdinfoDir, { recursive: true });
    writeFileSync(join(fdinfoDir, '8'), `pos:\t0\nflags:\t0100000\nmnt_id:\t1\nino:\t1\nlock:\t1: FLOCK  ADVISORY  WRITE 0 08:30:${ino} 0 EOF\n`);
  }
  return root;
}

test('lockOrderVerdict: run-lock held by an ancestor, suite-lock not — refused, naming the fix', () => {
  const runLock = fixtureLock();
  const suiteLock = fixtureLock();
  const procRoot = fixtureProcRoot([{ pid: '111', lockPath: runLock.path }]); // suite-lock: no fd, free
  try {
    const v = lockOrderVerdict(
      { [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path },
      procRoot,
      new Set(['111', '222']),
    );
    assert.equal(v.ok, false, v.reason);
    assert.match(v.reason, new RegExp(RUN_LOCK_ENV), 'names the lock this launch holds');
    assert.match(v.reason, new RegExp(SUITE_LOCK_ENV), 'names the lock it is missing');
    assert.match(v.reason, /with-locks\.sh <campaign> both -- <cmd>/, 'names the fix verbatim');
  } finally {
    rmSync(runLock.dir, { recursive: true, force: true });
    rmSync(suiteLock.dir, { recursive: true, force: true });
    rmSync(procRoot, { recursive: true, force: true });
  }
});

test('lockOrderVerdict: both locks held by ancestors — allowed', () => {
  const runLock = fixtureLock();
  const suiteLock = fixtureLock();
  const procRoot = fixtureProcRoot([
    { pid: '111', lockPath: runLock.path },
    { pid: '333', lockPath: suiteLock.path },
  ]);
  try {
    const v = lockOrderVerdict(
      { [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path },
      procRoot,
      new Set(['111', '333']),
    );
    assert.equal(v.ok, true, v.reason);
  } finally {
    rmSync(runLock.dir, { recursive: true, force: true });
    rmSync(suiteLock.dir, { recursive: true, force: true });
    rmSync(procRoot, { recursive: true, force: true });
  }
});

test('lockOrderVerdict: neither lock env set — allowed, today\'s costless/CI behaviour', () => {
  const v = lockOrderVerdict({}, '/nonexistent-proc-root-lockorder-test', new Set(['111']));
  assert.equal(v.ok, true, v.reason);
});

test('lockOrderVerdict: run-lock held by a STRANGER, not this launch\'s ancestry — unchanged, allowed', () => {
  const runLock = fixtureLock();
  // A pid that is nowhere in selfPids: some OTHER lane's process holds it —
  // runLockVerdict's fact to report, not this check's to reinterpret.
  const procRoot = fixtureProcRoot([{ pid: '999', lockPath: runLock.path }]);
  try {
    const v = lockOrderVerdict(
      { [RUN_LOCK_ENV]: runLock.path },
      procRoot,
      new Set(['111', '222']),
    );
    assert.equal(v.ok, true, v.reason);
  } finally {
    rmSync(runLock.dir, { recursive: true, force: true });
    rmSync(procRoot, { recursive: true, force: true });
  }
});

/**
 * T1 ruling 1211(b) — a story run that HOLDS the suite-lock itself is not in
 * anyone's way. The recipe is `flock .suite-lock flock .run-lock … npm run
 * stories`: the suite-lock is taken FIRST by the run's own ancestor, so every
 * suite queued behind it is blocked by that hold and cannot write into
 * `projects/` while the run hashes it. Refusing on those waiters made a story
 * run unstartable whenever lanes queued suites back to back (m7-d, 2026-09-19:
 * 9–11 openers at every 5-minute sample, no window for 45 minutes).
 *
 * The verdict is taken INSIDE a real `flock` hold, from a child process, with a
 * real waiter queued on the same lock — the shape the runner actually sees.
 */
function verdictInsideHold(lock: string, holdAsAncestor: boolean): Promise<{ ok: boolean; reason: string }> {
  const probe = `import('${join(REPO, 'scripts/stories/lock-guard.mjs')}').then((m) => {
    setTimeout(() => { process.stdout.write(JSON.stringify(m.suiteLockVerdict({ ${JSON.stringify(SUITE_LOCK_ENV)}: ${JSON.stringify(lock)} }))); }, 800);
  });`;
  return new Promise((resolve, reject) => {
    // Ancestor case: the probe runs UNDER the flock that holds the lock. Control
    // case: a sibling process holds it and the probe runs outside any hold.
    const holder = holdAsAncestor
      ? spawn('flock', [lock, process.execPath, '--input-type=module', '-e', probe], { stdio: ['ignore', 'pipe', 'inherit'] })
      : spawn('flock', [lock, 'sleep', '5'], { stdio: 'ignore' });
    const probeProc = holdAsAncestor ? holder : spawn(process.execPath, ['--input-type=module', '-e', probe], { stdio: ['ignore', 'pipe', 'inherit'] });
    // A real waiter, queued behind the hold before the probe reads.
    setTimeout(() => { spawn('flock', ['-w', '10', lock, 'true'], { stdio: 'ignore' }); }, 200);
    let out = '';
    probeProc.stdout!.on('data', (d) => { out += d; });
    probeProc.on('close', () => {
      if (!holdAsAncestor) holder.kill('SIGKILL');
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`probe printed no verdict: ${JSON.stringify(out)} (${e})`)); }
    });
  });
}

test('1211(b): a story run whose OWN ANCESTOR holds the suite-lock proceeds past queued waiters, and says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-selfhold-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  try {
    const v = await verdictInsideHold(lock, true);
    assert.equal(v.ok, true, `the run holds the lock itself; waiters cannot proceed while it does: ${v.reason}`);
    assert.match(v.reason, /ancestor/, 'the reason names WHY the waiters do not matter, not a bare "ok"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('1211(b) control: the SAME waiter still refuses a run when the hold belongs to someone else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-otherhold-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  try {
    const v = await verdictInsideHold(lock, false);
    assert.equal(v.ok, false, `a hold that is not this run's ancestor is a suite in the way: ${v.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
