/**
 * beats-page.mjs — what the page SAYS, and how long the runner waits for it to
 * say it.
 *
 * Split out of `beats.mjs` when that file reached 802 lines against the
 * 800-line cap (`scripts/check-file-size.mjs`, a shrink-only ratchet — a
 * baseline entry would raise the debt ceiling, not honour it). The gate names
 * the remedy itself: "Split it."
 *
 * The seam is one that was already there, not one invented to fit a number.
 * Everything here answers *what is on the page*: reading its `data-*`, deciding
 * which observed record an expectation is judged against, and waiting for the
 * page to change. Every one of them fails the same way — a DOM-contract
 * problem, a selector that no longer matches, a wait whose bound is wrong for
 * what it waits on. What stayed in `beats.mjs` answers *what the beat MEANS*:
 * the verdict, the route resolution, and the operator acts a `do` block
 * performs. A judgement bug and a reading bug are found and fixed in different
 * places, so they live in different places.
 *
 * Nothing here judges. `readObserved` is deliberately VALUE-BLIND: it collects
 * by key and never sees what the beat expects, because a reader that knew the
 * answer is how a gate starts agreeing with itself.
 */

// The product's stall ceiling, single-sourced from the module that owns the
// runner's other agent-evidence reads and bound to the TypeScript constant by
// `beats-offsession-stall.test.ts` (T1 ruling 580).
import { STALL_CEILING_MS, doorWorthRunning, CYCLE_WAIT_WALL_CEILING_MS } from './beats-agent-proc.mjs';
// Row 179b (T1 1973ei) — the ONE inactivity window both liveness-governed
// branches below fold their readings into (`beats-agent-liveness.mjs`), which
// wraps the same pure `cycleWaitDeadline` the `cycleOf` branch used inline.
import { makeLivenessWindow } from './beats-agent-liveness.mjs';
import { readProgress, progressTracker } from './beats-progress.mjs';
// Bead `forge-8vfn.8.1.34` / ruling 1736 — the SAME "first poll + on change"
// reporter `performSteps` already wraps around the ACT (bead `6.11.30`), now
// also wrapped around the PRE-act wait below. S10 proof run 36's beat 21
// spent its whole 504 s bound in `waitOffSession` with the control absent the
// entire time, and printed NOTHING — the runner reached `describeControl`
// only at failure, once, in the final verdict text. Reusing `watchControlState`
// closes the SAME timing gap `6.11.30` closed for the click phase, never a
// second reporter with its own cadence or wording.
import { watchControlState } from './beats-control-state.mjs';

/** A `<name>` expectation: bind whatever the page rendered, for a later beat's route. */
// ── THE READ HALF LIVES IN `beats-page-read.mjs` (forge-8vfn.7.6.121) ────────
//
// Imported for this file's own use AND re-exported, so every existing importer
// and every door keeps its `from './beats-page.mjs'` unchanged — the split is a
// pure move, and a door that had to be edited to accommodate it would no longer
// be the door that was passing before.
import {
  PLACEHOLDER,
  answers,
  ERROR_SENTINELS,
  LIFECYCLE_STALLED,
  LIFECYCLE_CRASHED,
  TERMINAL_STOPPED_PHASES,
  routeMatches,
  destinationKey,
  CONSEQUENCE_POLL_MS,
  resolveExpectations,
  SAFE_KEY,
  restrictNested,
  readObserved,
} from './beats-page-read.mjs';

// CONSEQUENCE_POLL_MS is deliberately ABSENT from this list: it was private
// before the split and stays private to the pair. Re-exporting it here would
// widen the public surface as a side effect of a pure move.
export {
  PLACEHOLDER,
  answers,
  ERROR_SENTINELS,
  LIFECYCLE_STALLED,
  LIFECYCLE_CRASHED,
  TERMINAL_STOPPED_PHASES,
  routeMatches,
  destinationKey,
  resolveExpectations,
  SAFE_KEY,
  restrictNested,
  readObserved,
} from './beats-page-read.mjs';

/**
 * Is the product itself saying to stop — that the session CRASHED, that it
 * reached a terminal phase which is not a success, or that it is hung? Returns
 * the REASON, or `null` to keep waiting.
 *
 * ONE predicate for all three so they can never drift apart, and so a caller
 * cannot check one and forget the others — which is exactly how `6.11.39`
 * survived alongside the stall check it sat beside, and then how the crash door
 * (ruling 518) survived alongside both of them. Each door was added after a
 * measured run spent its whole declared bound on a session the product had
 * already given up on.
 */
export function stopReasonFor(observed, sessionScope = null) {
  // Bead `forge-8vfn.6.11.47` (T1 ruling 366). A STOP REASON BELONGS TO A
  // SESSION, and may only end a beat that is ABOUT that session.
  //
  // S1 run 10 beat 9 stands on the project page and died `0s into the agent
  // wait` on a `failed` that belonged to the DEMO session beat 8 had just left
  // behind — read during the commit window a client-side navigation leaves
  // open, when `page.url()` and the DOM still answer for the page being left
  // (§2.28's class). The captured DOM for that beat is `data-page="projects"`
  // with no `data-session-phase` at all. Beat 9 was green one run earlier;
  // nothing about it changed, a NEIGHBOUR's session failing ended it.
  //
  // `sessionScope` is the beat's own resolved route when that route IS a
  // session page, and `null` otherwise — so a beat that names no session
  // cannot be stopped by any session's phase, and a beat that names one is
  // stopped only while standing on it.
  //
  // T1 ruling 514 made `observed.route` carry the QUERY, and this compare was a
  // string equality against the beat's DECLARED route — so the moment the
  // product mounted the session page with its own `?project=` parameter (three
  // live sites do), a beat that named no query stopped being "about" the
  // session it was standing on and all three doors below silently closed. The
  // beat's route is a declaration and `routeMatches` is what reads it: pathname
  // always, query only when the beat asked for one.
  if (sessionScope === null || !routeMatches(observed.route, sessionScope)) return null;
  // Ruling 518 — the crash door FIRST, because it is the only one of the three
  // that carries the product's own message, and a stop that can say what the
  // page said should say it.
  if (observed.lifecycle === LIFECYCLE_CRASHED) {
    const said = observed.lifecycleError ?? null;
    return `the session's own lifecycle read "${LIFECYCLE_CRASHED}"` + (said === null || said === '' ? '' : ` — ${said}`);
  }
  if (observed.sessionPhase !== null && TERMINAL_STOPPED_PHASES.has(observed.sessionPhase)) {
    return `the session's own phase reached the terminal "${observed.sessionPhase}"`;
  }
  if (observed.lifecycle === LIFECYCLE_STALLED) {
    return `the session's own lifecycle read "${LIFECYCLE_STALLED}"`;
  }
  return null;
}

/**
 * The same question, against a live read.
 *
 * Exported (row 184, forge-8vfn.8.5.20) so `runRepeatStep`
 * (`beats-repeat.mjs`) can ask it too: that loop's own governing bound can be
 * EXTENDED by the session's liveness (its `.heartbeat`/`events.jsonl`, T1
 * 1973bq), and liveness must never be read as a reason to sit past a stop the
 * product has already published. This is the SAME reader `waitForHandleOrStall`
 * and `waitForConsequence` already trust for that question — never a second one.
 */
export async function stopNow(page, sessionScope) {
  // Reuses `readObserved` rather than minting a second notion of "the page's
  // state" — an empty `expect.data` collects only the error sentinels, and the
  // bar and the phase ride along beside them. §15.161's rule, one layer down.
  return stopReasonFor(await readObserved(page, { expect: { data: {} } }), sessionScope);
}

/**
 * Wait for a `do` step's handle, or stop as soon as the product says the
 * session is hung — the SECOND place an agent-scale bound is spent, and the one
 * S2 beat 12 and S1 beat 6 actually spend it in. Their field
 * (`[data-field="session-answer"]`) exists only inside a `question-form`
 * affordance, i.e. only once the architect has ASKED, so the bound goes here
 * and never reaches `waitForConsequence`.
 *
 * The shipped wait was a single `locator.waitFor({ timeout })`, which cannot
 * consult anything mid-wait — and it SWALLOWS its timeout, after which
 * `setControl` re-waits on the same handle under the SAME bound. Measured by
 * `AT-6.11.17-8` before this existed: a declared 30 000 ms bound took
 * **60 006 ms**. A ten-minute bound on a field that never appears is a
 * twenty-minute beat.
 *
 * Returns a stall record, or null (found, or the bound expired — the act below
 * then throws its own honest failure, exactly as before).
 */
export async function waitForHandleOrStall(page, handle, timeoutMs, sessionScope, probe = null, stallDoor = null) {
  // `sessionScope` replaces the old `watchLifecycle` boolean rather than
  // joining it (`6.11.47`): the flag always stood for "this beat waits on a
  // session", and saying WHICH session is the whole fix. One value, and the
  // predicate cannot be armed without naming what it is armed about.
  if (sessionScope === null) return waitOffSession(page, handle, timeoutMs, stallDoor);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // `forge-8vfn.8.1.34` — see the import comment: reports the control's own
  // state at the first poll and on every change, for exactly as long as this
  // wait runs, whatever ends it.
  const stopWatch = watchControlState(page, handle, (line) => console.log(line));
  try {
    for (;;) {
      if ((await page.locator(handle).count()) > 0) return null;
      // Bead `forge-8vfn.6.11.22`: sample the agent's own process WHILE waiting.
      // Diagnosis must never fail a beat that would otherwise pass, so it throws
      // nothing and the beat's outcome does not depend on it.
      if (probe !== null) { try { probe(); } catch { /* a probe is never load-bearing */ } }
      const why = await stopNow(page, sessionScope);
      if (why !== null) return Object.freeze({ afterMs: Date.now() - startedAt, why });
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
    }
  } finally {
    stopWatch();
  }
}

/**
 * The wait for a beat that is NOT on a session page — T1 ruling 580.
 *
 * This used to be a bare `locator.waitFor`: no poll, no observation, no door.
 * Every protection built this milestone was therefore inert for exactly the
 * beats carrying the biggest bounds — 518's doors and the process probe both
 * need a `/sessions/<kind>/<id>` route, and 531(3) cannot fire on a beat that is
 * standing ON its declared route. G1/S10 run 5's beat 16 sat 14 m 13 s of its
 * fifteen minutes on a page whose run had stopped writing before the beat began.
 *
 * The signal is the RUN'S OWN LOG, not the page. `readObserved` collects only
 * the keys the beat declared, so during a wait it changes exactly once — at
 * success — and a door on it would red every off-session beat at the ceiling
 * whether or not the agent was working. Run 5 measured the two apart: the
 * runner's log sat silent 2 m 31 s while the architect's `events.jsonl` grew
 * 33 822 → 48 409 bytes.
 *
 * THE DECLARED BOUND STAYS A HARD MAXIMUM. Nothing runs longer than `timeoutMs`;
 * the only new exit is earlier. A page that names no run, or a run with no
 * channel, keeps exactly today's behaviour — no channel is "nothing to judge",
 * never "it has been quiet".
 */
async function waitOffSession(page, handle, timeoutMs, stallDoor) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // 664(i), same rule as the consequence wait: a bound within twice the ceiling
  // would be consumed rather than cut short, so the door does not run at all.
  const doored = stallDoor !== null && doorWorthRunning(timeoutMs, STALL_CEILING_MS);
  const runId = doored ? await readRunId(page) : null;
  // `forge-8vfn.8.1.34` — see the import comment. This is the wait S10 proof run
  // 36's beat 21 spent its whole 504 s bound inside, silently: the
  // control was absent throughout and nothing said so until the final verdict.
  const stopWatch = watchControlState(page, handle, (line) => console.log(line));
  try {
    for (;;) {
      if ((await page.locator(handle).count()) > 0) return null;
      if (doored) {
        // Bead `forge-8vfn.7.5.8`. 580 read only the run the PAGE names; run 7's
        // beat 7 pressed Plan from a page that names none, so nothing observed it
        // and it sat all twenty minutes. The door now falls back to the newest
        // dispatch created since this wait began, and reports WHICH of the two
        // findings it is.
        const stop = stallDoor(runId, startedAt);
        if (stop !== null) {
          return Object.freeze({
            afterMs: Date.now() - startedAt,
            why: `${stop.reason}: ${stop.detail} ${handle} never appeared.`,
          });
        }
      }
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
    }
  } finally {
    stopWatch();
  }
}

/**
 * The run a page says it is showing, from the `data-run` its own contract
 * publishes (`apps/studio/app/artifact/page.tsx:926`). Read through `evaluate`,
 * which every page and every fake already models, and null on anything at all —
 * a page that names no run is answered by the bound alone, exactly as before.
 */
async function readRunId(page) {
  try {
    const got = await page.locator('main[data-page]').first().evaluate((n) => n.getAttribute('data-run'));
    return typeof got === 'string' && got !== '' ? got : null;
  } catch {
    return null;
  }
}

/**
 * Wait for a same-route act's CONSEQUENCE — EVERY data-* state this beat
 * declared — to settle before the beat is judged. `driveBeat`'s other waits
 * are all keyed to a URL change, so a `do` block that acts on the route it
 * already stands on gets none of them; a press there can still start real
 * work (an agent dispatch, a save) whose answer arrives a moment later, and
 * reading immediately reports on work that is provably still in flight. Bead
 * `forge-8vfn.2.25`.
 *
 * It waits for ALL of them. Waiting on the FIRST declared key alone made the
 * ORDER of keys in an `expect.data` object silently decide what the runner
 * waited for — a rule no story author could learn from §3.1, only by reading
 * this function. Measured on S1 beat 7 (H6 sitting, 2026-09-05): the beat
 * declares `stage-detail-stage` first, the press before it satisfies that key
 * instantly, and the page was read while `launch-demo-builder`'s POST was
 * still in flight — `data-action: expected "view-demo-session", got
 * "back-to-project"` on a handoff that run 1 had proved works. Swapping the
 * beat's keys would have turned it green and pinned the trap into a gate;
 * bead `forge-8vfn.6.11.7`, ruling 196. §3.1 states the semantics now.
 *
 * Asks the question `beatVerdict` asks, through `resolveExpectations` — the
 * SAME reader (`readObserved`) AND the same resolution — so what satisfies
 * this wait and what the verdict judges can never disagree. A per-key search
 * of `[data, ...nested]` was a second notion of "the page's data": it could
 * be satisfied by a record the verdict would never pick (§15.161).
 *
 * Bounded and never throws: on timeout it simply returns, and `beatVerdict`
 * below reports the honest mismatch (which attribute, expected vs. got) on
 * its own terms — the same catch-and-let-the-verdict-explain shape every
 * other wait in this function already uses.
 */
export async function waitForConsequence(
  page,
  beat,
  timeoutMs,
  sessionScope,
  probe = null,
  settle = null,
  stallDoor = null,
  anchorMs = null,
  progress = null,
  cycleWatch = null,
  spendGuard = null,
  boundRunId = null,
  pressMs = null,
  readLivenessNow = null,
) {
  const wanted = Object.entries(beat.expect.data);
  if (wanted.length === 0) return null;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // T1 ruling 1471 (S10 run 26) — state for the INACTIVITY window a `cycleOf`
  // wait now gets (below, beside the deadline check). `lastActivityAt` is the
  // newest cycle write this wait has SEEN, never invented: an absent reading
  // must fail CLOSED to the plain deadline above, not be read as fresh
  // progress. `progressExtensions` is reported in the red, in the spirit of
  // `wait-bound.mjs`'s "THE CLAMP IS NEVER HIDDEN" — nothing about why a wait
  // outlived its declared `upTo` is left for a reader to reconstruct.
  //
  // Row 179b (T1 1973ei) — that state now lives in ONE `makeLivenessWindow`,
  // shared with the agent-liveness branch below, so the reset the mutation
  // pass already proved deletable is written once, not twice.
  const liveWindow = makeLivenessWindow({ startedAt, timeoutMs, wallCeilingMs: CYCLE_WAIT_WALL_CEILING_MS });
  // Row 179b — what the agent-liveness read said when it could not be read,
  // carried for the log line alone (§664(ii)), exactly as 179's repeat does.
  let unreadableDetail = null;
  // THE KEYS THIS WAIT NEEDS COLLECTED, DECLARED — bead `forge-8vfn.6.11.45`'s
  // rule, applied to the two waits that read a key the BEAT need not mention.
  //
  // `readObserved` collects `expect.data`'s keys and nothing else, so a key
  // only this function cares about is never read at all and every check of it
  // answers the same way HOWEVER THE PAGE READ. 6.11.45 measured that on a
  // repeat's `until` — S1 run 9 spent 2 m 24 s waiting for a condition the page
  // had already satisfied — and `settle.key` has carried the identical hole
  // since 621(ii): no shipped story declares a settle wait yet, so it has never
  // fired, which is the only reason it has not cost a run. `progressKey` would
  // arrive with the same hole and a worse failure: an uncollected progress key
  // reads as ABSENT forever, so the per-transition bound below would report
  // "the key never appeared" on a perfectly healthy run.
  const alsoWanted = [settle?.key, progress?.progressKey].filter((k) => typeof k === 'string' && k !== '');
  // 7.6.77's state, now the SHARED tracker: the repeat wait needs the identical
  // rule, and two copies of a budget-reset are two places for the reset to be
  // deleted — which the mutation pass has already shown leaves every door green.
  const tracker = progress === null ? null : progressTracker(progress, 'consequence', startedAt);
  // T1 ruling 640. THE DOOR WAS ON THE WRONG WAIT. `forge-8vfn.7.5.8` put the
  // channel door in `waitForHandleOrStall` — the PRE-act wait, which returns
  // the moment the control appears — and an off-session beat spends its bound
  // HERE, after the act. Run 7's beat 7 and run 8's beat 8 each sat their full
  // twenty minutes in this loop with the door a few lines away and never
  // consulted; run 8's `_logs/` held one dispatch for the beat's whole life,
  // born NINE MINUTES BEFORE its press, so `no-channel` would have ended it at
  // 180 s. Seventeen minutes, twice.
  //
  // The verdict said so in its own words both times — "gave up at the agent
  // wait (declared 1200000 ms)" is `beatBound`'s label, produced on THIS path
  // — and I changed the wait I had been reading instead of the wait the
  // measurement named (§15.356).
  const runId = stallDoor === null ? null : await readRunId(page);
  // ROW 162 (S10 run 42) — `boundRunId` is the caller's OWN fallback identity,
  // resolved off the story's bindings rather than the DOM (`resolveBoundRunId`,
  // `beats.mjs`): the flow monitor never publishes `data-run` on `readRunId`'s
  // own element, so `runId` above is null for exactly the beat this exists for.
  // Handed to `stallDoor` unconditionally; `makeAgentChannelDoor` only consults
  // it once the DOM-named form has nothing.
  for (;;) {
    // T1 ruling 1471 — THE RUN'S OWN $ CEILING BOUNDS THE WHOLE WAIT, checked
    // FIRST and ahead of the DOM read: a run's own funding is a harder fact
    // than anything this beat expects, and S10 run 26's incident is precisely
    // that a beat kept sitting a healthy-looking wait past the point the run
    // could still afford it. `spendGuard` is `null` for a costless story or a
    // run with no usable ceiling — see `makeWaitSpendGuard` (`run-observe.mjs`)
    // — never invented here.
    if (spendGuard !== null) {
      const guard = spendGuard();
      if (guard.breached) {
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why: `the run's own $ ceiling ended this wait: ${guard.reason}`,
          stoppedBy: 'runner',
        });
      }
    }
    const observed = await readObserved(page, beat, alsoWanted);
    const seen = resolveExpectations(beat.expect.data, observed);
    // T1 1231 — a declared terminal is a CONDITION: the watch is read BEFORE
    // completion, and a beat that declares one is not done until it is reached
    // (S10 run 22 went green on its expectation 0.5 s before its cycle ran).
    const watching = cycleWatch !== null && sessionScope === null;
    const stop = watching ? cycleWatch(runId, anchorMs ?? startedAt) : null;
    const terminalHeld = !watching || cycleWatch.reached !== false;
    if (terminalHeld && wanted.every(([attr, want]) => Object.hasOwn(seen, attr) && answers(seen[attr], want))) return null;
    // `wait: { for: 'settle', key, while }` — T1 ruling 621(ii), bought by A's
    // S1 beat 3.
    //
    // THE WAITING HALF ALREADY EXISTED, and measuring that is what shaped this:
    // a plain `for: 'agent'` wait already carries A's beat past its transient
    // (green in 1208 ms on the fixture). What it does NOT do is stop — a wrong
    // value is waited out exactly as patiently as a transient one, to the full
    // declared bound, and the verdict then reports a timeout where it could
    // have reported the mismatch.
    //
    // So `settle` adds SHARPNESS, not patience. The story names the one value
    // it is willing to sit through; the moment the key holds anything else,
    // this stops and lets the verdict say what it actually saw. A beat can
    // never silently wait out a value it should have failed on.
    if (terminalHeld && settle !== null) {
      const got = seen[settle.key] ?? observed.data?.[settle.key];
      if (got !== undefined && got !== settle.while) return null;
    }
    // ROW 184 (forge-8vfn.8.5.20) — ZOMBIE EXTENDS. THE SESSION'S OWN PUBLISHED
    // STATE IS THE AUTHORITY, and a published OPERATOR GATE ends a wait on sight.
    //
    // This wait runs AFTER the beat's `do` block has already finished — there is
    // no step left here that could answer a question — so a session that has
    // settled at the operator gate `awaiting-answers` is a dead end for THIS
    // wait specifically: the architect has turned its turn over, and nothing
    // below will take it. Measured: a beat waiting for `awaiting-verdict` sat
    // out its WHOLE declared bound (~13 minutes) with the architect's own
    // `/proc` trend showing continuous work the entire time — `parent state=S`,
    // `SDK child utime 45→238` — right up until the process was reaped. The
    // trend was real; it was also the wrong question. The RIGHT one is what
    // `status.json` already says, and it said `awaiting-answers` 39 s in.
    //
    // Pid/heartbeat liveness (the probe above, a channel's own idle time) may
    // only EXTEND a wait while the product has published nothing conclusive
    // yet; it must never be read as a reason to keep sitting past a gate that
    // already has. This check runs UNCONDITIONALLY — not gated on `probe` or
    // on any liveness reading — because the gate itself, not a liveness
    // reading, is what proves there is nothing left to wait for.
    //
    // SCOPED TO EXACTLY THIS ONE PHASE. Not `TERMINAL_STOPPED_PHASES`' failure
    // set, which already ends this same wait via `stopReasonFor` below. And
    // never a DONE phase (`committed`/`applying`/`complete`/…), which a beat
    // may legitimately be waiting to ARRIVE at — ending early on one of those
    // would invent a failure out of a success, the exact mistake
    // `TERMINAL_STOPPED_PHASES`'s own header already refuses to make. If the
    // wanted expectation IS `awaiting-answers`, the green check above already
    // returned before this line is ever reached.
    if (observed.sessionPhase === 'awaiting-answers') {
      return Object.freeze({
        afterMs: Date.now() - startedAt,
        why:
          'the session\'s own phase reached the operator gate "awaiting-answers" — the product has turned its ' +
          'turn over, and this wait\'s `do` block has already finished, so nothing here will answer it. The ' +
          'rest of the declared bound would be spent watching a turn only a separate, later beat can take.',
        stoppedBy: 'runner',
      });
    }
    // Ruling 241 step 2. Only for a beat that DECLARED an agent wait: those are
    // the beats that stand on a session, and scoping it there means no other
    // beat gains a new way to fail. The product is believed rather than
    // second-guessed — `stalled` is server-derived, and re-deriving it here
    // from phases or timestamps is the mistake the bar's own header forbids.
    // OFF-SESSION ONLY, and 640 shipped without this gate. A SESSION beat's
    // dispatch dir was born when the SESSION started — long before this beat's
    // wait began — so `newestChannelSince(logs, startedAt)` finds nothing and
    // reports `no-channel` about an agent that is working. Lane A measured it
    // on S1 run 5: beats 6 and 9 killed at 180 s of a 420 s bound while the
    // beat's OWN probe printed `SDK child utime 18 → 371`. Four minutes of
    // unspent bound discarded on a healthy run, in two different sessions.
    //
    // A session beat is already doored, three lines below and better:
    // `stopReasonFor` is the PRODUCT's own crashed/stalled/terminal verdict for
    // the session in scope. The channel door exists for the beats that have no
    // session to ask about, and it belongs only to them.
    // 664(i): THE DOOR MUST NEVER BE THE BOUND. It fires at a fixed 180 s
    // whatever the beat declared, so on a short bound it is not an early exit —
    // it is the verdict. Lane A's S1 beat 9 declared 200 s and the door fired at
    // 180 s, leaving the beat twenty seconds of its own patience; run 9's
    // seventeen minutes came from a 20-minute bound, where 180 s is a small
    // fraction rather than 90% of it.
    //
    // A beat that asked for 200 s has SAID it expects to wait that long. So the
    // door is skipped entirely when the declared bound is within twice the
    // ceiling, and the verdict says so rather than staying silent about a check
    // that did not run. One ceiling, no scaling.
    // 7.6.118 / T1 1089(c) — THE PRODUCT'S OWN TERMINAL VERDICT, ASKED FIRST.
    // Above the stall door for the reason this file already gives about
    // `stopReasonFor`: a verdict the product PUBLISHED outranks a silence we
    // measured. The stall door cannot answer this one at all — it asks only
    // after STALL_CEILING_MS of quiet, and run 17's cycle wrote continuously
    // until the moment it finished, so a door that waits for silence can never
    // see a cycle that finishes while still talking.
    //
    // Unbounded by `doorWorthRunning`: that gate exists because the stall door
    // fires at a fixed 180 s and would BE the verdict on a short bound. This
    // one carries no fixed interval — it reads what is on disk — so it is never
    // the bound, only an earlier exit.
    if (watching) {
      if (stop !== null) {
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why: `${stop.reason}: ${stop.detail} The beat's expectations never held.`,
          stoppedBy: 'runner',
        });
      }
    }
    // Bead `forge-8vfn.8.1.4`. NOT CONSULTED WHILE A CYCLEWATCH IS WATCHING.
    // This door's own channel search (`makeAgentChannelDoor`, born-after-the-
    // anchor or the page's named run) knows nothing of `cycleOf` — the develop
    // station CONTINUES the architect's cycle dir, born BEFORE the press this
    // wait anchors on, so the search finds nothing and the door reports
    // `no-channel` about a cycle that is genuinely open and streaming events.
    // That false finding then travelled as far as `beatVerdict` at the beat's
    // fresh re-read, which knows nothing of WHY the wait ended and answered
    // green because the beat's plain `expect.data` had held since the press.
    //
    // `cycleWatch` is the RIGHT door for a beat that named one: it resolves the
    // SAME identity (`cycleDirForInitiative`, above) this door cannot, and it
    // already ends the wait — a poll up, `watching` — the instant the product
    // publishes a terminal that is not the one wanted. A cycle that never
    // starts at all is not silently believed either: `terminalHeld` stays
    // false forever, so the deadline branch below still reds it, at the
    // beat's own declared bound rather than this door's fixed ceiling. Reusing
    // `cycleDirForInitiative` a SECOND time here, inside this door, would be a
    // second resolver for one question; not consulting this door at all keeps
    // there being exactly one.
    // ROW 184 (forge-8vfn.8.5.20) — EARLY DEATH gets exactly one grace poll,
    // never zero and never the whole bound. UNGATED by `doorWorthRunning`,
    // unlike the idle-ceiling door right below: that one fires at a fixed
    // 180 s and would BE the verdict on a short bound (664(i)'s own reasoning,
    // two comments up), while this one costs at most ONE extra
    // `CONSEQUENCE_POLL_MS` — never enough to need the same guard. A one-shot
    // dispatch can be reaped in under a second, long before `idle >
    // STALL_CEILING_MS` would even let the door below look, and "process
    // death never ends a wait on its own" means giving the page's NEXT poll a
    // chance to show what the dispatch already wrote before trusting a
    // verdict about it.
    //
    // SCOPED TO A DECLARED AGENT-SCALE WAIT (follow-up to row 184, PR #1058's
    // own CI red). `doorWorthRunning`'s size gate above happens to protect
    // the idle-ceiling door from ever running on a plain, undeclared-wait
    // beat (that beat's bound is the small DOM default, nowhere near
    // `2 * STALL_CEILING_MS`) — but this door has no size gate at all, so it
    // was consulted for EVERY off-session beat regardless of whether anything
    // it watches was ever dispatched. Measured: `proof` beat 5 is a plain
    // `do`-only press/fill beat with NO `wait` field — `beat.wait` is
    // `undefined`, the same field `beatBound` (`beats.mjs`) reads to decide
    // whether this beat declared a wait at all — and the born-after-the-
    // anchor scan (`resolveAgentChannelDirForDeath`, no page-named run and no
    // bound run id to go on) picked up the Studio bridge's own
    // `_bridge-<ts>-<id>` log, which `classifyUnmeasuredDispatch` read as
    // REAPED. Nothing about that beat was ever waiting on an agent dispatch,
    // so nothing here should have been consulted on its behalf. `beat.wait`
    // is read directly — never threaded as a new parameter — because `beat`
    // is already this function's own argument, exactly like `beat.expect.data`
    // a few lines up.
    const agentScaleWait = beat.wait?.for === 'agent' || beat.wait?.for === 'settle';
    if (agentScaleWait && !watching && stallDoor !== null && sessionScope === null && typeof stallDoor.earlyDeath === 'function') {
      // Row 184c: death is judged from the beat's LAST press (`pressMs`).
      const stop = stallDoor.earlyDeath(runId, anchorMs ?? startedAt, boundRunId, pressMs ?? anchorMs ?? startedAt);
      if (stop !== null) {
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why: `${stop.reason}: ${stop.detail} The beat's expectations never held.`,
          stoppedBy: 'runner',
        });
      }
    }
    if (!watching && stallDoor !== null && sessionScope === null && doorWorthRunning(timeoutMs, STALL_CEILING_MS)) {
      // 718(1): the search window opens at the beat's declared ANCHOR when it
      // has one — the press whose work this beat is watching — and at this
      // wait's own start otherwise. The BOUND is unaffected either way: it is
      // still measured from `startedAt`, because a bound says how long THIS
      // step may take and nothing about where its evidence begins.
      const stop = stallDoor(runId, anchorMs ?? startedAt, boundRunId);
      if (stop !== null) {
        // `stoppedBy: 'runner'` for the same reason the progress bound sets it,
        // and C is right that this is not a widened diff but the identical
        // defect: `no-channel` is OUR measurement of an absent dispatch
        // directory, and the verdict has been announcing it as something "the
        // product had already said about this session" — a false sentence
        // inside a red, which is worse than a larger diff.
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why: `${stop.reason}: ${stop.detail} The beat's expectations never held.`,
          stoppedBy: 'runner',
        });
      }
    }
    if (probe !== null) { try { probe(); } catch { /* a probe is never load-bearing */ } }
    const why = stopReasonFor(observed, sessionScope);
    if (why !== null) {
      return Object.freeze({ afterMs: Date.now() - startedAt, why });
    }
    // 7.6.77 (T1 ruling 881, C's conditions 1-3) — THE PROGRESS BOUND, checked
    // LAST on purpose: every reason above is a better explanation than "nothing
    // changed", and a beat killed by a crash must be reported as a crash. This
    // fires only when nothing better accounts for the silence.
    //
    // WHY A SECOND BOUND AT ALL. S1 beat 11's `upTo` has to cover a VARIABLE
    // NUMBER of VARIABLE-LENGTH turns: measured over four funded runs the
    // interview rounds cost 28-126 s each and the single drafting turn costs
    // 327-392 s, and round count does not predict the outcome (runs 8 and 9
    // both answered two rounds; only 9 passed). So no wall-clock figure is both
    // safe and meaningful — raise it enough to survive three rounds plus a slow
    // draft and it no longer catches a genuine stall. `perTransition` bounds
    // PROGRESS instead: expiry means no transition, which is what beat 11
    // actually cares about. `upTo` is untouched and still the ceiling.
    //
    // MEASURED FROM THIS WAIT'S START, never from the anchor — 718(1)'s split,
    // unchanged: an anchor moves where EVIDENCE begins; a bound says how long
    // THIS step may take.
    if (tracker !== null) {
      // READ BY SOURCE, never through `resolveExpectations` — that function is
      // scoped to `expected` at every tier, so a `progressKey` the beat does not
      // itself expect is collected into `nested` and then discarded, and the
      // bound reports "never present" about a key the page renders every poll.
      // C measured it on this branch before `beats-progress.mjs` existed.
      const why = tracker.observe(readProgress(observed, progress.progressKey));
      if (why !== null) {
        // `stoppedBy` names WHO stopped the beat, so the verdict cannot append
        // "the product had already said so about this session" to a finding the
        // product never made (`beats-drive.mjs`'s `named`).
        return Object.freeze({ afterMs: Date.now() - startedAt, why, stoppedBy: 'runner' });
      }
    }
    // T1 ruling 1471 (S10 run 26) — FOR A `cycleOf` WAIT, `upTo` IS AN
    // INACTIVITY WINDOW, not a wall clock. Beat 10 hit `upTo` at 18:18:10 with
    // a review chunk persisted at 18:14:35, four minutes earlier — adversarial
    // review was running serially over four chunks, and the product was
    // demonstrably progressing when the declared bound killed it anyway. So
    // for a wait whose `cycleWatch` resolves a cycle BY IDENTITY (`cycleOf`),
    // `deadline` above is only the FALLBACK; the real deadline is recomputed
    // every poll from the cycle's own last write.
    //
    // A wait with no `cycleOf` — `cycleWatch.cycleOf === null`, including
    // every wait with no `cycleWatch` at all — keeps `deadline` exactly as it
    // was: that form watches a channel born after the press, which has no
    // stable identity to read progress FROM (7.6.143's own reason), and the
    // scope this bead was ruled to (§: "keep the existing behaviour for waits
    // WITHOUT cycleOf").
    let effectiveDeadline = deadline;
    let progressNote = null;
    if (watching && typeof cycleWatch.cycleOf === 'string' && cycleWatch.cycleOf !== '') {
      // ONE `now`, READ ONCE, for both halves of this poll's reading. `idle` is
      // "how long ago, relative to `pollNow`, did the cycle last write" — so
      // `activityAt` must be derived from that SAME `pollNow`, never a second,
      // later `Date.now()` call. Two separate reads here would reproduce, in
      // miniature, exactly the class this bead exists to close: a gap between
      // two clock reads standing in for real inactivity, this time inside the
      // runner's own bookkeeping rather than between poll ticks.
      const pollNow = Date.now();
      const idle = cycleWatch.progressIdleMs(pollNow);
      // AN ABSENT READING FAILS CLOSED (§15.504-shaped): no cycle dir yet, or
      // one with nothing written, is NOT fresh progress — it leaves
      // `lastActivityAt` exactly where it was, which for a wait that has never
      // seen a write at all is `null`, and `inactivityDeadline` below then
      // falls back to the plain, unreset `deadline`. The permissive misreading
      // this guards against is treating "no reading" as "just wrote".
      // PURE from here — `cycleWaitDeadline` (`beats-cycle-progress.mjs`) composes
      // the inactivity bound against the ABSOLUTE WALL CEILING, counted from
      // THIS WAIT'S OWN START and never reset by progress: a cycle that resets
      // the inactivity window forever is still bounded, or the fix for run 26
      // becomes a new way to hang a host. `CYCLE_WAIT_WALL_CEILING_MS` lives
      // beside `MAX_DECLARED_WAIT_MS` (`story-wait-schema.mjs`) and is never a
      // field a story can declare.
      const { deadline: cycleDeadline, firedBy } = liveWindow.observe(pollNow, idle);
      effectiveDeadline = cycleDeadline;
      const { lastActivityAt, extensions: progressExtensions } = liveWindow;
      // SAY WHY IT ENDED — in the spirit of `wait-bound.mjs`'s "THE CLAMP IS
      // NEVER HIDDEN": which bound actually fired, how many times progress
      // pushed it out, and when the cycle was last seen writing.
      progressNote = firedBy === 'wall'
        ? `the absolute wall ceiling of ${CYCLE_WAIT_WALL_CEILING_MS} ms fired regardless of progress (progress-extended ${progressExtensions} time(s))`
        : `no cycle progress for ${timeoutMs} ms (last write ${lastActivityAt === null ? 'never seen' : new Date(lastActivityAt).toISOString()}), progress-extended ${progressExtensions} time(s)`;
    } else if (beat.wait?.for === 'agent' && readLivenessNow !== null) {
      // ROW 179b (bead `forge-8vfn.8.5.27`, T1 ruling 1973ei) — EVERY OTHER
      // AGENT WAIT GETS 179'S SHAPE: the declared bound is an INACTIVITY window
      // reset by the watched agent's own liveness, under the same absolute
      // ceiling, and no longer a wall clock.
      //
      // MEASURED. S1 beat 6 (`wait: { for: 'agent', upTo: 420_000 }`, no `do`,
      // no `cycleOf`) reached this line with `effectiveDeadline` still the
      // plain `startedAt + timeoutMs` above — the ONLY branch that ever moved
      // it was `cycleOf`'s — and gave up at 15:21:02.993Z on `running` while
      // its own probe printed `SDK child utime 12→622 — it was WORKING`. The
      // dispatched run had written 150 lines with no gap over 15 s, and the
      // session published `complete` 2 m 47 s later
      // (`agent-wait-liveness-run7-capture.test.ts`, the real capture).
      //
      // THE ENDINGS ARE UNCHANGED, only the patience is: green the poll the
      // page shows the expectation (above); red early on the session's OWN
      // published state — `awaiting-answers`, crashed/stalled/terminal via
      // `stopReasonFor` — every poll, ahead of this (row 184: the published
      // state is the authority in both directions, so liveness can never sit
      // past it); red on REAL inactivity, one declared window after the
      // agent's last write; and the ceiling for a channel that never stops.
      //
      // `readLivenessNow` reads BY IDENTITY ONLY (`makeAgentLivenessReader`):
      // the session the page stands on — its own channel, or for a
      // turn.pid-only kind like onboarding the run the product's dual
      // `turn.pid` write pairs it with — or the run the page names / the beat
      // bound. No identity, no reading, and the plain declared bound stands.
      // `for: 'settle'` is excluded on purpose: its job is SHARPNESS (621(ii),
      // above), and a settle wait stretched by liveness would sit out the very
      // wrong value it exists to fail on.
      const pollNow = Date.now();
      const idle = readLivenessNow(runId, boundRunId, pollNow);
      if (idle !== null && typeof idle === 'object' && idle.unknown === true) unreadableDetail = idle.detail;
      const { deadline: liveDeadline, firedBy } = liveWindow.observe(pollNow, idle);
      effectiveDeadline = liveDeadline;
      if (pollNow >= effectiveDeadline && (liveWindow.extensions > 0 || firedBy === 'wall')) {
        // SAY WHICH BOUND ENDED IT (§664(ii), 179's two named reasons): the
        // verdict still prints `gave up at the agent wait`, and a reader must
        // be able to tell "the agent went quiet" from "it never did and the
        // ceiling stopped it" without reconstructing either from `_logs/`.
        const last = liveWindow.lastActivityAt;
        console.log(
          firedBy === 'wall'
            ? `[stories] agent wait: the WALL CEILING (${liveWindow.wallCeilingMs} ms) ended this wait — the agent never ` +
              `went quiet (liveness-extended ${liveWindow.extensions} time(s)).`
            : `[stories] agent wait: no agent liveness for ${timeoutMs} ms (last write ` +
              `${last === null ? 'never seen' : new Date(last).toISOString()}, liveness-extended ` +
              `${liveWindow.extensions} time(s)) — the declared bound is an INACTIVITY window, and it expired.` +
              (unreadableDetail === null ? '' : ` (the channel could not be read at least once: ${unreadableDetail})`),
        );
      }
    }
    if (Date.now() >= effectiveDeadline) {
      // Never null for an unreached terminal: the caller judges null on the LIVE
      // page, and an expectation that answered from t = 0 would read green.
      if (!terminalHeld) {
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why: `the declared terminal ${cycleWatch.wantState} was never reached in ${timeoutMs} ms — last seen: ${cycleWatch.lastSeen}` +
            (progressNote === null ? '.' : ` — ${progressNote}.`),
          stoppedBy: 'runner',
        });
      }
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
  }
}
