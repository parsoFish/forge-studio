/**
 * An ancestor's hold that `/proc/locks` cannot see (T1 1352/1353, M7 row 80).
 *
 * `heavy-slot.sh` takes the suite-lock as `exec 8>.suite-lock; flock -n 8`: the
 * external `flock` binary locks the SHARED open file description and exits.
 * The lock is real — a fresh `flock -n` fails — but on this kernel it has NO
 * row in `/proc/locks` (measured 3×, 2026-09-25), so `kernelLockRows` sees no
 * holder, the fd walk sees the ancestor with the file open, and the story
 * guard refused its own ancestor's hold as "open but NOT locked".
 *
 * The rule under test: an ANCESTOR that has the lock open, AND a fresh probe
 * that proves the lock is held, is this run's own hold. Anything short of both
 * keeps the existing refusal — a non-ancestor opener, an ancestor opener
 * whose probe finds the lock FREE (it really is only open), and a probe that
 * cannot answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { suiteLockVerdict, SUITE_LOCK_ENV } from './lock-guard.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A fake /proc: `locks` empty (the invisible hold), self 333 → 222 → 111 → 1,
 *  and `openerPid` holding fd 8 on the lock file. */
function invisibleHoldFixture(openerPid: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lg-invisible-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  const proc = join(dir, 'proc');
  mkdirSync(proc);
  writeFileSync(join(proc, 'locks'), '');
  const chain: Array<[string, string]> = [['333', '222'], ['222', '111'], ['111', '1'], ['444', '1']];
  for (const [pid, ppid] of chain) {
    mkdirSync(join(proc, pid, 'fd'), { recursive: true });
    writeFileSync(join(proc, pid, 'status'), `Name:\tx\nPPid:\t${ppid}\n`);
    symlinkSync(dir, join(proc, pid, 'cwd'));
  }
  symlinkSync(realpathSync(lock), join(proc, openerPid, 'fd', '8'));
  return { dir, lock, proc };
}

const env = (lock: string) => ({ [SUITE_LOCK_ENV]: lock });

test('an ANCESTOR opener + a probe that proves the lock HELD = this run\'s own hold, and the reason says so', () => {
  const f = invisibleHoldFixture('111');
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333', { probeHeld: () => true });
    assert.equal(v.ok, true, v.reason);
    assert.match(v.reason, /ancestor/i);
    assert.match(v.reason, /\/proc\/locks/, 'names why the kernel table could not show it');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('an ANCESTOR opener whose probe finds the lock FREE is only open — still refused', () => {
  const f = invisibleHoldFixture('111');
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333', { probeHeld: () => false });
    assert.equal(v.ok, false, v.reason);
    assert.match(v.reason, /open but NOT locked/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a NON-ancestor opener is refused even when the lock is held', () => {
  const f = invisibleHoldFixture('444');
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333', { probeHeld: () => true });
    assert.equal(v.ok, false, v.reason);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a probe that cannot answer (null) never grants the exemption', () => {
  const f = invisibleHoldFixture('111');
  try {
    const v = suiteLockVerdict(env(f.lock), f.proc, '333', { probeHeld: () => null });
    assert.equal(v.ok, false, v.reason);
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
