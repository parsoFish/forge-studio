/**
 * Row 80b (T1 1366) — a lock's holders are named by `/proc/<pid>/fdinfo/<fd>`,
 * never by a `/proc/locks` row. Measured on two kernels:
 *
 *   - WSL, this host: a flock taken through a shared descriptor whose locking
 *     process has exited (heavy-slot: `exec 8>lock; flock -n 8`) has NO
 *     `/proc/locks` row. "No row" used to read as "free".
 *   - Standard kernel, the GitHub runner: the row stays, under the EXITED
 *     locker's pid. A dead listed pid used to read as "the holder".
 *
 * Ground truth on both: a LIVE pid's fd whose `readlink` resolves to the lock
 * file, and whose fdinfo carries a `lock:` line naming the lock's inode and
 * not prefixed `->`, IS the holder — independent of anything `/proc/locks`
 * says. This file fixtures that fdinfo shape directly (a real kernel cannot be
 * told to keep or drop a `/proc/locks` row on demand, so the two-kernel split
 * is otherwise untestable), plus two REAL-process doors for the shapes that
 * matter operationally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, statSync, chmodSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { lockHolders, lockOpeners, classifyFdLock, overlapVerdict } from './lock-guard.mjs';

type FdKind = 'holder' | 'waiter' | 'open' | 'unreadable' | 'wrongIno';

/**
 * A fixture `/proc`: a real lock file (for a real inode) plus one fd per spec,
 * each a symlink resolving to that file, backed by an `fdinfo` file shaped for
 * the kind under test. `unreadable` is a REAL permission failure (chmod 0),
 * not a missing file — a fixture that merely omitted the file would test
 * ENOENT ("vanished mid-walk"), a different, already-handled case.
 */
function buildFixture(fds: Array<{ pid: string; fd?: string; kind: FdKind }>, locksBody = ''): { dir: string; lock: string; proc: string; ino: number } {
  const dir = mkdtempSync(join(tmpdir(), 'lg-fdinfo-'));
  const lock = join(dir, '.lock');
  writeFileSync(lock, '');
  const ino = statSync(lock).ino;
  const target = realpathSync(lock);
  const proc = join(dir, 'proc');
  mkdirSync(proc);
  writeFileSync(join(proc, 'locks'), locksBody);
  for (const spec of fds) {
    const fd = spec.fd ?? '8';
    mkdirSync(join(proc, spec.pid, 'fd'), { recursive: true });
    symlinkSync(target, join(proc, spec.pid, 'fd', fd));
    const fdinfoDir = join(proc, spec.pid, 'fdinfo');
    mkdirSync(fdinfoDir, { recursive: true });
    const fdinfoFile = join(fdinfoDir, fd);
    const base = 'pos:\t0\nflags:\t0100000\nmnt_id:\t1\nino:\t1\n';
    if (spec.kind === 'unreadable') {
      writeFileSync(fdinfoFile, base);
      chmodSync(fdinfoFile, 0o000); // a REAL EACCES for this non-root owner — measured, not assumed
    } else if (spec.kind === 'open') {
      writeFileSync(fdinfoFile, base);
    } else if (spec.kind === 'holder') {
      // Measured shape (heavy-slot): the embedded pid can read `0` even for a
      // LIVE holder — this file never trusts that field, only the inode + `->`.
      writeFileSync(fdinfoFile, `${base}lock:\t1: FLOCK  ADVISORY  WRITE 0 08:30:${ino} 0 EOF\n`);
    } else if (spec.kind === 'waiter') {
      writeFileSync(fdinfoFile, `${base}lock:\t1: -> FLOCK  ADVISORY  WRITE 0 08:30:${ino} 0 EOF\n`);
    } else if (spec.kind === 'wrongIno') {
      writeFileSync(fdinfoFile, `${base}lock:\t1: FLOCK  ADVISORY  WRITE 0 08:30:999999999 0 EOF\n`);
    }
  }
  return { dir, lock, proc, ino };
}

test('FIXTURE a: no /proc/locks row + a live fd with a lock: line = HOLDER (this WSL host\'s shape)', () => {
  const f = buildFixture([{ pid: '90501', kind: 'holder' }], '');
  try {
    assert.deepEqual(lockHolders(f.lock, f.proc)?.map((h) => h.pid), ['90501']);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('FIXTURE b: a /proc/locks row naming a DEAD pid never makes it a holder; the LIVE fd\'s pid does (the GitHub-runner shape)', () => {
  const f = buildFixture([{ pid: '90502', kind: 'holder' }], '');
  // 99999 has no /proc/99999 directory anywhere in this fixture: the flock
  // binary that took the lock and exited, exactly as the CI runner keeps it.
  writeFileSync(join(f.proc, 'locks'), `1: FLOCK  ADVISORY  WRITE 99999 08:30:${f.ino} 0 EOF\n`);
  try {
    const holders = lockHolders(f.lock, f.proc);
    assert.deepEqual(holders?.map((h) => h.pid), ['90502'], `the dead row must not leak in: ${JSON.stringify(holders)}`);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('FIXTURE c: a live fd with NO lock: line is an OPENER, never a holder', () => {
  const f = buildFixture([{ pid: '90503', kind: 'open' }]);
  try {
    assert.deepEqual(lockHolders(f.lock, f.proc), []);
    assert.deepEqual(lockOpeners(f.lock, f.proc)?.map((o) => o.pid), ['90503']);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('FIXTURE d: a `->` fdinfo lock line is a WAITER — excluded from both holders and openers', () => {
  const f = buildFixture([{ pid: '90504', kind: 'waiter' }]);
  try {
    assert.deepEqual(lockHolders(f.lock, f.proc), [], 'a waiter is never a holder');
    assert.deepEqual(lockOpeners(f.lock, f.proc), [], 'nor is it merely open — it is queued');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('classifyFdLock: the `->` marker is the only thing that separates a waiter from a holder; the embedded pid is never trusted', () => {
  assert.equal(classifyFdLock('1: FLOCK  ADVISORY  WRITE 0 08:30:12345 0 EOF', 12345), 'holder');
  assert.equal(classifyFdLock('1: -> FLOCK  ADVISORY  WRITE 0 08:30:12345 0 EOF', 12345), 'waiter');
  assert.equal(classifyFdLock('1: FLOCK  ADVISORY  WRITE 0 08:30:12345 0 EOF', 99999), null, 'a line naming a different inode cannot vouch for THIS lock');
  assert.equal(classifyFdLock('garbage', 12345), null, 'unparseable is never silently a holder');
});

test('FIXTURE e: UNREADABLE fdinfo on a fd that IS the lock\'s own descriptor — cannot check, never free', () => {
  const f = buildFixture([{ pid: '90505', kind: 'unreadable' }]);
  try {
    assert.equal(lockHolders(f.lock, f.proc), null, 'the census must refuse rather than report the rest as complete');
    assert.equal(lockOpeners(f.lock, f.proc), null);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('m7-d-guard-unknown-audit.md row 12: overlapVerdict CANNOT CHECK REFUSES, and must not claim the path "does not exist" when it plainly does', () => {
  const f = buildFixture([{ pid: '90506', kind: 'unreadable' }]);
  try {
    const v = overlapVerdict({
      lockPath: f.lock, envName: 'FORGE_SUITE_LOCK', thisKind: 'a story run', otherKind: 'a full test suite', procRoot: f.proc,
    });
    assert.equal(v.ok, false, 'an unreadable fd means the guard cannot vouch that nothing overlaps — REFUSE, never proceed on UNKNOWN');
    assert.match(v.reason, /CANNOT CHECK/);
    assert.doesNotMatch(v.reason, /does not exist/, 'the path is right there — that sentence would be a lie the Refusal rule forbids');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('REAL: heavy-slot\'s exact shape names the bash ancestor as holder directly, no probe needed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lg-fdinfo-real-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  const bash = spawn('bash', ['-c', `exec 8>"${lock}"; flock -n 8 || exit 9; sleep 20`], { stdio: 'ignore' });
  try {
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    const holders = lockHolders(lock);
    assert.deepEqual(holders?.map((h) => h.pid), [String(bash.pid)], `the ancestor bash must be named directly: ${JSON.stringify(holders)}`);
  } finally {
    bash.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REAL: a plain `flock lock cmd` names the flock pid as a holder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lg-fdinfo-real2-'));
  const lock = join(dir, '.lock');
  writeFileSync(lock, '');
  const holder = spawn('flock', [lock, 'sleep', '20'], { stdio: 'ignore' });
  try {
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    const holders = lockHolders(lock);
    const pids = holders?.map((h) => h.pid) ?? [];
    // Measured: `flock LOCK CMD ARGS` (no `-c`) forks — the flock binary itself
    // calls flock(2), then forks a CHILD that execs "sleep", inheriting the
    // locked fd. Both pids therefore reference the SAME open file description
    // and both carry the `lock:` line in their own fdinfo — the identical
    // shared-descriptor shape heavy-slot exercises, just with two live
    // processes instead of one live + one exited. Asserting the singleton
    // array here would penalise the new rule for seeing a second, equally
    // real holder that a `/proc/locks`-row view (one row, one pid) could not.
    assert.ok(pids.includes(String(holder.pid)), `the flock pid must be named among the holders: ${JSON.stringify(pids)}`);
  } finally {
    holder.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
