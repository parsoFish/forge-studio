/**
 * The BUILD's half of the symmetric lock refusal — bead `forge-8vfn.7.6.100`,
 * T1 969/975a, found by lane A with $9 in flight.
 *
 * THE HOLE WAS A ROW NOBODY ENUMERATED. §15.515 rules a lock order against three
 * columns — who TAKES, who WAITS, who REFUSES UNDER — and the campaign had run
 * them for `npm test` and never for builds:
 *
 *     a story run      .suite-lock REFUSES UNDER   .run-lock takes
 *     a gate's test    .suite-lock takes           .run-lock REFUSES UNDER
 *     a gate's build   .suite-lock takes           .run-lock  — nothing —
 *
 * 943 made ad-hoc builds take the suite-lock, serialising builds against each
 * OTHER. Nothing serialised a build against a funded story run — and `gate.sh`
 * runs `npm run build` BEFORE its `npm test`, so the heaviest job on the box was
 * free to start beside a run spending real money, at `MemAvailable` 5.0 GiB with
 * the kernel's watchdog already culling processes.
 *
 * IT WAITS RATHER THAN REFUSING, which is the one place it differs from
 * `test-guard`, and the difference is not cosmetic. §15.335 puts waiting in the
 * caller because a story runner has a Monitor; a build inside `gate.sh` has no
 * per-step waiter, so an instant refusal would red a gate for a condition that
 * clears itself. The wait is 947's shape — acquire and immediately release,
 * never hold — so the guard can never become the contention it measures.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./build-guard.mjs', import.meta.url));

function runGuard(env: Record<string, string>, timeoutMs = 30_000) {
  const r = spawnSync(process.execPath, [GUARD], {
    encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, FORGE_RUN_LOCK: '', ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const lockFile = () => join(mkdtempSync(join(tmpdir(), 'build-guard-')), '.run-lock');

/**
 * A test-only `Date.now()` double, injected into the GUARD'S OWN PROCESS via
 * `NODE_OPTIONS=--require=<this file>` — zero lines of `build-guard.mjs` are
 * touched to make this work. `sequence[i]` is returned on the i-th call to
 * `Date.now()` inside the guard; calls past the end of the array keep
 * returning the last value. This is how the backward step measured on this
 * host (`_1.0/reports/m7-c-clockprobe-1.log`: the `tsc` clocksource stepping
 * the wall clock back ~2.85s every ~29.6s) is simulated ON DEMAND rather than
 * waited for, per forge-8vfn.7.6.50.
 */
function fakeDateNowPreload(sequence: number[]) {
  const dir = mkdtempSync(join(tmpdir(), 'build-guard-clock-'));
  const path = join(dir, 'fake-date-now.cjs');
  writeFileSync(
    path,
    `const seq = ${JSON.stringify(sequence)};\n` +
      'let i = 0;\n' +
      'Date.now = () => seq[Math.min(i++, seq.length - 1)];\n',
  );
  return path;
}

describe('build-guard: a build does not start beside a funded story run', () => {
  test('7.6.100: no FORGE_RUN_LOCK — proceeds, and SAYS it is not enforcing', () => {
    const r = runGuard({ FORGE_RUN_LOCK: '' });
    assert.equal(r.status, 0);
    assert.match(r.out, /not configured/i,
      `a guard silent when it is not enforcing cannot be told from one that checked:\n${r.out}`);
    // T1 985(1): the sentence must name THIS job. The first cut called
    // `runLockVerdict`, whose `thisKind` is hardcoded to the suite, so the
    // guard's first real line in a merged-main verify said "the test suite is
    // NOT excluded from a story run" — about a BUILD. Correct about the lock and
    // wrong about the subject, which is why review passes it: the logic checks
    // out. The door now reads the noun.
    assert.match(r.out, /\ba build is NOT excluded from a story run\b/,
      `the guard must name the job it is guarding, not the one its helper was written for:\n${r.out}`);
    assert.doesNotMatch(r.out, /the test suite is NOT excluded/,
      'the suite\'s wording belongs to test-guard');
  });

  test('7.6.100: the lock exists and is FREE — proceeds', () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    const r = runGuard({ FORGE_RUN_LOCK: lock });
    assert.equal(r.status, 0, r.out);
  });

  test('7.6.100: HELD — it WAITS, names the holder, then exits 75 at the bound', async () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    // A real holder, so the guard is reading the kernel rather than a fixture.
    const holder = spawn('flock', [lock, 'sleep', '30'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
    try {
      const r = runGuard({ FORGE_RUN_LOCK: lock, FORGE_BUILD_LOCK_WAIT_MS: '2500', FORGE_BUILD_LOCK_SAY_MS: '1000' });
      assert.equal(r.status, 75, `75 is what gate.sh classifies as REFUSED rather than FAIL:\n${r.out}`);
      assert.match(r.out, /WAITING on .*\.run-lock/, 'it says it is waiting');
      assert.match(r.out, /pid \d+/, 'and names the holder, so a long block cannot be read as a hang');
      assert.match(r.out, /WAITED-OUT \.run-lock/, 'and says it waited out rather than failing');
      assert.match(r.out, /NOT a red/, 'because "I could not start" and "I ran and failed" are different facts');
    } finally {
      try { process.kill(holder.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  test('7.6.100: released mid-wait — it proceeds rather than sitting out the bound', async () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '2'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = runGuard({ FORGE_RUN_LOCK: lock, FORGE_BUILD_LOCK_WAIT_MS: '20000' });
      assert.equal(r.status, 0, `the lock freed, so the build runs:\n${r.out}`);
      assert.match(r.out, /free after \d+s — proceeding/);
    } finally {
      try { process.kill(holder.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  /**
   * 947's property, and the one that would make this guard the problem it
   * exists to solve: waiting must never HOLD. If the guard queued on the lock,
   * a story run releasing it would hand the lock to the guard instead of to the
   * next story — the hold-and-wait inversion that blocked every lane for half
   * an hour on gate `7694`.
   */
  test('7.6.100: while waiting it HOLDS NOTHING — a third party can still take the lock', async () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '2'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    const guard = spawn(process.execPath, [GUARD], {
      env: { ...process.env, FORGE_RUN_LOCK: lock, FORGE_BUILD_LOCK_WAIT_MS: '20000' },
      stdio: 'ignore',
    });
    try {
      // The original holder exits at ~2s. A third party asking for the lock with
      // a generous wait must get it — which it cannot if the guard queued.
      const third = spawnSync('flock', ['-w', '8', lock, 'true'], { timeout: 15_000 });
      assert.equal(third.status, 0, 'the guard must not be queued on the lock it is waiting for');
    } finally {
      try { process.kill(holder.pid!, 'SIGKILL'); } catch { /* gone */ }
      try { process.kill(guard.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  /**
   * forge-8vfn.7.6.50: `Date.now()` is NOT monotonic on this host — measured
   * in `_1.0/reports/m7-c-clockprobe-1.log`, which found the wall clock
   * stepping BACKWARDS by ~2.85s every ~29.6s regardless of load. This guard
   * computed every elapsed/deadline from `Date.now()` differences, so that
   * step produced `free after -1s — proceeding`
   * (this file's own sighting) — a negative duration is not a fact the guard
   * should be able to print. `performance.now()` is monotonic by
   * specification and cannot be moved by the injected `Date.now()` below, so
   * the fixed guard must print the same line with a non-negative number
   * regardless of what the wall clock does mid-wait.
   */
  test('forge-8vfn.7.6.50: a backward wall-clock step mid-wait must not print a negative elapsed', async () => {
    const lock = lockFile();
    writeFileSync(lock, '');
    // A real, transient holder — released after ~2s — so the guard's wait
    // loop runs long enough to observe the step and then finds the lock free.
    const holder = spawn('flock', [lock, 'sleep', '2'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    // First Date.now() call (the guard's `startedAt`) returns t0; every call
    // after returns t0 - 2850 — the measured backward step, arriving on the
    // guard's very next Date.now() read.
    const t0 = 2_000_000;
    const preload = fakeDateNowPreload([t0, t0 - 2_850]);
    try {
      const r = runGuard(
        { FORGE_RUN_LOCK: lock, FORGE_BUILD_LOCK_WAIT_MS: '20000', NODE_OPTIONS: `--require=${preload}` },
      );
      assert.equal(r.status, 0, `the lock freed, so the build should proceed:\n${r.out}`);
      assert.doesNotMatch(
        r.out,
        /free after -\d+s/,
        `Date.now() is not monotonic on this host (measured m7-c-clockprobe-1.log): a backward wall-clock step must not produce a negative elapsed:\n${r.out}`,
      );
    } finally {
      try { process.kill(holder.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
  });
});
