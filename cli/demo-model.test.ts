/**
 * Tests for the unified structured demo model (ADR 021 / REV-4 / F4) — the
 * schema validator + the derived DEMO.md renderer (the single demo OUTPUT;
 * DEMO.html was retired in F4). Covers the rich structured sections: summary,
 * apiDiff, testEvidence, filesChanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateDemoModel,
  coerceDemoModel,
  renderDemoMarkdown,
  renderDemoBundle,
  mergeCapturedMedia,
  collectCapturedMedia,
  MAX_CAPTURED_OUTPUT_BYTES,
  collectLiveEvidence,
  mergeLiveEvidence,
  stampCaptureNonce,
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

// ── coerceDemoModel — forgiving normalize (testEvidence object → array) ─────

test('coerceDemoModel: testEvidence object map → TestResultRow[] (the gitpulse wedge)', () => {
  const raw = {
    ...validModel(),
    testEvidence: {
      qualityGate: 'npm test → 16/16 pass',
      churnSuite: 'node --test test/churn.test.ts → 8/8 pass',
      brokenSuite: 'window.test.ts → 2 failed',
    },
  };
  const { model, changed } = coerceDemoModel(raw);
  assert.equal(changed, true, 'an object testEvidence must be coerced');
  const te = (model as DemoModel).testEvidence!;
  assert.ok(Array.isArray(te), 'coerced testEvidence is an array');
  assert.equal(te.length, 3);
  assert.deepEqual(te[0], { name: 'qualityGate', result: 'pass', delta: 'npm test → 16/16 pass' });
  assert.equal(te[2].result, 'fail', 'a value mentioning "failed" infers result=fail');
  // The coerced model must now pass schema validation (the whole point).
  assert.deepEqual(validateDemoModel(model), []);
});

test('coerceDemoModel: an already-array testEvidence is unchanged', () => {
  const raw = richModel();
  const { model, changed } = coerceDemoModel(raw);
  assert.equal(changed, false);
  assert.deepEqual(model, raw);
});

test('coerceDemoModel: object rows that already carry {result} are preserved', () => {
  const raw = { ...validModel(), testEvidence: { unit: { result: 'skip', delta: '+0' } } };
  const { model } = coerceDemoModel(raw);
  assert.deepEqual((model as DemoModel).testEvidence, [{ name: 'unit', result: 'skip', delta: '+0' }]);
});

test('validateDemoModel: a non-array testEvidence error names the expected shape', () => {
  const errs = validateDemoModel({ ...validModel(), testEvidence: { a: 'b' } });
  assert.ok(errs.some((e) => e.includes('testEvidence must be an array') && e.includes('name')), errs.join('; '));
});

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

// ── renderDemoBundle ──────────────────────────────────────────────────────

test('renderDemoBundle: valid demo.json → writes ONLY DEMO.md (DEMO.html retired in F4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  writeFileSync(join(dir, 'demo.json'), JSON.stringify(richModel()));
  const res = renderDemoBundle(dir);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.wrote, [join(dir, 'DEMO.md')], 'bundle writes only DEMO.md');
  assert.ok(existsSync(join(dir, 'DEMO.md')));
  assert.ok(!existsSync(join(dir, 'DEMO.html')), 'DEMO.html must not be generated');
  const md = readFileSync(join(dir, 'DEMO.md'), 'utf8');
  assert.match(md, /Dark mode toggle/);
  assert.match(md, /Summary/);
});

test('renderDemoBundle: invalid demo.json → errors, writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  writeFileSync(join(dir, 'demo.json'), JSON.stringify({ title: 'x' }));
  const res = renderDemoBundle(dir);
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

// ── renderDemoMarkdown: scratch-file stripping ────────────────────────────

test('renderDemoMarkdown: strips scratch files from the diffStat', () => {
  const m = validModel();
  m.diffStat = ' src/main.ts | 10 +\n AGENT.md | 3 +\n fix_plan.md | 2 +';
  const md = renderDemoMarkdown(m);
  assert.ok(!md.includes('AGENT.md'));
  assert.ok(!md.includes('fix_plan.md'));
  assert.ok(md.includes('src/main.ts'));
});

// ── acEvaluations — validation ────────────────────────────────────────────

test('validateDemoModel: absent acEvaluations is valid', () => {
  const m = validModel();
  assert.deepEqual(validateDemoModel(m), []);
});

test('validateDemoModel: valid acEvaluations array is accepted', () => {
  const m = validModel();
  m.acEvaluations = [
    { criterion: 'GIVEN X WHEN Y THEN Z', verdict: 'met', evidence: 'All 3 tests pass.' },
    { criterion: 'GIVEN A WHEN B THEN C', verdict: 'partial', evidence: 'Feature exists but edge case missing.' },
    { criterion: 'GIVEN P WHEN Q THEN R', verdict: 'missed', evidence: 'No implementation yet.' },
  ];
  assert.deepEqual(validateDemoModel(m), []);
});

test('validateDemoModel: acEvaluations must be array when set', () => {
  const m = validModel();
  // @ts-expect-error — intentionally malformed
  m.acEvaluations = 'not-an-array';
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('acEvaluations must be an array')));
});

test('validateDemoModel: rejects acEvaluations entry with blank criterion', () => {
  const m = validModel();
  m.acEvaluations = [
    { criterion: '   ', verdict: 'met', evidence: 'Some evidence' },
  ];
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('acEvaluations[0].criterion')));
});

test('validateDemoModel: rejects acEvaluations entry with invalid verdict', () => {
  const m = validModel();
  m.acEvaluations = [
    // @ts-expect-error — intentionally malformed
    { criterion: 'GIVEN X WHEN Y THEN Z', verdict: 'pass', evidence: 'Some evidence' },
  ];
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('acEvaluations[0].verdict')));
});

test('validateDemoModel: rejects acEvaluations entry with blank evidence', () => {
  const m = validModel();
  m.acEvaluations = [
    { criterion: 'GIVEN X WHEN Y THEN Z', verdict: 'met', evidence: '' },
  ];
  const errs = validateDemoModel(m);
  assert.ok(errs.some((e) => e.includes('acEvaluations[0].evidence')));
});

test('renderDemoMarkdown: renders acEvaluations section when present', () => {
  const m = validModel();
  m.acEvaluations = [
    { criterion: 'GIVEN X WHEN Y THEN Z', verdict: 'met', evidence: 'All tests pass.' },
    { criterion: 'GIVEN A WHEN B THEN C', verdict: 'missed', evidence: 'Not implemented.' },
  ];
  const md = renderDemoMarkdown(m);
  assert.match(md, /## Intent & Outcome/);
  assert.match(md, /GIVEN X WHEN Y THEN Z/);
  assert.match(md, /✓ met/);
  assert.match(md, /✗ missed/);
  assert.match(md, /All tests pass\./);
});

// ── live evidence (the "show the real resource" gate) ───────────────────────
test('mergeLiveEvidence: matching label attaches liveEvidence; unmatched appends a harness checkpoint', () => {
  const model = { title: 't', essence: 'e', checkpoints: [{ label: 'acceptance-resource', caption: 'c' }] } as unknown as Parameters<typeof mergeLiveEvidence>[0];
  const merged = mergeLiveEvidence(model, [
    { label: 'acceptance-resource', url: 'https://vsrm.dev.azure.com/o/p/_apis/release/taskgroups/123', response: '{"id":"123"}' },
    { label: 'extra', url: 'https://dev.azure.com/o/_apis/x' },
  ]);
  const matched = merged.checkpoints.find((c) => c.label === 'acceptance-resource');
  assert.ok(matched?.liveEvidence);
  assert.equal(matched.liveEvidence.url, 'https://vsrm.dev.azure.com/o/p/_apis/release/taskgroups/123');
  const appended = merged.checkpoints.find((c) => c.label === 'extra');
  assert.ok(appended, 'unmatched evidence appended as its own checkpoint');
  assert.equal(appended.kind, 'harness');
  assert.equal(appended.liveEvidence?.url, 'https://dev.azure.com/o/_apis/x');
});

test('mergeLiveEvidence: empty evidence → model unchanged', () => {
  const model = { title: 't', essence: 'e', checkpoints: [{ label: 'a', caption: 'c' }] } as unknown as Parameters<typeof mergeLiveEvidence>[0];
  assert.equal(mergeLiveEvidence(model, []), model);
});

test('collectLiveEvidence: reads .forge/live-evidence/*.json, skips malformed/urlless/non-json', () => {
  const wt = mkdtempSync(join(tmpdir(), 'le-'));
  const dir = join(wt, '.forge', 'live-evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task-group.json'), JSON.stringify({ url: 'https://vsrm/_apis/release/taskgroups/9', capturedAt: '2026-06-16', response: { id: 9 } }));
  writeFileSync(join(dir, 'no-url.json'), JSON.stringify({ foo: 'bar' }));
  writeFileSync(join(dir, 'bad.json'), '{not json');
  writeFileSync(join(dir, 'ignore.txt'), 'nope');
  const ev = collectLiveEvidence(wt);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].url, 'https://vsrm/_apis/release/taskgroups/9');
  assert.equal(ev[0].label, 'task-group');
  assert.equal(typeof ev[0].response, 'string'); // object response stringified
});

test('collectLiveEvidence: missing dir → []', () => {
  assert.deepEqual(collectLiveEvidence(mkdtempSync(join(tmpdir(), 'le2-'))), []);
});

// ── S9 refinement: captured CLI output (real before/after stdout, not prose) ──

test('validateDemoModel: a checkpoint with command + before/after output is valid', () => {
  const model = {
    title: 'T', essence: 'E', project: 'gitpulse', diffStat: '1 file changed',
    checkpoints: [{
      label: 'churn', caption: 'CLI run — churn',
      command: 'node dist/cli.js churn .',
      beforeOutput: 'author   commits\nAda      3\n',
      afterOutput: 'author   commits  churn\nAda      3   +3/-0\n',
    }],
  };
  assert.deepEqual(validateDemoModel(model), []);
});

test('validateDemoModel: rejects a blank command + oversize captured output', () => {
  const big = 'x'.repeat(MAX_CAPTURED_OUTPUT_BYTES + 1);
  const errs = validateDemoModel({
    title: 'T', essence: 'E', project: 'p', diffStat: 'd',
    checkpoints: [{ label: 'c', caption: 'c', command: '   ', beforeOutput: big }],
  });
  assert.ok(errs.some((e) => e.includes('command must be a non-empty string')), `command error, got ${errs}`);
  assert.ok(errs.some((e) => e.includes('beforeOutput exceeds')), `oversize error, got ${errs}`);
});

test('collectCapturedMedia: picks up before/<label>.out + after/<label>.out as captured stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-cap-out-'));
  mkdirSync(join(dir, 'before'), { recursive: true });
  mkdirSync(join(dir, 'after'), { recursive: true });
  writeFileSync(join(dir, 'before', 'churn.out'), 'BEFORE stdout\n');
  writeFileSync(join(dir, 'after', 'churn.out'), 'AFTER stdout\n');
  const captured = collectCapturedMedia(dir);
  const churn = captured.find((c) => c.label === 'churn');
  assert.equal(churn?.beforeOutput, 'BEFORE stdout\n');
  assert.equal(churn?.afterOutput, 'AFTER stdout\n');
});

test('mergeCapturedMedia: back-fills captured outputs into a command checkpoint (kind unchanged)', () => {
  const model: DemoModel = {
    title: 'T', essence: 'E', project: 'gitpulse', diffStat: 'd',
    checkpoints: [{ label: 'churn', caption: 'CLI run', command: 'node dist/cli.js churn .' }],
  };
  const merged = mergeCapturedMedia(model, [{ label: 'churn', beforeOutput: 'B\n', afterOutput: 'A\n' }]);
  const cp = merged.checkpoints[0];
  assert.equal(cp.beforeOutput, 'B\n');
  assert.equal(cp.afterOutput, 'A\n');
  assert.notEqual(cp.kind, 'screenshot'); // a captured OUTPUT must not promote to screenshot
});

test('renderDemoMarkdown: fences the captured before/after output', () => {
  const md = renderDemoMarkdown({
    title: 'T', essence: 'E', project: 'gitpulse', diffStat: 'd',
    checkpoints: [{ label: 'churn', caption: 'CLI run', command: 'gitpulse churn .', beforeOutput: 'OLD table', afterOutput: 'NEW table' }],
  });
  assert.match(md, /\*\*Command:\*\* `gitpulse churn \.`/);
  assert.match(md, /\*\*Before output:\*\*/);
  assert.match(md, /OLD table/);
  assert.match(md, /NEW table/);
});

// ---------------------------------------------------------------------------
// N2 (plan item 2.6) — capture-nonce stamp: `forge demo capture` binds the
// artifacts it produced to the orchestrator's per-run nonce.
// ---------------------------------------------------------------------------

test('N2: stampCaptureNonce returns a NEW model carrying capture.nonce (+ capturedAt), input untouched', () => {
  const model = validModel();
  const stamped = stampCaptureNonce(model, 'nonce-xyz');
  assert.equal(stamped.capture?.nonce, 'nonce-xyz');
  assert.ok(stamped.capture?.capturedAt, 'capturedAt defaults to now');
  assert.equal(model.capture, undefined, 'immutability: the input model is not mutated');
  // The rest of the model is preserved.
  assert.equal(stamped.title, model.title);
  assert.equal(stamped.checkpoints.length, model.checkpoints.length);
});

test('N2: validateDemoModel accepts a stamped capture and rejects a malformed one', () => {
  const stamped = stampCaptureNonce(validModel(), 'nonce-abc', '2026-07-11T00:00:00.000Z');
  assert.deepEqual(validateDemoModel(stamped), []);

  const emptyNonce = { ...validModel(), capture: { nonce: '' } };
  assert.ok(
    validateDemoModel(emptyNonce).some((e) => e.includes('capture')),
    'an empty nonce must be rejected',
  );
  const notObject = { ...validModel(), capture: 'nonce-as-string' };
  assert.ok(validateDemoModel(notObject).some((e) => e.includes('capture')));
});

test('N2: the capture stamp survives coerceDemoModel and renderDemoBundle live-evidence merge', () => {
  const stamped = stampCaptureNonce(validModel(), 'nonce-persist');
  const { model: coerced } = coerceDemoModel(stamped);
  assert.equal((coerced as DemoModel).capture?.nonce, 'nonce-persist');
});
