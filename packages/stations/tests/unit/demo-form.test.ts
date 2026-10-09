/**
 * D-07 extended (forge-mfv5.1.19): demo.json carries an evidence `form` per
 * checkpoint and an optional `narrative`; `validateDemoModel` refuses an
 * unknown form, an api path off the tree's own server and an over-long
 * narrative; DEMO.md renders the narrative under "What this enables",
 * labelled as narrative, never as evidence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderDemoMarkdown, validateDemoModel, type DemoModel } from '../../demo-model.ts';
import { NARRATIVE_MAX_WORDS } from '../../demo-form.ts';

function model(extra: Partial<DemoModel> = {}, cp: Record<string, unknown> = {}): DemoModel {
  return {
    title: 'Org rulesets', essence: 'E', project: 'gitweave', diffStat: ' a | 1 +',
    checkpoints: [{ label: 'org', caption: 'The org rulesets read back', form: 'api-before-after', command: 'gitweave org show --json', ...cp }],
    ...extra,
  } as DemoModel;
}

test('every form in the closed set validates', () => {
  for (const form of ['cli-before-after', 'api-before-after', 'screenshot', 'test-evidence']) {
    assert.deepEqual(validateDemoModel(model({}, { form })), [], form);
  }
});

test('an unknown form is refused by name', () => {
  assert.match(validateDemoModel(model({}, { form: 'video-essay' })).join('\n'), /checkpoints\[0\]\.form must be one of/);
});

test('an apiPath carrying a host, protocol-relative or traversing is refused', () => {
  for (const apiPath of ['https://evil.example/x', '//evil.example/x', '/a/../../b', 'relative']) {
    assert.match(validateDemoModel(model({}, { command: undefined, apiPath })).join('\n'), /apiPath must be a path on the tree's own server/, apiPath);
  }
  assert.deepEqual(validateDemoModel(model({}, { command: undefined, apiPath: '/api/org' })), []);
});

test('apiPath is one driver: never with a command, never on another form', () => {
  assert.match(validateDemoModel(model({}, { apiPath: '/api/org' })).join('\n'), /apiPath belongs to form api-before-after alone/);
  assert.match(validateDemoModel(model({}, { command: undefined, form: 'screenshot', apiPath: '/api/org' })).join('\n'), /apiPath belongs to form api-before-after alone/);
});

test('a narrative over the word cap, or empty, is refused', () => {
  const long = Array.from({ length: NARRATIVE_MAX_WORDS + 1 }, () => 'word').join(' ');
  assert.match(validateDemoModel(model({ narrative: long })).join('\n'), /narrative is 121 words/);
  assert.match(validateDemoModel(model({ narrative: ' ' })).join('\n'), /narrative must be a non-empty string/);
  assert.deepEqual(validateDemoModel(model({ narrative: 'Admins can now see every ruleset.' })), []);
});

test('DEMO.md renders the narrative labelled as narrative, not evidence', () => {
  const md = renderDemoMarkdown(model({ narrative: 'Admins can now see every ruleset in one read.' }));
  assert.match(md, /## What this enables\n\n_Agent narrative — not evidence\._\n\nAdmins can now see every ruleset in one read\./);
  assert.doesNotMatch(renderDemoMarkdown(model()), /What this enables/);
});

test('DEMO.md names the GET a path-driven api checkpoint made', () => {
  const md = renderDemoMarkdown(model({}, { command: undefined, apiPath: '/api/org', beforeOutput: '{}', afterOutput: '{"a":1}' }));
  assert.match(md, /- \*\*GET \(each tree's own server\):\*\* `\/api\/org`/);
});
