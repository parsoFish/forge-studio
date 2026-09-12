/**
 * The doors for `lock-state` — `forge-8vfn.7.6.96`, reconciled with `7.6.93`
 * under T1 970.
 *
 * WHAT THESE DOORS DO **NOT** TEST, stated first because the previous version of
 * this file tested it twice. The CLASSIFICATION — holder vs blocked waiter vs
 * open-not-locked — belongs to `lock-guard.mjs`, which has twelve doors and a
 * `procRoot` seam that lets them run against a fixture tree. This file used to
 * re-derive that in shell and door it a second time; one walker with two
 * classifiers is ruling 948's error with a second place to recur, so the shell
 * walker is gone and so are its doors.
 *
 * WHAT IS LEFT IS WHAT THIS TOOL ADDS: the `flock -n` PROBE, and the rendering
 * of what happens when the probe and the census disagree. Those need real kernel
 * behaviour — a fixture `/proc` cannot be locked — so every case below spawns a
 * real `flock` against a real file in its own temp dir. A door that shares a
 * lock with live lanes tests the campaign's timing, not this file.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHIM = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lock-state.sh',
);

const dirs: string[] = [];
const children: ChildProcess[] = [];
/** Kill by the handle we hold, never by pattern (ruling 665). */
after(() => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function lockFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'lock-state-'));
  dirs.push(d);
  const f = join(d, '.lock');
  writeFileSync(f, '');
  return f;
}
const run = (...args: string[]) => spawnSync('bash', [SHIM, ...args], { encoding: 'utf8' });
const settle = () => spawnSync('sleep', ['0.4']);

function holder(lock: string, seconds = 30): ChildProcess {
  const c = spawn('flock', [lock, 'sleep', String(seconds)], { stdio: 'ignore' });
  children.push(c);
  settle();
  return c;
}
/** A hold on a descriptor inherited from a parent shell — the case `/proc/locks`
 *  cannot name, and the reason the probe exists. */
function inheritedFdHolder(lock: string, seconds = 30): ChildProcess {
  const c = spawn('bash', ['-c', `exec 9>"${lock}"; flock -n 9 || exit 7; sleep ${seconds}`], { stdio: 'ignore' });
  children.push(c);
  settle();
  return c;
}
const procLocksRows = (lock: string): string[] => {
  const ino = spawnSync('stat', ['-c', '%i', lock], { encoding: 'utf8' }).stdout.trim();
  return spawnSync('awk', [
    '-v', `ino=${ino}`, '{ n = split($6, a, ":"); if (n == 3 && a[3] == ino) print $5 }', '/proc/locks',
  ], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
};

describe('lock-state — the probe is the fact, the census is the attribution', () => {
  test('NOBODY: free, exit 0, nothing waiting, nothing open', () => {
    const lock = lockFile();
    const held = run('held', lock);
    assert.equal(held.status, 0, 'a lock nobody holds must exit 0');
    assert.equal(held.stdout.trim(), 'FREE');
    assert.match(run('say', lock).stdout, /FREE WAITING:0 OPEN-NOT-LOCKED:none/);
  });

  test('A REAL HOLDER: named from the kernel, exit 3, with its ppid for the caller to judge', () => {
    const lock = lockFile();
    const h = holder(lock);
    const r = run('say', lock);
    assert.equal(r.status, 3, 'a held lock must exit 3');
    assert.match(r.stdout, new RegExp(`HELD ${h.pid}\\(cwd `), `the holder must be named: ${r.stdout}`);
    assert.match(r.stdout, /ppid \d+/, 'ppid is emitted so the caller can infer reparenting — never the reader');
  });

  test('A BLOCKED WAITER is COUNTED, not named as a holder (7.6.33)', () => {
    const lock = lockFile();
    const h = holder(lock);
    const waiter = holder(lock); // blocks: the lock is taken
    const r = run('say', lock);
    assert.match(r.stdout, new RegExp(`HELD ${h.pid}\\(`), 'the holder is still the holder');
    assert.doesNotMatch(
      r.stdout.split('WAITING:')[0], new RegExp(String(waiter.pid)),
      `a queued pid must never appear as a holder: ${r.stdout}`,
    );
    assert.match(r.stdout, /WAITING:[1-9]/, `the queue must be counted: ${r.stdout}`);
  });

  test('AN INHERITED-FD HOLD: the reader never says FREE, whatever the kernel can name', () => {
    const lock = lockFile();
    inheritedFdHolder(lock);

    // THE PREMISE IS ENVIRONMENT-DEPENDENT AND THIS DOOR NO LONGER PRETENDS
    // OTHERWISE. The first version asserted `procLocksRows(lock)` is empty —
    // "this shape must produce no /proc/locks row" — which is true on WSL2,
    // where the campaign runs and where the blind spot was measured, and FALSE
    // in CI, which named the holder as pid 25484 and red-ed the build. I had
    // encoded one box's kernel behaviour as a property of Linux, in the very
    // door meant to prove I was not guessing.
    //
    // What is true EVERYWHERE is the behaviour under test: a lock held on an
    // inherited descriptor is HELD, and this reader says so. Where the census
    // can name the holder it names it; where it cannot it says `unnameable`.
    // Either way it never reports FREE, which is the failure that matters —
    // a caller acting on FREE starts work beside a funded run.
    const rows = procLocksRows(lock);
    const r = run('say', lock);
    assert.equal(r.status, 3, 'held is held; a reader that exits 0 here sends a caller into a live lock');
    if (rows.length === 0) {
      // The WSL2 shape, and the one the probe exists for: the census is blind
      // and only `flock -n` can see the hold.
      assert.match(r.stdout, /HELD \(unnameable — inherited fd\)/);
    } else {
      // The CI shape: the census CAN name it, so the reader must — reporting
      // `unnameable` here would be the opposite lie.
      assert.match(r.stdout, new RegExp(`HELD ${rows[0]}\\(cwd `));
    }
  });

  test('THE PARENT IS NAMED, not judged — the case a `ppid === 1` flag computes FALSE for', () => {
    // C found this by putting their own orphan's pid through the predicate
    // rather than reading its definition: WSL2 reparents to a SUBREAPER, so
    // their orphaned `flock` had ppid 277 — alive, not 1, and `/init`. A
    // `reparented` flag alone is silent for the exact incident it exists for.
    const lock = lockFile();
    const c = spawn('setsid', ['bash', '-c', `exec 9>"${lock}"; flock -n 9 || exit 7; sleep 30`], { stdio: 'ignore' });
    children.push(c);
    settle();
    const r = run('say', lock);
    assert.equal(r.status, 3, 'the lock is held whatever the census can name');
    assert.match(
      r.stdout, /ppid \d+ \S+/,
      `every row must carry its parent's pid AND identity, so a reader can SEE a lost wrapper: ${r.stdout}`,
    );
  });

  test('--twice REPORTS transients rather than filtering them', () => {
    const lock = lockFile();
    holder(lock);
    const r = run('say', lock, '--twice');
    assert.match(r.stdout, /stable across 2 scans: \d+/, `a stable holder must be reported stable: ${r.stdout}`);
    // A row that vanishes between scans is the self-match announcing itself;
    // suppressing it would turn the tell back into silence.
    assert.ok(!/transient[^:]*: *$/.test(r.stdout), 'a transient list, when present, must not be empty-but-printed');
  });

  test('REFUSES rather than defaulting: no args, bad verb, and who-runs until C lands it', () => {
    assert.equal(run().status, 2);
    assert.equal(run('held').status, 2, 'a verb with no lock file is usage, not a free lock');
    assert.equal(run('hold', lockFile()).status, 2, 'a near-miss verb refuses rather than guessing');
    const wr = run('who-runs', '/some/abs/path');
    assert.equal(wr.status, 2, 'who-runs is 7.6.93 and must refuse rather than approximate');
    assert.match(wr.stderr, /not implemented here yet/);
  });
});
