/**
 * story-file.test.ts — the story file contract.
 *
 * A story file is EXTERNAL INPUT to the runner: it is authored interactively
 * with the operator (park point H6) in a separate session, by someone who is
 * not looking at this validator. So it is validated at the boundary and fails
 * fast, with the offending field named — an operator who mistypes `docs.kind`
 * must be told which field, not handed a stack trace from three modules away.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, assertNonEmptySelection } from './story-file.mjs';

const ok = {
  id: 'smoke',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 'Find a project from Home' },
  beats: [
    {
      act: 'Open Studio on Home',
      expect: { route: '/', data: { 'page-ready': 'true' } },
      say: 'Studio opens on Home.',
    },
  ],
};

test('a well-formed story validates and comes back frozen', () => {
  const s = validateStory(ok);
  assert.equal(s.id, 'smoke');
  assert.equal(s.beats.length, 1);
  assert.ok(Object.isFrozen(s), 'a validated story is frozen so no later stage can edit the gate');
});

test('validateStory returns a copy and never mutates its input', () => {
  const input = structuredClone(ok);
  validateStory(input);
  assert.deepEqual(input, ok);
});

test('an unknown docs.kind is rejected, naming the field', () => {
  // Kills a validator that accepts any string: `kind` selects the output
  // directory (docs/tutorials vs docs/how-to), so an unknown value would
  // silently write the usage doc nowhere anyone reads.
  assert.throws(
    () => validateStory({ ...ok, docs: { kind: 'reference', title: 't' } }),
    /docs\.kind/,
  );
});

test('a beat with no data expectation is rejected, naming the beat index', () => {
  // Kills the vacuous beat: `expect.data` empty means the beat asserts
  // nothing about the page and can never be red. A story of such beats is
  // green by construction — a gate that reports green having not looked.
  assert.throws(
    () => validateStory({ ...ok, beats: [{ act: 'a', expect: { route: '/', data: {} }, say: 's' }] }),
    /beats\[0\]\.expect\.data/,
  );
});

test('a missing ground.budget_usd is rejected — the spend gate cannot default it', () => {
  // Kills `budget_usd ?? 0`. A story that forgot to declare its budget must
  // not be silently treated as costless; that is how an unapproved real spawn
  // reaches the SDK.
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: false } }),
    /ground\.budget_usd/,
  );
});

test('a negative budget is rejected', () => {
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: true, budget_usd: -1 } }),
    /ground\.budget_usd/,
  );
});

test('a non-boolean ground.realSpawn is rejected rather than coerced', () => {
  // Kills truthiness coercion: `realSpawn: 'false'` is a truthy string, and a
  // validator that coerces would turn a costless story into a spending one.
  assert.throws(
    () => validateStory({ ...ok, ground: { project: 'mdtoc', realSpawn: 'false', budget_usd: 0 } }),
    /ground\.realSpawn/,
  );
});

test('a route that is not path-absolute is rejected', () => {
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', expect: { route: 'projects', data: { x: '1' } }, say: 's' }],
    }),
    /beats\[0\]\.expect\.route/,
  );
});

test('an empty beats array is rejected', () => {
  assert.throws(() => validateStory({ ...ok, beats: [] }), /beats/);
});

test('a beat missing its narration is rejected — the doc fragment needs it', () => {
  // `say` is not decoration: it is the prose of the generated usage doc. A
  // beat without it produces a documentation step with no explanation.
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', expect: { route: '/', data: { x: '1' } } }],
    }),
    /beats\[0\]\.say/,
  );
});

test('a story id that is not a safe single path segment is rejected AT LOAD, naming the field', () => {
  // Found by adversarial review. `sweep.mjs` guards the id correctly, but it
  // does so from inside the leading-sweep loop, which is not per-story — so a
  // malformed id aborted the WHOLE batch with a sweep-level error instead of
  // being rejected here, with the field named, like every other bad field.
  for (const bad of ['a/b', '..', 'a b', '', '/abs', '.']) {
    assert.throws(() => validateStory({ ...ok, id: bad }), /\bid\b/, `id ${JSON.stringify(bad)} must be rejected`);
  }
});

test('ordinary story ids still validate', () => {
  for (const good of ['smoke', 'S1', 'S10', 'my-story', 'a_b.c']) {
    assert.equal(validateStory({ ...ok, id: good }).id, good);
  }
});

test('a selection that matched NO story is an error — a gate must not pass having run nothing', () => {
  // Found by reading the CI job's own log. `--costless-only` filters the set;
  // if every story declared a budget, the runner would loop over nothing and
  // exit 0 — CI green having executed no story at all. That is precisely the
  // class this whole harness exists to close (M0's merge gate returning
  // ok:true from a catch; M1-D's brain lint reporting 0 errors having skipped
  // Brain 3). An empty run is not a passing run.
  assert.throws(() => assertNonEmptySelection([], { costlessOnly: true }), /no story/i);
  assert.throws(() => assertNonEmptySelection([], {}), /no story/i);
});

test('the empty-selection error says WHICH filter emptied the set', () => {
  assert.throws(() => assertNonEmptySelection([], { costlessOnly: true }), /--costless-only/);
});

test('a non-empty selection passes through untouched', () => {
  const set = [validateStory(ok)];
  assert.equal(assertNonEmptySelection(set, {}), set);
});

// ── M1-F: the beat schema can express a form-driven flow (bead forge-8vfn.2.17)
//
// S1 ran `red — 0/10` with not one red beat a product gap: the runner had no
// way to say "fill these fields and press that button", so every beat after
// the registration form died on a nav path that only appears once the form is
// submitted. `do` is the ordered list of what the operator does.

const withDo = (steps) => ({
  ...ok,
  beats: [{ ...ok.beats[0], do: steps }],
});

test('a beat\'s do steps survive validation, in order', () => {
  // Kills the shipped validator, which built each beat from {act, say, expect}
  // and dropped every other field on the floor — silently, so a story that
  // declared a press ran as a story that pressed nothing.
  const s = validateStory(
    withDo([
      { fill: 'project-name', with: 'gitweave' },
      { press: 'toggle-onboard-advanced' },
      { fill: 'repo-path', with: 'projects/gitweave' },
      { press: 'onboard-project' },
    ]),
  );
  assert.deepEqual(s.beats[0].do, [
    { fill: 'project-name', with: 'gitweave' },
    { press: 'toggle-onboard-advanced' },
    { fill: 'repo-path', with: 'projects/gitweave' },
    { press: 'onboard-project' },
  ]);
});

test('a beat with no do at all still validates, and declares an empty step list', () => {
  // Every story authored before this lane omits `do`. They must keep working,
  // and downstream must not have to test for undefined.
  const s = validateStory(ok);
  assert.deepEqual(s.beats[0].do, []);
});

test('a do step that is neither a fill nor a press is rejected, naming its index', () => {
  assert.throws(
    () => validateStory(withDo([{ press: 'onboard-project' }, { scroll: 'down' }])),
    /beats\[0\]\.do\[1\]/,
  );
});

test('a fill step with no value is rejected rather than filling the field with undefined', () => {
  assert.throws(() => validateStory(withDo([{ fill: 'project-name' }])), /beats\[0\]\.do\[0\]\.with/);
});

test('a step that is BOTH a fill and a press is rejected — the order would be ambiguous', () => {
  // The whole reason `do` is an ordered array is that S1 beat 3 presses the
  // Advanced toggle BETWEEN two fills. A step that does two things reintroduces
  // exactly the ambiguity the array shape exists to remove.
  assert.throws(
    () => validateStory(withDo([{ fill: 'project-name', with: 'x', press: 'onboard-project' }])),
    /beats\[0\]\.do\[0\]/,
  );
});

test('do steps come back frozen, like the rest of the story', () => {
  const s = validateStory(withDo([{ press: 'onboard-project' }]));
  assert.ok(Array.isArray(s.beats[0].do), 'do must be an array before freezing means anything');
  assert.throws(() => {
    s.beats[0].do.push({ press: 'anything' });
  }, TypeError);
});

/* ------------------------------------------------------------------------ *
 * Bead `forge-8vfn.6.11.10` — a beat's declared agent-scale wait.
 *
 * The trap this file already knows: `validateStory` builds each beat from a
 * fixed field list, so an undeclared key is dropped SILENTLY. That is what
 * happens to `fork` today (S2 beat 3 says so in its own comment), and it is
 * what would happen to `wait` if it were only implemented in `beats.mjs` — the
 * story would declare an agent wait, the runner would never see it, and the
 * beat would red at fifteen seconds with no sign of why.
 * ------------------------------------------------------------------------ */

const withWait = (wait) => ({ ...ok, beats: [{ ...ok.beats[0], wait }] });

test('a beat\'s declared agent wait SURVIVES validation — it is not dropped like fork', () => {
  const s = validateStory(withWait({ for: 'agent', upTo: 600_000 }));
  assert.deepEqual(s.beats[0].wait, { for: 'agent', upTo: 600_000 });
});

test('a beat with no wait declares none — every story authored before this keeps working', () => {
  const s = validateStory(ok);
  assert.equal(s.beats[0].wait, undefined);
});

test('an unknown wait kind is REFUSED by name, never treated as the DOM default', () => {
  // Fail-closed: silently ignoring `for: 'agnet'` would give the beat the 15 s
  // bound it was declared to escape, and the run record would blame the
  // product. Same rule `parseContractStageStatus` states one package over.
  assert.throws(() => validateStory(withWait({ for: 'agnet', upTo: 600_000 })), /wait\.for/);
});

test('a wait with no upTo, a non-integer, or an out-of-range bound is REFUSED', () => {
  // A declared wait is a licence to sit still; an unbounded or absurd one
  // turns a red run into a hung host, which is worse than the defect.
  assert.throws(() => validateStory(withWait({ for: 'agent' })), /wait\.upTo/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: '600000' })), /wait\.upTo/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 0 })), /wait\.upTo/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 60 * 60 * 1000 })), /wait\.upTo/);
});

/**
 * 7.6.98 — the progress bound declared on the repeat STEP, where the progress is.
 *
 * It shipped on the beat's `wait` and that reached BOTH of a beat's waits, which
 * stand on different pages: S1 beat 11's repeat runs on the session page where
 * `session-phase` changes every round, its consequence wait on `/artifact`,
 * which renders that key zero times. The fix is not a better message — it is
 * declaring the bound where the loop's own `until` already names a key it can
 * see.
 */
test('7.6.98: a repeat carries its own progress bound, and it survives validation', () => {
  const story = validateStory({
    ...ok,
    beats: [{
      act: 'answer until the interview ends',
      do: [{
        repeat: [{ fillAll: 'question-freetext', with: 'a' }, { press: 'submit-answers' }],
        until: { 'session-phase': 'awaiting-verdict' },
        perTransition: 480_000,
        progressKey: 'session-phase',
      }],
      expect: { route: '/x', data: { page: 'x' } },
      say: 's',
    }],
  });
  assert.deepEqual(story.beats[0].do[0], {
    repeat: [{ fillAll: 'question-freetext', with: 'a' }, { press: 'submit-answers' }],
    until: { 'session-phase': 'awaiting-verdict' },
    perTransition: 480_000,
    progressKey: 'session-phase',
  });
});

test('7.6.98: `progressKey` MUST be a key `until` names — the binding is the fix', () => {
  // THE WHOLE POINT OF MOVING IT. A repeat's `until` already names a key the
  // loop can observe on the page it stands on; binding the progress key to that
  // set makes a key-on-the-wrong-page impossible by construction rather than by
  // a reviewer noticing. `session-phase` is exactly what `/artifact` does not
  // render, and that is how the first version went wrong.
  const bad = (progressKey: unknown) => () => validateStory({
    ...ok,
    beats: [{
      act: 'a',
      do: [{
        repeat: [{ press: 'submit-answers' }],
        until: { 'session-phase': 'awaiting-verdict' },
        perTransition: 1_000,
        progressKey,
      }],
      expect: { route: '/x', data: { page: 'x' } },
      say: 's',
    }],
  });
  assert.throws(bad('architect-phase'), /progressKey/, 'a key `until` does not name is refused');
  assert.throws(bad(''), /progressKey/);
  assert.throws(bad(7), /progressKey/);
});

test('7.6.98: both-or-neither on the step too', () => {
  const step = (extra: Record<string, unknown>) => () => validateStory({
    ...ok,
    beats: [{
      act: 'a',
      do: [{ repeat: [{ press: 'p' }], until: { k: 'v' }, ...extra }],
      expect: { route: '/x', data: { page: 'x' } },
      say: 's',
    }],
  });
  assert.throws(step({ perTransition: 1_000 }), /progressKey/);
  assert.throws(step({ progressKey: 'k' }), /perTransition/);
  assert.throws(step({ perTransition: 0, progressKey: 'k' }), /perTransition/);
});

/**
 * `perTransition` / `progressKey` — bead `forge-8vfn.7.6.77`, T1 ruling 881,
 * C's conditions 1 and 2.
 *
 * A wait may bound PROGRESS as well as wall-clock time: `perTransition` resets
 * every time `progressKey` changes, so expiry means "no transition" rather than
 * "no completion". These doors are about what the validator REFUSES, because
 * every refusal below describes a declaration that would read as protection and
 * provide none.
 */
test('7.6.77: a per-transition wait survives validation with BOTH its fields', () => {
  const s = validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 480_000, progressKey: 'architect-turns' }));
  assert.deepEqual(s.beats[0].wait, { for: 'agent', upTo: 600_000, perTransition: 480_000, progressKey: 'architect-turns' });
});

test('7.6.77 (C condition 1): `perTransition` and `progressKey` are BOTH or NEITHER', () => {
  // `progressKey` alone is a key nothing reads. `perTransition` alone is worse
  // than doing nothing: a budget nothing can ever reset is a SHORTER wall-clock
  // bound wearing a progress bound's name, so it reds EARLIER than today while
  // claiming to measure progress.
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 480_000 })),
    /wait\.progressKey/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, progressKey: 'architect-turns' })),
    /wait\.perTransition/);
});

test('7.6.77 (C condition 2): a per-transition bound ABOVE the ceiling is refused', () => {
  // It could never fire — `upTo` would always end the beat first — so the
  // declaration would read as protection and provide none. The equal case is
  // legal: it fires exactly once, at the ceiling.
  assert.throws(
    () => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 600_001, progressKey: 'k' })),
    /wait\.perTransition/,
  );
  // EQUALITY IS REFUSED TOO — C's read. After a transition at `t` the budget
  // would expire at `t + upTo`, past the ceiling; with no transition it expires
  // at exactly `upTo`, where the ceiling fires anyway. The only thing equality
  // buys is a better message in that one case, which is an accident of the
  // order the waiter checks its bounds in and not a bound.
  assert.throws(
    () => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 600_000, progressKey: 'k' })),
    /wait\.perTransition/,
  );
  assert.equal(
    validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 599_999, progressKey: 'k' })).beats[0].wait.perTransition,
    599_999,
  );
});

test('7.6.77: the bound must be a positive integer of ms, and the key a non-empty string', () => {
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: '480000', progressKey: 'k' })),
    /wait\.perTransition/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 0, progressKey: 'k' })),
    /wait\.perTransition/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 1_000, progressKey: '' })),
    /wait\.progressKey/);
  assert.throws(() => validateStory(withWait({ for: 'agent', upTo: 600_000, perTransition: 1_000, progressKey: 7 })),
    /wait\.progressKey/);
});

test('7.6.77: only an AGENT wait takes a per-transition bound', () => {
  // A settle wait stops on the first value that is not the one it is sitting
  // through; there are no transitions for a budget to reset on. Refused by name
  // rather than dropped, which is the rule `anchor` was broken by (7.6.82).
  assert.throws(
    () => validateStory(withWait({ for: 'settle', upTo: 10_000, key: 'preflight-status', while: 'pending', perTransition: 1_000, progressKey: 'k' })),
    /wait\.perTransition/,
  );
});

/**
 * `fillAll` — one step answers a WHOLE round (bead `forge-8vfn.6.11.21`,
 * T1 ruling 271).
 *
 * `ArchitectQuestionForm` requires EVERY question answered before Submit
 * enables (`data-questions-answered`), and the question COUNT is
 * model-determined — two in one measured architect turn, three in another. So a
 * fixed number of `fill` steps cannot answer a variable number of questions,
 * and one `data-field` value on N textareas trips playwright strict mode on the
 * first `fill`. The step is additive: `fill` is untouched.
 */
test('AT-6.11.21-5 (RED) a `fillAll` step is accepted and carried through validation', () => {
  const story = validateStory({
    ...ok,
    beats: [{
      act: 'Answer every question',
      do: [{ fillAll: 'question-freetext', with: 'The gate is npm test.' }, { press: 'submit-answers' }],
      expect: { route: '/sessions/architect/x', data: { page: 'session' } },
      say: 'The operator answers.',
    }],
  });
  assert.deepEqual(story.beats[0].do[0], { fillAll: 'question-freetext', with: 'The gate is npm test.' });
  assert.deepEqual(story.beats[0].do[1], { press: 'submit-answers' });
});

test('AT-6.11.21-6 `fillAll` demands its `with`, by name — never a silent default', () => {
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', do: [{ fillAll: 'question-freetext' }], expect: { route: '/x', data: { page: 'x' } }, say: 's' }],
    }),
    // Named as `.with`, not merely a message that happens to contain the word:
    // before `fillAll` existed this threw "expected exactly one of {fill, with}
    // …" for an unrelated reason and would have passed a loose matcher.
    /do\[0\]\.with/,
  );
});

test('AT-6.11.21-7 a step may not name BOTH fill and fillAll', () => {
  assert.throws(
    () => validateStory({
      ...ok,
      beats: [{ act: 'a', do: [{ fill: 'a', fillAll: 'b', with: 'v' }], expect: { route: '/x', data: { page: 'x' } }, say: 's' }],
    }),
    /exactly one/,
  );
});

// ── 536(ii): every `<placeholder>` must be bound by an EARLIER beat ─────────

/**
 * T1 ruling 536(ii), bought by S10 run 2.
 *
 * S10 declared `<runId>` in four routes and `<secondRunId>` in a fifth, and NO
 * beat bound either: a story binds a placeholder only by expecting `'<name>'`
 * as the value of a `data-*` key, and S10 did that twice, for neither of them.
 * Five beats could therefore never resolve their own route — and the way we
 * found out was a **funded $35 run** reporting `route
 * "/flows/forge-develop/run/<runId>" needs <runId>, which no earlier beat
 * bound`, at beat 11, after ten minutes of bounds had already been spent.
 *
 * The same story had already survived an unattended drafting pass and an
 * attended sitting. This is answerable at LOAD, for nothing, for every beat at
 * once — which is the difference between "author a story, buy a run, learn one
 * defect" and "author a story, learn every structural defect for free".
 */
const beat = (over = {}) => ({
  act: 'do a thing',
  say: 'a sentence about the thing.',
  expect: { route: '/projects/p', data: { page: 'projects' } },
  ...over,
});

// Built from `ok` above rather than hand-rolled: a helper that omits a required
// field fails every test in the block for a reason that has nothing to do with
// what the block is about, and reads exactly like the feature being broken.
const story = (beats: unknown[]) => ({ ...ok, beats });

test('536(ii) (RED) a route naming a placeholder no earlier beat binds is refused at load', () => {
  // S10's exact shape: the route names `<runId>` and nothing ever published it.
  assert.throws(
    () => validateStory(story([
      beat(),
      beat({ expect: { route: '/flows/forge-develop/run/<runId>', data: { page: 'flow-run' } } }),
    ])),
    (err: Error) => {
      assert.match(err.message, /beats\[1\]/, 'names WHICH beat');
      assert.match(err.message, /<runId>/, 'and WHICH placeholder');
      return true;
    },
  );
});

test('536(ii) (RED) the trap S10 fell into: a beat cannot bind the placeholder its OWN route needs', () => {
  // This is the shape that reads as correct and is not. The route is resolved
  // BEFORE the beat runs, so publishing `run-id` in the same beat's `data` is
  // too late — and it is exactly where an author would try to put it.
  assert.throws(
    () => validateStory(story([
      beat(),
      beat({
        expect: {
          route: '/flows/forge-develop/run/<runId>',
          data: { page: 'flow-run', 'run-id': '<runId>' },
        },
      }),
    ])),
    /<runId>/,
  );
});

test('536(ii) (positive control) `<name>` inside a `do` step\'s text is PROSE, not a placeholder', () => {
  // The ruling said "a route or a `do` step". The tree says otherwise, and the
  // tree wins: `<name>` is substituted in exactly ONE place — `resolveBeatRoute`,
  // over `expect.route`. A `with` value goes VERBATIM to `fill()`, so a `<name>`
  // there is literal text the operator types.
  //
  // MEASURED, on the first version of this check: it refused S10 on
  // `'Add an --exclude-author <pattern> flag: the inverse of --author…'` — CLI
  // syntax, which is the whole subject of that story. A rule that cannot tell a
  // placeholder from the documentation of a command-line flag would make this
  // domain unwritable.
  const loaded = validateStory(story([
    beat({ do: [{ fill: 'idea', with: 'Add an --exclude-author <pattern> flag, the inverse of --author.' }] }),
  ]));
  assert.equal(loaded.beats.length, 1);
});

test('536(ii) (positive control) a placeholder bound by an EARLIER beat loads', () => {
  // S10's `<architectSessionId>`, which works and must keep working: beat 1
  // publishes it, beat 2 routes on it.
  const loaded = validateStory(story([
    beat({ expect: { route: '/architect/new', data: { page: 'architect-new', 'architect-session-id': '<architectSessionId>' } } }),
    beat({ expect: { route: '/sessions/architect/<architectSessionId>', data: { page: 'session' } } }),
  ]));
  assert.equal(loaded.beats.length, 2);
});

test('536(ii) (positive control) a story with no placeholders at all is untouched', () => {
  const loaded = validateStory(story([beat(), beat()]));
  assert.equal(loaded.beats.length, 2);
});

/*
 * 7.6.136, and the door is deliberately NOT a list of field names.
 *
 * `validateStory` rebuilds `ground` from a fixed field list, so a field it
 * VALIDATES but does not NAME in the returned object is dropped silently —
 * which is precisely how `wait.anchor` reached production validated and
 * discarded (7.6.82), and how `ground.expectedChanges` behaved the first time
 * it was written here. Asserting "expectedChanges survives" would fix this one
 * field and leave the next exactly as reachable, so this deep-equals the WHOLE
 * declared ground against what came back.
 */
test('7.6.136: every field of a valid ground survives validateStory', () => {
  const ground = {
    project: 'p',
    realSpawn: false,
    budget_usd: 0,
    seedIgnoredBorn: ['node_modules/x'],
    expectedChanges: [{ path: 'forge/skills/x/SKILL.md', change: 'removed' }],
  };
  const v = validateStory({
    id: 'T', ground,
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{ act: 'a', expect: { route: '/x', data: { page: 'p' } }, say: 's' }],
  }) as { ground: unknown };
  assert.deepEqual(
    v.ground, ground,
    'validateStory rebuilds ground from a fixed field list, so a field it validates but does not name ' +
    'in the returned object is dropped SILENTLY — the 7.6.82 defect. Deep-equal rather than a per-field ' +
    'check: a list only protects the fields someone remembered to add to it.',
  );
});

/**
 * `forge-8vfn.7.6.140` — a declaration may narrow its licence to ONE beat's
 * window with `beat: <n>`, 1-indexed. Absent, it keeps 7.6.136's whole-run
 * meaning unchanged — a NARROWING a declaration can opt into, not a new
 * requirement on the ones that already exist.
 */
const twoBeats = [
  { act: 'a', expect: { route: '/x', data: { page: 'p' } }, say: 's' },
  { act: 'b', expect: { route: '/y', data: { page: 'p' } }, say: 's' },
];

test('7.6.140: a beat-scoped declaration survives validateStory (7.6.82-shaped door); one with no beat carries no key', () => {
  const ground = {
    project: 'p', realSpawn: false, budget_usd: 0,
    expectedChanges: [{ path: 'forge/skills/x/SKILL.md', change: 'removed', beat: 2 }],
  };
  const v = validateStory({ id: 'T', ground, docs: { kind: 'how-to' as const, title: 't' }, beats: twoBeats }) as { ground: unknown };
  assert.deepEqual(v.ground, ground, 'the beat field must survive the same fixed-field rebuild 7.6.82 caught once');

  const noBeat = { path: 'forge/skills/x/SKILL.md', change: 'removed' };
  const v2 = validateStory({
    id: 'T', ground: { ...ground, expectedChanges: [noBeat] },
    docs: { kind: 'how-to' as const, title: 't' }, beats: twoBeats,
  }) as { ground: { expectedChanges: Array<Record<string, unknown>> } };
  assert.equal(Object.hasOwn(v2.ground.expectedChanges[0]!, 'beat'), false, 'no beat key, not an explicit `beat: undefined`');
});

test('7.6.140: a non-integer, non-positive, or out-of-range beat is refused at load, naming the field', () => {
  const attempt = (beat: unknown, beats = twoBeats) => () => validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0, expectedChanges: [{ path: 'x', change: 'removed', beat }] },
    docs: { kind: 'how-to' as const, title: 't' },
    beats,
  });
  for (const bad of [0, -1, 1.5, 'two', null]) {
    assert.throws(attempt(bad), /expectedChanges\[0\]\.beat/, `beat=${JSON.stringify(bad)} must be refused`);
  }
  assert.throws(
    attempt(5, [twoBeats[0]!]),
    /beat 5 does not exist.*1 beat/,
    'a licence for a beat this story does not have would silently never open',
  );
});

/**
 * `forge-8vfn.7.6.143` (b1), T1 ruling 1147 — A DECLARED AGENT WAIT WITH NO
 * `do` BLOCK IS REFUSED AT VALIDATION, before selection and before spend.
 *
 * Measured on S10 run 20, which paid $4.3147 and twenty minutes to learn it.
 * Beat 11 declared `{for: 'agent', upTo: 1800000, terminal: 'ready-for-review',
 * anchor: 'start-development'}` and had NO `do` block. `agentWaitConsumed` is
 * set on exactly two paths: `beats-drive.mjs:258`, a handle wait inside
 * `performSteps`, which needs steps; and `:357`, the consequence wait, which
 * needs `routeMatches(page.url(), target)` — NOT steps.
 *
 * THE REFUSAL IS THEREFORE NARROWER THAN "an agent wait with no `do`", and the
 * first cut of this door got that wrong. A beat with no `do` that expects the
 * route it is ALREADY STANDING ON reaches `:357` and consumes its bound
 * perfectly well; refusing those would reject working beats in other lanes'
 * stories. What is decidable from the text is the combination: no `do` (so
 * nothing can navigate) AND an expected route that differs from where the
 * previous beat left the page (so `routeMatches` cannot be true). That is
 * exactly run 20 beat 11 — beat 10 ends on `/projects/gitpulse`, beat 11
 * expects `/flows/forge-develop/run/<runId>` and presses nothing.
 *
 * The runner already reds this shape — at the END, having asserted 0.4 s after
 * the press and cascaded fourteen later beats.
 *
 * A defect that is decidable from the story TEXT should not need a funded run
 * to surface. This is the same argument as the spend gate's: refuse at
 * selection, not after the browser opens.
 */
test('7.6.143: an agent wait on a beat with no `do` block is refused at validation', () => {
  assert.throws(
    () => validateStory({
      id: 'T',
      ground: { project: 'p', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [
        { act: 'press it', say: 's', do: [{ press: 'start-development' }],
          expect: { route: '/projects/gitpulse', data: { page: 'projects' } } },
        { act: 'watch the run build',
          say: 's',
          wait: { for: 'agent', upTo: 1_800_000 },
          expect: { route: '/flows/forge-develop/run/x', data: { page: 'flow-run' } } },
      ],
    }),
    /no `do`|cannot consume|never consume/i,
    'run 20 beat 11: no `do` so nothing navigates, and a target route the previous beat did not leave the ' +
    'page on, so routeMatches is false and the consequence wait never runs. Decidable from the story text, ' +
    'and it must never cost a funded run again.',
  );
});

/** The same beat WITH a `do` block still validates — the refusal is about the
 *  unconsumable shape, not about agent waits. A refusal that also rejected the
 *  working shape would simply move the cost. */
test('7.6.143: an agent wait WITH a `do` block still validates', () => {
  const v = validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{
      act: 'hand the plan to the build flow',
      say: 's',
      do: [{ press: 'start-development' }],
      wait: { for: 'agent', upTo: 1_800_000 },
      expect: { route: '/x', data: { page: 'p' } },
    }],
  }) as { beats: { wait?: unknown }[] };
  assert.deepEqual(v.beats[0].wait, { for: 'agent', upTo: 1_800_000 });
});

/**
 * THE OTHER HALF OF THE SAME DOOR, and the reason the refusal is a pair rather
 * than one rule: a beat with no `do` that expects the route it is ALREADY
 * standing on reaches the consequence wait at `beats-drive.mjs:357` and
 * consumes its bound. That is a working shape, it exists in other lanes'
 * stories, and an over-broad refusal would reject it. Without this test the
 * narrow rule and the broad one both pass.
 */
test('7.6.143: an agent wait with no `do` but the SAME route as the previous beat still validates', () => {
  const v = validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [
      { act: 'press it', say: 's', do: [{ press: 'start-development' }],
        expect: { route: '/projects/gitpulse', data: { page: 'projects' } } },
      { act: 'watch it settle', say: 's',
        wait: { for: 'agent', upTo: 1_800_000 },
        expect: { route: '/projects/gitpulse', data: { page: 'projects' } } },
    ],
  }) as { beats: { wait?: unknown }[] };
  assert.deepEqual(v.beats[1].wait, { for: 'agent', upTo: 1_800_000 });
});

/**
 * 7.6.143 — `cycleOf` SURVIVES the rebuild. This validator drops every key it
 * does not NAME in its returned object, which is how `wait.anchor` reached
 * production validated and discarded (7.6.82) and how `ground.expectedChanges`
 * behaved on its first write (7.6.136). A new wait field without this test is
 * the same defect queued up for a third time.
 */
test('7.6.143: wait.cycleOf survives validateStory', () => {
  const wait = { for: 'agent' as const, upTo: 1_800_000, terminal: 'ready-for-review', cycleOf: 'INIT-x' };
  const v = validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{ act: 'a', say: 's', do: [{ press: 'start-development' }], wait,
      expect: { route: '/x', data: { page: 'p' } } }],
  }) as { beats: { wait?: unknown }[] };
  assert.deepEqual(v.beats[0].wait, wait, 'validated-then-dropped is the 7.6.82 defect; deep-equal the whole wait');
});

/** `cycleOf` without `terminal` resolves a cycle and then has nothing to watch
 *  — refused rather than accepted as inert. */
test('7.6.143: wait.cycleOf without terminal is refused', () => {
  assert.throws(() => validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{ act: 'a', say: 's', do: [{ press: 'p' }],
      wait: { for: 'agent' as const, upTo: 1000, cycleOf: 'INIT-x' },
      expect: { route: '/x', data: { page: 'p' } } }],
  }), /cycleOf/);
});

/**
 * `forge-8vfn.7.6.147` (T1 ruling 1164) — A `cycleOf` PLACEHOLDER NO EARLIER
 * BEAT CAN BIND IS REFUSED AT VALIDATION.
 *
 * S10 run 21 paid $4.0917 for this. Beat 10 declared `cycleOf: '<runId>'`;
 * `runId` binds at beat 8's `expect.data` (`initiative-id: <runId>`), beat 8
 * reded on a PM stall, and `stuckVerdict` exports NO bindings on purpose — so
 * the placeholder never resolved, the watch silently fell back to the
 * born-after-the-anchor form, found nothing, and the beat reded claiming no
 * waiter consumed its bound.
 *
 * A story whose `cycleOf` names something NO earlier beat binds under ANY
 * outcome is decidable from the text, and that is what this refuses. It cannot
 * refuse the run-21 case itself — there beat 8 could have bound it and failed
 * to — which is why the beat-level refusal exists beside this one. Two
 * different questions: "this can never bind" and "this did not bind".
 */
test('7.6.147: a cycleOf placeholder no earlier beat binds is refused at validation', () => {
  assert.throws(
    () => validateStory({
      id: 'T',
      ground: { project: 'p', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [
        { act: 'a', say: 's', expect: { route: '/x', data: { page: 'p' } } },
        { act: 'press', say: 's', do: [{ press: 'start-development' }],
          wait: { for: 'agent' as const, upTo: 1000, terminal: 'ready-for-review', cycleOf: '<nobodyBinds>' },
          expect: { route: '/x', data: { page: 'p' } } },
      ],
    }),
    /nobodyBinds/,
    'no earlier beat binds <nobodyBinds>, so the beat could never resolve it under any outcome',
  );
});

/** And a placeholder an earlier beat DOES bind validates — the refusal is about
 *  the unbindable, not about placeholders. */
test('7.6.147: a cycleOf placeholder an earlier beat binds still validates', () => {
  const v = validateStory({
    id: 'T',
    ground: { project: 'p', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [
      { act: 'bind it', say: 's', expect: { route: '/x', data: { page: 'p', 'initiative-id': '<runId>' } } },
      { act: 'press', say: 's', do: [{ press: 'start-development' }],
        wait: { for: 'agent' as const, upTo: 1000, terminal: 'ready-for-review', cycleOf: '<runId>' },
        expect: { route: '/x', data: { page: 'p' } } },
    ],
  }) as { beats: { wait?: { cycleOf?: string } }[] };
  assert.equal(v.beats[1].wait?.cycleOf, '<runId>');
});

/**
 * M7-D — `ground.fixture` names a forge-owned FIXTURE ground provisioned from
 * `tests/stories/grounds/<fixture>/seed/`, rather than a real project under
 * `projects/`. §3.1's namespace rule carries over unchanged: the fixture can
 * only ever be provisioned into a project this story already owns —
 * `storyFixtureNames(storyId)` from `sweep.mjs` — so a story cannot be typo'd
 * into provisioning onto (and later sweeping) a real ground.
 *
 * `expectedChanges` and `seedIgnoredBorn` are both validated AND rebuilt into a
 * fixed field list in the returned `ground` (bead `forge-8vfn.7.6.82`'s own
 * lesson: a field validated and not named in the rebuild is dropped silently).
 * `fixture` needs the same two-part treatment: validated here, and carried
 * into the frozen object the runner actually reads.
 */
test('M7-D: a ground with a valid fixture validates, and the fixture rides in the frozen ground', () => {
  const v = validateStory({
    id: 'S8',
    ground: { project: 'story-s8', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 't' },
    beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
  });
  assert.deepEqual(v.ground, { project: 'story-s8', realSpawn: false, budget_usd: 0, fixture: 'node-library' });
});

test('M7-D: an unsafe ground.fixture name is rejected, naming the field', () => {
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'story-s8', fixture: 'Bad Name', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /ground\.fixture/,
  );
});

test('M7-D: a fixture ground whose project is outside the story\'s own sweep namespace is rejected, naming the namespace', () => {
  // `storyFixtureNames('S8')` is `story-S8` / `story-s8` — `mdtoc` is a REAL
  // project and must never be a valid target for a fixture provision.
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'mdtoc', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /ground\.fixture/,
  );
  assert.throws(
    () => validateStory({
      id: 'S8',
      ground: { project: 'mdtoc', fixture: 'node-library', realSpawn: false, budget_usd: 0 },
      docs: { kind: 'how-to' as const, title: 't' },
      beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
    }),
    /story-s8/,
    'the refusal must name the namespace the project should have been in',
  );
});
