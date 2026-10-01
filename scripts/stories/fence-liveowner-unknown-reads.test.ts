/**
 * fence-liveowner-unknown-reads.test.ts — po2h + row 170: an UNKNOWN `/proc`
 * read, anywhere in `livePidCwds`'s walk, must never be read as "no live
 * owner". Split out of `fence-containment.test.ts` at the 800-line cap, BY
 * CONCERN and not by line count (ruling 150 — the same rule that split
 * `fence-attribution.mjs` out of `sweep.mjs`): this file answers one narrow
 * question — can a single transient `/proc` read failure cost a live session
 * its attribution — distinct from that file's sibling-escape semantics
 * (308/309b/6.11.32/6.11.34/7.5.1/7.5.6).
 *
 * `sleeperIn` is duplicated from `fence-containment.test.ts` rather than
 * shared: a one-function fixture is not worth a cross-file test-utils module
 * (the same call `fence-attribution.test.ts`'s own `procTree` fixture makes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

import { sessionScratchRoots, liveSessionOwners } from './fence-attribution.mjs';

/**
 * A real sleeper whose cwd is `dir`, so `/proc/<pid>/cwd` genuinely points
 * there — and OBSERVED to be there before the caller proceeds (T1 1450/1451:
 * a test that asserts a condition it has not established is a flake with a
 * good story). See `fence-containment.test.ts`'s own copy for the full
 * rationale.
 */
function sleeperIn(dir) {
  const child = spawn('sleep', ['30'], { cwd: dir, detached: true, stdio: 'ignore' });
  child.unref();
  const want = realpathSync(dir);
  const deadline = Date.now() + 5000;
  for (;;) {
    let cwd = '';
    try { cwd = readlinkSync(join('/proc', String(child.pid), 'cwd')); } catch { /* not visible yet */ }
    if (cwd === want) return child;
    if (Date.now() >= deadline) {
      try { process.kill(child.pid); } catch { /* already gone */ }
      throw new Error(`the sleeper never appeared in /proc with cwd ${want} — this test cannot mean anything without it`);
    }
    execFileSync('sleep', ['0.02']);
  }
}

// --- po2h: an UNKNOWN /proc read must not be read as an absent owner --------
//
// Bead `forge-po2h`. ONE occurrence, under the full suite, never reproduced by
// timing (the bug report's own record: alone 3/3, two full 8240-test runs
// clean, a 60/60 loaded probe clean — not repeated here, since it already
// found nothing). The report's own "WHERE TO LOOK NEXT #1": `liveProcessCwds`
// swallowed every `readlinkSync` failure as "gone, or another user's", so a
// TRANSIENT failure on the owning session's OWN pid — indistinguishable, at
// that line, from the process having exited — reads exactly like
// `mine[0].live === null`.
//
// This does not claim to have reproduced the historical failure BY TIMING;
// nothing here waits on a race, and the true cause of the one occurrence stays
// unconfirmed. It reproduces the MECHANISM the report named, by injecting the
// one failure shape the real code could not tell apart from genuine absence,
// and applies the fix this repo already uses for the identical shape
// (`readEmitFailures`, `run-observe.mjs` — ENOENT is absence, anything else is
// UNKNOWN, §15.504): distinguish them, and never let one UNKNOWN read cost a
// live session its attribution.

/**
 * Wrap the real `/proc` reader so ONE pid's `readlinkSync` can be scripted —
 * every other pid, including every other real live process on the host, goes
 * through the real syscall untouched. This is what makes the repro SCHEDULED
 * rather than theorised: the target is a real, live process with a real cwd,
 * and the only thing under the test's control is whether THAT pid's read
 * throws, and with what error, on a given call.
 *
 * @param {number} pid the one pid to intercept
 * @param {(call: number) => (Error|null)} scriptFor given the 0-based call
 *   number seen for THIS pid, the error to throw, or null to let the real read through
 */
function interceptReadCwd(pid, scriptFor) {
  const calls = { count: 0 };
  const real = (p) => readlinkSync(join('/proc', p, 'cwd'));
  const readCwd = (p) => {
    if (Number(p) !== pid) return real(p);
    const err = scriptFor(calls.count);
    calls.count += 1;
    if (err !== null) throw err;
    return real(p);
  };
  return { readCwd, calls };
}

const genericReadError = () => new Error('EIO: some unreadable /proc state');
const goneReadError = (code) => Object.assign(new Error(code), { code });

test('po2h: an unrelated pid\'s /proc read failing during the same scan never costs the real owner its attribution', () => {
  const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));
  const sleeper = sleeperIn(laneDir);
  try {
    const scratchTree = join(sessionScratchRoots(realpathSync(laneDir))[0], 'd7ba5f92-po2h', 'scratchpad', 'base');
    // A pid that will never be real, scanned alongside the real one, and which
    // always throws ENOENT — the "one unrelated pid" the debugging brief asks for.
    const owners = liveSessionOwners([scratchTree], {
      listPids: () => ['999999999', String(sleeper.pid)],
      readCwd: (p) => (p === '999999999' ? (() => { throw goneReadError('ENOENT'); })() : readlinkSync(join('/proc', p, 'cwd'))),
    });
    assert.equal(owners.get(scratchTree)?.pid, sleeper.pid, 'the real owner is unaffected by an unrelated pid\'s failure');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test('po2h: ENOENT/ESRCH on the OWNER\'s own pid is genuine absence — never retried, never attributed', () => {
  const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));
  const sleeper = sleeperIn(laneDir);
  try {
    const scratchTree = join(sessionScratchRoots(realpathSync(laneDir))[0], 'd7ba5f92-po2h', 'scratchpad', 'base');
    const { readCwd, calls } = interceptReadCwd(sleeper.pid, () => goneReadError('ENOENT'));
    const owners = liveSessionOwners([scratchTree], { readCwd });
    assert.equal(owners.get(scratchTree), undefined, 'ENOENT reads as the process being gone, exactly as it should');
    assert.equal(calls.count, 1, 'a confirmed-gone read is answered once, never retried — retrying it would only cost time');
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});

test(
  'po2h (RED): a live owner is lost when ITS OWN /proc read fails once with an UNKNOWN (non-ENOENT/ESRCH) error '
  + '— the bead\'s mechanism, reproduced',
  () => {
    const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));
    const sleeper = sleeperIn(laneDir);
    try {
      const scratchTree = join(sessionScratchRoots(realpathSync(laneDir))[0], 'd7ba5f92-po2h', 'scratchpad', 'base');
      // ONE unknown-class failure on the owner's own pid, then the real read
      // succeeds — the read never says the process is gone; it just could not
      // be read that one time.
      const { readCwd, calls } = interceptReadCwd(sleeper.pid, (call) => (call === 0 ? genericReadError() : null));
      const owners = liveSessionOwners([scratchTree], { readCwd });
      assert.equal(
        owners.get(scratchTree)?.pid, sleeper.pid,
        'a read that fails once with an UNKNOWN error must not read as the session having exited',
      );
      assert.ok(calls.count >= 2, `the retry must have happened for the owner to be found at all (calls: ${calls.count})`);
    } finally {
      try { process.kill(sleeper.pid); } catch { /* already gone */ }
    }
  },
);

test('po2h: POSITIVE CONTROL — the retry budget is bounded; a read that never recovers still yields no owner', () => {
  // NO real process — T1 1450/1451: fence-containment.test.ts's own earlier
  // form leaned on a real `sleep 30` from `sleeperIn`, and under full-suite
  // load the sleeper could vanish from `/proc` between being planted and being
  // scanned, reading as an owner lost rather than as the pure retry-bound
  // property this test actually asserts. The bound is a function of
  // `listPids`/`readCwd` alone — `liveSessionOwners` passes `deps` straight
  // through to `livePidCwds` — so it is provable without ever touching a real pid.
  const scratchTree = join('/fence-po2h-fake-root', 'd7ba5f92-po2h', 'scratchpad', 'base');
  const calls = { count: 0 };
  const owners = liveSessionOwners([scratchTree], {
    listPids: () => ['999999998'],
    readCwd: () => {
      calls.count += 1;
      throw genericReadError();
    },
  });
  assert.equal(owners.get(scratchTree), undefined, 'a persistently-unknown read gives up — the guard is not weakened into infinite patience');
  assert.ok(calls.count >= 2, `the bound must actually have been exercised, not given up on the first try (calls: ${calls.count})`);
  assert.ok(calls.count <= 6, `and the bound must actually be a bound, not unbounded retrying (calls: ${calls.count})`);
});

// --- row 170: the /proc LISTING never got po2h's per-pid fix -----------------
// Bead forge-8vfn.8.5.5. 7.5.6 failed once under load with BOTH overlapping
// sleepers' `live` lost at once — not a single `readCwd` race (po2h already
// retries that), but the one read upstream of every pid: `readdirSync('/proc')`
// in `livePidCwds`'s default `listPids`, still one bare try/catch folding
// ENOENT and transient EMFILE/EAGAIN/EACCES alike into `return []`, no retry.
// Not reproduced by timing (30 rounds of 7.5.6 + 4 heavy files, clean);
// reproduced by injecting the same shape through the `{listPids}` seam po2h's
// own tests already use for `readCwd`.
test('row170 (RED): a live owner is lost when the /proc LISTING fails once with an UNKNOWN error', () => {
  const laneDir = mkdtempSync(join(tmpdir(), 'fence-laneb-'));
  const sleeper = sleeperIn(laneDir);
  try {
    const scratchTree = join(sessionScratchRoots(realpathSync(laneDir))[0], 'd7ba5f92-row170', 'scratchpad', 'base');
    let calls = 0;
    const listPids = () => {
      calls += 1;
      if (calls === 1) throw genericReadError();
      return readdirSync('/proc', { withFileTypes: true }).filter((e) => /^[0-9]+$/.test(e.name)).map((e) => e.name);
    };
    const owners = liveSessionOwners([scratchTree], { listPids });
    assert.equal(owners.get(scratchTree)?.pid, sleeper.pid, 'one UNKNOWN listing failure must not read as "no live processes"');
    assert.ok(calls >= 2, `retry must have happened (calls: ${calls})`);
  } finally {
    try { process.kill(sleeper.pid); } catch { /* already gone */ }
  }
});
test('row170: a genuinely ENOENT /proc listing still yields no owner, never retried', () => {
  const scratchTree = join('/fence-row170-fake-root', 'd7ba5f92-row170', 'scratchpad', 'base');
  let calls = 0;
  const owners = liveSessionOwners([scratchTree], { listPids: () => { calls += 1; throw goneReadError('ENOENT'); } });
  assert.equal(owners.get(scratchTree), undefined, 'no /proc at all: nothing can be attributed');
  assert.equal(calls, 1, 'answered once, never retried');
});
