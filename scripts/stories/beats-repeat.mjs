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
 * So this acts UNTIL ITS OWN `until` CONDITION answers, spending what is LEFT
 * of the bound the beat already declares: no invented count, no new ceiling.
 *
 * `until` IS THE REPEAT'S OWN, NOT THE BEAT'S (T1 ruling 320). Borrowing the
 * beat's `expect.data` is unreachable whenever the repeat is not the last step,
 * and that cost two funded runs: S1 beat 11's `do` is
 * `[view-architect-session, repeat, open-plan, approve-plan]` with an
 * `expect.data` of `architect-phase: 'committed'` — a state produced by
 * `approve-plan`, which runs AFTER the repeat. The loop could never stop by
 * answering questions, so it kept submitting to a session that had already
 * drafted (`status.json`: `phase: "awaiting-verdict", round: 2`), pressing a
 * control that disables itself once every answer is not resolved
 * (`ArchitectQuestionForm.tsx:194`), until the bound expired.
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
 * How long ONE act inside a repeat may wait before it hands control back.
 *
 * Bead `forge-8vfn.6.11.41`, T1 ruling 362, measured on S2 run 9's captured
 * ground: `questions.json` was written 2 ms BEFORE the product announced it and
 * the box was `present and enabled` throughout, yet **7 m 41 s** passed before
 * the answer landed — all of it inside a single `.fill()` that had been handed
 * `left()`, the beat's whole remaining bound.
 *
 * THIS INVENTS NO CEILING (`6.11.22`, ruling 267). The beat's declared wait is
 * still the only spend; this only says that ONE act may not eat it, because
 * the loop above IS the retry — a failed act returns here, `until` is re-read,
 * and the next attempt costs another poll rather than the beat. Set to the poll
 * interval's order for exactly that reason: the cost of being wrong once.
 *
 * It applies INSIDE A REPEAT ONLY. A one-shot act keeps `left()`: there is no
 * loop to return to, and `6.11.6` — S1 beat 9's `apply-clause-decision`, which
 * is disabled while the product applies auto-fixes one clause at a time —
 * needs precisely that patience.
 */
export const ACT_BOUND_MS = 1000;

/**
 * Playwright's word for "the element you were acting on left the DOM". Matched
 * on the message rather than an error class because `run` hands back a string
 * the step executor already formatted (`could not fill <handle>: …`).
 */
const DETACHED_RE = /detach/i;

/**
 * Run one `repeat` step to its conclusion.
 *
 * @param {object} input
 * @param {object} input.page              the live page
 * @param {{repeat: object[]}} input.step  the step being run
 * @param {() => number} input.left        ms remaining of the beat's ONE declared bound
 * @param {((spec: Record<string,string>) => Promise<boolean>)|null} input.matches  reads the live page against a data spec
 * @param {number} input.timeoutMs         that bound, for the failure text
 * @param {(steps: object[], ms: number) => Promise<{waitedForHandle: boolean, error: string|null}>} input.run
 * @returns {Promise<{waitedForHandle: boolean, error: string|null}>}
 */
export async function runRepeatStep({ page, step, left, matches, timeoutMs, run }) {
  let waitedForHandle = false;

  const until = step.until ?? null;
  if (until === null || matches === null) {
    return {
      waitedForHandle,
      error:
        'a `repeat` step needs an `until`: the condition that ends the loop, named by the repeat ' +
        'itself. Without it the loop would be bounded only by the wait. (T1 ruling 320 — the ' +
        "beat's own `expect.data` is NOT borrowed: it is unreachable whenever the repeat is not " +
        'the last step.)',
    };
  }
  const isSatisfied = () => matches(until);

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

    // A ROUND IS SEVERAL ACTIONS LONG, AND THE PRODUCT CAN LEAVE THE INTERVIEW
    // BETWEEN THEM (bead `forge-8vfn.6.11.38`, ruling 349). The inner steps are
    // therefore run ONE AT A TIME with `until` re-read before each, instead of
    // handing the whole array to `run` and checking once per round. S1 run 8's
    // archive is the fixture: the session was at `awaiting-verdict, round 4`
    // while the loop was still filling round 4's field, and the beat died 357 s
    // later on a control that had correctly gone.
    let interrupted = false;
    for (const one of step.repeat) {
      if (await isSatisfied()) { interrupted = true; break; }
      const inner = await run([one], left(), ACT_BOUND_MS);
      if (inner.waitedForHandle) waitedForHandle = true;
      if (inner.error === null) continue;
      // The product may have moved on mid-round — a control vanishing BECAUSE
      // the expectation is now met is a success, not a failure.
      if (await isSatisfied()) { interrupted = true; break; }
      // A DETACHED control is the page moving under the loop, which is the very
      // event `until` exists to notice — not a failure of this beat. `until` is
      // a DOM read, so the product can have moved while the page is still
      // re-rendering: give it a poll and re-read rather than reporting the
      // symptom. Bounded by the beat's own declared wait, which the positive
      // control below still reds on.
      if (!DETACHED_RE.test(inner.error)) {
        return { waitedForHandle, error: `repeat, round ${rounds + 1}: ${inner.error}` };
      }
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, left())));
      interrupted = true;
      break;
    }
    if (interrupted) continue;
    rounds += 1;
  }

  if (!(await isSatisfied())) {
    return {
      waitedForHandle,
      error:
        `repeat: answered ${rounds} round(s) and this beat's declared bound (${timeoutMs} ms) ran ` +
        `out before its \`until\` (${JSON.stringify(until)}) was met — the act kept being available, ` +
        'so the product never moved on.',
    };
  }

  return { waitedForHandle, error: null };
}
