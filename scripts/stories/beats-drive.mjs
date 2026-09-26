/**
 * beats-drive.mjs — the story runner's BROWSER CHOREOGRAPHY.
 *
 * Split out of `beats.mjs` when T1 ruling 438 took that file to 825 lines,
 * over the 800-line cap. The seam is the one the TESTS have used since
 * 2026-09-05: `beats.test.ts` pins the PURE verdict (`beatVerdict`,
 * `resolveBeatRoute`, `stuckVerdict`) against observations handed to it, and
 * `beats-drive.test.ts` pins `driveBeat` against a fake Studio — the press, the
 * fill and the wait that PRODUCE those observations. This file is that second
 * half; not one line of behaviour changed in the move.
 *
 * By concern and not by line count (ruling 150), and NO BASELINE was taken:
 * `beats.mjs` had been sitting at 799 of 800 lines, so the next change to it —
 * any change — was going to pay this bill. Baselining would have moved the
 * cap's own floor and left the file exactly as unmanageable.
 *
 * The dependency runs ONE WAY: this module imports the pure half, and the pure
 * half imports nothing from here. A barrel re-export would have made a cycle,
 * and a cycle in the module that judges every beat is not worth the seven
 * import lines it would have saved.
 */
import { resolveAnchorMs } from './beats-anchor.mjs';
import {
  PLACEHOLDER, answers, resolveExpectations, readObserved, routeMatches, destinationKey,
  waitForConsequence, waitForHandleOrStall,
} from './beats-page.mjs';

// `routeMatches` LIVES in `beats-page.mjs` and is re-exported here (T1 ruling
// 518). It moved because `stopReasonFor` must decide whether a beat is standing
// on the session it is scoped to, and that is the same question — a string
// equality there while every compare here went through the predicate is exactly
// the split 514 existed to close, one function further down. `beats-drive`
// imports `beats-page`, never the reverse, so the leaf holds it and the caller
// re-exports for the modules and tests that already name it here.
export { routeMatches };
import {
  READY_TIMEOUT_MS, beatBound, withAgentProc, withDoorSkipped, beatVerdict, stuckVerdict, resolveBeatRoute, resolveBoundPresses, resolveCycleOf } from './beats.mjs';
// `performSteps` moved to `beats-steps.mjs` at the 800-line cap (ruling 492).
// `driveBeat` calls it and nothing there calls back — that one-way dependency is
// why the split went this way round and not the other.
import { performSteps } from './beats-steps.mjs';
import { readProgress } from './beats-progress.mjs';
import { STALL_CEILING_MS, doorWorthRunning } from './beats-agent-proc.mjs';



/**
 * `page.waitForURL` whose PREDICATE cannot fail silently.
 *
 * T1 ruling 553, bought by 546's own CI red. Both call sites wrote
 * `.waitForURL((u) => routeMatches(u, target), …).catch(() => {})`, and that
 * catch is deliberate: a press that did not navigate must be reported by the
 * nav resolution below, not by an exception. But it also swallowed **the
 * predicate throwing**, which is never a legitimate outcome — and that is
 * exactly what happened when 546 added `url.startsWith('#')` to
 * `routeMatches`:
 *
 *   playwright hands the predicate a URL **OBJECT**, not a string. So
 *   `.startsWith` was not a function, the predicate threw, `waitForURL`
 *   rejected, the catch ate it, NO ARRIVAL WAIT HAPPENED AT ALL, and every
 *   real-nav beat then read its page before the navigation committed. The
 *   symptom was beats off by one — beat 2 reporting `expected
 *   "/projects/gitpulse", got "/projects"` and beat 3 the exact inverse — which
 *   reads like a routing defect and is a TypeError.
 *
 * `new URL(url, base)` had accepted that object happily for as long as this
 * function has existed, because URL's constructor stringifies. The object-vs-
 * string distinction only became visible when a STRING METHOD was applied to
 * the argument. It cost a $0 CI run to find and would have cost a funded one.
 *
 * So the two outcomes are separated here: "the URL never matched" returns null
 * and the caller reports it in the beat's own terms, exactly as before; "the
 * predicate blew up" comes back as an Error and the caller reds LOUDLY, because
 * a runner defect must never be renderable as a fact about the page.
 */
async function waitForRoute(page, target, timeout) {
  let threw = null;
  await page
    .waitForURL(
      (u) => {
        try {
          return routeMatches(u, target);
        } catch (e) {
          threw ??= e;
          return false;
        }
      },
      { timeout },
    )
    .catch(() => {
      /* did not navigate — the caller reports that honestly */
    });
  return threw;
}

/** The verdict a predicate failure earns: named as the runner's own defect. */
function predicateFailure(target, err) {
  return (
    `the route predicate threw while waiting for "${target}": ${err?.message ?? String(err)}. ` +
    'That is a defect in the RUNNER, not a fact about the page — no arrival wait happened, so ' +
    'anything read after this point is the page before the navigation, not after it.'
  );
}

export async function driveBeat(page, rawBeat, index, baseUrl, bindings = {}, timeoutMs = READY_TIMEOUT_MS, agentProcProbe = null, stallDoor = null, pressedAt = new Map(), cycleWatchFor = null, spendGuard = null) {
  // `pressedAt` DEFAULTS BECAUSE MOST CALLERS DRIVE ONE BEAT. The door suite has
  // ~90 single-beat calls for which a fresh map is exactly right. A MULTI-BEAT
  // caller must thread ONE map across the loop, or every beat gets its own and
  // `wait.anchor` can never resolve a press from an earlier beat — which is what
  // `forge-8vfn.27` measured on S10 run 16. The default is a convenience for the
  // single-beat case, never a substitute for the wiring in a run.
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
  // Declared ONCE, read on both consumption paths, so the two cannot disagree
  // about which question this beat asked (7.6.143).
  const declaresTerminal = typeof rawBeat?.wait?.terminal === 'string' && rawBeat.wait.terminal !== '';
  // `cycleOf` takes the same `<name>` bindings the route does. 7.6.147, T1 1164:
  // AN UNBOUND PLACEHOLDER REFUSES HERE, exactly as an unbound ROUTE segment does
  // twenty lines above — and for the same reason, which the first version of this
  // wiring missed.
  //
  // That version resolved an unbound placeholder to `null`, the same value it
  // uses for "this beat declared no cycleOf", so the watch fell back to the
  // born-after-the-anchor form. For a CONTINUED cycle that form finds nothing,
  // and the beat then reded claiming no waiter consumed its bound — true, and
  // not the reason. S10 run 21 paid $4.0917 for the distinction: beat 8 stalled,
  // `stuckVerdict` exported no bindings BY DESIGN, and `<runId>` never resolved.
  //
  // **UNKNOWN never resolves toward proceeding (§15.504).**
  const { value: cycleOfResolved, unbound: cycleOfUnbound } =
    resolveCycleOf(rawBeat?.wait?.cycleOf, bindings);
  if (cycleOfUnbound !== null) {
    return Object.freeze({
      act: rawBeat.act,
      say: rawBeat.say,
      status: 'red',
      failures: Object.freeze([
        `wait.cycleOf "${rawBeat.wait.cycleOf}" needs <${cycleOfUnbound}>, which no earlier beat bound — ` +
          'so this beat cannot say WHICH cycle it is watching. A beat binds a placeholder by expecting ' +
          '`<name>` for a data-* key the product mints, and an earlier beat that reds on a stall exports ' +
          'no bindings on purpose. This is NOT "give the beat a `do` block": the declaration is fine and ' +
          'its subject is missing. Resolving it to "no cycleOf" instead would fall back to watching for a ' +
          'dispatch dir born after the press, which a CONTINUED cycle never mints (S10 run 21).',
      ]),
      bindings: Object.freeze({}),
      data: {},
    });
  }
  const cycleWatch = typeof cycleWatchFor === 'function'
    ? cycleWatchFor(rawBeat?.wait?.terminal ?? null, cycleOfResolved)
    : null;
  // WHO stopped the beat decides the clause. A stop carrying `stoppedBy:
  // 'runner'` is the RUNNER's own finding — 7.6.77's per-transition bound —
  // and appending "the product had already said so about this session" to it
  // would attribute a measurement the product never made, sending a reader to
  // look for a product verdict that does not exist. Every existing stop is
  // unmarked and keeps the wording it has.
  const named = (verdict) => {
    // Bead `forge-8vfn.8.1.4`. A STALLED WAIT MUST NEVER COMPOSE GREEN. Before
    // this, only an ALREADY-red verdict got `stalled`'s reason appended — so a
    // beat whose plain `expect.data` happened to already hold (set by the
    // press, not by the thing being waited FOR) passed through unmarked, the
    // stall silently discarded. `beatVerdict` below is re-derived from a FRESH
    // read and knows nothing about why the wait it is judging ended; forcing
    // red HERE is the one place both facts are in scope at once.
    if (verdict.status !== 'red' && stalled === null) return verdict;
    const because = stalled?.stoppedBy === 'runner'
      ? 'the beat stopped there rather than sitting out its declared bound'
      : 'the product had already said so about this session, so the beat stopped there instead of sitting out ' +
        'its declared bound';
    const why =
      stalled !== null
        ? `${stalled.why} ${Math.round(stalled.afterMs / 1000)}s into the ${bound.label} — ${because}`
        : bound.label === null
          ? null
          : `gave up at the ${bound.label}`;
    if (why === null) return verdict;
    return Object.freeze({ ...verdict, status: 'red', failures: Object.freeze([...verdict.failures, why]) });
  };

  if (index === 0) {
    await page.goto(baseUrl + target, { waitUntil: 'domcontentloaded' });
  }

  // What the operator DOES, on the page they are standing on — the previous
  // beat's page — before this beat's state is judged. All nine operator flows
  // are form-driven, and until this existed the runner could only follow
  // links, so a story stopped dead at the first form.
  // `{ repeat: [...] }`'s stop condition IS the beat's own expectation — the
  // loop invents nothing to reach and nothing to bound itself by (§3.1,
  // rulings 312/317). Built here because this is where `beat` lives; only the
  // repeat branch ever calls it, so a beat without one pays no DOM read.
  // 7.6.77's repeat half. Built HERE for the same reason `matchesData` is: this
  // is where `beat` lives, and `beats-repeat.mjs` must not learn to read a page.
  // `alsoWanted` is the progress key ALONE — `readObserved` collects only what
  // it is asked for, and a key the beat does not itself expect would otherwise
  // be absent on every poll however the page reads (`6.11.45`).
  // 7.6.98 — read from the repeat STEP, falling back to the beat's `wait` for
  // any story still declaring it there (7.6.77's form, still valid). The step
  // form wins when both exist: it is the one whose key `until` guarantees is on
  // the page the loop stands on.
  const repeatWithProgress = (steps ?? []).find(
    (st) => st !== null && typeof st === 'object' && st.perTransition !== undefined,
  ) ?? null;
  const declaredProgress = repeatWithProgress
    ?? (rawBeat.wait?.perTransition !== undefined ? rawBeat.wait : null);
  // Built as `null` when the beat declared no progress bound, rather than as a
  // closure that would throw on `declaredProgress.progressKey`. A closure like
  // that would be caught by the `try` below and returned as "unreadable", so a
  // wiring mistake would arrive disguised as a page that could not be read.
  const readProgressNow = declaredProgress === null ? null : async () => {
    try {
      return readProgress(await readObserved(page, beat, [declaredProgress.progressKey]), declaredProgress.progressKey);
    } catch {
      // A read that could not happen is not a reading of ABSENT: `readObserved`
      // throws when the page navigates under it, which a repeat meets by design
      // between rounds. Reporting that as "the key is gone" would turn a
      // re-render into `progress-key-vanished`. Treated as no new information —
      // the budget keeps running, so a page that never comes back still expires.
      return { value: undefined, source: 'unreadable', carriers: 0 };
    }
  };

  const matchesData = async (spec) => {
    // `readObserved` runs `page.evaluate`, which THROWS when the page navigates
    // under it ("Execution context was destroyed"). A repeat polls this between
    // acts that submit and re-render, so it will meet that race — and an
    // unguarded throw here aborts the WHOLE run and drops every later story's
    // doc and gallery row, which is the same reason the click below is wrapped.
    // A read that could not happen is simply "not satisfied yet": the next poll
    // reads the settled page, and the beat's own bound still governs.
    try {
      // The matcher DECLARES the keys it needs (`6.11.45`). `spec` is the
      // repeat's `until`, whose keys the beat need not mention at all.
      const seen = resolveExpectations(spec, await readObserved(page, beat, Object.keys(spec)));
      return Object.entries(spec).every(
        ([attr, want]) => Object.hasOwn(seen, attr) && answers(seen[attr], want),
      );
    } catch {
      return false;
    }
  };
  // Bead `forge-8vfn.6.11.47` (ruling 366) — WHICH session this beat's waits
  // may be stopped by, and `null` when the beat names none. A beat standing on
  // a project page cannot be ended by a session's terminal phase, however
  // recently it left one: S1 run 10 beat 9 died `0s in` on the demo session
  // beat 8 had just failed, read during the commit window.
  const sessionScope = bound.label !== null && target.startsWith('/sessions/') ? target : null;
  // 718(1): remember WHEN each handle was pressed, so a later beat can anchor
  // its channel search on the press that actually started the work. Recorded
  // BEFORE `performSteps` runs, so the window opens a few ms EARLY rather than
  // late — S10 run 11's cycle dir was born 449 ms before its own beat reported
  // green, and a window that opens late misses exactly that.
  //
  // Last write wins: a handle pressed in several beats (`project-tab-roadmap`)
  // should anchor on its most recent press, not its first.
  const pressStartedMs = Date.now();
  // 7.6.54 (ruling 795): `pressBound` becomes a literal press HERE, where the
  // bindings exist. Downstream — `performSteps`, `beats-repeat`, the anchor map
  // — sees only `press` and is unchanged. An unresolved bind REFUSES rather
  // than pressing a half-built handle, because that reds as "no such control"
  // and reads as a product defect.
  const boundSteps = resolveBoundPresses(steps, bindings);
  if (boundSteps.unbound !== null) {
    return withAgentProc(stuckVerdict(beat, await readObserved(page, beat),
      `pressBound names <${boundSteps.unbound}>, which is not bound at this beat. The handle is built ` +
      'from that binding at run time, so nothing was pressed — this is a story-authoring gap, not a ' +
      'missing control.'), agentProcProbe);
  }
  const runSteps = boundSteps.steps;
  for (const step of runSteps) {
    if (typeof step?.press === 'string') pressedAt.set(step.press, pressStartedMs);
  }
  const steps_ = await performSteps(page, runSteps, bound.ms, sessionScope, agentProcProbe, matchesData, null, target, stallDoor,
    declaredProgress, readProgressNow);
  const stepError = steps_.error;
  // `forge-8vfn.8.1.16` / T1 ruling 1561 — the LAST `pressWithin` TEXT scope
  // this beat resolved, carried onto the beat's own record for `story.json`.
  // The FIRST pick, not the last (D's review): S10 beat 16 presses the SAME
  // scope twice, and both land on the same region, but not always the same
  // WAY. A fallback on press 1 expands ac-1, whose evidence may then name the
  // needle, so press 2 matches it BY TEXT. Recording the last pick would say
  // `by: 'text'` and hide that the story fell back.
  // Carried on a RED verdict too — an earlier press's successful pick must
  // not vanish because a LATER step in the same beat failed for some other
  // reason.
  const withTextAnchor = (v) =>
    steps_.textAnchors.length > 0 ? { ...v, anchor: steps_.textAnchors[0] } : v;
  // 7.6.143 (b2), T1 ruling 1147 — A HANDLE WAIT NEVER CREDITS A `terminal:`
  // DECLARATION. Run 20's beat 10 declared a 30-minute wait on the develop
  // cycle's terminal event, pressed a control, and its handle wait set this one
  // boolean — so the 6.11.19 guard was satisfied by a 231 ms wait for a button
  // while the declared cycle wait watched nothing and the beat reported GREEN.
  // The guard reded beat 11, which declared honestly, and passed beat 10, whose
  // declared wait silently did nothing: its own fail-open shape, one
  // declaration-type along. A declaration is consumed by the waiter it named.
  if (steps_.waitedForHandle && !declaresTerminal) agentWaitConsumed = true;
  if (stepError !== null) {
    const observed = await readObserved(page, beat);
    return withTextAnchor(withAgentProc(stuckVerdict(beat, observed, stepError), agentProcProbe));
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
  // A beat WATCHES as well as acts. `waitForConsequence` used to run only for a
  // beat with a `do` block, so a beat that merely observes an agent it did not
  // start — S1 beat 6, onboarding, which is fire-and-forget and has nothing to
  // press — declared a bound that bounded NOTHING. `6.11.19`'s guard said so in
  // its own words, on the first beat that exercised the case: the guard was
  // right and this wiring was the gap. A declared agent wait is a statement
  // about the BEAT (bead `forge-8vfn.6.11.25`, ruling 285).
  // T1 ruling 438 — A BEAT THAT MINTS A VALUE ALWAYS WAITS.
  //
  // MEASURED, S2 beat 10 in M5: no `do` that navigates and no declared `wait`,
  // so this condition was false and the page was read ONCE. A binding attribute
  // that is always PRESENT reads `""` on that read — before the mint returns —
  // and the beat reds with `got ""`. Bead `forge-8vfn.6.11.5` answered that in
  // the PRODUCT, by making the attribute absent until it has a value: a defect
  // that lives HERE, fixed in `apps/studio`, leaving every future always-present
  // binding attribute to fail the same way.
  //
  // A mint is asynchronous by definition, so a beat that expects one is a beat
  // that is waiting whether or not it declared a bound. The wait terminates:
  // `answers()` already treats `""` as not-yet (`beats-page.mjs:29`), so it ends
  // when the value arrives or at the beat's own bound, with the key named.
  const mints = Object.values(beat.expect.data).some((want) => PLACEHOLDER.test(want));
  if (steps.length > 0 || bound.label !== null || mints) {
    const waitedFrom = Date.now();
    if (steps.length > 0 && !routeMatches(page.url(), target)) {
      const threw = await waitForRoute(page, target, bound.ms);
      if (threw !== null) {
        return withAgentProc(
          stuckVerdict(beat, await readObserved(page, beat), predicateFailure(target, threw)),
          agentProcProbe,
        );
      }
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
    if (routeMatches(page.url(), target)) {
      const left = bound.ms - (Date.now() - waitedFrom);
      if (left > 0) {
        stalled = await waitForConsequence(
          page, beat, left, sessionScope, agentProcProbe,
          beat.wait?.for === 'settle' ? beat.wait : null, stallDoor,
          // T1 1503 (row 98, S10 run 27) — THE DEFAULT ANCHOR IS `pressStartedMs`,
          // NEVER A FRESH `Date.now()` TAKEN HERE. This line runs AFTER
          // `performSteps` has already issued this beat's own act (the click or
          // fill above), and for beat 10's shape — press THEN wait, in the SAME
          // beat, with no `wait.anchor` naming an earlier press — a fresh
          // `Date.now()` is a timestamp taken AFTER the act, exactly the
          // ordering 718(1) already forbids for the NAMED-anchor form. Measured:
          // the develop run's own `cycle.start` landed at 20:44:07.280Z while
          // this expression, unfixed, could read a beat-local "now" no earlier
          // than that — so `cycleStartedSince` never found a start at or after
          // its own anchor, and the wait never ended.
          //
          // `pressStartedMs` (above, captured before `resolveBoundPresses` and
          // `performSteps` ever run) is the one instant on this beat's whole
          // timeline provably AT OR BEFORE any product effect of its own press,
          // which is exactly the "evidence begins here" meaning 718(1) already
          // gives the NAMED form — this is that same meaning applied to the
          // UNNAMED (default) one, additively: `resolveAnchorMs` still returns
          // `pressedAt.get(anchor)` unchanged whenever a beat NAMES an earlier
          // press, and every existing consumer of that path (the stall door
          // included — both read the identical `anchorMs` this call produces)
          // keeps its exact behaviour. Only the fallback used when a beat
          // declares no `anchor` — and the `at > waitStartedMs` refusal bound
          // above it — moves, and only earlier, never later.
          resolveAnchorMs(beat.wait ?? null, pressedAt, pressStartedMs),
          // 7.6.77, narrowed by 7.6.98: ONLY a bound declared on the beat's
          // `wait` reaches the consequence wait. A bound declared on a repeat
          // STEP belongs to that loop and to the page it stands on — handing it
          // here is what made S1 beat 11 report `no-progress-key (consequence)`
          // against `/artifact`, which renders the key zero times.
          beat.wait?.perTransition !== undefined ? beat.wait : null,
          // 7.6.118 / T1 1089(c). Built PER BEAT because the watch is stateful
          // — it remembers when the cycle terminated so the page's grace runs
          // from that sighting — and null for every beat that declared no
          // `terminal`, which is all of them but S10's beat 8.
          cycleWatch,
          // T1 1471 — the run's own $ ceiling, checked on EVERY poll of this
          // wait, not only at the beat boundary either side of it: a wait long
          // enough to matter is long enough to cross a ceiling mid-flight.
          spendGuard,
        );
        // 7.6.143 (b2). A `terminal:` declaration counts as consumed only when
        // the watch actually RESOLVED a cycle — not merely when it was called.
        // Run 20's watch was called on every poll of a four-minute window and
        // resolved nothing, because the develop station continues the cycle the
        // architect minted and `newestChannelSince` skips anything born before
        // the anchor.
        agentWaitConsumed = declaresTerminal ? cycleWatch?.sawCycle === true : true;
      }
    }
  }

  // Already there: the operator acted on this page and stayed on it, or the
  // press navigated. There is nothing to navigate TO. Real-nav-only is about
  // reaching a DIFFERENT route; a form-driven flow dwells on one route across
  // several operator actions, and the shipped runner called that unreachable.
  if (!routeMatches(page.url(), target)) {
    // QUERY-BLIND BY PATHNAME (bead `forge-8vfn.7.5.3`, T1 ruling 451).
    //
    // The runner READ a URL query-blind — `readObserved` compares
    // `new URL(page.url()).pathname` — and SELECTED a link query-strict, with an
    // exact `[href="<route>"]`. So it accepted arriving at a URL it refused to
    // find the link to, and the failure read "no link points at it" while the
    // anchor was on the page. Three LIVE product sites mount `SessionMinted`
    // with a `project`, so their hrefs carry `?project=…`:
    // `DemoStageHandoff.tsx:60`, `DemoTimeline.tsx:215`,
    // `ContractResolutionPanel.tsx:295` — the whole demo path.
    //
    // Site-by-site query dropping was REFUSED: a link that legitimately needs a
    // parameter must stay reachable, and a story declares the route an operator
    // would say out loud, not the product's parameter plumbing.
    //
    // The href is resolved against a base so a relative one normalises the same
    // way the browser resolves it; an href that will not parse is skipped rather
    // than guessed at.
    //
    // THE FILTER RUNS HERE, NOT IN THE PAGE — T1 ruling 527. It used to be a
    // hand-inlined copy of `routeMatches` inside the `evaluateAll` callback,
    // because that callback is serialised and executed IN THE BROWSER and
    // cannot close over a Node-side function. Two copies of a predicate whose
    // whole purpose is that there is only one of it: the browser callback now
    // just READS the hrefs, and the one predicate judges them on this side. An
    // href that will not parse is skipped by `routeMatches` itself rather than
    // guessed at.
    const all = await page
      .locator('[data-nav][href], a[href]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')).filter((h) => h !== null && h !== ''));
    // Collapse by DESTINATION, not by string. `routeMatches` chose these and is
    // fragment-blind (546); deduping on the raw href is blind to nothing, so the
    // two steps disagreed and the disagreement surfaced as a refusal — S10 run
    // 5's beat 6, where `/projects/gitpulse` and `/projects/gitpulse#roadmap`
    // were reported as two destinations "differing only in their query".
    // A fragment-free href is preferred within a group so the captured frame
    // shows the plain route; either member lands on the same page.
    const byDestination = new Map();
    for (const h of all.filter((h) => routeMatches(h, target))) {
      const key = destinationKey(h);
      if (key === null) continue;
      const held = byDestination.get(key);
      if (held === undefined || (held.includes('#') && !h.includes('#'))) byDestination.set(key, h);
    }
    const distinct = [...byDestination.values()];

    if (distinct.length > 1) {
      // NAMED, never picked. Two links whose pathnames match and whose queries
      // differ are two different destinations, and choosing one by DOM order is
      // how a beat silently starts asserting the wrong page (the same shape as
      // `resolveExpectations`' best-match tie-break).
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `ambiguous real-nav path to "${target}" from "${observed.route}": ${distinct.length} links share ` +
          `that pathname and differ in their QUERY, which makes them different destinations — ` +
          `${distinct.join(' , ')}. The runner will not pick ` +
          'one; name the destination the beat means, or give the page one link for it.',
      );
    }

    const href = distinct[0] ?? null;
    const nav = href === null ? null : page.locator(`[data-nav][href="${href}"]`).first();
    const link = href === null ? null : page.locator(`a[href="${href}"]`).first();
    const clickable =
      nav !== null && (await nav.count()) > 0 ? nav : link !== null && (await link.count()) > 0 ? link : null;

    if (clickable === null) {
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `no real-nav path to "${target}" from "${observed.route}": no [data-nav] pillar and no ` +
          'link whose PATHNAME is that route (a query string does not disqualify one). The runner ' +
          'does not fall back to page.goto — an unreachable route must not pass as a beat.',
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
    let navThrew = null;
    await Promise.all([
      waitForRoute(page, target, READY_TIMEOUT_MS).then((e) => { navThrew = e; }),
      clickable.click().catch((e) => {
        clickError = e?.message ?? String(e);
      }),
    ]);
    if (navThrew !== null) {
      return stuckVerdict(beat, await readObserved(page, beat), predicateFailure(target, navThrew));
    }

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

  let verdict = named(beatVerdict(beat, await readObserved(page, beat), { boundMs: bound.ms, bound: bindings }));
  verdict = withAgentProc(verdict, agentProcProbe);
  verdict = withTextAnchor(verdict);
  // 664(i): a door that did not run says so, rather than leaving the reader to
  // wonder whether it passed or was skipped.
  verdict = withDoorSkipped(
    verdict,
    stallDoor !== null && sessionScope === null && !doorWorthRunning(bound.ms, STALL_CEILING_MS),
    bound.ms,
    STALL_CEILING_MS,
  );
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
/**
 * Test seam for `{ repeat: [...] }` (§3.1). `performSteps` is the whole
 * behaviour under test and driving it through a real browser would test
 * playwright, not the loop — so the loop is exercised against a fake page that
 * models the ONE thing that matters: the product decides when to stop.
 */
