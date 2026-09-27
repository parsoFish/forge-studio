/**
 * beats-press-first-each.test.ts — `{ pressFirstEach: '<data-attr>', within:
 * '<data-attr>' }` (bead `forge-8vfn.8.1.34`, ruling 1736): for every element
 * carrying `within`, press the FIRST descendant carrying `pressFirstEach` —
 * never every match, and never `.first()` of the whole page.
 *
 * WHY IT EXISTS. Row 141's S10 beat 21 ("Reflect on the cycle") pressed
 * `submit-reflection` while it was rendered DISABLED — `ReflectionGate.tsx`
 * (apps/studio) gates it on every question having a recorded choice, and the
 * reflector decides how many questions there are, and how many carry options,
 * model-determined (exactly `fillAll`'s reason for existing). Each option
 * renders `data-option-label` as a RADIO INPUT (`type="radio"
 * name="rq-${i}"`, `ReflectionGate.tsx:236,249-253`) grouped one
 * `data-question-index` fieldset PER QUESTION — so a bare `press` (`.first()`
 * of the whole page) only ever answers question 0, and a BULK press of every
 * `data-option-label` on the page would click every radio in every group,
 * leaving the LAST one checked in each — the opposite of "answer every
 * question", since a radio group keeps only its most recent click.
 * `pressFirstEach` presses exactly the first option INSIDE each question's own
 * fieldset, which is what actually answers it.
 *
 * (A prior draft of this fix shipped `{ pressAll: '<data-attr>' }` — click
 * every match, unscoped — before this defect was caught in review. It has
 * been fully replaced, including its schema and tests: this file used to be
 * `beats-press-all.test.ts`.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { performStepsForTest } from './beats-steps.mjs';
import { validateStory } from './story-file.mjs';

// ── execution: beats-steps.mjs ──────────────────────────────────────────────

const CONTAINER_SEL = '[data-question-index]';
const TARGET_SEL = '[data-option-label]';

/** A NO-OP locator for any selector this fake does not model — always
 *  present (never a missing method), so a call that should not happen fails
 *  an ASSERTION on its recorded effect, not a bare TypeError. */
function deadLocator() {
  return {
    count: async () => 0,
    first: () => deadLocator(),
    nth: () => deadLocator(),
    locator: () => deadLocator(),
    evaluate: async () => { throw new Error('deadLocator: not modelled'); },
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    click: async () => { throw new Error('deadLocator: click on an unmodelled element'); },
  };
}

/**
 * `optionCounts[i]` = how many radio options question `i` renders (`0` for a
 * freeform-only question, which carries no `data-option-label` at all). Real
 * DOM semantics: `.first()` always targets document-order index 0, regardless
 * of any other option's state — so clicking it twice, or clicking a LATER
 * option first, must never change which index this fake marks selected.
 */
function radioQuestionsPage(optionCounts: number[]) {
  const selected: boolean[][] = optionCounts.map((c) => new Array(c).fill(false));

  function targetLocator(qIndex: number) {
    const opts = selected[qIndex];
    return {
      count: async () => opts.length,
      first: () => ({
        // Real Playwright: `.first()` still answers `.count()` — 1 if the
        // unnarrowed selector had a match, 0 if it had none.
        count: async () => (opts.length > 0 ? 1 : 0),
        click: async () => { opts[0] = true; },
      }),
    };
  }

  function containerLocator(qIndex: number) {
    return {
      locator: (sel: string) => (sel === TARGET_SEL ? targetLocator(qIndex) : deadLocator()),
      first: () => deadLocator(),
      evaluate: async () => { throw new Error('deadLocator: not modelled'); },
    };
  }

  return {
    url: () => 'http://localhost:4124/artifact',
    selected,
    locator(handle: string) {
      if (handle !== CONTAINER_SEL) return deadLocator();
      return {
        count: async () => optionCounts.length,
        first: () => deadLocator(),
        nth: (k: number) => containerLocator(k),
        evaluateAll: async (fn: any, arg: any) => fn([], arg),
      };
    },
    waitForSelector: async () => {},
  };
}

test('8.1.34: pressFirstEach selects the FIRST option in a 3-option question, never the last', async () => {
  const page = radioQuestionsPage([3]);
  const r = await performStepsForTest(
    page as never, [{ pressFirstEach: 'option-label', within: 'question-index' }], 5000, async () => false,
  );
  assert.equal(r.error, null);
  assert.deepEqual(
    page.selected[0], [true, false, false], 'the FIRST option must end up selected, not the last',
  );
});

test(
  '8.1.34: pressFirstEach answers EACH question with one, and SKIPS a freeform-only question rather ' +
    'than erroring',
  async () => {
    // Q0: 3 options, Q1: 2 options, Q2: freeform (no options at all).
    const page = radioQuestionsPage([3, 2, 0]);
    const r = await performStepsForTest(
      page as never, [{ pressFirstEach: 'option-label', within: 'question-index' }], 5000, async () => false,
    );
    assert.equal(r.error, null);
    assert.deepEqual(page.selected[0], [true, false, false]);
    assert.deepEqual(page.selected[1], [true, false]);
    assert.deepEqual(
      page.selected[2], [], 'a question with no options is skipped — its answer comes from fillAllMatching',
    );
  },
);

test(
  '8.1.34: pressFirstEach reds naming BOTH attributes when the container itself never rendered',
  async () => {
    const page = radioQuestionsPage([]);
    const r = await performStepsForTest(
      page as never, [{ pressFirstEach: 'option-label', within: 'question-index' }], 5000, async () => false,
    );
    assert.notEqual(r.error, null);
    assert.match(
      r.error!, /could not press the first \[data-option-label\] within each \[data-question-index\]/,
    );
    assert.match(r.error!, /no element carries that handle/);
  },
);

// ── `fillAllMatching`: fillAll's shape over a plain data-* attribute ────────

/** A page with N elements sharing one bare `data-*` attribute (no `data-field`
 *  at all — `ReflectionGate`'s `data-question-freeform` textareas). */
function multiFreeformPage(n: number) {
  const filled: Array<{ k: number; v: string }> = [];
  return {
    url: () => 'http://localhost:4124/artifact',
    filled,
    locator(handle: string) {
      const match = handle === '[data-question-freeform]';
      return {
        count: async () => (match ? n : 0),
        first: () => ({ fill: async (v: string) => { if (match && n > 0) filled.push({ k: 0, v }); } }),
        nth: (k: number) => ({ fill: async (v: string) => { if (match) filled.push({ k, v }); } }),
        evaluateAll: async (fn: any, arg: any) => fn([], arg),
      };
    },
    waitForSelector: async () => {},
  };
}

test('8.1.34: fillAllMatching fills EVERY match on a bare data-* attribute, not just .first()', async () => {
  const page = multiFreeformPage(2);
  const r = await performStepsForTest(
    page as never,
    [{ fillAllMatching: 'question-freeform', with: 'no other notes' }],
    5000,
    async () => false,
  );
  assert.equal(r.error, null);
  assert.deepEqual(page.filled, [
    { k: 0, v: 'no other notes' },
    { k: 1, v: 'no other notes' },
  ]);
});

// SHOULD-FIX 1 (forge-8vfn.8.1.34): unlike `fillAll`, `fillAllMatching` must
// NOT red on zero matches — a reflection round where EVERY question carries
// options is a legitimate product state, not a missing form. `pressFirstEach`
// already reds on zero `[data-question-index]` containers (see the tests
// above), so the form's presence is proven there, never by this verb finding
// nothing to fill.
test('8.1.34: fillAllMatching on a page with NO matches logs it and CONTINUES — not a red', async () => {
  const page = multiFreeformPage(0);
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line: string) => { lines.push(line); };
  let r;
  try {
    r = await performStepsForTest(
      page as never, [{ fillAllMatching: 'question-freeform', with: 'x' }], 5000, async () => false,
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(r.error, null, 'an all-options round is a legitimate state, never a red');
  assert.deepEqual(page.filled, [], 'nothing to fill, and nothing was');
  assert.ok(
    lines.some((l) => l.includes('[data-question-freeform]') && l.includes('no match to fill')),
    `expected the zero-match state to be logged, got: ${JSON.stringify(lines)}`,
  );
});

// ── schema: story-wait-schema.mjs / story-file.mjs ──────────────────────────

const ok = {
  id: 'smoke',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to' as const, title: 'smoke' },
  beats: [] as unknown[],
};

const beat = (over: Record<string, unknown> = {}) => ({
  act: 'do a thing',
  say: 'a sentence about the thing.',
  expect: { route: '/artifact', data: { section: 'reflect-done' } },
  ...over,
});

const story = (beats: unknown[]) => ({ ...ok, beats });

test('the schema accepts a well-formed pressFirstEach step', () => {
  const loaded = validateStory(story([
    beat({ do: [{ pressFirstEach: 'option-label', within: 'question-index' }] }),
  ]));
  assert.deepEqual(loaded.beats[0].do[0], { pressFirstEach: 'option-label', within: 'question-index' });
});

test('the schema refuses pressFirstEach missing `within`', () => {
  assert.throws(
    () => validateStory(story([beat({ do: [{ pressFirstEach: 'option-label' }] })])),
    /\.within/,
  );
});

test('the schema refuses pressFirstEach alongside another action form', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ press: 'also-this', pressFirstEach: 'option-label', within: 'question-index' }] }),
    ])),
    /exactly one/,
  );
});

test('the schema refuses a pressFirstEach attribute that is not a safe data-* key', () => {
  // Interpolated straight into `[data-<attr>]` (`beats-steps.mjs`) — same
  // discipline `pressWithin.scope.attr` already gets, never a second one.
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressFirstEach: '"><img src=x>', within: 'question-index' }] }),
    ])),
    /pressFirstEach/,
  );
});

test('the schema refuses a `within` attribute that is not a safe data-* key', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressFirstEach: 'option-label', within: '"><img src=x>' }] }),
    ])),
    /\.within/,
  );
});

test('the schema refuses an empty pressFirstEach', () => {
  assert.throws(
    () => validateStory(story([beat({ do: [{ pressFirstEach: '', within: 'question-index' }] })])),
    /pressFirstEach/,
  );
});
