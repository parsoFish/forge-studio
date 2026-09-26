/**
 * `forge-8vfn.8.1.18` — the gate/artifact viewer's breadcrumb
 * (`app/artifact/page.tsx`) linked ONLY to the flow monitor (`monitorHref`,
 * `a[data-action="back-to-monitor"|"back-to-flows"]`); there was no path
 * back to the run's OWN detail page (`/flows/<flowId>/run/<runId>`), so an
 * operator sitting at a gate had no way back to the run's timeline, and the
 * stories runner's real-nav (`scripts/stories/beats-drive.mjs`'s
 * `[data-nav][href], a[href]`) found no anchor to it at all.
 *
 * `app/artifact/page.tsx` is a `use client` page driven by `useSearchParams`
 * and effect-driven bridge fetches — it cannot be render-tested via
 * `renderToStaticMarkup` (the standing reason recorded at
 * `detail-pages-fail-closed-wiring.test.ts`'s header, which pins this SAME
 * file's other wiring the identical way). So, like that file, this pins the
 * SOURCE TEXT rather than a render.
 *
 * The derivation itself — known run -> href, no run record -> null, no
 * flow id -> null — is a pure function, unit-tested in full at
 * `apps/studio/tests/unit/run-detail-href.test.ts`. This file only proves
 * the page actually wires that function in, rather than re-deriving (or
 * guessing) the path inline.
 *
 * RUN: npx vitest run apps/studio/tests/regression/artifact-run-link-wiring.test.ts   (from apps/studio/)
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ARTIFACT = readFileSync(resolve(__dirname, '..', '..', 'app/artifact/page.tsx'), 'utf8');

test('imports the pure run-detail-href derivation rather than inlining a guess', () => {
  expect(ARTIFACT).toMatch(/import \{ runDetailHref \} from '@\/lib\/run-detail-href'/);
});

test('the derived href is computed from the resolved run, not the raw query param', () => {
  expect(ARTIFACT).toMatch(/const runHref = runDetailHref\(run\)/);
});

test('the breadcrumb renders a link to the run\'s own detail page when the href resolved', () => {
  expect(ARTIFACT).toMatch(
    /\{runHref \? \(\s*<Link\s+href=\{runHref\}\s+data-action="open-run"/,
  );
});

test('no run record falls through to the plain run-id text, never a guessed link', () => {
  expect(ARTIFACT).toMatch(
    /\{runHref \? \([\s\S]{0,400}\) : \(\s*<span>\{runId \|\| '—'\}<\/span>\s*\)\}/,
  );
});
