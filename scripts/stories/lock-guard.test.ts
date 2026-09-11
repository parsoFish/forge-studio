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
import { execFileSync } from 'node:child_process';

import { lockHolders, suiteLockVerdict, runLockVerdict, SUITE_LOCK_ENV, RUN_LOCK_ENV, EXIT_LOCK_REFUSED } from './lock-guard.mjs';

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
