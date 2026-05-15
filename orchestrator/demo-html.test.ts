/**
 * Tests for the pure before/after demo HTML renderer (F-44).
 * Asserts structure, framing discipline (no error/regression language in the
 * happy path), self-containment (data-URI screenshots), and graceful
 * degradation (missing captures, build failure banner).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderComparisonHtml, type DemoComparisonModel } from './demo-html.ts';

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function model(overrides: Partial<DemoComparisonModel> = {}): DemoComparisonModel {
  return {
    title: 'Node inspector panel',
    initiativeId: 'INIT-2026-05-13-world-graph-ux',
    project: 'trafficGame',
    baseRef: 'origin/main',
    changedRef: 'forge/INIT-world-graph-ux',
    essence:
      'Selecting a graph node now opens an inspector panel showing its computed grade; previously selection only highlighted the node.',
    generatedAt: '2026-05-13T06:00:00Z',
    baselineBuild: { ok: true, detail: 'npm ci + vite build ok' },
    changedBuild: { ok: true, detail: 'npm ci + vite build ok' },
    checkpoints: [
      {
        label: 'select-node',
        caption: 'Clicking a node selects it',
        beforeImage: PNG_DATA_URI,
        afterImage: PNG_DATA_URI,
      },
      {
        label: 'inspector',
        caption: 'The inspector panel after selection',
        beforeImage: PNG_DATA_URI,
        afterImage: PNG_DATA_URI,
        beforeNote: 'No inspector panel in the prior behaviour — selection only highlighted.',
        afterNote: 'Inspector shows the node grade.',
      },
    ],
    acceptanceCriteria: [
      'GIVEN a world graph WHEN a node is clicked THEN an inspector panel opens',
      'GIVEN the inspector open WHEN it renders THEN it shows the node grade',
    ],
    diffStat: ' src/ui/Inspector.ts | 40 ++++\n 1 file changed',
    ...overrides,
  };
}

test('renderComparisonHtml: emits a self-contained doc with title + essence', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Node inspector panel — before \/ after<\/title>/);
  assert.match(html, /class="essence"/);
  assert.match(html, /inspector panel showing its computed grade/);
});

test('renderComparisonHtml: every checkpoint renders a before AND after figure', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /Before — baseline behaviour/);
  assert.match(html, /After — this initiative/);
  // Two checkpoints × (before+after) = 4 data-URI <img> + 0 video here.
  const imgs = html.match(/<img src="data:image\/png;base64,/g) ?? [];
  assert.equal(imgs.length, 4);
});

test('renderComparisonHtml: screenshots are inlined as data URIs (self-contained)', () => {
  const html = renderComparisonHtml(model());
  assert.ok(html.includes(PNG_DATA_URI), 'screenshot data URI inlined verbatim');
  assert.ok(!html.includes('src="before/'), 'no external screenshot file refs');
});

test('renderComparisonHtml: happy path carries no error/regression framing', () => {
  const html = renderComparisonHtml(model());
  assert.ok(!/\bbroken\b/i.test(html), 'no "broken"');
  assert.ok(!/\bregression\b/i.test(html), 'no "regression"');
  assert.ok(!/\bbug\b/i.test(html), 'no "bug"');
  // The footer explicitly states before is a valid working state.
  assert.match(html, /prior behaviour \(a valid working state\)/);
});

test('renderComparisonHtml: build failure surfaces a banner (the one allowed failure framing)', () => {
  const html = renderComparisonHtml(
    model({ baselineBuild: { ok: false, detail: 'vite: ENOENT vite.config.ts' } }),
  );
  assert.match(html, /class="banner"/);
  assert.match(html, /did not build/);
  assert.match(html, /ENOENT vite\.config\.ts/);
});

test('renderComparisonHtml: no banner when both builds succeed', () => {
  const html = renderComparisonHtml(model());
  assert.ok(!html.includes('class="banner"'));
});

test('renderComparisonHtml: missing capture degrades to a placeholder, not a crash', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        { label: 'x', caption: 'only after captured', beforeImage: null, afterImage: PNG_DATA_URI },
      ],
    }),
  );
  assert.match(html, /class="missing"/);
  assert.match(html, /no capture/);
});

test('renderComparisonHtml: videos referenced as sibling files, not inlined', () => {
  const html = renderComparisonHtml(model({ beforeVideo: 'before/run.webm', afterVideo: 'after/run.webm' }));
  assert.match(html, /<video controls preload="metadata" src="before\/run\.webm">/);
  assert.match(html, /<video controls preload="metadata" src="after\/run\.webm">/);
});

test('renderComparisonHtml: acceptance criteria + diffstat appear as appendices', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /Acceptance criteria this demo is grounded in \(2\)/);
  assert.match(html, /git diff --stat origin\/main\.\.forge\/INIT-world-graph-ux/);
  assert.match(html, /src\/ui\/Inspector\.ts/);
});

test('renderComparisonHtml: escapes HTML in user-supplied strings', () => {
  const html = renderComparisonHtml(
    model({ title: '<script>alert(1)</script>', essence: 'a & b < c > d "q"' }),
  );
  assert.ok(!html.includes('<script>alert(1)</script>'), 'title script escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &lt; c &gt; d &quot;q&quot;/);
});
