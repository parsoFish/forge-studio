/**
 * The wait must END on a FAILED architect session, within one poll.
 *
 * THE DEFECT THIS LOCKS OUT, measured by M4-flows' G1 on a real cycle: the
 * architect refused at 04:40 with `no manifest ports were injected`, and
 * `verify-cycle.mjs`'s interview loop kept sleeping 4 s against its 25-minute
 * deadline, emitting nothing to the console. Thirteen minutes of wall-clock on
 * a run that was already over, and from outside "still working" and "failed
 * long ago" were the same observation.
 *
 * The loops handled `rejected` and not `failed` — TWO loops, each with its own
 * open-coded list, which is why one could be updated and the other not. The fix
 * is the shared list, not the extra branch: a list that cannot be half-applied.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { architectFailurePhase } from './architect-phase.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a FAILED session ends the wait, and carries its own error to the operator', () => {
  const msg = architectFailurePhase({ phase: 'failed', error: 'no manifest ports were injected' });
  assert.ok(msg, 'a failed phase must end the wait');
  assert.match(msg!, /FAILED/);
  assert.match(msg!, /no manifest ports were injected/,
    "the session's own error must travel with the throw — the phase alone does not tell the operator the cause");
});

test('a failed session with no recorded error still ends the wait, and says so', () => {
  const msg = architectFailurePhase({ phase: 'failed' });
  assert.match(msg!, /no error recorded in status.json/);
});

test('rejected still ends the wait, and `where` distinguishes the two loops', () => {
  assert.match(architectFailurePhase({ phase: 'rejected' })!, /was rejected$/);
  assert.match(architectFailurePhase({ phase: 'failed', error: 'x' }, 'during finalize')!, /FAILED during finalize/);
});

test('a LIVE session does not end the wait — the control against a helper that stops everything', () => {
  for (const phase of ['awaiting-answers', 'awaiting-verdict', 'committed', 'drafting', undefined]) {
    assert.equal(architectFailurePhase(phase ? { phase } : {}), null, `phase ${String(phase)} must keep polling`);
  }
  assert.equal(architectFailurePhase(null), null, 'an unreadable status.json is not a failure — the file may not exist yet');
});

test('THE REPRO: a planted status.json in the failed phase is terminal on the FIRST read', () => {
  // T1's control shape: plant the file the loop actually reads, then assert the
  // decision comes back on poll one rather than after a deadline. The planted
  // status is byte-shaped like the real one G1 produced.
  const dir = mkdtempSync(join(tmpdir(), 'architect-phase-'));
  try {
    const statusPath = join(dir, 'status.json');
    writeFileSync(statusPath, JSON.stringify({
      phase: 'failed',
      round: 1,
      session_id: '2026-09-04T04-34-09-663c59fa',
      error: 'architect runner: no manifest ports were injected — this turn cannot parse, serialize or promote initiative manifests.',
    }, null, 2));

    const polls: number[] = [];
    let decision: string | null = null;
    for (let i = 1; i <= 5 && decision === null; i++) {
      polls.push(i);
      decision = architectFailurePhase(JSON.parse(readFileSync(statusPath, 'utf8')));
    }
    assert.equal(polls.length, 1, `the decision must land on poll 1; took ${polls.length}`);
    assert.match(decision!, /no manifest ports were injected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('STRUCTURAL: verify-cycle.mjs compares a phase to a failure string NOWHERE but through the helper', () => {
  // Kills the regression that produced the bug: a second wait loop added later
  // with its own open-coded list. Two loops read this status.json; both must
  // reach the same list, and the only way to guarantee that is for neither to
  // own one.
  const src = readFileSync(join(ROOT, 'scripts/verify-cycle.mjs'), 'utf8');
  const inline = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .filter((l) => /phase\s*===\s*'(failed|rejected)'/.test(l));
  assert.deepEqual(inline, [],
    `verify-cycle.mjs open-codes a terminal phase instead of calling architectFailurePhase:\n${inline.join('\n')}`);
  assert.equal((src.match(/architectFailurePhase\(/g) ?? []).length, 2,
    'both wait loops must route through the shared helper');
});
