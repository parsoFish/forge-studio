/**
 * press-within-only-if.test.ts — `pressWithin`'s `onlyIf`, row 177
 * (`forge-8vfn.8.5.13`).
 *
 * THE MEASURED DEFECT. S10 beat 16's two `pressWithin` steps — `toggle-region`
 * then `comment-region`, both scoped to `{ attr: 'demo-region', text:
 * 'precedence', fallback: 'first' }` — assumed every AC region starts
 * COLLAPSED, true only when the review decomposes into MORE than
 * `REGION_COLLAPSE_THRESHOLD` (12) criteria
 * (`apps/studio/lib/demo-review-view.ts`'s `regionDefaultOpen`). The criterion
 * count is minted at run time by the LLM that decomposes the initiative, and a
 * real run produced 11 — every region rendered OPEN — so the unconditional
 * toggle COLLAPSED the one region the next step needed `comment-region` on,
 * which `DemoReviewSurface.tsx` mounts only while its region is expanded
 * (`:387` the `data-region-collapsed` flag, `:485` the button itself). The
 * second step then waited its whole declared bound for a control the first
 * step had just made disappear (a 30-minute timeout).
 *
 * `onlyIf: { 'region-collapsed': 'true' }` on the TOGGLE step alone makes the
 * press conditional on the SCOPE element's own attribute — never the action
 * control inside it — read fresh at press time, exactly like the scope value
 * itself. A mismatch (including an ABSENT attribute) skips the press: no
 * error, nothing pressed, one `[stories]` log line naming why.
 *
 * TWO HALVES, mirroring every other `pressWithin` addition in this directory:
 *   - `beats-steps.mjs`'s execution, driven through `driveBeat` against
 *     `fakeStudio`, exactly as `beats-press-within-text-live.test.ts` drives
 *     the TEXT scope itself (THE SAME fake, because `onlyIf`'s read is a
 *     second, independent `evaluate` off the very element that fake's own
 *     header comment says models BOTH a card's and its control's attributes
 *     on one node);
 *   - `story-wait-schema.mjs`'s validation and rebuild, exercised through
 *     `validateStory` exactly as `onlyIf`'s sibling fields (`scope.bind`,
 *     `scope.text`) are in `beats-press-within.test.ts` /
 *     `beats-press-within-text.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { driveBeat } from './beats-drive.mjs';
import { resolveBoundPresses, scopedPressHandle } from './beats.mjs';
import { validateStory } from './story-file.mjs';
import { el, READY_MAIN, fakeStudio } from './test-fixtures/fake-studio.ts';

// ── fixtures: AC regions, modelled the way `DemoReviewSurface.tsx` renders ──
// them. Two fake elements per region — `toggle-region` always, `comment-
// region` only while expanded (`:387`'s `data-region-collapsed`, `:485`'s
// conditional mount) — both carrying `data-demo-region` and
// `data-region-collapsed`, so EITHER one answers a bare-scope read or a
// text-scope's `pickTextScope`. This is `fakeStudio`'s own documented
// shortcut (see `regionsPage` in the TEXT-scope live test): a compound
// selector resolves against one fake node carrying every attribute a real
// DOM would split across a parent `<div>` and its child `<button>`s.

function region(id: string, text: string, collapsed: boolean) {
  const shared = { 'data-demo-region': id, 'data-region-collapsed': collapsed ? 'true' : 'false' };
  const nodes = [el('button', { ...shared, 'data-action': 'toggle-region' }, null, [], text)];
  if (!collapsed) nodes.push(el('button', { ...shared, 'data-action': 'comment-region' }, null, [], text));
  return nodes;
}

function artifactPage(regions: Array<{ id: string; text: string; collapsed: boolean }>) {
  return {
    elements: [READY_MAIN('artifact'), ...regions.flatMap((r) => region(r.id, r.text, r.collapsed))],
    data: { page: 'artifact', 'page-ready': 'true' },
  };
}

const ONLY_IF_COLLAPSED = { 'region-collapsed': 'true' };

/** Beat 16's own two steps, verbatim shape — `toggle-region` carries
 *  `onlyIf`, `comment-region` never does. */
function beat16Steps() {
  return [
    {
      pressWithin: {
        scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' as const },
        action: 'toggle-region',
        onlyIf: ONLY_IF_COLLAPSED,
      },
    },
    {
      pressWithin: {
        scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' as const },
        action: 'comment-region',
      },
    },
  ];
}

// ── (a) 11 criteria, every region already OPEN: the toggle is SKIPPED ──────

test('onlyIf SKIPS the toggle when the scope region is already expanded (measured 11-criterion run)', async () => {
  const regions = Array.from({ length: 11 }, (_, i) => ({
    id: `ac-${i + 1}`,
    text: i === 3
      ? 'AC 4: state the precedence explicitly when both flags are given.'
      : `AC ${i + 1}: an unrelated criterion.`,
    collapsed: false,
  }));
  const page = fakeStudio({ start: '/artifact', commitMs: 50, pages: { '/artifact': artifactPage(regions) } });

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line: string) => { lines.push(line); };
  let v;
  try {
    v = await driveBeat(page, {
      act: 'Anchor to the precedence criterion',
      do: beat16Steps(),
      expect: { route: '/artifact', data: { page: 'artifact', 'page-ready': 'true' } },
      say: 'x',
    }, 1, 'http://localhost:4124');
  } finally {
    console.log = originalLog;
  }

  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(
    page.clicks,
    ['[data-demo-region="ac-4"] [data-action="comment-region"]'],
    'the toggle must never be clicked — the region was already open, and comment-region presses straight through',
  );
  assert.ok(
    lines.some((l) => l.includes('pressWithin: skipped toggle-region')
      && l.includes('[data-demo-region="ac-4"]')
      && l.includes('data-region-collapsed="false"')
      && l.includes('onlyIf wants "true"')),
    `expected the skip to be logged in the [stories] style, got: ${JSON.stringify(lines)}`,
  );
});

// ── (b) 25 criteria, every region COLLAPSED: the toggle IS pressed ─────────

test(
  'onlyIf PRESSES the toggle when the scope region is collapsed, opening it so comment-region succeeds ' +
    '(measured 25-criterion shape)',
  async () => {
    const COUNT = 25;
    const base = Array.from({ length: COUNT }, (_, i) => ({
      id: `ac-${i + 1}`,
      text: i === 8
        ? 'AC 9: state the precedence explicitly when both flags are given.'
        : `AC ${i + 1}: an unrelated criterion.`,
      collapsed: true,
    }));
    // The toggle click "navigates" to a page where ac-9 alone is open — the
    // SAME trick `beats-press-within-text-live.test.ts`'s own fallback-then-
    // expand test uses for the identical reason: this fake has no notion of a
    // DOM mutating in place, only of which static page is active, and a click
    // that `navigatesTo` a route is how it models one.
    const collapsedElements = [
      READY_MAIN('artifact'),
      ...base.flatMap((r) => (r.id === 'ac-9'
        ? [el(
            'button',
            { 'data-demo-region': r.id, 'data-region-collapsed': 'true', 'data-action': 'toggle-region' },
            '/artifact-opened',
            [],
            r.text,
          )]
        : region(r.id, r.text, r.collapsed))),
    ];
    const opened = base.map((r) => (r.id === 'ac-9' ? { ...r, collapsed: false } : r));

    const page = fakeStudio({
      start: '/artifact',
      commitMs: 50,
      pages: {
        '/artifact': { elements: collapsedElements, data: { page: 'artifact', 'page-ready': 'true' } },
        '/artifact-opened': artifactPage(opened),
      },
    });

    const v = await driveBeat(page, {
      act: 'Anchor to the precedence criterion',
      do: beat16Steps(),
      expect: { route: '/artifact-opened', data: { page: 'artifact', 'page-ready': 'true' } },
      say: 'x',
    }, 1, 'http://localhost:4124');

    assert.equal(v.status, 'green', v.failures.join(' | '));
    assert.deepEqual(page.clicks, [
      '[data-demo-region="ac-9"] [data-action="toggle-region"]',
      '[data-demo-region="ac-9"] [data-action="comment-region"]',
    ]);
  },
);

// ── (c) validation: story-wait-schema.mjs refuses a malformed onlyIf ───────

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

test('the schema refuses an onlyIf with two keys', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence' },
            action: 'toggle-region',
            onlyIf: { 'region-collapsed': 'true', 'region-comment-count': '0' },
          },
        }],
      }),
    ])),
    /pressWithin\.onlyIf/,
  );
});

test('the schema refuses an onlyIf with a non-string value', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence' },
            action: 'toggle-region',
            onlyIf: { 'region-collapsed': true },
          },
        }],
      }),
    ])),
    /pressWithin\.onlyIf\.region-collapsed/,
  );
});

test('the schema refuses an onlyIf key that fails the SAFE_KEY allowlist', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence' },
            action: 'toggle-region',
            onlyIf: { region_collapsed: 'true' },
          },
        }],
      }),
    ])),
    /pressWithin\.onlyIf/,
  );
});

test('the schema refuses an onlyIf that is not an object', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence' },
            action: 'toggle-region',
            onlyIf: 'region-collapsed',
          },
        }],
      }),
    ])),
    /pressWithin\.onlyIf/,
  );
});

test('the schema refuses an onlyIf with zero keys', () => {
  assert.throws(
    () => validateStory(story([
      beat({
        do: [{
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence' },
            action: 'toggle-region',
            onlyIf: {},
          },
        }],
      }),
    ])),
    /pressWithin\.onlyIf/,
  );
});

// ── (c), continued: a valid onlyIf survives the rebuild, both scope kinds ──

test('a valid onlyIf on a TEXT scope survives validateStory\'s rebuild byte-identical', () => {
  const loaded = validateStory(story([
    beat({
      do: [{
        pressWithin: {
          scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' },
          action: 'toggle-region',
          onlyIf: { 'region-collapsed': 'true' },
        },
      }],
    }),
  ]));
  assert.deepEqual(loaded.beats[0].do[0], {
    pressWithin: {
      scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' },
      action: 'toggle-region',
      onlyIf: { 'region-collapsed': 'true' },
    },
  });
});

test('a valid onlyIf on a BIND scope survives validateStory\'s rebuild byte-identical', () => {
  const loaded = validateStory(story([
    beat({ expect: { route: '/architect/new', data: { page: 'architect-new', 'architect-session-id': '<architectSessionId>' } } }),
    beat({
      do: [{
        pressWithin: {
          scope: { attr: 'session-id', bind: 'architectSessionId' },
          action: 'open-session',
          onlyIf: { 'session-ready': 'true' },
        },
      }],
    }),
  ]));
  assert.deepEqual(loaded.beats[1].do[0], {
    pressWithin: {
      scope: { attr: 'session-id', bind: 'architectSessionId' },
      action: 'open-session',
      onlyIf: { 'session-ready': 'true' },
    },
  });
});

// A step with no `onlyIf` at all must be completely unaffected — the
// additive property every other `pressWithin` field in this file already has.
test('a pressWithin step with no onlyIf at all is unaffected', () => {
  const loaded = validateStory(story([
    beat({ do: [{ pressWithin: { scope: { attr: 'demo-region', text: 'precedence' }, action: 'toggle-region' } }] }),
  ]));
  assert.deepEqual(loaded.beats[0].do[0], {
    pressWithin: { scope: { attr: 'demo-region', text: 'precedence' }, action: 'toggle-region' },
  });
});

// ── resolveBoundPresses: onlyIf survives a BIND scope's own resolution ─────
// (`beats.mjs`) — the rebuild that turns `scope.bind` into a literal
// `scope.value` has its own fixed field list, independent of the schema's.

test('resolveBoundPresses carries a BIND scope\'s onlyIf through to the resolved step', () => {
  const steps = [
    {
      pressWithin: {
        scope: { attr: 'session-id', bind: 'architectSessionId' },
        action: 'open-session',
        onlyIf: { 'session-ready': 'true' },
      },
    },
  ];
  const { steps: out, unbound } = resolveBoundPresses(steps, { architectSessionId: 'abc-123' });
  assert.equal(unbound, null);
  assert.deepEqual(out, [
    {
      pressWithin: {
        scope: { attr: 'session-id', value: 'abc-123' },
        action: 'open-session',
        onlyIf: { 'session-ready': 'true' },
      },
    },
  ]);
  assert.equal(
    scopedPressHandle(out[0].pressWithin),
    '[data-session-id="abc-123"] [data-action="open-session"]',
  );
});
