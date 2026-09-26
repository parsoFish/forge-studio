/**
 * Reading a beat's `progressKey`, and saying HONESTLY why its bound expired —
 * bead `forge-8vfn.7.6.77`, T1 ruling 881, C's read of `4fb31a26`.
 *
 * WHY THIS IS ITS OWN MODULE. The first cut read the key through
 * `resolveExpectations`, which is scoped to `expected` at every tier: `missing`
 * comes from `Object.keys(expected)`, `solo` fills only `missing`, and the
 * early return hands back the page ROOT alone. So a `progressKey` the beat does
 * not itself expect was collected into `observed.nested` — `alsoWanted` put it
 * in the selector — and then DISCARDED, and the bound reported *"that key was
 * never present on the page — not once, at any value"* about a key the page was
 * rendering on a descendant every poll. Measured on the branch before this
 * module existed: a key changing every 100 ms, red at `no-progress-key`.
 *
 * That is the SAME defect as the `foo:bar` shape finding one layer along —
 * absent-because-never-asked-about reported as absent-because-not-rendered —
 * and it defeats condition 3 exactly: the two expiries stay two and the WRONG
 * one fires. A funded beat 11 would die at 480 s pointing the reader at the
 * story file.
 *
 * SO THE READ RETURNS ITS SOURCE, NOT ONLY ITS VALUE. Four sources, four
 * expiries, no collapsing:
 *
 *   root       the page root carries it
 *   solo       exactly one descendant carries it — the same one-carrier rule
 *              `resolveExpectations` already uses, so the two cannot disagree
 *   ambiguous  several carry it: there is no single value to track, and
 *              PICKING one would be a measurement of whichever element sorted
 *              first
 *   absent     nobody carries it
 *
 * A key that was sighted and then STOPPED being rendered is its own finding
 * too: the page unmounted the element, which is not an agent that stopped
 * emitting, and the old wording told the reader it was.
 */

import { readRunEvents } from './run-observe.mjs';

/**
 * Line count of a session's OWN `events.jsonl` right now, or `null` when
 * there is no session dir to read at all — the live route did not resolve to
 * one (`beats-drive.mjs`'s `sessionLogDir` call already answers that), never
 * conflated with a real `0`: a session dir that exists but has not written
 * its first row yet is a real, comparable count — not "unknown" — and it is
 * the CALLER (`progressTracker` below) that decides whether that is growth
 * over what it saw last, never this function (§6.15 — unknown is named,
 * never read as progress).
 *
 * Reuses `readRunEvents` (`run-observe.mjs`) rather than a second parse, so
 * "this many lines" means what the run's own spend accounting already means
 * by it (`readDispatchSnapshot`'s `eventLines`) — one definition, not two
 * that can drift apart.
 */
export function sessionEventLines(dir) {
  return dir === null ? null : readRunEvents(dir).length;
}

/** Read `key` from an observation, naming WHERE it was found. */
export function readProgress(observed, key) {
  const root = observed?.data ?? {};
  if (Object.hasOwn(root, key)) return { value: root[key], source: 'root', carriers: 1 };
  const carriers = (observed?.nested ?? []).filter((r) => Object.hasOwn(r, key));
  if (carriers.length === 1) return { value: carriers[0][key], source: 'solo', carriers: 1 };
  if (carriers.length > 1) return { value: undefined, source: 'ambiguous', carriers: carriers.length };
  return { value: undefined, source: 'absent', carriers: 0 };
}

/**
 * ONE STATE MACHINE, USED BY BOTH WAITS — `forge-8vfn.7.6.77`, the repeat half.
 *
 * The consequence wait had this inline, and the repeat needed the same rule. Two
 * copies of a budget-reset would be two places for the reset to be deleted, and
 * the mutation pass has already shown once tonight that deleting it leaves every
 * door green: without the reset `perTransition` is measured from the wait's
 * start, which is a shorter wall-clock bound wearing a progress bound's name.
 *
 * `observe` returns `null` to keep waiting, or the expiry TEXT when the budget
 * is spent. The caller decides what to do with it, because the two waits report
 * failure differently — one returns a stop object, the other an error string.
 *
 * A SECOND, INDEPENDENT PROGRESS SOURCE — T1 ruling 1545, S1 run 2. A repeat's
 * `progressKey` is one page's idea of progress; the session it stands on has
 * its own, truer one: a NEW LINE in that session's `events.jsonl`. Run 2 froze
 * at `session-phase: drafting` for 481s while the architect demonstrably
 * worked — a plan emitted, the completeness critic ran, a revision turn in
 * flight — because the page never re-rendered a phase change, even though the
 * session kept writing (gaps up to ~230s, never once past the declared 480s
 * bound). `eventLines`, when the caller supplies one, resets the SAME clock
 * `perTransition` already runs: growth is progress exactly as a key change is,
 * and 480s remains the NO-PROGRESS bound either way — nothing here raises it.
 *
 * `eventLines` defaults to `null`: every caller that does not pass one
 * (`waitForConsequence`'s consequence wait, and any repeat door that predates
 * this) is UNCHANGED — the growth branch below never fires, because `null`
 * can never be compared as a count. An absent/unreadable session log reads
 * the same way: `sessionEventLines` returns `null` for it, not a bare `0`
 * pretending to be fresh evidence, so it fails CLOSED to today's key-only
 * behaviour (§6.15) rather than inventing a reset from nothing.
 */
export function progressTracker(progress, wait, startedAt) {
  let lastValue;
  let lastSeenSource = 'absent';
  let lastSeenCarriers = 0;
  let firstSeenAt = null;
  let transitions = 0;
  let lastChangeAt = startedAt;
  // The FIRST reading is a baseline, never a transition: a session already 40
  // lines into a turn when this tracker was built is not "40 lines of fresh
  // progress" (the same rule `beats-cycle-progress.mjs` states for a write
  // that predates the wait's own start). Only GROWTH past that baseline resets
  // the clock.
  let lastEventLines = null;
  // WHAT LAST RESET THE CLOCK — kept apart from `transitions`, which counts
  // only KEY changes. A stall whose key sat frozen while its session wrote
  // forty lines and then stopped must say THAT, not "changed 0 time(s)" as
  // though nothing at all had moved (ruling 1545's own readability demand).
  let lastResetBy = { kind: 'never' };
  return {
    observe(read, eventLines = null, now = Date.now()) {
      let progressed = false;
      if (read.value !== undefined && read.value !== lastValue) {
        if (firstSeenAt === null) firstSeenAt = now;
        else transitions += 1;
        lastValue = read.value;
        lastSeenSource = read.source;
        lastSeenCarriers = read.carriers;
        lastResetBy = { kind: 'key' };
        progressed = true;
      }
      if (eventLines !== null) {
        if (lastEventLines !== null && eventLines > lastEventLines) {
          lastResetBy = { kind: 'events', grew: eventLines - lastEventLines, total: eventLines };
          progressed = true;
        }
        lastEventLines = eventLines;
      }
      if (progressed) {
        lastChangeAt = now;
        return null;
      }
      if (now - lastChangeAt < progress.perTransition) return null;
      return progressExpiry({
        key: progress.progressKey, perTransition: progress.perTransition, wait,
        source: read.source, carriers: read.carriers,
        firstSeenAt, transitions, lastValue, lastSeenSource, lastSeenCarriers,
        startedAt, lastChangeAt, now, lastResetBy,
      });
    },
  };
}

/** Where the key was last seen, in words a verdict can carry. */
const whereFrom = (source, carriers) =>
  source === 'root' ? 'the page root' : source === 'solo' ? 'one descendant element' : `${carriers} elements`;

/**
 * What last reset the clock, in words a stall message can carry — T1 ruling
 * 1545. A red must say WHICH kind of progress it is naming, a key change or
 * session-log growth, never blur the two into one "changed N time(s))" count
 * that only ever meant the key.
 */
const describeLastReset = (r) =>
  r.kind === 'events' ? `${r.grew} new events.jsonl line(s) (now ${r.total})`
    : r.kind === 'key' ? 'a key change'
      : 'nothing — the clock never reset';

/**
 * WHY the per-transition bound expired — one sentence per CAUSE, never one
 * sentence for two causes.
 *
 * Each prefix is a different instruction to the reader: check the story file /
 * check the page's markup / look at the agent. Collapsing any two of them sends
 * a reader to investigate the wrong thing, which is the cost this whole bead
 * exists to stop paying.
 */
export function progressExpiry(s) {
  // WHICH WAIT EXPIRED, on every prefix — M6-C's constraint, ratified by T1 (931).
  // A beat has two waits that can each expire on progress, and `stalled-no-
  // transition:` from either reads identically: the interview loop and the
  // post-approval wait become one message with two causes, which is the species
  // this bead exists to end. Cheap while there is one caller, expensive after
  // there are two — so it goes in with the second caller, not after it.
  const w = ` (${s.wait})`;
  const elapsed = Math.round((s.now - s.startedAt) / 1000);
  const still = Math.round((s.now - s.lastChangeAt) / 1000);
  // A READ THAT COULD NOT HAPPEN IS NOT A READING OF ABSENT (§15.504). The
  // repeat's reader throws when the page navigates under it — which a repeat
  // meets by design between rounds — and without this branch a beat whose page
  // never came back would report `stalled-no-transition`, whose text says the
  // key "renders and is still rendering". The budget still runs, so an
  // unreadable page expires rather than waiting forever; only the SENTENCE
  // changes, and it has to, because the two send a reader to different places.
  if (s.source === 'unreadable') {
    return (
      `progress-key-unreadable${w}: the page could not be read for \`${s.key}\` at the moment this bound ` +
      `expired, and it has been ${still}s since the last change. This is not a statement about the agent or ` +
      'about the key: the read itself failed, which happens when the page navigates under the reader. Look at ' +
      'what this beat is doing to the page before you look at either.'
    );
  }
  if (s.source === 'ambiguous') {
    return (
      `ambiguous-progress-key${w}: \`${s.key}\` is carried by ${s.carriers} elements at once, so there is no single ` +
      `value to watch and no transition can be measured — ${elapsed}s of a ${s.perTransition} ms per-transition ` +
      'bound spent unable to read it. This says NOTHING about the agent: picking one carrier would be a ' +
      'measurement of whichever element sorted first. Name a key exactly one element carries.'
    );
  }
  if (s.firstSeenAt === null) {
    return (
      `no-progress-key${w}: this beat declared \`perTransition: ${s.perTransition}\` against \`${s.key}\`, and that ` +
      `key was never present on the page — not on the root, not on any descendant, at any value, in ${elapsed}s ` +
      'of waiting. This is NOT a measurement of the agent: a key that never appears cannot stop changing. Either ' +
      'the beat names a key this page does not render, or this is not the page the beat thinks it is. Read it as ' +
      'a story-authoring gap until the key is shown to render.'
    );
  }
  if (s.source === 'absent') {
    return (
      `progress-key-vanished${w}: \`${s.key}\` appeared ${Math.round((s.firstSeenAt - s.startedAt) / 1000)}s into this ` +
      `wait on ${whereFrom(s.lastSeenSource, s.lastSeenCarriers)}, changed ${s.transitions} time(s), and then ` +
      `STOPPED BEING RENDERED — it has been gone for the last ${still}s, past the declared ${s.perTransition} ms ` +
      'bound. A page that unmounts the element is not an agent that stopped emitting: look at the markup this ' +
      'beat is standing on before you look at the agent.'
    );
  }
  return (
    `stalled-no-transition${w}: \`${s.key}\` first appeared ${Math.round((s.firstSeenAt - s.startedAt) / 1000)}s into ` +
    `this wait on ${whereFrom(s.source, s.carriers)} and changed ${s.transitions} time(s) after that; it has read ` +
    `${JSON.stringify(s.lastValue)} for the last ${still}s, past the declared ${s.perTransition} ms ` +
    'per-transition bound. The key renders and is still rendering, so this is the agent: it has stopped emitting ' +
    'transitions, and the beat stopped here rather than sitting out its ceiling. ' +
    `The clock's last reset was ${describeLastReset(s.lastResetBy ?? { kind: 'never' })}, ${still}s ago.`
  );
}
