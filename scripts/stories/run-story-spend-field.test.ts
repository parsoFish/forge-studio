/**
 * run-story-spend-field.test.ts — findings row 56 (second half), THE
 * CONNECTION.
 *
 * `artifactSpend` (`gallery.mjs`, pinned directly by `artifact-spend.test.ts`)
 * narrows a spend reading to exactly `{measured, usd, label}` — the shape PR
 * #890's `spendFieldFor` reads — but that narrowing reaches nothing unless the
 * `result` object `writeStoryJson` serialises actually calls it.
 *
 * NO TEST IN THIS REPO IMPORTS `runStory` (see `runner-source-comment.test.ts`
 * and `ground-clear.test.ts`'s `7.6.123 WIRING` test for why: it drives a real
 * chromium context end to end, so nothing here executes it). This follows the
 * same static-wiring convention: `runnerSourceContaining` resolves the ONE
 * runner module building the `story.json` result object, and this door pins
 * that the object literal carries `spend: artifactSpend(spend)`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('the result object writeStoryJson serialises carries spend: artifactSpend(spend)', () => {
  const CALL = 'const result = {';
  const runner = runnerSourceContaining(CALL);

  const callAt = runner.source.indexOf(CALL);
  const callBlock = runner.source.slice(callAt, runner.source.indexOf('};', callAt) + 2);
  assert.match(callBlock, /story, beats, reap, sweep, fence/, 'must still be the artifact\'s own result literal');
  assert.match(callBlock, /spend:\s*artifactSpend\(spend\)/, 'result.spend must be built through the narrowing helper, never a re-derived shape');

  assert.match(
    runner.source,
    /import \{[^}]*artifactSpend[^}]*\} from '\.\/gallery\.mjs'/s,
    'the narrowing helper must be imported, not re-derived inline',
  );

  // The object built above must be the SAME ONE passed to writeStoryJson —
  // never a second copy that could drift from what was actually written.
  const wroteAt = runner.source.indexOf('writeStoryJson(result, ROOT)');
  assert.ok(wroteAt > callAt, 'writeStoryJson must be called with the very `result` this object literal builds');
});
