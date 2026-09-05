import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAdversarialReviewSystemPrompt,
  renderAdversarialReviewUserPrompt,
  REVIEW_FINDINGS_FILENAME,
  REVIEW_INPUT_REL_DIR,
  type AdversarialReviewUserPromptInput,
} from './adversarial-review-binding.ts';

function baseInput(): AdversarialReviewUserPromptInput {
  return {
    initiativeId: 'INIT-2026-07-24-x',
    cycleId: 'CY-9',
    baseRef: 'main',
    headSha: 'abc1234',
    acceptanceCriteria: ['(WI-1) GIVEN a request WHEN handled THEN 200'],
    workItems: [{ id: 'WI-1', title: 'handler', status: 'complete' }],
    changedFiles: ['src/handler.ts', 'src/router.ts'],
    lenses: ['correctness', 'containment', 'test-strength', 'boundary'],
    brainContext: [{ path: 'brain/projects/fix/profile.md', content: 'Convention: handlers never throw.' }],
  };
}

test('system prompt inlines the adversarial-review skill, byte-stable across calls', () => {
  const a = buildAdversarialReviewSystemPrompt();
  assert.equal(a, buildAdversarialReviewSystemPrompt());
  assert.ok(a.includes('name: adversarial-review'));
});

test('user prompt carries run identity, review-input paths, ACs, WIs, changed files', () => {
  const p = renderAdversarialReviewUserPrompt(baseInput());
  assert.ok(p.includes('INIT-2026-07-24-x'));
  assert.ok(p.includes('CY-9'));
  assert.ok(p.includes('abc1234'));
  assert.ok(p.includes(`${REVIEW_INPUT_REL_DIR}/diff.patch`));
  assert.ok(p.includes(`${REVIEW_INPUT_REL_DIR}/diffstat.txt`));
  assert.ok(p.includes(`${REVIEW_INPUT_REL_DIR}/changed-files.txt`));
  assert.ok(p.includes('(WI-1) GIVEN a request WHEN handled THEN 200'));
  assert.ok(p.includes('src/handler.ts'));
  assert.ok(p.includes(`.forge/${REVIEW_FINDINGS_FILENAME}`));
});

test('user prompt states the severity vocabulary and the findings contract', () => {
  const p = renderAdversarialReviewUserPrompt(baseInput());
  assert.ok(/blocker.*major.*minor.*info/s.test(p), 'severity vocabulary verbatim');
  assert.ok(/findings:\s*\[\]|findings.*\[\]/s.test(p), 'empty-findings clean pass stated');
});

test('the category vocabulary in the prompt is the CLASS\'s lens set, not a fixed four', () => {
  // The prompt the agent is judged against must offer the SAME lenses the
  // validator enforces; a prompt naming one vocabulary while the check enforced
  // another rejects correct work for a reason nobody was told.
  const code = renderAdversarialReviewUserPrompt(baseInput());
  for (const lens of ['correctness', 'containment', 'test-strength', 'boundary']) {
    assert.ok(code.includes(lens), `code lens ${lens} named in the prompt`);
  }
  const docs = renderAdversarialReviewUserPrompt({
    ...baseInput(),
    lenses: ['accuracy-against-source', 'link-integrity', 'forbidden-tokens', 'structure'],
  });
  assert.ok(docs.includes('link-integrity'));
  assert.ok(!docs.includes('regression-risk'), 'a docs review is not critiqued for regression risk');
});

test('the prompt demands one verdict per criterion, matched verbatim, plus the Why/What/How', () => {
  const p = renderAdversarialReviewUserPrompt(baseInput());
  assert.ok(p.includes('acEvaluations'), 'the per-AC verdict is part of the authored contract');
  assert.ok(/VERBATIM/i.test(p), 'the criterion string is copied verbatim, not paraphrased');
  assert.ok(p.includes('whyWhatHow'));
});

test('brain context renders marked advisory; omitted cleanly when absent', () => {
  const withBrain = renderAdversarialReviewUserPrompt(baseInput());
  assert.ok(withBrain.includes('handlers never throw'));
  assert.ok(/advisory/i.test(withBrain));
  const without = renderAdversarialReviewUserPrompt({ ...baseInput(), brainContext: [] });
  assert.ok(!without.includes('handlers never throw'));
});
