/**
 * `gate.sh`'s lock classifier — `forge-s9g1`.
 *
 * SPLIT OUT OF `gate.test.ts` RATHER THAN ADDED TO IT. That file was 741 lines
 * against the repo's 800-line hard cap, so four doors took it to 813 and the
 * gate refused — correctly. The alternatives were to trim the doors' reasoning
 * or to baseline a file over the cap; both trade a real limit for a green tick.
 * A split by concern is the ratified third option, and `gate.test.ts` is left
 * BYTE-IDENTICAL to `3d5431d3` (sha `5400eb535ad95682`, 741 lines) — the split
 * moved code out and changed nothing that stayed.
 *
 * WHAT THIS FILE IS ABOUT. `lock_holder_pids` shipped in 7.6.48 as
 *
 *     awk -v ino=":$ino " '$0 ~ ino {print $5}' /proc/locks
 *
 * and printed garbage in production twice:
 *
 *     suite-lock: WAITING on stranger pid(s) 3048432 WRITE — another lane's suite holds it
 *
 * A HOLDER row is `6: FLOCK ADVISORY WRITE 784079 08:30:<ino> 0 EOF` and `$5` is
 * the pid. A BLOCKED WAITER is a CONTINUATION row — `2: -> FLOCK ADVISORY WRITE
 * 1677053 …` — where `->` shifts every field by one, so `$5` is the literal
 * string `WRITE`.
 *
 * THE SEAM, and why it is not a convenience: `/proc/locks` cannot be made to
 * hold a chosen row, so the two-row case the bug lives in is unreachable from a
 * door without one. `FORGE_PROC_LOCKS` points the parser at a fixture and
 * `--lock-state` reaches the classifier without running a suite — the same
 * bargain `lock-guard.mjs` made with `procRoot` for its twelve doors.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh',
);

/** One classification against a fixture `/proc/locks`. `<INO>` is replaced
 *  with the real inode of a real temp lock file, because the parser stats
 *  it. `<PID>` is replaced with a REAL pid — T1 1361 (this file's other
 *  describe block) made `suite_lock_state` require a LISTED pid to be
 *  LIVE before it counts as a holder, so the shipped bug's original fixture
 *  pid (a fixed, permanently non-existent number) would now be filtered out
 *  before the row-parsing this file is about is ever exercised. */
function lockState(locksBody: string, pid: number | string = 0): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-s9g1-'));
  try {
    const lock = join(d, '.lk');
    writeFileSync(lock, '');
    const ino = spawnSync('stat', ['-c', '%i', lock], { encoding: 'utf8' }).stdout.trim();
    const locks = join(d, 'locks');
    writeFileSync(locks, locksBody.replaceAll('<INO>', ino).replaceAll('<PID>', String(pid)));
    const r = spawnSync('bash', [GATE, '--lock-state', lock], {
      encoding: 'utf8',
      env: { ...process.env, FORGE_PROC_LOCKS: locks },
    });
    return (r.stdout || '').trim();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/** A real, LIVE process that is a SIBLING of the `gate.sh` invocation under
 *  test (spawned directly by this test file, never `gate.sh`'s ancestor) —
 *  the fixture's holder row must name someone real now, per `lockState`'s own
 *  comment. */
function liveSibling(): ChildProcess {
  return spawn('sleep', ['30'], { stdio: 'ignore' });
}

const HOLDER = '1: FLOCK  ADVISORY  WRITE <PID> 08:30:<INO> 0 EOF\n';
const WAITER = '2: -> FLOCK  ADVISORY  WRITE 1677053 08:30:<INO> 0 EOF\n';

describe('forge-s9g1 — a blocked waiter is not a holder, and position was never the property', () => {
  test('holder + blocked waiter on ONE inode returns exactly one pid, and it is numeric', () => {
    const sib = liveSibling();
    try {
      const out = lockState(HOLDER + WAITER, sib.pid);
      const pids = out.replace(/^STRANGER:/, '').split(/\s+/).filter(Boolean);
      assert.equal(pids.length, 1, `exactly one pid, got ${JSON.stringify(out)}`);
      assert.match(pids[0], /^\d+$/, `the pid must be numeric — the shipped bug printed the literal WRITE: ${out}`);
    } finally { sib.kill('SIGKILL'); }
  });

  test('and the one it returns is the HOLDER, never the waiter', () => {
    const sib = liveSibling();
    try {
      const out = lockState(HOLDER + WAITER, sib.pid);
      assert.equal(out, `STRANGER:${sib.pid}`);
      assert.doesNotMatch(out, /1677053/, 'the blocked waiter must not be reported as holding');
    } finally { sib.kill('SIGKILL'); }
  });

  test('a waiter with NO holder is FREE — nobody holds it', () => {
    // The case that would MISCLASSIFY once the pids are right rather than
    // garbage: a continuation row alone means the lock was released and somebody
    // is queued for it. Reporting that pid as a holder would let a waiter that
    // happens to be this gate's own ancestor read as ANCESTOR — the deadlock the
    // three states exist to avoid, arriving through the fix.
    assert.equal(lockState(WAITER), 'FREE');
  });

  test("another inode's holder is not this lock's", () => {
    // NOT red-first, and said so rather than counted among the three: the old
    // parser also answers FREE here. It guards the MAJ:MIN:INODE keying against
    // a future collision — the old `":$ino "` substring match could be satisfied
    // by a start or end offset — rather than reproducing the shipped bug.
    assert.equal(lockState('3: FLOCK  ADVISORY  WRITE 999999 08:30:99999999 0 EOF\n'), 'FREE');
  });
});

/**
 * T1 1361 — the GitHub-runner shape, from D's #911 CI run (`b5235313`).
 * Kernels differ on this exact hold: WSL2 shows NO `/proc/locks` row for
 * `exec N>file; flock -n N` at all (this describe block's whole subject); a
 * standard kernel (the CI runner) DOES show a row, but keyed to the pid of
 * the `flock` binary that acquired it and then exited — a pid that is DEAD by
 * the time anything reads the listing. A reader that only asks "did the
 * listing name someone" is right on WSL2 and wrong everywhere else: it would
 * report a genuine ancestor's hold as a STRANGER (the dead, listed pid),
 * waiting on a pid that can never release anything.
 *
 * `waitReady` and the READY-line idiom mirror `lock-holders.test.ts`'s own
 * doors for the identical shape on the fd-scan side of this fix.
 */
function waitReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('READY')) { child.stdout!.off('data', onData); resolve(); }
    };
    child.stdout!.on('data', onData);
    child.once('exit', (code) => reject(new Error(`holder exited early (${code}); buf=${buf}`)));
  });
}

describe('T1 1361 — a /proc/locks row naming a DEAD pid must not shadow a real LIVE holder', () => {
  test('the runner shape: dead pid in the row, real holder via inherited fd — reported by the live holder, never the dead pid', async () => {
    const d = mkdtempSync(join(tmpdir(), 'gate-runner-shape-'));
    const lock = join(d, '.lk');
    writeFileSync(lock, '');
    const holder = spawn(
      'bash', ['-c', `exec 8>${JSON.stringify(lock)}; flock -n 8 || exit 9; echo READY; exec sleep 30`],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await waitReady(holder);
      // A pid guaranteed dead: spawnSync blocks until the child has exited and
      // been reaped, so by the time it returns the pid is gone, not a zombie.
      const deadPid = spawnSync('bash', ['-c', 'exit 0']).pid;
      assert.ok(deadPid, 'fixture must yield a pid to mark dead');
      const ino = spawnSync('stat', ['-c', '%i', lock], { encoding: 'utf8' }).stdout.trim();
      const locksFixture = join(d, 'locks');
      writeFileSync(locksFixture, `1: FLOCK  ADVISORY  WRITE ${deadPid} 08:30:${ino} 0 EOF\n`);

      const r = spawnSync('bash', [GATE, '--lock-state', lock], {
        encoding: 'utf8',
        env: { ...process.env, FORGE_PROC_LOCKS: locksFixture },
      });
      const out = (r.stdout ?? '').trim();

      assert.doesNotMatch(out, new RegExp(`\\b${deadPid}\\b`), `must never report the dead listed pid as a holder: ${out}`);
      assert.match(out, /^STRANGER:\d+$/, `must fall through to the real, live fd holder: ${out}${r.stderr}`);
      assert.equal(Number(out.split(':')[1]), holder.pid, `must name the live holder's actual pid: ${out}`);
    } finally {
      holder.kill('SIGKILL');
      rmSync(d, { recursive: true, force: true });
    }
  });
});
