/**
 * `gate.sh`'s own suite-lock holder, named — `forge-8vfn.7.6.79`.
 *
 * `gate.sh` takes the suite-lock through an inherited fd (`exec 9>"$lock";
 * flock -n 9`, the idiom `gate-suite-lock.test.ts` documents at length) because
 * the step loop reads from a process substitution and cannot be wrapped in
 * `flock <cmd>`. That idiom writes NO `/proc/locks` row for the holder, so a
 * second gate colliding with the first always fell into the fourth branch —
 * `HELD BY AN UNNAMEABLE HOLDER` — even though the holder is another gate.sh,
 * the single most common collision on the box (ruling 879, #705's gate).
 *
 * THE FIX IS A SIDECAR, NEVER THE GATE: a `<lock>.holder` file written right
 * after the take and removed on release. `suite_lock_state`'s ANCESTOR/STRANGER
 * classification (doored in `gate-suite-lock.test.ts` / `gate-lock-state.test.ts`)
 * is untouched — this file only exercises the fourth branch, the one neither of
 * those name.
 *
 * TWO DOORS: a REAL second `gate.sh`, run concurrently against a first one that
 * is genuinely holding the lock through the inherited-fd shape, must read the
 * first one's own pid off the sidecar rather than printing UNNAMEABLE — and a
 * sidecar naming a pid that has already exited must be reported STALE and
 * removed, with the wait proceeding regardless (the flock is still the truth).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh',
);

// A slow step so the lock stays held long enough for a concurrent second gate
// to observe it — the same shape `gate-suite-lock.test.ts`'s LOCK_CI uses, but
// this file does not need the step to report anything: the first gate's own
// process IS the fixture.
const SLOW_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Slow step so the lock stays held long enough for a concurrent gate to observe it
        run: sleep 3
`;

function tree(): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-holder-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), SLOW_CI);
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
  return d;
}
const camp = () => mkdtempSync(join(tmpdir(), 'gate-holder-camp-'));

/** This file's subject is a lock gate.sh takes itself, so it must not inherit one. */
function env(extra: Record<string, string> = {}) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...rest } = process.env;
  return { ...rest, ...extra };
}

/** Poll an external, feature-independent probe: does `flock -n <lock> true`
 *  fail to acquire? That is true the moment ANYTHING holds the lock, whether
 *  or not this bead's sidecar exists yet — so the poll works identically
 *  before and after the fix, and the test is red for the gate's own message,
 *  never for a fixture race. */
function waitUntilHeld(lock: string, maxMs = 5000): boolean {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = spawnSync('flock', ['-n', lock, 'true']);
    if (r.status !== 0) return true;
    spawnSync('sleep', ['0.05']);
  }
  return false;
}

describe('forge-8vfn.7.6.79 — the sidecar names gate.sh\'s own unnameable hold', () => {
  test('a real second gate reads the first one\'s pid, never UNNAMEABLE', async () => {
    const d1 = tree();
    const d2 = tree();
    const c = camp();
    const lock = join(c, '.suite-lock');
    writeFileSync(lock, '');

    const first = spawn('bash', [GATE, d1, c], { env: env() });
    try {
      assert.ok(waitUntilHeld(lock), 'the first gate must actually take the lock before this door means anything');

      // Sidecar written WHILE held (bead's "sidecar written" case).
      assert.ok(
        existsSync(`${lock}.holder`),
        'a <lock>.holder sidecar must exist while this gate holds the lock through the inherited-fd take',
      );

      const second = spawnSync('bash', [GATE, d2, c], {
        encoding: 'utf8',
        env: env({ FORGE_SUITE_LOCK_WAIT: '1' }),
      });

      assert.match(
        second.stdout,
        new RegExp(`suite-lock: HELD BY gate pid=${first.pid}\\b`),
        `a second gate must name the real holder's pid rather than UNNAMEABLE: ${second.stdout}`,
      );
      assert.doesNotMatch(
        second.stdout,
        /UNNAMEABLE/,
        'the whole point of the sidecar is that this branch no longer fires when the holder is another gate.sh',
      );
    } finally {
      await new Promise<void>((resolve) => {
        first.on('exit', () => resolve());
      });
    }

    // Sidecar removed on release (bead's "sidecar removed" case) — the
    // existing EXIT trap, not a new mechanism.
    assert.ok(!existsSync(`${lock}.holder`), 'the sidecar must be removed once the holding gate releases the lock');

    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('a sidecar naming a pid that has already exited reads STALE-SIDECAR, and is removed', () => {
    const d = tree();
    const c = camp();
    const lock = join(c, '.suite-lock');
    writeFileSync(lock, '');

    // The lock IS held, through the same invisible inherited-fd shape gate.sh
    // itself uses — but NOT by a gate.sh, so no sidecar exists until this test
    // plants a stale one. `lock-state.test.ts` names this exact idiom.
    const holder = spawn('bash', ['-c', `exec 9>"${lock}"; flock -n 9 || exit 7; sleep 5`], { stdio: 'ignore' });
    try {
      assert.ok(waitUntilHeld(lock), 'the fixture holder must actually hold the lock before the gate under test runs');

      // A pid guaranteed dead: spawnSync blocks until the child has exited and
      // been reaped, so by the time it returns the pid is gone, not a zombie.
      const deadPid = spawnSync('bash', ['-c', 'exit 0']).pid;
      assert.ok(deadPid, 'fixture must yield a pid to mark stale');
      writeFileSync(`${lock}.holder`, `pid=${deadPid} cwd=/nonexistent head=deadbeef since=2020-01-01T00:00:00Z\n`);

      const r = spawnSync('bash', [GATE, d, c], {
        encoding: 'utf8',
        env: env({ FORGE_SUITE_LOCK_WAIT: '1' }),
      });

      assert.match(
        r.stdout,
        new RegExp(`suite-lock: STALE-SIDECAR \\(pid ${deadPid} gone\\)`),
        `a sidecar naming a dead pid must be reported stale, not read as a live holder: ${r.stdout}`,
      );
      assert.ok(!existsSync(`${lock}.holder`), 'a stale sidecar is removed once read, same as a live one is removed on release');
    } finally {
      holder.kill('SIGKILL');
    }

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });
});
