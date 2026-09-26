/**
 * spend-unknown-read.test.ts — m7-d-guard-unknown-audit.md rows 24-27, ROW
 * 102a (T1 1512/1520, M7-COMMON §6.15): a guard's catch returns explicit
 * UNKNOWN; the caller fails CLOSED with a NAMED line.
 *
 * FOUR READS, in `run-observe.mjs`, that used to fold a non-ENOENT failure
 * into the SAME shape as "nothing here": `readRunEvents`'s per-line parse and
 * its outer file read, and `collectSpendDirs`'s `_logs/` readdir and its
 * per-entry stat. ENOENT stays genuine absence in every one of them — a run
 * that dispatched nothing, or a dispatch dir that raced away between the
 * listing and the read. Anything else is UNKNOWN, carried on the returned
 * array as `.unknown` (never a second return shape, so every existing caller
 * that only wants rows/dirs keeps working), and `spendSoFar`/
 * `ceilingHaltVerdict` HALT on it exactly as they halt on a ledger row that
 * failed to write — never reading it as "$0" or "nothing dispatched".
 *
 * PLUS the coarse-clock exclusion `collectSpendDirs` shares with
 * `beats-queue-terminal.mjs`'s `FS_CLOCK_SLACK_MS`: a dispatch dir created at
 * or after `sinceMs` can still carry a kernel-coarse mtime that trails it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRunEvents, collectSpendDirs, spendSoFar } from './run-observe.mjs';
import { ceilingHaltVerdict, summariseRunSpend } from './spend.mjs';
import { FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ------------------------------------------------------------ readRunEvents

describe('readRunEvents — row 24 (per-line) and row 25 (outer read)', () => {
  test('ENOENT control: a dispatch dir with no events.jsonl at all is [] with no .unknown', () => {
    const dir = tmp('rre-enoent-');
    try {
      const rows = readRunEvents(dir);
      assert.deepEqual(rows, []);
      assert.equal((rows as any).unknown, undefined, 'absence must not be flagged as UNKNOWN');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('row 25 RED: a non-ENOENT outer read failure is [] carrying .unknown, never silent', () => {
    const dir = tmp('rre-eisdir-');
    try {
      // A DIRECTORY where the file belongs — the same EISDIR technique
      // `emit-fails-open.test.ts` uses for `readEmitFailures`'s own sibling
      // door, reliable regardless of who runs the suite (no chmod/uid game).
      mkdirSync(join(dir, 'events.jsonl'));
      const rows = readRunEvents(dir);
      assert.equal(rows.length, 0, 'no rows can be recovered from an unreadable log');
      assert.equal((rows as any).unknown?.length, 1, `must carry .unknown, not read as absence:\n${JSON.stringify(rows)}`);
      assert.equal((rows as any).unknown[0].dir, dir);
      assert.match((rows as any).unknown[0].error, /EISDIR/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('row 24 RED: a torn/unparseable line is counted evidence, not a silent {}', () => {
    const dir = tmp('rre-torn-');
    try {
      writeFileSync(
        join(dir, 'events.jsonl'),
        '{"event_id":"EV_1","cost_usd":0.5}\nnot-json-at-all\n{"event_id":"EV_2","cost_usd":0.25}\n',
      );
      const rows = readRunEvents(dir);
      assert.equal(rows.length, 3, 'the torn line is a ROW, not a hole in the array');
      assert.equal((rows as any).unknown?.length, 1, `torn line must be counted evidence:\n${JSON.stringify(rows)}`);
      assert.match((rows as any).unknown[0].error, /unparseable event line/);
      // and it must never silently price itself
      const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
      assert.equal(spend.usd, 0.75, 'the two genuine rows still price normally');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('control: a clean, fully-parseable log carries no .unknown at all', () => {
    const dir = tmp('rre-clean-');
    try {
      writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1","cost_usd":0.5}\n');
      const rows = readRunEvents(dir);
      assert.equal(rows.length, 1);
      assert.equal((rows as any).unknown, undefined);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// --------------------------------------------------------- collectSpendDirs

describe('collectSpendDirs — row 26 (_logs readdir) and row 27 (per-entry stat)', () => {
  test('ENOENT control: a missing _logs is [] with no .unknown — a run that dispatched nothing', () => {
    const root = tmp('csd-enoent-');
    try {
      const dirs = collectSpendDirs(root, 0);
      assert.deepEqual(dirs, []);
      assert.equal((dirs as any).unknown, undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('row 26 RED: a non-ENOENT _logs readdir failure carries .unknown, never reads as "nothing dispatched"', () => {
    const root = tmp('csd-enotdir-');
    try {
      // A FILE where `_logs` belongs — readdirSync throws ENOTDIR, a non-ENOENT
      // failure a fixture can force without chmod/uid games.
      writeFileSync(join(root, '_logs'), 'not a directory');
      const dirs = collectSpendDirs(root, 0);
      assert.equal(dirs.length, 0, 'nothing can be enumerated');
      assert.equal((dirs as any).unknown?.length, 1, `must carry .unknown:\n${JSON.stringify(dirs)}`);
      assert.match((dirs as any).unknown[0].error, /ENOTDIR/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('row 27 RED: a non-ENOENT per-entry stat failure excludes that dir but names it in .unknown', () => {
    const root = tmp('csd-statfail-');
    const logsDir = join(root, '_logs');
    const good = join(logsDir, 'good-dispatch');
    const bad = join(logsDir, 'bad-dispatch');
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, 'events.jsonl'), '{"event_id":"EV_1"}\n');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'events.jsonl'), '{"event_id":"EV_2"}\n');
    try {
      // Read-only, no-execute on `_logs/` itself: readdir (which only needs
      // READ) still lists both names, but statSync into either entry (which
      // needs EXECUTE/search on the parent) throws EACCES — a real,
      // non-ENOENT failure, not a simulated one. Measured on this host.
      chmodSync(logsDir, 0o400);
      const dirs = collectSpendDirs(root, 0);
      assert.equal((dirs as any).unknown?.length, 2, `both entries' stat must fail under 0o400:\n${JSON.stringify(dirs)}`);
      for (const u of (dirs as any).unknown) assert.match(u.error, /EACCES/);
    } finally {
      chmodSync(logsDir, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('control: an ordinary, fully-readable tree collects normally with no .unknown', () => {
    const root = tmp('csd-clean-');
    const dir = join(root, '_logs', 'dispatch-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1"}\n');
    try {
      const dirs = collectSpendDirs(root, 0);
      assert.deepEqual(dirs, [dir]);
      assert.equal((dirs as any).unknown, undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('FS_CLOCK_SLACK_MS: a dir born at sinceMs but stamped just before it by the coarse clock is still counted', () => {
    const root = tmp('csd-slack-');
    const dir = join(root, '_logs', 'born-at-start');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1"}\n');
    const sinceMs = Date.now();
    // Stamp the dir's mtime just inside the slack window, BEFORE sinceMs —
    // the exact shape a coarse kernel clock produces for a dir created right
    // at run start (measured: a write strictly after an anchor stamped 1.1ms
    // before it).
    const staleBy = FS_CLOCK_SLACK_MS - 50;
    const t = (sinceMs - staleBy) / 1000;
    utimesSync(dir, t, t);
    try {
      const dirs = collectSpendDirs(root, sinceMs);
      assert.deepEqual(dirs, [dir], 'within the slack window, this dir is this run\'s own spend');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('control: a dir stamped well OUTSIDE the slack window is still excluded — a previous run\'s spend', () => {
    const root = tmp('csd-outside-slack-');
    const dir = join(root, '_logs', 'old-run');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1"}\n');
    const sinceMs = Date.now();
    const staleBy = FS_CLOCK_SLACK_MS + 5_000;
    const t = (sinceMs - staleBy) / 1000;
    utimesSync(dir, t, t);
    try {
      const dirs = collectSpendDirs(root, sinceMs);
      assert.deepEqual(dirs, [], 'the slack is a narrow clock-skew allowance, not a general grace window');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------- ceilingHaltVerdict / spendSoFar

describe('ceilingHaltVerdict — spendUnknown HALTS, never reads as $0 (rows 24-27)', () => {
  const SPEND_MEASURED = summariseRunSpend({
    realSpawn: true,
    events: [[{ event_id: 'e', cost_usd: 0.5, event_type: 'end', phase: 'architect' }]],
  });

  test('a populated spendUnknown halts even though the measured total is well under ceiling', () => {
    const stop = ceilingHaltVerdict({
      spend: SPEND_MEASURED, ceilingUsd: 35, unpriced: [],
      emitFailures: { failures: [], unreadable: [] },
      spendUnknown: [{ dir: '/tmp/x/_logs/mystery', error: 'EACCES: permission denied' }],
    });
    assert.equal(stop.halt, true, 'UNKNOWN spend must never read as headroom under a ceiling');
    assert.match(stop.reason, /could not be fully READ/);
    assert.match(stop.reason, /UNKNOWN, never zero/);
  });

  test('an empty/absent spendUnknown does not halt on its own — the control', () => {
    const stop = ceilingHaltVerdict({
      spend: SPEND_MEASURED, ceilingUsd: 35, unpriced: [],
      emitFailures: { failures: [], unreadable: [] },
      spendUnknown: [],
    });
    assert.equal(stop.halt, false);
  });

  test('a malformed spendUnknown (not an array) is treated as empty, never throws', () => {
    const stop = ceilingHaltVerdict({
      spend: SPEND_MEASURED, ceilingUsd: 35, unpriced: [],
      emitFailures: { failures: [], unreadable: [] },
      spendUnknown: 'not-an-array' as never,
    });
    assert.equal(stop.halt, false);
  });

  test('spendSoFar: an unreadable _logs/ HALTS the whole run, naming the path — not $0', () => {
    const root = tmp('ssf-unknown-');
    writeFileSync(join(root, '_logs'), 'not a directory'); // row 26 shape
    try {
      const r = spendSoFar({ root, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 1' });
      assert.equal(r.stop.halt, true, `spend UNKNOWN must halt a costed run: ${JSON.stringify(r.stop)}`);
      assert.equal(r.spendUnknown.length, 1);
      assert.match(r.lines.join('\n'), /this run's own spend could not be fully READ/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('spendSoFar control: a costed run with a genuinely clean, empty _logs/ does not halt on spendUnknown', () => {
    const root = tmp('ssf-clean-');
    mkdirSync(join(root, '_logs'), { recursive: true });
    try {
      const r = spendSoFar({ root, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 1' });
      assert.deepEqual(r.spendUnknown, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
