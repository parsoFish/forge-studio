/**
 * beats-press-within-text.test.ts — `pressWithin`'s TEXT scope, an alternative
 * to `bind` for the `forge-8vfn.6.11.51` shape — `forge-8vfn.8.1.16`, T1
 * ruling 1561.
 *
 * THE GAP `bind` LEAVES OPEN. `bind` resolves a scope from an EARLIER beat's
 * binding, which only exists when the product minted an id the story could
 * capture (`architect-session-id`, and so on). S10 beat 15's blocking comment
 * has to anchor to "the criterion that names the precedence rule" — but the
 * criterion INDEX is minted by the LLM that decomposed the initiative, at run
 * time, so no earlier beat can bind it. `text` resolves against the live
 * page's own text instead, and `fallback: 'first'` is the declared escape
 * hatch for when the story's wording does not appear verbatim.
 *
 * THE SHAPE MIRRORS `pressWithin`'s existing `bind` form end to end:
 *   - resolved at PRESS time (never by `resolveBoundPresses`, which leaves a
 *     text scope untouched — the mirror of that function's `bind` behaviour);
 *   - validated in the story schema exactly as `bind` is (one-of-two sub-shape,
 *     required sub-fields), and EXEMPT from `story-file.mjs`'s DUTY 1 (there is
 *     no earlier binding to require);
 *   - `pickTextScope` is the one new PURE piece: `scopedPressHandle` still
 *     turns a resolved `{attr, value}` into the click selector exactly as
 *     today (`beats-steps.mjs`'s `resolveTextScopePress` is the thin page-read
 *     wrapper around it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTextScope, formatTextScopePick, resolveBoundPresses, scopedPressHandle } from './beats.mjs';
import { validateStory } from './story-file.mjs';

// ── pickTextScope: the pure picker ──────────────────────────────────────────

const regionEntries = [
  { value: 'ac-1', text: 'AC 1 State the precedence explicitly when both flags are given.' },
  { value: 'ac-2', text: 'AC 2 Repeatable and OR-combined, same as --author.' },
  { value: 'ac-3', text: 'AC 3 Annotate the text header with the removal counts.' },
];

test('pickTextScope returns the FIRST entry whose text contains the needle, case-insensitively', () => {
  const picked = pickTextScope(regionEntries, 'PRECEDENCE', undefined);
  assert.deepEqual(picked, { value: 'ac-1', fellBack: false });
});

test('pickTextScope: no match + fallback "first" returns the first entry, marked fellBack', () => {
  const picked = pickTextScope(regionEntries, 'nothing matches this', 'first');
  assert.deepEqual(picked, { value: 'ac-1', fellBack: true });
});

test('pickTextScope: no match + no fallback returns null — the caller presses nothing', () => {
  assert.equal(pickTextScope(regionEntries, 'nothing matches this', undefined), null);
});

test('pickTextScope: an empty entries list with a fallback still returns null (nothing to fall back to)', () => {
  assert.equal(pickTextScope([], 'anything', 'first'), null);
});

test('pickTextScope: matching is case-insensitive in both directions', () => {
  const mixedCase = [{ value: 'ac-1', text: 'PRECEDENCE matters here' }];
  assert.deepEqual(pickTextScope(mixedCase, 'precedence', undefined), { value: 'ac-1', fellBack: false });
});

// ── re-resolution stability (coordinator addendum item 4) ───────────────────
//
// `pressWithin` re-resolves at press time on EVERY step that names a text
// scope — never cached from an earlier step in the same beat (S10 beat 15's
// `toggle-region` and `comment-region` are two independent presses of the
// SAME scope). Expanding a region changes the DOM the SECOND press reads, so
// this pins that the pick is stable across that change, for both paths.

test('stability, MATCH path: expanding the chosen region (more text, same needle) still picks it', () => {
  const before = regionEntries;
  const beforePick = pickTextScope(before, 'precedence', undefined);
  // ac-1 toggled open: its own AcEvidence body repeats the criterion text, and
  // no OTHER region's text changed.
  const after = [
    { value: 'ac-1', text: `${before[0].text} ${before[0].text}` },
    before[1],
    before[2],
  ];
  const afterPick = pickTextScope(after, 'precedence', undefined);
  assert.equal(afterPick.value, beforePick.value, 're-resolving after expansion must pick the SAME region');
  assert.equal(afterPick.fellBack, false);
});

test('stability, FALLBACK path: expanding ac-1 (still no match) still falls back to ac-1', () => {
  const noMatch = [
    { value: 'ac-1', text: 'AC 1 nothing about ordering here' },
    { value: 'ac-2', text: 'AC 2 repeatable and OR-combined' },
    { value: 'ac-3', text: 'AC 3 annotate the header' },
  ];
  const beforePick = pickTextScope(noMatch, 'a phrase that appears nowhere', 'first');
  const expanded = [
    { value: 'ac-1', text: `${noMatch[0].text} ${noMatch[0].text} (now longer, still no match)` },
    noMatch[1],
    noMatch[2],
  ];
  const afterPick = pickTextScope(expanded, 'a phrase that appears nowhere', 'first');
  assert.equal(beforePick.value, 'ac-1');
  assert.equal(afterPick.value, 'ac-1', 're-resolving after expansion must fall back to the SAME first region');
  assert.equal(afterPick.fellBack, true);
});

// ── formatTextScopePick: the exact log line, pure ───────────────────────────

test('formatTextScopePick: the MATCH line', () => {
  const line = formatTextScopePick('demo-region', 'precedence', { value: 'ac-7', fellBack: false });
  assert.equal(line, '[stories] pressWithin: [data-demo-region] text contains "precedence" → ac-7');
});

test('formatTextScopePick: the FALLBACK line', () => {
  const line = formatTextScopePick('demo-region', 'precedence', { value: 'ac-1', fellBack: true });
  assert.equal(
    line,
    '[stories] pressWithin: no [data-demo-region] text contains "precedence" — fell back to the first (ac-1)',
  );
});

// ── resolveBoundPresses: a text scope is left UNTOUCHED ─────────────────────

test('resolveBoundPresses leaves a pressWithin TEXT scope untouched — it resolves at press time, not here', () => {
  const steps = [
    { pressWithin: { scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' }, action: 'toggle-region' } },
  ];
  const { steps: out, unbound } = resolveBoundPresses(steps, {});
  assert.equal(unbound, null, 'a text scope never blocks resolution on an unbound name');
  assert.deepEqual(out, steps, 'the step is returned byte-identical');
});

test('resolveBoundPresses: a text scope and a bind scope coexist in the same do block untouched/resolved respectively', () => {
  const steps = [
    { pressWithin: { scope: { attr: 'demo-region', text: 'precedence' }, action: 'toggle-region' } },
    { pressWithin: { scope: { attr: 'session-id', bind: 'sid' }, action: 'open-session' } },
  ];
  const { steps: out, unbound } = resolveBoundPresses(steps, { sid: 's1' });
  assert.equal(unbound, null);
  assert.deepEqual(out[0], steps[0]);
  assert.deepEqual(out[1], { pressWithin: { scope: { attr: 'session-id', value: 's1' }, action: 'open-session' } });
});

// ── scopedPressHandle: unchanged, fed a text-scope's picked value ───────────

test('scopedPressHandle builds the same selector shape from a text-scope pick', () => {
  const handle = scopedPressHandle({ scope: { attr: 'demo-region', value: 'ac-7' }, action: 'toggle-region' });
  assert.equal(handle, '[data-demo-region="ac-7"] [data-action="toggle-region"]');
});

// ── story-file.mjs: the schema, validated exactly as `bind` is ─────────────

const ok = {
  id: 'smoke',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to' as const, title: 'smoke' },
  beats: [] as unknown[],
};

const beat = (over: Record<string, unknown> = {}) => ({
  act: 'do a thing',
  say: 'a sentence about the thing.',
  expect: { route: '/projects/p', data: { page: 'projects' } },
  ...over,
});

const story = (beats: unknown[]) => ({ ...ok, beats });

test('the schema accepts a well-formed pressWithin TEXT scope, with fallback', () => {
  const loaded = validateStory(story([
    beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' }, action: 'toggle-region' } }] }),
  ]));
  assert.deepEqual(loaded.beats[0].do[0], {
    pressWithin: { scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' }, action: 'toggle-region' },
  });
});

test('the schema accepts a TEXT scope with no fallback declared at all', () => {
  const loaded = validateStory(story([
    beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'precedence' }, action: 'toggle-region' } }] }),
  ]));
  assert.deepEqual(loaded.beats[0].do[0], {
    pressWithin: { scope: { attr: 'demo-region', text: 'precedence' }, action: 'toggle-region' },
  });
});

test('the schema refuses a scope naming BOTH bind and text', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', bind: 'x', text: 'precedence' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope.*exactly one/,
  );
});

test('the schema refuses a scope naming NEITHER bind nor text', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope.*exactly one/,
  );
});

test('the schema refuses an empty text', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: '' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.text/,
  );
});

test('the schema refuses a whitespace-only text', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: '   ' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.text/,
  );
});

test('the schema refuses text over 200 characters', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'x'.repeat(201) }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.text/,
  );
});

test('the schema accepts text at exactly 200 characters', () => {
  const loaded = validateStory(story([
    beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'x'.repeat(200) }, action: 'toggle-region' } }] }),
  ]));
  assert.equal((loaded.beats[0].do[0] as { pressWithin: { scope: { text: string } } }).pressWithin.scope.text.length, 200);
});

test('the schema refuses `fallback` alongside `bind`', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', bind: 'x', fallback: 'first' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.fallback/,
  );
});

test('the schema refuses a `fallback` value other than "first"', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'precedence', fallback: 'last' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.fallback/,
  );
});

test('the schema refuses an attr that fails the SAFE_KEY allowlist', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'demo_region', text: 'precedence' }, action: 'toggle-region' } }] }),
    ])),
    /pressWithin\.scope\.attr/,
  );
});

test('story-file DUTY 1 does NOT apply to a text scope: no earlier binding is required', () => {
  // The positive control for the bind form (`beats-press-within.test.ts`)
  // REFUSES an unbound `bind` at beat[0] with no earlier beat. A text scope
  // must load clean in the identical position, because there is no binding to
  // require in the first place.
  const loaded = validateStory(story([
    beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' }, action: 'toggle-region' } }] }),
  ]));
  assert.equal(loaded.beats.length, 1);
});
