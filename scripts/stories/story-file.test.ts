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
