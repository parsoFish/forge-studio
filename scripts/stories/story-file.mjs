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

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackedProjectIds } from './tracked-projects.mjs';
import { storyFixtureNames } from './sweep.mjs';
import { FIXTURE_NAME } from './fixture-ground.mjs';
import { fail, warn, requireNonEmptyString } from './story-schema-fail.mjs';
import {
  MAX_DECLARED_WAIT_MS,
  PROGRESS_KEY_SHAPE,
  validateDoSteps,
  validateWait,
} from './story-wait-schema.mjs';

/** Re-exported so this module's public surface survives the 7.6.149 split:
 *  `wait-bound.mjs` and three doors import these two from here by name. */
export { MAX_DECLARED_WAIT_MS, PROGRESS_KEY_SHAPE };

/** Re-derived here, not passed: this file sits in `scripts/stories/`, so the
 *  expression resolves to the same repo root every other module in this
 *  directory derives. One expression evaluated twice, not a constant with two
 *  possible values. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The selection rules a beat may name in `expect.among`. A CLOSED set, because
 *  an unknown rule must be refused at LOAD rather than silently selecting
 *  nothing at run time (`forge-8vfn.26`). */
const AMONG_RULES = ['tracked-projects'];

/** The three change kinds `groundChanges` reports; a declaration names one. */
const GROUND_CHANGE_KINDS = ['added', 'removed', 'modified'];

const DOC_KINDS = ['tutorial', 'how-to'];

/**
 * `expect.among` is `{ <data-key>: <rule> }` and nothing else. Pure: the shape
 * is checked here, the set is resolved by `loadStory` (`forge-8vfn.26`).
 */
function validateAmong(among, data, at) {
  if (among === undefined) return undefined;
  if (among === null || typeof among !== 'object' || Array.isArray(among)) {
    fail(`${at}.expect.among`, 'expected an object of { data-key: rule }');
  }
  const entries = Object.entries(among);
  if (entries.length === 0) fail(`${at}.expect.among`, 'expected at least one { data-key: rule }');
  for (const [key, rule] of entries) {
    if (!Object.hasOwn(data, key)) {
      fail(
        `${at}.expect.among.${key}`,
        `restricts a key this beat does not expect. The restriction would apply to nothing; `
          + `expected one of ${Object.keys(data).join(', ')}`,
      );
    }
    if (typeof rule !== 'string' || !AMONG_RULES.includes(rule)) {
      fail(
        `${at}.expect.among.${key}`,
        `unknown rule ${JSON.stringify(rule)} — expected one of ${AMONG_RULES.join(', ')}. `
          + 'Refused at load: an unknown rule would select no element and the beat would red as '
          + 'though the product had rendered nothing.',
      );
    }
  }
  return Object.freeze({ ...among });
}

/**
 * Validate a raw story object and return a deep-frozen structural copy.
 * Never returns, and never mutates, the input.
 */
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
  // 7.6.52 — paths the RUNNER creates in the ground after the pre-run hash, so
  // the ignore classification renders against a non-empty case without waiting
  // for an agent to choose to run a toolchain. Relative, no traversal; whether
  // the ground actually ignores them is `seedIgnoredBorn`'s refusal, not this
  // one's — validation here would need the ground on disk, which is a different
  // moment and a different failure.
  if (g.seedIgnoredBorn !== undefined) {
    if (!Array.isArray(g.seedIgnoredBorn) || g.seedIgnoredBorn.length === 0) {
      fail('ground.seedIgnoredBorn', `expected a non-empty array of relative paths, got ${JSON.stringify(g.seedIgnoredBorn)}`);
    }
    for (const [i, rel] of g.seedIgnoredBorn.entries()) {
      requireNonEmptyString(rel, `ground.seedIgnoredBorn[${i}]`);
      if (rel.startsWith('/') || rel.split('/').includes('..')) {
        fail(`ground.seedIgnoredBorn[${i}]`, `expected a relative path inside the ground, got ${JSON.stringify(rel)}`);
      }
    }
  }

  // M7-D — `ground.fixture` names a forge-owned FIXTURE ground provisioned
  // from `tests/stories/grounds/<fixture>/seed/`, rather than a real project
  // under `projects/`. Validated here on TWO counts, both namespace guards:
  // the name itself must be a safe single path segment (`FIXTURE_NAME`, the
  // same shape `fixture-ground.mjs` refuses on at provisioning time — this
  // check exists so a bad name is caught at LOAD rather than after a costed
  // run has booted a browser), and `ground.project` must be inside this
  // story's own reserved sweep namespace (`storyFixtureNames`) — the guard
  // that keeps a typo'd project from ever being provisioned over, or later
  // swept as though it were this story's own fixture.
  if (g.fixture !== undefined) {
    requireNonEmptyString(g.fixture, 'ground.fixture');
    if (!FIXTURE_NAME.test(g.fixture)) {
      fail('ground.fixture', `expected a safe fixture name matching ${FIXTURE_NAME}, got ${JSON.stringify(g.fixture)}`);
    }
    const names = storyFixtureNames(raw.id);
    if (!names.includes(g.project)) {
      fail(
        'ground.fixture',
        `declares project ${JSON.stringify(g.project)}, which is not in this story's own fixture namespace ` +
        `(${names.join(', ')}) — a fixture ground can only ever be provisioned into a project this story already owns`,
      );
    }
  }

  // 7.6.136 — the ground changes this story's PRODUCT legitimately makes.
  // Declared in the PINNED story file so the licence cannot widen at runtime,
  // and validated like `seedIgnoredBorn` above, which is the established shape
  // for "paths a story declares about its own ground".
  //
  // `path` and `change` are SEPARATE FIELDS. A `"R forge/skills/x"` string
  // would carry the kind and the path in one value — two frames in one field,
  // the defect caught on review of 7.6.120 and again in 7.6.127.
  if (g.expectedChanges !== undefined) {
    if (!Array.isArray(g.expectedChanges) || g.expectedChanges.length === 0) {
      fail('ground.expectedChanges', `expected a non-empty array of {path, change}, got ${JSON.stringify(g.expectedChanges)}`);
    }
    for (const [i, e] of g.expectedChanges.entries()) {
      if (e === null || typeof e !== 'object' || Array.isArray(e)) {
        fail(`ground.expectedChanges[${i}]`, `expected an object {path, change}, got ${JSON.stringify(e)}`);
      }
      requireNonEmptyString(e.path, `ground.expectedChanges[${i}].path`);
      if (e.path.startsWith('/') || e.path.split('/').includes('..')) {
        fail(`ground.expectedChanges[${i}].path`, `expected a relative path inside the ground, got ${JSON.stringify(e.path)}`);
      }
      if (!GROUND_CHANGE_KINDS.includes(e.change)) {
        fail(`ground.expectedChanges[${i}].change`, `expected one of ${GROUND_CHANGE_KINDS.join(', ')}, got ${JSON.stringify(e.change)}`);
      }
      // `forge-8vfn.7.6.140` — a declaration may narrow its own licence to ONE
      // beat's window, 1-indexed to match how every other comment in this
      // campaign counts beats ("beat 5 presses it"). ABSENT keeps today's
      // whole-run meaning: the existing contract, not a fallback — the fence
      // (`ground-hash.mjs`) licenses an undated declaration against the whole
      // run exactly as it always has.
      if (e.beat !== undefined && (!Number.isInteger(e.beat) || e.beat < 1)) {
        fail(`ground.expectedChanges[${i}].beat`, `expected a positive integer beat number, got ${JSON.stringify(e.beat)}`);
      }
    }
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

  // A `beat` number is only checkable for RANGE once the beats array itself is
  // known to be valid — the type check above runs before this point because
  // `g.expectedChanges` is validated ahead of `raw.beats`. Refused at load, the
  // same reason every other closed-set field here is: a declaration naming a
  // beat that does not exist would silently open a licence for a window that
  // can never occur.
  for (const [i, e] of (g.expectedChanges ?? []).entries()) {
    if (e.beat !== undefined && e.beat > raw.beats.length) {
      fail(
        `ground.expectedChanges[${i}].beat`,
        `beat ${e.beat} does not exist — this story has ${raw.beats.length} beat(s)`,
      );
    }
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

    // `expect.among` — the beat states a RULE for WHICH element may answer a
    // key, and `loadStory` resolves it to a set (`forge-8vfn.26`). Validated
    // here and resolved there, because this function is pure and the rule is a
    // question for git.
    //
    // REFUSED AT LOAD ON THREE COUNTS, each of which would otherwise surface as
    // a beat failure blaming the product: a rule that is not in the closed set
    // (a typo selects nothing and the beat reds as "no such card"), a key the
    // beat does not actually expect (the restriction would apply to nothing),
    // and a non-string rule.
    const among = validateAmong(e.among, e.data, at);

    const wait = validateWait(b.wait, at);
    const steps = validateDoSteps(b.do, at);
    // `forge-8vfn.7.6.143` (b1), T1 ruling 1147 — AN AGENT WAIT THAT NO CODE
    // PATH CAN CONSUME IS REFUSED HERE, before selection and before spend.
    //
    // S10 run 20 paid $4.3147 and twenty minutes to surface this. Its beat 11
    // declared a 30-minute agent wait, pressed nothing, and expected a route
    // the previous beat had not left the page on — so it asserted 0.4 s after
    // the press, reded, and cascaded fourteen later beats.
    //
    // `agentWaitConsumed` is set on exactly two paths: a handle wait inside
    // `performSteps` (`beats-drive.mjs:258`), which needs STEPS, and the
    // consequence wait (`:357`), which needs `routeMatches(page.url(), target)`
    // — NOT steps. So the unconsumable shape is the CONJUNCTION, and this
    // refusal is deliberately narrower than "an agent wait with no `do`": a
    // beat that presses nothing but expects the route it is already standing on
    // reaches `:357` and consumes its bound perfectly well. That shape exists in
    // other lanes' stories and refusing it would reject working beats.
    //
    // The first beat is exempt: with no previous beat there is no declared
    // route to compare against, so the shape cannot be shown unreachable, and a
    // refusal that cannot prove its case is a guess.
    // `forge-8vfn.7.6.147` (T1 1164) — a `cycleOf` placeholder NO EARLIER BEAT
    // CAN BIND, which S10 run 21 paid $4.0917 to find at run time. A beat binds
    // a `<name>` by expecting it as an `expect.data` value (`beats.mjs:86`), so
    // "can this ever bind" is decidable here. Whether the beat that COULD bind it
    // actually does is not — run 21's beat 8 reded on a stall first, and
    // `stuckVerdict` exports no bindings on purpose — so that case is refused at
    // the BEAT. Two questions, two places: "can never bind" and "did not bind".
    if (typeof wait?.cycleOf === 'string') {
      for (const [, name] of wait.cycleOf.matchAll(/<([A-Za-z][A-Za-z0-9_]*)>/g)) {
        const boundEarlier = raw.beats.slice(0, i).some((b2) =>
          Object.values(b2?.expect?.data ?? {}).some((v) => v === `<${name}>`));
        if (!boundEarlier) {
          fail(
            `${at}.wait.cycleOf`,
            `names <${name}>, which NO earlier beat binds — a beat binds a placeholder by expecting it ` +
            `as an \`expect.data\` value, and nothing before this beat does. The watch would resolve no ` +
            `cycle and silently fall back to the born-after-the-anchor form, which for a CONTINUED cycle ` +
            `finds nothing (S10 run 21, $4.0917). Bind <${name}> in an earlier beat's \`expect.data\`, or ` +
            `name the initiative literally.`,
          );
        }
      }
    }
    if (wait?.for === 'agent' && steps.length === 0 && i > 0) {
      const prev = raw.beats[i - 1]?.expect?.route;
      const here = e.route;
      if (typeof prev === 'string' && typeof here === 'string' && prev !== here) {
        fail(
          `${at}.wait`,
          `declares an agent wait this beat can never consume: it presses nothing (no \`do\`), so nothing ` +
          `navigates, and it expects '${here}' while the previous beat leaves the page on '${prev}' — so ` +
          `\`routeMatches\` is false and the consequence wait never runs. The bound would bound nothing and ` +
          `every later verdict about it would be a lie (S10 run 20 beat 11, $4.3147 to learn it). Give the ` +
          `beat a \`do\` block that reaches '${here}', or expect the route the previous beat ends on.`,
        );
      }
    }
    return Object.freeze({
      act: b.act,
      say: b.say,
      do: steps,
      ...(wait === undefined ? {} : { wait }),
      expect: Object.freeze({
        route: e.route,
        data: Object.freeze({ ...e.data }),
        ...(among === undefined ? {} : { among }),
      }),
    });
  });

  // ── EVERY `<placeholder>` MUST BE BOUND BY AN EARLIER BEAT ────────────────
  //
  // T1 ruling 536(ii), narrowed to routes — see below. S10 declared `<runId>`
  // in four routes and `<secondRunId>`
  // in a fifth, and NO beat bound either — the story binds a placeholder only by
  // expecting `'<name>'` as the value of a `data-*` key, and S10 did that twice,
  // for neither of them. So five beats could never resolve their own route, and
  // the way we found out was a funded $35 run reporting
  // `route "/flows/forge-develop/run/<runId>" needs <runId>, which no earlier
  // beat bound` — at beat 11, after ten minutes had already been spent.
  //
  // It is answerable at LOAD, for nothing, and it is answerable for the whole
  // story at once rather than one beat per run. `driveBeat` already refuses an
  // unbound placeholder at run time and that check stays: this one exists so a
  // story with an unresolvable beat never reaches a bridge, a browser or a
  // budget.
  //
  // EARLIER, strictly. A beat's route is resolved BEFORE the beat runs, so a
  // beat cannot bind the placeholder its own route needs — which is exactly the
  // trap S10 fell into by naming `<runId>` on the very beats that would have
  // published it. Bindings are therefore collected AFTER each beat is checked,
  // never before.
  //
  // ROUTES ONLY, and that is a correction to the ruling's own wording, made
  // from the tree. `<name>` is substituted in exactly ONE place — `beats.mjs`'s
  // `resolveBeatRoute`, over `beat.expect.route`. A `do` step's `with` value is
  // passed VERBATIM to `fill()` (`beats-drive.mjs:586,606`); nothing ever
  // substitutes into it. So `<name>` inside a `with` is literal text the
  // operator types, and scanning it is a false positive — the first version of
  // this check refused S10 on
  // `'Add an --exclude-author <pattern> flag: the inverse of --author…'`, which
  // is not a placeholder at all but the CLI syntax the story is about. A repeat's
  // `until` is the same: `answers()` treats `<name>` there as "any non-empty
  // value", a wildcard, never a reference to an earlier binding.
  const boundNames = new Set();
  const namesIn = (text) => [...String(text).matchAll(/<([A-Za-z][A-Za-z0-9_]*)>/g)].map((m) => m[1]);

  beats.forEach((b, i) => {
    const needed = namesIn(b.expect.route);
    for (const name of needed) {
      if (!boundNames.has(name)) {
        fail(
          `beats[${i}]`,
          `route names <${name}>, which no EARLIER beat binds. A beat binds a segment by expecting ` +
            `'<${name}>' as the value of a data-* key; a beat cannot bind the placeholder its own ` +
            'route needs, because the route is resolved before the beat runs. Either bind it on an ' +
            'earlier beat, or name the surface that publishes it.',
        );
      }
    }
    // 7.6.54 (ruling 795), DUTY 1 — a `pressBound` whose `bind` no EARLIER beat
    // declares is refused at LOAD, not discovered at run time. An unresolved
    // bind would press a half-built handle, match nothing, and red as "no such
    // control" — which reads as a product defect and is why the shape was
    // parked rather than built. `forge-8vfn.6.11.51` adds `pressWithin`'s
    // `scope.bind` to the same duty: an unresolved scope would press against
    // every element sharing the action, not the one instance-id names.
    const pressBindsIn = (steps) => (steps ?? []).flatMap((st) =>
      Object.hasOwn(st, 'pressBound') ? [{ form: 'pressBound', bind: st.pressBound.bind }]
        : Object.hasOwn(st, 'pressWithin') ? [{ form: 'pressWithin', bind: st.pressWithin.scope.bind }]
          : Object.hasOwn(st, 'repeat') ? pressBindsIn(st.repeat) : []);
    for (const { form, bind } of pressBindsIn(b.do)) {
      if (!boundNames.has(bind)) {
        fail(
          `beats[${i}]`,
          `${form} names <${bind}>, which no EARLIER beat binds. The handle is built at run time from ` +
            'that binding, so a beat cannot press one its own expectations would publish.',
        );
      }
    }
    // DUTY 2 — a literal `press` carrying <name> that matches a DECLARED
    // binding is almost certainly the parked mistake: it would resolve the
    // literal string, match nothing, and blame the product. Warn and name the
    // form that does work. Only declared names warn, so `--exclude-author
    // <pattern>` in a `with` stays untouched, which is the property this
    // validator already protects.
    const pressTextsIn = (steps) => (steps ?? []).flatMap((st) =>
      Object.hasOwn(st, 'press') ? [st.press]
        : Object.hasOwn(st, 'repeat') ? pressTextsIn(st.repeat) : []);
    for (const text of pressTextsIn(b.do)) {
      for (const name of namesIn(text)) {
        if (boundNames.has(name)) {
          warn(
            `beats[${i}].do`,
            `press '${text}' contains <${name}>, which IS a declared binding — but a press is never ` +
              `substituted (routes only). It would resolve the literal string and match no element. ` +
              `Use pressBound: { action: '${text.split('<')[0]}', bind: '${name}' }.`,
          );
        }
      }
    }
    // Only NOW does this beat's own binding become available to later beats.
    for (const want of Object.values(b.expect.data)) {
      const m = /^<([A-Za-z][A-Za-z0-9_]*)>$/.exec(String(want));
      if (m !== null) boundNames.add(m[1]);
    }
  });

  return Object.freeze({
    id: raw.id,
    ground: Object.freeze({
      project: g.project, realSpawn: g.realSpawn, budget_usd: g.budget_usd,
      ...(g.seedIgnoredBorn ? { seedIgnoredBorn: Object.freeze([...g.seedIgnoredBorn]) } : {}),
      // 7.6.136. Named HERE as well as validated above, because this function
      // rebuilds `ground` from a fixed field list: a field validated and not
      // named here is dropped SILENTLY, which is exactly how `anchor` reached
      // production validated-and-discarded (7.6.82). The door below deep-equals
      // the whole ground so the next field cannot repeat it.
      ...(g.expectedChanges
        ? {
            expectedChanges: Object.freeze(g.expectedChanges.map((e) =>
              Object.freeze(e.beat === undefined ? { path: e.path, change: e.change } : { path: e.path, change: e.change, beat: e.beat }))),
          }
        : {}),
      // M7-D — named here too, for the same 7.6.82 reason: `fixture` is
      // validated above and must ride in the frozen ground the runner reads,
      // or the story would validate and then silently run against a real
      // ground project with no fixture ever provisioned.
      ...(g.fixture !== undefined ? { fixture: g.fixture } : {}),
    }),
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
  return resolveAmong(validateStory(mod.default));
}

/**
 * Turn every `expect.among` RULE into the set it names, at LOAD (`forge-8vfn.26`).
 *
 * The question is asked of git ONCE, here, for the same reason every other
 * refusal in this file happens at load: a rule that cannot be resolved must stop
 * the run with its own name on it, not reach a beat and red as "the product
 * rendered no such card". `validateStory` stays PURE — it checks the shape; this
 * does the IO — and the story is rebuilt rather than mutated.
 */
function resolveAmong(story) {
  const resolvers = { 'tracked-projects': () => trackedProjectIds(ROOT) };
  const cache = {};
  const resolve = (rule) => (cache[rule] ??= resolvers[rule]());
  return Object.freeze({
    ...story,
    beats: story.beats.map((b) => {
      const among = b.expect?.among;
      if (among === undefined) return b;
      return Object.freeze({
        ...b,
        expect: Object.freeze({
          ...b.expect,
          amongIds: Object.freeze(
            Object.fromEntries(Object.entries(among).map(([k, rule]) => [k, Object.freeze(resolve(rule))])),
          ),
        }),
      });
    }),
  });
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
