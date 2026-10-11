// @vitest-environment jsdom
/**
 * forge-nk1y.33 + forge-nk1y.34 — the verdict decision card tells the truth from BOTH sources,
 * and approve carries the operator's own rationale.
 *
 * gitweave I2 verdict 1 (2026-10-11): the headline read "Ready to approve and merge" with the
 * reviewer's blockers open, because readiness counted the operator's blocking comments only.
 * Verdict 2 (2026-10-12): approving with a ledgered exception wrote the canned
 * "Approved on the visual review — no blocking comments." into verdict.json; the operator's real
 * reason had no field. Fixture: I2's verdict-2 review (`../test-fixtures/gitweave-i2-verdict2/`,
 * copied from the cycle's `review-findings.json`, long strings trimmed; 60 findings, 1 blocker).
 * Round 1's review (2 blockers) was overwritten by round 2 in the cycle dir, so the two-source
 * case adds one operator blocking comment to round 2's one reviewer blocker.
 *
 * RUN: npx vitest run apps/studio/tests/regression/verdict-decision-truth.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DemoModel } from '@/lib/bridge-client';
import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';

const submitMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/bridge-client', () => ({
  submitVerdict: (...a: unknown[]) => submitMock(...(a as [])),
}));
const comments = vi.hoisted(() => ({ load: { current: {} as unknown } }));
vi.mock('@/lib/review-comments-client', () => ({
  fetchReviewComments: vi.fn(async () => comments.load.current),
  addReviewComment: vi.fn(),
  resolveReviewComment: vi.fn(),
  editReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  isResponse: (r: { comments?: unknown }) => r.comments !== undefined,
}));

import { DemoReviewSurface } from '@/components/DemoReviewSurface';

const I2 = JSON.parse(readFileSync(resolve(__dirname, '../test-fixtures/gitweave-i2-verdict2/review-findings.json'), 'utf8')) as ReviewFindingsDoc & { initiative_id: string; cycleId: string };
const INIT = I2.initiative_id;
const CYCLE = I2.cycleId;
const MODEL: DemoModel = {
  title: 'I2 — apply engine', essence: 'e', project: 'gitweave', changedRef: I2.headSha!, narrative: 'n',
  diffStat: '40 files changed', acceptanceCriteria: ['(WI-1) GIVEN a WHEN b THEN c'], testEvidence: [], checkpoints: [],
};
const NO_BLOCKER: ReviewFindingsDoc = { ...I2, findings: (I2.findings ?? []).filter((f) => f.severity !== 'blocker') };
const OPERATOR_BLOCKER = { id: 'c1', region: 'ac-1', body: 'the April Apply job is red', blocking: true, resolved: false, at: '2026-10-12T07:00:00Z' };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  submitMock.mockClear();
  comments.load.current = { cycleId: CYCLE, comments: [], derivedVerdict: { kind: 'approve' } };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const press = async (sel: string): Promise<void> => { await act(async () => { q<HTMLButtonElement>(sel).click(); }); };
const type = async (sel: string, value: string): Promise<void> => {
  await act(async () => {
    const el = q<HTMLTextAreaElement>(sel);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

async function render(findings: ReviewFindingsDoc): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoReviewSurface, {
      model: MODEL, cycleId: CYCLE, initiativeId: INIT,
      reviewFindings: { doc: findings, absent: false, error: false },
    }));
  });
  await act(async () => {});
}

test('fixture is I2 verdict 2: one reviewer blocker', () => {
  expect((I2.findings ?? []).filter((f) => f.severity === 'blocker').length).toBe(1);
});

test('a reviewer blocker with no operator comment: "Not ready: 1 blocking finding", send back first, approve de-emphasised', async () => {
  await render(I2);
  const card = q('[data-component="verdict-form"]');
  expect(card.getAttribute('data-blocking-count')).toBe('1');
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Not ready: 1 blocking finding');
  expect(q('[data-section="verdict-headline"]').getAttribute('data-headline')).toBe('not-ready');
  expect(card.textContent).not.toContain('Ready to approve and merge');
  // The primary control is send back; approve is still there, by name, behind a rationale.
  const actions = [...card.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action'));
  expect(actions.indexOf('compose-send-back')).toBeLessThan(actions.indexOf('approve-and-merge'));
  expect(q('[data-action="approve-and-merge"]').getAttribute('data-emphasis')).toBe('secondary');
});

test('both sources count: one reviewer blocker + one open blocking comment → "Not ready: 2 blocking findings"', async () => {
  comments.load.current = {
    cycleId: CYCLE, comments: [OPERATOR_BLOCKER],
    derivedVerdict: { kind: 'send-back', rationale: 'the April Apply job is red', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
  };
  await render(I2);
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Not ready: 2 blocking findings');
  expect(q('[data-component="verdict-form"]').getAttribute('data-blocking-count')).toBe('2');
});

test('refusal: approve over an open reviewer blocker without a rationale is refused by name', async () => {
  await render(I2);
  const approve = q<HTMLButtonElement>('[data-action="approve-and-merge"]');
  expect(approve.disabled).toBe(true);
  expect(approve.getAttribute('data-disabled-reason')).toBe('a rationale is required to approve over 1 open reviewer blocker');
  await type('[data-field="approve-rationale"]', '   ');
  expect(q<HTMLButtonElement>('[data-action="approve-and-merge"]').disabled).toBe(true);
  expect(submitMock).not.toHaveBeenCalled();
});

test('approve over a blocker with a rationale records the operator\'s words, not canned text', async () => {
  await render(I2);
  await type('[data-field="approve-rationale"]', 'Ledgered exception: the April Apply job is fixed first in I3.');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'approve', initiativeId: INIT, rationale: 'Ledgered exception: the April Apply job is fixed first in I3.' });
});

test('no blocker anywhere: "Ready to approve and merge", approve primary, the rationale box optional', async () => {
  await render(NO_BLOCKER);
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Ready to approve and merge');
  expect(q('[data-section="verdict-headline"]').getAttribute('data-headline')).toBe('ready');
  expect(q('[data-action="approve-and-merge"]').getAttribute('data-emphasis')).toBe('primary');
  await press('[data-action="approve-and-merge"]');
  const sent = (submitMock.mock.calls[0] as unknown[])[0] as { rationale: string };
  expect(sent.rationale).not.toBe('Approved on the visual review — no blocking comments.');
  expect(sent.rationale).toBe('Approved on the visual review — no blocking comments and no reviewer blockers open.');
});

test('no blocker, a typed rationale is what is recorded', async () => {
  await render(NO_BLOCKER);
  await type('[data-field="approve-rationale"]', 'Demo shows the plan engine deleting the ghost team.');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'approve', initiativeId: INIT, rationale: 'Demo shows the plan engine deleting the ghost team.' });
});
