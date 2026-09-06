/**
 * The control's state, reported at the FIRST poll and on every change — bead
 * `forge-8vfn.6.11.30`, T1 ruling 330.
 *
 * WHAT IT COST TO NOT HAVE THIS. S2 run 4, S1 run 6 and S1 run 7 each spent
 * their whole declared bound — 461 s to 515 s — on a control that was present
 * and disabled the entire time. The runner ALREADY computed that fact
 * (`describeControl`: "The control is present but still DISABLED"), but only
 * printed it once the bound had expired. **The information was never missing;
 * the timing was.** Three funded runs paid ~8 minutes each to learn something
 * the first second could have told them.
 *
 * WHY "AND ON EVERY CHANGE" AND NOT JUST ONCE. A control that is disabled at
 * t=0 and enabled at t=3s is a product working normally; one disabled from t=0
 * to the bound is a product that never moved. A single opening reading cannot
 * tell those apart, and it is exactly the distinction the last three runs
 * needed — S1 run 7's `submit-answers` was disabled throughout, while a healthy
 * round flips within a second or two.
 *
 * The emitted line is deliberately not a failure: the act may still succeed,
 * and a beat that reds anyway keeps its existing failure text unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { controlState, watchControlState } from './beats-control-state.mjs';

/** A fake locator whose state the test drives, mirroring playwright's shape. */
function fakePage(states) {
  let i = 0;
  return {
    next() { if (i < states.length - 1) i += 1; },
    locator() {
      return {
        count: async () => (states[i] === null ? 0 : 1),
        first: () => ({
          evaluate: async (fn) => {
            const s = states[i];
            if (s === null) throw new Error('detached');
            return fn({
              disabled: s.disabled === true,
              getAttribute: (k) => (k === 'disabled' ? (s.disabled ? '' : null)
                : k === 'aria-busy' ? (s.busy ? 'true' : null)
                : k === 'title' ? (s.title ?? null) : null),
              readOnly: s.readOnly === true,
              isConnected: true,
            });
          },
        }),
      };
    },
  };
}

test('6.11.30: a disabled control reads as disabled, and names why when it says', async () => {
  const page = fakePage([{ disabled: true, title: 'Answer every question first' }]);
  const s = await controlState(page, '[data-action="submit-answers"]');
  assert.match(s, /disabled/i);
  assert.match(s, /Answer every question first/, 'the product\'s own reason is carried through, not paraphrased');
});

test('6.11.30: an absent control is reported as absent, not as enabled', async () => {
  const page = fakePage([null]);
  const s = await controlState(page, '[data-action="submit-answers"]');
  assert.match(s, /no element/i);
});

test('6.11.30: the FIRST poll emits — the whole point of the bead', async () => {
  // Not "emits eventually": three runs proved that a report arriving after the
  // bound is a report nobody can act on.
  const page = fakePage([{ disabled: true }]);
  const lines: string[] = [];
  const stop = watchControlState(page, '[data-x="y"]', (l) => lines.push(l), 5);
  await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.ok(lines.length >= 1, 'at least one line must have been emitted immediately');
  assert.match(lines[0], /disabled/i);
});

test('6.11.30: it emits on CHANGE, and stays quiet while nothing changes', async () => {
  // The quiet half matters as much: a line per poll would bury the change in
  // noise, and a beat under a ten-minute bound would emit hundreds.
  const page = fakePage([{ disabled: true }, { disabled: false }]);
  const lines: string[] = [];
  const stop = watchControlState(page, '[data-x="y"]', (l) => lines.push(l), 5);
  await new Promise((r) => setTimeout(r, 30));
  const beforeChange = lines.length;
  page.next();
  await new Promise((r) => setTimeout(r, 30));
  stop();

  assert.equal(beforeChange, 1, 'an unchanging control emits exactly once, not once per poll');
  assert.equal(lines.length, 2, 'and exactly once more when it changes');
  assert.match(lines[1], /enabled/i);
});

test('6.11.30: stopping the watch is idempotent and silences it', async () => {
  const page = fakePage([{ disabled: true }, { disabled: false }]);
  const lines: string[] = [];
  const stop = watchControlState(page, '[data-x="y"]', (l) => lines.push(l), 5);
  await new Promise((r) => setTimeout(r, 20));
  stop();
  stop();
  const after = lines.length;
  page.next();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(lines.length, after, 'no line is emitted after the watch is stopped');
});
