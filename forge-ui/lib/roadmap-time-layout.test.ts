/**
 * W6-RV-2 — pure-function tests for the B-prime completion-time canvas
 * layout (forge-ui/lib/roadmap-time-layout.ts). Covers day bucketing,
 * column-major wrap (≤6 rows, including the real betterado degenerate
 * shapes cited in the mock (docs/reference/studio-copy.md): a 19-merge day and an 11-item
 * no-dep-root band), capped-proportional gap compression, and
 * dependency-feasibility band assignment for pending work.
 *
 * RUN: npx vitest run lib/roadmap-time-layout.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import type { RoadmapInitiative } from '@/lib/bridge-client';
import {
  bucketByCompletionDay,
  layoutBlock,
  computeGapWidth,
  daysBetween,
  assignPendingBand,
  computeRoadmapTimeLayout,
  CARD_W,
  CARD_H,
  GAP_X,
  GAP_Y,
  MAX_ROWS,
  GAP_BASE,
  GAP_MAX,
  GAP_CHIP_THRESHOLD_DAYS,
  PENDING_BAND_ORDER,
} from '@/lib/roadmap-time-layout';

function init(
  id: string,
  overrides: Partial<RoadmapInitiative> = {},
): RoadmapInitiative {
  return {
    initiativeId: id,
    title: id,
    status: 'pending',
    dependsOnInitiatives: [],
    ready: true,
    blockedBy: [],
    ...overrides,
  };
}

function done(id: string, completedAt: string, deps: string[] = []): RoadmapInitiative {
  return init(id, { status: 'done', dependsOnInitiatives: deps, completedAt });
}

// ---------------------------------------------------------------------------
// bucketByCompletionDay
// ---------------------------------------------------------------------------

test('bucketByCompletionDay: groups by UTC day, ascending, items ascending within a day', () => {
  const items = [
    done('C', '2026-06-08T14:00:00.000Z'),
    done('A', '2026-06-05T09:00:00.000Z'),
    done('B', '2026-06-08T02:00:00.000Z'),
  ];
  const groups = bucketByCompletionDay(items);
  expect(groups.map((g) => g.day)).toEqual(['2026-06-05', '2026-06-08']);
  expect(groups[1].items.map((i) => i.initiativeId)).toEqual(['B', 'C']);
});

test('bucketByCompletionDay: initiatives with no completedAt are excluded entirely', () => {
  const items = [done('A', '2026-06-05T09:00:00.000Z'), init('B')];
  const groups = bucketByCompletionDay(items);
  expect(groups).toHaveLength(1);
  expect(groups[0].items.map((i) => i.initiativeId)).toEqual(['A']);
});

test('bucketByCompletionDay: empty input yields no groups', () => {
  expect(bucketByCompletionDay([])).toEqual([]);
});

// ---------------------------------------------------------------------------
// layoutBlock — column-major wrap ≤ MAX_ROWS
// ---------------------------------------------------------------------------

test('layoutBlock: a block at or under MAX_ROWS stays a single column', () => {
  const items = [init('A'), init('B'), init('C')];
  const { positions, cols, rows, width } = layoutBlock(items, 100);
  expect(cols).toBe(1);
  expect(rows).toBe(3);
  expect(positions.map((p) => p.id)).toEqual(['A', 'B', 'C']);
  // column-major: all three stack vertically at the same x.
  expect(new Set(positions.map((p) => p.x)).size).toBe(1);
  expect(positions[0].x).toBe(100);
  expect(width).toBe(CARD_W); // single column — no inter-column gap consumed
});

test('layoutBlock: exactly MAX_ROWS items still fits one column', () => {
  const items = Array.from({ length: MAX_ROWS }, (_, i) => init(`I${i}`));
  const { cols, rows } = layoutBlock(items, 0);
  expect(cols).toBe(1);
  expect(rows).toBe(MAX_ROWS);
});

test('layoutBlock: 19-merges-one-day (real betterado Jul-3 shape) wraps to a 4-col × 5-row block', () => {
  const items = Array.from({ length: 19 }, (_, i) => init(`I${i}`));
  const { cols, rows, positions, width } = layoutBlock(items, 50);
  expect(cols).toBe(4);
  expect(rows).toBe(5);
  expect(positions).toHaveLength(19);
  // Column-major order preserved: item 0 is (col 0, row 0); item 5 starts col 1.
  expect(positions[0]).toMatchObject({ id: 'I0', x: 50, y: 26 });
  expect(positions[5]).toMatchObject({ id: 'I5', x: 50 + (CARD_W + GAP_X) });
  // Last column (col 3) only holds items 15-18 → 4 rows, row 4 empty (no 20th item).
  const lastCol = positions.filter((p) => p.x === 50 + 3 * (CARD_W + GAP_X));
  expect(lastCol).toHaveLength(4);
  expect(width).toBe(4 * (CARD_W + GAP_X) - GAP_X);
});

test('layoutBlock: 11-no-dep-roots (real betterado band shape) wraps to a 2-col × 6-row block', () => {
  const items = Array.from({ length: 11 }, (_, i) => init(`ROOT-${i}`));
  const { cols, rows, positions } = layoutBlock(items, 0);
  expect(cols).toBe(2);
  expect(rows).toBe(6);
  // Second column holds the remaining 5 (11 - 6).
  const col1 = positions.filter((p) => p.x === CARD_W + GAP_X);
  expect(col1).toHaveLength(5);
});

test('layoutBlock: empty items yields no positions and zero width', () => {
  expect(layoutBlock([], 0)).toEqual({ positions: [], width: 0, cols: 0, rows: 0 });
});

test('layoutBlock: card height/geometry matches the RV-1 collapsed-card contract (280×72)', () => {
  const { positions } = layoutBlock([init('A')], 0);
  expect(positions[0].w).toBe(CARD_W);
  expect(positions[0].h).toBe(CARD_H);
  expect(CARD_W).toBe(280);
  expect(CARD_H).toBe(72);
});

// ---------------------------------------------------------------------------
// Gap compression
// ---------------------------------------------------------------------------

test('daysBetween: whole-day difference, UTC', () => {
  expect(daysBetween('2026-06-05', '2026-06-08')).toBe(3);
  expect(daysBetween('2026-06-05', '2026-06-05')).toBe(0);
});

test('computeGapWidth: consecutive/next day costs the base width only', () => {
  expect(computeGapWidth(1)).toBe(GAP_BASE);
});

test('computeGapWidth: grows per elapsed day, capped at GAP_BASE + GAP_MAX', () => {
  expect(computeGapWidth(2)).toBe(GAP_BASE + 26);
  const uncapped = computeGapWidth(4); // (4-1)*26 = 78, under the cap
  expect(uncapped).toBeLessThan(GAP_BASE + GAP_MAX);
  // An 11-day quiet spell (the real Jun-20→Jul-01 betterado gap) must be
  // capped, not allowed to dwarf a dense work block.
  expect(computeGapWidth(11)).toBe(GAP_BASE + GAP_MAX);
  expect(computeGapWidth(365)).toBe(GAP_BASE + GAP_MAX); // never exceeds the cap
});

test('computeRoadmapTimeLayout: an idle gap only earns a "··· n days" chip at the threshold', () => {
  const items = [done('A', '2026-06-05T09:00:00.000Z'), done('B', '2026-06-08T09:00:00.000Z')]; // 3-day gap
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-09T00:00:00.000Z'));
  expect(layout.gaps).toHaveLength(1);
  expect(layout.gaps[0].days).toBe(GAP_CHIP_THRESHOLD_DAYS);
});

test('computeRoadmapTimeLayout: a sub-threshold gap (overnight) gets no chip', () => {
  const items = [done('A', '2026-06-05T09:00:00.000Z'), done('B', '2026-06-06T09:00:00.000Z')]; // 1-day gap
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-07T00:00:00.000Z'));
  expect(layout.gaps).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Pending-band assignment
// ---------------------------------------------------------------------------

test('assignPendingBand: an in-flight/gated/failed initiative always bands as in-flight', () => {
  expect(assignPendingBand(init('A', { status: 'in-flight' }))).toBe('in-flight');
  expect(assignPendingBand(init('A', { status: 'ready-for-review' }))).toBe('in-flight');
  expect(assignPendingBand(init('A', { status: 'failed' }))).toBe('in-flight');
});

test('assignPendingBand: unplanned (no WI snapshot) pending initiative bands as unplanned', () => {
  expect(assignPendingBand(init('A', { status: 'pending', workItems: undefined }))).toBe('unplanned');
});

test('assignPendingBand: planned + ready pending initiative bands as ready', () => {
  expect(assignPendingBand(init('A', { status: 'pending', ready: true, workItems: [] }))).toBe('ready');
});

test('assignPendingBand: planned + blocked pending initiative bands as after-prerequisites', () => {
  expect(assignPendingBand(init('A', { status: 'pending', ready: false, workItems: [] }))).toBe(
    'after-prerequisites',
  );
});

// ---------------------------------------------------------------------------
// Reviewer finding (MEDIUM): a genuinely completed initiative with an
// honestly-absent completedAt must NEVER read as upcoming work ('ready').
// It gets its own 'done-no-date' band instead.
// ---------------------------------------------------------------------------

test('assignPendingBand: a done initiative with no completedAt bands as done-no-date, never ready', () => {
  const result = assignPendingBand(init('A', { status: 'done', ready: true, workItems: [{ id: 'WI-1', title: 'x', dependsOn: [], status: 'complete' }] }));
  expect(result).toBe('done-no-date');
  expect(result).not.toBe('ready');
});

test('assignPendingBand: a merged initiative with no completedAt bands as done-no-date, never ready', () => {
  const result = assignPendingBand(init('A', { status: 'merged', ready: true, workItems: [] }));
  expect(result).toBe('done-no-date');
  expect(result).not.toBe('ready');
});

test('computeRoadmapTimeLayout: a done initiative with no completedAt lands in the done-no-date band, not ready', () => {
  const items = [
    init('DONE-NO-DATE', { status: 'done', ready: true, workItems: [] }),
    init('READY-1', { status: 'pending', ready: true, workItems: [] }),
  ];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-10T00:00:00.000Z'));
  const doneCaption = layout.bandCaptions.find((b) => b.band === 'done-no-date');
  expect(doneCaption).toBeDefined();
  expect(doneCaption!.count).toBe(1);
  const readyCaption = layout.bandCaptions.find((b) => b.band === 'ready');
  expect(readyCaption).toBeDefined();
  expect(readyCaption!.count).toBe(1); // only the genuinely-pending READY-1, not DONE-NO-DATE
  // done-no-date sits LEFTMOST among the pending bands (right after the
  // now-line) — it already happened; it is not "projected next".
  expect(layout.bandCaptions[0].band).toBe('done-no-date');
  expect(layout.positions.get('DONE-NO-DATE')!.x).toBeLessThan(layout.positions.get('READY-1')!.x);
});

// ---------------------------------------------------------------------------
// computeRoadmapTimeLayout — end to end
// ---------------------------------------------------------------------------

test('computeRoadmapTimeLayout: places every initiative — done ones on the axis, pending ones banded', () => {
  const items = [
    done('DONE-1', '2026-06-05T09:00:00.000Z'),
    init('READY-1', { status: 'pending', ready: true, workItems: [] }),
    init('BLOCKED-1', { status: 'pending', ready: false, workItems: [], dependsOnInitiatives: ['DONE-1'] }),
    init('UNPLANNED-1', { status: 'pending', workItems: undefined }),
    init('ACTIVE-1', { status: 'in-flight', workItems: [] }),
  ];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-10T00:00:00.000Z'));
  expect(layout.positions.size).toBe(5);
  for (const id of items.map((i) => i.initiativeId)) {
    expect(layout.positions.has(id)).toBe(true);
  }
  expect(layout.nowX).not.toBeNull();
  expect(layout.projectedFromX).toBe(layout.nowX);
  expect(layout.dayCaptions).toHaveLength(1);
  expect(layout.dayCaptions[0].count).toBe(1);
  const bandNames = layout.bandCaptions.map((b) => b.band);
  expect(new Set(bandNames)).toEqual(new Set(['in-flight', 'ready', 'after-prerequisites', 'unplanned']));
  // Bands render in dependency-feasibility order.
  const orderIdx = (b: string) => PENDING_BAND_ORDER.indexOf(b as never);
  for (let i = 1; i < bandNames.length; i++) {
    expect(orderIdx(bandNames[i])).toBeGreaterThan(orderIdx(bandNames[i - 1]));
  }
});

test('computeRoadmapTimeLayout: no completed work — every initiative bands right of an early now-line', () => {
  const items = [init('A', { status: 'pending', ready: true, workItems: [] })];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-10T00:00:00.000Z'));
  expect(layout.dayCaptions).toHaveLength(0);
  expect(layout.nowX).not.toBeNull();
  expect(layout.positions.get('A')!.x).toBeGreaterThan(layout.nowX!);
});

test('computeRoadmapTimeLayout: empty roadmap — no now-line fabricated', () => {
  const layout = computeRoadmapTimeLayout([], Date.parse('2026-06-10T00:00:00.000Z'));
  expect(layout.nowX).toBeNull();
  expect(layout.projectedFromX).toBeNull();
  expect(layout.positions.size).toBe(0);
});

test('computeRoadmapTimeLayout: all done, nothing pending — now-line still renders (no band captions)', () => {
  const items = [done('A', '2026-06-05T09:00:00.000Z')];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-10T00:00:00.000Z'));
  expect(layout.nowX).not.toBeNull();
  expect(layout.bandCaptions).toHaveLength(0);
});

test('computeRoadmapTimeLayout: month tick boundary only appears when the calendar month actually changes', () => {
  const items = [done('A', '2026-06-30T09:00:00.000Z'), done('B', '2026-07-01T09:00:00.000Z')];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-07-02T00:00:00.000Z'));
  expect(layout.months.map((m) => m.label)).toEqual(['Jun 2026', 'Jul 2026']);
  expect(layout.months[1].boundary).toBe(true);
});

test('computeRoadmapTimeLayout: pending band secondary sort follows dependency depth', () => {
  const items = [
    done('ROOT', '2026-06-05T09:00:00.000Z'),
    init('DEEP', { status: 'pending', ready: false, workItems: [], dependsOnInitiatives: ['MID'] }),
    init('MID', { status: 'pending', ready: false, workItems: [], dependsOnInitiatives: ['ROOT'] }),
  ];
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-06-10T00:00:00.000Z'));
  // Both items land in the same "after-prerequisites" band; with only 2
  // items the block stays a single column, so depth ordering shows up as
  // ROW order (shallower depth first) rather than a column/x difference.
  const midPos = layout.positions.get('MID')!;
  const deepPos = layout.positions.get('DEEP')!;
  expect(midPos.x).toBe(deepPos.x);
  expect(midPos.y).toBeLessThan(deepPos.y);
});

// ---------------------------------------------------------------------------
// Reviewer finding (LOW): a real betterado-scale burst (51 initiatives, all
// merged the SAME day) through the FULL pipeline, not just layoutBlock in
// isolation — proves day-bucketing + column-major wrap + world sizing all
// agree with each other end to end at realistic scale.
// ---------------------------------------------------------------------------

test('computeRoadmapTimeLayout: a 51-initiative all-same-day burst wraps to a single 9-col × ≤6-row day block, every card placed, no now-line fabricated past it incorrectly', () => {
  const SAME_DAY = '2026-07-01T';
  const items = Array.from({ length: 51 }, (_, i) =>
    done(`INIT-${i}`, `${SAME_DAY}${String(8 + Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 6).padStart(2, '0')}:00.000Z`),
  );
  const layout = computeRoadmapTimeLayout(items, Date.parse('2026-07-02T00:00:00.000Z'));

  // Exactly one day bucket, carrying all 51.
  expect(layout.dayCaptions).toHaveLength(1);
  expect(layout.dayCaptions[0].day).toBe('2026-07-01');
  expect(layout.dayCaptions[0].count).toBe(51);

  // Every initiative is placed (none silently dropped at scale).
  expect(layout.positions.size).toBe(51);
  for (const item of items) expect(layout.positions.has(item.initiativeId)).toBe(true);

  // Column-major wrap: 9 columns (ceil(51/6)) × ≤6 rows each; the world
  // width/height agree with that same shape (no drift between layoutBlock's
  // own internal math and the top-level world sizing).
  const xs = new Set([...layout.positions.values()].map((p) => p.x));
  expect(xs.size).toBe(9);
  // 6 rows max — the exact CAP_HEIGHT offset is covered by the layoutBlock
  // unit tests above; here a generous upper bound over 6 rows is enough to
  // catch a wrap regression at real scale (e.g. a row cap silently dropped).
  const maxRowY = 26 + (MAX_ROWS - 1) * (CARD_H + GAP_Y);
  for (const p of layout.positions.values()) {
    expect(p.y).toBeLessThanOrEqual(maxRowY);
  }

  // No day-to-day gap chip (there is only one day — nothing to compress),
  // but a real now-line still anchors right after the burst since there is
  // no pending work in this fixture.
  expect(layout.gaps).toHaveLength(0);
  expect(layout.nowX).not.toBeNull();
  expect(layout.bandCaptions).toHaveLength(0);
});
