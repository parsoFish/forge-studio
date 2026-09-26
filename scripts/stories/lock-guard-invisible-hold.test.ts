/**
 * An ancestor's hold that `/proc/locks` cannot be trusted to show (T1
 * 1352/1353/1366, M7 rows 80 and 80b).
 *
 * `heavy-slot.sh` takes the suite-lock as `exec 8>.suite-lock; flock -n 8`: the
 * external `flock` binary locks the SHARED open file description and exits.
 * The lock is real — a fresh `flock -n` fails — but `/proc/locks` cannot be
 * trusted to say so: on THIS kernel it drops the row entirely (measured 3x,
 * 2026-09-25), and on a standard kernel (the GitHub runner, #911's first CI
 * run) it keeps a row, but under the EXITED locker's pid.
 *
 * ROW 80 first closed this with a WORKAROUND: when no live holder existed,
 * check whether an ANCESTOR merely had the descriptor open, then run a fresh
 * `flock -n` PROBE to confirm the lock was still held. Two stacked signals for
 * one fact, because `lockHolders` itself could not see the ancestor's real
 * hold.
 *
 * ROW 80B REMOVES THE WORKAROUND BY FIXING THE INSTRUMENT. `lockHolders` now
 * reads `/proc/<pid>/fdinfo/<fd>` directly — ground truth for whether a
 * descriptor holds the flock, independent of `/proc/locks` and independent of
 * kernel. The ancestor's `lock:` line is present in fdinfo exactly when the
 * lock is truly held (measured on this host: present even when the pid the
 * line itself names is `0`), so `lockHolders` names the ancestor as a holder
 * DIRECTLY. `suiteLockVerdict`'s existing "OWN ANCESTOR" branch then fires on
 * its own, first try, and the opener+probe fallback below it is deleted along
 * with the blind spot it existed to patch — see `lock-guard.mjs`'s
 * `suiteLockVerdict` for that rule now stated as one branch, not two.
 *
 * WHAT THIS FILE STILL DOES: exercise the exact shapes the old workaround was
 * built for, now against the fixed instrument — an ancestor that truly holds
 * it (fdinfo `lock:` line), an ancestor that merely has it open (no `lock:`
 * line, still refused), a STRANGER who is the real holder (verified by ITS OWN
 * fd + fdinfo, never by an ancestor merely having the file open), an
 * ancestor's fdinfo that cannot be read at all (refuses rather than granting a
 * false exemption), and two REAL processes reproducing heavy-slot's exact
 * shape and a plain `flock` invocation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, statSync, chmodSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { suiteLockVerdict, SUITE_LOCK_ENV } from './lock-guard.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type FdKind = 'holder' | 'open' | 'unreadable';

/** A fake /proc: `locks` per `lockRowPid` (null = no row, the WSL shape; a
 *  string = a row naming that pid, the standard-kernel shape), self chain
 *  333 -> 222 -> 111 -> 1, sibling 444 -> 1 (NOT an ancestor of 333). `ancestor`
 *  shapes pid 111's fd 8; `stranger` shapes pid 444's fd 9 — both real fdinfo,
 *  not a `/proc/locks` row, because that row is what this fixture proves is
 *  untrustworthy. */
function invisibleHoldFixture(opts: { ancestor?: FdKind; stranger?: FdKind; lockRowPid?: string | null } = {}): { dir: string; lock: string; proc: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lg-invisible-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  const ino = statSync(lock).ino;
  const target = realpathSync(lock);
  const proc = join(dir, 'proc');
  mkdirSync(proc);
  writeFileSync(join(proc, 'locks'), opts.lockRowPid == null ? '' : `1: FLOCK  ADVISORY  WRITE ${opts.lockRowPid} 08:30:${ino} 0 EOF\n`);
  const chain: Array<[string, string]> = [['333', '222'], ['222', '111'], ['111', '1'], ['444', '1']];
  for (const [pid, ppid] of chain) {
    mkdirSync(join(proc, pid, 'fd'), { recursive: true });
    writeFileSync(join(proc, pid, 'status'), `Name:\tx\nPPid:\t${ppid}\n`);
    symlinkSync(dir, join(proc, pid, 'cwd'));
  }
  const shapeFd = (pid: string, fd: string, kind: FdKind) => {
    symlinkSync(target, join(proc, pid, 'fd', fd));
    const fdinfoDir = join(proc, pid, 'fdinfo');
    mkdirSync(fdinfoDir, { recursive: true });
    const file = join(fdinfoDir, fd);
    const base = 'pos:\t0\nflags:\t0100000\nmnt_id:\t1\nino:\t1\n';
    if (kind === 'unreadable') {
      writeFileSync(file, base);
      chmodSync(file, 0o000); // a REAL EACCES for this non-root owner
    } else if (kind === 'open') {
      writeFileSync(file, base);
    } else {
      // Measured shape: the embedded pid can read `0` even for a live holder —
      // never trusted here, only the inode + `->` are.
      writeFileSync(file, `${base}lock:\t1: FLOCK  ADVISORY  WRITE 0 08:30:${ino} 0 EOF\n`);
    }
  };
  if (opts.ancestor) shapeFd('111', '8', opts.ancestor);
  if (opts.stranger) shapeFd('444', '9', opts.stranger);
  return { dir, lock, proc };
}

const env = (lock: string) => ({ [SUITE_LOCK_ENV]: lock });

test('an ANCESTOR HOLDS the suite-lock by fdinfo — the run proceeds and the reason names it, no probe involved', () => {
  const f = invisibleHoldFixture({ ancestor: 'holder' });
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333');
    assert.equal(v.ok, true, v.reason);
    assert.match(v.reason, /ancestor/i);
    assert.match(v.reason, /pid 111/, 'names the ancestor pid directly — lockHolders found it itself');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('an ancestor with the descriptor merely OPEN (no lock: line) is not a holder — still refused', () => {
  const f = invisibleHoldFixture({ ancestor: 'open' });
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333');
    assert.equal(v.ok, false, v.reason);
    assert.match(v.reason, /open but NOT locked/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a NON-ancestor holder — verified by ITS OWN fd + fdinfo — is refused, whatever the ancestor merely has open', () => {
  const f = invisibleHoldFixture({ ancestor: 'open', stranger: 'holder' });
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333');
    assert.equal(v.ok, false, v.reason);
    assert.match(v.reason, /pid 444/, 'the stranger actually holds it — the ancestor merely has it open');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('an ancestor\'s fdinfo is UNREADABLE — refuses the exemption AND refuses the run (m7-d-guard-unknown-audit.md row 12)', () => {
  const f = invisibleHoldFixture({ ancestor: 'unreadable' });
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333');
    // CANNOT CHECK now REFUSES: a census that could not vouch for a fd that IS
    // the lock's own descriptor must never be read as "safe to proceed",
    // which is the same fact whether or not the unreadable fd belongs to this
    // run's own ancestor.
    assert.equal(v.ok, false, v.reason);
    assert.doesNotMatch(v.reason, /OWN ANCESTOR/, 'a census that could not read the fd must never be read as proof of the run\'s own hold');
    assert.match(v.reason, /CANNOT CHECK/, v.reason);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a /proc/locks row owned by an EXITED pid (standard-kernel shape) is irrelevant — the ancestor holds it by fdinfo either way', () => {
  const f = invisibleHoldFixture({ ancestor: 'holder', lockRowPid: '99999' }); // 99999: the flock binary that exited, no /proc entry
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333');
    assert.equal(v.ok, true, v.reason);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('REAL processes, heavy-slot\'s exact shape: `exec 8>lock; flock -n 8` then a child with fd 8 closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lg-invisible-real-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  const probe = `import('${join(REPO, 'scripts/stories/lock-guard.mjs')}').then((m) => {
    process.stdout.write(JSON.stringify(m.suiteLockVerdict({ ${JSON.stringify(SUITE_LOCK_ENV)}: ${JSON.stringify(lock)} })));
  });`;
  try {
    const out = await new Promise<string>((res, rej) => {
      const p = spawn('bash', ['-c', `exec 8>"$1"; flock -n 8 || exit 9; "$2" --input-type=module -e "$3" 8>&-`, '_', lock, process.execPath, probe], { stdio: ['ignore', 'pipe', 'inherit'] });
      let o = '';
      p.stdout!.on('data', (d) => { o += d; });
      p.on('close', (code) => (code === 0 ? res(o) : rej(new Error(`exit ${code}: ${o}`))));
    });
    const v = JSON.parse(out);
    assert.equal(v.ok, true, v.reason);
    assert.match(v.reason, /ancestor/i, 'the ancestor is named directly by fdinfo, not inferred through an opener + probe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
