/**
 * bead forge-8vfn.18, half 3 — the harness must SUM what the architect now emits.
 *
 * `sumCycleCost(cycleId)` read `_logs/<cycleId>/events.jsonl` and nothing else,
 * so `--cost-ceiling` bounded stages 2-3 only. `driveArchitect` has always
 * returned the `sessionId` whose log holds stage 1; the caller destructured
 * `{ initiatives }` and dropped it on the floor.
 *
 * Tested against a fixture logs root rather than the real `_logs`, so the sum is
 * a decision this suite can exercise instead of something only a funded run
 * reaches (§15.163).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sumRunCost } from './verify-cycle-cost.mjs';

function ev(phase: string, costUsd: number, eventType = 'end') {
  return JSON.stringify({
    event_id: 'e', cycle_id: 'c', started_at: '2026-09-05T00:00:00Z',
    initiative_id: 'INIT-x', phase, skill: phase, event_type: eventType,
    input_refs: [], output_refs: [], cost_usd: costUsd,
  });
}

function seed(): { root: string; cycleId: string; sessionId: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-vc-cost-'));
  const cycleId = 'INIT-2026-09-05-x';
  const sessionId = '2026-09-05T01-12-32-794b9c27';
  mkdirSync(join(root, cycleId), { recursive: true });
  mkdirSync(join(root, `_architect-${sessionId}`), { recursive: true });
  writeFileSync(join(root, cycleId, 'events.jsonl'), [ev('develop', 1.5), ev('review', 0.5)].join('\n'));
  writeFileSync(join(root, `_architect-${sessionId}`, 'events.jsonl'), [ev('architect', 0.75), ev('architect', 0.25)].join('\n'));
  return { root, cycleId, sessionId };
}

test('THE DEFECT: without the architect session the sum is the stage-2/3 figure only', () => {
  const { root, cycleId } = seed();
  try {
    assert.equal(sumRunCost(cycleId, null, root), 2.0,
      'this is what two funded G1 runs reported as their total');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE FIX: with the architect session id, stage 1 is included', () => {
  const { root, cycleId, sessionId } = seed();
  try {
    assert.equal(sumRunCost(cycleId, sessionId, root), 3.0,
      '2.00 of develop/review + 1.00 of architect turns');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing architect log is 0, not a throw — an aborted run must still report its stage-2/3 spend', () => {
  const { root, cycleId } = seed();
  try {
    assert.equal(sumRunCost(cycleId, 'no-such-session', root), 2.0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing CYCLE log still counts the architect — run 4 aborted with only stage 1 having run', () => {
  const { root, sessionId } = seed();
  try {
    assert.equal(sumRunCost('never-started', sessionId, root), 1.0,
      'run 4 spent an architect turn and reported nothing; that is the case this covers');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the authoritative rule is respected across BOTH logs, not re-derived per file', () => {
  const { root, cycleId, sessionId } = seed();
  try {
    // An `iteration` event in the develop phase makes ONLY iteration events count
    // for that phase — the 2.35x-overcount rule. The architect phase is untouched.
    writeFileSync(join(root, cycleId, 'events.jsonl'),
      [ev('develop', 1.5), ev('develop', 0.9, 'iteration'), ev('review', 0.5)].join('\n'));
    assert.equal(sumRunCost(cycleId, sessionId, root), 0.9 + 0.5 + 1.0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
