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
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

import { lockHolders, lockWaiters, describeLockOccupants, suiteLockVerdict, runLockVerdict, SUITE_LOCK_ENV, RUN_LOCK_ENV, EXIT_LOCK_REFUSED } from './lock-guard.mjs';

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

test('a holder is found by FD and named with its pid and cwd — never by matching a command string', () => {
  const lock = heldLock();
  try {
    const holders = lockHolders(lock.path);
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

test('a CANNOT-CHECK verdict names the path and what it is therefore not enforcing', () => {
  const lock = heldLock();
  lock.release();
  const v = suiteLockVerdict({ [SUITE_LOCK_ENV]: lock.path });
  assert.equal(v.ok, true, 'an unresolvable path must not block work — a checkout with a bad path still runs');
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

    assert.equal(held.length, 1, `exactly one process HOLDS it: ${JSON.stringify(held)}`);
    assert.equal(String(held[0].pid), String(holder.pid), 'and it is the one that got there first');
    assert.equal(waiting.length, 1, `and exactly one is WAITING: ${JSON.stringify(waiting)}`);
    assert.equal(String(waiting[0].pid), String(waiter.pid));
    assert.ok(held[0].cwd !== undefined, 'cwd still comes from /proc/<pid>/cwd — /proc/locks does not carry it');
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
