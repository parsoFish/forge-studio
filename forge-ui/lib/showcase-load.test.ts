/**
 * Acceptance tests for the SHOWCASE data path (R4-14 WI-2) — two pure pieces
 * behind the not-SSR-drivable `forge-ui/app/projects/[id]/showcase/page.tsx`
 * (NEW, client fetch + useState, same reason `page.tsx` itself is never
 * directly pinned — see `roadmap-develop-start-ceiling.test.ts` / the sibling
 * `project-showcase.test.ts` header for the established precedent):
 *
 *   (a) `deriveShowcaseStats(model: DemoModel)` in `./project-showcase.ts` —
 *       the stats-strip deriver. T1 ruling: NO new run-model fetch — it
 *       reduces the ALREADY-FETCHED `DemoModel` (the same one
 *       `DemoComparison` renders) to a small stats-strip summary.
 *   (b) `loadShowcase({ cycles, projectId, fetchDemo })` in
 *       `./showcase-load.ts` — the load orchestration extracted from the
 *       page's own load effect (per this WI's brief: "extract a pure
 *       loadShowcase helper if the page's load logic is otherwise
 *       untestable"), proving the render path calls
 *       `deriveShowcaseCycleId` (the REAL function, `./project-showcase.ts`
 *       — owned by the sibling WI-1 pin in `./project-showcase.test.ts`,
 *       confirmed landed there ahead of this file) then `fetchDemoModel`
 *       with EXACTLY the derived cycleId — the declared-data-fails-open
 *       guard this WI calls out by name: a wrong/duplicate/never call here
 *       would silently N+1 the bridge or show the wrong cycle's demo.
 *
 * COORDINATION NOTE: `./project-showcase.test.ts` already exists (the
 * sibling WI-1 pin for `deriveShowcaseCycleId`) — per this WI's brief, its
 * deriver-only tests are NOT touched here; both of THIS file's concerns
 * (the stats deriver AND the load orchestration) live in THIS file instead,
 * even though `deriveShowcaseStats` production-wise belongs alongside
 * `deriveShowcaseCycleId` in `./project-showcase.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS (none exist yet — my own design decision, since nothing
 * else constrains the shape; documented so the implementer and I agree):
 *
 *   // ./project-showcase.ts (ADDED to the sibling WI-1 file)
 *   export type ShowcaseAcVerdictCounts = { met: number; partial: number; missed: number };
 *   export type ShowcaseStats = {
 *     testEvidenceCount: number;
 *     prUrl: string | null;
 *     branch: string | null;
 *     commitSha: string | null;
 *     acVerdictCounts: ShowcaseAcVerdictCounts;
 *   };
 *   export function deriveShowcaseStats(model: DemoModel): ShowcaseStats;
 *
 *   // ./showcase-load.ts (NEW file)
 *   export type ShowcaseLoadResult =
 *     | { kind: 'empty' }
 *     | { kind: 'loaded'; cycleId: string; model: DemoModel | null };
 *   export function loadShowcase(args: {
 *     cycles: Cycle[];
 *     projectId: string;
 *     fetchDemo: (cycleId: string) => Promise<DemoModel | null>;
 *   }): Promise<ShowcaseLoadResult>;
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REAL RED PROOF (applies to every test below, house precedent —
 * `./agent-ledger.test.ts` / `./project-showcase.test.ts`'s own headers):
 * neither `forge-ui/lib/project-showcase.ts` (deriveShowcaseStats — the
 * sibling file currently only has its own test, no production module) nor
 * `forge-ui/lib/showcase-load.ts` exists at all. The static
 * `import { deriveShowcaseStats } from '@/lib/project-showcase'` and
 * `import { loadShowcase } from '@/lib/showcase-load'` below fail vitest's
 * own module-resolution step BEFORE any `test()` body runs — that
 * whole-file resolution failure is the legitimate missing-feature RED for
 * every test in this file (confirmed by running the file — see the RED
 * proof captured in the handoff notes for the exact failure text/command).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIXTURES — real `DemoModel`/`Cycle` shapes only (`./bridge-client.ts`:
 * `DemoModel` ~:497 / `Cycle` :15), never an invented field. Checkpoint
 * kinds are restricted to the three real literals `'screenshot' | 'video' |
 * 'harness'` (`DemoModelCheckpoint.kind`, `./bridge-client.ts` ~:459) — F4
 * retired the parallel `DEMO.html` renderer for this surface, so the stats
 * strip must never invent an `'html-summary'` kind/field (test 3, HONESTY).
 */
import { test, expect, vi } from 'vitest';

import { deriveShowcaseCycleId, deriveShowcaseStats } from '@/lib/project-showcase';
import { loadShowcase } from '@/lib/showcase-load';
import type { Cycle, DemoModel } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// Test 1 — NON-EMPTY-ROW (rule 38): deriveShowcaseStats on a real,
// non-empty DemoModel must reflect the REAL fields, never fabricate.
// ---------------------------------------------------------------------------

/** A real, non-empty DemoModel: >=1 real checkpoint, testEvidence, and a
 *  summary carrying prUrl/branch/commitSha — the exact shape the unifier's
 *  demo.json produces (cli/demo-model.ts) and DemoComparison already
 *  renders natively. Four acEvaluations (2 met / 1 partial / 1 missed) so
 *  the verdict-count assertion below is not a degenerate all-one-value case. */
const NON_EMPTY_MODEL: DemoModel = {
  title: 'Showcase stats strip',
  essence: 'Proves the stats strip reflects real demo.json fields.',
  project: 'gitpulse',
  initiativeId: 'INIT-showcase-stats',
  baseRef: 'main',
  changedRef: 'feat/showcase-stats',
  diffStat: ' 3 files changed, 40 insertions(+), 2 deletions(-)',
  checkpoints: [
    { label: 'ui-before-after', kind: 'screenshot', caption: 'Showcase page before/after' },
  ],
  testEvidence: [
    { name: 'unit', result: 'pass' },
    { name: 'acceptance', result: 'pass', delta: 'new' },
  ],
  summary: {
    bullets: ['Ships the showcase stats strip'],
    prUrl: 'https://github.com/parsoFish/gitpulse/pull/9',
    branch: 'feat/showcase-stats',
    commitSha: 'abc1234def5678',
  },
  acEvaluations: [
    { criterion: 'stats reflect real testEvidence count', verdict: 'met', evidence: 'testEvidence.length === 2' },
    { criterion: 'prUrl surfaces on the stats strip', verdict: 'met', evidence: 'summary.prUrl present' },
    { criterion: 'partial coverage example', verdict: 'partial', evidence: 'partially covered' },
    { criterion: 'missed coverage example', verdict: 'missed', evidence: 'not covered' },
  ],
};

test('AT-1 (rule 38, NON-EMPTY-ROW): deriveShowcaseStats(model) on a real, non-empty DemoModel returns real, non-empty stats — testEvidence count, summary.prUrl/branch/commitSha presence, and REAL acEvaluations verdict counts, never fabricated', () => {
  const stats = deriveShowcaseStats(NON_EMPTY_MODEL);

  // testEvidence row count — the REAL array length, not a hardcoded/derived
  // "has evidence" boolean that would hide a wrong count.
  expect(stats.testEvidenceCount).toBe(2);

  // summary.prUrl/branch/commitSha presence — verbatim pass-through, never
  // re-derived or truncated at this layer (DemoComparison already owns any
  // display truncation of commitSha).
  expect(stats.prUrl).toBe('https://github.com/parsoFish/gitpulse/pull/9');
  expect(stats.branch).toBe('feat/showcase-stats');
  expect(stats.commitSha).toBe('abc1234def5678');

  // acEvaluations verdict counts — REAL counts off the 4-entry fixture
  // (2 met / 1 partial / 1 missed), not a fabricated "all met" summary.
  expect(stats.acVerdictCounts).toEqual({ met: 2, partial: 1, missed: 1 });
});

// ---------------------------------------------------------------------------
// Test 2 — HONESTY: deriveShowcaseStats must generalize from the three REAL
// checkpoint kinds and never emit an invented 'html-summary' kind/field
// (F4 retired the parallel DEMO.html renderer for this surface).
// ---------------------------------------------------------------------------

/** Only real checkpoint kinds present — one of each of the three literals
 *  `DemoModelCheckpoint.kind` actually supports. No summary/testEvidence at
 *  all, so nothing here could accidentally supply an 'html-summary' string
 *  via an unrelated field either. */
const REAL_KINDS_ONLY_MODEL: DemoModel = {
  title: 'Real checkpoint kinds only',
  essence: 'Every checkpoint kind is one of the three real literals.',
  project: 'gitpulse',
  diffStat: ' 1 file changed, 5 insertions(+)',
  checkpoints: [
    { label: 'screens', kind: 'screenshot', caption: 'A screenshot checkpoint' },
    { label: 'clip', kind: 'video', caption: 'A video checkpoint' },
    { label: 'metrics', kind: 'harness', caption: 'A harness checkpoint', metrics: [] },
  ],
};

test('AT-2 (HONESTY): deriveShowcaseStats on a DemoModel with ONLY real checkpoint kinds (screenshot/video/harness) never emits an invented "html-summary" kind/field anywhere in its output (F4 retired DEMO.html for this surface)', () => {
  const stats = deriveShowcaseStats(REAL_KINDS_ONLY_MODEL);

  // Serialise the WHOLE result so this pin holds regardless of exactly
  // which field the implementer chooses to carry a kind breakdown on — a
  // stray 'html-summary' literal ANYWHERE in the returned object is what
  // this test kills (e.g. a copy-pasted KIND_LABELS map that still lists
  // the retired DEMO.html category out of habit).
  expect(JSON.stringify(stats)).not.toContain('html-summary');

  // The real-kinds model carries NO testEvidence block at all — W7-B6
  // (projects-22) amendment: an ABSENT block is `null` ("not captured"),
  // distinct from a present-but-empty block's real `0`; the old `0` here
  // was the exact absent-vs-zero conflation that rendered "TESTS 0" beside
  // 23 met ACs on gitpulse's showcase.
  expect(stats.testEvidenceCount).toBeNull();
  expect(stats.prUrl).toBeNull();
  expect(stats.branch).toBeNull();
  expect(stats.commitSha).toBeNull();
  expect(stats.acVerdictCounts).toEqual({ met: 0, partial: 0, missed: 0 });
});

// ---------------------------------------------------------------------------
// Test 3 — CALLER-COUNT (declared-data-fails-open guard), found path:
// loadShowcase calls the REAL deriveShowcaseCycleId, then calls the
// INJECTED fetchDemo EXACTLY once with EXACTLY that derived cycleId.
// ---------------------------------------------------------------------------

const SHOWCASE_PROJECT = 'gitpulse';

/** A single real, terminal (done) cycle for the target project — the
 *  minimal fixture `deriveShowcaseCycleId` (sibling WI-1, already pinned in
 *  `./project-showcase.test.ts`'s AT-2/AT-3) resolves to a non-null
 *  cycleId for, regardless of the exact tie-break/recency rule, since there
 *  is only ONE candidate cycle for this project. */
const SOLE_TERMINAL_CYCLE: Cycle = {
  cycleId: '2026-07-01T00-00-00_INIT-showcase-load',
  initiativeId: 'INIT-showcase-load',
  project: SHOWCASE_PROJECT,
  status: 'done',
  startedAt: '2026-07-01T00:00:00Z',
  endedAt: '2026-07-01T02:00:00Z',
};

const FETCHED_MODEL: DemoModel = {
  title: 'Fetched via loadShowcase',
  essence: 'Proves the caller-count contract.',
  project: SHOWCASE_PROJECT,
  diffStat: ' 1 file changed, 1 insertion(+)',
  checkpoints: [{ label: 'c', kind: 'screenshot', caption: 'c' }],
};

test('AT-3 (CALLER-COUNT, found path): loadShowcase calls the REAL deriveShowcaseCycleId(cycles, projectId), then calls the injected fetchDemo EXACTLY ONCE with EXACTLY that derived cycleId — never a hardcoded/wrong id, never a double-fetch', async () => {
  // Precondition (assert BEFORE the verdict, per house rule): the REAL
  // deriver actually resolves a non-null cycleId for this fixture — if this
  // fails, the test below is not exercising the found path at all.
  const expectedCycleId = deriveShowcaseCycleId([SOLE_TERMINAL_CYCLE], SHOWCASE_PROJECT);
  expect(expectedCycleId, 'fixture precondition: deriveShowcaseCycleId must resolve a real cycleId for the sole terminal cycle').not.toBeNull();

  const fetchDemo = vi.fn(async (_cycleId: string) => FETCHED_MODEL);

  const result = await loadShowcase({
    cycles: [SOLE_TERMINAL_CYCLE],
    projectId: SHOWCASE_PROJECT,
    fetchDemo,
  });

  // EXACTLY ONE call — kills an N+1 fetch (e.g. re-deriving/re-fetching per
  // render section) and a zero-caller no-op alike.
  expect(fetchDemo).toHaveBeenCalledTimes(1);
  // EXACTLY the derived cycleId — kills a hand-rolled/hardcoded id, and
  // kills passing the wrong positional arg (e.g. projectId instead).
  expect(fetchDemo).toHaveBeenCalledWith(expectedCycleId);

  expect(result).toEqual({ kind: 'loaded', cycleId: expectedCycleId, model: FETCHED_MODEL });
});

// ---------------------------------------------------------------------------
// Test 4 — CALLER-COUNT (declared-data-fails-open guard), null path:
// when deriveShowcaseCycleId returns null, fetchDemo is NEVER called and
// the result signals empty — never a silent/blank "loaded" state.
// ---------------------------------------------------------------------------

test('AT-4 (CALLER-COUNT, null path): when deriveShowcaseCycleId returns null (no eligible cycle), loadShowcase NEVER calls fetchDemo and the result signals empty — never a fabricated/blank "loaded" state', async () => {
  // Precondition (assert BEFORE the verdict): the REAL deriver actually
  // returns null for a project with no cycles at all — an empty array is
  // the least ambiguous "no eligible cycle" fixture, independent of
  // whatever status-filtering/recency rule the sibling WI-1 pin governs.
  const derivedForEmpty = deriveShowcaseCycleId([], SHOWCASE_PROJECT);
  expect(derivedForEmpty, 'fixture precondition: deriveShowcaseCycleId must return null for a project with no cycles').toBeNull();

  const fetchDemo = vi.fn(async (_cycleId: string) => FETCHED_MODEL);

  const result = await loadShowcase({
    cycles: [],
    projectId: SHOWCASE_PROJECT,
    fetchDemo,
  });

  // NEVER called — kills an impl that fetches with a fallback/undefined id
  // instead of honouring the null signal.
  expect(fetchDemo).not.toHaveBeenCalled();
  expect(result).toEqual({ kind: 'empty' });
});
