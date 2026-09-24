/**
 * `collectSpendDirs` — bead `forge-rzrs`.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `collectAgentRuns`. The spend total was
 * built from the REAPER's collector, whose last gate is
 * `if (pid === null && markers.length === 0) continue` (`reap.mjs:190`). That
 * gate is right for a reaper — it finds the directories it could KILL — and
 * wrong for money: a cycle's phase directory carries no `turn.pid`, so on S10
 * run 15 the project-manager's $0.6774 never reached an ENFORCED $35 ceiling.
 *
 * A dispatch that SPENT is one that wrote an event log. That is the whole
 * rule, and it is deliberately not "a dispatch we can kill".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { collectSpendDirs, spendSoFar, readDispatchSnapshot } from './run-observe.mjs';
import { collectAgentRuns } from './reap.mjs';

function root() {
  const d = mkdtempSync(join(tmpdir(), 'spenddirs-'));
  mkdirSync(join(d, '_logs'), { recursive: true });
  return d;
}
/** A dispatch directory, optionally with an event log and a reapable pid. */
function dispatch(r: string, name: string, opts: { events?: boolean; pid?: boolean; ageMs?: number } = {}) {
  const dir = join(r, '_logs', name);
  mkdirSync(dir, { recursive: true });
  if (opts.events !== false) writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1"}\n');
  if (opts.pid) writeFileSync(join(dir, 'turn.pid'), '12345\n');
  if (opts.ageMs) {
    const t = (Date.now() - opts.ageMs) / 1000;
    utimesSync(dir, t, t);
  }
  return dir;
}

describe('collectSpendDirs — a dispatch that SPENT is one that wrote an event log', () => {
  test('forge-rzrs: a cycle dir with NO turn.pid is collected — this is the $0.6774 that went missing', () => {
    const r = root();
    dispatch(r, '_architect-2026-09-12T07-21-30-e437f510', { pid: true });
    dispatch(r, '2026-09-12T07-28-42_INIT-2026-09-12-exclude-author-flag');

    const got = collectSpendDirs(r, 0).map((d) => basename(d));

    assert.equal(got.length, 2, `both dispatches must be collected — got ${JSON.stringify(got)}`);
    assert.ok(
      got.includes('2026-09-12T07-28-42_INIT-2026-09-12-exclude-author-flag'),
      'the cycle dir carries no turn.pid and is exactly what the reaper-shaped collector skipped',
    );
  });

  test('forge-rzrs: a `_bridge-*` dir with a PRICED row and no pid is collected — A\u2019s S1 run 10 shape', () => {
    // SECOND INSTANCE, non-cycle (T1 872). A measured seven `_bridge-*` dirs in
    // an S1 run with no `turn.pid`, no marker, 1\u2013321 event lines and ZERO
    // priced rows — `reap.mjs:190` skipped every one, in a story that spawns no
    // cycle at all. The honest statement about that run is "every dir the
    // collector could not see happened to carry no spend", which is a fact
    // about those runs and not a property of the collector. This door pins the
    // case that would have cost money: the same shape, with a price on it.
    const r = root();
    const bridge = dispatch(r, '_bridge-2026-09-12T07-21-09-567-nmlci52h');

    // THE DOOR DISCRIMINATES, checked rather than assumed — it passed the
    // moment it was written, which is exactly when a door is most likely to be
    // vacuous. Measured on this fixture: `collectAgentRuns` returns 0 dirs and
    // `collectSpendDirs` returns 1, so a revert to the reaper-shaped collector
    // reds this test rather than sliding past it.
    assert.deepEqual(collectSpendDirs(r, 0), [bridge], 'no pid and no marker is not a reason to ignore a spend');
    assert.deepEqual(collectAgentRuns(r, 0), [], 'and the reaper-shaped collector is blind to it — that is the bug');
  });

  test('forge-rzrs: a directory with no event log is NOT collected — nothing there can have been priced', () => {
    const r = root();
    dispatch(r, '_bridge-2026-09-12T07-21-09-567-nmlci52h', { events: false });

    assert.deepEqual(collectSpendDirs(r, 0), []);
  });

  test('forge-rzrs: dispatches older than the run are NOT collected — a previous run\'s spend is not this run\'s', () => {
    const r = root();
    dispatch(r, 'old-run', { ageMs: 60 * 60 * 1000 });
    const mine = dispatch(r, 'this-run');

    const got = collectSpendDirs(r, Date.now() - 60_000);

    assert.deepEqual(got, [mine], 'only the dispatch inside this run\'s window counts');
  });

  test('forge-rzrs: a missing _logs is [] and not a throw — an absent log is UNMEASURED upstream, never a crash here', () => {
    assert.deepEqual(collectSpendDirs(mkdtempSync(join(tmpdir(), 'nologs-')), 0), []);
  });
});

/**
 * `spendSoFar` — the seam the beat boundary decides on (bead `forge-91cr`).
 *
 * THE VERDICT MUST COME BACK AS A VALUE. When this function was split out of
 * `run.mjs`, `spendCeilingVerdict`'s result was rendered into `lines` and
 * returned nowhere else; the caller's `if (v.breached)` kept reading a name
 * that no longer existed, so every costed run threw `ReferenceError` at beat 1
 * and skipped the reap that kills the agents it started. Both halves were
 * right and the seam was tested by nothing (§15.500), so these read exactly
 * what the caller destructures.
 *
 * The priced row below is COPIED from a real architect session's events.jsonl
 * (S10 run 10, one `architect.turn-cost` end row, trimmed to nothing) rather
 * than written from a description of one — §15.497, and the $5.0606 lesson.
 */
const CAPTURED_PRICED_ROW =
  '{"event_id":"EV_mtwnijie_xmiyxnoc","cycle_id":"_architect-2026-09-11T07-44-18-503beae4",' +
  '"started_at":"2026-09-11T07:45:11.750Z",' +
  '"initiative_id":"architect-session-2026-09-11T07-44-18-503beae4","phase":"architect",' +
  '"skill":"architect","event_type":"end","input_refs":[],"output_refs":[],' +
  '"cost_usd":0.6000446500000001,"message":"architect.turn-cost"}';

/** A worktree whose `_logs` holds one dispatch that priced itself. */
function rootWithOnePricedDispatch(): string {
  const root = mkdtempSync(join(tmpdir(), 'spend-so-far-'));
  const dir = join(root, '_logs', '_architect-2026-09-11T07-44-18-503beae4');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${CAPTURED_PRICED_ROW}\n`);
  return root;
}

describe('spendSoFar: the beat boundary reads a verdict, not a sentence', () => {
  test('forge-91cr: the caller\'s own destructure — { verdict, lines } — is satisfied, and breached is a boolean', () => {
    const r = spendSoFar({
      root: rootWithOnePricedDispatch(), startedMs: 0, realSpawn: true,
      ceilingUsd: 35, label: 'after beat 1',
    });
    assert.ok(Object.hasOwn(r, 'verdict'), 'the halt decision must leave this function as a value');
    assert.equal(typeof r.verdict.breached, 'boolean', 'a caller cannot branch on prose');
    assert.equal(typeof r.verdict.known, 'boolean');
    assert.ok(Array.isArray(r.lines) && r.lines.length > 0);
  });

  test('forge-91cr: over the ceiling, the returned verdict says BREACHED and the line agrees with it', () => {
    const r = spendSoFar({
      root: rootWithOnePricedDispatch(), startedMs: 0, realSpawn: true,
      ceilingUsd: 0.5, label: 'after beat 1',
    });
    assert.equal(r.verdict.breached, true, `$0.6000 against a $0.50 ceiling: ${r.verdict.reason}`);
    assert.equal(r.spend.measured, true);
    assert.match(r.lines[0]!, /EXCEEDED/, 'the printed line and the returned value are the same verdict');
  });

  test('forge-91cr: under the ceiling it does not halt, and it still prints the running total', () => {
    const r = spendSoFar({
      root: rootWithOnePricedDispatch(), startedMs: 0, realSpawn: true,
      ceilingUsd: 35, label: 'after beat 4',
    });
    assert.equal(r.verdict.breached, false);
    assert.equal(r.verdict.known, true);
    assert.match(r.lines[0]!, /after beat 4: \$0\.6000 of \$35\.00/);
  });
});

/**
 * `readDispatchSnapshot` — the read half of the UNMEASURED discriminator
 * (bead `forge-8vfn.7.6.76`). `classifyUnmeasuredDispatch` (`spend.mjs`) is
 * the pure judgement over two of these; this is what takes ONE, with every
 * fs/pid touch injected so no test reads a real `/proc`.
 */
describe('readDispatchSnapshot: one read, every seam injected', () => {
  test('7.6.76: eventLines reuses readRunEvents — "many lines" means what the spend accounting means by it', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T07-00-00-aaaaaaaa');
    writeFileSync(join(dir, 'events.jsonl'), '{"a":1}\n{"a":2}\n{"a":3}\n');
    const s = readDispatchSnapshot(dir, { readPid: () => null, isAlive: () => false, readStderrTail: () => '' });
    assert.equal(s.eventLines, 3);
  });

  test('7.6.76: a pid the injected isAlive reports as live is alive; the seam is never a real /proc', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T07-00-00-bbbbbbbb');
    writeFileSync(join(dir, 'turn.pid'), '999999\n');
    const calls: number[] = [];
    const s = readDispatchSnapshot(dir, {
      isAlive: (pid: number) => { calls.push(pid); return true; },
      readStderrTail: () => '',
    });
    assert.equal(s.pid, 999999);
    assert.equal(s.alive, true);
    assert.deepEqual(calls, [999999], 'isAlive must be asked about the pid readPid actually found');
  });

  test('7.6.76: no turn.pid at all is pid: null and never asked to isAlive', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T07-00-00-cccccccc');
    let asked = false;
    const s = readDispatchSnapshot(dir, { isAlive: () => { asked = true; return true; }, readStderrTail: () => '' });
    assert.equal(s.pid, null);
    assert.equal(s.alive, false);
    assert.equal(asked, false, 'a pid that was never found is never asked whether it is alive');
  });

  test('7.6.76: the stderr tail seam is what the snapshot carries, verbatim', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T07-00-00-dddddddd');
    const s = readDispatchSnapshot(dir, { isAlive: () => false, readStderrTail: () => 'FATAL: worker exited' });
    assert.equal(s.stderrTail, 'FATAL: worker exited');
  });

  test('7.6.76: an unrecorded exit code reads as null, not a false 0 — no on-disk convention exists yet', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T07-00-00-eeeeeeee');
    const s = readDispatchSnapshot(dir, { isAlive: () => false, readStderrTail: () => '' });
    assert.equal(s.exitCode, null);
  });
});

/**
 * `spendSoFar` PRINTS the classifier's arm — bead `forge-8vfn.7.6.76`, closing
 * the gap a classifier only reachable by import left open. The previous read
 * lives in a `Map` the CALLER owns (the run loop's own state, never a module
 * global — two concurrent runs must never share one), passed in as
 * `unmeasuredSnapshots` and updated in place so the next beat boundary's call
 * compares against this one.
 */
describe('spendSoFar prints the UNMEASURED classifier’s arm, threaded across calls', () => {
  test('7.6.76 (RED): a dispatch that grew between two calls prints IN FLIGHT, naming N', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T08-00-00-aaaaaaaa', { pid: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"a":1}\n{"a":2}\n'); // 2 unpriced lines
    const seams = { isAlive: () => true, readStderrTail: () => '' };
    const snapshots = new Map();

    const first = spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 1', unmeasuredSnapshots: snapshots, snapshotSeams: seams });
    assert.equal(first.spend.measured, false);
    assert.match(first.lines.join('\n'), new RegExp(`UNMEASURED ${basename(dir)} .*IN FLIGHT`), `call 1: ${first.lines.join('\n')}`);

    writeFileSync(join(dir, 'events.jsonl'), '{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n{"a":5}\n'); // grew to 5
    const second = spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 2', unmeasuredSnapshots: snapshots, snapshotSeams: seams });
    assert.match(
      second.lines.join('\n'),
      new RegExp(`UNMEASURED ${basename(dir)} .*IN FLIGHT.*grew by 3 line`),
      `N must be measured against call 1's OWN snapshot (2), not zero: ${second.lines.join('\n')}`,
    );
  });

  test('7.6.76 (RED): a dispatch whose log went STATIC between two calls prints REAPED\\/DIED, carrying stderr', () => {
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T08-00-00-bbbbbbbb', { pid: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"a":1}\n{"a":2}\n{"a":3}\n');
    const seams = { isAlive: () => true, readStderrTail: () => 'FATAL: worker exited' };
    const snapshots = new Map();

    const first = spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 1', unmeasuredSnapshots: snapshots, snapshotSeams: seams });
    assert.match(first.lines.join('\n'), /IN FLIGHT/, 'first read has nothing to compare against yet, so it reads as growth from zero');

    // events.jsonl UNCHANGED — nothing moved between the two reads.
    const second = spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 2', unmeasuredSnapshots: snapshots, snapshotSeams: seams });
    assert.match(
      second.lines.join('\n'),
      new RegExp(`UNMEASURED ${basename(dir)} .*REAPED/DIED`),
      `call 2: ${second.lines.join('\n')}`,
    );
    assert.match(second.lines.join('\n'), /FATAL: worker exited/, 'the stderr tail must ride along into the printed line');
  });

  test('7.6.76: the Map is genuinely per-call-site state — a FRESH Map on the next call forgets growth', () => {
    // The negative control for the wiring itself: without a shared Map, every
    // call reads as a first call (previous defaults to zero), so a caller that
    // forgot to thread the SAME Map would never see REAPED for a static log.
    const r = root();
    const dir = dispatch(r, '_architect-2026-09-12T08-00-00-cccccccc', { pid: true });
    writeFileSync(join(dir, 'events.jsonl'), '{"a":1}\n{"a":2}\n{"a":3}\n');
    const seams = { isAlive: () => true, readStderrTail: () => '' };

    spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 1', unmeasuredSnapshots: new Map(), snapshotSeams: seams });
    const second = spendSoFar({ root: r, startedMs: 0, realSpawn: true, ceilingUsd: 35, label: 'after beat 2', unmeasuredSnapshots: new Map(), snapshotSeams: seams });
    assert.match(second.lines.join('\n'), /IN FLIGHT/, 'a fresh Map has no memory of call 1, so call 2 reads as growth from zero again');
  });
});
