/**
 * story-file.mjs — loading and validating a story.
 *
 * A story file is external input: authored with the operator in a separate
 * session (park point H6), by someone who is not reading this module. So it is
 * validated at the boundary, fails fast, and names the offending field with
 * its dotted path.
 *
 * Nothing is defaulted. A story that forgot to declare `budget_usd` is an
 * error, never a costless story — silently defaulting it is how an unapproved
 * real spawn reaches the SDK.
 */

const DOC_KINDS = ['tutorial', 'how-to'];

function fail(field, why) {
  throw new Error(`story is invalid — ${field}: ${why}`);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
}

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
      if ([isFill, isFillAll, isPress, isRepeat].filter(Boolean).length !== 1) {
        fail(where, `expected exactly one of {fill, with}, {fillAll, with}, {press} or {repeat}, got ${JSON.stringify(step)}`);
      }
      if (isRepeat) {
        if (!Array.isArray(step.repeat) || step.repeat.length === 0) {
          fail(`${where}.repeat`, `expected a non-empty array of steps, got ${JSON.stringify(step.repeat)}`);
        }
        if (step.repeat.some((inner) => inner !== null && typeof inner === 'object' && Object.hasOwn(inner, 'repeat'))) {
          fail(`${where}.repeat`, 'a repeat cannot nest another repeat');
        }
        return Object.freeze({ repeat: validateDoSteps(step.repeat, where) });
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

/**
 * Validate a raw story object and return a deep-frozen structural copy.
 * Never returns, and never mutates, the input.
 */
/** Wait kinds a beat may declare. `agent` is the only one so far, and adding
 *  a second is a deliberate edit here — the friction is the point. */
const WAIT_KINDS = ['agent'];

/** The widest bound a beat may declare, in ms. A declared wait is a licence to
 *  sit still; an unbounded or absurd one turns a red run into a hung host,
 *  which is worse than the defect it was added to fix. */
const MAX_DECLARED_WAIT_MS = 30 * 60 * 1000;

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
  return Object.freeze({ for: raw.for, upTo: raw.upTo });
}

export function validateStory(raw) {
  if (raw === null || typeof raw !== 'object') fail('story', 'expected an object');

  requireNonEmptyString(raw.id, 'id');
  // The id is interpolated into paths that are later removed recursively, and
  // it names the generated doc and demo dir. Validate its shape HERE, with the
  // field named, rather than letting the sweep's own guard abort the whole
  // batch from inside a loop that is not per-story.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.id) || raw.id.includes('..')) {
    fail('id', `expected a single path segment of [A-Za-z0-9._-], got ${JSON.stringify(raw.id)}`);
  }

  const g = raw.ground;
  if (g === null || typeof g !== 'object') fail('ground', 'expected an object');
  requireNonEmptyString(g.project, 'ground.project');
  if (typeof g.realSpawn !== 'boolean') {
    fail('ground.realSpawn', `expected a boolean, got ${JSON.stringify(g.realSpawn)}`);
  }
  if (typeof g.budget_usd !== 'number' || !Number.isFinite(g.budget_usd) || g.budget_usd < 0) {
    fail('ground.budget_usd', `expected a finite number >= 0, got ${JSON.stringify(g.budget_usd)}`);
  }

  const d = raw.docs;
  if (d === null || typeof d !== 'object') fail('docs', 'expected an object');
  if (!DOC_KINDS.includes(d.kind)) {
    fail('docs.kind', `expected one of ${DOC_KINDS.join(' | ')}, got ${JSON.stringify(d.kind)}`);
  }
  requireNonEmptyString(d.title, 'docs.title');

  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    fail('beats', 'expected a non-empty array');
  }

  const beats = raw.beats.map((b, i) => {
    const at = `beats[${i}]`;
    if (b === null || typeof b !== 'object') fail(at, 'expected an object');
    requireNonEmptyString(b.act, `${at}.act`);
    requireNonEmptyString(b.say, `${at}.say`);

    const e = b.expect;
    if (e === null || typeof e !== 'object') fail(`${at}.expect`, 'expected an object');
    if (typeof e.route !== 'string' || !e.route.startsWith('/')) {
      fail(`${at}.expect.route`, `expected a path-absolute route, got ${JSON.stringify(e.route)}`);
    }
    if (e.data === null || typeof e.data !== 'object' || Object.keys(e.data).length === 0) {
      // A beat asserting nothing can never be red. A story of such beats is
      // green by construction.
      fail(`${at}.expect.data`, 'expected at least one data-* expectation');
    }

    const wait = validateWait(b.wait, at);
    return Object.freeze({
      act: b.act,
      say: b.say,
      do: validateDoSteps(b.do, at),
      ...(wait === undefined ? {} : { wait }),
      expect: Object.freeze({ route: e.route, data: Object.freeze({ ...e.data }) }),
    });
  });

  return Object.freeze({
    id: raw.id,
    ground: Object.freeze({ project: g.project, realSpawn: g.realSpawn, budget_usd: g.budget_usd }),
    docs: Object.freeze({ kind: d.kind, title: d.title }),
    beats: Object.freeze(beats),
  });
}

/** Load a story module from disk and validate it. */
export async function loadStory(absPath) {
  const mod = await import(absPath);
  if (mod.default === undefined) {
    fail('story', `${absPath} has no default export`);
  }
  return validateStory(mod.default);
}

/**
 * Refuse a run that selected no story.
 *
 * A gate that executes nothing and exits 0 reports green having not looked —
 * the class this harness exists to close. `--costless-only` is the realistic
 * way to reach it: if every story declared a budget, CI would loop over an
 * empty set and pass.
 */
export function assertNonEmptySelection(stories, { costlessOnly = false } = {}) {
  if (stories.length > 0) return stories;
  const why = costlessOnly
    ? 'no story is costless — every one declares a real spawn or a budget, so --costless-only matched nothing'
    : 'no story files were found in tests/stories/';
  throw new Error(`refusing to report success: ${why}. A run that executes no story is not a passing run.`);
}
