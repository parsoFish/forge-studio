/**
 * `forge-8vfn.8.1.18` — the artifact / gate page's breadcrumb linked ONLY to the
 * flow monitor, so an operator at a gate had no path back to the run's own page
 * (`/flows/<flowId>/run/<runId>`), and the stories runner's real-nav
 * (`scripts/stories/beats-drive.mjs`: `[data-nav][href], a[href]`) found none.
 *
 * `app/artifact/page.tsx` cannot be render-tested (the standing reason at
 * `detail-pages-fail-closed-wiring.test.ts`'s header), so its WIRING is pinned
 * by source text, and the segment itself — `components/RunCrumb.tsx` — is
 * rendered for real. The href derivation is unit-tested at
 * `apps/studio/tests/unit/run-detail-href.test.ts`.
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunCrumb } from '../../components/RunCrumb';
import type { Run } from '../../lib/studio-client';

const ARTIFACT = readFileSync(resolve(__dirname, '..', '..', 'app/artifact/page.tsx'), 'utf8');

const CYCLE_ID = '2026-09-26T07-16-37_INIT-2026-09-26-exclude-author-flag';
const run = { id: CYCLE_ID, flowId: 'forge-develop' } as unknown as Run;

test('the page renders the run segment through RunCrumb, fed the resolved run', () => {
  expect(ARTIFACT).toMatch(/import \{ RunCrumb \} from '@\/components\/RunCrumb'/);
  expect(ARTIFACT).toMatch(/<RunCrumb run=\{run\} runId=\{runId\} \/>/);
});

test('a resolved run renders a[data-action="open-run"] to the run\'s own page', () => {
  const html = renderToStaticMarkup(createElement(RunCrumb, { run, runId: CYCLE_ID }));
  expect(html).toContain('data-action="open-run"');
  expect(html).toContain(`href="/flows/forge-develop/run/${CYCLE_ID}"`);
});

test('no run record renders the plain id, never a guessed link', () => {
  const html = renderToStaticMarkup(createElement(RunCrumb, { run: null, runId: CYCLE_ID }));
  expect(html).not.toContain('<a');
  expect(html).toContain(`<span>${CYCLE_ID}</span>`);
});
