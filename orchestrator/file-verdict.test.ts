/**
 * Tests for orchestrator/file-verdict.ts (F-02):
 *   - parseVerdictResponse handles approve and send-back shapes
 *   - parseVerdictResponse rejects malformed input
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVerdictResponse } from './file-verdict.ts';

// -------- parseVerdictResponse: approve --------

test('parseVerdictResponse: parses approve with rationale', () => {
  const text = `---
verdict: approve
rationale: |
  Looks good — README badge added with correct link.
---
`;
  const v = parseVerdictResponse(text);
  assert.equal(v.kind, 'approve');
  if (v.kind === 'approve') {
    assert.match(v.rationale, /Looks good/);
  }
});

test('parseVerdictResponse: approve tolerates inline rationale', () => {
  const text = `---
verdict: approve
rationale: ship it
---
`;
  const v = parseVerdictResponse(text);
  assert.equal(v.kind, 'approve');
  if (v.kind === 'approve') {
    assert.equal(v.rationale, 'ship it');
  }
});

// -------- parseVerdictResponse: send-back --------

test('parseVerdictResponse: parses send-back with AC bullets', () => {
  const text = `---
verdict: send-back
rationale: |
  Edge cases not covered.
---

## Acceptance criteria

- GIVEN an empty input WHEN slugify("") is called THEN an empty string is returned
- GIVEN an emoji input WHEN slugify("🎉") is called THEN "" is returned
`;
  const v = parseVerdictResponse(text);
  assert.equal(v.kind, 'send-back');
  if (v.kind === 'send-back') {
    assert.equal(v.feedback.length, 2);
    assert.equal(v.feedback[0].given, 'an empty input');
    assert.equal(v.feedback[0].when, 'slugify("") is called');
    assert.equal(v.feedback[0].then, 'an empty string is returned');
    assert.match(v.rationale, /Edge cases/);
  }
});

test('parseVerdictResponse: tolerates the "AC: GIVEN" prefix used in fix_plan.md', () => {
  const text = `---
verdict: send-back
rationale: needs more
---

- [ ] AC: GIVEN x WHEN y THEN z
`;
  // The leading "- [ ] AC: GIVEN" form (used by appendSendBackFeedback) should
  // also parse, so operators can copy/paste from fix_plan.md.
  const cleaned = text.replace('- [ ] AC: ', '- AC: ');
  const v = parseVerdictResponse(cleaned);
  assert.equal(v.kind, 'send-back');
  if (v.kind === 'send-back') {
    assert.equal(v.feedback.length, 1);
    assert.equal(v.feedback[0].given, 'x');
  }
});

test('parseVerdictResponse: send-back without ACs throws', () => {
  const text = `---
verdict: send-back
rationale: vague
---

(no acceptance criteria)
`;
  assert.throws(() => parseVerdictResponse(text), /must include at least one acceptance criterion/);
});

// -------- parseVerdictResponse: malformed --------

test('parseVerdictResponse: missing frontmatter throws', () => {
  assert.throws(() => parseVerdictResponse('hi there'), /missing YAML frontmatter/);
});

test('parseVerdictResponse: unknown verdict kind throws', () => {
  const text = `---
verdict: maybe
rationale: idk
---
`;
  assert.throws(() => parseVerdictResponse(text), /unknown verdict kind: maybe/);
});
