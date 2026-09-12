/**
 * The door for `lock-state.sh` — `forge-8vfn.7.6.96`.
 *
 * Three lanes backed off a FREE `.suite-lock` because every wait in the campaign
 * read file descriptors, and `flock FILE cmd` opens the file BEFORE it blocks
 * acquiring: a queuer and a holder are byte-identical to an fd census. One job's
 * 25-minute queue was read as a 28-minute hold and became ruling 946, retracted
 * at 948. The opposite blind spot is `exec 9>lock; flock -n 9`, which holds the
 * lock with no nameable row in `/proc/locks` — so a `/proc/locks`-only reader
 * calls a genuinely held lock FREE.
 *
 * Each case below is one of those two errors, plus the two straightforward
 * states. The fourth is the one that matters most: it is green for the wrong
 * reason under either single instrument, and only the probe gets it right.
 *
 * EVERY TEST USES ITS OWN LOCK FILE in a temp dir. A door that shares a lock
 * with live lanes tests the campaign's timing, not this file — learned writing
 * `with-locks.test.ts`, where a smoke test against the real `_1.0` reported
 * "still held" and the holder was a sibling lane's gate.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lock-state.sh',
);

const dirs: string[] = [];
const children: ChildProcess[] = [];
function lockFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'lock-state-'));
  dirs.push(d);
  const f = join(d, '.lock');
  writeFileSync(f, '');
  return f;
}
/** Kill by the handle we hold, never by pattern (ruling 665). */
after(() => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
const settle = () => spawnSync('sleep', ['0.4']);

/** A plain `flock <lock> sleep` — the shape every launcher uses. */
function holder(lock: string, seconds = 30): ChildProcess {
  const c = spawn('flock', [lock, 'sleep', String(seconds)], { stdio: 'ignore' });
  children.push(c);
  settle();
  return c;
}
/** A hold on a descriptor inherited from a parent shell — C's §15.481 shape. */
function inheritedFdHolder(lock: string, seconds = 30): ChildProcess {
  const c = spawn('bash', ['-c', `exec 9>"${lock}"; flock -n 9 || exit 7; sleep ${seconds}`], { stdio: 'ignore' });
  children.push(c);
  settle();
  return c;
}
const procLocksRows = (lock: string): string[] => {
  const ino = spawnSync('stat', ['-c', '%i', lock], { encoding: 'utf8' }).stdout.trim();
  const out = spawnSync('awk', [
    '-v', `ino=${ino}`, '{ n = split($6, a, ":"); if (n == 3 && a[3] == ino) print $5 }', '/proc/locks',
  ], { encoding: 'utf8' }).stdout;
  return out.split('\n').filter(Boolean);
};

describe('lock-state.sh — the probe is the fact, /proc/locks is the attribution', () => {
  test('NOBODY: free, nothing open, exit 0', () => {
    const lock = lockFile();
    const held = run('held', lock);
    assert.equal(held.status, 0, 'a lock nobody holds must exit 0');
    assert.equal(held.stdout.trim(), 'FREE');
    assert.equal(run('open', lock).stdout.trim(), '', 'nothing has it open');
    assert.match(run('say', lock).stdout, /FREE OPEN:none/);
  });

  test('A REAL HOLDER: held, named from /proc/locks, exit 3', () => {
    const lock = lockFile();
    const h = holder(lock);
    const held = run('held', lock);
    assert.equal(held.status, 3, 'a held lock must exit 3');
    assert.match(held.stdout, /^HELD /);
    assert.match(held.stdout, /cwd /, 'the holder is named with its cwd');

    const open = run('open', lock).stdout.trim().split('\n');
    const holders = open.filter((l) => l.endsWith('HOLDER'));
    assert.equal(holders.length, 1, `exactly one HOLDER, got:\n${open.join('\n')}`);
    assert.ok(holders[0].startsWith(String(h.pid)), 'the HOLDER is the pid we spawned');
  });

  test('A QUEUED WAITER: listed OPEN/WAITING, never HOLDER', () => {
    const lock = lockFile();
    holder(lock);
    const waiter = holder(lock); // blocks — the lock is already taken
    const open = run('open', lock).stdout.trim().split('\n');

    const waiterRow = open.find((l) => l.startsWith(`${waiter.pid} `));
    assert.ok(waiterRow, `the waiter must be LISTED, not invisible:\n${open.join('\n')}`);
    assert.ok(waiterRow.endsWith('OPEN/WAITING'), `the waiter must not be labelled HOLDER: ${waiterRow}`);
    assert.equal(open.filter((l) => l.endsWith('HOLDER')).length, 1, 'still exactly one holder');
  });

  test('AN INHERITED-FD HOLD: /proc/locks names nobody, and the lock is STILL held', () => {
    const lock = lockFile();
    inheritedFdHolder(lock);

    // The premise, asserted rather than assumed: this is the case where the
    // kernel's own list has nothing to say.
    assert.deepEqual(procLocksRows(lock), [], 'this shape must produce no /proc/locks row');

    const held = run('held', lock);
    assert.equal(held.status, 3, 'a /proc/locks-only reader would exit 0 here, and be wrong');
    assert.match(held.stdout, /^HELD \(unnameable/);
  });

  test('REFUSES rather than defaulting: no args, bad verb, missing file', () => {
    assert.equal(run().status, 2);
    assert.equal(run('held').status, 2, 'a verb with no lock file is usage, not a free lock');
    assert.equal(run('hold', lockFile()).status, 2, 'a near-miss verb refuses rather than guessing');
    assert.equal(run('held', join(tmpdir(), 'lock-state-no-such-file')).status, 2);
  });
});
