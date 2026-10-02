/**
 * beats-fork.mjs — the `fork` verb (forge-8vfn.2.22, T1 ruling 1350): a beat
 * that runs once per CASE instead of once, or — for a DOOR fork — is declared
 * and carried through without running per case at all.
 *
 * TWO SHAPES, told apart by what `over` names in the beat's own `do`:
 *
 *   FILL FORK — `over` names a `fill` step (S2 beat 3: `over:
 *   'create-app-type'`). Every case runs, EACH ON ITS OWN GROUND: when the
 *   story's `ground.project` is `story-<id>`, case `c` runs against
 *   `story-<id>-<c>`, substituted wherever that beat, or a LATER one, names
 *   the base project — a `fill`'s `with`, an `expect.route` segment, an
 *   `expect.data` value — never as a partial-text replace (`substituteGroundProject`
 *   below matches a whole value, case-insensitively, never a substring).
 *
 *   If nothing after the fork beat mentions the project, only the fork beat
 *   itself is expanded — the shape this file always had. If something DOES
 *   (S2's beats 4-13 assert `project-id: 'story-s2'` and route
 *   `/projects/story-s2` — literal, since the story is pinned before it runs),
 *   those beats cannot be "made per-case" by leaving them alone: whichever
 *   case ran LAST is the only ground any of them would ever see. So the fork
 *   expands the WHOLE REMAINDER — the fork beat through the story's last beat
 *   — once per case, each fully substituted. `fillForkNeedsWholeRemainder`
 *   below is the read: it is decided from the STORY's own beats, not
 *   hardcoded to S2, so a future fill fork whose remainder is genuinely
 *   project-agnostic keeps today's narrower shape.
 *
 *   DOOR FORK — `over` names anything else (S7 beat 3: `over:
 *   'authoring-door'`, which no `fill` step fills). Declared and INERT: the
 *   beat runs ONCE, unexpanded, and `describeDoorFork` is the one line a
 *   reader sees saying so. This is what stops a fork over a field nothing
 *   fills from running every case identically and silently — the very hazard
 *   `story-file.mjs` used to refuse at load, now made structurally impossible
 *   instead: a door fork is never run more than once.
 *
 *   `fork.from` (forge-8vfn.8.5.14) — FILL FORK ONLY. A fork beat numbered
 *   above 1 is reached by the ENTRY BEATS before it (S2 beats 1-2: open the
 *   Projects pillar, press "new project"). Only the FIRST case walks those
 *   plainly, because the plain walk already ran them once before reaching the
 *   fork; every LATER case would otherwise land on whatever page the
 *   PREVIOUS case's last beat left behind — S2 run measured case 2 ("cli")
 *   starting on case 1's ("api") plan gate, `[data-field="create-name"]`
 *   absent, every later beat cascading red. `from: <beat number>` declares
 *   where the entry beats begin, and `expandForkedBeats` re-emits beats
 *   `from..forkBeat-1` before EVERY case after the first — unchanged beats,
 *   ground-substituted exactly like the remainder beats are, labelled
 *   `${n}[${case}]` under their own original numbers. `story-file.mjs`
 *   refuses a fill fork above beat 1 with no `from`, and refuses `from` on a
 *   door fork (it runs one case; nothing to replay).
 *
 * PER-CASE GROUND RESET remains this module's alone to provide. Nothing else
 * in this harness resets a ground BETWEEN cases (`sweepProductFixtures` runs
 * ONCE, at the end of the whole run), so a fill fork's own per-case naming is
 * what stops case 2 meeting case 1's leftover repo, not a cleanup step.
 */

/**
 * Whether `beat.fork` is a FILL fork: `over` names a `fill` step in this
 * beat's OWN `do`. False for a beat with no fork at all, and false for a DOOR
 * fork (`over` names something else — a press action, or nothing in `do`).
 */
export function isFillFork(beat) {
  return beat.fork !== undefined
    && (beat.do ?? []).some((step) => Object.hasOwn(step, 'fill') && step.fill === beat.fork.over);
}

/** Exact whole-value match, case-insensitively — never a substring of longer
 *  text. The operator types the pre-slug name (`'story-S2'`) and forge lower-
 *  cases it, so a `fill`'s `with` matches the project by VALUE, not by case. */
function isProjectValue(value, project) {
  return typeof value === 'string' && value.toLowerCase() === project.toLowerCase();
}

function withProject(value, fromProject, toProject) {
  return isProjectValue(value, fromProject) ? toProject : value;
}

/**
 * A copy of `beat` with every EXACT occurrence of `fromProject` — a whole
 * route segment, a whole `expect.data` value, or a whole `fill` step's `with`
 * — replaced by `toProject`. Never touches a partial match inside longer text
 * (a `press` label, an unrelated sentence a `fill` happens to carry): the
 * match is by construction (the field IS the project, case-insensitively),
 * never a text search. Input is never mutated.
 *
 * @param {Readonly<object>} beat an already-validated beat
 * @param {string} fromProject the story's declared `ground.project`
 * @param {string} toProject the per-case ground (`${fromProject}-${case}`)
 * @returns {Readonly<object>}
 */
export function substituteGroundProject(beat, fromProject, toProject) {
  const steps = (beat.do ?? []).map((step) =>
    Object.hasOwn(step, 'fill') ? { ...step, with: withProject(step.with, fromProject, toProject) } : step);
  const route = beat.expect.route
    .split('/')
    .map((segment) => withProject(segment, fromProject, toProject))
    .join('/');
  const data = Object.fromEntries(
    Object.entries(beat.expect.data).map(([k, v]) => [k, withProject(v, fromProject, toProject)]),
  );
  return Object.freeze({
    ...beat,
    do: Object.freeze(steps),
    expect: Object.freeze({ ...beat.expect, route, data: Object.freeze(data) }),
  });
}

/** Does `beat` name `project` anywhere `substituteGroundProject` would touch? */
function referencesProject(beat, project) {
  if (beat.expect.route.split('/').some((segment) => isProjectValue(segment, project))) return true;
  if (Object.values(beat.expect.data).some((v) => isProjectValue(v, project))) return true;
  return (beat.do ?? []).some((step) => Object.hasOwn(step, 'fill') && isProjectValue(step.with, project));
}

/**
 * Whether a fill fork's remainder — every beat AFTER the fork beat — must be
 * expanded whole, once per case, because at least one of them asserts on the
 * base project. Read from the story, never hardcoded to S2.
 */
export function fillForkNeedsWholeRemainder(laterBeats, groundProject) {
  return laterBeats.some((b) => referencesProject(b, groundProject));
}

/**
 * A copy of `beat` with the `do` step named by `beat.fork.over` having its
 * `with` replaced by `caseValue`, and `fork` itself dropped — the result
 * carries no trace of having been forked, so the driver that runs it needs no
 * awareness that it came from one.
 *
 * Every OTHER field survives untouched (`costless` included, so the two
 * features compose without either needing to know about the other), and the
 * input is never mutated: `beat.do` may be `Object.freeze`d by `validateStory`,
 * and this always returns a fresh array and a fresh object.
 *
 * @param {Readonly<object>} beat a beat carrying `fork: {over, cases}`
 * @param {string} caseValue one of `beat.fork.cases`
 * @returns {Readonly<object>}
 */
export function substituteForkCase(beat, caseValue) {
  const steps = (beat.do ?? []).map((step) =>
    (Object.hasOwn(step, 'fill') && step.fill === beat.fork.over) ? { ...step, with: caseValue } : step);
  const { fork, ...rest } = beat;
  return Object.freeze({ ...rest, do: Object.freeze(steps) });
}

/**
 * The one line a DOOR fork's beat prints, naming the field, every case, and
 * that it ran once rather than per case.
 */
export function describeDoorFork(fork) {
  return `fork declared, not driven: '${fork.over}' names no fill step in this beat's do — ` +
    `case(s) ${fork.cases.join(', ')} carried as declared, this beat ran once`;
}

/**
 * The frame filename's OWN suffix for a case's label ("3[api]" -> "-3-api"),
 * empty for a plain beat — moved out of `run-story.mjs` (the 800-line cap)
 * rather than left as an inline ternary the runner has to carry.
 * @param {string} beatLabel
 * @param {(s: string) => string} slug the runner's own slugifier, injected
 *   rather than duplicated
 */
export function frameLabelSuffix(beatLabel, slug) {
  return beatLabel.includes('[') ? `-${slug(beatLabel)}` : '';
}

/**
 * Flatten `story.beats` into the sequence the runner actually drives.
 *
 *   · an unforked beat — one entry, unchanged;
 *   · a DOOR fork — one entry, unchanged, carrying `doorFork` for the runner
 *     to report;
 *   · a FILL fork — one entry per case (`groundProject` absent or the
 *     remainder project-agnostic), or the WHOLE remainder once per case
 *     (`fillForkNeedsWholeRemainder`), each substituted onto its own ground.
 *
 * `number` is the ORIGINAL 1-indexed position in `story.beats`, shared by
 * every case of a fork (and, for a whole-remainder expansion, by every beat
 * of the remainder across cases): ground-licensing
 * (`ground.expectedChanges[].beat`, `run-story.mjs`'s `licensedBeatNumbers`)
 * is declared against that number, never against a flattened position, and a
 * licence captured once per NUMBER — at the first case to reach it — stays
 * "before anything in this beat can run" rather than being re-taken for every
 * later case.
 *
 * `label` is what a reader sees: `"3"` for an ordinary beat, `"3[api]"` for a
 * case — the shape the brief's own example names (`3` -> `3[typescript-api]`).
 *
 * `fork.from` (forge-8vfn.8.5.14): for every case AFTER THE FIRST, the beats
 * numbered `from..forkBeat-1` (the entry beats that reach the fork's own
 * page) are re-emitted, unchanged but ground-substituted, immediately before
 * that case's own fork-beat-and-remainder. The FIRST case never re-emits
 * them — the plain walk above already ran beats `1..forkBeat-1` once before
 * this loop reached the fork. Absent `fork.from` means nothing is replayed
 * (a fork on beat 1, where nothing precedes it).
 *
 * `caseStart`/`from` on the ENTRY (forge-8vfn.8.5.16, T1 ruling 1973bq, row
 * 180). The FIRST entry this call contributes for a case AFTER THE FIRST —
 * the first re-emitted entry beat, or (`fork.from` absent) the fork's own
 * beat — carries `caseStart: true` and `from` (`fork.from ?? number`): the
 * beat NUMBER a binding must have been made STRICTLY BEFORE to survive into
 * this case. This is the one signal the binding store (`clearForCase` below)
 * needs to clear a PREVIOUS case's own bindings before a later case's beats
 * run — MEASURED without it: S2 run case 2 ("cli") compared its own minted
 * `<architectSessionId>` against case 1's ("api"), because nothing told the
 * store that a fresh case had started.
 *
 * @param {ReadonlyArray<object>} beats `story.beats`, already validated
 * @param {string|null} [groundProject] `story.ground.project`; omit (or pass
 *   `null`) for the ungrounded shape — every case of a fill fork substitutes
 *   nothing beyond `fork.over`'s own field, exactly as before this ruling.
 * @returns {ReadonlyArray<{beat: object, number: number, label: string, doorFork?: object, caseStart?: true, from?: number}>}
 */
export function expandForkedBeats(beats, groundProject = null) {
  const out = [];
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    const number = i + 1;
    if (beat.fork === undefined) {
      out.push({ beat, number, label: String(number) });
      continue;
    }
    if (!isFillFork(beat)) {
      out.push({ beat, number, label: String(number), doorFork: beat.fork });
      continue;
    }
    const laterBeats = beats.slice(i + 1);
    const wholeRemainder = groundProject !== null && fillForkNeedsWholeRemainder(laterBeats, groundProject);
    const tailBeats = wholeRemainder ? [beat, ...laterBeats] : [beat];
    // `from` — the entry beats (`from..number-1`) that reach this fork's own
    // page. Re-emitted before every case AFTER THE FIRST (the plain walk
    // above already ran them once, for the first case, before this loop
    // reached the fork); absent means nothing precedes the fork (beat 1) or
    // the story's plain walk already covers it.
    const replayBeats = beat.fork.from !== undefined ? beats.slice(beat.fork.from - 1, i) : [];
    // The beat number a binding must predate to survive a later case's own
    // reset — the fork's declared `from`, or (nothing to replay) the fork's
    // own number, since beats before THAT ran only once regardless.
    const resetFrom = beat.fork.from ?? number;
    beat.fork.cases.forEach((c, caseIndex) => {
      const toProject = groundProject !== null ? `${groundProject}-${c}` : null;
      // The first case needs no reset — the plain walk above ran its earlier
      // beats once, for it, and nothing has run for any case yet. Every push
      // below for a LATER case marks exactly its first one `caseStart`.
      let caseStarted = caseIndex === 0;
      const caseMark = () => (caseStarted ? {} : { caseStart: true, from: resetFrom });
      if (caseIndex > 0) {
        replayBeats.forEach((replayBeat, k) => {
          const replayNumber = beat.fork.from + k;
          const grounded = toProject !== null
            ? substituteGroundProject(replayBeat, groundProject, toProject)
            : replayBeat;
          out.push({ beat: grounded, number: replayNumber, label: `${replayNumber}[${c}]`, ...caseMark() });
          caseStarted = true;
        });
      }
      tailBeats.forEach((tailBeat, j) => {
        // Only the fork's OWN beat (j === 0) carries `fork.over`'s substitution
        // — a later remainder beat has no `fork` field to consult.
        const cased = j === 0 ? substituteForkCase(tailBeat, c) : tailBeat;
        const grounded = toProject !== null ? substituteGroundProject(cased, groundProject, toProject) : cased;
        out.push({ beat: grounded, number: number + j, label: `${number + j}[${c}]`, ...caseMark() });
        caseStarted = true;
      });
    });
    if (wholeRemainder) i += laterBeats.length; // already consumed above — never re-walked plainly
  }
  return out;
}

/**
 * An empty per-case BINDING STORE — `{ values, boundAt }`. `values` is the
 * flat `{name: value}` map every caller already threads through as a beat's
 * `bindings`; `boundAt` carries the SAME keys mapped to the ORIGINAL beat
 * NUMBER (`expandForkedBeats`'s own, shared by every case of a fork) that
 * bound them — the one fact `clearForCase` below needs to decide "made at or
 * after `from`" when a later case starts.
 */
export function emptyBindingsStore() {
  return Object.freeze({ values: Object.freeze({}), boundAt: Object.freeze({}) });
}

/**
 * The store a beat should actually run against — forge-8vfn.8.5.16, T1
 * ruling 1973bq, the fix for row 180's measured leak. A no-op for every
 * entry but the one `expandForkedBeats` marks `caseStart` (the first entry
 * of a fork case AFTER THE FIRST): there, every binding made at or after
 * beat `entry.from` is dropped — it belongs to the PREVIOUS case, which ran
 * those same beat numbers on its own ground — and every binding made
 * STRICTLY BEFORE `entry.from` survives, because the beat that made it ran
 * exactly once, for every case alike (the plain walk, or an un-replayed
 * entry beat).
 *
 * MEASURED: S2's case 2 ("cli") inherited case 1's ("api")
 * `<architectSessionId>` binding and compared its OWN agent run's id against
 * it, reporting a mismatch between two different sessions as though one beat
 * had contradicted itself — "✗ 10[cli] … bound as <architectSessionId> by an
 * earlier beat … got …". Clearing here, before case 2's own beat 10 ever
 * runs, is what stops that: the placeholder is simply unbound again, exactly
 * as it was the first time case 1 reached it.
 *
 * @param {Readonly<{values: object, boundAt: object}>} store
 * @param {{caseStart?: true, from?: number}} entry one `expandForkedBeats` result
 * @returns {Readonly<{values: object, boundAt: object}>}
 */
export function clearForCase(store, entry) {
  if (!entry.caseStart) return store;
  const boundAt = Object.fromEntries(
    Object.entries(store.boundAt).filter(([, at]) => at < entry.from),
  );
  const values = Object.fromEntries(Object.keys(boundAt).map((name) => [name, store.values[name]]));
  return Object.freeze({ values: Object.freeze(values), boundAt: Object.freeze(boundAt) });
}

/**
 * Fold one beat's own verdict `bindings` into the store, against the beat's
 * ORIGINAL number (shared by every case) — so a LATER case's own
 * `clearForCase` can tell "a binding this run's CURRENT case made" from "a
 * binding made before the fork ever started replaying". A no-op when the
 * beat bound nothing, so a story with no fork at all pays nothing beyond an
 * unchanged `values` merge.
 *
 * @param {Readonly<{values: object, boundAt: object}>} store
 * @param {number} number the beat's ORIGINAL 1-indexed position
 * @param {Readonly<Record<string,string>>} verdictBindings a beat verdict's own `bindings`
 * @returns {Readonly<{values: object, boundAt: object}>}
 */
export function recordBindings(store, number, verdictBindings) {
  if (Object.keys(verdictBindings).length === 0) return store;
  const boundAt = { ...store.boundAt };
  for (const name of Object.keys(verdictBindings)) boundAt[name] = number;
  return Object.freeze({
    values: Object.freeze({ ...store.values, ...verdictBindings }),
    boundAt: Object.freeze(boundAt),
  });
}
