// @vitest-environment jsdom
/**
 * forge-nk1y.39 (c) — the verdict gate never presents a prior round's findings as current.
 *
 * gitweave I3a round 3 (2026-10-12): the review failed at `39f76ac` ("derive-failed … spawnSync
 * git ENOBUFS"), so no `review-findings.json` was written — and the gate kept rendering round 2's
 * file (judged at `a141e6e`) as the review of the change. `review-outcome.json` now records every
 * attempt; this suite drives the gate with the real shape: an outcome FAILED at one head beside a
 * findings file from another. Prior findings: the I2 verdict-2 fixture (60 findings, 1 blocker).
 *
 * Kills: the stale findings rendered as findings; their blocker counted as a current blocker;
 * approve made impossible (the operator must still be able to approve, by name, with a reason);
 * an outcome read that FAILED treated as "nothing contradicts the findings" (§6.15: UNKNOWN).
 *
 * RUN: npx vitest run apps/studio/tests/regression/verdict-review-currency.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DemoModel } from '@/lib/bridge-client';
import { currentFindingsPanelProps, type ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';
import type { ReviewOutcomeDoc } from '@/lib/gate-view';

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

const PRIOR = JSON.parse(readFileSync(resolve(__dirname, '../test-fixtures/gitweave-i2-verdict2/review-findings.json'), 'utf8')) as ReviewFindingsDoc & { initiative_id: string; cycleId: string };
const INIT = PRIOR.initiative_id;
const CYCLE = PRIOR.cycleId;
const FAILED_AT = '39f76ac7e37e260bc160d9b8b0a3ec3430748a16';
/** Verbatim reason + detail of the I3a round-3 review failure. */
const FAILED: ReviewOutcomeDoc = {
  cycleId: CYCLE, headSha: FAILED_AT, status: 'failed', reason: 'derive-failed',
  detail: 'git derivation error for chunk unattributed: spawnSync git ENOBUFS', at: '2026-10-12T11:40:44.831Z',
};
const MODEL: DemoModel = {
  title: 'I3a — green apply path', essence: 'e', project: 'gitweave', changedRef: '93528a00fd8c2dd485df8c27bd7b5f4168aca018', narrative: 'n',
  diffStat: '109 files changed', acceptanceCriteria: ['(WI-1) GIVEN a WHEN b THEN c'], testEvidence: [], checkpoints: [],
};

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

async function render(outcome: { doc: ReviewOutcomeDoc | null; error: boolean }, doc: ReviewFindingsDoc = PRIOR): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoReviewSurface, {
      model: MODEL, cycleId: CYCLE, initiativeId: INIT,
      reviewFindings: { doc, absent: false, error: false, outcome },
    }));
  });
  await act(async () => {});
}

test('fixture: the prior findings carry one blocker and a head that is not the failed one', () => {
  expect((PRIOR.findings ?? []).filter((f) => f.severity === 'blocker').length).toBe(1);
  expect(PRIOR.headSha!.startsWith(FAILED_AT.slice(0, 7))).toBe(false);
});

test('a failed review at another head: "no current findings — review failed at <head> (<reason>)", the prior findings are not rendered', async () => {
  await render({ doc: FAILED, error: false });
  const pane = q('[data-section="review-findings"]');
  expect(pane.getAttribute('data-findings-state')).toBe('not-current');
  expect(pane.getAttribute('data-review-failed-head')).toBe(FAILED_AT);
  expect(pane.textContent).toContain('No current findings — review failed at 39f76ac (derive-failed: git derivation error for chunk unattributed: spawnSync git ENOBUFS)');
  expect(pane.textContent).toContain(PRIOR.headSha!.slice(0, 7));
  expect(container.querySelectorAll('[data-finding]').length).toBe(0);
});

test('the headline says there is no current review, and the prior round\'s blocker is not counted as current', async () => {
  await render({ doc: FAILED, error: false });
  const headline = q('[data-section="verdict-headline"]');
  expect(headline.getAttribute('data-headline')).toBe('not-ready');
  expect(headline.textContent).toBe('Not ready: no current review — it failed at 39f76ac');
  expect(q('[data-component="verdict-form"]').getAttribute('data-blocking-count')).toBe('0');
});

test('refusal: approve without a current review needs the operator\'s rationale, by name', async () => {
  await render({ doc: FAILED, error: false });
  const approve = q<HTMLButtonElement>('[data-action="approve-and-merge"]');
  expect(approve.disabled).toBe(true);
  expect(approve.getAttribute('data-disabled-reason')).toBe('a rationale is required to approve without a current review');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).not.toHaveBeenCalled();
});

test('approve stays possible with a rationale, and records the operator\'s words', async () => {
  await render({ doc: FAILED, error: false });
  await type('[data-field="approve-rationale"]', 'GW checks green on the PR; reviewed by hand at 39f76ac.');
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'approve', initiativeId: INIT, rationale: 'GW checks green on the PR; reviewed by hand at 39f76ac.' });
});

test('control: an outcome COMPLETE at the findings\' own head leaves the findings current', async () => {
  await render({ doc: { ...FAILED, headSha: PRIOR.headSha!, status: 'complete', reason: null, detail: null }, error: false });
  expect(q('[data-section="review-findings"]').getAttribute('data-findings-state')).toBe('present');
  expect(q('[data-section="verdict-headline"]').textContent).toBe('Not ready: 1 blocking finding');
});

test('an outcome read that FAILED is UNKNOWN — the findings are never presented as current', async () => {
  await render({ doc: null, error: true });
  expect(q('[data-section="review-findings"]').getAttribute('data-findings-state')).toBe('error');
  expect(container.querySelectorAll('[data-finding]').length).toBe(0);
});

test('the no-demo fallback and the verdict view apply the same currency (currentFindingsPanelProps)', () => {
  const failed = currentFindingsPanelProps(PRIOR, false, false, { doc: FAILED, error: false });
  expect(failed.doc).toBeNull();
  expect(failed.notCurrentNote).toBe('No current findings — review failed at 39f76ac (derive-failed: git derivation error for chunk unattributed: spawnSync git ENOBUFS).');
  expect(currentFindingsPanelProps(PRIOR, false, false, { doc: null, error: true })).toEqual({ doc: null, absentNote: false, errorNote: true });
  expect(currentFindingsPanelProps(PRIOR, false, false, { doc: null, error: false }).doc).toBe(PRIOR);
  // A failed attempt with NO findings ever on file is still "failed", never "did not run".
  expect(currentFindingsPanelProps(null, true, false, { doc: FAILED, error: false }).notCurrentNote).toMatch(/^No current findings — review failed at 39f76ac/);
});

test('a current review names the files it did not review, by reason (the I3a shape: 66 binary + the demo bundle)', async () => {
  const notReviewed = [
    ...Array.from({ length: 66 }, (_, i) => ({ path: `demo/x/.capture/after/f${i}.png`, reason: 'binary' as const })),
    { path: 'demo/x/demo.json', reason: 'demo-bundle' as const },
    { path: 'demo/x/DEMO.md', reason: 'demo-bundle' as const },
  ];
  await render({ doc: null, error: false }, { ...PRIOR, notReviewed });
  const pane = q('[data-section="review-findings"]');
  expect(pane.getAttribute('data-not-reviewed-count')).toBe('68');
  expect(pane.textContent).toContain('68 files not reviewed (66 binary, 2 demo-bundle)');
});
