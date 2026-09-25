/**
 * run-story-spend-field.test.ts — findings row 56 (second half).
 *
 * `summariseRunSpend`'s result was computed in `run-story.mjs` (`spend`,
 * ~line 344) and printed to the console, but never attached to the `result`
 * object `writeStoryJson` serialises into `story.json` — so PR #890's
 * `spendFieldFor` (not in this tree) always read the artifact's `spend` field
 * as absent and reported `{usd: null, unmeasured: 'not passed to the
 * artifact writer'}`, whatever the run actually spent.
 *
 * NO TEST IN THIS REPO IMPORTS `runStory` (see `runner-source-comment.test.ts`
 * and `ground-clear.test.ts`'s `7.6.123 WIRING` test for why: it drives a real
 * chromium context end to end, so nothing here executes it). This follows the
 * same static-wiring convention: `runnerSourceContaining` resolves the ONE
 * runner module building the `story.json` result object, and this door pins
 * that the object literal carries `spend` in exactly the shape
 * `{ measured, usd, label }` — the shape #890's `spendFieldFor` reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('the result object writeStoryJson serialises carries spend: { measured, usd, label }', () => {
  const CALL = 'const result = { story, beats, reap, sweep, fence,';
  const runner = runnerSourceContaining(CALL);

  const callAt = runner.source.indexOf(CALL);
  const callBlock = runner.source.slice(callAt, runner.source.indexOf('};', callAt) + 2);

  assert.match(
    callBlock,
    /spend:\s*\{\s*measured:\s*spend\.measured,\s*usd:\s*spend\.usd,\s*label:\s*spend\.label\s*\}/,
    'result.spend must be built from the summariseRunSpend() reading, carrying exactly measured/usd/label',
  );

  // The object built above must be the SAME ONE passed to writeStoryJson —
  // never a second copy that could drift from what was actually written.
  const wroteAt = runner.source.indexOf('writeStoryJson(result, ROOT)');
  assert.ok(wroteAt > callAt, 'writeStoryJson must be called with the very `result` this object literal builds');
});
