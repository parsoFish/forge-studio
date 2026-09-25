/**
 * beats-fork-wiring.test.ts — forge-8vfn.2.22 (PR-B item 1), THE CONNECTION.
 *
 * `expandForkedBeats`/`substituteForkCase` (`beats-fork.mjs`) and the `fork`
 * schema (`story-file.mjs`) are each doored on their own — a fact that exists
 * and reaches nothing is exactly the species `ground-clear.test.ts`'s
 * `7.6.123 WIRING` door exists for, and this is the same shape. No test in
 * this repo imports `runStory` (it drives a real chromium context end to
 * end), so this pins the BEAT LOOP's source statically via
 * `runnerSourceContaining`, the same convention every other `run-story.mjs`
 * door in this branch uses.
 *
 *   1. the loop drives the EXPANDED sequence, not `story.beats` directly —
 *      every case of a fork must reach `driveBeat` as its own beat;
 *   2. a beat-scoped ground licence (`ground.expectedChanges[].beat`) is keyed
 *      on the ORIGINAL beat number the expansion carries, captured once per
 *      number rather than re-taken for every later case;
 *   3. the printed beat line carries the case label (`"2[cli]"`), not a bare
 *      re-derived index — so a reader (and the run's own console transcript)
 *      can tell which case produced which verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

test('the beat loop imports expandForkedBeats from beats-fork.mjs', () => {
  const runner = runnerSourceContaining('expandForkedBeats(story.beats)');
  assert.match(
    runner.path.split('/').pop() ?? '',
    /^run-story\.mjs$/,
  );
  assert.match(
    runner.source,
    /import \{[^}]*expandForkedBeats[^}]*\} from '\.\/beats-fork\.mjs'/s,
    'the beat loop must import the flattener rather than iterating story.beats directly',
  );
});

test('the ground-scoped licence boundary is captured ONCE per original beat number, not per case', () => {
  const runner = runnerSourceContaining('expandForkedBeats(story.beats)');
  // `groundBeatBoundaries.has(...)` guards the capture so a second (or third)
  // case of the same forked beat does not re-take — and so re-date — the
  // "before anything in this beat can run" manifest past what an earlier
  // case already did to the ground.
  assert.match(
    runner.source,
    /groundBeatBoundaries\.has\(/,
    'the boundary capture must guard against being re-taken for a later case of the same fork',
  );
});

test('the printed beat line carries the case label, not a bare re-derived index', () => {
  const runner = runnerSourceContaining('expandForkedBeats(story.beats)');
  // The label is threaded from the expansion (e.g. "2[cli]") into the
  // console line that used to read `${i + 1}. ${beat.act}` — pinned by
  // absence: that literal template must no longer appear verbatim.
  assert.doesNotMatch(
    runner.source,
    /\$\{i \+ 1\}\. \$\{beat\.act\}/,
    'the beat-loop print must use the expansion\'s own label, not a bare index',
  );
});
