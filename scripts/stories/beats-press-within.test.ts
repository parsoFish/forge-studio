/**
 * beats-press-within.test.ts — `forge-8vfn.6.11.51`: `pressWithin` scopes a
 * press to the element whose `data-<attr>` equals an EARLIER beat's binding,
 * instead of the runner's `.first()` opening whichever element sorts first.
 *
 * THE MEASURED DEFECT (`HomeSessionsStrip.tsx:175`, `beats-steps.mjs:290` at
 * this bead's own filing). `data-action="open-session"` renders once PER
 * session card, each card wrapped in a unique `data-session-id`. A bare
 * `{ press: 'open-session' }` resolves to `[data-action="open-session"]`,
 * which matches every card at once, and the runner's press step clicks
 * `.first()` of that set — the card that happens to sort first, never
 * necessarily the one a story bound.
 *
 * THE SHAPE MIRRORS `pressBound` (`forge-8vfn.7.6.54`) end to end:
 *   - resolved at run time from the beat's bindings (`resolveBoundPresses`,
 *     `beats.mjs`), never substituted into a literal string the operator
 *     wrote by hand;
 *   - an unresolved bind REFUSES here rather than pressing a half-built
 *     handle (which would read as a product defect, not a story gap);
 *   - validated in the story schema exactly as `pressBound` is (one-of-N
 *     step shape, required sub-fields), and by `story-file.mjs`'s DUTY 1 (the
 *     bind must be an EARLIER beat's, checked at LOAD).
 *
 * `scopedPressHandle` is the one new piece `pressBound` did not need: a bound
 * `press` collapses into a literal action name that `handleFor` already knows
 * how to wrap in `[data-action="..."]`; a bound `pressWithin` needs the click
 * scoped to a DIFFERENT element than the one the action lives on top-level,
 * so it is resolved to `{scope: {attr, value}, action}` and turned into a CSS
 * descendant selector separately, in `beats-steps.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoundPresses, scopedPressHandle } from './beats.mjs';
import { validateStory } from './story-file.mjs';

// ── resolveBoundPresses: the scoped form ────────────────────────────────────

test('resolveBoundPresses resolves a bound pressWithin into a literal scope.value', () => {
  const steps = [
    { pressWithin: { scope: { attr: 'session-id', bind: 'architectSessionId' }, action: 'open-session' } },
  ];
  const { steps: out, unbound } = resolveBoundPresses(steps, { architectSessionId: 'abc-123' });
  assert.equal(unbound, null);
  assert.deepEqual(out, [
    { pressWithin: { scope: { attr: 'session-id', value: 'abc-123' }, action: 'open-session' } },
  ]);
});

test('resolveBoundPresses REFUSES a pressWithin whose bind is not (yet) bound', () => {
  // The same refusal shape as `pressBound`: never press a half-built handle.
  const steps = [{ pressWithin: { scope: { attr: 'session-id', bind: 'neverBound' }, action: 'open-session' } }];
  const { steps: out, unbound } = resolveBoundPresses(steps, {});
  assert.equal(unbound, 'neverBound', 'names the unresolved bind so the caller can refuse the beat');
  assert.deepEqual(out, steps, 'an unresolved step is returned UNCHANGED, never pressed as a literal');
});

test('resolveBoundPresses leaves pressBound and plain press steps exactly as before', () => {
  // pressWithin is an ADDITION; it must not change resolution of the two
  // forms that already existed alongside it in the same `do` block.
  const steps = [
    { press: 'submit-answers' },
    { pressBound: { action: 'open-initiative-', bind: 'runId' } },
    { pressWithin: { scope: { attr: 'session-id', bind: 'sid' }, action: 'open-session' } },
  ];
  const { steps: out, unbound } = resolveBoundPresses(steps, { runId: 'r1', sid: 's1' });
  assert.equal(unbound, null);
  assert.deepEqual(out[0], { press: 'submit-answers' });
  assert.deepEqual(out[1], { press: 'open-initiative-r1' });
  assert.deepEqual(out[2], { pressWithin: { scope: { attr: 'session-id', value: 's1' }, action: 'open-session' } });
});

// ── scopedPressHandle: the resolved step -> the CSS selector the click uses ─

test('scopedPressHandle builds the scoped selector from a resolved pressWithin', () => {
  const handle = scopedPressHandle({ scope: { attr: 'session-id', value: 'abc-123' }, action: 'open-session' });
  assert.equal(handle, '[data-session-id="abc-123"] [data-action="open-session"]');
});

test('resolution feeds scopedPressHandle end to end, naming the exact card', () => {
  const { steps: out } = resolveBoundPresses(
    [{ pressWithin: { scope: { attr: 'session-id', bind: 'architectSessionId' }, action: 'open-session' } }],
    { architectSessionId: 'the-real-one' },
  );
  assert.equal(
    scopedPressHandle(out[0].pressWithin),
    '[data-session-id="the-real-one"] [data-action="open-session"]',
  );
});

// ── story-file.mjs: validated exactly as pressBound is ──────────────────────

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

test('the schema accepts a well-formed pressWithin step', () => {
  const loaded = validateStory(story([
    beat({ expect: { route: '/architect/new', data: { page: 'architect-new', 'architect-session-id': '<architectSessionId>' } } }),
    beat({ do: [{ pressWithin: { scope: { attr: 'session-id', bind: 'architectSessionId' }, action: 'open-session' } }] }),
  ]));
  assert.deepEqual(loaded.beats[1].do[0], {
    pressWithin: { scope: { attr: 'session-id', bind: 'architectSessionId' }, action: 'open-session' },
  });
});

test('the schema refuses pressWithin missing scope.bind (and no text scope either)', () => {
  // `forge-8vfn.8.1.16` gave `scope` a second shape (`text`, in
  // `beats-press-within-text.test.ts`): a scope naming NEITHER is refused by
  // the shared "exactly one of" check rather than by `bind` specifically, so
  // the message now names `pressWithin.scope`, one level up from before.
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'session-id' }, action: 'open-session' } }] }),
    ])),
    /pressWithin\.scope/,
  );
});

test('the schema refuses pressWithin missing action', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'session-id', bind: 'x' } } }] }),
    ])),
    /pressWithin\.action/,
  );
});

test('the schema refuses a step naming pressWithin alongside another action form', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          press: 'also-this',
          pressWithin: { scope: { attr: 'session-id', bind: 'x' }, action: 'open-session' },
        }],
      }),
    ])),
    /exactly one/,
  );
});

test('story-file DUTY 1: a pressWithin whose bind no EARLIER beat declares is refused at LOAD', () => {
  assert.throws(
    () => validateStory(story([
      beat({ do: [{ pressWithin: { scope: { attr: 'session-id', bind: 'neverBound' }, action: 'open-session' } }] }),
    ])),
    (err: Error) => {
      assert.match(err.message, /beats\[0\]/);
      assert.match(err.message, /pressWithin names <neverBound>/);
      assert.match(err.message, /no EARLIER beat binds/);
      return true;
    },
  );
});

test('story-file DUTY 1 positive control: bound by an earlier beat loads clean', () => {
  const loaded = validateStory(story([
    beat({ expect: { route: '/architect/new', data: { page: 'architect-new', 'architect-session-id': '<architectSessionId>' } } }),
    beat({ do: [{ pressWithin: { scope: { attr: 'session-id', bind: 'architectSessionId' }, action: 'open-session' } }] }),
  ]));
  assert.equal(loaded.beats.length, 2);
});
