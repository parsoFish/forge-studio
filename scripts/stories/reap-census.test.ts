/**
 * reap-census.test.ts — finding row 75 (T1 rulings 1258, 1332) and D's review
 * of #906 (MUST 2: pid recycling; MUST 3: ancestorPids' unreadable-chain-
 * member false EMPTY).
 *
 * Three blocks: fixture `/proc/<pid>/stat` doors for `processStartTime` /
 * `identifyPid` / `samePid` / `verifiedKill` (MUST 2), fixture `/proc/<pid>/
 * status` doors for the guarded ppid walk (MUST 3, including a REAL EACCES
 * via `chmodSync` — the one failure mode a fixture cannot fake, since Linux
 * enforces it for the owning user too), and real-process doors proving both
 * survive contact with a live process tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  pidsDescendedFrom, censusSurvivors, waitForCensusEmpty, describeCensus,
  processStartTime, identifyPid, samePid, verifiedKill,
} from './reap-census.mjs';

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

/** A fake `/proc/<pid>/stat` line shaped exactly like the kernel's: `comm` in
 *  parens (so the "last `)`" parse is exercised, not a shortcut), 19 dummy
 *  fields, then `starttime` as the 20th (field 22 overall). */
function statLine(pid: number, starttime: number, comm = 'bash'): string {
  return `${pid} (${comm}) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${starttime}`;
}

function procRootWithStat(rows: Array<{ pid: string; starttime: number }>): string {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-stat-'));
  for (const { pid, starttime } of rows) {
    mkdirSync(join(root, pid));
    writeFileSync(join(root, pid, 'stat'), statLine(Number(pid), starttime));
  }
  return root;
}

/** A combined fixture `/proc`: each row gets both `status` (ppid chain) and
 *  `stat` (start time) — what `censusSurvivors` actually reads against a real
 *  `/proc`, so no test has to reason about two roots agreeing. */
function combinedProcRoot(rows: Array<{ pid: string; ppid: string; starttime: number }>): string {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-combined-'));
  for (const { pid, ppid, starttime } of rows) {
    mkdirSync(join(root, pid));
    writeFileSync(join(root, pid, 'status'), `Name:\tfixture\nPPid:\t${ppid}\n`);
    writeFileSync(join(root, pid, 'stat'), statLine(Number(pid), starttime));
  }
  return root;
}

// ------------------------------------------------------- processStartTime

test('processStartTime: reads field 22 after the last ")" of the comm field', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 987654 }]);
  try {
    assert.equal(processStartTime('100', { procRoot: root }), 987654);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('processStartTime: a comm field containing spaces and parens does not confuse the parse', () => {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-stat-comm-'));
  mkdirSync(join(root, '100'));
  writeFileSync(join(root, '100', 'stat'), `100 (weird (name) here) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42`);
  try {
    assert.equal(processStartTime('100', { procRoot: root }), 42, 'must split after the LAST ")", never the first');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('processStartTime: an absent pid is null, never a fabricated 0', () => {
  assert.equal(processStartTime('99999', { procRoot: '/no-such-proc-root-reap-census' }), null);
});

test('processStartTime: a malformed stat line (too few fields) is null, not NaN', () => {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-stat-bad-'));
  mkdirSync(join(root, '100'));
  writeFileSync(join(root, '100', 'stat'), '100 (bash) S 1 1');
  try {
    assert.equal(processStartTime('100', { procRoot: root }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- identifyPid

test('identifyPid: pairs a pid with its current start time', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    assert.deepEqual(identifyPid('100', { procRoot: root }), { pid: '100', startTime: 555 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('identifyPid: an unreadable pid is recorded with startTime null, not thrown', () => {
  assert.deepEqual(identifyPid('999999', { procRoot: '/no-such-proc-root-reap-census' }), { pid: '999999', startTime: null });
});

// ----------------------------------------------------------------- samePid

test('samePid: MUST 2 — a matching start time is the same process', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    assert.equal(samePid({ pid: '100', startTime: 555 }, { procRoot: root }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('samePid: MUST 2 — a RECYCLED pid (different current start time) is NOT the same process', () => {
  // The exact incident this closes: pid 100 was recorded at startTime 555;
  // by the time anything checks again, the kernel has reused 100 for an
  // entirely unrelated process that happens to have started at 999.
  const root = procRootWithStat([{ pid: '100', starttime: 999 }]);
  try {
    assert.equal(samePid({ pid: '100', startTime: 555 }, { procRoot: root }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('samePid: a pid that is simply gone now is NOT the same process', () => {
  const root = mkdtempSync(join(tmpdir(), 'reap-census-stat-empty-'));
  try {
    assert.equal(samePid({ pid: '100', startTime: 555 }, { procRoot: root }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('samePid: an identity that was never successfully recorded (startTime null) can never match', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    assert.equal(samePid({ pid: '100', startTime: null }, { procRoot: root }), false, 'nothing to compare against, so nothing can match');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('samePid: null or undefined recorded identity is never the same process', () => {
  assert.equal(samePid(null), false);
  assert.equal(samePid(undefined), false);
});

// ------------------------------------------------------------ verifiedKill

test('verifiedKill: MUST 2 — signals only when the recorded identity still matches', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  const sent: Array<[string | number, string]> = [];
  try {
    const r = verifiedKill({ pid: '100', startTime: 555 }, 'SIGTERM', { kill: (p, s) => sent.push([p, s]), procRoot: root });
    assert.equal(r.signalled, true);
    assert.deepEqual(sent, [['100', 'SIGTERM']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifiedKill: MUST 2 — a recycled pid is NEVER signalled, named as such', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 999 }]); // recycled: recorded 555, now 999
  const sent: Array<[string | number, string]> = [];
  try {
    const r = verifiedKill({ pid: '100', startTime: 555 }, 'SIGKILL', { kill: (p, s) => sent.push([p, s]), procRoot: root });
    assert.equal(r.signalled, false);
    assert.deepEqual(sent, [], 'a recycled pid must never receive a signal meant for the process that is gone');
    assert.match(r.reason ?? '', /no longer the recorded process/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifiedKill: ESRCH is reported as gone, distinct from EPERM', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    const r = verifiedKill({ pid: '100', startTime: 555 }, 'SIGKILL', {
      kill: () => { const e: any = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; },
      procRoot: root,
    });
    assert.equal(r.signalled, false);
    assert.match(r.reason ?? '', /gone the instant before the signal landed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifiedKill: EPERM is reported as alive-but-not-ours, distinct from ESRCH', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    const r = verifiedKill({ pid: '100', startTime: 555 }, 'SIGKILL', {
      kill: () => { const e: any = new Error('kill EPERM'); e.code = 'EPERM'; throw e; },
      procRoot: root,
    });
    assert.equal(r.signalled, false);
    assert.match(r.reason ?? '', /EPERM.*alive.*not ours/, r.reason ?? '');
    assert.doesNotMatch(r.reason ?? '', /gone/i, 'EPERM must never read as though the process were absent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------- pidsDescendedFrom

test('pidsDescendedFrom: walks the chain transitively — grandchildren count', () => {
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

test('pidsDescendedFrom: MUST 3 — an unreadable intermediate status excludes that candidate rather than throwing', () => {
  const root = procTree([{ pid: '100', ppid: '1' }, { pid: '102', ppid: '101' }]);
  mkdirSync(join(root, '101'));
  writeFileSync(join(root, '101', 'status'), 'Name:\tfixture\nPPid:\t100\n');
  chmodSync(join(root, '101', 'status'), 0o000);
  try {
    // The general-purpose filter excludes an unknown chain rather than refusing
    // outright — that refusal is `censusSurvivors`'s job, doored below.
    assert.deepEqual(pidsDescendedFrom(['102'], '100', { procRoot: root }), []);
  } finally {
    chmodSync(join(root, '101', 'status'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------- censusSurvivors

test('censusSurvivors: a verified root itself counts as a survivor when it is still listed', () => {
  const root = combinedProcRoot([{ pid: '100', ppid: '1', starttime: 555 }]);
  try {
    assert.deepEqual(
      censusSurvivors([{ pid: '100', startTime: 555 }], { procRoot: root, listPids: () => ['100'] }),
      ['100'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: a live descendant is found even when the recorded root itself is gone', () => {
  // The root pid (100) is dead — not in the listing — but 101 still shows
  // ppid 100 because it has not been reparented (the live window this
  // module's header says the check is valid in).
  const root = combinedProcRoot([{ pid: '101', ppid: '100', starttime: 1 }]);
  try {
    assert.deepEqual(
      censusSurvivors([{ pid: '100', startTime: 555 }], { procRoot: root, listPids: () => ['101'] }),
      ['101'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: MUST 2 — a RECYCLED root is dropped entirely, not treated as a survivor and not walked as an ancestry target', () => {
  // pid 100 was recorded at startTime 555; it is now a DIFFERENT process
  // (startTime 999) with its OWN child, 101 — a stranger's process tree that
  // happens to sit under the recycled number. Neither may be swept.
  const root = combinedProcRoot([
    { pid: '100', ppid: '1', starttime: 999 }, // recycled — an unrelated process now
    { pid: '101', ppid: '100', starttime: 1 }, // that process's own (unrelated) child
  ]);
  try {
    assert.deepEqual(
      censusSurvivors([{ pid: '100', startTime: 555 }], { procRoot: root, listPids: () => ['100', '101'] }),
      [],
      'a recycled root must claim neither itself nor a stranger\'s children',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: empty roots is vacuously empty — nothing to confirm', () => {
  assert.deepEqual(censusSurvivors([], { procRoot: '/does-not-matter', listPids: () => ['1', '2'] }), []);
});

test('censusSurvivors: an unreadable listPids failure is UNKNOWN (null), never an empty array', () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    const r = censusSurvivors([{ pid: '100', startTime: 555 }], {
      procRoot: root,
      listPids: () => { throw new Error('EACCES'); },
    });
    assert.equal(r, null, 'unreadable is unknown, not a clean census');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: an unrelated pid is not a survivor', () => {
  const root = combinedProcRoot([
    { pid: '100', ppid: '1', starttime: 555 },
    { pid: '300', ppid: '1', starttime: 1 },
  ]);
  try {
    assert.deepEqual(
      censusSurvivors([{ pid: '100', startTime: 555 }], { procRoot: root, listPids: () => ['300'] }),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('censusSurvivors: MUST 3 — a read failure OTHER than ENOENT on some candidate\'s chain refuses the WHOLE census', () => {
  const root = combinedProcRoot([{ pid: '100', ppid: '1', starttime: 555 }]);
  // 102's own chain passes through 101, whose status is unreadable for a
  // reason other than "gone" — real EACCES, which Linux enforces for the
  // owning user too.
  mkdirSync(join(root, '101'));
  writeFileSync(join(root, '101', 'status'), 'Name:\tfixture\nPPid:\t100\n');
  chmodSync(join(root, '101', 'status'), 0o000);
  mkdirSync(join(root, '102'));
  writeFileSync(join(root, '102', 'status'), 'Name:\tfixture\nPPid:\t101\n');
  try {
    const r = censusSurvivors([{ pid: '100', startTime: 555 }], { procRoot: root, listPids: () => ['102'] });
    assert.equal(r, null, '102 might descend from 100 through the unreadable 101 — under-reporting it is the false EMPTY this closes');
  } finally {
    chmodSync(join(root, '101', 'status'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------ waitForCensusEmpty

function fakeClock(stepMs: number) {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

test('waitForCensusEmpty: settles as soon as the survivor list empties, never waiting past that', async () => {
  const calls: number[] = [];
  let n = 0;
  const listPids = () => {
    calls.push(n);
    n += 1;
    return n <= 2 ? ['100'] : [];
  };
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    const r = await waitForCensusEmpty([{ pid: '100', startTime: 555 }], { boundMs: 10_000, pollMs: 50, procRoot: root, listPids, clock: fakeClock(50) });
    assert.equal(r.empty, true);
    assert.equal(r.reason, 'census-empty');
    assert.equal(calls.length, 3, 'stops polling the instant it is empty, not after the bound');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('waitForCensusEmpty: NEVER empty after the bound — reports the survivors and the bound, refuses to guess', async () => {
  const root = procRootWithStat([{ pid: '100', starttime: 555 }]);
  try {
    const r = await waitForCensusEmpty([{ pid: '100', startTime: 555 }], {
      boundMs: 100, pollMs: 30, procRoot: root, listPids: () => ['100'], clock: fakeClock(30),
    });
    assert.equal(r.empty, false);
    assert.match(r.reason, /100 still alive or descended/);
    assert.match(r.reason, /100 ms/);
    assert.ok(r.waitedMs >= 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('waitForCensusEmpty: an unreadable census is refused, never reported empty, however long it waits', async () => {
  const r = await waitForCensusEmpty([{ pid: '100', startTime: 555 }], {
    boundMs: 60, pollMs: 20,
    listPids: () => { throw new Error('ENOENT'); },
    clock: fakeClock(20),
  });
  assert.equal(r.empty, false);
  assert.equal(r.survivors, null);
  assert.match(r.reason, /could not be fully confirmed/);
});

test('censusSurvivors: the live listing is attempted even when every recorded root fails its OWN verification — an unreadable listing is never hidden by a coincidence', () => {
  // pid 100 is PRESENT but recycled (recorded 555, now 999) — every root is
  // therefore unusable on its own, and a version of this function that
  // filters roots BEFORE attempting the listing would return `[]` without
  // ever calling `listPids`, silently agreeing with a listing it never read.
  const root = combinedProcRoot([{ pid: '100', ppid: '1', starttime: 999 }]);
  try {
    const r = censusSurvivors([{ pid: '100', startTime: 555 }], {
      procRoot: root,
      listPids: () => { throw new Error('EACCES'); },
    });
    assert.equal(r, null, 'the listing must be attempted regardless of whether any root verifies, and its failure must still refuse');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('waitForCensusEmpty: MUST 2 — a recycled root settles empty immediately rather than waiting out the bound', async () => {
  const root = procRootWithStat([{ pid: '100', starttime: 999 }]); // recorded 555, now recycled to 999
  try {
    const r = await waitForCensusEmpty([{ pid: '100', startTime: 555 }], {
      boundMs: 5000, pollMs: 20, procRoot: root, listPids: () => ['100'], clock: fakeClock(20),
    });
    assert.equal(r.empty, true, 'the recycled root is not ours, so there is nothing left of this run to wait for');
    assert.equal(r.waitedMs, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

// ------------------------------------------ REAL PROCESS doors (T3 rule 9)

test('DOOR: waitForCensusEmpty settles against a REAL process tree once the child actually exits', async (t) => {
  const child = spawn('node', ['-e', 'setTimeout(() => {}, 900)'], { stdio: 'ignore' });
  t.after(() => {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* already gone */ }
  });
  const identity = identifyPid(child.pid!);
  assert.notEqual(identity.startTime, null, 'a real, just-spawned child must be identifiable');

  const before = await waitForCensusEmpty([identity], { boundMs: 150, pollMs: 20 });
  assert.equal(before.empty, false, 'the child is genuinely still alive at this point');

  await new Promise((r) => setTimeout(r, 950));
  const after = await waitForCensusEmpty([identity], { boundMs: 500, pollMs: 20 });
  assert.equal(after.empty, true, `the child has exited on its own now: ${JSON.stringify(after)}`);
});

test('DOOR: MUST 2 — a real, currently-alive process is NOT signalled when the recorded identity does not match it', async (t) => {
  const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => {
    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* already gone */ }
  });
  const wrongIdentity = { pid: child.pid!, startTime: -1 }; // never the real value
  const r = verifiedKill(wrongIdentity, 'SIGKILL');
  assert.equal(r.signalled, false);
  assert.doesNotThrow(() => process.kill(child.pid!, 0), 'a live process must survive a kill call that failed its identity check');
});
