/**
 * Bead forge-8vfn.6.10.22, half 1 — `emitSyntheticArchitectEvents` is
 * idempotent per cycle.
 *
 * `runCycle` can be entered twice for one `cycle_id` (the scheduler's claim,
 * then a second serve pass). Each entry emitted a fresh synthetic
 * `architect.start` + `architect.end`, and the `end` carries the architect's
 * WHOLE out-of-cycle spend — so the cycle log restated it, with a distinct
 * `event_id`, every time. Measured on G2 (2026-09-05): two `architect.end`
 * rows, one session, $2.3326944 each, inflating the run's logged cost from
 * $23.9721 to $26.3048.
 *
 * The second test here is the one that matters most, and it is the trap the
 * obvious fix walks into: the return value is not decoration. `runCycle` hands
 * it to `runFlow` as `priorSpendEvents`, which is the ONLY way the architect's
 * dollars reach the CostTracker (spec §5 item 7, ruling 257). An idempotent
 * emitter that returned `[]` on the second entry would stop the double-count
 * and simultaneously make the run's ceiling blind to the architect — trading a
 * reporting defect for a spend-safety one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import { emitSyntheticArchitectEvents } from '../../cycle.ts';
import { serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import { CostTracker } from '../../flow-budgets.ts';
import type { CycleInput } from '../../cycle-context.ts';

const ARCHITECT_COST_USD = 2.3326944;
const SESSION_ID = '2026-09-05T13-24-51-bf610d7f';
const CYCLE_ID = '2026-09-05T13-37-42_INIT-2026-09-05-init-gap-registry-consolidation';
const INITIATIVE_ID = 'INIT-2026-09-05-init-gap-registry-consolidation';

function seed(): { input: CycleInput; logsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-synth-architect-'));
  const manifestPath = join(root, 'manifest.md');
  const m: InitiativeManifest = {
    initiative_id: INITIATIVE_ID,
    class: 'docs',
    acceptance_criteria: [],
    project: 'demo',
    project_repo_path: join(root, 'repo'),
    created_at: '2026-09-05T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 18,
    phase: 'pending',
    origin: 'architect',
    architect_cost_usd: ARCHITECT_COST_USD,
    architect_duration_ms: 771002,
    architect_session_id: SESSION_ID,
    body: '# body',
  };
  writeFileSync(manifestPath, serializeManifest(m));
  const logsRoot = join(root, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  return {
    input: { initiativeId: INITIATIVE_ID, manifestPath, worktreePath: join(root, 'repo'), projectRepoPath: join(root, 'repo') } as CycleInput,
    logsRoot,
  };
}

function architectEndRows(logFilePath: string) {
  return readFileSync(logFilePath, 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { phase: string; event_type: string; cost_usd?: number; event_id: string })
    .filter((e) => e.phase === 'architect' && e.event_type === 'end');
}

test('kills "every runCycle entry restates the architect": a second emission for the same cycle writes NOTHING new', () => {
  const { input, logsRoot } = seed();
  const logger = createLogger(CYCLE_ID, logsRoot);

  emitSyntheticArchitectEvents(input, logger, 'architect');
  const afterFirst = architectEndRows(logger.logFilePath);
  assert.equal(afterFirst.length, 1, 'precondition: the first emission writes the pair');

  emitSyntheticArchitectEvents(input, logger, 'architect');
  const afterSecond = architectEndRows(logger.logFilePath);
  assert.equal(afterSecond.length, 1, 'the second entry must not restate the architect — this is the whole defect');
  assert.equal(afterSecond[0]?.event_id, afterFirst[0]?.event_id, 'and it must be the SAME row, not a rewritten one');
});

test('kills "return [] on the second call": the second emission still HANDS BACK the architect\'s spend, or the ceiling goes blind', () => {
  const { input, logsRoot } = seed();
  const logger = createLogger(CYCLE_ID, logsRoot);
  emitSyntheticArchitectEvents(input, logger, 'architect');

  const second = emitSyntheticArchitectEvents(input, logger, 'architect');
  assert.ok(second.length > 0, 'runFlow seeds its CostTracker from this return value — an empty one loses the architect');
  const end = second.find((e) => e.event_type === 'end');
  assert.equal(end?.cost_usd, ARCHITECT_COST_USD, 'and the dollars handed back are the architect\'s real ones');

  // Proved through the real consumer, not by inspecting the array: a tracker
  // seeded from the second call must know the architect's spend exactly once.
  const emitted: unknown[] = [];
  const tracker = new CostTracker({
    ceilingUsd: 27,
    ceilingSource: 'derived',
    initiativeId: INITIATIVE_ID,
    logger: { cycleId: 'x', emit: (p: unknown) => { emitted.push(p); return p; } } as never,
  });
  for (const e of second) tracker.noteEvent(e);
  assert.equal(Number(tracker.totalSpentUsd.toFixed(7)), Number(ARCHITECT_COST_USD.toFixed(7)));
});

test('kills "idempotent means never emit again": a DIFFERENT cycle\'s log still gets its own pair', () => {
  const { input, logsRoot } = seed();
  const first = createLogger(CYCLE_ID, logsRoot);
  emitSyntheticArchitectEvents(input, first, 'architect');

  const other = createLogger(`${CYCLE_ID}-rerun`, logsRoot);
  emitSyntheticArchitectEvents(input, other, 'architect');
  assert.equal(architectEndRows(other.logFilePath).length, 1, 'the guard is per cycle log, not a global latch');
});
