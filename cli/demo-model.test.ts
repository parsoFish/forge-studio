/**
 * Tests for the unified structured demo model (ADR 021 / REV-4) — the schema
 * validator + the derived DEMO.md / DEMO.html renderers. Covers the new rich
 * structured sections: summary, apiDiff, testEvidence, filesChanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateDemoModel,
  renderDemoMarkdown,
  renderDemoHtml,
  renderDemoBundle,
  mergeCapturedMedia,
  toComparisonModel,
  type DemoModel,
} from './demo-model.ts';

function validModel(): DemoModel {
  return {
    title: 'Dark mode toggle',
    essence: 'Adds a dark-mode toggle that follows the OS by default.',
    project: 'demo',
    initiativeId: 'INIT-2026-05-30-dark-mode',
    baseRef: 'main',
    changedRef: 'forge/INIT-2026-05-30-dark-mode',
    diffStat: ' src/theme.ts | 40 ++++\n 1 file changed',
    acceptanceCriteria: ['GIVEN settings WHEN toggled THEN theme persists'],
    checkpoints: [
      {
        label: 'toggle',
        kind: 'screenshot',
        caption: 'Toggling dark mode in settings',
        beforeNote: 'No theme control existed.',
        afterNote: 'A toggle persists the choice.',
      },
    ],
  };
}

function richModel(): DemoModel {
  return {
    ...validModel(),
    summary: {
      bullets: ['Adds dark mode toggle.', 'Persists choice in localStorage.'],
      prUrl: 'https://github.com/org/repo/pull/99',
      branch: 'forge/INIT-2026-05-30-dark-mode',
      commitSha: 'abc1234',
    },
    apiDiff: [
      {
        name: 'GET /api/theme',
        change: 'added',
        after: '{ "mode": "dark" | "light" }',
      },
    ],
    testEvidence: [
      { name: 'theme.test.ts — persists preference', result: 'pass', delta: '+2 new tests' },
    ],
    filesChanged: [
      { path: 'src/theme.ts', note: 'new toggle logic' },
      { path: 'src/theme.test.ts', note: 'new tests' },
    ],
  };
}

// ── Validation — required core ────────────────────────────────────────────

test('validateDemoModel: a complete core model is valid', () => {
  assert.deepEqual(validateDemoModel(validModel()), []);
});

test('validateDemoModel: a rich model with all optional sections is valid', () => {
  assert.deepEqual(validateDemoModel(richModel()), []);
});

test('validateDemoModel: missing core fields are reported', () => {
  const errs = validateDemoModel({ checkpoints: [] });
  assert.ok(errs.some((e) => e.includes('title')));
  assert.ok(errs.some((e) => e.includes('essence')));
  assert.ok(errs.some((e) => e.includes('project')));
  assert.ok(errs.some((e) => e.includes('diffStat')));
  assert.ok(errs.some((e) => e.includes('checkpoints must be a non-empty array')));
});

test('validateDemoModel: checkpoint requires label + caption', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.checkpoints = [{ kind: 'screenshot' }];
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('checkpoints[0].label')));
  assert.ok(errs.some((e) => e.includes('checkpoints[0].caption')));
});

test('validateDemoModel: media must be inline data: URIs (rejects remote/scheme refs)', () => {
  const m = validModel();
  m.checkpoints[0].beforeImage = 'https://evil.example/x.png';
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('beforeImage must be a data:image/')));

  const ok = validModel();
  ok.checkpoints[0].beforeImage = 'data:image/png;base64,AAAA';
  assert.deepEqual(validateDemoModel(ok), []);
});

test('validateDemoModel: video src must be a relative sibling path', () => {
  const m = validModel();
  m.checkpoints[0].kind = 'video';
  m.checkpoints[0].beforeVideoSrc = 'file:///etc/passwd';
  assert.ok(validateDemoModel(m).some((e) => e.includes('beforeVideoSrc')));

  const ok = validModel();
  ok.checkpoints[0].beforeVideoSrc = 'before/toggle.webm';
  assert.deepEqual(validateDemoModel(ok), []);
});

// ── Validation — rich sections ────────────────────────────────────────────

test('validateDemoModel: invalid summary (bullets not array) is reported', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.summary = { bullets: 'not-an-array' };
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('summary.bullets')));
});

test('validateDemoModel: apiDiff must be array when set', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.apiDiff = 'not-an-array';
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('apiDiff')));
});

test('validateDemoModel: testEvidence must be array when set', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.testEvidence = 42;
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('testEvidence')));
});

test('validateDemoModel: filesChanged must be array when set', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.filesChanged = 'not-array';
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('filesChanged')));
});

// ── renderDemoMarkdown ────────────────────────────────────────────────────

test('renderDemoMarkdown: includes essence, captions, ACs, diffstat', () => {
  const md = renderDemoMarkdown(validModel());
  assert.match(md, /# Dark mode toggle/);
  assert.match(md, /follows the OS by default/);
  assert.match(md, /Toggling dark mode in settings/);
  assert.match(md, /Acceptance criteria/);
  assert.match(md, /1 file changed/);
});

test('renderDemoMarkdown: renders summary bullets + PR meta when present', () => {
  const md = renderDemoMarkdown(richModel());
  assert.match(md, /## Summary/);
  assert.match(md, /Adds dark mode toggle/);
  assert.match(md, /PR: https:\/\/github\.com\/org\/repo\/pull\/99/);
  assert.match(md, /Branch: `forge\/INIT-2026-05-30-dark-mode`/);
  assert.match(md, /Commit: `abc1234`/);
});

test('renderDemoMarkdown: renders API Diff section when present', () => {
  const md = renderDemoMarkdown(richModel());
  assert.match(md, /## API \/ Behaviour Diff/);
  assert.match(md, /GET \/api\/theme.*added/);
  assert.match(md, /\*\*After:\*\*/);
});

test('renderDemoMarkdown: renders Test Evidence table when present', () => {
  const md = renderDemoMarkdown(richModel());
  assert.match(md, /## Test Evidence/);
  assert.match(md, /\| test \| result \| delta \|/);
  assert.match(md, /persists preference.*pass.*\+2 new tests/);
});

test('renderDemoMarkdown: renders annotated Files Changed when present', () => {
  const md = renderDemoMarkdown(richModel());
  assert.match(md, /## Files Changed/);
  assert.match(md, /`src\/theme\.ts` — new toggle logic/);
});

test('renderDemoMarkdown: renders a harness metric table when present', () => {
  const m = validModel();
  m.checkpoints[0].kind = 'harness';
  m.checkpoints[0].metrics = [
    { label: 'fps', unit: 'fps', before: '30', after: '60', deltaPct: 100, parity: 'diverged' },
  ];
  const md = renderDemoMarkdown(m);
  assert.match(md, /\| metric \| before \| after \| Δ \| parity \|/);
  assert.match(md, /\| fps \| 30 \| 60 \| \+100\.0% \| diverged \|/);
});

// ── renderDemoHtml ────────────────────────────────────────────────────────

test('renderDemoHtml: produces self-contained HTML carrying the essence', () => {
  const html = renderDemoHtml(validModel(), '2026-05-30T00:00:00.000Z');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /follows the OS by default/);
});

test('renderDemoHtml: rich sections appear in HTML output', () => {
  const html = renderDemoHtml(richModel(), '2026-05-30T00:00:00.000Z');
  assert.match(html, /id="summary"/);
  assert.match(html, /id="api-diff"/);
  assert.match(html, /id="test-evidence"/);
  assert.match(html, /id="files-changed"/);
});

// ── renderDemoBundle ──────────────────────────────────────────────────────

test('renderDemoBundle: valid demo.json → writes derived DEMO.md + DEMO.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  writeFileSync(join(dir, 'demo.json'), JSON.stringify(richModel()));
  const res = renderDemoBundle(dir, '2026-05-30T00:00:00.000Z');
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.ok(existsSync(join(dir, 'DEMO.md')));
  assert.ok(existsSync(join(dir, 'DEMO.html')));
  const md = readFileSync(join(dir, 'DEMO.md'), 'utf8');
  assert.match(md, /Dark mode toggle/);
  assert.match(md, /Summary/);
  const html = readFileSync(join(dir, 'DEMO.html'), 'utf8');
  assert.match(html, /id="api-diff"/);
});

test('renderDemoBundle: invalid demo.json → errors, writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  writeFileSync(join(dir, 'demo.json'), JSON.stringify({ title: 'x' }));
  const res = renderDemoBundle(dir, 'T');
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0);
  assert.ok(!existsSync(join(dir, 'DEMO.md')));
});

test('renderDemoBundle: missing demo.json → clear error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  mkdirSync(join(dir, 'sub'), { recursive: true });
  const res = renderDemoBundle(join(dir, 'sub'), 'T');
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /demo\.json not found/);
});

// ── mergeCapturedMedia ────────────────────────────────────────────────────

test('mergeCapturedMedia: fills images on matching checkpoints + appends unmatched', () => {
  const m = validModel(); // checkpoint label 'toggle'
  const merged = mergeCapturedMedia(m, [
    { label: 'toggle', beforeImage: 'data:image/png;base64,B', afterImage: 'data:image/png;base64,A' },
    { label: 'extra', afterImage: 'data:image/png;base64,X' },
  ]);
  const toggle = merged.checkpoints.find((c) => c.label === 'toggle')!;
  assert.equal(toggle.beforeImage, 'data:image/png;base64,B');
  assert.equal(toggle.afterImage, 'data:image/png;base64,A');
  const extra = merged.checkpoints.find((c) => c.label === 'extra')!;
  assert.ok(extra, 'unmatched captured label appended');
  assert.equal(extra.afterImage, 'data:image/png;base64,X');
  // The merged model still validates (images are data: URIs).
  assert.deepEqual(validateDemoModel(merged), []);
  // Original is untouched (immutability).
  assert.equal(m.checkpoints[0].beforeImage, undefined);
});

// ── Wave C1: usage_example + impact ──────────────────────────────────────

test('validateDemoModel: usage_example + impact are accepted when valid', () => {
  const m = validModel();
  m.usage_example = 'resource "betterado_task_group" "demo" {}';
  m.impact = ['Enables task-group provisioning via Terraform.', 'Unblocks W2 resource imports.'];
  assert.deepEqual(validateDemoModel(m), []);
});

test('validateDemoModel: rejects non-string usage_example', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.usage_example = 42;
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('usage_example')));
});

test('validateDemoModel: rejects non-array impact', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.impact = 'unlocks stuff';
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('impact')));
});

test('validateDemoModel: rejects invalid parity value in harness metric', () => {
  const m = validModel();
  m.checkpoints[0].kind = 'harness';
  m.checkpoints[0].metrics = [
    // @ts-expect-error — intentionally invalid parity
    { label: 'fps', before: '30', after: '60', deltaPct: 100, parity: 'pass' },
  ];
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('parity') && e.includes('"pass"')));
});

test('validateDemoModel: accepts all valid parity values', () => {
  for (const parity of ['match', 'within', 'diverged', 'incomplete'] as const) {
    const m = validModel();
    m.checkpoints[0].kind = 'harness';
    m.checkpoints[0].metrics = [
      { label: 'x', before: '1', after: '1', deltaPct: 0, parity },
    ];
    assert.deepEqual(validateDemoModel(m), [], `parity "${parity}" should be valid`);
  }
});

test('renderDemoMarkdown: harness-only checkpoints use "## Test Evidence" heading', () => {
  const m = validModel();
  m.checkpoints[0].kind = 'harness';
  m.checkpoints[0].metrics = [
    { label: 'completed', before: '148', after: '149', deltaPct: 0.7, parity: 'within' },
  ];
  const md = renderDemoMarkdown(m);
  assert.match(md, /## Test Evidence/);
  assert.ok(!md.includes('## Visual Changes'), 'no Visual Changes heading for harness-only');
});

test('renderDemoMarkdown: screenshot checkpoint uses "## Visual Changes" heading', () => {
  const md = renderDemoMarkdown(validModel());
  assert.match(md, /## Visual Changes/);
  assert.ok(!md.includes('## Test Evidence\n'), 'no Test Evidence heading for screenshot');
});

test('renderDemoMarkdown: renders ## Usage section when usage_example set', () => {
  const m = validModel();
  m.usage_example = 'resource "betterado_task_group" "demo" {\n  name = "test"\n}';
  const md = renderDemoMarkdown(m);
  assert.match(md, /## Usage/);
  assert.match(md, /betterado_task_group/);
});

test('renderDemoMarkdown: renders ## Impact section when impact set', () => {
  const m = validModel();
  m.impact = ['Enables task-group provisioning.', 'Unblocks W2 resource imports.'];
  const md = renderDemoMarkdown(m);
  assert.match(md, /## Impact/);
  assert.match(md, /- Enables task-group provisioning\./);
  assert.match(md, /- Unblocks W2 resource imports\./);
});

test('renderDemoMarkdown: strips AGENT.md / PROMPT.md / fix_plan.md from diffStat', () => {
  const m = validModel();
  m.diffStat = ' src/theme.ts | 40 ++++\n AGENT.md | 10 +\n fix_plan.md | 5 +\n PROMPT.md | 3 +\n 4 files changed';
  const md = renderDemoMarkdown(m);
  assert.ok(!md.includes('AGENT.md'), 'AGENT.md stripped');
  assert.ok(!md.includes('fix_plan.md'), 'fix_plan.md stripped');
  assert.ok(!md.includes('PROMPT.md'), 'PROMPT.md stripped');
  assert.match(md, /src\/theme\.ts/);
});

// ── toComparisonModel ─────────────────────────────────────────────────────

test('toComparisonModel: fills render-only defaults (build ok, refs)', () => {
  const cm = toComparisonModel({ ...validModel(), baseRef: undefined, changedRef: undefined }, 'T');
  assert.equal(cm.generatedAt, 'T');
  assert.equal(cm.baselineBuild.ok, true);
  assert.equal(cm.baseRef, 'main');
  assert.equal(cm.changedRef, 'HEAD');
  assert.equal(cm.checkpoints[0].kind, 'screenshot');
});

test('toComparisonModel: passes through rich sections to comparison model', () => {
  const cm = toComparisonModel(richModel(), 'T');
  assert.ok(cm.summary?.bullets.length === 2);
  assert.equal(cm.summary?.prUrl, 'https://github.com/org/repo/pull/99');
  assert.equal(cm.apiDiff?.length, 1);
  assert.equal(cm.testEvidence?.length, 1);
  assert.equal(cm.filesChanged?.length, 2);
});

test('toComparisonModel: passes through usage_example + impact', () => {
  const m = validModel();
  m.usage_example = 'resource "betterado_task_group" "x" {}';
  m.impact = ['Enables provisioning.'];
  const cm = toComparisonModel(m, 'T');
  assert.equal(cm.usage_example, 'resource "betterado_task_group" "x" {}');
  assert.deepEqual(cm.impact, ['Enables provisioning.']);
});

test('toComparisonModel: strips scratch files from diffStat', () => {
  const m = validModel();
  m.diffStat = ' src/main.ts | 10 +\n AGENT.md | 3 +\n fix_plan.md | 2 +';
  const cm = toComparisonModel(m, 'T');
  assert.ok(!cm.diffStat?.includes('AGENT.md'));
  assert.ok(!cm.diffStat?.includes('fix_plan.md'));
  assert.ok(cm.diffStat?.includes('src/main.ts'));
});
