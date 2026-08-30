/**
 * W7-B7 pins (artifact-plan-31) — the review-gate wall logic. Kills: a
 * 36-region review rendered fully expanded with no summary (the 14,000px
 * wall), and a small review made click-heavy by blanket collapsing (which
 * would also break the journey's direct comment-affordance drive).
 * RUN: cd forge-ui && npx vitest run lib/demo-review-view.test.ts
 */
import { test, expect } from 'vitest';

import { regionDefaultOpen, summarizeReview, REGION_COLLAPSE_THRESHOLD } from './demo-review-view.ts';
import type { ReviewComment } from './review-comments-client.ts';

function comment(over: Partial<ReviewComment>): ReviewComment {
  return { id: 'C-1', region: 'ac-1', body: 'x', blocking: false, resolved: false, at: '2026-01-01T00:00:00Z', ...over };
}

test('small reviews stay fully expanded (≤ threshold)', () => {
  expect(regionDefaultOpen(3, 0)).toBe(true);
  expect(regionDefaultOpen(REGION_COLLAPSE_THRESHOLD, 0)).toBe(true);
});

test('a wall collapses by default — except regions carrying comments', () => {
  expect(regionDefaultOpen(36, 0)).toBe(false);
  expect(regionDefaultOpen(36, 1)).toBe(true);
});

test('summarizeReview: counts regions/comments/blocking; resolved blockers do not count', () => {
  const s = summarizeReview(['ac-1', 'ac-2', 'checkpoint-1'], [
    comment({ id: 'C-1', region: 'ac-2', blocking: true }),
    comment({ id: 'C-2', region: 'ac-1', blocking: true, resolved: true }),
    comment({ id: 'C-3', region: 'checkpoint-1', blocking: false }),
  ]);
  expect(s).toEqual({ regions: 3, comments: 3, blocking: 1, firstBlockingRegion: 'ac-2' });
});

test('summarizeReview: first blocking region follows PAGE order, not comment order; null when clean', () => {
  const s = summarizeReview(['ac-1', 'ac-2'], [
    comment({ id: 'C-1', region: 'ac-2', blocking: true }),
    comment({ id: 'C-2', region: 'ac-1', blocking: true }),
  ]);
  expect(s.firstBlockingRegion).toBe('ac-1');
  expect(summarizeReview(['ac-1'], []).firstBlockingRegion).toBeNull();
});
