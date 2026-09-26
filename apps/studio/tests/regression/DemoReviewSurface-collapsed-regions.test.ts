// @vitest-environment jsdom
/**
 * `DemoReviewSurface`'s region cards — the `toggle-region` handle.
 *
 * Each region card (`[data-demo-region]`) collapses by default once a review
 * has more than `REGION_COLLAPSE_THRESHOLD` (12, `lib/demo-review-view.ts`)
 * regions, and its `comment-region` button only exists while expanded. The
 * card's own `[data-action="comment-region"]` already carries `data-region`
 * so a caller can target ONE region's comment button among many identical
 * ones — but the `[data-action="toggle-region"]` button that EXPANDS a
 * collapsed region first carried no such handle. On a >12-region wall every
 * region starts collapsed, so there was no way to name "expand region ac-3"
 * before pressing its comment button — only "press the first toggle button",
 * which is a different region on every fixture.
 *
 * This pins: a collapsed wall renders no comment-region button anywhere, every
 * toggle-region button is scoped to its own card via `data-region`, and
 * pressing ONE scoped toggle reveals exactly one scoped comment-region button.
 *
 * RUN: npx vitest run tests/regression/DemoReviewSurface-collapsed-regions.test.ts   (from apps/studio/)
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { DemoModel } from '@/lib/bridge-client';
import { REGION_COLLAPSE_THRESHOLD } from '@/lib/demo-review-view';

vi.mock('@/lib/bridge-client', () => ({
  submitVerdict: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/review-comments-client', () => ({
  fetchReviewComments: vi.fn(async () => ({ cycleId: 'cycle-1', comments: [], derivedVerdict: { kind: 'approve' } })),
  fetchDemoMarkdown: vi.fn(async () => ''),
  addReviewComment: vi.fn(),
  resolveReviewComment: vi.fn(),
  editReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  isResponse: (r: { comments?: unknown }) => r.comments !== undefined,
}));

vi.mock('@/lib/render-markdown', () => ({
  renderDemoMarkdownDoc: () => '<html></html>',
}));

// One more than the collapse threshold — the smallest wall where every
// region starts collapsed (`regionDefaultOpen`, lib/demo-review-view.ts).
const REGION_COUNT = REGION_COLLAPSE_THRESHOLD + 1;

function buildModel(): DemoModel {
  return {
    title: 'a wall of acceptance criteria',
    essence: 'exercises the >12-region collapse default',
    project: 'gitpulse',
    checkpoints: [],
    diffStat: '+0 -0',
    acceptanceCriteria: Array.from({ length: REGION_COUNT }, (_, i) => `AC ${i + 1} holds`),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  const { DemoReviewSurface } = await import('@/components/DemoReviewSurface');
  await act(async () => {
    root.render(
      React.createElement(DemoReviewSurface, {
        model: buildModel(),
        cycleId: 'cycle-1',
        initiativeId: 'INIT-2026-09-26-x',
      }),
    );
  });
  // Flush the mount effect's fetchReviewComments/fetchDemoMarkdown promises.
  await act(async () => {});
}

test('a >12-region wall starts fully collapsed with no comment-region button anywhere', async () => {
  await render();

  const cards = container.querySelectorAll('[data-demo-region]');
  expect(cards.length).toBe(REGION_COUNT);
  cards.forEach((card) => {
    expect(card.getAttribute('data-region-collapsed')).toBe('true');
  });
  expect(container.querySelector('[data-action="comment-region"]')).toBeNull();
});

test('(RED) every toggle-region button carries data-region matching its own card', async () => {
  await render();

  const cards = container.querySelectorAll('[data-demo-region]');
  expect(cards.length).toBeGreaterThan(0);
  cards.forEach((card) => {
    const regionId = card.getAttribute('data-demo-region');
    const toggle = card.querySelector('[data-action="toggle-region"]');
    expect(toggle, `region ${regionId} must render a toggle-region button`).not.toBeNull();
    expect(toggle!.getAttribute('data-region')).toBe(regionId);
  });
});

test('(RED) pressing the scoped toggle-region for ac-3 reveals exactly one scoped comment-region button', async () => {
  await render();

  const card = container.querySelector('[data-demo-region="ac-3"]');
  expect(card, 'the ac-3 card must render').not.toBeNull();
  // Found by its data-region handle, the same way `comment-region` is already
  // targeted — NOT by DOM containment, which would pass before the fix too.
  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-action="toggle-region"][data-region="ac-3"]',
  );
  expect(toggle, 'ac-3 must have a toggle-region button scoped by data-region').not.toBeNull();

  await act(async () => {
    toggle!.click();
  });

  expect(card!.getAttribute('data-region-collapsed')).toBe('false');
  const commentButtons = container.querySelectorAll('[data-action="comment-region"]');
  expect(commentButtons.length).toBe(1);
  expect(commentButtons[0].getAttribute('data-region')).toBe('ac-3');
});
