import {
  PLACEHOLDER, answers, resolveExpectations, ERROR_SENTINELS, readObserved,
  LIFECYCLE_STALLED, waitForConsequence, waitForHandleOrStall,
} from './beats-page.mjs';

/**
 * beats.mjs — judging one story beat.
 *
 * `beatVerdict` is PURE and lives apart from any browser I/O, so every rule
 * about what makes a beat red is unit-testable without booting Studio. That
 * separation is the point: the old harness could only be trusted by running
 * it.
 *
 * The rule the whole module exists to enforce: **a beat is judged against the
 * expectations it DECLARED, never against the state that happened to be
 * there.** Iterating observed state instead of expected state is the
 * fail-open shape — it reports green for a page that rendered nothing.
 */



/**
 * Judge one beat against what was observed on the page.
 *
 * @param {{act: string, say: string, expect: {route: string, data: Record<string,string>}}} beat
 * @param {{route: string, data: Record<string,string>, nested?: readonly Record<string,string>[]}} observed
 * @returns {Readonly<{act: string, say: string, status: 'green'|'red', failures: readonly string[], bindings: Readonly<Record<string,string>>}>}
 */
export function beatVerdict(beat, observed) {
  const failures = [];
  const bindings = {};

  if (observed.route !== beat.expect.route) {
    failures.push(`route: expected "${beat.expect.route}", got "${observed.route}"`);
  }

  const seen = resolveExpectations(beat.expect.data, observed);

  // Iterate the EXPECTED keys. Never the observed ones — an attribute the UI
  // never rendered must be a failure, not an absence nobody looked for.
  for (const [attr, want] of Object.entries(beat.expect.data)) {
    if (!Object.hasOwn(seen, attr)) {
      failures.push(`data-${attr}: expected "${want}", absent from the page`);
      continue;
    }
    const got = seen[attr];
    const placeholder = PLACEHOLDER.exec(want);
    if (placeholder !== null) {
      // A value the product mints at runtime. Any value binds; the empty
      // string is a product that minted nothing, and binding it would put an
      // empty segment in a later beat's route.
      if (got === '') failures.push(`data-${attr}: expected a value to bind as ${want}, got ""`);
      else bindings[placeholder[1]] = got;
      continue;
    }
    if (got !== want) {
      failures.push(`data-${attr}: expected "${want}", got "${got}"`);
    }
  }

  // SETTLED IS NOT SUCCEEDED. The product's convention is that a route whose
  // fetch THREW still renders its own `data-page` and `data-page-ready="true"`
  // — it HAS settled, into an honest failure — and reports it via
  // `data-fetch-status="error"` / `data-load-error="true"`
  // (`components/PageLoadError.tsx`; `ProjectsIndex.tsx`:
  // `error ? 'error' : ready ? 'ok' : 'loading'`).
  //
  // So a beat asserting only {page, page-ready} passes against a visibly
  // broken page. The runner judges these sentinels on EVERY beat rather than
  // trusting each story author to remember them — a rule that depends on nine
  // authors remembering is how this class survives. A story that deliberately
  // asserts an error surface simply declares it, and is honoured.
  for (const [attr, bad] of ERROR_SENTINELS) {
    if (observed.data[attr] !== bad) continue;
    if (beat.expect.data[attr] === bad) continue; // the story asked for it
    failures.push(
      `data-${attr} is "${bad}": the page settled into an error, so this beat cannot pass. ` +
        'Assert it deliberately if the story is about the failure surface.',
    );
  }

  return Object.freeze({
    act: beat.act,
    say: beat.say,
    status: failures.length === 0 ? 'green' : 'red',
    failures: Object.freeze(failures),
    bindings: Object.freeze(bindings),
    // What the beat was JUDGED against, root and nested alike. The how-to
    // fragment renders this as its "what you should see" list, so reporting
    // only the page root would let a beat assert `data-card-id="gitweave"`
    // while the generated documentation never mentions it — the tests, demos
    // and docs drifting apart inside the one script §3 built to stop that.
    data: Object.freeze({ ...observed.data, ...seen }),
  });
}

/**
 * The verdict for a beat that never reached its page — a `do` step that could
 * not act, no real-nav path, a control that was not actionable. All three
 * leave the browser on the PREVIOUS page, which is read so the failure can
 * name where it was stuck.
 *
 * It exports NO bindings. A `<name>` harvested from the wrong page would hand
 * a later beat a route segment that page happened to supply, and that beat
 * could go GREEN on it — the fail-open shape, reached through the new verb.
 */
export function stuckVerdict(beat, observed, failure) {
  return Object.freeze({
    ...beatVerdict(beat, observed),
    status: 'red',
    failures: Object.freeze([failure]),
    bindings: Object.freeze({}),
    data: observed.data,
  });
}





/**
 * Substitute the `<name>` segments of a beat's route from what earlier beats
 * bound. The pinned S1 already writes this convention: beat 4 declares
 * `'onboard-session-id': '<sessionId>'`, beats 5-6 route
 * `/sessions/onboarding/<sessionId>`.
 *
 * An unbound placeholder is NOT navigated to as a literal — that would 404 and
 * blame the product for a story-authoring gap.
 */
export function resolveBeatRoute(beat, bindings) {
  let unbound = null;
  const route = beat.expect.route.replace(/<([A-Za-z][A-Za-z0-9_]*)>/g, (whole, name) => {
    if (Object.hasOwn(bindings, name)) return bindings[name];
    unbound ??= name;
    return whole;
  });
  return { route, unbound };
}





/** How long to wait for a page to declare itself ready before judging it. */
const READY_TIMEOUT_MS = 15_000;

/**
 * The bound this beat's waits get, and the NAME of the bound that fired.
 *
 * Bead `forge-8vfn.6.11.10` (T1 ruling 220). Three beats across three stories
 * — S1 beat 6 and S2 beat 12 (`session-answer` absent until the agent asks)
 * and S4 beat 11 (`session-phase` still `interviewing`) — were red not because
 * the product was wrong but because `READY_TIMEOUT_MS` was the runner's ONLY
 * bound, and fifteen seconds is right for a DOM update and absurd for an
 * architect's interview. Same family as `6.11.6`: the wait existed; the BOUND
 * was wrong for what it was waiting on.
 *
 * DECLARED, never inferred, and never global. Raising `READY_TIMEOUT_MS`
 * would make every genuine product red take fifteen times longer to fail, so
 * a beat that stands on an agent says so — `wait: { for: 'agent', upTo: <ms> }`
 * — and only that beat waits longer. §3.1 states it so no story has to read
 * this file to learn it.
 */
function beatBound(beat, domTimeoutMs) {
  const declared = beat.wait;
  if (declared === undefined || declared === null) return { ms: domTimeoutMs, label: null };
  return { ms: declared.upTo, label: `agent wait (declared ${declared.upTo} ms)` };
}





/**
 * Append what the agent's own process was doing, to a RED verdict ONLY.
 *
 * Bead `forge-8vfn.6.11.22`. `6.11.17` is P1, open, owner unknown and
 * INTERMITTENT — S4 run 2 hung while an out-of-story dispatch and S2 run 3's
 * architect both completed — so the next occurrence has to describe itself
 * rather than be reconstructed from an archive by hand afterwards.
 *
 * A GREEN beat carries no diagnosis: nobody needs it, and the generated how-to
 * renders a beat's failures, so a trend on a passing beat would become
 * documentation of nothing.
 */
function withAgentProc(verdict, probe) {
  if (verdict.status !== 'red' || probe === null || typeof probe?.summary !== 'function') return verdict;
  let trend = null;
  try {
    trend = probe.summary();
  } catch {
    return verdict; // diagnosis is never load-bearing
  }
  if (trend === null || trend === undefined || trend === '') return verdict;
  return Object.freeze({ ...verdict, failures: Object.freeze([...verdict.failures, trend]) });
}

/**
 * Reach the beat's route by REAL NAVIGATION and read what the page shows.
 *
 * `page.goto` is used for the FIRST beat only — the operator opening Studio.
 * Every later beat must get there the way an operator does, by clicking a real
 * control: a story that teleports between routes proves each route renders but
 * never proves you can get from one to the next.
 *
 * The story contract (§3.1) gives prose in `act` and a route in
 * `expect.route`, and no selector. So the runner resolves the click from the
 * route itself — the nav pillar pointing at it, else any link to it. When
 * neither exists the beat is RED saying so; it never falls back to
 * `page.goto`, which would let an unreachable route pass.
 *
 * `timeoutMs` bounds every wait this call makes (`run.mjs` never passes it,
 * so production always gets `READY_TIMEOUT_MS`); it exists so a test can
 * prove a wait gives up at its bound without the suite actually sitting
 * through 15 real seconds to do it.
 */
export async function driveBeat(page, rawBeat, index, baseUrl, bindings = {}, timeoutMs = READY_TIMEOUT_MS, agentProcProbe = null) {
  const { route: target, unbound } = resolveBeatRoute(rawBeat, bindings);
  if (unbound !== null) {
    return Object.freeze({
      act: rawBeat.act,
      say: rawBeat.say,
      status: 'red',
      failures: Object.freeze([
        `route "${rawBeat.expect.route}" needs <${unbound}>, which no earlier beat bound. ` +
          'A beat binds a segment by expecting `<name>` for a data-* key the product mints.',
      ]),
      bindings: Object.freeze({}),
      data: {},
    });
  }
  const beat = Object.freeze({ ...rawBeat, expect: Object.freeze({ ...rawBeat.expect, route: target }) });
  const steps = beat.do ?? [];
  // `6.11.10`: one bound per beat, resolved once, used by every wait this call
  // makes — the step waits, the consequence wait and the ready wait alike. A
  // beat that declared an agent-scale wait and still reds must SAY which bound
  // gave up, or "red at 15 s" and "red at ten minutes" read identically in a
  // run record.
  const bound = beatBound(rawBeat, timeoutMs);
  // What ENDED the wait, so the verdict can say it. `null` = the bound did.
  let stalled = null;
  // Bead `forge-8vfn.6.11.19` (T1 ruling 254). Did a waiter that can actually
  // OBSERVE the agent take this beat's declared bound? The URL wait and the
  // page-ready wait both consume it and neither watches an agent — which is
  // precisely how `6.11.17` hid — so neither sets this.
  let agentWaitConsumed = false;
  const named = (verdict) => {
    if (verdict.status !== 'red') return verdict;
    const why =
      stalled !== null
        ? `the session's own lifecycle read "${LIFECYCLE_STALLED}" ${Math.round(stalled.afterMs / 1000)}s into the ` +
          `${bound.label} — the product had already declared this session hung, so the beat stopped there instead ` +
          'of sitting out its declared bound'
        : bound.label === null
          ? null
          : `gave up at the ${bound.label}`;
    return why === null ? verdict : Object.freeze({ ...verdict, failures: Object.freeze([...verdict.failures, why]) });
  };

  if (index === 0) {
    await page.goto(baseUrl + target, { waitUntil: 'domcontentloaded' });
  }

  // What the operator DOES, on the page they are standing on — the previous
  // beat's page — before this beat's state is judged. All nine operator flows
  // are form-driven, and until this existed the runner could only follow
  // links, so a story stopped dead at the first form.
  const steps_ = await performSteps(page, steps, bound.ms, bound.label !== null, agentProcProbe);
  const stepError = steps_.error;
  if (steps_.waitedForHandle) agentWaitConsumed = true;
  if (stepError !== null) {
    return withAgentProc(stuckVerdict(beat, await readObserved(page, beat), stepError), agentProcProbe);
  }

  // A press that saves asynchronously mints its route a moment later, so a beat
  // that ACTED waits for that route before anything below reads where it is.
  //
  // It waits on the URL and NOTHING ELSE. The shipped wait raced this against
  // "a link to the target became visible", and on every beat whose pressed
  // control IS that link — `new-agent`, `new-skill`, `new-hook`, `new-kb`,
  // `create-project-cta` — the link was already visible ON THE PAGE BEING
  // NAVIGATED AWAY FROM. `Promise.any` resolved instantly, `page.url()` still
  // read the SOURCE route because Next commits a client-side navigation after
  // its transition, and the block below clicked the same link a second time
  // into a detaching DOM. Two faces, one cause: a double click that reds
  // `could not click through to "/agents/new" from "/agents/new"` (S5 beat 2),
  // and a false `no real-nav path to "/skills/new" from "/skills/new"` where
  // the destination carries no link to itself (S7 beats 2 and 6). Both name the
  // same route as source and target, which is the tell. Bead `forge-8vfn.2.28`.
  //
  // A WAIT THE STATE IT IS LEAVING CAN SATISFY IS NOT A WAIT — the class M1-G
  // and M1-B closed one layer up, where `data-page-ready` could not tell
  // "not yet" from "already done" either. The URL can: it is the one signal
  // the source page cannot answer for the destination.
  //
  // But a same-route act has no URL to wait on at all, and the shipped code
  // treated that as nothing to wait FOR — the `steps.length > 0` guard above
  // fires only when the pathname already changed. A press that acts on the
  // route it is already standing on (an agent-dispatch button, a save that
  // stays put) still has a consequence: the state this beat asserts. Bead
  // `forge-8vfn.2.25`, measured live on S3 beat 11: pressing "Run onboarding
  // agent" started a real Claude process, and the same-tick read reported
  // `data-onboard-run-status="idle"` with no session id — the product had
  // already answered; the runner had not looked again. A story can spend
  // real money and still report the product never started.
  if (steps.length > 0) {
    const waitedFrom = Date.now();
    if (new URL(page.url()).pathname !== target) {
      await page
        .waitForURL((u) => new URL(u).pathname === target, { timeout: bound.ms })
        .catch(() => {
          /* the press did not navigate here — the nav resolution below reports it honestly */
        });
    }
    // Bead `forge-8vfn.6.11.17`. The consequence wait used to run on the
    // same-route branch ALONE, so a beat whose press NAVIGATES got a wait on
    // the URL and nothing else — and a URL commits in about a second. S4 beat
    // 11 is that shape (`press: open-session` → `/sessions/architect/<id>`):
    // it declared `wait: { for: 'agent', upTo: 600_000 }`, bounded a route
    // change with it, read the session's phase immediately, and the verdict
    // then said `gave up at the agent wait (declared 600000 ms)` — naming a
    // bound that never fired. Declared, surfaced, enforced nowhere, in the very
    // field `6.11.10` added to stop a wrong bound. The route change is now just
    // the first part of the wait; the rest of the bound goes where it was
    // declared to go, on the state the beat is actually waiting for.
    if (new URL(page.url()).pathname === target) {
      const left = bound.ms - (Date.now() - waitedFrom);
      if (left > 0) {
        stalled = await waitForConsequence(page, beat, left, bound.label !== null, agentProcProbe);
        agentWaitConsumed = true;
      }
    }
  }

  // Already there: the operator acted on this page and stayed on it, or the
  // press navigated. There is nothing to navigate TO. Real-nav-only is about
  // reaching a DIFFERENT route; a form-driven flow dwells on one route across
  // several operator actions, and the shipped runner called that unreachable.
  if (new URL(page.url()).pathname !== target) {
    const nav = page.locator(`[data-nav][href="${target}"]`).first();
    const link = page.locator(`a[href="${target}"]`).first();
    const clickable = (await nav.count()) > 0 ? nav : (await link.count()) > 0 ? link : null;

    if (clickable === null) {
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `no real-nav path to "${target}" from "${observed.route}": no [data-nav] pillar and no ` +
          'link points at it. The runner does not fall back to page.goto — an unreachable route ' +
          'must not pass as a beat.',
      );
    }
    // Wait for the NEW route, not merely for "a ready page". The page we
    // clicked FROM is already `data-page-ready="true"`, so waiting on that
    // selector alone returns instantly against the old DOM. Measured on the
    // smoke story's first real run: beat 2 reported route "/" and
    // `data-page: "home"` because the assertion won the race with the
    // navigation — a false RED, and in the mirror case it would be a false
    // GREEN for any beat whose expectations the previous page happens to
    // satisfy.
    // The click itself is guarded. An obscured or non-actionable control (a
    // leftover modal, toast or backdrop from the previous beat) makes
    // playwright throw, and an unguarded throw here propagates past the beat
    // loop and aborts the WHOLE run — dropping every later story's doc and
    // gallery row, with a raw stack trace instead of an attributable verdict.
    // Found by adversarial review, reproduced with a full-viewport overlay
    // over a real [data-nav] link.
    let clickError = null;
    await Promise.all([
      page
        .waitForURL((u) => new URL(u).pathname === target, { timeout: READY_TIMEOUT_MS })
        .catch(() => {
          /* did not navigate — the verdict below reports that honestly */
        }),
      clickable.click().catch((e) => {
        clickError = e?.message ?? String(e);
      }),
    ]);

    if (clickError !== null) {
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `could not click through to "${target}" from "${observed.route}": ${clickError}. ` +
          'The control exists but was not actionable — obscured, disabled or detached.',
      );
    }
  }

  await page
    .waitForSelector('main[data-page][data-page-ready="true"]', { timeout: bound.ms })
    .catch(() => {
      /* not ready — the verdict below reports that honestly rather than throwing */
    });

  let verdict = named(beatVerdict(beat, await readObserved(page, beat)));
  verdict = withAgentProc(verdict, agentProcProbe);
  // Bead `forge-8vfn.6.11.19` (T1 ruling 254) — the class, closed rather than
  // patched a fourth time. Fires WHATEVER the verdict would have been: a beat
  // that passes without its declared wait ever running passed by luck, and a
  // gate that accepts luck is the fail-open shape this campaign keeps paying
  // for. `6.11.17` was exactly that — a ten-minute bound spent on a URL change,
  // and a verdict that then named the bound as though it had fired.
  if (bound.label === null || agentWaitConsumed) return verdict;
  return Object.freeze({
    ...verdict,
    status: 'red',
    failures: Object.freeze([
      ...verdict.failures,
      `this beat declared ${JSON.stringify(rawBeat.wait)} and NO WAITER CONSUMED IT — the ${bound.ms} ms bound ` +
        'bounded nothing on this path. A URL wait and a page-ready wait both take the bound and neither watches ' +
        'an agent, so neither counts. Give the beat a `do` block or expectations a waiter can observe, or drop ' +
        'the declaration: a bound that bounds nothing makes every later verdict about it a lie.',
    ]),
  });
}

/**
 * Perform a beat's `do` steps, in order, on the page as it stands.
 *
 * A step names a `data-field` or `data-action` VALUE — forge-ui's own declared
 * contract, the same vocabulary `expect.data` reads — never a CSS selector: a
 * story that names markup is coupled to markup, which §3.1 avoids on purpose.
 *
 * Returns the failure text, or null. Every playwright throw is caught for the
 * reason the click below is: an unguarded throw aborts the WHOLE run and drops
 * every later story's doc and gallery row.
 *
 * Steps ran back-to-back with no wait between them. A step that navigates —
 * a shelf CTA, a create button, any press — starts a client-side route
 * change, and the very next step resolved its handle against the OLD page,
 * which does not carry it. Bead `forge-8vfn.2.29`, measured on S7's template
 * beat: do = [press new-template, fill template-category, ...] failed with
 * "could not fill [data-field="template-category"]: Timeout 5000ms exceeded"
 * because the press had navigated /library -> /templates/new and the fill
 * ran before the new page mounted. So from the SECOND step on, this waits —
 * bounded, and only after the first step, matching the original zero-wait
 * behaviour for a single-step `do` block exactly — for the arrival page's
 * ready signal, then for the next handle itself, rather than reading
 * whatever the previous step left in the DOM in the same tick. That is what
 * lets a story express "press the create CTA and fill in the form it opens"
 * as ONE beat instead of splitting one operator act across two.
 */
async function performSteps(page, steps, timeoutMs, watchLifecycle = false, probe = null) {
  // Bead `forge-8vfn.6.11.22` (ruling 267). ONE declared bound is ONE spend. The
  // handle wait SWALLOWS its timeout and the act that follows was then handed
  // `timeoutMs` afresh, so a beat whose handle never appears paid the bound
  // twice — measured on S2 run 3, the lane's LAST S2 run: a declared 600 000 ms
  // became a twenty-minute beat, on a session that was never stalled but simply
  // did not publish the handle. A bound is a statement about the BEAT, not about
  // each wait inside it, so every wait below reads what is LEFT of one deadline.
  const deadlineAt = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadlineAt - Date.now());
  // `waitedForHandle` feeds `6.11.19`'s guard: it says whether this block gave
  // the beat's declared bound to a waiter that watches the PAGE for a handle
  // the agent has to produce, rather than to a URL change.
  let waitedForHandle = false;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const fills = Object.hasOwn(step, 'fill');
    const key = fills ? step.fill : step.press;
    const handle = `[data-${fills ? 'field' : 'action'}="${key}"]`;

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
      const stall = await waitForHandleOrStall(page, handle, left(), watchLifecycle, probe);
      waitedForHandle = true;
      if (stall !== null) {
        return {
          waitedForHandle,
          error:
            `the session's own lifecycle read "${LIFECYCLE_STALLED}" ${Math.round(stall.afterMs / 1000)}s into the ` +
            `agent wait, while this step waited for ${handle}. The product had already declared this session hung, ` +
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

    try {
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
        await page.locator(handle).first().click({ timeout: left() });
        continue;
      }
      const refusal = await setControl(page, handle, step.with, left());
      if (refusal !== null) return { waitedForHandle, error: refusal };
    } catch (e) {
      return {
        waitedForHandle,
        error:
          `could not ${fills ? `fill ${handle} with "${step.with}"` : `press ${handle}`}: ` +
          `${e?.message ?? e}. ${await describeControl(page, handle, timeoutMs)}`,
      };
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




