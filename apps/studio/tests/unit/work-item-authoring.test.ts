/**
 * forge-nk1y.12 — the pure work-item authoring parse both callers share (the
 * Kickoff gate's add today; the verdict gate's send-back next): gate command
 * split on whitespace and refused by name on a quote, files one per line, and
 * ONE nullable reason for the disabled submit.
 *
 * RUN: npx vitest run tests/unit/work-item-authoring.test.ts   (from apps/studio/)
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
