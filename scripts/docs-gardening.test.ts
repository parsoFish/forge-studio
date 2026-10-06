/**
 * docs-gardening.mjs — the weekly gardening candidates (docs refactor W7,
 * row 7.3). Each test names the wrong implementation it kills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore -- plain .mjs module
import { gardeningCandidates, renderReport } from './docs-gardening.mjs';

const NOW = new Date('2026-10-06T00:00:00Z');
const page = (path: string, fm: string, body = 'Some words.', covers: string[] = []) => ({ path, src: `---\n${fm}\n---\n${body}\n`, covers });
const G = 'apps/docs/src/content/docs/guides/x.md';
const R = 'apps/docs/src/content/docs/reference/y.md';

test('stale: a guide past 120 days and a reference past 180 are listed; inside the window they are not', () => {
  // kills: one window for every page type, and an off-by-one at the boundary
  const pages = [
    page(G, 'title: X\nlast_verified: 2026-06-07'), // 121 days
    page(R, 'title: Y\nlast_verified: 2026-04-10'), // 179 days
  ];
  const { stale } = gardeningCandidates({ pages, tracked: [], now: NOW });
  assert.deepEqual(stale.map((s: { path: string }) => s.path), [G]);
});

test('stale: a missing last_verified is a candidate; a generated page is never one', () => {
  // kills: skipping pages with no date, and asking a human to hand-edit a generated page
  const pages = [
    page(G, 'title: X'),
    page('apps/docs/src/content/docs/guides/how-to/h.md', 'title: H\ngenerated_from: tests/stories/S1.story.mjs\nlast_verified: 2020-01-01'),
  ];
  const { stale } = gardeningCandidates({ pages, tracked: [], now: NOW });
  assert.deepEqual(stale, [{ path: G, why: 'no valid last_verified' }]);
});

test('orphaned: a covers glob matching nothing and a cited path that is gone are listed; live ones are not', () => {
  // kills: checking globs against the page list instead of the tracked tree
  const tracked = ['packages/flows/a.ts', 'apps/forge/cli.ts'];
  const pages = [page(G, 'title: X\nlast_verified: 2026-10-01', 'See `apps/forge/cli.ts` and `packages/gone/z.ts`.', ['packages/flows/**', 'packages/retired/**'])];
  const { orphaned } = gardeningCandidates({ pages, tracked, now: NOW });
  assert.deepEqual(orphaned.map((o: { why: string }) => o.why), [
    'covers: packages/retired/** matches no tracked file',
    'cites `packages/gone/z.ts`, which does not exist',
  ]);
});

test('headroom: only pages above 70 % of their ceiling; the report names an empty section "None."', () => {
  // kills: listing every page, which turns the report into a target list
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const pages = [page(G, 'title: X\nlast_verified: 2026-10-01', words(701)), page(R, 'title: Y\nlast_verified: 2026-10-01', words(100))];
  const c = gardeningCandidates({ pages, tracked: [], now: NOW });
  assert.deepEqual(c.headroom.map((h: { path: string }) => h.path), [G]);
  const md = renderReport(c, '2026-10-06');
  assert.match(md, /## Stale\n\nNone\./);
  assert.match(md, /701\/1000 words \(70 %\)/);
});
