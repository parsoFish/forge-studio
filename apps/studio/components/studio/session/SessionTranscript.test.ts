/**
 * DOM regression tests for `SessionTranscript.tsx` — W6-B9 reviewer fix: a
 * pending `questions.json` turn splits its joined multi-question text into
 * one `[data-transcript-question-index]` element per real question (a structural proof
 * that ≥2 questions actually reached the operator, restoring the journey
 * assertion the retired per-question `ArchitectQuestionForm` fieldset list
 * used to provide for instructions before it migrated onto the generic
 * `SessionInteractivePanel`'s single-box `question-form` affordance).
 *
 * Mirrors `SessionInteractivePanel.test.ts`'s own pattern: renders the REAL
 * component via `react-dom/server`'s `renderToStaticMarkup` and asserts on
 * the resulting markup string.
 *
 * RUN: npx vitest run components/studio/session/SessionTranscript.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionTranscript } from './SessionTranscript';
import type { SessionTurn } from '@/lib/session-client';

function render(turns: readonly SessionTurn[], emptyMessage: string | null = null): string {
  return renderToStaticMarkup(React.createElement(SessionTranscript, { turns, emptyMessage }));
}

test('a questions.json turn with 2 real questions renders TWO [data-transcript-question-index] elements (0 and 1)', () => {
  const turns: SessionTurn[] = [
    {
      index: 0,
      role: 'agent',
      stage: 'instructions',
      source: 'questions.json',
      text: 'Who is the primary audience for AGENTS.md?\n\nWhich command is the quality gate?',
    },
  ];
  const html = render(turns);
  expect(html).toContain('data-transcript-question-index="0"');
  expect(html).toContain('data-transcript-question-index="1"');
  expect(html).not.toContain('data-transcript-question-index="2"');
  expect(html).toContain('Who is the primary audience for AGENTS.md?');
  expect(html).toContain('Which command is the quality gate?');
});

test('a questions.json turn with 3 real questions renders exactly THREE [data-transcript-question-index] elements', () => {
  const turns: SessionTurn[] = [
    { index: 0, role: 'agent', stage: 'instructions', source: 'questions.json', text: 'Q1?\n\nQ2?\n\nQ3?' },
  ];
  const html = render(turns);
  const count = (html.match(/data-transcript-question-index="\d+"/g) ?? []).length;
  expect(count).toBe(3);
});

test('a NON-questions.json turn with a coincidental blank line is NOT split into fake questions — no [data-transcript-question-index] at all', () => {
  const turns: SessionTurn[] = [
    { index: 0, role: 'operator', stage: 'instructions', source: 'prompt.md', text: 'Paragraph one.\n\nParagraph two.' },
  ];
  const html = render(turns);
  expect(html).not.toContain('data-transcript-question-index');
  expect(html).toContain('Paragraph one.');
  expect(html).toContain('Paragraph two.');
});

test('a single-question questions.json turn still renders one [data-transcript-question-index="0"]', () => {
  const turns: SessionTurn[] = [
    { index: 0, role: 'agent', stage: 'instructions', source: 'questions.json', text: 'Only one question?' },
  ];
  const html = render(turns);
  expect(html).toContain('data-transcript-question-index="0"');
  expect(html).not.toContain('data-transcript-question-index="1"');
});

test('the turn-level data-* contract (data-turn-index/role/stage/source) is unaffected by the question split', () => {
  const turns: SessionTurn[] = [
    { index: 5, role: 'agent', stage: 'instructions', source: 'questions.json', text: 'Q1?\n\nQ2?' },
  ];
  const html = render(turns);
  expect(html).toContain('data-turn-index="5"');
  expect(html).toContain('data-turn-role="agent"');
  expect(html).toContain('data-turn-stage="instructions"');
  expect(html).toContain('data-turn-source="questions.json"');
});

test('an empty turns[] renders the honest emptyMessage, never a stray [data-transcript-question-index]', () => {
  const html = render([], 'No turns recorded yet.');
  expect(html).toContain('No turns recorded yet.');
  expect(html).not.toContain('data-transcript-question-index');
});

// W7-C2 T1 review (P0-3) — the SCOPED fail-closed transcript error. A corrupt
// verdicts.json used to 409 the entire session GET, so the page could not
// render at all and the operator lost the very verdict controls they needed
// to get out of that state. The refusal now lives in this pane.
test('C2-FIX-P03-3: a transcript-derivation error renders as an explicit, verbatim error state — never the quiet "no turns yet" copy', () => {
  const html = renderToStaticMarkup(React.createElement(SessionTranscript, {
    turns: [],
    emptyMessage: 'Nothing recorded in the instructions stage yet.',
    error: 'verdicts.json is not valid JSON — Unexpected end of JSON input',
  }));
  expect(html).toContain('data-transcript-error');
  expect(html).toContain('verdicts.json is not valid JSON');
  expect(html).not.toContain('Nothing recorded in the instructions stage yet.');
});

test('C2-FIX-P03-4: with no error, an empty transcript keeps its ordinary empty copy (the error state is not over-eager)', () => {
  const html = renderToStaticMarkup(React.createElement(SessionTranscript, {
    turns: [],
    emptyMessage: 'Nothing recorded in the instructions stage yet.',
    error: null,
  }));
  expect(html).not.toContain('data-transcript-error');
  expect(html).toContain('Nothing recorded in the instructions stage yet.');
});
