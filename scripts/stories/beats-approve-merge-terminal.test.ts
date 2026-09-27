/**
 * beats-approve-merge-terminal.test.ts — row 153 (bead `forge-8vfn.8.1.41`,
 * ruling 1843): S10's "Approve — which is the merge" beat (`S10.review.mjs`)
 * asserted a `settle` wait keyed on `gate-state`/`idle`, and S10 REAL RUN 39
 * reded: `data-gate-state: expected "approved", got "idle"` / `gave up at
 * the settle wait (declared 180000 ms)`.
 *
 * WHY IT WAS RED. The run's own `events.jsonl` names what the 180 s settle
 * was actually racing: `release-finalize.start` (phase `release-finalize`,
 * skill `release-finalizer`) fired six ms after the press — an AGENT TURN,
 * not the synchronous flip a `settle` wait is shaped for — and it did not
 * finish (`release.finalized`) until 7 m 32 s later (`duration_ms:451472`),
 * four minutes past the beat's own bound. Run 37 measured the identical step
 * at 64986 ms: the old 180 s bound happened to cover it, by luck, not by
 * construction — nothing in a `settle` wait's shape can size itself to an
 * agent turn whose length the story does not control.
 *
 * THE FIX gives the beat an `agent` wait keyed on the SAME develop cycle
 * beats 8/10/16 already watch by identity (`cycleOf: '<runId>'`), resolving
 * on the product's own word for "the merge landed" — `terminal: 'merged'`,
 * the `_queue/merged/` state `closure.ts` moves the manifest into (and logs
 * `closure.manifest-moved-to-merged` for) only once release-finalize has
 * actually run the merge. `upTo` reuses `CYCLE_BOUND` — the house derivation
 * every other identity-watching wait in this story already declares — rather
 * than a second guessed literal.
 *
 * THIS FILE ASSERTS THE REAL S10 STORY, through the REAL parser
 * (`validateStory`), rather than a hand-built fixture — the same shape
 * `beats-cost-route.test.ts` (row 148) uses for the identical reason: a
 * fixture cannot red on a regression to the story file itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';

test('row 153: "Approve — which is the merge" declares an agent wait, not a settle-only one', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const approveIndex = beats.findIndex((b: any) => b.act === 'Approve — which is the merge');
  assert.notEqual(approveIndex, -1, 'the approve-and-merge beat must exist');
  const beat = beats[approveIndex];

  assert.ok(beat.wait !== undefined, 'the beat must declare a wait');
  assert.equal(
    beat.wait.for,
    'agent',
    'a settle wait cannot span an agent turn (release-finalize) whose length the story does not ' +
      'control — run 39 measured it at 451472 ms against a 180000 ms settle bound',
  );
  // `validateWait` refuses `key`/`while` on anything but a `for: "settle"` wait
  // (`story-wait-schema.mjs`'s stray-field check), so these are true by
  // construction once `for` is `agent` — asserted anyway so the INTENT of
  // this test (no fixed settle-only wait survives) is legible on its own,
  // not only as a side effect of the `for` check above.
  assert.equal(Object.hasOwn(beat.wait, 'key'), false, 'an agent wait must not carry a settle key');
  assert.equal(Object.hasOwn(beat.wait, 'while'), false, 'an agent wait must not carry a settle value');
});

test('row 153: the wait watches the develop cycle by identity and ends on its merge terminal', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const approveIndex = beats.findIndex((b: any) => b.act === 'Approve — which is the merge');
  assert.notEqual(approveIndex, -1, 'the approve-and-merge beat must exist');
  const wait = beats[approveIndex].wait;

  assert.equal(
    wait.cycleOf,
    '<runId>',
    'the develop cycle is continued, never re-minted, across the review loop — the SAME ' +
      'placeholder beats 8/10/16 already bind, never a fresh channel scan',
  );
  assert.equal(
    wait.terminal,
    'merged',
    '_queue/merged/ is the product\'s own word for "the merge landed" (closure.ts\'s ' +
      'closure.manifest-moved-to-merged), fired only after release-finalize actually runs the merge',
  );
  assert.equal(wait.anchor, 'approve-and-merge', 'the wait anchors on this beat\'s own press');
});

test('row 153: upTo is sized at or above the measured release-finalize + merge span', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const approveIndex = beats.findIndex((b: any) => b.act === 'Approve — which is the merge');
  assert.notEqual(approveIndex, -1, 'the approve-and-merge beat must exist');
  const wait = beats[approveIndex].wait;

  // Run 39's own events.jsonl: release-finalize.start 16:25:36.243Z ->
  // release.finalized 16:32:40.833Z, duration_ms 451472. The declared bound
  // must cover the worst measured span, not merely the best one (run 37's
  // 64986 ms).
  const MEASURED_WORST_FINALIZE_MS = 451_472;
  assert.ok(
    Number.isInteger(wait.upTo) && wait.upTo >= MEASURED_WORST_FINALIZE_MS,
    `upTo (${wait.upTo}) must be >= the measured worst release-finalize span ` +
      `(${MEASURED_WORST_FINALIZE_MS} ms, S10 run 39)`,
  );
  assert.ok(typeof wait.boundBasis === 'string' && wait.boundBasis.length > 0,
    'a derived bound states which measurement and cap produced it, never a bare literal');
});

test('row 153: the beat still asserts the operator-visible approved gate after the wait', async () => {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  const beats = validateStory(story).beats;

  const approveIndex = beats.findIndex((b: any) => b.act === 'Approve — which is the merge');
  assert.notEqual(approveIndex, -1, 'the approve-and-merge beat must exist');
  const beat = beats[approveIndex];

  assert.deepEqual(beat.do, [{ press: 'approve-and-merge' }]);
  assert.deepEqual(beat.expect.data, { page: 'artifact', 'gate-state': 'approved' });
});
