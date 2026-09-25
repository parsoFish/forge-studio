/**
 * Bead forge-8vfn.8.1.5 — a re-entered cycle's `CostTracker` must be seeded
 * from EVERY phase's authoritative spend already on the cycle's own log, not
 * only the architect's.
 *
 * `runCycle` can be entered twice for one `cycle_id`: the PLAN gate splits a
 * develop-flow cycle into a first entry (synthetic architect +
 * project-manager, ending `cycle.end ready-for-review`) and a second that
 * resumes at developer-loop onward. Each entry's `runFlow` (flow-runner.ts)
 * builds a FRESH `CostTracker`, seeded ONLY through `priorSpendEvents` —
 * before this fix, that was `emitSyntheticArchitectEvents`'s return, which
 * replays only `phase === 'architect'` rows (cycle.ts). Project-manager's
 * spend from the first entry was therefore invisible to the ceiling the
 * second entry enforced.
 *
 * The fixture (`../fixtures/m7-a-breach-control-cycle-events.jsonl`, see its
 * README) is a trimmed, path-sanitized copy of a recorded M7 breach control
 * run's real event log, kept verbatim for every cost-bearing row and both
 * `cycle.start` entries — see that file for the dollar figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import type { EventLogEntry } from '@forge/kernel';
import { CostTracker } from '../../flow-budgets.ts';
import { emitSyntheticArchitectEvents, readPriorCycleCostEvents } from '../../cycle.ts';
import { serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import type { CycleInput } from '../../cycle-context.ts';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'm7-a-breach-control-cycle-events.jsonl');
const fixtureRows: EventLogEntry[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as EventLogEntry);

// The exact point at which the SECOND entry's `runFlow` would construct its
// CostTracker: right after this entry's own `cycle.start` (index 14) and
// before developer-loop's own `start` (index 15) — see the fixture README's
// row-by-row accounting.
const SEED_CUTOFF = 15;
const seedRows = fixtureRows.slice(0, SEED_CUTOFF);
const liveRows = fixtureRows.slice(SEED_CUTOFF);

const ARCHITECT_USD = 2.0368505999999997;
const PM_USD = 0.8104302000000001;
const DEV_USD = 1.3089468;
const BEFORE_WI1_USD = 2.8472808; // architect + project-manager
const REAL_TOTAL_USD = 4.1562276; // architect + project-manager + dev
const BUGGY_TOTAL_USD = 3.3457973999999995; // architect + dev, PM invisible

function stubLogger() {
  const emitted: unknown[] = [];
  return {
    emitted,
    cycleId: 'test',
    logFilePath: '/dev/null',
    emit(p: unknown) {
      emitted.push(p);
      return { ...(p as object), event_id: `e${emitted.length}` } as EventLogEntry;
    },
  };
}

test('a re-entered cycle seeds its tracker from every phase already on the log — before WI-1 it already includes project-manager', () => {
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: stubLogger() as never });
  for (const e of seedRows) t.noteEvent(e);
  assert.equal(
    Number(t.totalSpentUsd.toFixed(7)),
    Number(BEFORE_WI1_USD.toFixed(7)),
    'the seed alone (architect + project-manager, both from the FIRST entry) must be visible before WI-1 dispatches',
  );
});

test('the fixed seed reports the real $4.1562276 total, not the $3.3457974 the recorded run\'s ceiling stopped at', () => {
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: stubLogger() as never });
  for (const e of seedRows) t.noteEvent(e);
  for (const e of liveRows) t.noteEvent(e);
  assert.equal(Number(t.totalSpentUsd.toFixed(7)), Number(REAL_TOTAL_USD.toFixed(7)));
  assert.notEqual(Number(t.totalSpentUsd.toFixed(7)), Number(BUGGY_TOTAL_USD.toFixed(7)));
});

test('mutation: a seed restricted to architect-only reproduces the ORIGINAL bug\'s $3.3457974', () => {
  // Restates the pre-fix seeding rule by hand (architect rows only) to prove
  // the fixture actually distinguishes the two behaviours, not just that the
  // fixed function happens to return the right number.
  const architectOnlySeed = seedRows.filter((e) => e.phase === 'architect');
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: stubLogger() as never });
  for (const e of architectOnlySeed) t.noteEvent(e);
  for (const e of liveRows) t.noteEvent(e);
  assert.equal(Number(t.totalSpentUsd.toFixed(7)), Number(BUGGY_TOTAL_USD.toFixed(7)));
  assert.notEqual(Number(t.totalSpentUsd.toFixed(7)), Number(REAL_TOTAL_USD.toFixed(7)));
});

test('readPriorCycleCostEvents(logFilePath) reads exactly what a re-entered runFlow would seed with', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-reseed-'));
  const logsRoot = join(root, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  const logger = createLogger('CYCLE-X', logsRoot);
  for (const e of fixtureRows) {
    // Re-emit every row through a real logger so the on-disk file is built
    // exactly like production would (event_id/cycle_id get reassigned; that's
    // fine — nothing here depends on the ORIGINAL ids).
    logger.emit(e as unknown as Parameters<typeof logger.emit>[0]);
    if (e === fixtureRows[SEED_CUTOFF - 1]) break; // stop after entry 2's cycle.start
  }
  const seeded = readPriorCycleCostEvents(logger.logFilePath);
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: stubLogger() as never });
  for (const e of seeded) t.noteEvent(e);
  assert.equal(Number(t.totalSpentUsd.toFixed(7)), Number(BEFORE_WI1_USD.toFixed(7)));
});

test('a third re-entry still counts the architect exactly once (bead forge-8vfn.6.10.22 must still hold)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-reseed-triple-'));
  const manifestPath = join(root, 'manifest.md');
  const initiativeId = 'INIT-triple-reentry';
  const m: InitiativeManifest = {
    initiative_id: initiativeId,
    class: 'docs',
    acceptance_criteria: [],
    project: 'demo',
    project_repo_path: join(root, 'repo'),
    created_at: '2026-09-25T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 18,
    phase: 'pending',
    origin: 'architect',
    architect_cost_usd: ARCHITECT_USD,
    architect_duration_ms: 100,
    architect_session_id: 'sess-triple',
    body: '# body',
  };
  writeFileSync(manifestPath, serializeManifest(m));
  const logsRoot = join(root, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  const logger = createLogger('CYCLE-TRIPLE', logsRoot);
  const input = {
    initiativeId,
    manifestPath,
    worktreePath: join(root, 'repo'),
    projectRepoPath: join(root, 'repo'),
  } as CycleInput;

  // Entry 1: architect (fresh emit) + project-manager finishing before the gate.
  emitSyntheticArchitectEvents(input, logger, 'architect');
  logger.emit({
    initiative_id: initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'end',
    input_refs: [],
    output_refs: [],
    cost_usd: PM_USD,
    message: 'pm.end',
  });

  // Entry 2: re-entry — architect REPLAYS (writes nothing new) — dev-loop runs.
  emitSyntheticArchitectEvents(input, logger, 'architect');
  logger.emit({
    initiative_id: initiativeId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'iteration',
    input_refs: [],
    output_refs: [],
    cost_usd: DEV_USD,
    message: 'iteration',
    metadata: { work_item_id: 'WI-1' },
  });

  // Entry 3: a further re-entry (e.g. resumed after a crash) — architect
  // REPLAYS again.
  const thirdArchitectEvents = emitSyntheticArchitectEvents(input, logger, 'architect');
  assert.equal(thirdArchitectEvents.length, 2, 'the replay still hands back the architect pair');

  const seeded = readPriorCycleCostEvents(logger.logFilePath);
  const architectEndRows = seeded.filter((e) => e.phase === 'architect' && e.event_type === 'end');
  assert.equal(architectEndRows.length, 1, 'the architect must appear on the log exactly once no matter how many re-entries');

  const t = new CostTracker({ ceilingUsd: 100, initiativeId, logger: stubLogger() as never });
  for (const e of seeded) t.noteEvent(e);
  assert.equal(
    Number(t.totalSpentUsd.toFixed(7)),
    Number((ARCHITECT_USD + PM_USD + DEV_USD).toFixed(7)),
    'architect + project-manager + dev, each counted exactly once',
  );
});

test('the iteration latch survives the seed/live boundary: a phase latched by the SEED is not double counted by a live restated end', () => {
  const seedEvents: EventLogEntry[] = [
    {
      event_id: 's1',
      cycle_id: 'c',
      initiative_id: 'i',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'iteration',
      input_refs: [],
      output_refs: [],
      cost_usd: 2.5,
      started_at: '2026-01-01T00:00:00Z',
      metadata: { work_item_id: 'WI-1' },
    } as EventLogEntry,
  ];
  // A restated phase-rollup `end` arriving in a LATER entry with no
  // `iteration` event of its own in that entry's new rows — the latch must
  // come from the seed, not from anything fed after it.
  const liveEvents: EventLogEntry[] = [
    {
      event_id: 'l1',
      cycle_id: 'c',
      initiative_id: 'i',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'end',
      input_refs: [],
      output_refs: [],
      cost_usd: 2.5,
      started_at: '2026-01-01T00:01:00Z',
    } as EventLogEntry,
  ];
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: stubLogger() as never });
  for (const e of seedEvents) t.noteEvent(e);
  for (const e of liveEvents) t.noteEvent(e);
  assert.equal(t.totalSpentUsd, 2.5, 'the rollup end restates the iteration dollars already seeded — must not double them');
});
