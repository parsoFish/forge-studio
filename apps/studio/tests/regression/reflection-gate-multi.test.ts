// @vitest-environment jsdom
/**
 * forge-nk1y.26 — a reflection question marked `multi` renders checkboxes and submits a choice
 * LIST; a single-choice question keeps its radios. gitweave I1's Q3 ("which roadblock is worth a
 * forge fix") rendered as a radio and the operator's four picks went into the freeform box. The
 * questions are I1's Q2 (single) and Q3 (marked multi) as `user-questions.json` carries them.
 *
 * RUN: npx vitest run apps/studio/tests/regression/reflection-gate-multi.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const postReflectionAnswersMock = vi.fn(async (_input: unknown) => ({ ok: true }));
vi.mock('@/lib/bridge-client', () => ({
  postReflectionClose: vi.fn(),
  postReflectionAnswers: (input: unknown) => postReflectionAnswersMock(input),
}));

import { ReflectionGate } from '@/components/studio/artifact/ReflectionGate';

const CYCLE = '2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline';
const Q2 = 'Did the implementation match the design intent?';
const Q3 = 'Which roadblock is worth a forge fix or new tool?';
const QUESTIONS = [
  { question: Q2, header: 'Did the impl', options: [{ label: 'Exact match', description: '' }, { label: 'Minor divergence', description: '' }] },
  { question: Q3, header: 'Which roadbl', multi: true, options: [{ label: '(a) Skip already-green WIs on send-back', description: '' }, { label: '(b) Full failing-test audit before PM decomposition', description: '' }, { label: '(c) Per-WI legal-text verification anchor', description: '' }] },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  postReflectionAnswersMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(ReflectionGate, { cycleId: CYCLE, data: { cycleId: CYCLE, questions: QUESTIONS, answered: false, filed: true, mode: 'interactive' } as never }));
  });
}
const q = (i: number) => container.querySelector(`[data-question-index="${i}"]`)!;
const pick = async (i: number, label: string): Promise<void> => {
  await act(async () => { q(i).querySelector<HTMLInputElement>(`[data-option-label="${label}"] input`)!.click(); });
};

test('the multi question renders checkboxes; the single-choice one keeps radios', async () => {
  await render();
  expect(q(1).getAttribute('data-question-mode')).toBe('multi');
  expect(q(1).querySelectorAll('input[type="checkbox"]').length).toBe(3);
  expect(q(0).getAttribute('data-question-mode')).toBe('options');
  expect(q(0).querySelectorAll('input[type="radio"]').length).toBe(2);
});

test('several picks submit as a choice list; unticking one removes it', async () => {
  await render();
  await pick(0, 'Minor divergence');
  await pick(1, '(a) Skip already-green WIs on send-back');
  await pick(1, '(b) Full failing-test audit before PM decomposition');
  await pick(1, '(c) Per-WI legal-text verification anchor');
  await pick(1, '(b) Full failing-test audit before PM decomposition');
  expect(q(1).getAttribute('data-question-resolved')).toBe('true');
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-action="submit-reflection"]')!.click(); });
  expect(postReflectionAnswersMock).toHaveBeenCalledWith({
    cycleId: CYCLE,
    answers: [
      { question: Q2, answer: 'Minor divergence' },
      { question: Q3, answer: ['(a) Skip already-green WIs on send-back', '(c) Per-WI legal-text verification anchor'] },
    ],
    freeform: undefined,
  });
});

test('a multi question with nothing ticked is unanswered and holds the submit', async () => {
  await render();
  await pick(0, 'Exact match');
  await pick(1, '(a) Skip already-green WIs on send-back');
  await pick(1, '(a) Skip already-green WIs on send-back');
  expect(q(1).getAttribute('data-question-resolved')).toBe('false');
  expect(container.querySelector<HTMLButtonElement>('[data-action="submit-reflection"]')!.disabled).toBe(true);
});
