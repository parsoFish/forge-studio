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
 * SPLIT ACROSS TWO MODULES, and the doors below follow the split. Wiring the
 * feature straight into `run-story.mjs`'s beat loop took that file from 772 to
 * 825 lines — over the 800-line hard cap — so the readings-and-comparison half
 * moved to `costless-beat.mjs` (`costlessSpendUsd` / `applyCostlessGuard`),
 * and only the probe/stall-door skip — which needs `page`/`bindings`, which
 * only the loop holds — stayed in `run-story.mjs` itself:
 *
 *   1. a beat declaring `costless: true` gets no real-spawn probe and no
 *      agent-channel stall door, checked in `run-story.mjs`;
 *   2. its own spend reading is taken before and after `driveBeat` runs, and
 *      `applyCostlessGuard` — which calls `costlessBeatVerdict`, never a
 *      re-derived comparison — decides whether the beat's own assertion held,
 *      checked in `costless-beat.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('a costless beat gets no real-spawn probe and no stall door, in the beat loop itself', () => {
  const runner = runnerSourceContaining('costlessBeat ? null : makeAgentProcProbe(');
  assert.match(runner.path, /run-story\.mjs$/, 'the probe skip needs `page`/`bindings`, which only the loop holds');
  assert.match(
    runner.source,
    /costlessBeat\s*\?\s*null\s*:\s*stallDoor/,
    'a beat declaring costless: true must not be handed the agent-channel stall door either',
  );
  assert.match(
    runner.source,
    /import \{[^}]*costlessSpendUsd[^}]*applyCostlessGuard[^}]*\} from '\.\/costless-beat\.mjs'|import \{[^}]*applyCostlessGuard[^}]*costlessSpendUsd[^}]*\} from '\.\/costless-beat\.mjs'/s,
    'the loop must import the readings-and-comparison half rather than re-deriving one inline',
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

test('the beat loop applies the guard with readings taken before and after driveBeat', () => {
  const CALL = 'applyCostlessGuard(verdict, spendBeforeCostless,';
  const runner = runnerSourceContaining(CALL);
  assert.match(runner.path, /run-story\.mjs$/);
  const callAt = runner.source.indexOf(CALL);
  const before = runner.source.slice(0, callAt);
  assert.match(
    before,
    /spendBeforeCostless\s*=\s*costlessBeat\s*\?\s*costlessSpendUsd\(/,
    'the BEFORE reading must be taken before driveBeat runs, only when the beat declared costless',
  );
});
