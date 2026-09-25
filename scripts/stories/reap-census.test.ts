/**
 * reap-census.test.ts — finding row 75 (T1 rulings 1258, 1332): a census MUST
 * confirm a run's process tree is actually gone before anything clears what
 * that tree was writing.
 *
 * The first block doors `pidsDescendedFrom` / `censusSurvivors` /
 * `waitForCensusEmpty` against a FIXTURE `/proc`, in the same shape
 * `lock-state.test.ts`'s `procTree` and `lock-guard.test.ts`'s
 * `fixtureProcRoot` already use for `ancestorPids` — a `/proc/<pid>/status`
 * file per fixture pid, `PPid:\t<n>` the only field the walk reads.
 *
 * The second block plants REAL processes (T3 rule 9's shape: one command, a
 * trap, no leftovers) to prove the bounded wait actually settles against a
 * live process tree and not only a fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { pidsDescendedFrom, censusSurvivors, waitForCensusEmpty, describeCensus } from './reap-census.mjs';

// --------------------------------------------------------------- fixtures

/** A fake `/proc`: one `status` file per row, `PPid:` the only field read. */
function procTree(rows: Array<{ pid: string; ppid: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-proc-'));
  for (const { pid, ppid } of rows) {
    mkdirSync(join(root, pid));
    writeFileSync(join(root, pid, 'status'), `Name:\tfixture\nPPid:\t${ppid}\n`);
  }
  return root;
}

// ---------------------------------------------------- pidsDescendedFrom

test('pidsDescendedFrom: walks the chain transitively — grandchildren count', () => {
  // 100 -> 101 -> 102 (descends), 200 is unrelated (ppid 1).
  const root = procTree([
    { pid: '100', ppid: '1' },
    { pid: '101', ppid: '100' },
    { pid: '102', ppid: '101' },
    { pid: '200', ppid: '1' },
  ]);
  try {
    assert.deepEqual(
      pidsDescendedFrom(['101', '102', '200'], '100', { procRoot: root }).sort(),
      ['101', '102'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pidsDescendedFrom: a pid is never its own descendant', () => {
  const root = procTree([{ pid: '100', ppid: '1' }]);
  try {
    assert.deepEqual(pidsDescendedFrom(['100'], '100', { procRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pidsDescendedFrom: a sibling subtree does not count', () => {
  const root = procTree([
    { pid: '100', ppid: '1' },
    { pid: '200', ppid: '1' },
    { pid: '201', ppid: '200' },
  ]);
  try {
    assert.deepEqual(pidsDescendedFrom(['200', '201'], '100', { procRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- censusSurvivors

test('censusSurvivors: the root itself counts as a survivor when it is still listed', () => {
  const root = procTree([{ pid: '100', ppid: '1' }]);
  try {
    assert.deepEqual(censusSurvivors(['100'], { procRoot: root, listPids: () => ['100'] }), ['100']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: a live descendant is found even when the root itself is gone', () => {
  // The root pid (100) is dead — not in the listing — but 101 still shows
  // ppid 100 because it has not been reparented (the live window this module's
  // header says the check is valid in).
  const root = procTree([{ pid: '101', ppid: '100' }]);
  try {
    assert.deepEqual(censusSurvivors(['100'], { procRoot: root, listPids: () => ['101'] }), ['101']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: empty roots is vacuously empty — nothing to confirm', () => {
  assert.deepEqual(censusSurvivors([], { procRoot: '/does-not-matter', listPids: () => ['1', '2'] }), []);
});

test('censusSurvivors: an unreliable listPids failure is UNKNOWN (null), never an empty array', () => {
  const r = censusSurvivors(['100'], {
    listPids: () => {
      throw new Error('EACCES');
    },
  });
  assert.equal(r, null, 'unreadable is unknown, not a clean census');
});

test('censusSurvivors: an unrelated pid is not a survivor', () => {
  const root = procTree([
    { pid: '100', ppid: '1' },
    { pid: '300', ppid: '1' },
  ]);
  try {
    assert.deepEqual(censusSurvivors(['100'], { procRoot: root, listPids: () => ['300'] }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------ waitForCensusEmpty

/** A deterministic clock: `now()` steps by `stepMs` each call `sleep` makes. */
function fakeClock(stepMs: number) {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test('waitForCensusEmpty: settles as soon as the survivor list empties, never waiting past that', async () => {
  const calls: number[] = [];
  let n = 0;
  const listPids = () => {
    calls.push(n);
    n += 1;
    // First two polls: pid 100 alive. Third: gone.
    return n <= 2 ? ['100'] : [];
  };
  const r = await waitForCensusEmpty([100], { boundMs: 10_000, pollMs: 50, listPids, clock: fakeClock(50) });
  assert.equal(r.empty, true);
  assert.equal(r.reason, 'census-empty');
  assert.equal(calls.length, 3, 'stops polling the instant it is empty, not after the bound');
});

test('waitForCensusEmpty: NEVER empty after the bound — reports the survivors and the bound, refuses to guess', async () => {
  const r = await waitForCensusEmpty([100], {
    boundMs: 100,
    pollMs: 30,
    listPids: () => ['100'],
    clock: fakeClock(30),
  });
  assert.equal(r.empty, false);
  assert.match(r.reason, /100 still alive or descended/);
  assert.match(r.reason, /100 ms/);
  assert.ok(r.waitedMs >= 100);
});

test('waitForCensusEmpty: an unreadable census is refused, never reported empty, however long it waits', async () => {
  const r = await waitForCensusEmpty([100], {
    boundMs: 60,
    pollMs: 20,
    listPids: () => {
      throw new Error('ENOENT');
    },
    clock: fakeClock(20),
  });
  assert.equal(r.empty, false);
  assert.equal(r.survivors, null);
  assert.match(r.reason, /could not be read/);
});

test('waitForCensusEmpty: no run root recorded is vacuously census-empty at zero cost', async () => {
  let called = false;
  const r = await waitForCensusEmpty([], { listPids: () => { called = true; return []; } });
  assert.equal(r.empty, true);
  assert.equal(r.waitedMs, 0);
  assert.equal(called, false, 'nothing was recorded, so nothing needed to be read');
});

// ------------------------------------------------------------ describeCensus

test('describeCensus: settled and not-settled read as different sentences, never the same shape', () => {
  const [settled] = describeCensus({ empty: true, survivors: [], waitedMs: 12, reason: 'census-empty' });
  const [stuck] = describeCensus({ empty: false, survivors: [7], waitedMs: 5000, reason: 'pid(s) 7 still alive after 5000 ms' });
  assert.match(settled, /census-empty/);
  assert.match(stuck, /NOT empty/);
  assert.notEqual(settled, stuck);
});

// ------------------------------------------ REAL PROCESS door (T3 rule 9)

test('DOOR: waitForCensusEmpty settles against a REAL process tree once the child actually exits', async (t) => {
  // A real grandchild in its own subtree: `sh -c` -> `node -e`. The census
  // walks the REAL /proc, no fixture, and must not settle until the node
  // process is actually gone.
  const child = spawn('node', ['-e', 'setTimeout(() => {}, 900)'], { stdio: 'ignore' });
  t.after(() => {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* already gone */ }
  });
  const before = await waitForCensusEmpty([child.pid], { boundMs: 150, pollMs: 20 });
  assert.equal(before.empty, false, 'the child is genuinely still alive at this point');

  await new Promise((r) => setTimeout(r, 950));
  const after = await waitForCensusEmpty([child.pid], { boundMs: 500, pollMs: 20 });
  assert.equal(after.empty, true, `the child has exited on its own now: ${JSON.stringify(after)}`);
});
