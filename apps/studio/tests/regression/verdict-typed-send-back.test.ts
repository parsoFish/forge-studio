// @vitest-environment jsdom
/**
 * forge-mfv5.1.28 (D-20 amended) — the verdict gate's send-back is first-class
 * WITHOUT a blocking comment: rationale + typed criteria + gate command + files
 * in scope, through the row-5 `WorkItemAuthoringFields` (prefix `verdict`, so
 * every S10 handle is unchanged). And the comment-derived path forwards the
 * bridge's `qualityGateCmd` — a comment's runnable command gates the fix WI.
 * Technique: jsdom + react-dom/client + act; `submitVerdict` is a mock, so no
 * press reaches a bridge.
 *
 * RUN: npx vitest run apps/studio/tests/regression/verdict-typed-send-back.test.ts   (from apps/studio/)
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { DemoModel } from '@/lib/bridge-client';

const submitMock = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));
vi.mock('@/lib/bridge-client', () => ({ submitVerdict: (input: Record<string, unknown>) => submitMock(input) }));

const derived = { current: { kind: 'approve' } as Record<string, unknown> };
vi.mock('@/lib/review-comments-client', () => ({
  fetchReviewComments: vi.fn(async () => ({ cycleId: 'cycle-1', comments: [], derivedVerdict: derived.current })),
  fetchDemoMarkdown: vi.fn(async () => ''),
  addReviewComment: vi.fn(),
  resolveReviewComment: vi.fn(),
  editReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  isResponse: (r: { comments?: unknown }) => r.comments !== undefined,
}));
vi.mock('@/lib/render-markdown', () => ({ renderDemoMarkdownDoc: () => '<html></html>' }));

import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';
import { DemoReviewSurface } from '@/components/DemoReviewSurface';

const INIT = 'INIT-2026-10-10-i1-honest-baseline';
const MODEL: DemoModel = { title: 't', essence: 'e', project: 'gitweave', checkpoints: [], diffStat: '+0 -0', acceptanceCriteria: ['AC2: the suite runs'] };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  submitMock.mockClear();
  derived.current = { kind: 'approve' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = <T extends Element>(sel: string): T => {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
async function type(sel: string, value: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const press = async (sel: string) => { await act(async () => { q<HTMLButtonElement>(sel).click(); }); };

async function fillTyped(): Promise<void> {
  await type('[data-field="verdict-rationale"]', 'AC2 is measured by nothing.');
  await type('[data-field="verdict-ac-given-1"]', 'the whole tests/ directory');
  await type('[data-field="verdict-ac-when-1"]', '`python3 -m pytest tests/` runs');
  await type('[data-field="verdict-ac-then-1"]', 'zero tests fail');
  await type('[data-field="verdict-wi-gate-cmd"]', 'python3 -m pytest tests/');
  await type('[data-field="verdict-wi-files"]', 'tests/test_structure.py\npytest.ini');
}

const TYPED = {
  kind: 'send-back', initiativeId: INIT, rationale: 'AC2 is measured by nothing.',
  acceptanceCriteria: [{ given: 'the whole tests/ directory', when: '`python3 -m pytest tests/` runs', then: 'zero tests fail' }],
  qualityGateCmd: ['python3', '-m', 'pytest', 'tests/'],
  filesInScope: ['tests/test_structure.py', 'pytest.ini'],
};

test('ReviewVerdictForm send-back renders the typed work-item fields (no summary — the rationale is it) and submits gate + scope', async () => {
  await act(async () => { root.render(React.createElement(ReviewVerdictForm, { initiativeId: INIT, initialKind: 'send-back' })); });
  expect(container.querySelector('[data-field="verdict-wi-summary"]')).toBeNull();
  expect(container.querySelector('[data-field="verdict-wi-gate-cmd"]')).not.toBeNull();
  expect(container.querySelector('[data-field="verdict-wi-files"]')).not.toBeNull();
  await fillTyped();
  await press('[data-action="send-back"]');
  expect(submitMock).toHaveBeenCalledWith(TYPED);
});

test('ReviewVerdictForm send-back with a rationale but no criterion is disabled naming both missing inputs', async () => {
  await act(async () => { root.render(React.createElement(ReviewVerdictForm, { initiativeId: INIT, initialKind: 'send-back' })); });
  await type('[data-field="verdict-rationale"]', 'something is off');
  const btn = q<HTMLButtonElement>('[data-action="send-back"]');
  expect(btn.disabled).toBe(true);
  expect(btn.getAttribute('data-disabled-reason')).toMatch(/blocking comment.*acceptance criterion/);
  await press('[data-action="send-back"]');
  expect(submitMock).not.toHaveBeenCalled();
});

test('ReviewVerdictForm send-back omits gate and scope when left blank (the project gate stays the fallback)', async () => {
  await act(async () => { root.render(React.createElement(ReviewVerdictForm, { initiativeId: INIT, initialKind: 'send-back' })); });
  await type('[data-field="verdict-rationale"]', 'r');
  await type('[data-field="verdict-ac-given-1"]', 'g');
  await type('[data-field="verdict-ac-when-1"]', 'w');
  await type('[data-field="verdict-ac-then-1"]', 't');
  await press('[data-action="send-back"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'send-back', initiativeId: INIT, rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] });
});

async function renderSurface(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoReviewSurface, { model: MODEL, cycleId: `2026-10-10T01-55-59_${INIT}`, initiativeId: INIT }));
  });
  await act(async () => {});
}

test('DemoReviewSurface with NO blocking comments offers the typed send-back — rationale + work-item fields — and submits them', async () => {
  await renderSurface();
  expect(container.querySelector('[data-action="approve-and-merge"]')).not.toBeNull();
  await press('[data-action="compose-send-back"]');
  expect(container.querySelectorAll('[data-component="verdict-form"]').length).toBe(1);
  await fillTyped();
  await press('[data-action="send-back"]');
  expect(submitMock).toHaveBeenCalledWith(TYPED);
  expect(q('[data-component="verdict-form"]').getAttribute('data-form-kind')).toBe('send-back');
});

test('DemoReviewSurface forwards a comment-derived qualityGateCmd on the send-back', async () => {
  const ac = { given: 'the demo region "ac-1"', when: 'the operator runs `python3 -m pytest tests/`', then: 'AC2 unmet: `python3 -m pytest tests/`' };
  derived.current = { kind: 'send-back', rationale: '[ac-1] AC2 unmet', acceptanceCriteria: [ac], qualityGateCmd: ['python3', '-m', 'pytest', 'tests/'] };
  await renderSurface();
  expect(container.querySelector('[data-action="compose-send-back"]')).toBeNull();
  await press('[data-action="send-back"]');
  expect(submitMock).toHaveBeenCalledWith({
    kind: 'send-back', initiativeId: INIT, rationale: '[ac-1] AC2 unmet', acceptanceCriteria: [ac], qualityGateCmd: ['python3', '-m', 'pytest', 'tests/'],
  });
});
