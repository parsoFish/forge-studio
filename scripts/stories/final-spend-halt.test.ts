/**
 * Bead `forge-8vfn.7.6.92` — the halt is re-read at the FINAL spend site.
 *
 * 7.6.71 halts a run whose ceiling went blind (a turn ENDED UNPRICED) or was
 * breached — but only at BEAT BOUNDARIES. A turn that ends after the last
 * boundary is printed by the final spend column and never judged: the reap runs
 * anyway (the kill is not at risk), and the run reads as complete with an
 * unpriced end in its own ledger (the LABEL is). `finalSpendHalt` is that last
 * judgement, made from the same rows by the same verdict as every boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import { emitTurnCostRow, emitTurnEndedUnpricedRow } from '@forge/sessions/turn-cost-rows.ts';

import { finalSpendHalt } from './run-observe.mjs';

const TURN = {
  initiativeId: 'session-s10',
  phase: 'architect' as const,
  skill: 'architect',
  message: 'interactive.turn-ended-unpriced',
};

/** A run root whose `_logs/<cycle>/events.jsonl` holds what `emit` wrote through the REAL logger. */
function runRoot(emit: (logger: ReturnType<typeof createLogger>) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'final-spend-halt-'));
  emit(createLogger('c-final', join(root, '_logs')));
  return root;
}

test('a turn that ended UNPRICED after the last beat boundary HALTS the run at the final read (kills: the run reading as complete)', () => {
  const root = runRoot((logger) => {
    emitTurnCostRow(logger, { ...TURN, message: 'interactive.turn-cost' }, 1.5);
    emitTurnEndedUnpricedRow(logger, TURN, { reason: 'died', tokensIn: 900, tokensOut: 40 });
  });
  try {
    const r = finalSpendHalt({ root, startedMs: 0, realSpawn: true, ceilingUsd: 25, alreadyHalted: false });
    assert.equal(r.stop?.halt, true, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /at the final spend read/, 'the line says WHERE the halt was read, so it is not mistaken for a boundary halt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run already halted at a boundary is not judged twice (kills: a second headline overwriting the first halt\'s reason)', () => {
  const root = runRoot((logger) => emitTurnEndedUnpricedRow(logger, TURN, { reason: 'died', tokensIn: 1, tokensOut: 1 }));
  try {
    const r = finalSpendHalt({ root, startedMs: 0, realSpawn: true, ceilingUsd: 25, alreadyHalted: true });
    assert.equal(r.stop, null);
    assert.deepEqual(r.lines, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a priced run under its ceiling ends GREEN at the final read (kills: a final read that halts everything)', () => {
  const root = runRoot((logger) => emitTurnCostRow(logger, { ...TURN, message: 'interactive.turn-cost' }, 3));
  try {
    const r = finalSpendHalt({ root, startedMs: 0, realSpawn: true, ceilingUsd: 25, alreadyHalted: false });
    assert.equal(r.stop, null, r.lines.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run-story.mjs asks for the final halt AFTER the beat loop and BEFORE the verdict, and a halt there makes the run RED', () => {
  const src = readFileSync(new URL('./run-story.mjs', import.meta.url), 'utf8');
  const call = src.indexOf('finalSpendHalt(');
  const loopHalt = src.indexOf('spendHalt = stop;');
  const verdict = src.indexOf('if (spendHalt !== null)');
  assert.ok(call > 0, 'run-story.mjs never asks for the final halt');
  assert.ok(loopHalt > 0 && call > loopHalt, 'the final read must come after the beat loop\'s own halt');
  assert.ok(verdict > call, 'and before the verdict that reads spendHalt');
  const site = src.slice(call, verdict);
  assert.match(site, /alreadyHalted:\s*spendHalt !== null/, 'it must not re-judge a run the loop already halted');
  assert.match(site, /spendHalt = /, 'a final halt must land in the same variable the verdict and exit code read');
});
