/**
 * story-wait-schema.mjs — a beat's `do` steps and its `wait`, validated.
 *
 * Split out of `story-file.mjs` by `forge-8vfn.7.6.149`. That file sat at
 * EXACTLY 800 lines — the hard cap, where 800 is silent and 801 is red — and
 * had been fitted under it twice in one day by shaving prose (7.6.143 and
 * 7.6.147). A third trim would have bought a third day. This is the seam
 * instead.
 *
 * A PURE MOVE, and the declaration lines are part of what is unchanged.
 * `wait-carry-through.test.ts` reads this function out of the source with
 * `/^function validateWait\(/m` and refuses if it cannot find it. An
 * `export function` prefix would break that anchor and turn a working door
 * into a refusal, so the exports are a trailing statement instead — the door
 * changes only the FILE it opens, never what it asserts.
 *
 * WHY THIS SEAM. `validateDoSteps` and `validateWait` are each called once
 * from `validateStory` and reference nothing else in that file except the
 * diagnostics — measured before the cut: the only other names appearing in
 * this range are `ROOT` and `validateStory`, both inside prose. They are also
 * one subject: a `wait` is a licence to sit still and a `do` block is what
 * consumes it, which is why `7.6.143` had to change both together.
 *
 * `PROGRESS_KEY_SHAPE` and `MAX_DECLARED_WAIT_MS` travel with the validator
 * that enforces them, and `story-file.mjs` RE-EXPORTS both so its public
 * surface is unchanged — `wait-bound.mjs` and three doors import them from
 * there by name and keep working untouched.
 */

import { fail, requireNonEmptyString } from './story-schema-fail.mjs';
import { SAFE_KEY } from './beats-page-read.mjs';

/**
 * Validate a beat's `do` — the ordered list of what the operator DOES on the
 * page they are standing on, before this beat's state is judged.
 *
 * Ordered, and one action per step, because S1 beat 3 presses the Advanced
 * toggle BETWEEN two fills: `{fill: {...}, press: '...'}` cannot say that, and
 * a step doing two things reintroduces the ambiguity the array removes.
 *
 * A step names a `data-field` or a `data-action` VALUE — forge-ui's own
 * declared contract (`docs/forge-ui-dom-and-harness.md`), the same vocabulary
 * `expect.data` reads. Never a CSS selector: a story that names markup is
 * coupled to markup, which §3.1 deliberately avoids.
 *
 * Absent means an empty list, not undefined — every story authored before this
 * existed omits it, and downstream must not have to test for undefined.
 */
/** A sanity bound on `pressWithin`'s `scope.text` — what an author types to
 *  name a criterion, not a product limit. `forge-8vfn.8.1.16`. */
const PRESS_WITHIN_TEXT_MAX_LENGTH = 200;

function validateDoSteps(raw, at) {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(`${at}.do`, `expected an array of steps, got ${JSON.stringify(raw)}`);

  return Object.freeze(
    raw.map((step, i) => {
      const where = `${at}.do[${i}]`;
      if (step === null || typeof step !== 'object') fail(where, 'expected an object');
      const isFill = Object.hasOwn(step, 'fill');
      // `fillAll` — bead `forge-8vfn.6.11.21` (T1 ruling 271). One step answers a
      // WHOLE round. `ArchitectQuestionForm` requires EVERY question answered
      // before Submit enables, and the question COUNT is model-determined (two
      // in one measured architect turn, three in another), so a fixed number of
      // `fill` steps cannot answer a variable number of questions — and one
      // `data-field` value on N elements trips playwright strict mode on the
      // first `fill`. Additive: `fill` is untouched and still means "exactly
      // this one control".
      const isFillAll = Object.hasOwn(step, 'fillAll');
      const isPress = Object.hasOwn(step, 'press');
      // `repeat` — §3.1, T1 rulings 312/317. Its inner steps are validated by
      // the SAME rules (one action per step, no nesting), so a typo inside a
      // repeat is named at authoring time exactly like one outside it. The
      // architect decides how many interview rounds it needs, so a fixed number
      // of submit steps is wrong in both directions: too few never reaches the
      // draft, and too many press a control that exists only while the session
      // awaits answers.
      const isRepeat = Object.hasOwn(step, 'repeat');
      const isPressBound = Object.hasOwn(step, 'pressBound');
      // `pressWithin` — bead `forge-8vfn.6.11.51`. A bare `press` clicks
      // `.first()` of every element sharing its `data-action`, which is one
      // PER CARD on a list surface (Home's session strip). Scopes the press
      // to the element whose `data-<attr>` equals an earlier beat's binding.
      const isPressWithin = Object.hasOwn(step, 'pressWithin');
      if ([isFill, isFillAll, isPress, isRepeat, isPressBound, isPressWithin].filter(Boolean).length !== 1) {
        fail(where, `expected exactly one of {fill, with}, {fillAll, with}, {press}, {pressBound}, {pressWithin} or {repeat}, got ${JSON.stringify(step)}`);
      }
      if (isRepeat) {
        if (!Array.isArray(step.repeat) || step.repeat.length === 0) {
          fail(`${where}.repeat`, `expected a non-empty array of steps, got ${JSON.stringify(step.repeat)}`);
        }
        // `until` is REQUIRED and is the repeat's OWN condition (T1 ruling 320).
        // It used to borrow the beat's `expect.data`, which is unreachable
        // whenever the repeat is not the last step — S1 beat 11 runs
        // `open-plan` and `approve-plan` AFTER its repeat and expects the
        // post-approval state, so the loop could never stop by answering
        // questions and burned its whole bound on a disabled control.
        const until = step.until;
        if (until === null || typeof until !== 'object' || Array.isArray(until) || Object.keys(until).length === 0) {
          fail(`${where}.until`, `expected a non-empty object of data-key -> value, got ${JSON.stringify(until)}`);
        }
        for (const [k, v] of Object.entries(until)) {
          if (typeof v !== 'string') fail(`${where}.until.${k}`, `expected a string value, got ${JSON.stringify(v)}`);
        }
        if (step.repeat.some((inner) => inner !== null && typeof inner === 'object' && Object.hasOwn(inner, 'repeat'))) {
          fail(`${where}.repeat`, 'a repeat cannot nest another repeat');
        }
        // 7.6.98 — THE PROGRESS BOUND BELONGS HERE, not on the beat's `wait`.
        //
        // It shipped on `wait` (7.6.77) and that was wrong twice over. `driveBeat`
        // hands ONE wait object to the repeat AND to the consequence wait, which
        // stand on DIFFERENT PAGES: S1 beat 11's repeat runs on the session page
        // where `session-phase` changes every round, while its consequence wait
        // runs on `/artifact`, which renders `data-session-phase` zero times. A
        // failure there reported `no-progress-key (consequence)` — true, and
        // pointed at the story file for a product failure.
        //
        // `progressKey` MUST BE A KEY `until` NAMES. That is the whole point of
        // moving it: the repeat's own stop condition already names a key it can
        // observe on the page it stands on, so binding the two makes them unable
        // to disagree and makes a key-on-the-wrong-page impossible by
        // construction rather than by a reviewer noticing.
        const hasPer = step.perTransition !== undefined;
        const hasKey = step.progressKey !== undefined;
        if (hasPer !== hasKey) {
          fail(
            `${where}.${hasPer ? 'progressKey' : 'perTransition'}`,
            `\`perTransition\` and \`progressKey\` are both-or-neither on a repeat: ${hasPer
              ? '`perTransition` without `progressKey` is a budget nothing can reset'
              : '`progressKey` without `perTransition` is a key nothing reads'}`,
          );
        }
        if (hasPer) {
          if (!Number.isInteger(step.perTransition) || step.perTransition <= 0) {
            fail(`${where}.perTransition`, `expected a positive integer in ms, got ${JSON.stringify(step.perTransition)}`);
          }
          if (typeof step.progressKey !== 'string' || !Object.hasOwn(step.until, step.progressKey)) {
            fail(
              `${where}.progressKey`,
              `expected one of the keys \`until\` names (${Object.keys(step.until).join(', ')}), got ` +
              `${JSON.stringify(step.progressKey)} — a progress key the loop's own stop condition does not ` +
              'mention is a key this repeat has no reason to be able to see',
            );
          }
        }
        return Object.freeze({
          repeat: validateDoSteps(step.repeat, where),
          until: Object.freeze({ ...step.until }),
          ...(hasPer ? { perTransition: step.perTransition, progressKey: step.progressKey } : {}),
        });
      }
      // 7.6.54 (ruling 795): `pressBound` names a handle whose id is minted at
      // run time — `open-initiative-<initiativeId>` cannot be written literally
      // because the id does not exist until the run mints it. `press` stays
      // literal, so routes-only substitution stays true by construction and the
      // `<pattern>`-is-CLI-syntax property needs no exemption.
      if (Object.hasOwn(step, 'pressBound')) {
        const pb = step.pressBound;
        if (pb === null || typeof pb !== 'object') fail(`${where}.pressBound`, 'expected an object { action, bind }');
        requireNonEmptyString(pb.action, `${where}.pressBound.action`);
        requireNonEmptyString(pb.bind, `${where}.pressBound.bind`);
        return Object.freeze({ pressBound: Object.freeze({ action: pb.action, bind: pb.bind }) });
      }
      // `forge-8vfn.6.11.51`: same refuse-rather-than-guess shape as
      // `pressBound` above, validated exactly the same way — `scope.bind`
      // names a binding resolved at run time, so it is checked for presence
      // here and for being an EARLIER beat's binding in `story-file.mjs`.
      //
      // `forge-8vfn.8.1.16` / T1 ruling 1561 adds `scope.text` as the OTHER
      // form: exactly one of `bind`/`text`, because a scope resolved from an
      // earlier binding and one resolved from live page text are two
      // different run-time sources and a step naming both would resolve
      // however this validator's field order happened to favour one.
      if (Object.hasOwn(step, 'pressWithin')) {
        const pw = step.pressWithin;
        if (pw === null || typeof pw !== 'object') fail(`${where}.pressWithin`, 'expected an object { scope, action }');
        requireNonEmptyString(pw.action, `${where}.pressWithin.action`);
        const scope = pw.scope;
        if (scope === null || typeof scope !== 'object') {
          fail(`${where}.pressWithin.scope`, 'expected an object { attr, bind } or { attr, text }');
        }
        requireNonEmptyString(scope.attr, `${where}.pressWithin.scope.attr`);
        // SAME allowlist `progressKey` is bound to (`PROGRESS_KEY_SHAPE`
        // above, identical by a door — `beats-per-transition.test.ts`):
        // `attr` is interpolated into a CSS selector (`scopedPressHandle`,
        // `unscopedPressWithinHandle`, `beats.mjs`), so it is refused here,
        // at the boundary, rather than half-honoured at run time.
        if (!SAFE_KEY.test(scope.attr)) {
          fail(
            `${where}.pressWithin.scope.attr`,
            'expected a plain data-* key (letter, then letters/digits/hyphens), got ' +
              JSON.stringify(scope.attr),
          );
        }
        const hasBind = Object.hasOwn(scope, 'bind');
        const hasText = Object.hasOwn(scope, 'text');
        if (hasBind === hasText) {
          fail(
            `${where}.pressWithin.scope`,
            `expected exactly one of { bind } or { text }, got ${JSON.stringify(scope)}`,
          );
        }
        if (hasBind) {
          if (scope.fallback !== undefined) {
            fail(
              `${where}.pressWithin.scope.fallback`,
              '`fallback` is only valid alongside `text`, not `bind`',
            );
          }
          requireNonEmptyString(scope.bind, `${where}.pressWithin.scope.bind`);
          return Object.freeze({
            pressWithin: Object.freeze({
              scope: Object.freeze({ attr: scope.attr, bind: scope.bind }),
              action: pw.action,
            }),
          });
        }
        // The TEXT form. `≤ 200` chars is a sanity bound on what a story
        // author types, not a product limit — `requireNonEmptyString` already
        // refuses the empty and whitespace-only cases (`.trim() === ''`).
        requireNonEmptyString(scope.text, `${where}.pressWithin.scope.text`);
        if (scope.text.length > PRESS_WITHIN_TEXT_MAX_LENGTH) {
          fail(
            `${where}.pressWithin.scope.text`,
            `expected at most ${PRESS_WITHIN_TEXT_MAX_LENGTH} characters, got ${scope.text.length}`,
          );
        }
        if (scope.fallback !== undefined && scope.fallback !== 'first') {
          fail(
            `${where}.pressWithin.scope.fallback`,
            `expected 'first' or undefined, got ${JSON.stringify(scope.fallback)}`,
          );
        }
        return Object.freeze({
          pressWithin: Object.freeze({
            scope: Object.freeze({
              attr: scope.attr, text: scope.text,
              ...(scope.fallback !== undefined ? { fallback: scope.fallback } : {}),
            }),
            action: pw.action,
          }),
        });
      }
      if (isPress) {
        requireNonEmptyString(step.press, `${where}.press`);
        return Object.freeze({ press: step.press });
      }
      const key = isFillAll ? 'fillAll' : 'fill';
      requireNonEmptyString(step[key], `${where}.${key}`);
      // `with` is checked as a string, not for truthiness: clearing a field to
      // "" is a real operator action, and coercing a missing value to "" would
      // silently type nothing into a required field.
      if (typeof step.with !== 'string') {
        fail(`${where}.with`, `expected a string value to fill, got ${JSON.stringify(step.with)}`);
      }
      return Object.freeze(isFillAll ? { fillAll: step.fillAll, with: step.with } : { fill: step.fill, with: step.with });
    }),
  );
}

/** Wait kinds a beat may declare. `agent` was the only one for a long time;
 *  `settle` and now `priced` were each bought by a measured incident, and
 *  adding one is still a deliberate edit here — the friction is the point. */
const WAIT_KINDS = ['agent', 'settle', 'priced'];

/**
 * The shape a `progressKey` may take — IDENTICAL to `beats-page.mjs`'s
 * `SAFE_KEY`, and bound to it by a door rather than by a comment.
 *
 * WHY THE VALIDATOR CARES, found in this bead's own hand security review
 * (§15.333; the `security-review` skill still aborts on `origin/HEAD`, bead
 * `forge-8vfn.7.6.69`). `readObserved` reads the ROOT's attributes by name —
 * `getAttribute` takes any string — but builds its DESCENDANT selector from
 * `SAFE_KEY`-passing keys only. So a key like `foo:bar` would be read on the
 * page root and invisible on every child, and the per-transition bound would
 * then report "the key never appeared" about a key a descendant is rendering.
 * That is the conflation species re-entering by a side door: absent-because-
 * uncollected and absent-because-unrendered arriving as one answer.
 *
 * Refused at the boundary instead, where the author is told which character is
 * the problem, rather than half-honoured at run time.
 */
export const PROGRESS_KEY_SHAPE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** The widest bound a beat may declare, in ms. A declared wait is a licence to
 *  sit still; an unbounded or absurd one turns a red run into a hung host,
 *  which is worse than the defect it was added to fix. */
export const MAX_DECLARED_WAIT_MS = 30 * 60 * 1000;

/**
 * THE ABSOLUTE WALL CEILING for a `cycleOf` agent wait, in ms — T1 ruling 1471
 * (S10 run 26).
 *
 * S10's beat 10 hit `MAX_DECLARED_WAIT_MS` at 18:18:10 while a review chunk had
 * persisted at 18:14:35, four minutes earlier: the product was progressing and
 * the wall clock ended the wait anyway, killing the reviewer and the cycle
 * after $14.61. The fix (`beats-agent-proc.mjs`'s `makeCycleTerminalWatch`)
 * makes `upTo` an INACTIVITY window for a `cycleOf` wait — it resets on every
 * new cycle event — which means a cycle that never stops writing could
 * otherwise never stop the wait. This is the OTHER side: a hard ceiling on
 * TOTAL elapsed time, counted from the wait's own start and never reset by
 * progress, so a run that is technically always "making progress" cannot sit a
 * host forever.
 *
 * NEVER DECLARED BY A STORY. This is not a field `validateWait` accepts — a
 * story still declares `upTo` exactly as before, capped at
 * `MAX_DECLARED_WAIT_MS` as it always has been, and that cap is what bounds
 * the INACTIVITY window. This constant is the runtime's own backstop above
 * that, the same relationship `wait-bound.mjs`'s derived bound has to
 * `MAX_DECLARED_WAIT_MS` — a second, more generous number that exists only to
 * catch the case the first one cannot.
 *
 * 3x `MAX_DECLARED_WAIT_MS`, a measurement-shaped choice rather than an
 * invented one: S10's own five measured develop cycles ran 17-29 minutes
 * end-to-end with no gap the reset would need to cross, so three lots of the
 * existing 30-minute cap (90 minutes) is generous against every real run this
 * campaign has on file while still being a HARD stop — a cycle resetting the
 * window every few minutes for an hour and a half is no longer "progress", it
 * is a runaway.
 */
export const CYCLE_WAIT_WALL_CEILING_MS = 3 * MAX_DECLARED_WAIT_MS;

/**
 * Validate a beat's optional `wait` (bead `forge-8vfn.6.11.10`, T1 ruling
 * 220) and RETURN it, so `validateStory`'s field list carries it through.
 *
 * That last clause is the whole reason this function exists as more than a
 * type check: this validator rebuilds every beat from a fixed field list, so a
 * key it does not name is dropped SILENTLY. `fork` is dropped exactly that way
 * today (S2 beat 3's own comment says so). A `wait` implemented only in
 * `beats.mjs` would be declared by the story, never seen by the runner, and
 * the beat would red at the DOM bound with nothing to say why.
 *
 * Fail-closed on an unknown kind rather than falling back to the default: a
 * silently-ignored `for: 'agnet'` gives the beat the very bound it was
 * declared to escape, and the run record then blames the product.
 */
function validateWait(raw, at) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`${at}.wait`, 'expected an object');
  if (!WAIT_KINDS.includes(raw.for)) {
    fail(`${at}.wait.for`, `expected one of ${WAIT_KINDS.join(' | ')}, got ${JSON.stringify(raw.for)}`);
  }
  if (!Number.isInteger(raw.upTo) || raw.upTo <= 0 || raw.upTo > MAX_DECLARED_WAIT_MS) {
    fail(
      `${at}.wait.upTo`,
      `expected an integer 1..${MAX_DECLARED_WAIT_MS} ms, got ${JSON.stringify(raw.upTo)}`,
    );
  }
  // ROW 109 (T1 1549) — `wait: { for: 'priced', upTo }`. EVIDENCE, never a
  // verdict input (`beats-agent-proc.mjs`'s `waitForPricedEvent` carries the
  // rest of the story): the beat's own `expect.data` still decides pass/fail,
  // and this wait only buys the session standing on the page more real time to
  // write a priced event before the run's own teardown reaps it. Nothing else
  // is accepted — refused HERE, by name, rather than silently dropped by the
  // generic rebuild at the bottom of this function, which is what every other
  // stray-field refusal in this file already does.
  if (raw.for === 'priced') {
    const allowed = new Set(['for', 'upTo']);
    const stray = Object.keys(raw).find((k) => !allowed.has(k));
    if (stray !== undefined) {
      fail(
        `${at}.wait.${stray}`,
        `a priced wait takes only { for, upTo }, got ${JSON.stringify(stray)} too — it would be dropped silently`,
      );
    }
    return Object.freeze({ for: raw.for, upTo: raw.upTo });
  }
  // 7.6.118 / T1 1089(c). The queue state this wait ends on — the product's own
  // terminal word for the cycle the beat is watching. OPT-IN: a beat that names
  // none is not watched at all, so no beat gains a new way to fail by standing
  // beside one that opted in (the stall door's own scoping rule).
  if (raw.terminal !== undefined && (typeof raw.terminal !== 'string' || raw.terminal === '')) {
    fail(
      `${at}.wait.terminal`,
      `expected a non-empty queue state the cycle ends in, got ${JSON.stringify(raw.terminal)}`,
    );
  }
  // 7.6.118 / T1 1089. The DERIVED bound's reason, optional and validated here
  // — above the `settle` branch for that branch's own documented reason: it
  // RETURNS, so anything checked below it is silently dropped for settle waits.
  if (raw.boundBasis !== undefined && (typeof raw.boundBasis !== 'string' || raw.boundBasis === '')) {
    fail(
      `${at}.wait.boundBasis`,
      `expected a non-empty string explaining how the bound was derived, got ${JSON.stringify(raw.boundBasis)}`,
    );
  }
  // PLACED ABOVE THE `settle` BRANCH DELIBERATELY, and my own door is why. The
  // first cut of this sat below it — and that branch RETURNS, so a settle wait
  // carrying `perTransition` had both fields dropped SILENTLY: the exact defect
  // 7.6.82 was minted for, reproduced inside the fix that cites it. Every kind
  // must reach these checks, and the `for !== 'agent'` refusal below is then
  // what makes a settle wait say so out loud.
  // 7.6.77 (T1 881, C's 612 ack) — PROGRESS, not wall-clock.
  //
  // S1 beat 11's `upTo` has to cover a VARIABLE NUMBER of VARIABLE-LENGTH turns:
  // measured across four runs the interview rounds cost 28-126 s each while the
  // single drafting turn costs 327-392 s, and round count alone does not predict
  // the outcome (runs 8 and 9 both answered 2 rounds; only 9 passed). So no
  // single figure is both safe and meaningful — raise it enough to survive three
  // rounds plus a slow draft and it no longer catches a genuine stall.
  //
  // `perTransition` resets its budget every time `progressKey` CHANGES, so
  // expiry means no progress rather than no completion. `upTo` is untouched and
  // still the absolute ceiling: this is a second, stricter bound, never a
  // replacement.
  //
  // BOTH OR NEITHER, refused by name (C's condition 1). `progressKey` alone is a
  // key nobody reads. `perTransition` alone is a budget that can never reset —
  // a shorter wall-clock bound wearing a progress-bound's name, which is
  // strictly worse than today because it reds EARLIER while claiming to measure
  // progress.
  const hasPer = raw.perTransition !== undefined;
  const hasKey = raw.progressKey !== undefined;
  if (hasPer !== hasKey) {
    fail(
      `${at}.wait.${hasPer ? 'progressKey' : 'perTransition'}`,
      `\`perTransition\` and \`progressKey\` are both-or-neither: ${hasPer
        ? '`perTransition` without `progressKey` is a budget nothing can ever reset — a shorter wall-clock bound wearing a progress bound\'s name'
        : '`progressKey` without `perTransition` is a key nothing reads'}`,
    );
  }
  if (hasPer) {
    if (raw.for !== 'agent') {
      fail(`${at}.wait.perTransition`, `only an agent wait takes \`perTransition\`; on for: '${raw.for}' it would be dropped silently`);
    }
    if (!Number.isInteger(raw.perTransition) || raw.perTransition <= 0) {
      fail(`${at}.wait.perTransition`, `expected a positive integer in ms, got ${JSON.stringify(raw.perTransition)}`);
    }
    // C's condition 2, tightened to `>=` on C's read of `4fb31a26`. A bound
    // ABOVE the ceiling can never fire. A bound EQUAL to it cannot fire either
    // in any case that matters: after a transition at `t` it would expire at
    // `t + upTo`, which is past the ceiling, and with no transition at all it
    // expires at exactly `upTo`, where the ceiling fires anyway. The one thing
    // equality buys is a better MESSAGE in that last case — an accident of the
    // order the waiter checks its two bounds in, not a bound. Refused, because
    // condition 2's own sentence applies: it would read as protection and
    // provide none.
    if (raw.perTransition >= raw.upTo) {
      fail(
        `${at}.wait.perTransition`,
        `expected < upTo (${raw.upTo} ms), got ${raw.perTransition} — a per-transition bound at or above the ceiling can never fire earlier than the ceiling, so it would read as protection and provide none`,
      );
    }
    if (typeof raw.progressKey !== 'string' || raw.progressKey === '') {
      fail(`${at}.wait.progressKey`, `expected the data-* key whose CHANGE counts as progress, got ${JSON.stringify(raw.progressKey)}`);
    }
    if (!PROGRESS_KEY_SHAPE.test(raw.progressKey)) {
      fail(
        `${at}.wait.progressKey`,
        `expected a plain data-* key (letter, then letters/digits/hyphens), got ${JSON.stringify(raw.progressKey)} — ` +
        'the runner builds its descendant selector from keys of that shape only, so this one would be read on the ' +
        'page root and invisible on every child, and the bound would then report "the key never appeared" about a ' +
        'key a descendant is rendering',
      );
    }
  }

  // `settle` — T1 ruling 621(ii), bought by A's S1 beat 3. It waits for a NAMED
  // key to leave a DECLARED transient value, and both halves are required
  // because the alternative is a blanket longer wait, which sits through a
  // genuinely wrong value exactly as patiently as through a transient one and
  // turns a real red into a timeout. Naming what it is willing to wait out is
  // what keeps the failure sharp: `preflight-status` may pass through
  // `pending`, and a beat that declared that can still red on `soft-fail`.
  if (raw.for === 'settle') {
    if (typeof raw.key !== 'string' || raw.key === '') {
      fail(`${at}.wait.key`, `a settle wait must name the data-* key it watches, got ${JSON.stringify(raw.key)}`);
    }
    if (typeof raw.while !== 'string' || raw.while === '') {
      fail(
        `${at}.wait.while`,
        `a settle wait must name the transient value it is willing to wait out, got ${JSON.stringify(raw.while)}`,
      );
    }
    return Object.freeze({ for: raw.for, upTo: raw.upTo, key: raw.key, while: raw.while,
      ...(raw.boundBasis !== undefined ? { boundBasis: raw.boundBasis } : {}),
      ...(raw.terminal !== undefined ? { terminal: raw.terminal } : {}) });
  }
  // Fail-closed the other way too. This function DROPS every key it does not
  // name, and the comment above says so — so a `key`/`while` pair left on an
  // `agent` wait would vanish silently and the beat would wait for the wrong
  // thing with no sign of it.
  // 718(1): `anchor` names an EARLIER press whose work this beat watches. Only
  // an agent wait has a channel to anchor, so it is refused elsewhere rather
  // than dropped — the same rule `key`/`while` follow, and for the same reason:
  // a field silently ignored is a field the author believes is working.
  if (raw.anchor !== undefined) {
    if (raw.for !== 'agent') {
      fail(`${at}.wait.anchor`, `only an agent wait takes \`anchor\`; on for: '${raw.for}' it would be dropped silently`);
    } else if (typeof raw.anchor !== 'string' || raw.anchor === '') {
      fail(`${at}.wait.anchor`, `expected the press handle this beat's channel belongs to, got ${JSON.stringify(raw.anchor)}`);
    }
  }

  // 7.6.143 (T1 1147) — `cycleOf` names the initiative whose EXISTING cycle
  // this beat watches, for the case the anchor form cannot express: the develop
  // station CONTINUES the cycle the architect minted (DEC-2 threads one
  // `cycle_id` through the kickoff), so no dispatch dir is born after the press
  // and `newestChannelSince` finds nothing. Refused off an agent wait rather
  // than dropped, exactly as `anchor` is, and for the reason this file keeps
  // paying for: a field silently ignored is a field the author believes works.
  if (raw.cycleOf !== undefined) {
    if (raw.for !== 'agent') {
      fail(`${at}.wait.cycleOf`, `only an agent wait takes \`cycleOf\`; on for: '${raw.for}' it would be dropped silently`);
    } else if (typeof raw.cycleOf !== 'string' || raw.cycleOf === '') {
      fail(`${at}.wait.cycleOf`, `expected the initiative id whose existing cycle this beat watches, got ${JSON.stringify(raw.cycleOf)}`);
    } else if (raw.terminal === undefined) {
      fail(`${at}.wait.cycleOf`, '`cycleOf` names which cycle to watch and only a `terminal:` declaration watches one — without it the field would resolve a cycle and then be dropped');
    }
  }

  for (const stray of ['key', 'while']) {
    if (raw[stray] !== undefined) {
      fail(`${at}.wait.${stray}`, `only a settle wait takes \`${stray}\`; on for: '${raw.for}' it would be dropped silently`);
    }
  }
  // 7.6.82 (T1 883) — `anchor` IS CARRIED. It was validated eleven lines above
  // and then dropped by this rebuild, so `S10.story.mjs:398`'s
  // `anchor: 'scheduler-start'` never reached `resolveAnchorMs` and beat 8 took
  // the pre-718(1) window on every run since it landed. Worse than inert: the
  // waiter's absent-anchor branch is the silent fallback its own comment
  // forbids, and the typo refusal beside it was unreachable because the field
  // never arrived to be wrong. Conditional so an undeclared anchor stays
  // genuinely absent rather than present-and-undefined.
  return Object.freeze({
    for: raw.for, upTo: raw.upTo,
    ...(raw.boundBasis !== undefined ? { boundBasis: raw.boundBasis } : {}),
    ...(raw.terminal !== undefined ? { terminal: raw.terminal } : {}),
    ...(raw.cycleOf !== undefined ? { cycleOf: raw.cycleOf } : {}),
    ...(raw.anchor !== undefined ? { anchor: raw.anchor } : {}),
    ...(hasPer ? { perTransition: raw.perTransition, progressKey: raw.progressKey } : {}),
  });
}

export { validateDoSteps, validateWait };
