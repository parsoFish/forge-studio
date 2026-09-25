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
 * The anchor is the CALL SITE, `costlessBeatVerdict(spendBeforeCostless,
 * spendAfterCostless)`, never the bare function name: `costlessBeatVerdict(`
 * alone is ambiguous the moment the call exists — it also matches
 * `spend.mjs`'s own `export function costlessBeatVerdict(` — and
 * `runnerSourceContaining` refuses an ambiguous anchor by design
 * (`runner-source-comment.test.ts`'s own "definition + call site" case).
 *
 *   1. a beat declaring `costless: true` gets no real-spawn/agent-wait
 *      machinery at all — the probe and the stall door are both skipped, since
 *      neither has anything to watch on a beat that asserts nothing is
 *      dispatched;
 *   2. its own spend reading is taken before and after `driveBeat` runs, and
 *      `costlessBeatVerdict` — never a re-derived comparison — decides whether
 *      the beat's own assertion held.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

const CALL = 'costlessBeatVerdict(spendBeforeCostless, spendAfterCostless)';

test('costlessBeatVerdict is imported from spend.mjs into the beat loop', () => {
  const runner = runnerSourceContaining(CALL);
  assert.match(
    runner.source,
    /import \{[^}]*costlessBeatVerdict[^}]*\} from '\.\/spend\.mjs'/s,
    'the beat loop must import the pure comparison rather than re-deriving one',
  );
});

test('a costless beat gets no real-spawn probe and no stall door', () => {
  const runner = runnerSourceContaining(CALL);
  assert.match(
    runner.source,
    /costless(Beat)?\s*(===\s*true)?\s*\?\s*null\s*:\s*makeAgentProcProbe\(/,
    'a beat declaring costless: true must not build a real-spawn process probe',
  );
  assert.match(
    runner.source,
    /costless(Beat)?\s*(===\s*true)?\s*\?\s*null\s*:\s*stallDoor/,
    'a beat declaring costless: true must not be handed the agent-channel stall door',
  );
});

test('a costless beat\'s verdict is reddened from costlessBeatVerdict, not trusted on the declaration alone', () => {
  const runner = runnerSourceContaining(CALL);
  const callAt = runner.source.indexOf(CALL);
  const nearby = runner.source.slice(Math.max(0, callAt - 400), callAt + 400);
  assert.match(nearby, /\.ok/, 'the comparison\'s ok field must gate the redden');
  assert.match(nearby, /status:\s*'red'/, 'a failed comparison must redden the beat\'s own verdict');
});
