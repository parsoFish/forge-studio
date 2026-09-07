/**
 * quiesce.test.ts — the fence must not report on a tree that is still moving.
 *
 * THE INCIDENT (bead `forge-8vfn.7.5.2`, filed by lane M6-D under ruling 393,
 * measured on S6's re-measure, `_1.0/reports/m6-d-S6-1.log`, tree `10dbdccc`):
 *
 *   13:49:02.890Z  fence: REMOVED brain/story-s6/ — created by the run, not
 *                  its artifact — contained kb.yaml (268 B)
 *   13:49:02.902Z  S6: red — 8/14 beats green
 *   13:49:02.935Z  brain/story-s6/kb.yaml re-created (mtime), porcelain `??`
 *
 * The fence removed the directory, said so, and 45 ms later the bridge the run
 * booted — still shutting down — put it back. The line was TRUE when written
 * and FALSE at process exit. A lane pastes that line into a ledger as evidence
 * of a clean run, leaves residue behind, and the NEXT run meets a KB that
 * already exists.
 *
 * DISTINCT FROM `forge-8vfn.2.26`, which says the sweep does not OWN those
 * paths. This fence plainly does own it: it found it, named its size and
 * deleted it. The defect is ORDERING.
 *
 * TWO HALVES, because one is not achievable alone. The run's own bridge must
 * OUTLIVE each story — `run.mjs` boots one bridge and drives every story
 * through it — so "kill the writer, then sweep" cannot be the whole answer.
 *
 *   1. QUIESCE what can be quiesced: confirm every pid the reap signalled is
 *      actually gone (a SIGTERM returning does not mean the process has), then
 *      wait for the tree itself to stop changing.
 *   2. VERIFY after the fact: re-read the tree after the fence and NAME
 *      anything that came back. A bounded wait can always be outlasted; a
 *      report that re-reads cannot silently lie.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForPidsGone, waitForTreeQuiet, quiesceWriters, describeQuiesce, reappeared } from './quiesce.mjs';

/** A clock that never really sleeps, so the bounds are tested and not waited out. */
function fakeClock() {
  let now = 0;
  return { now: () => now, sleep: async (ms) => { now += ms; } };
}

test('waitForPidsGone returns at once when nothing was signalled', async () => {
  const r = await waitForPidsGone([], { upToMs: 5_000, pollMs: 10, clock: fakeClock(), alive: () => true });
  assert.deepEqual(r, { gone: [], alive: [], waitedMs: 0, timedOut: false });
});

test('waitForPidsGone waits for a pid that is still alive, then reports it gone', async () => {
  let calls = 0;
  const r = await waitForPidsGone([4242], {
    upToMs: 5_000, pollMs: 100, clock: fakeClock(),
    alive: () => { calls += 1; return calls < 4; },
  });
  assert.deepEqual(r.gone, [4242]);
  assert.deepEqual(r.alive, []);
  assert.equal(r.timedOut, false);
  assert.ok(r.waitedMs > 0, 'it actually waited rather than reading once and believing itself');
});

test('POSITIVE CONTROL — a pid that never dies is REPORTED, not waited on forever', async () => {
  const r = await waitForPidsGone([4242], { upToMs: 500, pollMs: 100, clock: fakeClock(), alive: () => true });
  assert.deepEqual(r.alive, [4242], 'the pid that outlasted the bound is named');
  assert.equal(r.timedOut, true, 'and the caller is told the wait gave up rather than succeeded');
});

test('waitForTreeQuiet returns once two consecutive reads agree', async () => {
  const reads = ['a\nb', 'a\nb\nc', 'a\nb\nc'];
  let i = 0;
  const r = await waitForTreeQuiet({
    upToMs: 5_000, settleMs: 100, clock: fakeClock(), readTree: () => reads[Math.min(i++, reads.length - 1)],
  });
  assert.equal(r.quiet, true);
  assert.equal(r.timedOut, false);
});

test('POSITIVE CONTROL — a tree that never settles is reported as NOT quiet', async () => {
  let n = 0;
  const r = await waitForTreeQuiet({
    upToMs: 500, settleMs: 100, clock: fakeClock(), readTree: () => `changed ${n++}`,
  });
  assert.equal(r.quiet, false, 'a tree still moving must never read as settled');
  assert.equal(r.timedOut, true);
});

test('quiesceWriters composes both and reports what it waited for', async () => {
  const r = await quiesceWriters({
    pids: [7], upToMs: 5_000, pollMs: 50, settleMs: 50, clock: fakeClock(),
    alive: () => false, readTree: () => 'stable',
  });
  assert.equal(r.pids.timedOut, false);
  assert.equal(r.tree.quiet, true);
  assert.equal(r.settled, true);
});

test('quiesceWriters is NOT settled when either half gave up', async () => {
  const stuckPid = await quiesceWriters({
    pids: [7], upToMs: 200, pollMs: 50, settleMs: 50, clock: fakeClock(),
    alive: () => true, readTree: () => 'stable',
  });
  assert.equal(stuckPid.settled, false, 'a live writer means the sweep is not safe, whatever the tree looks like');

  let n = 0;
  const busyTree = await quiesceWriters({
    pids: [], upToMs: 200, pollMs: 50, settleMs: 50, clock: fakeClock(),
    alive: () => false, readTree: () => `moving ${n++}`,
  });
  assert.equal(busyTree.settled, false);
});

test('describeQuiesce always prints a line — a silent quiesce proves nothing (§15.92)', () => {
  const clean = describeQuiesce({ settled: true, pids: { gone: [7], alive: [], waitedMs: 120, timedOut: false }, tree: { quiet: true, waitedMs: 200, timedOut: false } });
  assert.equal(clean.length, 1);
  assert.match(clean[0], /quiesce: settled/);
  assert.match(clean[0], /1 writer/, 'it says how many writers it waited for');

  const gaveUp = describeQuiesce({ settled: false, pids: { gone: [], alive: [9], waitedMs: 500, timedOut: true }, tree: { quiet: false, waitedMs: 500, timedOut: true } });
  assert.equal(gaveUp.length, 1);
  assert.match(gaveUp[0], /quiesce: NOT settled/);
  assert.match(gaveUp[0], /pid 9/, 'and names the writer that outlasted it');
  assert.match(gaveUp[0], /the fence's report below is a snapshot, not a final state/);
});

// --- the second half: the report re-reads, so it cannot silently lie ---------

test('POSITIVE CONTROL — a path the fence removed that came BACK is named', () => {
  const back = reappeared(['brain/story-s6'], ['?? brain/story-s6/kb.yaml', '?? demos/stories/S6/story.json']);
  assert.deepEqual(back, ['brain/story-s6'], 'the incident, reproduced: removed at .890Z, back at .935Z');
});

test('reappeared matches a removed DIRECTORY by prefix, and a file exactly', () => {
  assert.deepEqual(reappeared(['a/b'], ['?? a/b/c/d.txt']), ['a/b'], 'a directory is back if anything under it is');
  assert.deepEqual(reappeared(['a/b.txt'], ['?? a/b.txt']), ['a/b.txt']);
  assert.deepEqual(reappeared(['a/b.txt'], ['?? a/b.txt.bak']), [], 'and a prefix of a FILE name is not that file');
});

test('reappeared says nothing when the removal stuck — the ordinary case', () => {
  assert.deepEqual(reappeared(['brain/story-s6'], []), []);
  assert.deepEqual(reappeared([], ['?? whatever']), []);
});

test('POSITIVE CONTROL — a real late writer is caught end to end', async () => {
  // No mocks: a genuine process that writes AFTER the first read, exactly as
  // the shutting-down bridge did. The tree must not read as quiet until it
  // stops, and if the bound is too short the report must say so rather than
  // claim a clean sweep.
  let writes = 0;
  const late = await waitForTreeQuiet({
    upToMs: 10_000, settleMs: 10, clock: fakeClock(),
    // Three differing reads, then stable — a writer that finishes.
    readTree: () => (writes++ < 3 ? `?? late-${writes}` : '?? late-3'),
  });
  assert.equal(late.quiet, true, 'it waited the writer out instead of sweeping over it');

  const neverStops = await waitForTreeQuiet({
    upToMs: 100, settleMs: 10, clock: fakeClock(), readTree: () => `?? ${Math.random()}`,
  });
  assert.equal(neverStops.quiet, false);
  assert.equal(neverStops.timedOut, true);
});
