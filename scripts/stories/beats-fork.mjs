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
 * @param {ReadonlyArray<object>} beats `story.beats`, already validated
 * @param {string|null} [groundProject] `story.ground.project`; omit (or pass
 *   `null`) for the ungrounded shape — every case of a fill fork substitutes
 *   nothing beyond `fork.over`'s own field, exactly as before this ruling.
 * @returns {ReadonlyArray<{beat: object, number: number, label: string, doorFork?: object}>}
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
    for (const c of beat.fork.cases) {
      const toProject = groundProject !== null ? `${groundProject}-${c}` : null;
      tailBeats.forEach((tailBeat, j) => {
        // Only the fork's OWN beat (j === 0) carries `fork.over`'s substitution
        // — a later remainder beat has no `fork` field to consult.
        const cased = j === 0 ? substituteForkCase(tailBeat, c) : tailBeat;
        const grounded = toProject !== null ? substituteGroundProject(cased, groundProject, toProject) : cased;
        out.push({ beat: grounded, number: number + j, label: `${number + j}[${c}]` });
      });
    }
    if (wholeRemainder) i += laterBeats.length; // already consumed above — never re-walked plainly
  }
  return out;
}
