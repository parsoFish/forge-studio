// @vitest-environment jsdom
/**
 * The plan and reflection gates on the verdict gate's shell (forge-mfv5.1.31
 * row 3, D-46 "gate" type: the decision control inside viewport 1).
 *
 * Kills: the decision control rendered AFTER the plan / the questions (the
 * plan's Approve sat at y=1,639, the reflection's Submit at y=1,363 on the
 * gitweave I1 fixture); the architect idea shown as one unbroken paragraph;
 * critic findings, the plan document or the question list growing the page
 * instead of scrolling inside a pane token; a bare pixel size in the restyled
 * gates (tokens only, D-46 §2).
 *
 * RUN: npx vitest run apps/studio/tests/regression/gate-shells-layout.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

vi.mock('@/lib/bridge-client', () => ({
  postPlanVerdict: vi.fn(async () => ({ ok: true })),
  architectFileUrl: vi.fn(async (u: string) => `http://bridge.test${u}`),
  postReflectionAnswers: vi.fn(async () => ({ ok: true })),
  postReflectionClose: vi.fn(async () => ({ ok: true })),
}));

import type { ReflectionData } from '@/lib/bridge-client';
import { PlanGate } from '@/components/PlanGate';
import { ReflectionGate } from '@/components/studio/artifact/ReflectionGate';

const IDEA = [
  '# I1 — An honest baseline',
  '',
  "GitWeave's April 2026 build was a spike: tests written first, about half the",
  'implementation built, then stopped.',
  '',
  '1. Preserve April. Push the current `main` tree to a new remote branch',
  '   `archive/april-2026` before anything is removed.',
  '2. Prune to what is true.',
  '3. One instruction file.',
].join('\n');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = container): T => {
  const el = scope.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

async function renderPlan(findings = [
  { severity: 'medium' as const, initiativeId: 'INIT-2026-10-10-i1-honest-baseline', gap: 'Step 3 audits only the metrics patterns.' },
  { severity: 'medium' as const, gap: 'ci.yaml keeps --deselect.' },
]): Promise<void> {
  await act(async () => {
    root.render(React.createElement(PlanGate, {
      project: 'gitweave', sessionId: '2026-10-10T00-31-50-43ce1241',
      planUrl: '/api/architect/file/gitweave/2026-10-10T00-31-50-43ce1241/PLAN.html',
      idea: IDEA, criticFindings: findings,
    }));
  });
  await act(async () => {});
}

test('plan gate: the decision card comes first, beside the idea; the plan and the critic sit below in panes', async () => {
  await renderPlan();
  const gate = q('[data-section="plan-gate"]');
  expect(gate.firstElementChild?.getAttribute('data-section')).toBe('gate-decision');
  const band = q('[data-section="gate-decision"]', gate);
  for (const sel of ['[data-action="approve-plan"]', '[data-action="revise-plan"]', '[data-action="reject-plan"]', '[data-field="rationale"]']) q(sel, band);
  expect(q('[data-section="review-claims"]', band).textContent).toContain('2 potential gaps');
  const critic = q('[data-section="critic-findings"]', gate);
  expect(band.contains(critic)).toBe(false);
  expect(q<HTMLElement>('[data-pane-body]', critic).style.height).toBe('var(--pane-md)');
  expect(q<HTMLElement>('iframe[data-plan-iframe]', gate).style.height).toBe('var(--pane-xl)');
});

test('plan gate: the idea renders as its own lines — a heading and a list, never one paragraph', async () => {
  await renderPlan();
  const idea = q('[data-section="plan-idea"]');
  expect(idea.querySelectorAll('li').length).toBe(3);
  expect(idea.textContent).toContain('I1 — An honest baseline');
  expect(idea.textContent).not.toContain('# I1');
  expect(idea.querySelector('li')!.textContent).toBe('Preserve April. Push the current main tree to a new remote branch archive/april-2026 before anything is removed.');
  expect(idea.querySelectorAll('p').length).toBe(1);
});

test('plan gate: no critic findings → no critic pane and no claims line', async () => {
  await renderPlan([]);
  expect(container.querySelector('[data-section="critic-findings"]')).toBeNull();
  expect(container.querySelector('[data-section="review-claims"]')).toBeNull();
});

const QUESTIONS: ReflectionData = {
  cycleId: 'c', answered: false, filed: true, mode: 'interactive',
  questions: [
    { question: 'Was the first decomposition right-sized?', header: 'Scope', options: [{ label: 'Too few', description: 'three send-backs' }, { label: 'Right-sized', description: '' }] },
    { question: 'Anything the gate should check next time?', header: 'Gates' },
  ],
};

test('reflection gate: the submit control and the free-form note come first; the questions scroll inside a pane', async () => {
  await act(async () => { root.render(React.createElement(ReflectionGate, { cycleId: 'c', data: QUESTIONS })); });
  const section = q('[data-section="reflect-questions"]');
  expect(section.firstElementChild?.getAttribute('data-section')).toBe('gate-decision');
  const band = q('[data-section="gate-decision"]', section);
  q('[data-action="submit-reflection"]', band);
  q('[data-field="freeform"]', band);
  expect(q('[data-reflect-answered-count]', band).textContent).toContain('0 of 2');
  const body = q<HTMLElement>('[data-pane-body]', section);
  expect(band.contains(body)).toBe(false);
  expect(body.style.height).toBe('var(--pane-xl)');
  expect(body.querySelectorAll('[data-question-index]').length).toBe(2);
});

test('the restyled plan and reflection gates use the density tokens only (D-46 §2)', () => {
  const studio = resolve(__dirname, '../..');
  const files = ['components/PlanGate.tsx', 'components/studio/artifact/ReflectionGate.tsx', 'components/studio/gate/GateBand.tsx'].map((f) => join(studio, f));
  const bare = /\b(?:padding\w*|margin\w*|gap|fontSize|width|height|maxWidth|minWidth|maxHeight|minHeight|top|left|right|bottom|borderRadius|inset)\s*:\s*(?:[1-9]\d*\b|'[^']*\d+px)/;
  const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l] as const))
    .filter(([, , l]) => bare.test(l))
    .map(([f, n, l]) => `${f.replace(studio, '')}:${n}: ${l.trim()}`);
  expect(hits).toEqual([]);
});
