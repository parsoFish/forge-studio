/**
 * beats-steps.mjs — what an operator DOES on a page, before the beat is judged.
 *
 * Split out of `beats-drive.mjs` at the 800-line cap (T1 ruling 492: SPLIT,
 * NEVER BASELINE). `beats-drive.mjs` had reached 828 lines when ruling 553's
 * `waitForRoute` landed, and the seam was already there to be used: that file
 * holds `driveBeat`, which decides what a beat MEANS, and this one holds
 * `performSteps`, which executes the `do` block — presses, fills, repeats, and
 * the bounded waits each of them needs. They are two jobs that happen to have
 * been written next to each other, and the split follows the same shape the
 * runner already uses for `beats-repeat.mjs`, `beats-control-state.mjs` and
 * `beats-page.mjs`.
 *
 * The direction of the dependency is the reason this is the right seam and not
 * the reverse one: `driveBeat` calls `performSteps` and nothing here calls back.
 * `runRepeatStep` still receives `performSteps` by injection, because a repeat
 * runs its inner steps through the very function that dispatches it and an
 * import back would close a cycle.
 */
import { routeMatches, waitForHandleOrStall } from './beats-page.mjs';
import { handleFor, runRepeatStep } from './beats-repeat.mjs';
import { watchControlState } from './beats-control-state.mjs';
import { READY_TIMEOUT_MS } from './beats.mjs';

/** How long a press may be wrong-looking before it is called wrong (ruling 531(3)).
 *  Long enough to outlast an asynchronous route commit, short enough that it is
 *  an answer at t+0 rather than a bound. */
const WRONG_PAGE_GRACE_MS = 2_000;
/** How often that grace re-asks. */
const WRONG_PAGE_POLL_MS = 25;

export async function performStepsForTest(page, steps, timeoutMs, matches) {
  return performSteps(page, steps, timeoutMs, false, null, matches);
}

export async function performSteps(page, steps, timeoutMs, sessionScope = null, probe = null, matches = null, actBoundMs = null, declaredRoute = null, stallDoor = null, progress = null, readProgressNow = null) {
  // Bead `forge-8vfn.6.11.22` (ruling 267). ONE declared bound is ONE spend. The
  // handle wait SWALLOWS its timeout and the act that follows was then handed
  // `timeoutMs` afresh, so a beat whose handle never appears paid the bound
  // twice — measured on S2 run 3, the lane's LAST S2 run: a declared 600 000 ms
  // became a twenty-minute beat, on a session that was never stalled but simply
  // did not publish the handle. A bound is a statement about the BEAT, not about
  // each wait inside it, so every wait below reads what is LEFT of one deadline.
  const deadlineAt = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadlineAt - Date.now());
  // Bead `forge-8vfn.6.11.41` (ruling 362). What ONE act may wait, which is the
  // beat's whole remaining bound EXCEPT inside a repeat, where the loop is the
  // retry and a failed act should cost a poll. Never larger than `left()`: the
  // declared bound is still the only spend (`6.11.22`).
  const actLeft = () => (actBoundMs === null ? left() : Math.min(actBoundMs, left()));
  // `waitedForHandle` feeds `6.11.19`'s guard: it says whether this block gave
  // the beat's declared bound to a waiter that watches the PAGE for a handle
  // the agent has to produce, rather than to a URL change.
  let waitedForHandle = false;
  // Where this `do` STARTED — the page the previous BEAT left us on. The
  // wrong-page check below applies only while we are still standing there
  // (ruling 569, the multi-surface half). Once one of our own steps has
  // navigated, the beat is driving and its declared route says nothing about
  // where the next step should act: S10 beat 5 presses `open-plan` on the
  // session page and `approve-plan` on `/artifact`, and only the first of those
  // is judged against where the previous beat left it.
  //
  // This keeps the coverage exempting repeats alone would lose: a `do` of
  // `[{ fill }, { press }]` never navigates before the press, so the press is
  // still judged — and that is exactly where S10 beat 4's authoring error lived.
  //
  // Read ONLY when the check can fire. `performStepsForTest` and a repeat's
  // inner steps both pass `declaredRoute: null`, and their fakes need not model
  // `page.url()` at all — an unconditional read here broke eight repeat tests
  // with `page.url is not a function`, which is a production function
  // demanding more of a page than it uses.
  const doStartedAt = declaredRoute === null ? null : page.url();
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    // `{ repeat: [...] }` — §3.1, T1 rulings 312/317. Its whole body lives in
    // `beats-repeat.mjs`; `performSteps` is injected because a repeat runs its
    // inner steps through the very function that dispatches it, and importing
    // back would be a cycle.
    if (Object.hasOwn(step, 'repeat')) {
      const r = await runRepeatStep({
        page, step, left, matches, timeoutMs, sessionScope, probe,
        // 7.6.77's repeat half. A beat's progress bound belongs to the wait that
        // actually spends the beat's time, and for S1 beat 11 that is this loop
        // (T1 ruling 930) — not the consequence wait the first half shipped on.
        progress, readProgressNow,
        // `declaredRoute` is NOT passed down — T1 ruling 569, P1, bought by
        // A's S1 run 2. A beat's declared route is where the beat ENDS; a
        // repeat runs where the beat PUT it. S1 beat 11 is declared at
        // `/artifact` (its landing after `approve-plan`) while its repeat
        // answers the architect on the session page, so every inner
        // `submit-answers` stands off the declared route BY DESIGN — and
        // between rounds the handle is legitimately gone while the architect
        // takes its turn. Both halves of the wrong-page check were true of a
        // beat doing exactly what it was written to do, and it was refused
        // mid-loop with "the beat was not waiting for an agent" — which is
        // precisely what it was doing.
        //
        // The grace made it worse rather than saving it: two seconds is right
        // for a page mid-commit and hopeless for an agent mid-round. What
        // governs a repeat is its own `until` and the beat's declared bound,
        // and both were already doing their job.
        run: (inner, ms, actMs = null) => performSteps(page, inner, ms, sessionScope, probe, matches, actMs, null, stallDoor),
      });
      if (r.waitedForHandle) waitedForHandle = true;
      if (r.error !== null) return { waitedForHandle, error: r.error };
      continue;
    }

    // `fillAll` — bead `forge-8vfn.6.11.21` (ruling 271). Same `data-field`
    // vocabulary as `fill`; it differs only in HOW MANY matches it acts on,
    // because a round of architect questions renders one box per question and
    // the count is model-determined.
    const fillsAll = Object.hasOwn(step, 'fillAll');
    const fills = fillsAll || Object.hasOwn(step, 'fill');
    const handle = handleFor(step);

    // T1 ruling 531(3) — STANDING ON THE WRONG PAGE, answered at t+0.
    //
    // S10 run 2 beat 4 spent its full declared 600 000 ms pressing
    // `[data-action="open-session"]` on `/architect/new`, and beat 13 spent
    // 900 000 ms the same way. Neither was waiting for an agent. `open-session`
    // is the LIST surfaces' handle (Home's strip, the sessions index, the plan
    // gate); the mint page publishes `view-architect-session`. No amount of
    // waiting was going to make that page grow a control it does not have, and
    // the runner could have said so before the first poll.
    //
    // BOTH CONDITIONS, and neither is optional:
    //
    //   the handle is absent from the WHOLE document — not merely not-yet, but
    //   nowhere; and
    //
    //   the page is not the beat's declared route.
    //
    // The second is what keeps every navigating beat alive. `performSteps` runs
    // BEFORE the route wait and before real-nav, so a beat is NORMALLY off its
    // declared route while it presses: S10 beat 2 presses
    // `start-work-architect` from `/projects/gitpulse`, and that press is what
    // navigates to `/architect/new`. Off-route alone would red every story at
    // its first navigating beat.
    //
    // The first is what keeps an agent wait alive. A control that appears only
    // once an agent has acted is the entire reason `waitForHandleOrStall` has a
    // bound — S2 beat 12's `session-answer` exists only after the architect
    // ASKS — and that beat stands ON its declared route, so this never fires
    // for it.
    //
    // Presses only. A `fill` names a field inside an affordance the press
    // before it opened, so "absent" there is the ordinary not-yet this rule
    // must not touch.
    if (!fills && declaredRoute !== null && page.url() === doStartedAt
        && !routeMatches(page.url(), declaredRoute)
        && (await page.locator(handle).count()) === 0) {
      // NOT a single sample. A previous beat's act can navigate ASYNCHRONOUSLY,
      // and during that commit window `page.url()` and the DOM both still
      // answer for the page being left (the class §2.28 names, and the reason
      // `6.11.47` scopes stop reasons at all). A one-shot read there reds a beat
      // that was about to arrive somewhere perfectly correct.
      //
      // The first version of this grace waited on
      // `main[data-page][data-page-ready="true"]` and was a NO-OP, which
      // `beats-agent-crashed.test.ts` caught immediately: the page being LEFT
      // satisfies that selector too, so the wait returned in the same tick and
      // the re-check read the same stale URL. A settle signal that the old page
      // already satisfies is not a settle signal.
      //
      // So the grace waits for the thing that would make this verdict WRONG —
      // the route arriving, or the handle appearing — and for nothing else.
      // Bounded at two seconds, never the beat's declared bound: two seconds
      // against the 600 000 ms this rule exists to stop is still an answer at
      // t+0, it is just not an answer taken while the page was moving.
      const graceUntil = Date.now() + Math.min(WRONG_PAGE_GRACE_MS, actLeft());
      let stillWrong = true;
      while (Date.now() < graceUntil) {
        await new Promise((resolve) => setTimeout(resolve, WRONG_PAGE_POLL_MS));
        if (routeMatches(page.url(), declaredRoute) || (await page.locator(handle).count()) > 0) {
          stillWrong = false;
          break;
        }
      }
      if (stillWrong) {
        const here = new URL(page.url(), 'http://forge.invalid');
        return {
          waitedForHandle,
          error:
            `standing on the wrong page: "${here.pathname}${here.search}" is not "${declaredRoute}", and ` +
            `${handle} is on no element of it. The beat was not waiting for an agent — this page does not ` +
            'carry that control at all, so the bound would have been spent to learn nothing. Reach the page ' +
            'that renders it first (a navigation beat, or a press that goes there).',
        };
      }
    }

    if (i > 0) {
      if (!Object.hasOwn(steps[i - 1], 'fill')) {
        // The step before this one may have navigated. Wait for the ARRIVAL
        // page's ready signal — bounded, and swallowed on timeout, because a
        // step that never navigated (a toggle, a same-route press) leaves
        // this already satisfied and the wait below reports the real story.
        await page
          .waitForSelector('main[data-page][data-page-ready="true"]', { timeout: left() })
          .catch(() => {
            /* still on the old page, or it never settled — the handle wait below reports it honestly */
          });
      }
      // Locate THIS step's handle with its own bounded wait rather than a
      // same-tick lookup — the page it lives on may only just have mounted.
      const stall = await waitForHandleOrStall(page, handle, actLeft(), sessionScope, probe, stallDoor);
      waitedForHandle = true;
      if (stall !== null) {
        return {
          waitedForHandle,
          error:
            `${stall.why} ${Math.round(stall.afterMs / 1000)}s into the ` +
            `agent wait, while this step waited for ${handle}. The product had already said so about this session, ` +
            'so the beat stopped there rather than spending its declared bound twice over — once here and again in ' +
            'the act that follows.',
        };
      }
    }

    // The bound is spent. Say so in the beat's own terms rather than letting the
    // act report `Timeout 0ms exceeded`, which names a bound nobody declared and
    // reads like a bug in the runner instead of a wait that ran out.
    if (left() === 0) {
      return {
        waitedForHandle,
        // The SAME prefix the act's own catch uses, so what a beat says when its
        // bound runs out and what it says when the act throws stay one shape.
        error:
          `could not ${fills ? `fill ${handle} with "${step.with}"` : `press ${handle}`}: ` +
          `waited this beat's whole declared bound (${timeoutMs} ms) for it and it never appeared, ` +
          'so the act was not attempted — one declared bound is one spend.',
      };
    }

    // Bead `forge-8vfn.6.11.30` (ruling 330) — say what the control IS while the
    // act waits, at the first poll and on every change. `describeControl` below
    // already computed this and printed it only after the bound expired: S2 run
    // 4, S1 run 6 and S1 run 7 each spent 461-515 s on a control that was
    // disabled the whole time, then said so. The information was never missing;
    // the timing was.
    const stopWatch = watchControlState(page, handle, (line) => console.log(line));
    try {
      if (fillsAll) {
        // Every match, or a red naming the field. ZERO is never a silent pass:
        // a round with nothing to answer means the product did not publish the
        // question form, which is exactly the gap S2 run 3 spent $25 finding.
        const n = await page.locator(handle).count();
        if (n === 0) {
          return {
            waitedForHandle,
            error: `could not fill every ${handle} with "${step.with}": no element carries that handle.`,
          };
        }
        for (let k = 0; k < n; k += 1) {
          // RE-READ THE COUNT BEFORE ADDRESSING THE INDEX — bead
          // `forge-8vfn.6.11.52`, ruling 372. The comment above says the count
          // is MODEL-DETERMINED, and so is its CHANGE: S2 run 11 answered a
          // three-box round in full, the product began the next round 12 ms
          // later, and this loop asked for `nth(2)` of a round that renders a
          // different number. `n` bounds the work from above so the loop can
          // only ever SHRINK — a form that grows mid-act is the next round's,
          // and belongs to the next pass of the repeat, not to this one.
          if (k >= (await page.locator(handle).count())) break;
          // The watcher must describe THE BOX THIS ACT IS ON. `controlState`
          // reads `.first()`, so while the act was stuck on box k the log
          // truthfully said box 0 was "present and enabled" — the two-notions-
          // of-one-thing class `handleFor` exists to prevent, one layer down.
          // S2 run 9 spent 7 m 41 s inside this loop saying nothing about it.
          const stopBox = watchControlState(page, `${handle} >> nth=${k}`, (line) => console.log(line));
          try {
            await page.locator(handle).nth(k).fill(step.with, { timeout: actLeft() });
          } finally {
            stopBox();
          }
        }
        continue;
      }
      if (!fills) {
        // Bounded by the RUNNER's timeout, not by `context.setDefaultTimeout`.
        // Playwright's click already retries until the control is visible,
        // ENABLED and stable — it just does it for 5 s (`run.mjs`), while the
        // runner is willing to wait `READY_TIMEOUT_MS`. S1 beat 9's
        // `apply-clause-decision` is disabled while the product applies
        // auto-fixes one clause at a time, and the press died at 5 s on a
        // control that frees itself: `element is not enabled`, twice, in two
        // live runs. Bead `forge-8vfn.6.11.6`. The bound was the defect; the
        // wait was always there.
        await page.locator(handle).first().click({ timeout: actLeft() });
        continue;
      }
      const refusal = await setControl(page, handle, step.with, actLeft());
      if (refusal !== null) return { waitedForHandle, error: refusal };
    } catch (e) {
      return {
        waitedForHandle,
        error:
          `could not ${fills ? `fill ${handle} with "${step.with}"` : `press ${handle}`}: ` +
          `${e?.message ?? e}. ${await describeControl(page, handle, timeoutMs)}`,
      };
    } finally {
      stopWatch();
    }
  }
  return { waitedForHandle, error: null };
}

/**
 * Why a control could not be acted on, read from the control itself.
 *
 * The shipped text guessed — "The control is absent, disabled, obscured or
 * not yet rendered" — four causes and no answer, so every such red arrived
 * unattributable and each one cost a story run to diagnose. A control that is
 * MISSING and a control that is BUSY are different findings: the first is a
 * product gap or a stale story, the second is the product serialising real
 * work and the story arriving early.
 *
 * Best-effort and never throws: this runs inside a `catch` that already has a
 * failure to report, and a description that threw would replace a real
 * finding with an error about describing it.
 */
async function describeControl(page, handle, timeoutMs) {
  try {
    const one = page.locator(handle).first();
    if ((await page.locator(handle).count()) === 0) return 'no element carries that handle.';
    return await one.evaluate((n) => {
      const off = n.disabled === true || n.getAttribute('disabled') !== null;
      if (!off) return 'The control is present and enabled — it was obscured, detached or never became stable.';
      const title = (n.title ?? '').trim();
      return `The control is present but still DISABLED${title === '' ? '' : ` (title: "${title}")`}.`;
    }, undefined, { timeout: timeoutMs });
  } catch {
    return 'The control could not be inspected after the failure.';
  }
}

/**
 * The two states a checkbox has, as story-file vocabulary. CLOSED and total:
 * an unknown `with` is refused naming the value and the allowed set, never
 * guessed — a checkbox that silently defaulted would arm or disarm a
 * permission in the beat that exists to prove which way it sits.
 */
const CHECKBOX_STATES = Object.freeze({ '': false, false: false, unchecked: false, true: true, checked: true });

/**
 * Read what ONE match actually is. Kept as a single `evaluate` so the common
 * path costs the same round trip it always did, and so the radio/checkbox
 * decision is made from the DOM rather than from the story's wording.
 */
const readShape = (el, timeoutMs) =>
  el.evaluate((n) => {
    const self = n.tagName === 'INPUT' ? n : null;
    const inner = self ?? n.querySelector('input[type="radio"],input[type="checkbox"]');
    const type = inner === null ? '' : inner.type;
    return {
      tag: n.tagName,
      kind: type === 'radio' || type === 'checkbox' ? type : '',
      value: inner === null ? '' : inner.value,
      text: (n.textContent ?? '').trim(),
    };
  }, undefined, { timeout: timeoutMs });

/**
 * The input to act on: the match itself when `data-field` sits ON the input
 * (the hook checkbox), the input it wraps when the field sits on a label (the
 * model-tier radios).
 *
 * `locator.locator()` searches DESCENDANTS ONLY, so descending unconditionally
 * looks for a checkbox inside the checkbox and times out after 30 s — measured
 * against real chromium on the planted DOM, invisible to a fake whose child
 * lookup fell back to the node itself. Measure the thing, not something next
 * to it.
 */
const inputOf = (el, tag, type) => (tag === 'INPUT' ? el : el.locator(`input[type="${type}"]`).first());

/**
 * Set one control to `want`.
 *
 * Ruling 52 (operator, wave-2 open). `fill` used to call `locator.fill` on
 * whatever the handle resolved to, and playwright refuses a radio or a
 * checkbox outright (`Input of type "radio" cannot be filled`), so three
 * stories died on the harness rather than on the product — S9 beat 5 on the
 * model-tier radios, S7 beat 7 on the network-egress checkbox.
 *
 * A radio group publishes ONE `data-field` on N elements, so `want` SELECTS
 * among the matches by the input's value (or, for a picker that renders its
 * label as text, by that text) — never by index. Picking `.first()` would
 * have made S9 beat 5 green having set the wrong model, which is worse than
 * the red it replaced.
 *
 * `data-field` sits on the `<label>` for the radios and on the `<input>` for
 * the checkbox, and playwright's `check()` refuses anything that is not the
 * input, so both act through the input — the match itself when it is one, the
 * input it wraps when it is not.
 *
 * Returns a refusal string, or null.
 */
/**
 * `timeoutMs` bounds every playwright ACTION here, not only the waits around
 * them — bead `forge-8vfn.6.11.10`'s second half (T1 ruling 225).
 *
 * S1 run 4 found it: beat 6 declared `wait: { for: 'agent', upTo: 600_000 }`
 * and still died at `locator.evaluate: Timeout 5000ms exceeded`, because
 * `readShape`'s evaluate and the `fill` below took no timeout and fell back to
 * `context.setDefaultTimeout(5000)` (`run.mjs`). `6.11.6`'s class a second
 * time — the wait existed, the BOUND was wrong for what it was waiting on —
 * and a field that exists only once an agent has ASKED cannot appear in five
 * seconds.
 */
async function setControl(page, handle, want, timeoutMs) {
  const all = page.locator(handle);
  const shape = await readShape(all.first(), timeoutMs);

  if (shape.kind === 'radio') {
    const n = await all.count();
    const options = [];
    for (let i = 0; i < n; i += 1) {
      const candidate = all.nth(i);
      const s = await readShape(candidate, timeoutMs);
      options.push(s.value === '' ? s.text : s.value);
      if (s.value === want || (s.value === '' && s.text === want)) {
        await inputOf(candidate, s.tag, 'radio').check();
        return null;
      }
    }
    return (
      `could not fill ${handle} with "${want}": no radio option carries that value. ` +
      `The options on the page are: ${options.map((o) => `"${o}"`).join(', ')}.`
    );
  }

  if (shape.kind === 'checkbox') {
    if (!Object.hasOwn(CHECKBOX_STATES, want)) {
      return (
        `could not fill ${handle} with "${want}": a checkbox has two states and that names neither. ` +
        `Allowed: ${Object.keys(CHECKBOX_STATES).map((k) => `"${k}"`).join(', ')} ` +
        '(the empty string, "false" and "unchecked" leave it unticked; "true" and "checked" tick it).'
      );
    }
    const input = inputOf(all.first(), shape.tag, 'checkbox');
    if (CHECKBOX_STATES[want]) await input.check();
    else await input.uncheck();
    return null;
  }

  const el = all.first();
  if (shape.tag === 'SELECT') await el.selectOption(want, { timeout: timeoutMs });
  else await el.fill(want, { timeout: timeoutMs });
  return null;
}




