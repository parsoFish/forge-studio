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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

/**
 * T1 1503 (row 98, S10 run 27) — THE DEFAULT (no `wait.anchor`) FORM MUST BE
 * FED A TIMESTAMP TAKEN BEFORE THE ACT, NOT A FRESH ONE TAKEN AFTER.
 *
 * MEASURED: beat 10 presses `start-development` and waits in the same beat,
 * with no `wait.anchor` — so `resolveAnchorMs` returns its third argument
 * verbatim. `beats-drive.mjs` used to hand it a fresh `Date.now()` computed
 * AFTER `performSteps` had already issued that press. The develop run's own
 * `cycle.start` landed at 20:44:07.280Z; that fresh `Date.now()` could read no
 * earlier than the press it followed, ~20:44:08.0Z — so `cycleStartedSince`
 * never found a start at or after its own anchor, and the wait never ended.
 *
 * `resolveAnchorMs` itself cannot pin this: its unit tests (above) hand it a
 * literal, which says nothing about WHICH clock reading `beats-drive.mjs`
 * passes in. This is a structural door on the call site itself, precise enough
 * to kill exactly the regression: reverting to a bare `Date.now()` here changes
 * nothing this regex cannot see, and the assertion below reds on it.
 */
test('T1 1503: beats-drive.mjs anchors the default form on pressStartedMs, never a fresh Date.now() taken after the act', () => {
  const path = fileURLToPath(new URL('./beats-drive.mjs', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const call = /resolveAnchorMs\(beat\.wait\s*\?\?\s*null,\s*pressedAt,\s*([^)]+)\)/.exec(source);
  assert.notEqual(call, null, `${path}: the resolveAnchorMs call site must still exist and be recognisable`);
  assert.equal(
    call![1].trim(), 'pressStartedMs',
    `${path}: the third argument must be the timestamp captured BEFORE this beat's own act, not a fresh ` +
      'Date.now() taken after performSteps has already run.',
  );
});
