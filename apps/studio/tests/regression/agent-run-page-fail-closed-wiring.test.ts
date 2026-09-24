/**
 * forge-5rr (projects-45): `/agents/[id]/run/[runId]` — the pending scan's
 * note was "Unverified whether the FetchErrorState branch is reachable for
 * a THROWN read or only a resolved-but-refused one." On inspection this
 * page (and `lib/run-view-client.ts`'s `fetchRunDetail`) already closed the
 * crosscut-08 defect class under an EARLIER bead (forge-irn, W7-B5 — see
 * both files' own headers): a transport THROW is caught into
 * `resolution: 'unresolved'` with NO `status` (never the authoritative
 * "not found"), a non-404 non-2xx status maps the same way (pinned at the
 * pure-logic level in `apps/studio/tests/unit/run-view-client.test.ts`), and the page's
 * `NotFound` render is gated on `resolution === 'not-found'` alone — never
 * `'unresolved'`. This file formalises that as the EXEMPT-ing evidence:
 * verified, not assumed, with a mutation check proving each assertion
 * actually kills the pre-forge-irn shape.
 *
 * `fetchRunDetail`'s OWN `try { bridgeFetch(...) } catch` is deliberately
 * NOT re-tested here with a mocked global `fetch` — `run-view-client.test.ts`'s
 * header already states the house convention this repo chose instead
 * (extract the pure decision into `resolveRunDetailFromResponse`, leave the
 * fetch wrapper as a known integration-level seam, covered by
 * `apps/forge/tests/integration/ui-bridge-agent-run.test.ts`) — this file
 * pins the CATCH BRANCH's shape as source text instead, consistent with
 * that stated choice, not a new one.
 *
 * Source-text pins (same convention as the other bespoke wiring tests in
 * this directory): both files are read at runtime by a `use client` page /
 * an unmocked network client, invisible to `renderToStaticMarkup`.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');
const PAGE = 'app/agents/[id]/run/[runId]/page.tsx';
const CLIENT = 'lib/run-view-client.ts';

test('fetchRunDetail: a transport THROW resolves to "unresolved" with NO status — never the authoritative "not found"', () => {
  const src = read(CLIENT);
  expect(src).toMatch(/catch \(err\) \{\s*const message[\s\S]{0,200}emptyDetail\('unresolved'\), readError: \{ message: `bridge unreachable/);
});

test('the page\'s NotFound render is gated on resolution === \'not-found\' ALONE — an "unresolved" read failure can never fall through to it', () => {
  const src = read(PAGE);
  expect(src).toMatch(/if \(loaded && detail!\.resolution === 'not-found'\) \{\s*return <NotFound/);
  // The negative: no OTHER condition (e.g. a bare `!loaded` or `!detail`)
  // renders NotFound — the ONLY not-found render site in the file.
  const notFoundSites = (src.match(/<NotFound/g) ?? []).length;
  expect(notFoundSites).toBe(1);
});

test('an "unresolved" read renders the shared FetchErrorState with a working Retry — never a silent stuck loading state', () => {
  const src = read(PAGE);
  expect(src).toMatch(/detail!\.resolution === 'unresolved' \?[\s\S]{0,300}<FetchErrorState/);
  expect(src).toMatch(/<FetchErrorState[\s\S]{0,200}error=\{detail!\.readError\?\.message/);
  expect(src).toMatch(/<FetchErrorState[\s\S]{0,300}onRetry=\{refresh\}/);
});

test('the live poll keeps watching an "unresolved" transient failure (status undefined or >=500) rather than giving up on the first blip', () => {
  const src = read(PAGE);
  expect(src).toMatch(/d\.resolution === 'unresolved' && \(d\.readError\?\.status === undefined \|\| d\.readError\.status >= 500\)/);
});
