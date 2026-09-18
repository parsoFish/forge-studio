/**
 * `boundBasis` — the derived bound's REASON, carried to the verdict.
 * `forge-8vfn.7.6.118`, T1 ruling 1089.
 *
 * T1 1089: "with BOTH numbers printed beside the wait ... the clamp never
 * hidden; the derivation door asserts it reads `ground` and that the printed
 * line names which constraint bound it."
 *
 * WHY IT HAS TO REACH THE VERDICT. Run 17's red said `gave up at the agent wait
 * (declared 360000 ms)` — `beatBound`'s label — and that sentence is the whole
 * reason the first two readers of the run believed the product had stalled. A
 * bound that is derived but prints as a bare integer is indistinguishable from
 * the literal it replaced, and the next reader re-learns the same wrong thing.
 *
 * ABSENT ON EVERY OTHER WAIT, unchanged. ~90 beats across the suite declare a
 * plain `upTo` and must keep printing exactly what they printed before; this is
 * additive or it is a silent rewrite of every story's verdicts at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beatBound } from './beats.mjs';

test('7.6.118: a wait carrying `boundBasis` prints BOTH numbers and what bound it', () => {
  const basis = 'MAX_DECLARED_WAIT_MS binding at 1800000 ms; ground.budget_usd $35 at the measured $0.5029/min would afford 4175438 ms';
  const { ms, label } = beatBound({ wait: { for: 'agent', upTo: 1_800_000, boundBasis: basis } }, 15_000);
  assert.equal(ms, 1_800_000, 'the bound itself is untouched by its own explanation');
  assert.match(label!, /1800000 ms/, label!);
  assert.match(label!, /4175438 ms/, `the derived figure the cap replaced must survive into the verdict: ${label}`);
  assert.match(label!, /MAX_DECLARED_WAIT_MS/, label!);
});

test('7.6.118: a wait WITHOUT `boundBasis` prints exactly what it always did', () => {
  // The ~90 single-`upTo` beats. If this changes, every story's verdict text
  // changes with it and the red-evidence fixtures stop matching.
  const { ms, label } = beatBound({ wait: { for: 'agent', upTo: 360_000 } }, 15_000);
  assert.equal(ms, 360_000);
  assert.equal(label, 'agent wait (declared 360000 ms)');
});

test('7.6.118: a beat with no wait at all is still the DOM timeout', () => {
  const { ms, label } = beatBound({}, 15_000);
  assert.equal(ms, 15_000);
  assert.equal(label, null);
});

/**
 * THE SEAM MOST LIKELY TO DROP THESE FIELDS SILENTLY.
 *
 * `validateWait` DROPS every key it does not name — the file says so in its own
 * comment, and 7.6.82 was minted for exactly that shape: a `settle` wait
 * carrying `perTransition` lost both fields because the settle branch RETURNS
 * before the checks below it. A new field added to the wait schema and not
 * added to BOTH return paths vanishes between the story and the runner, and the
 * beat then waits with no terminal watch and no printed basis while the story
 * file reads as though it declared them.
 *
 * So this asserts the fields survive the REAL parser on the REAL story, not on
 * a fixture that could drift from it.
 */
test('7.6.118: S10 beat 8\'s `terminal` and `boundBasis` survive validateStory', async () => {
  const { validateStory } = await import('./story-file.mjs');
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const parsed = validateStory(story);
  const beat8 = parsed.beats[7];

  assert.equal(beat8.wait.terminal, 'ready-for-review', 'the watch would never run');
  assert.ok(typeof beat8.wait.boundBasis === 'string' && beat8.wait.boundBasis !== '', 'the verdict would print a bare integer again');
  assert.match(beat8.wait.boundBasis, /ground\.budget_usd/, beat8.wait.boundBasis);
  assert.equal(beat8.wait.anchor, 'scheduler-start', 'and the anchor 7.6.27 wired is still there');
});

test('7.6.118: the bound S10 declares is the DERIVED one, and the parser accepts it', async () => {
  const { validateStory, MAX_DECLARED_WAIT_MS } = await import('./story-file.mjs');
  const { CYCLE_BOUND } = await import('../../tests/stories/S10.constants.mjs');
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beat8 = validateStory(story).beats[7];

  assert.equal(beat8.wait.upTo, CYCLE_BOUND.ms, 'the story must declare what the derivation produced');
  assert.ok(beat8.wait.upTo <= MAX_DECLARED_WAIT_MS);
  assert.notEqual(beat8.wait.upTo, 360_000, 'the literal run 17 died on must be gone');
});

test('7.6.118: the typed ceiling and the funded ground are the SAME money', async () => {
  // They were two literals that happened to agree. A story that runs to one
  // number and is judged against the other would say nothing about it.
  const { CEILING, GROUND } = await import('../../tests/stories/S10.constants.mjs');
  assert.equal(CEILING, String(GROUND.budget_usd));
});
