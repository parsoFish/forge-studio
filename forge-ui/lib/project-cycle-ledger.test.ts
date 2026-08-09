/**
 * Acceptance tests for the PROJECT-CYCLE ledger adapter (R4-12 F2) —
 * `forge-ui/lib/project-cycle-ledger.ts`, a pure module that does not exist
 * yet. Every assertion below is a legitimate RED against a not-yet-created
 * file; the missing named export `deriveProjectCycleLedgerRows` (and the
 * missing module itself) is the RED signal.
 *
 * WHY THIS MODULE: a project's own cycles (`GET /api/cycles` -> `Cycle[]`,
 * `./bridge-client.ts`) must render in the SAME run-history ledger vocabulary
 * — `when · what · outcome-narrative · status · cost` — that R6-05's flow
 * monitor (`./flow-ledger.ts`) and R6-06's agent monitor (`./agent-ledger.ts`)
 * already render. This adapter is the THIRD caller of the shared engine in
 * `./history-ledger.ts`, reusing `LedgerRow`/`renderNarrative`/
 * `sortLedgerRowsNewestFirst` UNCHANGED (D2, the reuse seam) rather than
 * forking a fourth, parallel row vocabulary of its own.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORT from `./project-cycle-ledger.ts` (does not exist yet):
 *
 *   export function deriveProjectCycleLedgerRows(cycles: Cycle[]): LedgerRow[];
 *     // sorted newest-first (reuses D2's sortLedgerRowsNewestFirst)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * P0 CENSUS RESULT (RESOLVABLE — the load-bearing fact this file pins):
 *   a completed `cycleId` from `GET /api/cycles` resolves AS-IS as a `runId`
 *   on `/flows/forge-develop/run/<cycleId>` (same string). So a cycle row's
 *   `href` must carry the FULL `cycleId` string, NEVER a bare `initiativeId`
 *   (the two differ: `<ISO-ish-timestamp>_<initiativeId>` vs `<initiativeId>`
 *   — see `./cycle-grouping.ts`'s own note on the `cycleId` format).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CORPUS-GROUNDED FIXTURE (committed provenance): the completed anchor cycle
 * below is a REAL archived cycle. The raw `_logs` JSONL is gitignored, so the
 * `Cycle` shape is constructed by hand (house style: scripts/lib/
 * journey-fixtures.mjs, which already references this same cycle at
 * `_queue/done/INIT-2026-07-11-exclude-path-filter.md`, gitpulse).
 *   cycle_id:      2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter
 *   initiative_id: INIT-2026-07-11-exclude-path-filter
 *   project:       gitpulse
 *   outcome:       "PR #7 merged, CI green. Version bumped to 0.6.1."
 *                  (a terminal/done cycle — status settles at 'done')
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT EACH TEST KILLS (immutable-gates: name the wrong impl):
 *   AT-F2-1 kills (a) a re-implemented ledger vocabulary — the returned rows
 *     must satisfy history-ledger's OWN LedgerRow shape + null-narrative
 *     contract; (b) a status filter that drops completed/merged cycles — all
 *     three input cycles (done / merged / in-flight) must become rows; (c) a
 *     bare-`initiativeId` href — the completed row's href must be the FULL
 *     cycleId string.
 *   AT-F2-3 kills a FORKED ledger — the module must not re-declare the shared
 *     render/sort/format vocabulary, must build on the shared LedgerRow, and
 *     must introduce NO new data-section segment kind of its own.
 */
import { test, expect } from 'vitest';

import { deriveProjectCycleLedgerRows } from '@/lib/project-cycle-ledger';
import * as projectCycleLedger from '@/lib/project-cycle-ledger';
import {
  renderNarrative,
  sortLedgerRowsNewestFirst,
  type LedgerRow,
} from '@/lib/history-ledger';
import type { Cycle } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// The closed shared segment vocabulary — sourced VERBATIM from
// `./history-ledger.ts`'s `LedgerSegment` union (all TEN members). AT-F2-3
// asserts every row's `narrativeKinds` is a subset of this set: a forked
// ledger that invents its own cycle-specific kind (e.g. 'cycle-merged', the
// mockup's never-produced 'attention') would surface here. The spec forbids
// widening this set — "vocabulary shared, not re-implemented" — so a stale
// hardcode is exactly the intended contract, not a maintenance hazard.
// ---------------------------------------------------------------------------
const SHARED_SEGMENT_KINDS: ReadonlySet<string> = new Set([
  'work-items',
  'gate-fails',
  'review-findings',
  'gate-waiting',
  'failed',
  'merged',
  'reflection-lost',
  'standalone',
  'in-flow',
  'node-errors',
]);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real archived cycle (see header). Terminal/done — the completed
 *  outcome an operator most wants summarised, and exactly the shape a status
 *  filter is most tempted to drop. `startedAt` is the newest of the three
 *  fixtures so it sorts FIRST; `endedAt` differs from `startedAt` so a test
 *  can prove `when` carries `startedAt` (D7), never `endedAt`. */
const EXCLUDE_PATH_FILTER_CYCLE: Cycle = {
  cycleId: '2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter',
  initiativeId: 'INIT-2026-07-11-exclude-path-filter',
  project: 'gitpulse',
  status: 'done',
  startedAt: '2026-07-11T07:29:19Z',
  endedAt: '2026-07-11T09:00:00Z',
};

/** A second terminal cycle whose status is literally 'merged' — pins the
 *  "(completed/merged INCLUDED)" clause: a status filter dropping terminal
 *  cycles must not silently drop this one either. Oldest -> sorts LAST. */
const MERGED_PROBE_CYCLE: Cycle = {
  cycleId: '2026-06-01T00-00-00_INIT-merged-probe',
  initiativeId: 'INIT-merged-probe',
  project: 'gitpulse',
  status: 'merged',
  startedAt: '2026-05-01T00:00:00Z',
};

/** An in-flight cycle — proves the adapter does NOT filter to "only running"
 *  either. Middle -> sorts BETWEEN the two terminal cycles. */
const IN_FLIGHT_PROBE_CYCLE: Cycle = {
  cycleId: '2026-06-15T00-00-00_INIT-in-flight-probe',
  initiativeId: 'INIT-in-flight-probe',
  project: 'gitpulse',
  status: 'in-flight',
  startedAt: '2026-06-15T00:00:00Z',
};

const EXPECTED_COMPLETED_HREF =
  '/flows/forge-develop/run/2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter';

/** The bare-`initiativeId` href the P0 census forbids — the completed row's
 *  href must NEVER collapse to this. */
const BARE_INITIATIVE_HREF = '/flows/forge-develop/run/INIT-2026-07-11-exclude-path-filter';

// ---------------------------------------------------------------------------
// Shared LedgerRow shape assertion — the returned rows must satisfy
// history-ledger's OWN row contract, not a look-alike fork.
// ---------------------------------------------------------------------------
function assertLedgerRowShape(row: LedgerRow): void {
  expect(typeof row.id).toBe('string');
  expect(typeof row.when).toBe('string');
  expect(typeof row.what).toBe('string');
  expect(row.what.length).toBeGreaterThan(0);
  expect(row.narrative === null || typeof row.narrative === 'string').toBe(true);
  expect(Array.isArray(row.narrativeKinds)).toBe(true);
  for (const kind of row.narrativeKinds) expect(typeof kind).toBe('string');
  // LedgerRowStatus resolves to a string vocabulary (D8) — a real status
  // string, never the mockup's invented 'attention'.
  expect(typeof row.status).toBe('string');
  // Cost is honest-absent: no cost source exists in a `Cycle`, so it must be
  // `null` — NEVER a fabricated `0`/`$0.00` (history-ledger's absent-cost
  // rule). null-or-number is the shape; the exact `null` is pinned in F2-1.
  expect(row.costUsd === null || typeof row.costUsd === 'number').toBe(true);
  expect(typeof row.href).toBe('string');
  // history-ledger's OWN contract, exercised through its OWN `renderNarrative`
  // (reused, not re-implemented): `narrative === null` IFF `narrativeKinds` is
  // empty, and the empty case renders exactly `renderNarrative([])` (=== null),
  // never '' or an invented 'none'. Kills a fork that renders empty as filler.
  expect(row.narrative === null).toBe(row.narrativeKinds.length === 0);
  if (row.narrativeKinds.length === 0) {
    expect(row.narrative).toBe(renderNarrative([]));
  }
}

// ---------------------------------------------------------------------------
// AT-F2-1 — adapter + shared-vocab reuse + no-filter + full-cycleId href
// ---------------------------------------------------------------------------
test('AT-F2-1: deriveProjectCycleLedgerRows maps cycles to shared LedgerRows — full-cycleId href, status verbatim, no status filter drops completed/merged, LedgerRow shape', () => {
  // Input order is deliberately NOT newest-first (done=newest, merged=oldest,
  // in-flight=middle) so the sort assertion below is meaningful.
  const rows: LedgerRow[] = deriveProjectCycleLedgerRows([
    EXCLUDE_PATH_FILTER_CYCLE,
    MERGED_PROBE_CYCLE,
    IN_FLIGHT_PROBE_CYCLE,
  ]);

  // (b) NO status filter — every input cycle becomes a row. A filter that
  // drops terminal/completed cycles (the classic "only show live work") would
  // yield fewer than three rows.
  expect(rows).toHaveLength(3);

  // sortLedgerRowsNewestFirst reuse (D2): output is in the shared engine's
  // canonical newest-first order. `when` carries the raw ISO `startedAt`
  // (D7) — never `endedAt`, never a pre-formatted "3h ago".
  expect(rows.map((r) => r.when)).toEqual([
    '2026-07-11T07:29:19Z', // completed (done) — newest
    '2026-06-15T00:00:00Z', // in-flight — middle
    '2026-05-01T00:00:00Z', // merged probe — oldest
  ]);
  expect(rows).toEqual(sortLedgerRowsNewestFirst(rows));

  // Locate the completed row by its own (href-independent) `startedAt`, so
  // href-correctness is judged separately from sort-correctness.
  const completed = rows.find((r) => r.when === '2026-07-11T07:29:19Z');
  expect(completed).toBeDefined();

  // (c) href carries the FULL cycleId string AS-IS (P0 census) — never a
  // bare initiativeId.
  expect(completed!.href).toBe(EXPECTED_COMPLETED_HREF);
  expect(completed!.href).not.toBe(BARE_INITIATIVE_HREF);
  expect(completed!.href).toContain('2026-07-11T07-29-19_');

  // status copied VERBATIM — a terminal cycle's own status reaches the row
  // untouched, and the literal-'merged' cycle survives too.
  expect(completed!.status).toBe('done');
  expect(rows.find((r) => r.status === 'merged')).toBeDefined();

  // no cost source in a `Cycle` -> honest `null`, never a fabricated 0.
  expect(completed!.costUsd).toBe(null);

  // (a) every returned row satisfies history-ledger's OWN LedgerRow shape.
  for (const row of rows) assertLedgerRowShape(row);
});

// ---------------------------------------------------------------------------
// AT-F2-3 — shared, not re-implemented (kills a forked ledger)
// ---------------------------------------------------------------------------
test('AT-F2-3: project-cycle-ledger builds on history-ledger and introduces NO new ledger vocabulary of its own', () => {
  // (1) Structural: the module does NOT re-declare/re-export the shared
  // render/sort/format vocabulary. A CONSUMER imports these from
  // history-ledger; a FORK re-implements them here. Any of these being a
  // value ON this module is the fork tell.
  const mod = projectCycleLedger as Record<string, unknown>;
  expect(mod.renderNarrative).toBeUndefined();
  expect(mod.renderSegment).toBeUndefined();
  expect(mod.sortLedgerRowsNewestFirst).toBeUndefined();
  expect(mod.formatWhen).toBeUndefined();
  expect(mod.LedgerSegment).toBeUndefined();

  // (2) Builds on history-ledger's LedgerRow: the return assigns to
  // `LedgerRow[]` (intent) and each row is shape-valid at runtime (the
  // enforcement — .test.ts is not tsc-checked, so the runtime shape check is
  // what actually holds the line).
  const rows: LedgerRow[] = deriveProjectCycleLedgerRows([EXCLUDE_PATH_FILTER_CYCLE]);
  expect(rows).toHaveLength(1);
  for (const row of rows) assertLedgerRowShape(row);

  // (3) No NEW data-section vocabulary: every `narrativeKind` a row emits is
  // a member of history-ledger's CLOSED LedgerSegment union. A forked ledger
  // inventing its own cycle-specific kind would fail this subset check.
  for (const row of rows) {
    for (const kind of row.narrativeKinds) {
      expect(SHARED_SEGMENT_KINDS.has(kind)).toBe(true);
    }
  }
});
