/**
 * `parseUserQuestionsMd` — the reflector's `user-questions.md` →
 * `user-questions.json` parse (bead forge-8vfn.8.1.35, ruling 1736).
 *
 * S10 proof run 36's `user-questions.json` began with the file's own H1 title
 * as question 0 (`header: "# User quest"`, no options): the split on
 * `^(?=## )` kept everything before the first `## ` heading as a section. The
 * fixture below has the real file's shape — an H1 title line, then numbered
 * `## ` sections, one with a bullet option list and two without.
 *
 * Its own file, not `reflector.test.ts`, which is at its size exemption.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUserQuestionsMd } from '../../phases/reflector.ts';

const RUN_36_SHAPE = [
  '# User questions — INIT-2026-09-27-exclude-author-filter',
  '',
  '## 1. Was the work-item decomposition the right size?',
  '',
  'WI-2 was the largest: all CLI wiring in a single WI. It completed cleanly but was wide.',
  '',
  '- too-few WIs (WI-2 was too large; should split by output-format)',
  '- right-sized (4 WIs for this scope is appropriate)',
  '- too-many WIs',
  '',
  '## 2. Did the implementation match the design intent?',
  '',
  'The PR description states it explicitly as a fix, not scope drift.',
  '',
  '## 3. Any other notes on this initiative?',
  '',
  '_(freeform — precedence semantics, annotation UX, cost, anything)_',
  '',
].join('\n');

test('parseUserQuestionsMd: the H1 title and preamble are not a question', () => {
  const questions = parseUserQuestionsMd(RUN_36_SHAPE);
  assert.equal(questions.length, 3, 'one question per ## section, and nothing else');
  for (const q of questions) {
    assert.ok(!/^#\s/.test(q.header), `a heading leaked in as a question: "${q.header}"`);
  }
});

test('parseUserQuestionsMd: the ## sections keep their order and their options', () => {
  const questions = parseUserQuestionsMd(RUN_36_SHAPE);
  assert.match(questions[0].question, /WI-2 was the largest/);
  assert.equal(questions[0].options?.length, 3);
  assert.match(questions[2].question, /freeform/);
  assert.deepEqual(questions[2].options, []);
});

// SHOULD-FIX 2 (forge-8vfn.8.1.34): a file with NO `## ` heading at all names no
// numbered question — `[]`, never the whole body read as one bogus question (the
// pre-fix behaviour this same bead's H1-preamble door already covers for a
// heading-BEFORE-the-first-`## ` prefix). Both shapes share one rule: only
// content that starts a `## ` section is ever read as a question.
test('parseUserQuestionsMd: a file with no ## heading at all yields [], never a placeholder question', () => {
  const questions = parseUserQuestionsMd('_(no open questions — prior feedback covers this cycle)_');
  assert.deepEqual(questions, []);
});
