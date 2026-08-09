/**
 * Acceptance tests for R4-14 WI-3 (T1 ruling) — the GATED "open showcase"
 * entry affordance on `/projects/[id]`.
 *
 * `app/projects/[id]/page.tsx` is `'use client'` (useEffect/useState + a
 * client `fetchCycles()` call) and is not SSR-drivable via
 * `renderToStaticMarkup`, so this file pins the extracted PURE gating
 * predicate instead — the same "pin the extracted pure/testable piece"
 * precedent as `./roadmap-develop-start-ceiling.ts`
 * (`resolveDevelopStartCeilingToSend`) and `./kb-consolidate.ts`
 * (`deriveKbBandOptions`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./project-showcase.ts` (module does NOT exist yet —
 * neither the file nor either export is present in this worktree; confirmed
 * via `grep -rln deriveShowcaseCycleId forge-ui/` returning nothing before
 * this file was written):
 *
 *   export function deriveShowcaseCycleId(cycles: Cycle[], projectId: string): string | null;
 *     // OWNED BY THE DERIVER WRITER (a separate lane's WI-2) — this file only
 *     // consumes it to prove the companion-honesty property below. Its own
 *     // acceptance tests live in the SIBLING `./project-showcase.test.ts`,
 *     // deliberately NOT touched here (file-ownership coordination — see the
 *     // R4-14 WI-3 task brief).
 *
 *   export function showShowcaseEntry(cycles: Cycle[], projectId: string): boolean;
 *     // NEW — THIS file's own subject. T1 ruling: the project-page "open
 *     // showcase" affordance is gated on the project having at least one
 *     // `merged` or `done` cycle, i.e. `deriveShowcaseCycleId(...) !== null`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIXTURE GROUNDING: every `Cycle` field below is a REAL field from the
 * shipped shape (`forge-ui/lib/bridge-client.ts:15` —
 * cycleId/initiativeId/project/status/startedAt/endedAt); no invented
 * fields. `project` ids are REAL managed/reference projects from this
 * repo's own operating ground (`gitpulse` — the verify-cycle routine ground,
 * CLAUDE.md; `mdtoc` — the local reference project under `projects/mdtoc/`).
 * `cycleId` follows the shipped `<ISO-ish-timestamp>_<initiativeId>` format
 * (`./cycle-grouping.ts`'s documented convention).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT EACH TEST KILLS (immutable-gates: name the wrong impl):
 *   AT-WI3-1 kills (a) an unconditional/always-true affordance (never gates
 *     on cycle history at all); (b) a gate that also fires for in-flight/
 *     failed/pending/ready-for-review-only projects (any status OTHER than
 *     merged|done counted as "has a showcase"); (c) a gate that ignores
 *     `projectId` scoping entirely (e.g. `cycles.length > 0` regardless of
 *     which project owns them) — the absent-project case would then wrongly
 *     read TRUE.
 *   AT-WI3-2 (COMPANION) kills a gate that drifts from the deriver it must
 *     stay honest with — e.g. `showShowcaseEntry` hardcoding its own
 *     merged|done scan independently of `deriveShowcaseCycleId` (a
 *     maintenance fork that could silently diverge), which would offer the
 *     "open showcase" link for a project the showcase page itself would then
 *     render empty for (or vice versa: hide the link for a project that DOES
 *     have a showcase-worthy cycle).
 */
import { test, expect } from 'vitest';

import { showShowcaseEntry, deriveShowcaseCycleId } from '@/lib/project-showcase';
import type { Cycle } from '@/lib/bridge-client';

const PROJECT = 'gitpulse';
const OTHER_PROJECT = 'mdtoc';
const ABSENT_PROJECT = 'betterado';

const DONE_CYCLE: Cycle = {
  cycleId: '2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter',
  initiativeId: 'INIT-2026-07-11-exclude-path-filter',
  project: PROJECT,
  status: 'done',
  startedAt: '2026-07-11T07:29:19Z',
  endedAt: '2026-07-11T07:41:02Z',
};

const MERGED_CYCLE: Cycle = {
  cycleId: '2026-06-15T09-00-00_INIT-2026-06-15-probe',
  initiativeId: 'INIT-2026-06-15-probe',
  project: PROJECT,
  status: 'merged',
  startedAt: '2026-06-15T09:00:00Z',
};

const IN_FLIGHT_CYCLE: Cycle = {
  cycleId: '2026-08-01T00-00-00_INIT-2026-08-01-inflight',
  initiativeId: 'INIT-2026-08-01-inflight',
  project: PROJECT,
  status: 'in-flight',
  startedAt: '2026-08-01T00:00:00Z',
};

const FAILED_CYCLE: Cycle = {
  cycleId: '2026-07-20T00-00-00_INIT-2026-07-20-failed',
  initiativeId: 'INIT-2026-07-20-failed',
  project: PROJECT,
  status: 'failed',
  startedAt: '2026-07-20T00:00:00Z',
};

const OTHER_PROJECT_DONE_CYCLE: Cycle = {
  cycleId: '2026-05-01T00-00-00_INIT-2026-05-01-other',
  initiativeId: 'INIT-2026-05-01-other',
  project: OTHER_PROJECT,
  status: 'done',
  startedAt: '2026-05-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// AT-WI3-1 — the gate itself
// ---------------------------------------------------------------------------
test('AT-WI3-1: showShowcaseEntry is TRUE only for a project with a merged|done cycle', () => {
  // TRUE — the project has a 'done' cycle (alongside an unrelated in-flight one).
  expect(showShowcaseEntry([DONE_CYCLE, IN_FLIGHT_CYCLE], PROJECT)).toBe(true);

  // TRUE — the project has a 'merged' cycle (the transient pass-through
  // state — Cycle.status's own note: merged and done both imply the merge
  // happened).
  expect(showShowcaseEntry([MERGED_CYCLE], PROJECT)).toBe(true);

  // FALSE — the project has cycles, but none merged|done (in-flight + failed
  // only). Must not be conflated with "has a showcase".
  expect(showShowcaseEntry([IN_FLIGHT_CYCLE, FAILED_CYCLE], PROJECT)).toBe(false);

  // FALSE — absent project: no cycle in the list references this projectId
  // at all (the other project's own done cycle must not leak across the
  // project scope).
  expect(showShowcaseEntry([DONE_CYCLE, OTHER_PROJECT_DONE_CYCLE], ABSENT_PROJECT)).toBe(false);
});

// ---------------------------------------------------------------------------
// AT-WI3-2 (COMPANION) — honesty with the deriver
// ---------------------------------------------------------------------------
const FIXTURE_SET: Array<{ label: string; cycles: Cycle[]; projectId: string }> = [
  { label: 'done cycle present', cycles: [DONE_CYCLE, IN_FLIGHT_CYCLE], projectId: PROJECT },
  { label: 'merged cycle present', cycles: [MERGED_CYCLE], projectId: PROJECT },
  { label: 'only in-flight/failed', cycles: [IN_FLIGHT_CYCLE, FAILED_CYCLE], projectId: PROJECT },
  { label: 'absent project', cycles: [DONE_CYCLE, OTHER_PROJECT_DONE_CYCLE], projectId: ABSENT_PROJECT },
  { label: 'no cycles at all', cycles: [], projectId: PROJECT },
  { label: 'only another project has a done cycle', cycles: [OTHER_PROJECT_DONE_CYCLE], projectId: PROJECT },
  { label: 'mixed statuses, merged present', cycles: [IN_FLIGHT_CYCLE, MERGED_CYCLE, FAILED_CYCLE], projectId: PROJECT },
];

test('AT-WI3-2 COMPANION: showShowcaseEntry(cycles, projectId) === true IFF deriveShowcaseCycleId(cycles, projectId) !== null — the link is never offered for a project the showcase page would show empty', () => {
  // Precondition on the fixture set itself: it must actually exercise BOTH
  // branches (some TRUE cases, some FALSE cases) or the agreement check
  // below would pass vacuously.
  const gatedResults = FIXTURE_SET.map(({ cycles, projectId }) => showShowcaseEntry(cycles, projectId));
  expect(gatedResults).toContain(true);
  expect(gatedResults).toContain(false);

  for (const { label, cycles, projectId } of FIXTURE_SET) {
    const gated = showShowcaseEntry(cycles, projectId);
    const derivedCycleId = deriveShowcaseCycleId(cycles, projectId);
    expect(gated, `[${label}] showShowcaseEntry (${gated}) disagrees with deriveShowcaseCycleId !== null (${derivedCycleId !== null})`).toBe(derivedCycleId !== null);
  }
});
