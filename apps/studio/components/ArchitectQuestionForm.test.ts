/**
 * DOM contract for `ArchitectQuestionForm` — bead `forge-8vfn.6.11.21`,
 * T1 rulings 266/271.
 *
 * S2 run 3 (the lane's LAST S2 run) spent its $25 discovering that beat 12
 * names `[data-field="session-answer"]`, a handle only the GENERIC
 * `SessionInteractivePanel` publishes. The architect kind is excluded from that
 * affordance BY DESIGN (`bridge-studio-sessions-affordance-shell.ts`: "never
 * `architect` (no writable affordance)"), so an architect session renders THIS
 * component instead — and this component published no `data-field` at all.
 *
 * The story runner builds every fill step's selector as
 * `[data-field="<value>"]` (`scripts/stories/beats.mjs`), and §3.1 forbids a
 * story from naming a CSS selector. So the architect's interview was
 * unreachable by any story: not "the beat named the wrong handle", but "no
 * handle existed to name".
 *
 * The fix is additive and the VALUE names the field kind, exactly as
 * `session-answer` does on the generic panel. The indexed
 * `data-question-freetext={i}` stays — four journeys select on it
 * (`stand-up-create.mjs`, `flows-run.mjs`) and it is what distinguishes one
 * question's box from another's.
 *
 * RUN: npx vitest run components/ArchitectQuestionForm.test.ts   (from apps/studio/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchitectQuestionForm } from './ArchitectQuestionForm';

const QUESTIONS = [
  { question: 'What is the quality gate?', options: [{ label: 'npm test', description: 'the usual' }] },
  { question: 'What must never change?', options: [{ label: 'the CLI output', description: 'humans read it' }] },
  { question: 'Where do timings come from?', options: [{ label: 'the build tool', description: 'never re-implement' }] },
];

const render = (questions: unknown[] = QUESTIONS) =>
  renderToStaticMarkup(
    React.createElement(ArchitectQuestionForm as never, {
      project: 'story-s2',
      sessionId: 'sess-1',
      round: 1,
      questions,
    } as never),
  );

test('AT-6.11.21-1 (RED) every free-text box declares data-field="question-freetext"', () => {
  const html = render();
  const matches = html.match(/data-field="question-freetext"/g) ?? [];
  expect(
    matches.length,
    `one per question, so a story can answer all of them: ${matches.length} of ${QUESTIONS.length}`,
  ).toBe(QUESTIONS.length);
});

test('AT-6.11.21-2 the indexed handle is KEPT — four journeys select on it', () => {
  const html = render();
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    expect(html, `data-question-freetext="${i}" must survive`).toContain(`data-question-freetext="${i}"`);
  }
});

test('AT-6.11.21-3 both handles ride the SAME element, so filling by field hits the indexed box', () => {
  const html = render();
  // A textarea carrying one but not the other would satisfy both pins above and
  // still leave the story filling something the journeys do not exercise.
  const withBoth = html.match(/<textarea[^>]*data-question-freetext="\d+"[^>]*>/g) ?? [];
  expect(withBoth.length, 'every indexed textarea found').toBe(QUESTIONS.length);
  for (const tag of withBoth) {
    expect(tag, `same element carries both handles: ${tag}`).toContain('data-field="question-freetext"');
  }
});

test('AT-6.11.21-4 (positive control) a single-question round still publishes exactly one of each', () => {
  const html = render([QUESTIONS[0]]);
  expect((html.match(/data-field="question-freetext"/g) ?? []).length).toBe(1);
  expect(html).toContain('data-question-freetext="0"');
});
