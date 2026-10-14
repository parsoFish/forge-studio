// @vitest-environment jsdom
/**
 * forge-nk1y.43 — a demo whose capture showed NO behaviour change is a named state on the verdict
 * card: the headline says so with its count, and approve sits behind the operator's rationale
 * (the nk1y.33/.34 shape). Fixture: gitweave I3a's demo.json, its six planned checkpoints (all
 * `unchanged`; `packages/stations/tests/test-fixtures/gitweave-i3a/`, media dropped), with I2's
 * verdict-2 review minus its blocker so the demo is the only thing standing.
 *
 * (Harness below is verdict-decision-truth.test.ts's.)
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
 * RUN: npx vitest run apps/studio/tests/regression/verdict-no-change.test.ts
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

type Cp = DemoModel['checkpoints'][number];
const I3A = JSON.parse(readFileSync(resolve(__dirname, '../../../../packages/stations/tests/test-fixtures/gitweave-i3a/demo.json'), 'utf8')) as { checkpoints: Cp[] };
const PLANNED = I3A.checkpoints.filter((c) => (c as { form?: string }).form !== undefined);

async function render(findings: ReviewFindingsDoc, checkpoints: Cp[] = PLANNED, extra: Partial<DemoModel> = {}): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoReviewSurface, {
      model: { ...MODEL, checkpoints, ...extra }, cycleId: CYCLE, initiativeId: INIT,
      reviewFindings: { doc: findings, absent: false, error: false },
    }));
  });
  await act(async () => {});
}

test('I3a: the headline names the no-change outcome with its count; approve waits for a reason', async () => {
  expect(PLANNED.length).toBe(6);
  await render(NO_BLOCKER);
  const headline = q('[data-section="verdict-headline"]');
  expect(headline.textContent).toBe('Not ready: Demo captured no behaviour change — 6/6 checkpoints identical');
  expect(headline.getAttribute('data-headline')).toBe('not-ready');
  expect(headline.getAttribute('data-demo-outcome')).toBe('no-change');
  const approve = q<HTMLButtonElement>('[data-action="approve-and-merge"]');
  expect(approve.disabled).toBe(true);
  expect(approve.getAttribute('data-disabled-reason')).toBe('a rationale is required to approve with no captured behaviour change');
  expect(approve.getAttribute('data-emphasis')).toBe('secondary');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).not.toHaveBeenCalled();
});

test('I3a: approve with a rationale records the operator\'s words', async () => {
  await render(NO_BLOCKER);
  await type('[data-field="approve-rationale"]', 'I3a is a refactor; the change is proven by its tests, not a CLI diff.');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'approve', initiativeId: INIT, rationale: 'I3a is a refactor; the change is proven by its tests, not a CLI diff.' });
});

test('the recorded outcome on demo.json is what the card heads with', async () => {
  await render(NO_BLOCKER, PLANNED, { outcome: { kind: 'no-change', compared: 6, changed: 0, unchanged: 6, unknown: 0 } });
  expect(q('[data-section="verdict-headline"]').getAttribute('data-demo-outcome')).toBe('no-change');
});

test('a changed checkpoint: ready, and the outcome says changed', async () => {
  await render(NO_BLOCKER, [...PLANNED.slice(1), { ...PLANNED[0]!, delta: 'changed' }]);
  const headline = q('[data-section="verdict-headline"]');
  expect(headline.textContent).toBe('Ready to approve and merge');
  expect(headline.getAttribute('data-demo-outcome')).toBe('changed');
  expect(q('[data-action="approve-and-merge"]').getAttribute('data-emphasis')).toBe('primary');
});

test('all unknown is named separately, never as identical', async () => {
  await render(NO_BLOCKER, PLANNED.slice(0, 2).map((c) => ({ ...c, delta: 'unknown' as const })));
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Not ready: Demo compared no checkpoint — 2/2 could not be compared');
  expect(q('[data-section="verdict-headline"]').getAttribute('data-demo-outcome')).toBe('unknown');
});

test('a reviewer blocker still heads the card; the demo outcome stays on the attribute', async () => {
  await render(I2);
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Not ready: 1 blocking finding');
  expect(q('[data-section="verdict-headline"]').getAttribute('data-demo-outcome')).toBe('no-change');
});

test('no capture compared (no deltas): no outcome attribute value, the old ready path', async () => {
  await render(NO_BLOCKER, []);
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Ready to approve and merge');
  expect(q('[data-section="verdict-headline"]').getAttribute('data-demo-outcome')).toBe('');
});
