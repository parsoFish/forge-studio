/**
 * W7-B7 (artifact-plan-31) — pure view logic for the DemoReviewSurface's
 * region wall. The failed gitpulse cycle rendered a 14,050px page: 36
 * always-expanded regions, 36 identical "+ comment" buttons, and the only
 * verdict control at the very bottom in normal flow.
 *
 * Rules (asserted in demo-review-view.test.ts):
 *  - a SMALL review (≤ REGION_COLLAPSE_THRESHOLD regions) stays fully
 *    expanded — one glance, no extra clicks (and the journey's small fixture
 *    drives the comment affordances directly);
 *  - a WALL collapses by default, except regions that carry comments (the
 *    operator's own anchors stay visible);
 *  - the header summary counts regions / comments / blocking so the operator
 *    can see the review's shape before scrolling.
 */
import type { ReviewComment } from './review-comments-client';

/** Region count above which regions collapse by default. */
export const REGION_COLLAPSE_THRESHOLD = 12;

export function regionDefaultOpen(regionCount: number, regionCommentCount: number): boolean {
  if (regionCount <= REGION_COLLAPSE_THRESHOLD) return true;
  return regionCommentCount > 0;
}

export type ReviewSummary = {
  regions: number;
  comments: number;
  blocking: number;
  /** The region id of the FIRST unresolved blocking comment, for a jump link. */
  firstBlockingRegion: string | null;
};

export function summarizeReview(regionIds: readonly string[], comments: readonly ReviewComment[]): ReviewSummary {
  const blockers = comments.filter((c) => c.blocking && !c.resolved);
  // First blocking in REGION order (the page's own reading order), not
  // comment-creation order.
  const blockingRegions = new Set(blockers.map((c) => c.region));
  const firstBlockingRegion = regionIds.find((id) => blockingRegions.has(id)) ?? null;
  return {
    regions: regionIds.length,
    comments: comments.length,
    blocking: blockers.length,
    firstBlockingRegion,
  };
}
