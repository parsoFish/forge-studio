/**
 * `{ repeat: [ ...steps ] }` — §3.1, T1 rulings 312/317.
 *
 * Split out of `beats.mjs` when that file reached its 800-line cap. The verb is
 * cohesive enough to own a module, and `performSteps` is INJECTED rather than
 * imported: a repeat runs its inner steps through the very function that
 * dispatches it, so importing back would be a cycle.
 *
 * WHY THE VERB EXISTS. The architect interviews before it plans and decides how
 * many ROUNDS it needs, exactly as it decides how many questions a round holds
 * (`fillAll`'s reason). `bridge-studio-architect.ts:380` writes
 * `{ phase: 'interviewing', round: round + 1 }` and spawns another turn on every
 * submission, and the product has no ceiling at all (bead `forge-8vfn.6.10.28`).
 *
 * A fixed number of submit steps is wrong in BOTH directions:
 *   · too few  — the session never reaches the draft;
 *   · too many — `submit-answers` exists only while the session awaits answers
 *                (`studio/session-kinds.yaml:88`), so the surplus press reds on
 *                a control that is correctly gone.
 *
 * So this acts UNTIL the beat's own expectation answers, spending what is LEFT
 * of the bound the beat already declares: no invented count, no new ceiling.
 */

/**
 * The `data-*` handle a `do` step acts on. One definition, shared with the step
 * executor in `beats.mjs`, so the repeat's gate and the act itself can never
 * disagree about what a step is waiting for.
 */
export function handleFor(step) {
  const fillsAll = Object.hasOwn(step, 'fillAll');
  const fills = fillsAll || Object.hasOwn(step, 'fill');
  const key = fillsAll ? step.fillAll : fills ? step.fill : step.press;
  return `[data-${fills ? 'field' : 'action'}="${key}"]`;
}

/** How long to wait between polls while the agent turn between rounds runs. */
const POLL_MS = 500;

/**
 * Run one `repeat` step to its conclusion.
 *
 * @param {object} input
 * @param {object} input.page              the live page
 * @param {{repeat: object[]}} input.step  the step being run
 * @param {() => number} input.left        ms remaining of the beat's ONE declared bound
 * @param {(() => Promise<boolean>)|null} input.isSatisfied  the beat's own expectation
 * @param {number} input.timeoutMs         that bound, for the failure text
 * @param {(steps: object[], ms: number) => Promise<{waitedForHandle: boolean, error: string|null}>} input.run
 * @returns {Promise<{waitedForHandle: boolean, error: string|null}>}
 */
export async function runRepeatStep({ page, step, left, isSatisfied, timeoutMs, run }) {
  let waitedForHandle = false;

  // A repeat with nothing to reach would be bounded only by the wait, which is
  // an authoring error and is named as one rather than silently spun.
  if (isSatisfied === null) {
    return {
      waitedForHandle,
      error:
        'a `repeat` step needs something to repeat UNTIL: this beat declares no `expect.data` for ' +
        'it to reach, so the loop would be bounded only by the wait. Give the beat the expectation ' +
        'the repeated act is meant to produce.',
    };
  }

  const gate = handleFor(step.repeat[0]);
  let rounds = 0;

  while (left() > 0) {
    if (await isSatisfied()) break;

    // Nothing to act on yet — the agent turn between rounds is still running.
    // Poll rather than spend the bound inside a handle wait, which cannot tell
    // "another round is coming" from "it drafted instead".
    if ((await page.locator(gate).count()) === 0) {
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, left())));
      continue;
    }

    const inner = await run(step.repeat, left());
    if (inner.waitedForHandle) waitedForHandle = true;
    if (inner.error !== null) {
      // The product may have moved on mid-round — a control vanishing BECAUSE
      // the expectation is now met is a success, not a failure.
      if (await isSatisfied()) break;
      return { waitedForHandle, error: `repeat, round ${rounds + 1}: ${inner.error}` };
    }
    rounds += 1;
  }

  if (!(await isSatisfied())) {
    return {
      waitedForHandle,
      error:
        `repeat: answered ${rounds} round(s) and this beat's declared bound (${timeoutMs} ms) ran ` +
        'out before what it waits for arrived — the act kept being available, so the product never ' +
        'moved on.',
    };
  }

  return { waitedForHandle, error: null };
}
