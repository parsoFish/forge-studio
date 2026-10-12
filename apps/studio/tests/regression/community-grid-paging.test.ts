/**
 * forge-nk1y.17 — `/community` measured 7,521 px at S8 beat 6 against a
 * scrolling-page budget of 3 viewports (dev/UI-CONSTRAINTS.md §1): the card
 * grid rendered every registry row. §3.1: a list that can grow without bound
 * gets a page size plus "show more" and never sets the page height.
 *
 * KILLS: the grid rendering every row again (n+1 items → n+1 cards), a
 * "show more" that never reveals page 2, a control rendered when nothing is
 * hidden, and a root `data-item-count` that drops to the page size (S8 reads
 * the FILTERED TOTAL after a search, not the cards on screen).
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CommunityItem } from '@/lib/community-client';
import { visibleCommunityItems, COMMUNITY_PAGE_SIZE } from '@/lib/community-view';
import { CommunityItemGrid } from '@/components/studio/CommunityItemGrid';

const NOW = Date.parse('2026-10-12T00:00:00Z');

function items(n: number): CommunityItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${String(i).padStart(3, '0')}`,
    kind: 'skill',
    name: `Item ${i}`,
    desc: 'd',
    hub: null,
    category: 'uncategorized',
    installState: 'not-installed',
    signals: null,
    fetchedAt: null,
  }) as unknown as CommunityItem);
}

test('the page size is bounded (≤ 3 viewports of 260-px cards)', () => {
  expect(COMMUNITY_PAGE_SIZE).toBeGreaterThan(0);
  expect(COMMUNITY_PAGE_SIZE).toBeLessThanOrEqual(30);
});

test('n+1 items: page 1 shows n, page 2 shows all n+1', () => {
  const all = items(COMMUNITY_PAGE_SIZE + 1);
  expect(visibleCommunityItems(all, COMMUNITY_PAGE_SIZE, 1)).toHaveLength(COMMUNITY_PAGE_SIZE);
  expect(visibleCommunityItems(all, COMMUNITY_PAGE_SIZE, 2)).toHaveLength(COMMUNITY_PAGE_SIZE + 1);
});

test('the grid renders one page and a show-more control naming what is hidden', () => {
  const html = renderToStaticMarkup(
    React.createElement(CommunityItemGrid, { items: items(COMMUNITY_PAGE_SIZE + 1), nowMs: NOW }),
  );
  expect(html.match(/data-card-type="community-item"/g)?.length).toBe(COMMUNITY_PAGE_SIZE);
  expect(html).toContain('data-action="community-show-more"');
  expect(html).toContain(`data-community-shown="${COMMUNITY_PAGE_SIZE}"`);
});

test('no show-more control when every item fits', () => {
  const html = renderToStaticMarkup(
    React.createElement(CommunityItemGrid, { items: items(3), nowMs: NOW }),
  );
  expect(html.match(/data-card-type="community-item"/g)?.length).toBe(3);
  expect(html).not.toContain('community-show-more');
});

test('the page mounts the paged grid and keeps the filtered total on the root', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app', 'community', 'page.tsx'), 'utf8');
  expect(src).toMatch(/<CommunityItemGrid\s/);
  expect(src).not.toMatch(/filtered\.map\(\(item\) =>\s*\(?\s*<CommunityCard/);
  expect(src).toContain("'data-item-count': filtered.length");
});
