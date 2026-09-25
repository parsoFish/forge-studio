/**
 * beats-fork.mjs — the `fork` verb (forge-8vfn.2.22): a beat that runs once
 * per CASE instead of once.
 *
 * `tests/stories/S2.story.mjs:143` declares `fork: { over: 'create-app-type',
 * cases: STARTERS }` on beat 3, because §3's S2 is "a starter → repo created",
 * singular, but every project template forge ships must reach the same green
 * contract — the requirement the story's own header (lines ~56-65) records as
 * standing in the pinned artifact while §3.1's schema caught up, exactly as S1
 * once stood with `do` blocks the runner could not yet perform.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE. Beat 3's three cases each create a
 * project named `ground.project` ("story-s2") — the SAME name every time, per
 * the story's own header ("what state each case leaves: a created project per
 * case"). So a second case's own `create-project` press would meet the first
 * case's leftover repo and answer `409 already exists`, exactly the shape S2's
 * own header says S1 hits for a different reason. Per-case ground reset
 * BETWEEN cases is not something this harness owns anywhere today —
 * `sweepProductFixtures` (`sweep.mjs`) runs ONCE, at the end of the WHOLE run,
 * never between beats or between a fork's own cases — and this module does
 * not invent one: inventing a second, undeclared ground-licensing mechanism
 * to paper over that would be exactly the kind of state a reviewer could not
 * verify against anything §3.1 states. So `expandForkedBeats` substitutes each
 * case into the beat and hands the result to the SAME driver every other beat
 * gets, running every case against the SAME shared ground; a story whose
 * cases collide on that shared state reds HONESTLY, on the product's own
 * conflict, which is reported as a finding rather than hidden by a cleanup
 * step nobody asked this bead to build.
 */

/**
 * Flatten `story.beats` into the sequence the runner actually drives — one
 * entry per case for a beat that forked, one entry for every other beat.
 *
 * `number` is the ORIGINAL 1-indexed position in `story.beats`, shared by
 * every case of a fork: ground-licensing (`ground.expectedChanges[].beat`,
 * `run-story.mjs`'s `licensedBeatNumbers`) is declared against that number,
 * never against a flattened position, and a licence captured once per NUMBER
 * — at the first case to reach it — stays "before anything in this beat can
 * run" rather than being re-taken (and so re-dated, past whatever the
 * previous case already did to the ground) for every later case.
 *
 * `label` is what a reader sees: `"3"` for an ordinary beat, `"3[api]"` for a
 * case — the shape the brief's own example names (`3` → `3[typescript-api]`).
 *
 * An unforked beat's `beat` field is the SAME OBJECT the story declared, not
 * a copy — `Object.freeze` upstream already makes it immutable, and passing
 * it through unchanged is how a story with no fork at all costs this function
 * nothing beyond the wrapper.
 *
 * @param {ReadonlyArray<object>} beats `story.beats`, already validated
 * @returns {ReadonlyArray<{beat: object, number: number, label: string}>}
 */
export function expandForkedBeats(beats) {
  return beats.flatMap((beat, i) => {
    const number = i + 1;
    if (beat.fork === undefined) return [{ beat, number, label: String(number) }];
    return beat.fork.cases.map((c) => ({
      beat: substituteForkCase(beat, c),
      number,
      label: `${number}[${c}]`,
    }));
  });
}

/**
 * A copy of `beat` with the `do` step named by `beat.fork.over` having its
 * `with` replaced by `caseValue`, and `fork` itself dropped — the result
 * carries no trace of having been forked, so the driver that runs it needs no
 * awareness that it came from one.
 *
 * Every OTHER field survives untouched (`costless` included, so the two
 * features compose without either needing to know about the other), and the
 * input is never mutated: `beat.do` may be `Object.freeze`d by `validateStory`,
 * and this always returns a fresh array and a fresh object.
 *
 * @param {Readonly<object>} beat a beat carrying `fork: {over, cases}`
 * @param {string} caseValue one of `beat.fork.cases`
 * @returns {Readonly<object>}
 */
export function substituteForkCase(beat, caseValue) {
  const steps = (beat.do ?? []).map((step) =>
    (Object.hasOwn(step, 'fill') && step.fill === beat.fork.over) ? { ...step, with: caseValue } : step);
  const { fork, ...rest } = beat;
  return Object.freeze({ ...rest, do: Object.freeze(steps) });
}
