/**
 * Acceptance tests for the SHOWCASE cycle-selector (R4-14 WI-1) —
 * `forge-ui/lib/project-showcase.ts`, a pure module that does NOT exist
 * yet. Every assertion below is a legitimate RED against a not-yet-created
 * file: the missing named export `deriveShowcaseCycleId` (and the missing
 * module itself) is the RED signal — a static `import` of a non-existent
 * module fails vitest's own module-resolution step before any assertion
 * runs, which is the "real" RED proof for every test in this file (see the
 * REAL RED PROOF note below the assumed-export block).
 *
 * WHY THIS MODULE: R4-14-F1 (the demo showcase page) needs "the project's
 * most recent [terminal] cycle" to know which cycle's demo artifacts to
 * render. This is a NEW pure deriver — distinct from
 * `./project-cycle-ledger.ts`'s `deriveProjectCycleLedgerRows` (which turns
 * EVERY cycle, of every status, into a history row with no filtering) and
 * from that file's own `deriveProjectCycleLedgerSegments`, whose
 * `status === 'merged' || status === 'done'` terminal-check this deriver
 * reuses the SHAPE of (a cycle counts as "showcase-worthy" only once its
 * merge has actually landed — `merged` the transient pass-through, `done`
 * the settled terminal, per `Cycle.status`'s own note in
 * `./bridge-client.ts:23`). A page.tsx cannot itself be pinned here (not
 * SSR-drivable — client fetch + useState) so this file pins the extracted
 * pure piece the page will call, same precedent as
 * `resolveDevelopStartCeilingToSend` / `deriveKbBandOptions`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORT from `./project-showcase.ts` (does not exist yet):
 *
 *   export function deriveShowcaseCycleId(
 *     cycles: Cycle[],
 *     projectId: string,
 *   ): string | null;
 *     // cycleId of the NEWEST cycle in `cycles` whose `project === projectId`
 *     // AND whose `status` is 'merged' or 'done' — every other status
 *     // (in-flight / ready-for-review / failed / pending) is excluded, as is
 *     // every other project. `null` when no such cycle exists (project has
 *     // no cycles at all, or none of its cycles ever reached merged/done).
 *     // "Newest" is decided PER-CYCLE by the fallback chain
 *     // `endedAt ?? startedAt ?? <timestamp parsed from the cycleId's own
 *     // leading stamp>` (T1 ruling) — never a single globally-chosen field,
 *     // so a genuinely-newer cycle whose `endedAt` has not landed yet is
 *     // never out-ranked by an older cycle whose `endedAt` happens to be set.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REAL RED PROOF (applies to every test below, per house precedent —
 * `./project-cycle-ledger.test.ts`'s header): `forge-ui/lib/project-showcase.ts`
 * does not exist, so the static `import { deriveShowcaseCycleId } from
 * '@/lib/project-showcase'` below fails vitest's own module resolution
 * (`Cannot find module '@/lib/project-showcase' or its corresponding type
 * declarations` / a rolldown "Failed to resolve import" error) BEFORE any
 * `test()` body runs. AT-1 additionally states the real assertion the
 * module must satisfy once it exists (`typeof deriveShowcaseCycleId ===
 * 'function'`) — today it never reaches that line; it RED-fails at the
 * import statement itself, the same missing-feature reason every other
 * test in this file RED-fails for.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIXTURES — real `Cycle` shape ONLY (`./bridge-client.ts:15`:
 * cycleId/initiativeId/project/status/startedAt/endedAt), no invented
 * fields. Two projects ('gitpulse' the target, 'betterado' foreign) mixed
 * with EVERY `Cycle['status']` literal represented across the set:
 * in-flight, ready-for-review, merged, done, failed, pending.
 */
import { test, expect } from 'vitest';

import { deriveShowcaseCycleId } from '@/lib/project-showcase';
import type { Cycle } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// AT-2 fixture — two projects, all six statuses, two merged|done cycles for
// the target project at different timestamps.
// ---------------------------------------------------------------------------

const TARGET_PROJECT = 'gitpulse';
const FOREIGN_PROJECT = 'betterado';

/** Target project, DONE, older of the two terminal gitpulse cycles. */
const GITPULSE_DONE_OLDER: Cycle = {
  cycleId: '2026-07-01T00-00-00_INIT-showcase-a',
  initiativeId: 'INIT-showcase-a',
  project: TARGET_PROJECT,
  status: 'done',
  startedAt: '2026-07-01T00:00:00Z',
  endedAt: '2026-07-01T02:00:00Z',
};

/** Target project, MERGED, NEWER of the two terminal gitpulse cycles — the
 *  expected AT-2 winner. Pins that a literal-'merged' status (not just
 *  'done') is honoured, and that "newest" beats "done vs merged" ordering. */
const GITPULSE_MERGED_NEWER: Cycle = {
  cycleId: '2026-07-05T00-00-00_INIT-showcase-b',
  initiativeId: 'INIT-showcase-b',
  project: TARGET_PROJECT,
  status: 'merged',
  startedAt: '2026-07-05T00:00:00Z',
  endedAt: '2026-07-05T01:00:00Z',
};

/** Target project, IN-FLIGHT, chronologically the NEWEST cycle in the whole
 *  fixture — must still be EXCLUDED. Kills an impl that just takes the
 *  overall-newest cycle regardless of status. */
const GITPULSE_IN_FLIGHT_NEWEST_OVERALL: Cycle = {
  cycleId: '2026-07-10T00-00-00_INIT-showcase-c',
  initiativeId: 'INIT-showcase-c',
  project: TARGET_PROJECT,
  status: 'in-flight',
  startedAt: '2026-07-10T00:00:00Z',
};

/** Target project, READY-FOR-REVIEW — excluded (not yet merged). */
const GITPULSE_READY_FOR_REVIEW: Cycle = {
  cycleId: '2026-07-08T00-00-00_INIT-showcase-d',
  initiativeId: 'INIT-showcase-d',
  project: TARGET_PROJECT,
  status: 'ready-for-review',
  startedAt: '2026-07-08T00:00:00Z',
};

/** Target project, FAILED — excluded. */
const GITPULSE_FAILED: Cycle = {
  cycleId: '2026-07-03T00-00-00_INIT-showcase-e',
  initiativeId: 'INIT-showcase-e',
  project: TARGET_PROJECT,
  status: 'failed',
  startedAt: '2026-07-03T00:00:00Z',
};

/** Target project, PENDING — excluded. */
const GITPULSE_PENDING: Cycle = {
  cycleId: '2026-07-02T00-00-00_INIT-showcase-f',
  initiativeId: 'INIT-showcase-f',
  project: TARGET_PROJECT,
  status: 'pending',
  startedAt: '2026-07-02T00:00:00Z',
};

/** FOREIGN project, MERGED, chronologically NEWER than gitpulse's own
 *  merged/done winner — must NEVER be picked for `projectId: 'gitpulse'`.
 *  Kills an impl that ignores `projectId` and just takes the newest
 *  merged/done cycle across ALL projects. */
const BETTERADO_MERGED_NEWEST_FOREIGN: Cycle = {
  cycleId: '2026-07-09T00-00-00_INIT-showcase-foreign',
  initiativeId: 'INIT-showcase-foreign',
  project: FOREIGN_PROJECT,
  status: 'merged',
  startedAt: '2026-07-09T00:00:00Z',
  endedAt: '2026-07-09T01:00:00Z',
};

const MIXED_TWO_PROJECT_ALL_STATUS_CYCLES: Cycle[] = [
  // Deliberately NOT in any sorted order — the deriver must do its own
  // newest-first reasoning, not rely on input order.
  GITPULSE_READY_FOR_REVIEW,
  BETTERADO_MERGED_NEWEST_FOREIGN,
  GITPULSE_DONE_OLDER,
  GITPULSE_IN_FLIGHT_NEWEST_OVERALL,
  GITPULSE_PENDING,
  GITPULSE_MERGED_NEWER,
  GITPULSE_FAILED,
];

// ---------------------------------------------------------------------------
// AT-1 — module/function exists (the missing-feature RED pin)
// ---------------------------------------------------------------------------
test('AT-1: deriveShowcaseCycleId is exported as a callable function', () => {
  // The real assertion the module must satisfy once it exists. Today this
  // line is never reached — the static import above fails module
  // resolution first (see the header's REAL RED PROOF note), which is the
  // legitimate missing-feature RED for every test in this file.
  expect(typeof deriveShowcaseCycleId).toBe('function');
});

// ---------------------------------------------------------------------------
// AT-2 — newest merged|done cycle for the TARGET project only
// ---------------------------------------------------------------------------
test('AT-2: deriveShowcaseCycleId returns the NEWEST merged|done cycleId for projectId — never a foreign-project cycle, never an in-flight one', () => {
  const result = deriveShowcaseCycleId(MIXED_TWO_PROJECT_ALL_STATUS_CYCLES, TARGET_PROJECT);

  // The newer of gitpulse's TWO merged|done cycles wins, not the older one.
  expect(result).toBe(GITPULSE_MERGED_NEWER.cycleId);

  // Never the foreign project's cycle, even though it is chronologically
  // newer than gitpulse's own winner.
  expect(result).not.toBe(BETTERADO_MERGED_NEWEST_FOREIGN.cycleId);

  // Never the in-flight cycle, even though it is the chronologically newest
  // cycle for the target project overall.
  expect(result).not.toBe(GITPULSE_IN_FLIGHT_NEWEST_OVERALL.cycleId);

  // Never a non-terminal status cycle at all (ready-for-review / failed /
  // pending), belt-and-braces on the same claim.
  expect(result).not.toBe(GITPULSE_READY_FOR_REVIEW.cycleId);
  expect(result).not.toBe(GITPULSE_FAILED.cycleId);
  expect(result).not.toBe(GITPULSE_PENDING.cycleId);
});

// ---------------------------------------------------------------------------
// AT-3 — honest null: no merged|done cycle, or no cycle at all
// ---------------------------------------------------------------------------
test('AT-3a: deriveShowcaseCycleId returns null for a project with cycles but none merged|done', () => {
  const noTerminalCycles: Cycle[] = [
    GITPULSE_IN_FLIGHT_NEWEST_OVERALL,
    GITPULSE_READY_FOR_REVIEW,
    GITPULSE_FAILED,
    GITPULSE_PENDING,
  ];
  expect(deriveShowcaseCycleId(noTerminalCycles, TARGET_PROJECT)).toBe(null);
});

test('AT-3b: deriveShowcaseCycleId returns null for a projectId absent from the cycle list entirely', () => {
  expect(
    deriveShowcaseCycleId(MIXED_TWO_PROJECT_ALL_STATUS_CYCLES, 'nonexistent-project'),
  ).toBe(null);
});

// ---------------------------------------------------------------------------
// AT-4 — deterministic sort via the endedAt ?? startedAt fallback chain
// (T1 ruling): a missing endedAt on the genuinely-newer cycle must not let
// an older cycle's SET endedAt outrank it.
// ---------------------------------------------------------------------------

/** Genuinely the NEWEST cycle (by `startedAt`) — but `endedAt` has not
 *  landed yet (merge confirmed, closure sweep not yet recorded it). If the
 *  deriver naively sorted on `endedAt` alone (no per-cycle fallback to
 *  `startedAt`), this cycle would look "undated" and lose to
 *  `OLDER_CYCLE_WITH_ENDED_AT` below. */
const NEWEST_CYCLE_MISSING_ENDED_AT: Cycle = {
  cycleId: '2026-08-01T00-00-00_INIT-showcase-newest',
  initiativeId: 'INIT-showcase-newest',
  project: TARGET_PROJECT,
  status: 'merged',
  startedAt: '2026-08-01T00:00:00Z',
  // endedAt deliberately absent.
};

/** Chronologically OLDER (by `startedAt`) than the cycle above, but its
 *  `endedAt` IS set — and that `endedAt` is still earlier than the newer
 *  cycle's `startedAt`, so there is no ambiguity about which is genuinely
 *  newer: `NEWEST_CYCLE_MISSING_ENDED_AT` must still win. */
const OLDER_CYCLE_WITH_ENDED_AT: Cycle = {
  cycleId: '2026-01-01T00-00-00_INIT-showcase-older',
  initiativeId: 'INIT-showcase-older',
  project: TARGET_PROJECT,
  status: 'done',
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-02-01T00:00:00Z',
};

test('AT-4: deriveShowcaseCycleId picks the genuinely-newest cycle via the endedAt ?? startedAt fallback, even when its endedAt is missing', () => {
  const result = deriveShowcaseCycleId(
    [OLDER_CYCLE_WITH_ENDED_AT, NEWEST_CYCLE_MISSING_ENDED_AT],
    TARGET_PROJECT,
  );
  expect(result).toBe(NEWEST_CYCLE_MISSING_ENDED_AT.cycleId);
  expect(result).not.toBe(OLDER_CYCLE_WITH_ENDED_AT.cycleId);
});
