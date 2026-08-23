/**
 * WI-1b (ON-7) — pins `home-view.ts`'s `HOME_STATUS_FRAME` (the styling-only
 * map from `HomeStatus` onto the shared 5-state `.hex-frame`/`.status-dot`
 * CSS vocabulary) as EXHAUSTIVE over `HOME_STATUSES`, not a hand-copied
 * literal list. `Record<HomeStatus, string>` already fails to COMPILE if a
 * member is missing — this test additionally proves the compiled map is
 * reachable and iterates the REAL closed array (`HOME_STATUSES`) rather than
 * a hardcoded `['active','gated','idle','failed']` that would silently stop
 * covering a 5th future member.
 *
 * `HOME_STATUS_FRAME` originally lived in `app/page.tsx`; it moved to
 * `home-view.ts` (WI-1b, alongside the pre-existing
 * `GATE_ATTENTION_STATUS_FRAME`) because a Next.js App Router `page.tsx` may
 * only export its own reserved fields — an arbitrary named export fails
 * `next build`'s page-export validation (found running this lane's own
 * build gate; see `next build`'s error: `"HOME_STATUS_FRAME" is not a valid
 * Page export field`).
 *
 * RUN: cd forge-ui && npx vitest run lib/home-status-frame-render.test.ts
 */
import { test, expect } from 'vitest';

import { HOME_STATUSES, HOME_STATUS_FRAME } from './home-view.ts';

test('WI-1b HOME_STATUS_FRAME has an entry for EVERY HomeStatus member — exhaustive over HOME_STATUSES, so a future 5th member cannot silently miss the map', () => {
  for (const status of HOME_STATUSES) {
    expect(HOME_STATUS_FRAME[status], `HOME_STATUS_FRAME is missing an entry for "${status}"`).toBeDefined();
  }
  // No stray keys either — the map's domain is EXACTLY HOME_STATUSES.
  expect(Object.keys(HOME_STATUS_FRAME).sort()).toEqual([...HOME_STATUSES].sort());
});

test('WI-1b HOME_STATUS_FRAME.failed maps to the shared "failed" CSS token (STATUS_COLOR.failed / WI_STATUS_GLOW.failed, lib/status-colors.ts) — never an invented colour', () => {
  expect(HOME_STATUS_FRAME.failed).toBe('failed');
});

test('WI-1b HOME_STATUS_FRAME: the three pre-existing members keep their pre-existing mapping (widening never silently re-colours an existing state)', () => {
  expect(HOME_STATUS_FRAME.active).toBe('active');
  expect(HOME_STATUS_FRAME.gated).toBe('retrying');
  expect(HOME_STATUS_FRAME.idle).toBe('pending');
});
