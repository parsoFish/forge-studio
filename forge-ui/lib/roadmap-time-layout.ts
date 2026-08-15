/**
 * W6-RV-2 — pure layout math for the roadmap "B-prime" completion-time
 * canvas (mockups/roadmap-uplift/b-prime.html is the operator-locked visual
 * reference; this module ports its `layout()` function to real
 * `RoadmapInitiative[]` data, dropping the mock's replay/today toggle — the
 * product only ever shows real status).
 *
 * THE AXIS RULE: X encodes real completion time for DONE initiatives —
 * day-columns in completion order, positioned left→right. Pending work
 * (nothing to date yet) continues right of the now-line, banded by
 * dependency-feasibility (`in-flight → ready → after-prerequisites →
 * unplanned`), under NO dates — an honest "projected, dependency order not
 * calendar forecast" contract (mock decision point P1).
 *
 * Dense days wrap column-major into sub-columns of ≤`MAX_ROWS` (mock P2) so
 * a 19-initiative merge day reads as a dense block, not a 1500px-tall
 * column. Inter-day gaps are capped-proportional (mock P3): X advances one
 * sub-column per burst of work, ordinal between bursts, but the corridor
 * BETWEEN bursts grows with real elapsed days (capped at `GAP_MAX`) so a
 * multi-day lull still reads as a lull without wasting canvas width on it.
 *
 * Every function here is pure — no DOM, no fetch, no `Date.now()` (the
 * caller passes `nowMs` explicitly) — so the whole layout is unit-testable
 * without a browser (`roadmap-time-layout.test.ts`).
 */

import type { RoadmapInitiative } from '@/lib/bridge-client';
import { byDepth } from '@/lib/roadmap-dag-layout';

// ---------------------------------------------------------------------------
// Geometry constants — CARD_W/CARD_H mirror the RV-1 collapsed-card contract
// (RoadmapNode's 280×72 fixed size); the rest mirror the b-prime mock 1:1
// (renamed to camelCase/UPPER_SNAKE for this module's own style).
// ---------------------------------------------------------------------------

export const CARD_W = 280;
export const CARD_H = 72;
export const GAP_X = 14;
export const GAP_Y = 14;
/** A day (or band) wraps column-major once it would exceed this many rows. */
export const MAX_ROWS = 6;
/** Vertical space reserved above a block's first row for its caption. */
export const CAP_HEIGHT = 26;
export const ORIGIN_X = 26;
/** Base gap width between two adjacent day columns (or the last day and the now-line). */
export const GAP_BASE = 46;
/** Extra gap width per elapsed day beyond the first, before the GAP_MAX cap. */
export const GAP_PER_DAY = 26;
/** Gap width never grows past this, however long the idle spell. */
export const GAP_MAX = 150;
/** Extra clearance on both sides of the now-line. */
export const NOW_GAP = 64;
/** Horizontal gap between two adjacent pending bands. */
export const BAND_GAP = 56;
/** An inter-day gap only earns a "··· n days" chip once it's this wide (in days). */
export const GAP_CHIP_THRESHOLD_DAYS = 3;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CardPosition = { id: string; x: number; y: number; w: number; h: number };

export type DayGroup = { day: string; items: RoadmapInitiative[] };

export type DayCaption = { x: number; day: string; count: number };

/**
 * `'done-no-date'` is NOT a dependency-feasibility band like the other
 * four — it holds initiatives that genuinely FINISHED (`status` done/
 * merged) but whose completion instant is honestly undiscoverable
 * (`completedAt` absent — see `Run.completedAt`'s fail-open contract).
 * Reviewer finding (MEDIUM): such a card must never be placed in `'ready'`
 * ("ready — projected next") — that reads completed work as UPCOMING,
 * which is backwards. It sits leftmost (immediately right of the now-line,
 * before any genuinely-pending band) precisely because it already
 * happened; the canvas just can't say when.
 */
export type PendingBand = 'done-no-date' | 'in-flight' | 'ready' | 'after-prerequisites' | 'unplanned';

export const PENDING_BAND_ORDER: readonly PendingBand[] = [
  'done-no-date',
  'in-flight',
  'ready',
  'after-prerequisites',
  'unplanned',
];

export type BandCaption = { x: number; band: PendingBand; count: number; width: number };

export type GapChip = { cx: number; days: number };

export type MonthTick = { label: string; from: number; to: number; boundary: boolean };

export type RoadmapTimeLayout = {
  /** initiativeId → its absolute {x,y,w,h} in world space. Every initiative
   *  passed in gets an entry — done ones on the time axis, pending ones in
   *  their band — UNLESS the roadmap is entirely empty. */
  positions: Map<string, CardPosition>;
  dayCaptions: DayCaption[];
  bandCaptions: BandCaption[];
  gaps: GapChip[];
  months: MonthTick[];
  /** World-space X of the amber now-line, or null when there is neither
   *  completed nor pending work to anchor it against (empty roadmap). */
  nowX: number | null;
  /** World-space X where the hatched "projected" zone begins — always equal
   *  to `nowX` when present (kept as a distinct field so the renderer never
   *  has to assume that equality holds). */
  projectedFromX: number | null;
  /** Human label for the now-line, e.g. "now · 2026-08-15 14:32". */
  nowLabel: string;
  worldWidth: number;
  worldHeight: number;
};

// ---------------------------------------------------------------------------
// Day bucketing
// ---------------------------------------------------------------------------

/**
 * Group every initiative that carries a `completedAt` into ascending-order
 * day buckets (`YYYY-MM-DD`, UTC slice of the ISO string — no timezone
 * conversion, matching how the mock's provenance was derived). Initiatives
 * WITHOUT `completedAt` are simply absent from the result — the caller
 * treats "not in any day group" as "pending" (`bucketByCompletionDay` never
 * fabricates a date).
 */
export function bucketByCompletionDay(initiatives: readonly RoadmapInitiative[]): DayGroup[] {
  const withDate = initiatives
    .filter((i): i is RoadmapInitiative & { completedAt: string } => i.completedAt !== undefined)
    .slice()
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0));

  const days: DayGroup[] = [];
  for (const init of withDate) {
    const day = init.completedAt.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(init);
    else days.push({ day, items: [init] });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Column-major wrap (mock P2) — shared by day blocks AND pending bands.
// ---------------------------------------------------------------------------

/**
 * Lay out `items` (already in the order they should read top→bottom,
 * then next column) into a column-major grid capped at `maxRows` rows,
 * starting at world-X `xStart`. Returns each item's position plus the
 * block's total width (so the caller can advance its cursor).
 *
 * k = number of columns = ceil(n / maxRows); rows = ceil(n / k) — the SAME
 * two-step derivation the mock uses, which keeps a block as SHORT as
 * possible (not just "cap rows at maxRows and let columns run wild"): 19
 * items wrap to a 4-column × 5-row block (not 4 cols × 6 rows with an
 * under-used last row), matching the mock's cited Jul-3 degenerate case.
 */
export function layoutBlock(
  items: readonly RoadmapInitiative[],
  xStart: number,
  maxRows: number = MAX_ROWS,
): { positions: CardPosition[]; width: number; cols: number; rows: number } {
  if (items.length === 0) return { positions: [], width: 0, cols: 0, rows: 0 };
  const cols = Math.ceil(items.length / maxRows);
  const rows = Math.ceil(items.length / cols);
  const positions = items.map((item, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    return {
      id: item.initiativeId,
      x: xStart + col * (CARD_W + GAP_X),
      y: CAP_HEIGHT + row * (CARD_H + GAP_Y),
      w: CARD_W,
      h: CARD_H,
    };
  });
  const width = cols * (CARD_W + GAP_X) - GAP_X;
  return { positions, width, cols, rows };
}

// ---------------------------------------------------------------------------
// Gap compression (mock P3)
// ---------------------------------------------------------------------------

/** Whole-day difference between two `YYYY-MM-DD` strings (UTC midnight). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Capped-proportional gap width between two adjacent day columns (or the
 * last day and the now-line): a same/next-day gap costs `GAP_BASE`; each
 * additional elapsed day adds `GAP_PER_DAY`, capped at `GAP_BASE + GAP_MAX`
 * total — so an 11-day quiet spell never claims more canvas width than the
 * entire migration-wave burst next to it.
 */
export function computeGapWidth(diffDays: number): number {
  return GAP_BASE + Math.min(GAP_MAX, Math.max(0, diffDays - 1) * GAP_PER_DAY);
}

// ---------------------------------------------------------------------------
// Pending-band assignment (dependency-feasibility order, no dates)
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: ReadonlySet<RoadmapInitiative['status']> = new Set([
  'in-flight',
  'ready-for-review',
  'failed',
]);

/** `done`/`merged` — genuinely finished, just missing a derivable
 *  `completedAt` (see the `PendingBand` doc comment above). */
const DONE_STATUSES: ReadonlySet<RoadmapInitiative['status']> = new Set(['done', 'merged']);

/**
 * Which band a still-open (no `completedAt`) initiative belongs in. Order
 * matters: a completed-but-undated initiative is classified FIRST (it is
 * not "still pending" in any dependency-feasibility sense — see
 * `'done-no-date'`'s doc comment), then actively-working statuses (an
 * in-flight/gated/failed initiative is by definition already planned, so
 * this never actually races the unplanned check), then unplanned, then
 * ready-vs-blocked — mirroring the mock's `laneOf`.
 */
export function assignPendingBand(initiative: RoadmapInitiative): PendingBand {
  if (DONE_STATUSES.has(initiative.status)) return 'done-no-date';
  if (ACTIVE_STATUSES.has(initiative.status)) return 'in-flight';
  if (initiative.workItems === undefined) return 'unplanned';
  return initiative.ready ? 'ready' : 'after-prerequisites';
}

// ---------------------------------------------------------------------------
// Month/day tick labels
// ---------------------------------------------------------------------------

function monthLabel(day: string): string {
  const monthIdx = Number(day.slice(5, 7)) - 1;
  return `${MONTH_LABELS[monthIdx] ?? '?'} ${day.slice(0, 4)}`;
}

function formatNowLabel(nowMs: number): string {
  const iso = new Date(nowMs).toISOString();
  return `now · ${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

// ---------------------------------------------------------------------------
// Top-level layout
// ---------------------------------------------------------------------------

/**
 * Compute the full B-prime canvas layout: a completion-time axis for every
 * `completedAt`-carrying initiative (day columns, wrapped ≤`MAX_ROWS`,
 * capped-proportional gaps), then an amber now-line, then the pending work
 * banded by dependency-feasibility (no dates) — see the module doc comment
 * for the full rule. Pure: same inputs always produce the same layout.
 */
export function computeRoadmapTimeLayout(
  initiatives: readonly RoadmapInitiative[],
  nowMs: number,
): RoadmapTimeLayout {
  const positions = new Map<string, CardPosition>();
  const dayCaptions: DayCaption[] = [];
  const bandCaptions: BandCaption[] = [];
  const gaps: GapChip[] = [];
  const months: MonthTick[] = [];

  const dayGroups = bucketByCompletionDay(initiatives);

  let x = ORIGIN_X;
  let prevDay: string | null = null;
  let prevMonth: string | null = null;

  for (const group of dayGroups) {
    if (prevDay !== null) {
      const diff = daysBetween(prevDay, group.day);
      const gapW = computeGapWidth(diff);
      if (diff >= GAP_CHIP_THRESHOLD_DAYS) gaps.push({ cx: x + gapW / 2, days: diff });
      x += gapW;
    }
    const mon = group.day.slice(0, 7);
    if (mon !== prevMonth) {
      months.push({
        label: monthLabel(group.day),
        from: x - (prevDay !== null ? GAP_BASE / 2 : ORIGIN_X / 2),
        to: x, // patched to the next month's `from` (or the final x) below
        boundary: prevDay !== null,
      });
      prevMonth = mon;
    }
    const { positions: blockPositions, width } = layoutBlock(group.items, x);
    for (const p of blockPositions) positions.set(p.id, p);
    dayCaptions.push({ x, day: group.day, count: group.items.length });
    x += width;
    prevDay = group.day;
  }
  for (let i = 0; i < months.length; i++) {
    months[i] = { ...months[i], to: i + 1 < months.length ? months[i + 1].from : x };
  }

  const pending = initiatives.filter((i) => !positions.has(i.initiativeId));
  const depthById = byDepth(initiatives);

  let nowX: number | null = null;
  let projectedFromX: number | null = null;

  if (dayGroups.length > 0 || pending.length > 0) {
    x += NOW_GAP;
    nowX = x;
    x += NOW_GAP;
    projectedFromX = nowX;

    const banded = new Map<PendingBand, RoadmapInitiative[]>(PENDING_BAND_ORDER.map((b) => [b, []]));
    for (const init of pending) banded.get(assignPendingBand(init))!.push(init);

    for (const band of PENDING_BAND_ORDER) {
      const group = banded.get(band)!;
      if (group.length === 0) continue;
      group.sort((a, b) => {
        const da = depthById.get(a.initiativeId) ?? 0;
        const db = depthById.get(b.initiativeId) ?? 0;
        return da - db;
      });
      const { positions: blockPositions, width } = layoutBlock(group, x);
      for (const p of blockPositions) positions.set(p.id, p);
      bandCaptions.push({ x, band, count: group.length, width });
      x += width + BAND_GAP;
    }
    if (bandCaptions.length > 0) x -= BAND_GAP;
  }

  const worldWidth = x + ORIGIN_X;
  const worldHeight = CAP_HEIGHT + MAX_ROWS * (CARD_H + GAP_Y) - GAP_Y + 24;

  return {
    positions,
    dayCaptions,
    bandCaptions,
    gaps,
    months,
    nowX,
    projectedFromX,
    nowLabel: formatNowLabel(nowMs),
    worldWidth,
    worldHeight,
  };
}
