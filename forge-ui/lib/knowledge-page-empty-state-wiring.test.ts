/**
 * knowledge-page-empty-state-wiring.test.ts — W6-IA-4 sweep finding C4#1.
 *
 * `/knowledge`'s page.tsx cannot be render-tested via `renderToStaticMarkup`
 * (`useSearchParams` + effect-gated `currentId` never resolve outside a real
 * app router — see `./knowledge-page-kb-maintenance.test.ts`'s header for
 * the proven reason, spiked and confirmed there). This file mirrors that
 * sibling's SOURCE-TEXT technique instead, pinning the WIRING an empty KB
 * roster depends on: the visible contract itself (the empty-state message +
 * its own distinct CTA) is pinned separately, with a REAL render test, at
 * `./knowledge-empty-state-render.test.ts`.
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-empty-state-wiring.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '../app/knowledge/page.tsx');
const source = readFileSync(PAGE_PATH, 'utf8');

test('the KB-list fetch sets kbListReady once it settles (success OR failure) — never left permanently false', () => {
  expect(source).toContain('setKbListReady(true)');
});

test('a genuinely empty, settled KB roster sets `ready` true — the ONLY other place `ready` was set required a currentId that an empty roster never produces', () => {
  expect(source).toMatch(/kbListReady\s*&&\s*allKbs\.length === 0[\s\S]{0,80}setReady\(true\)/);
});

test('the Explore tab renders <KnowledgeEmptyState /> once ready+empty is known, instead of the generic "No KB data available." branch', () => {
  expect(source).toContain('<KnowledgeEmptyState />');
  expect(source).toMatch(/tab === 'explore' && ready && allKbs\.length === 0/);
});

test('the page header carries a PERSISTENT "+ New KB" CTA to /knowledge/new, independent of roster size', () => {
  expect(source).toMatch(/data-action="new-kb"[\s\S]{0,40}/);
  expect(source).toContain('href="/knowledge/new"');
});
