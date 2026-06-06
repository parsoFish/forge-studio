/**
 * Tests for the pure before/after demo HTML renderer (REV-4 / D3).
 * Asserts structure, richness (sections present), framing discipline
 * (no error/regression language in the happy path), self-containment
 * (data-URI screenshots), and graceful degradation (missing captures,
 * build failure banner, empty optional sections).
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
    summary: {
      bullets: [
        'Clicking a node now opens an inspector panel with the computed grade.',
        'Previously selection only highlighted the node without showing data.',
      ],
      prUrl: 'https://github.com/org/repo/pull/7',
      branch: 'forge/INIT-world-graph-ux',
      commitSha: 'abc1234',
    },
    checkpoints: [
      {
        label: 'select-node',
        kind: 'screenshot',
        caption: 'Clicking a node selects it',
        beforeImage: PNG_DATA_URI,
        afterImage: PNG_DATA_URI,
      },
      {
        label: 'inspector',
        kind: 'screenshot',
        caption: 'The inspector panel after selection',
        beforeImage: PNG_DATA_URI,
        afterImage: PNG_DATA_URI,
        beforeNote: 'No inspector panel in the prior behaviour — selection only highlighted.',
        afterNote: 'Inspector shows the node grade.',
      },
      {
        label: 'sim-flow',
        kind: 'video',
        caption: 'Simulation runs — vehicles flow on the map',
        beforeImage: null,
        afterImage: null,
        beforeVideoSrc: 'before/sim-flow.webm',
        afterVideoSrc: 'after/sim-flow.webm',
        afterNote: 'Flow continues identically under the new timing model.',
      },
    ],
    apiDiff: [
      {
        name: 'GET /api/nodes/:id',
        change: 'changed',
        before: '{ "id": "n1", "label": "A" }',
        after: '{ "id": "n1", "label": "A", "grade": 0.87 }',
      },
    ],
    testEvidence: [
      { name: 'computeGrade — returns float', result: 'pass', delta: '+1 new test' },
      { name: 'All existing tests', result: 'pass', delta: '42/42 green' },
    ],
    filesChanged: [
      { path: 'src/grade.ts', note: 'new — grade computation' },
      { path: 'src/Inspector.tsx', note: 'renders grade badge' },
    ],
    acceptanceCriteria: [
      'GIVEN a world graph WHEN a node is clicked THEN an inspector panel opens',
      'GIVEN the inspector open WHEN it renders THEN it shows the node grade',
    ],
    diffStat: ' src/ui/Inspector.ts | 40 ++++\n 1 file changed',
    ...overrides,
  };
}

// ── Header band ───────────────────────────────────────────────────────────

test('renderComparisonHtml: header band carries title, branch, commitSha, PR link', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Node inspector panel — before \/ after<\/title>/);
  assert.match(html, /forge\/INIT-world-graph-ux/);
  assert.match(html, /abc1234/);
  assert.match(html, /Pull request/);
  assert.match(html, /https:\/\/github\.com\/org\/repo\/pull\/7/);
});

test('renderComparisonHtml: essence appears in the header', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /inspector panel showing its computed grade/);
});

// ── Summary section ───────────────────────────────────────────────────────

test('renderComparisonHtml: Summary section with bullets is emitted', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /id="summary"/);
  assert.match(html, /Clicking a node now opens an inspector panel/);
  assert.match(html, /Previously selection only highlighted the node/);
});

test('renderComparisonHtml: Summary falls back to essence when summary absent', () => {
  const html = renderComparisonHtml(model({ summary: undefined }));
  assert.match(html, /id="summary"/);
  // essence is used as the fallback bullet
  assert.match(html, /inspector panel showing its computed grade/);
});

// ── Visual Changes section ────────────────────────────────────────────────

test('renderComparisonHtml: Visual Changes section renders before/after pairs', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /id="visual-changes"/);
  assert.match(html, /Before — baseline behaviour/);
  assert.match(html, /After — this initiative/);
  const imgs = html.match(/<img src="data:image\/png;base64,/g) ?? [];
  assert.equal(imgs.length, 4, '2 screenshot checkpoints × (before+after) = 4 data-URI imgs');
});

test('renderComparisonHtml: harness checkpoint renders metric table + verdict, no media', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow-parity',
          kind: 'harness',
          caption: '150-vehicle scoring sim',
          beforeImage: null,
          afterImage: null,
          metrics: [
            { label: 'vehiclesCompleted', before: '148', after: '149', deltaPct: 0.7, parity: 'within' },
            { label: 'throughput', unit: 'v/s', before: '0.812', after: '0.815', deltaPct: 0.4, parity: 'within' },
            { label: 'endReason', before: 'all-complete', after: 'all-complete', deltaPct: null, parity: 'match' },
          ],
        },
      ],
    }),
  );
  assert.match(html, /<table class="harness">/);
  assert.match(html, /<span class="kind">harness<\/span>/);
  assert.match(html, /vehiclesCompleted/);
  assert.match(html, /<td>148<\/td>/);
  assert.match(html, /\+0\.7%/);
  assert.match(html, /class="verdict v-within">Verdict: <strong>PARITY<\/strong>/);
  assert.ok(!html.includes('<img '), 'harness checkpoint has no <img>');
  assert.ok(!html.includes('<video'), 'harness checkpoint has no <video>');
});

test('renderComparisonHtml: diverged metric → DIVERGED verdict; net-new (no baseline) → NEW', () => {
  const diverged = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow', kind: 'harness', caption: 'flow', beforeImage: null, afterImage: null,
          metrics: [
            { label: 'throughput', before: '0.80', after: '0.50', deltaPct: -37.5, parity: 'diverged' },
            { label: 'completed', before: '150', after: '150', deltaPct: 0, parity: 'match' },
          ],
        },
      ],
    }),
  );
  assert.match(diverged, /class="verdict v-diverged">Verdict: <strong>DIVERGED<\/strong>/);

  const incomplete = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow', kind: 'harness', caption: 'flow', beforeImage: null, afterImage: null,
          metrics: [{ label: 'throughput', before: null, after: '0.81', deltaPct: null, parity: 'incomplete' }],
        },
      ],
    }),
  );
  // A net-new metric (no prior baseline) is informational, NOT a warning: the
  // verdict reads "NEW", the cell relabels `incomplete` → `new`.
  assert.match(incomplete, /class="verdict v-new">Verdict: <strong>NEW \(no prior baseline\)<\/strong>/);
  assert.match(incomplete, /<td class="verdict-cell">new<\/td>/);
  assert.doesNotMatch(incomplete, /INCOMPLETE/);
});

test('renderComparisonHtml: video checkpoint renders <video> pair with kind badge', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /<video controls preload="metadata" playsinline src="before\/sim-flow\.webm">/);
  assert.match(html, /<video controls preload="metadata" playsinline src="after\/sim-flow\.webm">/);
  assert.match(html, /<span class="kind">video<\/span>/);
  const imgs = html.match(/<img /g) ?? [];
  assert.equal(imgs.length, 4, 'only the 2 screenshot checkpoints emit <img>');
});

test('renderComparisonHtml: missing capture degrades to placeholder', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        { label: 'x', kind: 'screenshot', caption: 'only after captured', beforeImage: null, afterImage: PNG_DATA_URI },
      ],
    }),
  );
  assert.match(html, /class="missing"/);
  assert.match(html, /no capture/);
});

test('renderComparisonHtml: screenshots are inlined as data URIs (self-contained)', () => {
  const html = renderComparisonHtml(model());
  assert.ok(html.includes(PNG_DATA_URI), 'screenshot data URI inlined verbatim');
  assert.ok(!/<img src="before\//.test(html), 'no external screenshot file refs');
  assert.ok(!/<img src="after\//.test(html), 'no external screenshot file refs');
});

// ── API Diff section ──────────────────────────────────────────────────────

test('renderComparisonHtml: API Diff section renders before/after code blocks + badge', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /id="api-diff"/);
  assert.match(html, /GET \/api\/nodes\/:id/);
  assert.match(html, /badge-changed/);
  assert.match(html, /&quot;grade&quot;: 0\.87/);
  assert.match(html, /code-block/);
});

test('renderComparisonHtml: API Diff section absent when apiDiff not provided', () => {
  const html = renderComparisonHtml(model({ apiDiff: undefined }));
  assert.ok(!html.includes('id="api-diff"'), 'no api-diff section when absent');
});

test('renderComparisonHtml: API Diff added/removed badges emit correct classes', () => {
  const html = renderComparisonHtml(
    model({
      apiDiff: [
        { name: 'newEndpoint()', change: 'added', after: '(): void' },
        { name: 'oldFn()', change: 'removed', before: '(): void' },
      ],
    }),
  );
  assert.match(html, /badge-added/);
  assert.match(html, /badge-removed/);
});

// ── Test Evidence section ─────────────────────────────────────────────────

test('renderComparisonHtml: Test Evidence section renders pass/fail table', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /id="test-evidence"/);
  assert.match(html, /computeGrade/);
  assert.match(html, /result-pass/);
  assert.match(html, /\+1 new test/);
});

test('renderComparisonHtml: Test Evidence absent when not provided', () => {
  const html = renderComparisonHtml(model({ testEvidence: undefined }));
  assert.ok(!html.includes('id="test-evidence"'), 'no test-evidence section when absent');
});

test('renderComparisonHtml: failed test row gets result-fail class', () => {
  const html = renderComparisonHtml(
    model({
      testEvidence: [
        { name: 'integration test', result: 'fail', delta: 'regression' },
      ],
    }),
  );
  assert.match(html, /result-fail/);
  assert.match(html, /integration test/);
});

// ── Files Changed section ─────────────────────────────────────────────────

test('renderComparisonHtml: Files Changed section renders annotated list + diffstat toggle', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /id="files-changed"/);
  assert.match(html, /src\/grade\.ts/);
  assert.match(html, /new — grade computation/);
  assert.match(html, /git diff --stat/);
  assert.match(html, /src\/ui\/Inspector\.ts/);
});

test('renderComparisonHtml: Files Changed falls back to diffStat when filesChanged absent', () => {
  const html = renderComparisonHtml(model({ filesChanged: undefined }));
  assert.match(html, /id="files-changed"/);
  assert.match(html, /src\/ui\/Inspector\.ts/);
});

test('renderComparisonHtml: Files Changed absent when both filesChanged and diffStat absent', () => {
  const html = renderComparisonHtml(model({ filesChanged: undefined, diffStat: undefined }));
  assert.ok(!html.includes('id="files-changed"'), 'no files-changed section when nothing to show');
});

// ── Acceptance criteria appendix ──────────────────────────────────────────

test('renderComparisonHtml: acceptance criteria appear as collapsible appendix', () => {
  const html = renderComparisonHtml(model());
  assert.match(html, /Acceptance criteria this demo is grounded in \(2\)/);
  assert.match(html, /inspector panel opens/);
});

// ── Build banner ──────────────────────────────────────────────────────────

test('renderComparisonHtml: build failure surfaces a banner', () => {
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

// ── Framing discipline ────────────────────────────────────────────────────

test('renderComparisonHtml: happy path carries no error/regression framing', () => {
  const html = renderComparisonHtml(model());
  assert.ok(!/\bbroken\b/i.test(html), 'no "broken"');
  assert.ok(!/\bregression\b/i.test(html), 'no "regression"');
  assert.ok(!/\bbug\b/i.test(html), 'no "bug"');
  assert.match(html, /prior behaviour \(a valid working state\)/);
});

// ── HTML escaping ─────────────────────────────────────────────────────────

test('renderComparisonHtml: escapes HTML in user-supplied strings', () => {
  const html = renderComparisonHtml(
    model({ title: '<script>alert(1)</script>', essence: 'a & b < c > d "q"' }),
  );
  assert.ok(!html.includes('<script>alert(1)</script>'), 'title script escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &lt; c &gt; d &quot;q&quot;/);
});

test('renderComparisonHtml: harness metric strings are HTML-escaped', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'x', kind: 'harness', caption: 'x', beforeImage: null, afterImage: null,
          metrics: [{ label: '<b>m</b>', before: 'a&b', after: '"<x>"', deltaPct: null, parity: 'diverged' }],
        },
      ],
    }),
  );
  assert.ok(!html.includes('<b>m</b>'), 'metric label escaped');
  assert.match(html, /&lt;b&gt;m&lt;\/b&gt;/);
  assert.match(html, /a&amp;b/);
});

// ── Wave C1: shape-aware heading, parity CSS, usage + impact ─────────────

test('renderComparisonHtml: harness-only checkpoints render under "Test Evidence" heading', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow', kind: 'harness', caption: 'Scoring sim', beforeImage: null, afterImage: null,
          metrics: [
            { label: 'completed', before: '148', after: '149', deltaPct: 0.7, parity: 'within' },
          ],
        },
      ],
    }),
  );
  assert.match(html, /<h2>Test Evidence<\/h2>/);
  assert.ok(!html.includes('<h2>Visual Changes</h2>'), 'no Visual Changes heading for harness-only');
});

test('renderComparisonHtml: mixed harness+screenshot keeps "Visual Changes" heading', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow', kind: 'harness', caption: 'Sim', beforeImage: null, afterImage: null,
          metrics: [{ label: 'x', before: '1', after: '1', deltaPct: 0, parity: 'match' }],
        },
        { label: 'ui', kind: 'screenshot', caption: 'UI shot', beforeImage: PNG_DATA_URI, afterImage: PNG_DATA_URI },
      ],
    }),
  );
  assert.match(html, /<h2>Visual Changes<\/h2>/);
});

test('renderComparisonHtml: parity CSS classes all render correctly (match/within/diverged/incomplete)', () => {
  const html = renderComparisonHtml(
    model({
      checkpoints: [
        {
          label: 'flow', kind: 'harness', caption: 'Parity test', beforeImage: null, afterImage: null,
          metrics: [
            { label: 'a', before: '1', after: '1', deltaPct: 0, parity: 'match' },
            { label: 'b', before: '10', after: '10.1', deltaPct: 1, parity: 'within' },
            { label: 'c', before: '10', after: '5', deltaPct: -50, parity: 'diverged' },
            { label: 'd', before: null, after: '5', deltaPct: null, parity: 'incomplete' },
          ],
        },
      ],
    }),
  );
  assert.match(html, /class="p-match"/);
  assert.match(html, /class="p-within"/);
  assert.match(html, /class="p-diverged"/);
  assert.match(html, /class="p-incomplete"/);
});

test('renderComparisonHtml: renders Usage section when usage_example set', () => {
  const html = renderComparisonHtml(
    model({ usage_example: 'resource "betterado_task_group" "demo" {\n  name = "test"\n}' }),
  );
  assert.match(html, /id="usage"/);
  assert.match(html, /<h2>Usage<\/h2>/);
  assert.match(html, /betterado_task_group/);
  assert.match(html, /usage-block/);
});

test('renderComparisonHtml: Usage section absent when usage_example not set', () => {
  const html = renderComparisonHtml(model({ usage_example: undefined }));
  assert.ok(!html.includes('id="usage"'), 'no usage section when absent');
});

test('renderComparisonHtml: renders Impact section when impact set', () => {
  const html = renderComparisonHtml(
    model({ impact: ['Enables task-group provisioning.', 'Unblocks W2 resource imports.'] }),
  );
  assert.match(html, /id="impact"/);
  assert.match(html, /<h2>Impact<\/h2>/);
  assert.match(html, /Enables task-group provisioning\./);
  assert.match(html, /Unblocks W2 resource imports\./);
  assert.match(html, /impact-list/);
});

test('renderComparisonHtml: Impact section absent when impact not set', () => {
  const html = renderComparisonHtml(model({ impact: undefined }));
  assert.ok(!html.includes('id="impact"'), 'no impact section when absent');
});

test('renderComparisonHtml: Usage and Impact sections are HTML-escaped', () => {
  const html = renderComparisonHtml(
    model({
      usage_example: '<script>alert(1)</script>',
      impact: ['a & b < c'],
    }),
  );
  assert.ok(!html.includes('<script>alert(1)</script>'), 'usage script tag escaped');
  assert.match(html, /a &amp; b &lt; c/);
});

test('renderComparisonHtml: scratch files stripped from diffStat in Files Changed', () => {
  const html = renderComparisonHtml(
    model({
      diffStat: ' src/main.ts | 10 +\n AGENT.md | 3 +\n fix_plan.md | 2 +\n PROMPT.md | 1 +',
    }),
  );
  assert.ok(!html.includes('AGENT.md'), 'AGENT.md stripped from diffStat');
  assert.ok(!html.includes('fix_plan.md'), 'fix_plan.md stripped from diffStat');
  assert.ok(!html.includes('PROMPT.md'), 'PROMPT.md stripped from diffStat');
  assert.match(html, /src\/main\.ts/);
});

test('renderComparisonHtml: apiDiff entries are HTML-escaped', () => {
  const html = renderComparisonHtml(
    model({
      apiDiff: [
        { name: '<script>evil()</script>', change: 'added', after: '{ "k": "<v>" }' },
      ],
    }),
  );
  assert.ok(!html.includes('<script>evil()'), 'api entry name escaped');
  assert.match(html, /&lt;script&gt;/);
});
