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
import { progressTracker } from './beats-progress.mjs';
// T1 1973bq (bead `forge-8vfn.8.5.15`, row 179) — the SAME deadline arithmetic
// a `cycleOf` agent wait already uses (`beats-cycle-progress.mjs`'s own
// header: S10 run 26, $14.61 lost to a wall clock that fired while a review
// chunk had landed four minutes earlier). `cycleWaitDeadline` is pure and
// generic — nothing in it names a cycle — so this reuses it rather than
// re-deriving the same min(inactivity, wall) arithmetic a second time.
import { cycleWaitDeadline } from './beats-cycle-progress.mjs';
// The SAME absolute backstop a `cycleOf` wait is bounded by, imported from its
// point of definition rather than through `beats-agent-proc.mjs`'s re-export
// — that file's whole channel-scanning apparatus is not a dependency this
// module needs for one constant.
import { CYCLE_WAIT_WALL_CEILING_MS } from './story-wait-schema.mjs';

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
 * THE PAGE MOVED UNDER THE LOOP — every wording the runner can produce for it.
 *
 * Matched on the message rather than an error class because `run` hands back a
 * string the step executor already formatted (`could not fill <handle>: …`).
 *
 * Two wordings, ONE event, and bead `forge-8vfn.6.11.52` (ruling 372) is the
 * cost of having recognised only the first. Playwright says *detached* for an
 * element it had resolved and then lost; for an element it never resolved, the
 * act's own `describeControl` reports **"no element carries that handle"**. S2
 * run 11 met the second: the interview form was torn down 12 ms after round 1
 * was accepted, `count()` was 0 at the failure, the word "detached" never
 * appeared, and a beat whose product was working perfectly died on it.
 *
 * This is the same two-notions-of-one-thing class `handleFor` exists to
 * prevent, one layer up.
 */
const PAGE_MOVED_RE = /detach|no element carries that handle/i;

/**
 * Run one `repeat` step to its conclusion.
 *
 * @param {object} input
 * @param {object} input.page              the live page
 * @param {{repeat: object[]}} input.step  the step being run
 * @param {() => number} input.left        ms remaining of the beat's ONE declared bound
 * @param {((spec: Record<string,string>) => Promise<boolean>)|null} input.matches  reads the live page against a data spec
 * @param {number} input.timeoutMs         that bound, for the failure text
 * @param {{perTransition: number, progressKey: string}|null} input.progress  the beat's progress bound, if it declared one
 * @param {(() => Promise<{value: string|undefined, source: string, carriers: number}>)|null} input.readProgressNow  reads `progressKey` from the live page, by SOURCE
 * @param {(() => Promise<number|null>)|null} input.readSessionEventsNow  T1 1545 — line count of the session this repeat is standing on RIGHT NOW, or `null` when the live route is not a session; growth resets the same clock `readProgressNow` does
 * @param {(() => (number|null|{unknown: true, detail: string}))|null} input.readSessionLivenessNow  T1 1973bq — idle ms since the bound session's `.heartbeat`/`events.jsonl` last moved (the same reading `runLogIdleMs` gives a session's stall door), read off the LIVE page; `null` when no session can be identified. Governs the loop's OWN bound (see below) — distinct from `readSessionEventsNow`, which only resets `readProgressNow`'s per-transition clock.
 * @param {number} [input.wallCeilingMs]  TEST SEAM ONLY, never a real-run override (the same shape `makeWaitSpendGuard`'s `pollMs` already is) — defaults to the real `CYCLE_WAIT_WALL_CEILING_MS`.
 * @param {(steps: object[], ms: number) => Promise<{waitedForHandle: boolean, error: string|null}>} input.run
 * @returns {Promise<{waitedForHandle: boolean, error: string|null}>}
 */
export async function runRepeatStep({
  page, step, left, matches, timeoutMs, run, progress = null, readProgressNow = null, readSessionEventsNow = null,
  readSessionLivenessNow = null, wallCeilingMs = CYCLE_WAIT_WALL_CEILING_MS,
}) {
  let waitedForHandle = false;
  // 7.6.77's REPEAT HALF, and the half that matters for S1 beat 11.
  //
  // `perTransition` shipped first on the CONSEQUENCE wait, which beat 11 barely
  // uses: its interview rounds AND its 327-392 s drafting turn are spent HERE,
  // inside this loop, and `beats-repeat.mjs:201`'s "ran out" line below is
  // verbatim what runs 8 and 10 printed. A bound proved correct in isolation,
  // attached to the wrong wait (T1 ruling 930) — the same shape as 640, in this
  // same pair of files.
  //
  // `timeoutMs` has exactly the property that made `upTo` useless on beat 11: it
  // bounds "how long may this repeat take in TOTAL", over a variable number of
  // variable-length turns. `session-phase` changes on every interview round and
  // freezes for one drafting turn, so a bound on PROGRESS only has to exceed one
  // turn rather than a whole run.
  const tracker = progress === null || readProgressNow === null
    ? null
    : progressTracker(progress, 'repeat', Date.now());

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
  // Whether the act was EVER on the page. The bound running out means two
  // very different things depending on this, and the verdict said only one
  // of them (T1 ruling 569 follow-up, bought by A's S9 run 3 beat 13).
  let sawGate = false;

  // T1 1973bq, bead `forge-8vfn.8.5.15`, row 179 — THE REPEAT'S OWN GOVERNING
  // BOUND, SESSION-LIVENESS-AWARE ONCE NOTHING ELSE ALREADY IS.
  //
  // MEASURED. S2 beat 12 declares `until` and a plain `wait: { for: 'agent',
  // upTo: 780_000 }` — no `perTransition`, so `tracker` above is `null` and
  // this loop had ZERO inactivity-awareness: `left()` alone, a pure
  // wall-clock countdown from the moment this beat's `do` started. A real run
  // answered one interview round at 06:28:28Z, the architect session then
  // WORKED CONTINUOUSLY — a draft turn writing tool events to 06:39:21, a
  // completeness critic 06:39:21–06:40:54, `.heartbeat` warm throughout — and
  // wrote `awaiting-verdict` at 06:40:54Z, 14s AFTER `left()` hit zero at
  // 06:40:40Z. A wall-clock bound red-flagged a live agent.
  //
  // RAISING 780_000 IS NOT THE FIX. The declared bound instead becomes an
  // INACTIVITY window — reset by the bound session's own liveness, its
  // `.heartbeat`/`events.jsonl` (the SAME channel `runLogIdleMs` already
  // reads for a session's stall door, `beats-agent-proc.mjs`) — backstopped
  // by the absolute wall ceiling every `cycleOf` agent wait already answers
  // to, so a session that never stops ticking still cannot sit a host
  // forever.
  //
  // SCOPED TO EXACTLY THE SHAPE THAT HAS NOTHING ELSE WATCHING LIVENESS, and
  // only ONCE THE GATE HAS BEEN SEEN AT LEAST ONCE (`sawGate`, read below —
  // never at the point this is declared, since that is always `false` here):
  //
  //   `tracker !== null` is excluded. A repeat that already declares
  //   `perTransition`/`progressKey` (S1 beat 11, 7.6.77/1545) has its own
  //   inactivity-aware early-stall detector UNDER the beat's wall-clock
  //   backstop already, and that beat's TRAILING `do` steps (`open-plan`,
  //   `approve-plan`) depend on the outer bound staying the beat's one,
  //   shared deadline. Extending it too would be a second, uncoordinated
  //   change riding along on this bead.
  //
  //   `!sawGate` keeps today's plain `left()` exactly, even when a session
  //   reader is wired. Ruling 569's own protection — a page that simply does
  //   not carry the repeat's act must still exhaust at the PLAIN declared
  //   bound, not be rescued into a 90-minute wait by an unrelated channel
  //   ticking somewhere else. Only once a round has genuinely been reached
  //   does this repeat have POSITIVE evidence it is standing on the right
  //   page at all.
  const livenessGoverned = tracker === null && readSessionLivenessNow !== null;
  const startedAt = Date.now();
  // Which deadline actually governed the last poll, and what the liveness
  // read said — carried for the exhaustion message alone (§664(ii): a verdict
  // a reader cannot check is a defect on its own terms).
  let firedBy = null;
  let unreadableDetail = null;
  let loggedNoSession = false;
  const boundLeft = () => {
    if (!livenessGoverned || !sawGate) return left();
    const now = Date.now();
    const idle = readSessionLivenessNow();
    let lastActivityAt = null;
    if (typeof idle === 'number') {
      lastActivityAt = now - idle;
    } else if (idle !== null && idle.unknown === true) {
      // An unreadable channel is not "not stalled" (§15.504's rule, applied
      // here): it fails CLOSED to "no evidence", exactly like an absent one,
      // rather than being read as either fresh progress or proof of silence.
      unreadableDetail = idle.detail;
    } else if (idle === null && !loggedNoSession) {
      loggedNoSession = true;
      console.log(
        '[stories] repeat: no session channel could be identified for the live page — keeping this beat\'s ' +
          'plain declared bound (today\'s behaviour) rather than an inactivity window.',
      );
    }
    const d = cycleWaitDeadline({ startedAt, timeoutMs, lastActivityAt, wallCeilingMs });
    firedBy = d.firedBy;
    return Math.max(0, d.deadline - now);
  };

  while (boundLeft() > 0) {
    if (await isSatisfied()) break;
    // Checked BEFORE the gate test, unlike the consequence wait's, and for the
    // opposite reason: there the product's own verdict is a better explanation
    // than silence, while here the two branches below (poll and round) each
    // continue the loop, so a check placed after either is skipped on the other.
    // The `until` above still wins — a repeat that has met its condition is not
    // stalled however long the key sat still.
    if (tracker !== null) {
      // T1 1545 — the session's OWN growth resets the same clock, alongside
      // `progressKey`. `null` when there is no reader, or the live route is
      // not a session: `progressTracker` treats that as no evidence, never as
      // a reset (§6.15).
      const eventLines = readSessionEventsNow === null ? null : await readSessionEventsNow();
      const why = tracker.observe(await readProgressNow(), eventLines);
      if (why !== null) return { waitedForHandle, error: why };
    }

    // Nothing to act on yet — the agent turn between rounds is still running.
    // Poll rather than spend the bound inside a handle wait, which cannot tell
    // "another round is coming" from "it drafted instead".
    if ((await page.locator(gate).count()) === 0) {
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, boundLeft())));
      continue;
    }
    sawGate = true;

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
      const inner = await run([one], boundLeft(), ACT_BOUND_MS);
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
      if (!PAGE_MOVED_RE.test(inner.error)) {
        return { waitedForHandle, error: `repeat, round ${rounds + 1}: ${inner.error}` };
      }
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, boundLeft())));
      interrupted = true;
      break;
    }
    if (interrupted) continue;
    rounds += 1;
  }

  if (!(await isSatisfied())) {
    // THE ACT WAS NEVER THERE. The loop spent the whole bound in the poll
    // branch above, so no round was ever attempted. This is the authoring
    // error lane A measured: S9 beat 13's repeat stood on a page that does
    // not carry its act and burned 600 000 ms being told the act "kept being
    // available" — the exact opposite of what happened.
    //
    // It is deliberately said only AFTER the bound. Ruling 569 removed the
    // route compare from inside a repeat because between rounds the gate is
    // legitimately gone while the agent takes its turn; absence at any one
    // moment proves nothing. Absence for the entire bound is a different
    // claim, and it is the only one made here.
    if (!sawGate) {
      return {
        waitedForHandle,
        error:
          `repeat: the act ${gate} never became available on "${new URL(page.url()).pathname}" in ` +
          `this beat's declared bound (${timeoutMs} ms), so no round was ever answered. Either this ` +
          'repeat is standing on the wrong page, or the affordance never arrived.',
      };
    }
    // The gate WAS there and rounds were answered. What is knowable is the
    // round count and the unmet condition; whether the act was still on the
    // page at the instant the bound expired is NOT — the loop reaches here
    // from the poll branch as often as from a finished round — so it is no
    // longer asserted.
    //
    // T1 1973bq — TWO NAMED REASONS when this repeat was liveness-governed,
    // because they are different findings and the red message must say
    // which: the session genuinely went quiet (`inactivity`), or it never
    // stopped advancing and the absolute backstop is what ended it (`wall`).
    // Neither replaces the plain wall-clock line below, which is exactly
    // today's wording for every beat this fix does not touch (no session
    // identified, or a progress bound already declared).
    if (livenessGoverned) {
      return {
        waitedForHandle,
        error: firedBy === 'wall'
          ? `repeat: answered ${rounds} round(s) and the WALL CEILING (${wallCeilingMs} ms) ran out before its ` +
            `\`until\` (${JSON.stringify(until)}) was met. This beat's declared bound (${timeoutMs} ms) became ` +
            "an INACTIVITY window the session's own liveness kept resetting — it never went quiet — but a " +
            'wait cannot reset forever, so the absolute ceiling is what stopped this one.'
          : `repeat: answered ${rounds} round(s) and the session showed no liveness advance (its own ` +
            `\`.heartbeat\`/\`events.jsonl\`) for a full ${timeoutMs} ms before its \`until\` ` +
            `(${JSON.stringify(until)}) was met. This beat's declared bound is an INACTIVITY window, not a ` +
            'wall clock — it only expires when the session itself goes quiet, and it did.' +
            (unreadableDetail !== null
              ? ` (the session's channel could not be read at least once while this ran: ${unreadableDetail})`
              : ''),
      };
    }
    return {
      waitedForHandle,
      error:
        `repeat: answered ${rounds} round(s) and this beat's declared bound (${timeoutMs} ms) ran ` +
        `out before its \`until\` (${JSON.stringify(until)}) was met.`,
    };
  }

  return { waitedForHandle, error: null };
}
