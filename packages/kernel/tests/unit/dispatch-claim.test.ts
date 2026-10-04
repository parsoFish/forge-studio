/**
 * Row 206 (forge-8vfn.8.5.56) orchestrator review HIGH-1/MEDIUM-2/MEDIUM-3 —
 * `claimDispatchSlot`/`releaseDispatchSlot` as a standalone kernel primitive,
 * so `spawnPreflightFix` (apps/forge) and `spawnBrainFix` (@forge/knowledge)
 * can reuse the SAME claim the agent-dispatch seam uses, instead of each
 * copying it. `isAlive` is an injected parameter rather than an import of
 * `@forge/sessions`' real `isTurnAlive` — this package is rank 1 and sessions
 * is rank 4 (the same rank problem `packages/agents/bridge-agents-run-state.ts`
 * already documents for the same function).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { claimDispatchSlot, releaseDispatchSlot, CLAIM_PLACEHOLDER_STALE_MS, newRunStamp, randomRunSuffix } from '../../dispatch-claim.ts';
import { DispatchInFlight } from '../../http-envelope.ts';

const alwaysAlive = () => true;
const neverAlive = () => false;

function readPid(logsRoot: string, logDirName: string): string {
  return readFileSync(join(logsRoot, logDirName, 'turn.pid'), 'utf8');
}

test('claimDispatchSlot: an empty slot claims cleanly, leaving the CLAIMING placeholder', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-empty-'));
  try {
    mkdirSync(join(root, '_logs'), { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    assert.match(readPid(join(root, '_logs'), 'run-1'), /claiming/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot: a live, owned holder refuses a second claim with a typed DispatchInFlight naming the holder pid', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-live-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive),
      (err: unknown) => {
        assert.ok(err instanceof DispatchInFlight);
        assert.equal((err as DispatchInFlight).holderPid, 4242);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot: a dead-pid holder (isAlive -> false) is cleared and reclaimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-dead-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '9999\n');
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    assert.match(readPid(logsRoot, 'run-1'), /claiming/i, 'the dead pid must be replaced by a fresh claim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-2: a CLAIMING placeholder older than CLAIM_PLACEHOLDER_STALE_MS is cleared and reclaimed (a crash mid-claim must not wedge the run id forever)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-stale-placeholder-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    // First claim leaves the CLAIMING placeholder, as a crash between the
    // claim and the real pid overwrite would.
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    const pidPath = join(logsRoot, 'run-1', 'turn.pid');
    // Back-date the placeholder past the stale bound.
    const old = (Date.now() - CLAIM_PLACEHOLDER_STALE_MS - 1_000) / 1000;
    utimesSync(pidPath, old, old);

    // A SECOND claim must not be refused as in-flight — the placeholder is
    // abandoned, not a live claim.
    assert.doesNotThrow(() => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-2 (negative): a CLAIMING placeholder YOUNGER than the stale bound is treated as genuinely in flight', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-fresh-placeholder-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    // Fresh placeholder (no utimesSync back-dating) — a second claim right
    // behind it must be refused, not silently reclaimed.
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive),
      (err: unknown) => err instanceof DispatchInFlight,
      'a fresh CLAIMING placeholder must refuse a second claim, not be treated as abandoned',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-3: a containment-rejected claim (guardedWriteFileExclusive -> null) fails closed — refuses, never proceeds unclaimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-containment-'));
  const outside = mkdtempSync(join(tmpdir(), 'dispatch-claim-containment-OUTSIDE-'));
  const logsRoot = join(root, '_logs');
  try {
    // A symlinked leaf makes guardedWriteFileExclusive return null (the
    // same escape path-guard-exclusive-write.test.ts's row-206-C pins).
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    symlinkSync(outside, join(logsRoot, 'run-1', 'turn.pid'));
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive),
      /refus|contain/i,
      'a containment rejection must throw, not silently return as if claimed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('releaseDispatchSlot: removes the claim; a no-op (never throws) when nothing is claimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-release-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    releaseDispatchSlot(root, 'run-1');
    // Released -> claimable again with no trace of the old placeholder.
    assert.doesNotThrow(() => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive));
    releaseDispatchSlot(root, 'never-claimed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HIGH-1: two run-id mints within the same millisecond (stubbed Date.now) are distinct, via randomRunSuffix', () => {
  const realNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    const a = `prefix-${Date.now().toString(36)}-${randomRunSuffix()}`;
    const b = `prefix-${Date.now().toString(36)}-${randomRunSuffix()}`;
    assert.notEqual(a, b, 'two mints in the same millisecond must not collide');
  } finally {
    Date.now = realNow;
  }
});

test('newRunStamp: sortable leading timestamp, non-empty random tail, charset safe for a path segment', () => {
  const a = newRunStamp();
  const b = newRunStamp();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9A-Za-z-]+$/, 'must be a safe path segment (no colons/dots/slashes)');
});

// ---------------------------------------------------------------------------
// Row 206 regression (m7-e-r206-fixgate-s1 capture) — "a turn writes its
// run-level `end` and then takes a moment to exit; LIVE must mean 'has not
// written its end', never 'pid not yet reaped'." A holder the OS still
// reports alive is no longer in flight once ITS OWN run-level end is on
// disk, per `holderHasEnded` (judged against the MARK recorded when this
// holder's claim was minted, never a value recomputed now — see the
// double-press tests below for why the mark, not a fresh read, is load-
// bearing).
// ---------------------------------------------------------------------------

function appendRunLevelRow(
  logsRoot: string,
  logDirName: string,
  eventType: 'start' | 'end',
  metadata: Record<string, unknown> = {},
): void {
  const row = {
    event_id: `EV_${eventType}_${Math.random().toString(36).slice(2, 8)}`,
    cycle_id: logDirName,
    initiative_id: logDirName,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: eventType,
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    metadata,
  };
  mkdirSync(join(logsRoot, logDirName), { recursive: true });
  appendFileSync(join(logsRoot, logDirName, 'events.jsonl'), `${JSON.stringify(row)}\n`);
}

test('row 206 follow-up: a holder the OS reports ALIVE but whose own run-level END is already on disk (since its claim mark) is NOT in flight — the claim proceeds', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-ended-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    // Mint the FIRST claim for real, so its own mark is recorded at the
    // moment the slot was empty (mark = 0 — nothing in events.jsonl yet).
    claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n'); // the "real pid" overwrite finalizeSpawnedTurn does
    // The holder's own turn runs: a run-level start, then its run-level end.
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    appendRunLevelRow(logsRoot, 'run-1', 'end', { session_id: 'x', phase: 'awaiting-review' });
    // alwaysAlive simulates the OS still reporting pid 4242 as running
    // (writing its own end and then taking a moment to exit) — the claim
    // must still proceed.
    assert.doesNotThrow(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }),
      'a holder whose own run-level end is already on disk must not refuse a live claim as DispatchInFlight',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 follow-up: a holder the OS reports ALIVE with only an OPEN run-level start (no end yet, since its claim mark) is still refused — 409', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-open-start-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }),
      (err: unknown) => err instanceof DispatchInFlight,
      'an open start with no end yet must still refuse a second claim while the holder is alive',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 follow-up: hook sub-turns and pricing-only end rows are never mistaken for the run-level boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-hook-pricing-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    // A hook fired mid-turn: its own start/end pair, same dir, NOT the
    // run-level boundary (no `phase` in its metadata either way).
    appendFileSync(
      join(logsRoot, 'run-1', 'events.jsonl'),
      `${JSON.stringify({ event_id: 'EV_hook', phase: 'architect', skill: 'hook:pre-tool', event_type: 'end', input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: 'x', phase: 'drafting' } })}\n`,
    );
    appendFileSync(
      join(logsRoot, 'run-1', 'events.jsonl'),
      `${JSON.stringify({ event_id: 'EV_price', phase: 'architect', skill: 'architect-runner', event_type: 'end', input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: 'x', phase: 'drafting', priced: false } })}\n`,
    );
    // Still no REAL run-level end (just the open start + a hook end + a
    // pricing-only end) — the holder must still read as in flight.
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }),
      (err: unknown) => err instanceof DispatchInFlight,
      'a hook end or a pricing-only end must never be read as the turn\'s own run-level boundary',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 follow-up: sessionTurnShape requires metadata.phase — a standalone (runAgent/fix-turn) end with no phase key still counts as the run-level boundary when sessionTurnShape is OMITTED', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-standalone-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    // No `sessionTurnShape` — the standalone (runAgent/fix-turn) shape, whose
    // run-level rows carry NO metadata.phase at all.
    claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive);
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    appendRunLevelRow(logsRoot, 'run-1', 'start', { agent_slug: 'x' });
    appendRunLevelRow(logsRoot, 'run-1', 'end', { agent_slug: 'x' });
    assert.doesNotThrow(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive),
      'a standalone channel\'s own end (no metadata.phase) must still free the slot when sessionTurnShape is not requested',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The amendment: "last run-level row is an end -> finished" is ALSO true for
// a holder that was JUST reclaimed and has not written its own start yet —
// for the first moments of the new turn the log still ends with the
// PREVIOUS holder's end. The mark recorded at claim time (not a value
// recomputed now) is what tells the two apart: row 202's double-start, two
// dispatches 5ms apart, both spawned before either logged.
// ---------------------------------------------------------------------------

test('row 202 double-start (mark-based fix): a log that ALREADY ends in an end, then two back-to-back dispatches -> exactly the FIRST claims, the second is refused — the second must not read the FIRST holder\'s pre-mark history as its own', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-double-press-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    // History: a PREVIOUS turn (already reclaimed away) ran to completion.
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    appendRunLevelRow(logsRoot, 'run-1', 'end', { session_id: 'x', phase: 'awaiting-review' });
    // A dead pid names the old (already-finished) holder — the FIRST
    // dispatch below reclaims it exactly like the existing dead-pid test.
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '9999\n');

    // Dispatch attempt 1 — reclaims the dead holder, mints a NEW mark at the
    // CURRENT end of the file (i.e. past the history above).
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive, { sessionTurnShape: true });
    // The "real spawn" step a caller does right after a successful claim:
    // overwrite the placeholder with the new holder's real (ALIVE) pid.
    // Its own turn has NOT written anything yet — the exact boot-window
    // this fix targets.
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');

    // Dispatch attempt 2 — 5ms later, before holder 4242 has written its own
    // start. Without the mark, the LAST run-level row in the whole file is
    // still the PREVIOUS holder's `end`, which would wrongly read as
    // "finished" and spawn a SECOND child. With the mark, the window since
    // THIS holder's own claim is empty -> not ended -> still refused.
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }),
      (err: unknown) => {
        assert.ok(err instanceof DispatchInFlight);
        assert.equal((err as DispatchInFlight).holderPid, 4242, 'must name the just-claimed holder, not the old dead one');
        return true;
      },
      'a holder that was JUST reclaimed and has not written its own start yet must still refuse a concurrent second claim',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 202 double-start (mark-based fix, positive): once the reclaimed holder writes its OWN end, a THIRD dispatch succeeds', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-double-press-positive-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    appendRunLevelRow(logsRoot, 'run-1', 'end', { session_id: 'x', phase: 'awaiting-review' });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '9999\n');

    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive, { sessionTurnShape: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    assert.throws(() => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }), DispatchInFlight);

    // Holder 4242 now writes its OWN start+end (since the mark) and exits.
    appendRunLevelRow(logsRoot, 'run-1', 'start', { session_id: 'x', phase: 'drafting' });
    appendRunLevelRow(logsRoot, 'run-1', 'end', { session_id: 'x', phase: 'awaiting-review' });
    assert.doesNotThrow(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive, { sessionTurnShape: true }),
      'once the CURRENT holder\'s own end is on disk, a later dispatch must proceed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
