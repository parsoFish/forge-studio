/**
 * costless-beat-wiring.test.ts — findings row 61, THE CONNECTION.
 *
 * `costlessBeatVerdict` (`spend.mjs`) and the beat schema (`story-file.mjs`)
 * are each doored on their own — a fact that exists and reaches nothing is
 * exactly the species `ground-clear.test.ts`'s `7.6.123 WIRING` door exists
 * for, and this is the same shape one bead over. No test in this repo imports
 * `runStory` (it drives a real chromium context end to end), so this pins the
 * BEAT LOOP's source statically via `runnerSourceContaining`, the same
 * convention `run-story-spend-field.test.ts` uses.
 *
 * SPLIT ACROSS TWO MODULES, and the doors below follow the split.
 * `costlessGuardFor` (`costless-beat.mjs`) collapses the readings-and-
 * comparison half into ONE call returning `{active, apply}` — re-shaped from
 * this bead's first cut (three loose statements in the loop: `costlessBeat`,
 * `spendBeforeCostless`, a bare `applyCostlessGuard` call) when a later cap
 * squeeze (ruling 492) needed the beat loop's own share of this feature down
 * to as little as the probe/stall-door skip, which cannot move: it needs
 * `page`/`bindings`, which only the loop holds.
 *
 *   1. a beat declaring `costless: true` gets no real-spawn probe and no
 *      agent-channel stall door, checked in `run-story.mjs`;
 *   2. `costlessGuardFor` takes its own BEFORE reading internally, and its
 *      `.apply(verdict)` — never a re-derived comparison — decides whether
 *      the beat's own assertion held, checked in `costless-beat.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('a costless beat gets no real-spawn probe and no stall door, in the beat loop itself', () => {
  const runner = runnerSourceContaining('costlessGuard.active ? null : makeAgentProcProbe(');
  assert.match(runner.path, /run-story\.mjs$/, 'the probe skip needs `page`/`bindings`, which only the loop holds');
  assert.match(
    runner.source,
    /costlessGuard\.active\s*\?\s*null\s*:\s*stallDoor/,
    'a beat declaring costless: true must not be handed the agent-channel stall door either',
  );
  assert.match(
    runner.source,
    /import \{\s*costlessGuardFor\s*\} from '\.\/costless-beat\.mjs'/,
    'the loop must import the one-call guard rather than re-deriving the readings inline',
  );
});

test('applyCostlessGuard calls costlessBeatVerdict and reddens the verdict on a failed comparison', () => {
  const CALL = 'const v = costlessBeatVerdict(beforeUsd, afterUsd);';
  const runner = runnerSourceContaining(CALL);
  assert.match(runner.path, /costless-beat\.mjs$/);
  const callAt = runner.source.indexOf(CALL);
  const nearby = runner.source.slice(Math.max(0, callAt - 200), callAt + 400);
  assert.match(nearby, /\.ok/, 'the comparison\'s ok field must gate the redden');
  assert.match(nearby, /status:\s*'red'/, 'a failed comparison must redden the beat\'s own verdict');
});

test('costlessGuardFor calls applyCostlessGuard from its own apply(), never bypassing it', () => {
  const CALL = 'apply: (verdict) => (active ? applyCostlessGuard(verdict, before, costlessSpendUsd(';
  const runner = runnerSourceContaining(CALL);
  assert.match(runner.path, /costless-beat\.mjs$/);
});

test('the beat loop builds the guard BEFORE driveBeat runs and applies it AFTER, from the SAME guard', () => {
  const CALL = 'verdict = costlessGuard.apply(verdict);';
  const runner = runnerSourceContaining(CALL);
  assert.match(runner.path, /run-story\.mjs$/);
  const applyAt = runner.source.indexOf(CALL);
  const before = runner.source.slice(0, applyAt);
  const buildAt = before.indexOf('const costlessGuard = costlessGuardFor(beat, ROOT, startedMs,');
  assert.notEqual(buildAt, -1, 'the guard must be built from beat/ROOT/startedMs before driveBeat runs');
  assert.ok(buildAt < before.indexOf('await driveBeat('), 'the guard must be built before driveBeat is called');
  assert.ok(before.indexOf('await driveBeat(') < applyAt, 'the guard must be applied AFTER driveBeat returns');
});
