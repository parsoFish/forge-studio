/**
 * lock-guard-unknown.test.ts — m7-d-guard-unknown-audit.md rows 13 and 14,
 * ROW 102a (T1 1512/1520, M7-COMMON §6.15): a guard's catch returns explicit
 * UNKNOWN; the caller fails CLOSED with a NAMED line.
 *
 * Row 12 (overlapVerdict REFUSES on a null census) is doored in place in
 * `lock-guard.test.ts`, `lock-guard-fdinfo.test.ts` and
 * `lock-guard-invisible-hold.test.ts` — the three existing CANNOT-CHECK
 * doors, flipped from `ok: true` to `ok: false`.
 *
 * ROW 13's FIRST-DRAFT FIX ("any per-pid `fd` readdir failure refuses the
 * whole census") reds 12 of this file's OWN 33 doors the instant it runs
 * against a real `/proc`: this box carries 90+ pids this uid cannot
 * introspect at all, and NOT ONLY foreign-uid ones — `ssh-agent` and
 * `(sd-pam)`, both this uid, both measured EACCES on `/proc/<pid>/fd`,
 * because they call `PR_SET_DUMPABLE(0)` on themselves for their own
 * security and are ubiquitous on any real interactive box. Neither class is
 * distinguishable from a genuine unverifiable holder by uid or any other
 * `/proc` metadata short of the very read that is failing. The fix actually
 * shipped corroborates against `/proc/locks` (row 80b's "corroboration
 * only" role, used here for exactly the fact it can still supply: a NAME on
 * this exact inode) and refuses ONLY when an unintrospectable pid is named
 * there for THIS lock's inode — never for ordinary background noise.
 *
 * ROW 14 gives `ancestorPids` the same ENOENT/else split
 * `reap-census.mjs`'s `readPpid` already uses for the identical collapse in
 * a sibling ppid walk (its own MUST 3), and teaches `lockOrderVerdict` to
 * refuse rather than read a null census or a truncated ancestry as "not held
 * by me".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, statSync, realpathSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  lockHolders, lockOpeners, ancestorPids, lockOrderVerdict, RUN_LOCK_ENV, SUITE_LOCK_ENV,
} from './lock-guard.mjs';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function fixtureLock(): { path: string; ino: number; dir: string } {
  const dir = tmp('lg-unknown-lock-');
  const path = join(dir, '.lock');
  writeFileSync(path, '');
  return { path, ino: statSync(path).ino, dir };
}

/** A pid whose `fd` directory itself cannot be read — the row 13 shape. Real
 *  chmod, exactly as `reap-census.test.ts` uses for its own REAL EACCES: the
 *  OS enforces this even for the owning user (measured, never assumed). */
function unreadableFdPid(procRoot: string, pid: string) {
  const fdDir = join(procRoot, pid, 'fd');
  mkdirSync(fdDir, { recursive: true });
  chmodSync(fdDir, 0o000);
}

/** One `/proc/locks` row naming `pid` on `ino`. */
function locksRow(ino: number, pid: string, waiter = false): string {
  return `1: ${waiter ? '-> ' : ''}FLOCK  ADVISORY  WRITE ${pid} 08:30:${ino} 0 EOF\n`;
}

/** A REAL fd + fdinfo holder row on `lockPath`, the shape `lockHolders`
 *  actually reads (mirrors `lock-guard.test.ts`'s own `fixtureProcRoot`).
 *  `fd` defaults to `8` and must be given a distinct value when the SAME pid
 *  holds a second lock in the same fixture. */
function realHolder(procRoot: string, pid: string, lockPath: string, fd = '8') {
  const ino = statSync(lockPath).ino;
  const target = realpathSync(lockPath);
  mkdirSync(join(procRoot, pid, 'fd'), { recursive: true });
  symlinkSync(target, join(procRoot, pid, 'fd', fd));
  const fdinfoDir = join(procRoot, pid, 'fdinfo');
  mkdirSync(fdinfoDir, { recursive: true });
  writeFileSync(join(fdinfoDir, fd), `pos:\t0\nflags:\t0100000\nmnt_id:\t1\nino:\t1\nlock:\t1: FLOCK  ADVISORY  WRITE 0 08:30:${ino} 0 EOF\n`);
}

// -------------------------------------------------------------- row 13

describe('fdOccupants (via lockHolders/lockOpeners) — row 13: refuse ONLY when named on THIS lock', () => {
  test('RED: an unreadable fd dir named a HOLDER of this inode in /proc/locks refuses the census', () => {
    const lock = fixtureLock();
    const procRoot = tmp('lg-unknown-proc-');
    writeFileSync(join(procRoot, 'locks'), locksRow(lock.ino, '90601'));
    unreadableFdPid(procRoot, '90601');
    try {
      assert.equal(lockHolders(lock.path, procRoot), null, 'named on this inode and unverifiable — must refuse, not skip');
      assert.equal(lockOpeners(lock.path, procRoot), null);
    } finally {
      chmodSync(join(procRoot, '90601', 'fd'), 0o755);
      rmSync(lock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('RED: an unreadable fd dir named a WAITER of this inode also refuses', () => {
    const lock = fixtureLock();
    const procRoot = tmp('lg-unknown-proc-');
    writeFileSync(join(procRoot, 'locks'), locksRow(lock.ino, '90602', true));
    unreadableFdPid(procRoot, '90602');
    try {
      assert.equal(lockHolders(lock.path, procRoot), null);
    } finally {
      chmodSync(join(procRoot, '90602', 'fd'), 0o755);
      rmSync(lock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('control (the fix itself): an unreadable fd dir NOT named on this inode is ordinary noise — proceeds exactly like today', () => {
    // Measured shape: `ssh-agent`/`(sd-pam)`/root's own daemons, all
    // unreadable, none of them ever named on OUR temp lock's inode.
    const lock = fixtureLock();
    const procRoot = tmp('lg-unknown-proc-');
    writeFileSync(join(procRoot, 'locks'), ''); // nothing names this inode at all
    unreadableFdPid(procRoot, '90603');
    try {
      assert.deepEqual(lockHolders(lock.path, procRoot), [], 'an ordinary unintrospectable pid irrelevant to this lock must not block a real invocation');
      assert.deepEqual(lockOpeners(lock.path, procRoot), []);
    } finally {
      chmodSync(join(procRoot, '90603', 'fd'), 0o755);
      rmSync(lock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('ENOENT control: a pid with no fd/ directory at all is skipped regardless of /proc/locks', () => {
    const lock = fixtureLock();
    const procRoot = tmp('lg-unknown-proc-');
    mkdirSync(join(procRoot, '90604')); // pid dir exists, no fd/ subdir — a genuine race-vanish shape
    writeFileSync(join(procRoot, 'locks'), locksRow(lock.ino, '90604'));
    try {
      assert.deepEqual(lockHolders(lock.path, procRoot), [], 'ENOENT is genuinely gone, never refused');
    } finally {
      rmSync(lock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('RED: /proc/locks itself unreadable, with an unintrospectable pid present, refuses — cannot corroborate either way', () => {
    const lock = fixtureLock();
    const procRoot = tmp('lg-unknown-proc-');
    mkdirSync(join(procRoot, 'locks')); // a DIRECTORY where /proc/locks belongs — EISDIR on read
    unreadableFdPid(procRoot, '90605');
    try {
      assert.equal(lockHolders(lock.path, procRoot), null);
    } finally {
      chmodSync(join(procRoot, '90605', 'fd'), 0o755);
      rmSync(lock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });
});

// -------------------------------------------------------------- row 14

/** A fake `/proc/<pid>/status` carrying only the `PPid:` line `ancestorPids` reads. */
function procTree(pairs: Array<{ pid: string; ppid: string }>): string {
  const root = tmp('lg-ancestor-');
  for (const { pid, ppid } of pairs) {
    mkdirSync(join(root, pid), { recursive: true });
    writeFileSync(join(root, pid, 'status'), `Name:\tfixture\nPPid:\t${ppid}\n`);
  }
  return root;
}

describe('ancestorPids — row 14: a walk that did not reach init is DISTINGUISHABLE from one that did', () => {
  test('control: a chain that reaches init (1) carries no .truncated', () => {
    const root = procTree([{ pid: '300', ppid: '200' }, { pid: '200', ppid: '1' }]);
    try {
      const out = ancestorPids('300', { procRoot: root });
      assert.deepEqual([...out].sort(), ['1', '200', '300']);
      assert.equal((out as unknown as { truncated?: true }).truncated, undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('control: ENOENT mid-walk (an ancestor genuinely exited) is the historical, expected chain end — no .truncated', () => {
    const root = procTree([{ pid: '300', ppid: '200' }]); // 200's own status was never created
    try {
      const out = ancestorPids('300', { procRoot: root });
      // '200' is still IN the chain — 300's own PPid line names it — the
      // failure is only on trying to read 200's OWN parent one hop further.
      assert.deepEqual([...out], ['300', '200']);
      assert.equal((out as unknown as { truncated?: true }).truncated, undefined, 'ENOENT stays a normal, expected chain end');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('RED: a non-ENOENT status read failure mid-walk IS .truncated (real EACCES, mirrors reap-census.mjs MUST 3)', () => {
    const root = procTree([{ pid: '300', ppid: '200' }, { pid: '200', ppid: '1' }]);
    chmodSync(join(root, '200', 'status'), 0o000);
    try {
      const out = ancestorPids('300', { procRoot: root });
      assert.deepEqual([...out], ['300', '200'], 'both pids are named; only the read of 200\'s OWN parent failed');
      assert.equal((out as unknown as { truncated?: true }).truncated, true, 'a real EACCES must be distinguishable from "gone"');
    } finally {
      chmodSync(join(root, '200', 'status'), 0o644);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('RED: exhausting the 64-hop guard without reaching init IS .truncated', () => {
    const pairs: Array<{ pid: string; ppid: string }> = [];
    for (let i = 0; i < 70; i += 1) pairs.push({ pid: String(1000 + i), ppid: String(1000 + i + 1) });
    const root = procTree(pairs);
    try {
      const out = ancestorPids('1000', { procRoot: root });
      assert.equal((out as unknown as { truncated?: true }).truncated, true);
      assert.equal(out.size, 64, 'the bound itself is unchanged — only the flag is new');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('lockOrderVerdict — row 14: a null census or a truncated ancestry REFUSES, never reads as "no"', () => {
  test('RED: lockHolders(run-lock) === null refuses, rather than the run-lock reading as "not held by me"', () => {
    const runLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    writeFileSync(join(procRoot, 'locks'), locksRow(runLock.ino, '90701'));
    unreadableFdPid(procRoot, '90701'); // named on the run-lock's inode, unverifiable
    try {
      const v = lockOrderVerdict({ [RUN_LOCK_ENV]: runLock.path }, procRoot, new Set(['111']));
      assert.equal(v.ok, false, v.reason);
      assert.match(v.reason, /CANNOT CHECK/);
    } finally {
      chmodSync(join(procRoot, '90701', 'fd'), 0o755);
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('RED: a truncated selfPids ancestry refuses instead of reading "not held by me"', () => {
    const runLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    realHolder(procRoot, '111', runLock.path); // a real, verifiable holder — NOT in selfPids below
    writeFileSync(join(procRoot, 'locks'), '');
    const selfPids: Set<string> & { truncated?: true } = new Set(['222']);
    selfPids.truncated = true; // this launch's OWN ancestor walk did not reach init
    try {
      const v = lockOrderVerdict({ [RUN_LOCK_ENV]: runLock.path }, procRoot, selfPids);
      assert.equal(v.ok, false, v.reason);
      assert.match(v.reason, /UNKNOWN, not "no"/);
    } finally {
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('control: a truncated selfPids that DOES find itself among BOTH locks\' real holders still proceeds — truncation only matters on a NEGATIVE', () => {
    const runLock = fixtureLock();
    const suiteLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    realHolder(procRoot, '111', runLock.path, '8');
    realHolder(procRoot, '111', suiteLock.path, '9');
    writeFileSync(join(procRoot, 'locks'), '');
    const selfPids: Set<string> & { truncated?: true } = new Set(['111']);
    selfPids.truncated = true;
    try {
      const v = lockOrderVerdict({ [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path }, procRoot, selfPids);
      assert.equal(v.ok, true, v.reason);
    } finally {
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(suiteLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('control: a truncated selfPids with a GENUINELY EMPTY run-lock holder list proceeds — nothing to hide, truncated or not', () => {
    const runLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    writeFileSync(join(procRoot, 'locks'), ''); // nobody holds it, and /proc/locks corroborates nothing
    const selfPids: Set<string> & { truncated?: true } = new Set(['222']);
    selfPids.truncated = true;
    try {
      const v = lockOrderVerdict({ [RUN_LOCK_ENV]: runLock.path }, procRoot, selfPids);
      assert.equal(v.ok, true, v.reason);
    } finally {
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('RED: run-lock held by self, but suite-lock lockHolders === null refuses instead of falling to the unordered message', () => {
    const runLock = fixtureLock();
    const suiteLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    realHolder(procRoot, '111', runLock.path);
    writeFileSync(join(procRoot, 'locks'), locksRow(suiteLock.ino, '90702'));
    unreadableFdPid(procRoot, '90702'); // named on the SUITE-lock's inode, unverifiable
    try {
      const v = lockOrderVerdict(
        { [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path },
        procRoot,
        new Set(['111']),
      );
      assert.equal(v.ok, false, v.reason);
      assert.match(v.reason, /CANNOT CHECK/);
    } finally {
      chmodSync(join(procRoot, '90702', 'fd'), 0o755);
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(suiteLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('RED: run-lock held by self, suite-lock held by a REAL stranger a truncated ancestry could have missed, refuses rather than the plain unordered message', () => {
    const runLock = fixtureLock();
    const suiteLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    realHolder(procRoot, '111', runLock.path, '8');
    realHolder(procRoot, '333', suiteLock.path, '8'); // a REAL holder, not in selfPids
    writeFileSync(join(procRoot, 'locks'), '');
    const selfPids: Set<string> & { truncated?: true } = new Set(['111']);
    selfPids.truncated = true;
    try {
      const v = lockOrderVerdict(
        { [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path },
        procRoot,
        selfPids,
      );
      assert.equal(v.ok, false, v.reason);
      assert.match(v.reason, /UNKNOWN, not "no"/);
      assert.doesNotMatch(v.reason, /with-locks\.sh/, 'a truncated ancestry is a DIFFERENT fact from the ordinary unordered-launch message');
    } finally {
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(suiteLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('control: run-lock held by self, suite-lock GENUINELY not held by anyone, truncated ancestry still gives the plain unordered message', () => {
    const runLock = fixtureLock();
    const suiteLock = fixtureLock();
    const procRoot = tmp('lg-unknown-order-');
    realHolder(procRoot, '111', runLock.path, '8');
    writeFileSync(join(procRoot, 'locks'), ''); // suite-lock: nobody holds it, nothing to miss
    const selfPids: Set<string> & { truncated?: true } = new Set(['111']);
    selfPids.truncated = true;
    try {
      const v = lockOrderVerdict(
        { [RUN_LOCK_ENV]: runLock.path, [SUITE_LOCK_ENV]: suiteLock.path },
        procRoot,
        selfPids,
      );
      assert.equal(v.ok, false, v.reason);
      assert.match(v.reason, /with-locks\.sh/, 'a genuinely-empty suite lock needs no ancestry at all');
    } finally {
      rmSync(runLock.dir, { recursive: true, force: true });
      rmSync(suiteLock.dir, { recursive: true, force: true });
      rmSync(procRoot, { recursive: true, force: true });
    }
  });
});
