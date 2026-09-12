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
 */
export function progressTracker(progress, wait, startedAt) {
  let lastValue;
  let lastSeenSource = 'absent';
  let lastSeenCarriers = 0;
  let firstSeenAt = null;
  let transitions = 0;
  let lastChangeAt = startedAt;
  return {
    observe(read, now = Date.now()) {
      if (read.value !== undefined && read.value !== lastValue) {
        if (firstSeenAt === null) firstSeenAt = now;
        else transitions += 1;
        lastValue = read.value;
        lastSeenSource = read.source;
        lastSeenCarriers = read.carriers;
        lastChangeAt = now;
        return null;
      }
      if (now - lastChangeAt < progress.perTransition) return null;
      return progressExpiry({
        key: progress.progressKey, perTransition: progress.perTransition, wait,
        source: read.source, carriers: read.carriers,
        firstSeenAt, transitions, lastValue, lastSeenSource, lastSeenCarriers,
        startedAt, lastChangeAt, now,
      });
    },
  };
}

/** Where the key was last seen, in words a verdict can carry. */
const whereFrom = (source, carriers) =>
  source === 'root' ? 'the page root' : source === 'solo' ? 'one descendant element' : `${carriers} elements`;

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
    'transitions, and the beat stopped here rather than sitting out its ceiling.'
  );
}
