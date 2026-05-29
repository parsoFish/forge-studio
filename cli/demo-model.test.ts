/**
 * Tests for the unified structured demo model (ADR 021) — the schema validator
 * + the derived DEMO.md / DEMO.html renderers.
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

test('validateDemoModel: a complete core model is valid', () => {
  assert.deepEqual(validateDemoModel(validModel()), []);
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

test('renderDemoMarkdown: includes essence, captions, ACs, diffstat', () => {
  const md = renderDemoMarkdown(validModel());
  assert.match(md, /# Dark mode toggle/);
  assert.match(md, /follows the OS by default/);
  assert.match(md, /Toggling dark mode in settings/);
  assert.match(md, /Acceptance criteria/);
  assert.match(md, /1 file changed/);
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

test('renderDemoHtml: produces self-contained HTML carrying the essence', () => {
  const html = renderDemoHtml(validModel(), '2026-05-30T00:00:00.000Z');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /follows the OS by default/);
});

test('renderDemoBundle: valid demo.json → writes derived DEMO.md + DEMO.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  writeFileSync(join(dir, 'demo.json'), JSON.stringify(validModel()));
  const res = renderDemoBundle(dir, '2026-05-30T00:00:00.000Z');
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.ok(existsSync(join(dir, 'DEMO.md')));
  assert.ok(existsSync(join(dir, 'DEMO.html')));
  assert.match(readFileSync(join(dir, 'DEMO.md'), 'utf8'), /Dark mode toggle/);
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

test('toComparisonModel: fills render-only defaults (build ok, refs)', () => {
  const cm = toComparisonModel({ ...validModel(), baseRef: undefined, changedRef: undefined }, 'T');
  assert.equal(cm.generatedAt, 'T');
  assert.equal(cm.baselineBuild.ok, true);
  assert.equal(cm.baseRef, 'main');
  assert.equal(cm.changedRef, 'HEAD');
  assert.equal(cm.checkpoints[0].kind, 'screenshot');
});
