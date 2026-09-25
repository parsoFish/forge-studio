/**
 * reap-priced-label-wiring.test.ts — findings row 62, THE CONNECTION.
 *
 * `withPricedTerminationLabel` (`reap.mjs`) is doored on its own
 * (`reap-priced-label.test.ts`); this pins that the beat loop's own spend
 * reading is actually passed through it, statically via
 * `runnerSourceContaining` — the same convention `run-story-spend-field.test.ts`
 * and `costless-beat-wiring.test.ts` use, for the same reason: nothing in this
 * repo imports `runStory` itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('the runner\'s spend reading is wrapped in withPricedTerminationLabel(reap, ...)', () => {
  const CALL = 'withPricedTerminationLabel(reap, summariseRunSpend(';
  const runner = runnerSourceContaining(CALL);
  assert.match(
    runner.source,
    /import \{[^}]*withPricedTerminationLabel[^}]*\} from '\.\/reap\.mjs'/s,
    'the beat loop must import the label override rather than re-deriving one',
  );
});
