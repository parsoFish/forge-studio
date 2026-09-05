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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// Bead forge-8vfn.6.10.22, half 2 — bead 18's fix OVER-corrected.
//
// `emitSyntheticArchitectEvents` writes the architect's whole out-of-cycle
// spend INTO the cycle log, unconditionally, for every run that reaches
// `runCycle`. Summing the architect's session log on top of that counts it
// twice — and does so for every healthy run, not only the duplicated-emission
// one. Measured on G2: cycle $26.3048 + session $2.3327 = $28.6375, the
// harness's own `$28.64`, against a truth of $23.9721. Half that gap is the
// duplicate emission (fixed in packages/flows); the other half is this.
//
// Bead 18's real case — a run that aborted after stage 1, with no cycle log at
// all — is unaffected and is pinned above and again below.
// ---------------------------------------------------------------------------

/** A cycle log shaped as `emitSyntheticArchitectEvents` writes it: the architect's spend is IN it. */
function seedWithSyntheticArchitect() {
  const root = mkdtempSync(join(tmpdir(), 'forge-vc-cost-synth-'));
  const cycleId = 'INIT-2026-09-05-y';
  const sessionId = '2026-09-05T01-12-32-794b9c27';
  mkdirSync(join(root, cycleId), { recursive: true });
  mkdirSync(join(root, `_architect-${sessionId}`), { recursive: true });
  writeFileSync(join(root, cycleId, 'events.jsonl'),
    [ev('architect', 1.0), ev('develop', 1.5), ev('review', 0.5)].join('\n'));
  writeFileSync(join(root, `_architect-${sessionId}`, 'events.jsonl'),
    [ev('architect', 0.75), ev('architect', 0.25)].join('\n'));
  return { root, cycleId, sessionId };
}

test('THE SECOND DEFECT: a cycle log that already carries the architect must NOT have the session log added on top', () => {
  const { root, cycleId, sessionId } = seedWithSyntheticArchitect();
  try {
    assert.equal(sumRunCost(cycleId, sessionId, root), 3.0,
      'the architect is $1.00 once — 3.00, not the 4.00 that summing both logs produced ($28.64 on G2)');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('kills "skip the session log whenever an architect event exists": a ZERO-cost synthetic pair is not spend, so stage 1 is still added', () => {
  // A legacy / hand-authored manifest carries no `architect_cost_usd`, and the
  // emitter writes a zero-cost synthetic pair for it. Keying the rule on the
  // PRESENCE of an architect event rather than on its dollars would silently
  // drop a real architect session for exactly those runs.
  const { root, cycleId, sessionId } = seedWithSyntheticArchitect();
  try {
    writeFileSync(join(root, cycleId, 'events.jsonl'),
      [ev('architect', 0), ev('develop', 1.5), ev('review', 0.5)].join('\n'));
    assert.equal(sumRunCost(cycleId, sessionId, root), 3.0, '2.00 of develop/review + the architect session\'s 1.00');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// THE PIN, by the harness's own door (ruling 287). The same two G2 logs the
// kernel test sums directly, arranged on disk the way a real run leaves them,
// and read through `sumRunCost` — the function whose figure a G-row's
// `--cost-ceiling` check is judged against. One fixture, two doors, one number:
// if these ever disagree, the harness and the product disagree about what a run
// cost, which is the state this bead found.
//
// The fixture lives under `packages/kernel/test-fixtures/` rather than being
// copied here: it is one run's evidence, and two copies of it could drift.
// ---------------------------------------------------------------------------

const G2_FIXTURES = join(import.meta.dirname, '..', 'packages', 'kernel', 'test-fixtures', 'g2-restatement');
const G2_CYCLE_ID = '2026-09-05T13-37-42_INIT-2026-09-05-init-gap-registry-consolidation';
const G2_SESSION_ID = '2026-09-05T13-24-51-bf610d7f';

test('THE PIN: G2 through the harness door sums to $23.9721 — the same figure the kernel reads from the cycle log, not the $28.6375 it reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-vc-cost-g2-'));
  try {
    mkdirSync(join(root, G2_CYCLE_ID), { recursive: true });
    mkdirSync(join(root, `_architect-${G2_SESSION_ID}`), { recursive: true });
    writeFileSync(join(root, G2_CYCLE_ID, 'events.jsonl'), readFileSync(join(G2_FIXTURES, 'g2-cycle-events.jsonl'), 'utf8'));
    writeFileSync(join(root, `_architect-${G2_SESSION_ID}`, 'events.jsonl'), readFileSync(join(G2_FIXTURES, 'g2-architect-session-events.jsonl'), 'utf8'));

    assert.equal(Number(sumRunCost(G2_CYCLE_ID, G2_SESSION_ID, root).toFixed(4)), 23.9721);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
