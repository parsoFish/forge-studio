/**
 * reap-unknown.test.ts — ROW 101 / M7-D findings 4, 5 and 6 (M7-COMMON §6.15,
 * T1 1512): a `turn.pid` read, a `_logs/` listing, or a `/proc` process-table
 * build that fails for a reason OTHER than the path being genuinely absent
 * (ENOENT) must never render the same as "nothing here" — `collectAgentRuns`
 * and `readProcTable` used to fold EVERY failure into `null`/`[]`/an empty
 * `Map`, so a live dispatched agent's row (or its whole process-table
 * snapshot) could silently vanish and the trailing census/sweep read
 * vacuously empty around it.
 *
 * Split out of `reap.test.ts` at the 800-line cap — the seam is real: that
 * file doors the ordinary collection/reap paths, this one doors the failure
 * paths PID_READ_UNKNOWN and a null process table open up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectAgentRuns, reapAgentRuns, readProcTable, PID_READ_UNKNOWN } from './reap.mjs';

function errno(code: string, message = code): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(message);
  e.code = code;
  return e;
}

// ------------------------------------------------- collectAgentRuns: _logs/

test('control: a genuinely absent _logs/ (real ENOENT) yields no runs, exactly as today', () => {
  const runs = collectAgentRuns('/r', 0, {
    listDirs: () => {
      const e: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
      e.code = 'ENOENT';
      throw e;
    },
    readPid: () => 1,
  });
  assert.deepEqual(runs, []);
});

test('ROW 101 (RED) / M7-D finding 5: an unreadable (non-ENOENT) _logs/ must NOT empty the whole dispatch set', () => {
  // The OLD behaviour folded ANY listDirs failure into `[]` — the same shape
  // as "nothing was ever dispatched". `reapedPids` downstream then reads
  // vacuously empty and the trailing census/sweep proceeds while a real
  // dispatched agent may still be alive. A single sentinel row keeps the set
  // non-empty and refuses to be signalled (PID_READ_UNKNOWN is never a valid
  // pid), so the gap is reported by name instead of disappearing.
  const runs = collectAgentRuns('/r', 0, {
    listDirs: () => {
      const e: NodeJS.ErrnoException = new Error('EACCES: permission denied');
      e.code = 'EACCES';
      throw e;
    },
    readPid: () => 1,
  });
  assert.notDeepEqual(runs, [], 'an unreadable _logs/ must not read the same as an absent one');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].pid, PID_READ_UNKNOWN);
});

// ------------------------------------------------- collectAgentRuns: turn.pid

test('control: a session dir whose turn.pid is genuinely absent (real ENOENT, no markers) is skipped as today', () => {
  const runs = collectAgentRuns('/r', 0, {
    listDirs: () => [{ name: '_agent-x', mtimeMs: 10 }],
    readPid: () => null, // the real readPidFile default maps ENOENT to null
  });
  assert.deepEqual(runs, []);
});

test('ROW 101 (RED) / M7-D finding 4: a turn.pid unreadable for a reason OTHER than ENOENT is not silently dropped', () => {
  // Exercises the REAL readPidFile default via a real EACCES on the file.
  const root = mkdtempSync(join(tmpdir(), 'reap-pidfile-'));
  const dir = join(root, '_logs', '_agent-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '4242');
  chmodSync(join(dir, 'turn.pid'), 0o000);
  try {
    const runs = collectAgentRuns(root, 0);
    assert.equal(runs.length, 1, 'the row must not vanish just because markers.length === 0');
    assert.equal(runs[0].pid, PID_READ_UNKNOWN);
  } finally {
    chmodSync(join(dir, 'turn.pid'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test('reapAgentRuns (RED) / M7-D findings 4+5: a PID_READ_UNKNOWN row is refused by name, never silently skipped nor reaped', async () => {
  const sent: [number | string, string][] = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_unreadable', pid: PID_READ_UNKNOWN, markers: [] }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => new Map(),
    kill: (pid: number | string, sig: string) => { sent.push([pid, sig]); },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  } as any);
  assert.deepEqual(sent, [], 'an unreadable pid must never be signalled on a guess');
  assert.deepEqual(report.reaped, []);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /UNKNOWN|could not be read/i);
});

// ------------------------------------------------------------- readProcTable

test('readProcTable (RED) / ROW 101 M7-D finding 6: a listPids failure is UNKNOWN (null), never an empty table', () => {
  const table = readProcTable({ listPids: () => { throw new Error('EMFILE'); } });
  assert.equal(table, null, 'a table build failure must never render as "found nothing"');
});

test('readProcTable control: a real, empty process listing is a real empty Map, not null', () => {
  const table = readProcTable({ listPids: () => [], readStat: () => { throw new Error('unused'); } });
  assert.deepEqual(table, new Map());
});

test('reapAgentRuns (RED) / ROW 101 M7-D finding 6: a null process table refuses descendant/group claims, never crashes or silently reaps only the root', async () => {
  const sent: [number | string, string][] = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => null, // simulates a real /proc listing failure
    kill: (pid: number | string, sig: string) => { sent.push([pid, sig]); },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  } as any);
  // The recorded root itself is still signalled (cwd-verified provenance does
  // not depend on the table) — but the pass must NAME that descendants/groups
  // could not be verified, never silently claim a clean, complete reap.
  assert.deepEqual(sent, [[7, 'SIGTERM']]);
  assert.ok(
    report.skipped.some((s: { reason: string }) => /process table|descendant|group/i.test(s.reason)),
    `expected a named UNKNOWN line about the table: ${JSON.stringify(report.skipped)}`,
  );
});

test('readProcTable (RED) / ROW 102b finding 20: a non-ENOENT per-pid stat failure refuses the WHOLE table, never a partial one', () => {
  const table = readProcTable({
    listPids: () => [7, 8],
    readStat: (pid: number) => { if (pid === 8) throw errno('EACCES', 'permission denied'); return `${pid} (node) S 1 1 0`; },
  });
  assert.equal(table, null, 'a row that could not be verified must not silently drop out of a table reported as complete');
});

test('readProcTable control: a pid that exited between the listing and the read (real ENOENT) is an ordinary skip, table still built', () => {
  const table = readProcTable({
    listPids: () => [7, 8],
    readStat: (pid: number) => { if (pid === 8) throw errno('ENOENT', 'no such process'); return `${pid} (node) S 1 1 0`; },
  });
  assert.notEqual(table, null);
  assert.equal(table!.has(7), true);
  assert.equal(table!.has(8), false, 'a raced exit is skipped, not fabricated');
});

// --------------------------------------------------------------- isAlive

test('reapAgentRuns (RED) / ROW 102b finding 21: an EPERM on kill(pid,0) must read as ALIVE, not gone', async () => {
  // No injected isAlive here — this exercises the REAL default directly via
  // decideReap's `alive` gate: a recorded pid whose cwd is unreadable is only
  // refused (not signalled) when it is judged alive; if EPERM were folded
  // into "not alive" it would instead be admitted as `recorded`-provenance
  // and signalled — exactly the false "gone" ROW 102b/21 closes.
  const originalKill = process.kill;
  (process as any).kill = (pid: number, sig: number | string) => {
    if (sig === 0) throw errno('EPERM', 'operation not permitted');
    return true;
  };
  try {
    const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 4242, markers: [] }], {
      ownRoot: '/r',
      cwdOf: () => undefined, // unreadable cwd
      procTable: () => new Map(),
      kill: () => { throw new Error('must never be called for a foreign, EPERM pid'); },
      graceMs: 20,
      pollMs: 5,
      sleep: async () => {},
    } as any);
    assert.deepEqual(report.reaped, []);
    assert.equal(report.skipped.length, 1);
    assert.match(report.skipped[0].reason, /alive but its cwd is unreadable/, 'EPERM must be read as alive, not as gone');
  } finally {
    process.kill = originalKill;
  }
});

test('reapAgentRuns control: an ESRCH on kill(pid,0) (genuinely gone) still reaps by record, as today', async () => {
  const originalKill = process.kill;
  let signalled: [number, number | string] | null = null;
  (process as any).kill = (pid: number, sig: number | string) => {
    if (sig === 0) throw errno('ESRCH', 'no such process');
    signalled = [pid, sig];
    return true;
  };
  try {
    const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 4242, markers: [] }], {
      ownRoot: '/r',
      cwdOf: () => undefined, // unreadable cwd — provenance falls back to "recorded"
      procTable: () => new Map(),
      kill: (pid: number | string, sig: number | string) => { signalled = [pid as number, sig]; },
      graceMs: 20,
      pollMs: 5,
      sleep: async () => {},
    } as any);
    assert.equal(report.reaped.length, 1, 'a genuinely-gone (ESRCH) recorded pid is still reaped by record provenance');
  } finally {
    process.kill = originalKill;
  }
});
