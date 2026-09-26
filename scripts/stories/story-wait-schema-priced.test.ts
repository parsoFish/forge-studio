/**
 * `wait: { for: 'priced', upTo }` — ROW 109 (T1 1549).
 *
 * THE GAP. S3's terminal beat follows the onboarding session it just
 * launched; its own `expect.data` is satisfied the moment the session page
 * renders, long before that session's first turn prices itself. The run ends
 * there and `reap.mjs`'s own teardown grace (`FIRST_PRICED_EVENT_GRACE_MS`,
 * <= 30 s) is not enough — run 2 measured "terminated before first priced
 * event (30000 ms)". A `priced` wait gives the beat itself a bounded, real
 * chance to see one before the run moves on.
 *
 * THIS FILE pins the SCHEMA half only: `for: 'priced'` accepts `upTo` and
 * NOTHING else — every other field this schema already knows about
 * (`terminal`, `boundBasis`, `anchor`, `cycleOf`, `perTransition`,
 * `progressKey`, `key`, `while`) must be refused BY NAME, the same fail-closed
 * shape `wait-carry-through.test.ts` already holds `agent`/`settle` to: a
 * stray field silently dropped is a field the author believes is working.
 * The runtime half (`waitForPricedEvent`, `beats-agent-proc.mjs`) and its
 * wiring through `driveBeat` are pinned in `beats-priced-wait.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './story-file.mjs';

const story = (wait: unknown) => ({
  id: 'X', title: 't', docs: { kind: 'tutorial', title: 'X' },
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  beats: [{ act: 'a', wait, expect: { route: '/', data: { page: 'home' } }, say: 's' }],
});

test('109: a priced wait with only `upTo` survives validation intact', () => {
  const ok = validateStory(story({ for: 'priced', upTo: 180_000 }));
  assert.deepEqual(ok.beats[0].wait, { for: 'priced', upTo: 180_000 });
});

test('109: `upTo` is validated exactly like every other kind — bounds and integer-ness', () => {
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 0 })), /wait\.upTo/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: -1 })), /wait\.upTo/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1.5 })), /wait\.upTo/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 31 * 60 * 1000 })), /wait\.upTo/);
});

test('109: `priced` is a recognised kind — `for` alone no longer refuses', () => {
  // Before this kind existed, `WAIT_KINDS` named only `agent` and `settle`, so
  // `for: 'priced'` would have refused at `wait.for` before ever reaching
  // `upTo`. This is the door on that: the kind itself must be accepted.
  assert.doesNotThrow(() => validateStory(story({ for: 'priced', upTo: 1000 })));
});

test('109: nothing but `for`/`upTo` survives — every stray field is refused BY NAME, never dropped', () => {
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1000, terminal: 'done' })), /wait\.terminal/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1000, boundBasis: 'because' })), /wait\.boundBasis/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1000, anchor: 'x' })), /wait\.anchor/);
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1000, cycleOf: 'x' })), /wait\.cycleOf/);
  assert.throws(
    () => validateStory(story({ for: 'priced', upTo: 1000, perTransition: 100, progressKey: 'x' })),
    /wait\.perTransition/,
  );
  assert.throws(() => validateStory(story({ for: 'priced', upTo: 1000, key: 'x', while: 'y' })), /wait\.key/);
});

test('109: every other declared kind is UNCHANGED — agent and settle still validate exactly as before', () => {
  const agentOk = validateStory(story({ for: 'agent', upTo: 1000 }));
  assert.deepEqual(agentOk.beats[0].wait, { for: 'agent', upTo: 1000 });
  const settleOk = validateStory(story({ for: 'settle', upTo: 1000, key: 'k', while: 'pending' }));
  assert.deepEqual(settleOk.beats[0].wait, { for: 'settle', upTo: 1000, key: 'k', while: 'pending' });
});
