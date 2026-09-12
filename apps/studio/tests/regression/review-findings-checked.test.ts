/**
 * `forge-8vfn.7.6.63` — the run page rendered NOTHING for review findings it did
 * not have, so three different facts looked identical on screen: the review has
 * not run, the review ran and the fetch failed, and the review ran with no
 * findings.
 *
 * `ReviewFindingsPanel` already has the vocabulary — `data-findings-state=
 * "absent"` and `"error"`, with its own comment reading *"error beats absence —
 * a failed fetch says NOTHING about whether the artifact exists"* — and
 * `FlowRunDetail.tsx:231` passed neither prop, so the panel returned `null`.
 *
 * THE REASON IT COULD NOT PASS THEM is `fetchReviewFindings`: it collapses a
 * 404, a 500 and a thrown fetch into the same `null`, so the page had nothing
 * to distinguish. `app/artifact/page.tsx:775-776` already derives exactly this
 * pair — `absent = doc === null && !failed`, `error = doc === null && failed` —
 * and its comment claims *"the same derivation the run page uses"*. It is not:
 * that page calls its OWN local `fetchJsonArtifactChecked` (`:324`, not
 * exported), and the run page's helper cannot answer the question. The comment
 * asserted a parity that never existed.
 *
 * So this adds the checked variant beside the old one rather than changing it —
 * `app/projects/[id]/showcase/page.tsx:107` passes `fetchReviewFindings` as a
 * port and must keep its shape.
 *
 * RUN: npx vitest run tests/regression/review-findings-checked.test.ts   (from apps/studio/)
 */

import { test, expect } from 'vitest';
import { fetchReviewFindingsChecked } from '../../lib/flow-run-detail-client.ts';

const doc = { findings: [] };
const res = (status: number, body: unknown = null) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
}) as unknown as Pick<Response, 'status' | 'ok' | 'json'>;

test('200 with a body is the doc, and NOT a failure', async () => {
  expect(await fetchReviewFindingsChecked('CYCLE-1', res(200, doc))).toEqual({ doc, failed: false });
});

test('404 is ABSENT, not an error — an authoritative "it is not there"', async () => {
  expect(await fetchReviewFindingsChecked('CYCLE-1', res(404))).toEqual({ doc: null, failed: false });
});

test('500 is an ERROR, not absence — it says nothing about whether the artifact exists', async () => {
  expect(await fetchReviewFindingsChecked('CYCLE-1', res(500))).toEqual({ doc: null, failed: true });
});

test('a THROWN fetch is an error too — a dead bridge is not an absent artifact', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  expect(await fetchReviewFindingsChecked('CYCLE-1', boom)).toEqual({ doc: null, failed: true });
});

test('a 200 whose body will not parse is an ERROR, not an empty review', async () => {
  const badJson = async () => ({
    status: 200, ok: true, json: async () => { throw new SyntaxError('unexpected <'); },
  }) as unknown as Pick<Response, 'status' | 'ok' | 'json'>;
  expect(await fetchReviewFindingsChecked('CYCLE-1', badJson)).toEqual({ doc: null, failed: true });
});

test('the run id is URL-encoded into the artifact path', async () => {
  let seen = '';
  const spy = async (path: string) => { seen = path; return { status: 404, ok: false, json: async () => null } as unknown as Pick<Response, 'status' | 'ok' | 'json'>; };
  await fetchReviewFindingsChecked('a/b:c', spy);
  expect(seen).toBe('/api/artifact/a%2Fb%3Ac/review-findings.json');
});
