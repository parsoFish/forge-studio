/**
 * 718(1) — the channel door's "since the beat's declared ANCHOR" form.
 *
 * RUN 11 BOUGHT THIS, and the door was not wrong so much as over-spoken. S10's
 * beat 7 pressed `scheduler-start`; the daemon claimed the initiative and had
 * its cycle dir on disk at `13:21:29.798`, **449 ms BEFORE beat 7's own green
 * at `13:21:30.247`** — and therefore before beat 8 pressed anything. The door
 * counts channels born SINCE THE PRESS, so that cycle was invisible to it by
 * construction, and beat 8 reded `no-channel: nothing under _logs/ was created
 * by this press`. The cycle it could not see ran to `cycle.end` sixty seconds
 * before the beat gave up.
 *
 * The rule is right for a press that dispatches its OWN work. It is wrong for a
 * press whose work a DIFFERENT beat started, which is what "watch the factory
 * do it" beats are. So a beat may now name the earlier press its channel
 * belongs to, and the door searches from there.
 *
 * WHAT DOES NOT MOVE: the BOUND. The deadline stays measured from the wait's
 * own start — an anchor that also moved the timeout would let a beat inherit
 * another beat's elapsed time and silently shorten its own budget. Only the
 * search window moves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAnchorMs } from './beats-anchor.mjs';

test('718(1): an anchor names an EARLIER press, and the door searches from there', () => {
  const presses = new Map([['scheduler-start', 1_000], ['start-work-plan', 5_000]]);
  assert.equal(resolveAnchorMs({ for: 'agent', anchor: 'scheduler-start' }, presses, 5_000), 1_000);
});

test('718(1): no anchor keeps the wait\'s own start — the existing behaviour is untouched', () => {
  const presses = new Map([['scheduler-start', 1_000]]);
  assert.equal(resolveAnchorMs({ for: 'agent' }, presses, 5_000), 5_000);
  assert.equal(resolveAnchorMs(null, presses, 5_000), 5_000);
});

test('718(1): an anchor naming a press that never happened REFUSES, never silently falls back', () => {
  // A silent fallback to the wait's start would restore the exact bug this
  // exists to fix, and would do it invisibly — the beat would red with
  // `no-channel` again and the verdict would look identical to a real one.
  const presses = new Map([['scheduler-start', 1_000]]);
  assert.throws(
    () => resolveAnchorMs({ for: 'agent', anchor: 'never-pressed' }, presses, 5_000),
    /anchor "never-pressed".*no beat pressed it/,
  );
});

test('718(1): an anchor LATER than the wait is refused — it would search a window that has not opened', () => {
  const presses = new Map([['later-press', 9_000]]);
  assert.throws(
    () => resolveAnchorMs({ for: 'agent', anchor: 'later-press' }, presses, 5_000),
    /anchor "later-press" was pressed AFTER/,
  );
});
