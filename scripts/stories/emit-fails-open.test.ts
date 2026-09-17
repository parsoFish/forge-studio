/**
 * A ledger row that FAILS TO WRITE stops the run — `forge-8vfn.7.6.103`,
 * T1 rulings 1037 and 1039.
 *
 * WHAT WAS BROKEN. Both row emitters wrapped `logger.emit` in `catch {}`, and
 * `reportUnpriced` wrapped the callback in another. So a write failure — full
 * disk, revoked handle, read-only logdir — left NO ROW. `endedUnpricedTurns`
 * saw nothing, and a funded run carried on indistinguishable from one whose
 * turns were priced normally. Nothing anywhere counted emit failures. Found by
 * 7.6.73's own security review; inherited from 7.6.55, not introduced there.
 *
 * THE SIGNAL CANNOT BE THE ROW, because the row is what could not be written.
 * Hence a `.emit-failed` sidecar in the same directory, read by `spendSoFar`
 * beside `events.jsonl`.
 *
 * THE READ FAILS CLOSED, and that is the whole risk of the fix (C's review). A
 * reader wrapped in `catch { return [] }` would reproduce the original defect
 * one layer out — and worse, because the failures are CORRELATED: whatever
 * broke the row write is likely to break this read, so the case where the
 * sidecar matters most is the case where reading it is least likely to work.
 * Three states: ENOENT is absence; anything else is UNKNOWN and halts.
 *
 * EVERY ASSERTION HERE GOES THROUGH `ceilingHaltVerdict`, never through the
 * emitter (993(d)'s shape): the claim is that the RUN STOPS, not that a field
 * was set. A door that read the emitter would pass while the halt never fired.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import {
  emitTurnCostRow, emitTurnEndedUnpricedRow,
  EMIT_FAILED_SIDECAR, EMIT_FAILED_STDERR_MARKER,
} from '@forge/sessions/turn-cost-rows.ts';

import { readEmitFailures } from './run-observe.mjs';
import { ceilingHaltVerdict, summariseRunSpend } from './spend.mjs';

const ID = {
  initiativeId: 'architect-session-s1',
  phase: 'architect' as const,
  skill: 'architect',
  message: 'architect.turn-cost',
};

/** A logger whose emit always throws — the write failure, made reachable. */
function brokenLogger(logFilePath: string) {
  return {
    emit: () => { throw new Error('ENOSPC: no space left on device'); },
    cycleId: 'c',
    logFilePath,
  } as never;
}

/** The REAL shape, built by the real summariser — `{measured, usd, label,
 *  priced, notes}`. A hand-rolled `{ totalUsd }` never breaches, which is a
 *  door asserting against a fixture the code does not recognise. */
function spendOf(usd: number) {
  return summariseRunSpend({
    realSpawn: true,
    events: [[{ event_id: 'e', cost_usd: usd, event_type: 'end', phase: 'architect' }]],
  } as never);
}
const SPEND = spendOf(0.5);

/** `ceilingUsd` is passed EXPLICITLY at every call site, never defaulted. In JS
 *  a default parameter fires on `undefined`, so `verdict(r, undefined)` silently
 *  became `9` and the no-ceiling door tested the ceiling case instead — it
 *  passed while proving the opposite of its name. Removing the default then
 *  broke three doors that had been relying on it, which is the same fact from
 *  the other side: a default shared by cases that disagree about it is a fixture
 *  deciding the experiment. */
const verdict = (emitFailures: unknown, ceilingUsd?: number) =>
  ceilingHaltVerdict({ spend: SPEND, ceilingUsd, unpriced: [], emitFailures } as never);

describe('7.6.103 — an unwritable ledger row stops the run', () => {
  test('a failed COST row lands in the sidecar and halts through the verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'emit-fail-'));
    try {
      const dir = join(root, 'c1');
      mkdirSync(dir, { recursive: true });
      emitTurnCostRow(brokenLogger(join(dir, 'events.jsonl')), ID, 1.25);

      assert.ok(existsSync(join(dir, EMIT_FAILED_SIDECAR)), 'the failure is recorded where the row could not go');
      const r = readEmitFailures(dir);
      assert.equal(r.failures.length, 1, `one recorded failure:\n${JSON.stringify(r, null, 2)}`);
      assert.match(String(r.failures[0].error), /ENOSPC/, 'and it carries the cause, not just the fact');
      assert.deepEqual(r.unreadable, []);

      const stop = verdict(r, 9);
      assert.equal(stop.halt, true, 'the RUN STOPS — asserted through the verdict, not the emitter');
      assert.equal(stop.kind, 'row-write-failed');
      assert.match(stop.reason, /FLOOR, not a measurement/,
        'and says WHY the headroom cannot be consulted: it is computed from the ledger in doubt');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a failed UNPRICED row halts too — silence on top of silence', () => {
    const root = mkdtempSync(join(tmpdir(), 'emit-fail-u-'));
    try {
      const dir = join(root, 'c1');
      mkdirSync(dir, { recursive: true });
      emitTurnEndedUnpricedRow(brokenLogger(join(dir, 'events.jsonl')),
        { ...ID, message: 'architect.turn-ended-unpriced' }, { reason: 'died', tokensOut: 75 });
      const stop = verdict(readEmitFailures(dir), 9);
      assert.equal(stop.halt, true,
        'the row that says "this turn was never priced" is itself the row that failed to write');
      assert.equal(stop.kind, 'row-write-failed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('THE READ FAILS CLOSED: an unreadable sidecar is UNKNOWN and halts', () => {
    // C's finding, and the failure this bead would otherwise have reproduced
    // one layer out. `catch { return [] }` here would be the original defect.
    const root = mkdtempSync(join(tmpdir(), 'emit-unread-'));
    try {
      const dir = join(root, 'c1');
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, EMIT_FAILED_SIDECAR));   // a DIRECTORY where a file belongs
      const r = readEmitFailures(dir);
      assert.equal(r.failures.length, 0);
      assert.equal(r.unreadable.length, 1, `unreadable, not absent:\n${JSON.stringify(r, null, 2)}`);

      const stop = verdict(r, 9);
      assert.equal(stop.halt, true, 'UNKNOWN never resolves toward proceeding (§15.504)');
      assert.equal(stop.kind, 'row-write-failed');
      assert.match(stop.reason, /unreadable is UNKNOWN, not absent/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('ENOENT is genuine ABSENCE — no sidecar means no failure, and nothing halts', () => {
    const root = mkdtempSync(join(tmpdir(), 'emit-none-'));
    try {
      const dir = join(root, 'c1');
      mkdirSync(dir, { recursive: true });
      const r = readEmitFailures(dir);
      assert.deepEqual(r, { failures: [], unreadable: [] },
        'the three states must not collapse into two in the other direction either');
      assert.equal(verdict(r, 9).halt, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('GATED ON `enforceable`: a run with NO ceiling does not halt on a failed row', () => {
    // 1039, and the reading C caught inside "always". Unconditional would make
    // this the first verdict here able to stop a run with no spend bound, and
    // every costless CI story would halt on a read-only logdir.
    const r = { failures: [{ message: 'architect.turn-cost', error: 'ENOSPC' }], unreadable: [] };
    assert.equal(verdict(r).halt, false, 'no declared ceiling = no bound to go blind about');
    assert.equal(verdict(r, 9).halt, true, 'but under a real ceiling it stops');
  });

  test('ORDER: a BREACH outranks a failed row — a number beats an unknown', () => {
    const stop = ceilingHaltVerdict({
      spend: spendOf(12), ceilingUsd: 9, unpriced: [],
      emitFailures: { failures: [{ message: 'm', error: 'ENOSPC' }], unreadable: [] },
    } as never);
    assert.equal(stop.kind, 'breach',
      'a run that genuinely exceeded its ceiling says so, rather than reporting an infrastructure fault');
  });

  test('ORDER: a failed row outranks `unenforceable` — infrastructure above product', () => {
    const stop = ceilingHaltVerdict({
      spend: SPEND, ceilingUsd: 9,
      unpriced: [{ reason: 'died', tokensIn: 1, tokensOut: 1, sessionId: 's' }],
      emitFailures: { failures: [{ message: 'm', error: 'ENOSPC' }], unreadable: [] },
    } as never);
    assert.equal(stop.kind, 'row-write-failed',
      'a judgement, not a derivation: operator-actionable fault ahead of a product behaviour');
  });

  test('THE NAMED RESIDUAL: sidecar unwritable too -> stderr marker, run continues blind', () => {
    // T1 1037(a) required this be DOORED, not merely described: prose alone is
    // the door-run-once shape. The run continuing blind here is the KNOWN hole,
    // asserted so that anyone who later "fixes" it has to change this door.
    const root = mkdtempSync(join(tmpdir(), 'emit-residual-'));
    const dir = join(root, 'c1');
    try {
      mkdirSync(dir, { recursive: true });
      const written: string[] = [];
      const realWrite = process.stderr.write.bind(process.stderr);
      (process.stderr as { write: unknown }).write = (chunk: string) => { written.push(String(chunk)); return true; };
      try {
        chmodSync(dir, 0o500);                       // readable, NOT writable
        emitTurnCostRow(brokenLogger(join(dir, 'events.jsonl')), ID, 1.25);
      } finally {
        (process.stderr as { write: unknown }).write = realWrite;
        chmodSync(dir, 0o700);
      }

      assert.ok(written.some((l) => l.includes(EMIT_FAILED_STDERR_MARKER)),
        `the only remaining trace must be emitted:\n${JSON.stringify(written, null, 2)}`);
      assert.ok(written.some((l) => l.includes('ENOSPC')), 'carrying the original emit error');
      assert.equal(existsSync(join(dir, EMIT_FAILED_SIDECAR)), false, 'and no sidecar was written');

      // THE HOLE, asserted as a hole: nothing the runner reads has changed.
      const stop = verdict(readEmitFailures(dir));
      assert.equal(stop.halt, false,
        'PROVING THE RESIDUAL, not the desired behaviour: the runner does not parse stderr, so the run ' +
        'continues blind. Closing this would need a fourth layer that itself depends on writing something, ' +
        'or a throw that destroys a turn which already ran and cost money (849).');
    } finally { chmodSync(dir, 0o700); rmSync(root, { recursive: true, force: true }); }
  });

  test('a successful emit writes NO sidecar — the happy path gains no side effect', () => {
    const root = mkdtempSync(join(tmpdir(), 'emit-ok-'));
    try {
      const logger = createLogger('c1', root);
      emitTurnCostRow(logger, ID, 1.25);
      const dir = join(root, 'c1');
      assert.equal(existsSync(join(dir, EMIT_FAILED_SIDECAR)), false);
      assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /architect\.turn-cost/,
        'and the row itself still lands');
      assert.equal(verdict(readEmitFailures(dir), 9).halt, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
