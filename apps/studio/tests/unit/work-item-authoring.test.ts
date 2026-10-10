/**
 * forge-nk1y.12 — the pure work-item authoring parse both callers share (the
 * Kickoff gate's add today; the verdict gate's send-back next): gate command
 * split on whitespace and refused by name on a quote, files one per line, and
 * ONE nullable reason for the disabled submit.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/unit/work-item-authoring.test.ts
 */
import { test, expect } from 'vitest';

import {
  emptyWorkItemDraft, parseGateCmd, parseFilesInScope, workItemDraftMissing, workItemDraftToSource,
} from '../../lib/work-item-authoring';

const FULL = {
  summary: '  Retire the legacy specs.  ',
  acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }, { given: '', when: '', then: '' }],
  gateCmd: '  node --test   tests/retire.test.ts ',
  files: 'specs/legacy.md\n\n  tests/retire.test.ts  \n',
};

test('the gate command splits on whitespace into argv', () => {
  expect(parseGateCmd(FULL.gateCmd)).toEqual({ argv: ['node', '--test', 'tests/retire.test.ts'] });
});

test('a quote in the gate command is refused by name — argv has no shell quoting', () => {
  for (const q of [`bash -c "a b"`, `echo 'x'`, 'echo `x`']) {
    const r = parseGateCmd(q);
    expect('error' in r && r.error).toMatch(/quote/);
  }
});

test('files: one path per line, trimmed, blanks dropped', () => {
  expect(parseFilesInScope(FULL.files)).toEqual(['specs/legacy.md', 'tests/retire.test.ts']);
});

test('the missing-field reason names the first empty required field, null when complete', () => {
  const empty = emptyWorkItemDraft();
  expect(workItemDraftMissing(empty)).toMatch(/summary/);
  expect(workItemDraftMissing({ ...empty, summary: 's' })).toMatch(/acceptance criterion/);
  const withAc = { ...empty, summary: 's', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] };
  expect(workItemDraftMissing(withAc)).toMatch(/gate command/);
  expect(workItemDraftMissing({ ...withAc, gateCmd: 'npm test' })).toMatch(/file/);
  expect(workItemDraftMissing(FULL)).toBeNull();
});

test('the draft maps to the request source: trimmed, complete ACs only', () => {
  expect(workItemDraftToSource(FULL)).toEqual({
    source: {
      summary: 'Retire the legacy specs.',
      acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
      qualityGateCmd: ['node', '--test', 'tests/retire.test.ts'],
      filesInScope: ['specs/legacy.md', 'tests/retire.test.ts'],
    },
  });
  expect(workItemDraftToSource({ ...FULL, gateCmd: 'bash -c "a"' })).toEqual({ error: expect.stringMatching(/quote/) });
});

// ---- forge-mfv5.1.28 — the verdict gate's typed send-back ------------------

import { sendBackDraftMissing, sendBackDraftToSource } from '../../lib/work-item-authoring';

test('a typed send-back with no complete criterion is refused naming BOTH inputs it could have had', () => {
  const r = sendBackDraftMissing({ ...emptyWorkItemDraft() });
  expect(r).toMatch(/blocking comment/);
  expect(r).toMatch(/acceptance criterion/);
});

test('a typed send-back needs only criteria — gate and scope are optional (absent ⇒ the project gate / WI-scope union)', () => {
  const d = { ...emptyWorkItemDraft(), acceptanceCriteria: [{ given: ' g ', when: 'w', then: 't' }] };
  expect(sendBackDraftMissing(d)).toBeNull();
  expect(sendBackDraftToSource(d)).toEqual({ source: { acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] } });
});

test('a typed send-back carries the gate as argv and the files one per line', () => {
  const d = { ...FULL, summary: '' };
  expect(sendBackDraftToSource(d)).toEqual({
    source: {
      acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
      qualityGateCmd: ['node', '--test', 'tests/retire.test.ts'],
      filesInScope: ['specs/legacy.md', 'tests/retire.test.ts'],
    },
  });
});

test('a quoted gate on a typed send-back is refused by name', () => {
  const d = { ...FULL, gateCmd: 'pytest -k "a b"' };
  expect(sendBackDraftMissing(d)).toMatch(/quote/);
  expect('error' in sendBackDraftToSource(d)).toBe(true);
});
