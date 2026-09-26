/**
 * beats-press-within-text-live.test.ts — `pressWithin`'s TEXT scope
 * (`forge-8vfn.8.1.16`, T1 ruling 1561) driven through `driveBeat` against a
 * fake Studio, exactly as `beats-drive.test.ts` drives the `bind` shapes.
 *
 * `beats-press-within-text.test.ts` pins the PURE picker (`pickTextScope`) and
 * the schema; this file pins the PAGE-READING half — the unscoped handle wait,
 * `readTextScopeEntries`'s `page.evaluate`, the resolved click, and the
 * `anchor` a text-scope press leaves on the beat's own record (the artifact-
 * visibility half of `8.1.16`: a fallback that shows up only as "which region
 * got pressed" is a fallback nobody notices happened).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';
import { el, READY_MAIN, fakeStudio } from './test-fixtures/fake-studio.ts';

/** Three AC region cards, `data-demo-region` and `data-action="toggle-region"`
 *  on the SAME element — the real DOM nests them (`DemoReviewSurface.tsx`'s
 *  card wraps its header button), but `fakeStudio`'s selector matching does
 *  not model descendant combinators, only attribute conjunction on one node;
 *  a compound `[data-demo-region="x"] [data-action="y"]` selector resolves
 *  against a fake node carrying BOTH attributes, which is what this fixture
 *  gives it. */
function regionsPage(regions: Array<{ id: string; text: string }>) {
  return {
    '/artifact': {
      elements: [
        READY_MAIN('artifact'),
        ...regions.map((r) => el('button', { 'data-demo-region': r.id, 'data-action': 'toggle-region' }, null, [], r.text)),
      ],
      data: { page: 'artifact', 'page-ready': 'true' },
    },
  };
}

const THREE_REGIONS = [
  { id: 'ac-1', text: 'AC 1: repeatable and OR-combined, same as --author.' },
  { id: 'ac-2', text: 'AC 2: state the precedence explicitly when both flags are given.' },
  { id: 'ac-3', text: 'AC 3: annotate the header with the removal counts.' },
];

const NONE_MATCH = [
  { id: 'ac-1', text: 'AC 1: repeatable and OR-combined, same as --author.' },
  { id: 'ac-2', text: 'AC 2: annotate the header with the removal counts.' },
  { id: 'ac-3', text: 'AC 3: case-insensitive, wildcard matching.' },
];

function toggleBeat(fallback?: 'first') {
  return {
    act: 'Anchor to the precedence criterion',
    do: [{
      pressWithin: {
        scope: { attr: 'demo-region', text: 'precedence', ...(fallback !== undefined ? { fallback } : {}) },
        action: 'toggle-region',
      },
    }],
    expect: { route: '/artifact', data: { page: 'artifact', 'page-ready': 'true' } },
    say: 'x',
  };
}

test('a text-scope pressWithin presses the region whose text contains the needle, and the verdict carries the anchor', async () => {
  const page = fakeStudio({ start: '/artifact', commitMs: 50, pages: regionsPage(THREE_REGIONS) });
  const v = await driveBeat(page, toggleBeat(), 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, ['[data-demo-region="ac-2"] [data-action="toggle-region"]']);
  assert.deepEqual(v.anchor, { by: 'text', attr: 'demo-region', text: 'precedence', region: 'ac-2' });
});

test('no match + fallback "first": presses the first region and the verdict says so', () => {
  return (async () => {
    const page = fakeStudio({ start: '/artifact', commitMs: 50, pages: regionsPage(NONE_MATCH) });
    const v = await driveBeat(page, toggleBeat('first'), 1, 'http://localhost:4124');
    assert.equal(v.status, 'green', v.failures.join(' | '));
    assert.deepEqual(page.clicks, ['[data-demo-region="ac-1"] [data-action="toggle-region"]']);
    assert.deepEqual(v.anchor, { by: 'fallback', attr: 'demo-region', text: 'precedence', region: 'ac-1' });
  })();
});

test('no match, no fallback: the beat REDS naming attr and text, and NOTHING was pressed', async () => {
  const page = fakeStudio({ start: '/artifact', commitMs: 50, pages: regionsPage(NONE_MATCH) });
  const v = await driveBeat(page, toggleBeat(), 1, 'http://localhost:4124');
  assert.equal(v.status, 'red');
  assert.ok(
    v.failures.some((f) => f.includes('demo-region') && f.includes('precedence')),
    `failure must name attr and text: ${v.failures.join(' | ')}`,
  );
  assert.deepEqual(page.clicks, [], 'a refused text scope must press nothing');
  assert.equal(Object.hasOwn(v, 'anchor'), false, 'no anchor is recorded when nothing was picked');
});

// D's review of `forge-8vfn.8.1.16` (1): the anchor is the FIRST pick. Press 1
// falls back to ac-1 and "expands" it (a click to a page where ac-1's comment
// control carries text naming the needle, as expanded evidence may); press 2
// then matches ac-1 BY TEXT. The record must still say the story fell back.
test('fallback on press 1, a text match on press 2 after expansion: the anchor records the fallback', async () => {
  const collapsed = NONE_MATCH.map((r) =>
    el('button', { 'data-demo-region': r.id, 'data-action': 'toggle-region' }, r.id === 'ac-1' ? '/expanded' : null, [], r.text));
  const expanded = [
    ...NONE_MATCH.map((r) => el('button', { 'data-demo-region': r.id, 'data-action': 'toggle-region' }, null, [], r.text)),
    el('button', { 'data-demo-region': 'ac-1', 'data-action': 'comment-region' }, null, [], 'evidence: precedence stated'),
  ];
  const page = fakeStudio({
    start: '/artifact',
    commitMs: 50,
    pages: {
      '/artifact': { elements: [READY_MAIN('artifact'), ...collapsed], data: { page: 'artifact', 'page-ready': 'true' } },
      '/expanded': { elements: [READY_MAIN('artifact'), ...expanded], data: { page: 'artifact', 'page-ready': 'true' } },
    },
  });
  const scope = { attr: 'demo-region', text: 'precedence', fallback: 'first' as const };
  const beat = {
    act: 'Anchor to the precedence criterion',
    do: [
      { pressWithin: { scope, action: 'toggle-region' } },
      { pressWithin: { scope, action: 'comment-region' } },
    ],
    expect: { route: '/expanded', data: { page: 'artifact', 'page-ready': 'true' } },
    say: 'x',
  };
  const v = await driveBeat(page, beat, 1, 'http://localhost:4124');
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.deepEqual(page.clicks, [
    '[data-demo-region="ac-1"] [data-action="toggle-region"]',
    '[data-demo-region="ac-1"] [data-action="comment-region"]',
  ]);
  assert.deepEqual(v.anchor, { by: 'fallback', attr: 'demo-region', text: 'precedence', region: 'ac-1' });
});

// D's review of `forge-8vfn.8.1.16` (2): a page-sourced scope value is never
// interpolated into a selector unless it fits SAFE_SCOPE_VALUE.
test('a hostile page-sourced region id is refused by name, and NOTHING is pressed', async () => {
  const hostile = 'x"] , [data-action="send-back';
  const page = fakeStudio({
    start: '/artifact',
    commitMs: 50,
    pages: regionsPage([{ id: hostile, text: 'AC 1: state the precedence.' }]),
  });
  const v = await driveBeat(page, toggleBeat('first'), 1, 'http://localhost:4124');
  assert.equal(v.status, 'red');
  assert.ok(
    v.failures.some((f) => f.includes('not a safe scope value')),
    `failure must name the refusal: ${v.failures.join(' | ')}`,
  );
  assert.deepEqual(page.clicks, [], 'a refused scope value must press nothing');
});
