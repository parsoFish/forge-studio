/**
 * The project-brain analyzing turn logs its spend — `forge-mfv5.1.16`
 * (folded into `forge-nk1y.5`).
 *
 * `runAgentTurn`'s `{ costUsd }` was discarded and no `onTurnEndedUnpriced` was
 * wired, so a project-brain session left NO `cost_usd` on its events:
 * `deriveSessionCostUsd` / `readSessionCostUsd` read it as unmeasured and
 * `bridgeSpentUsd` never counted its spend against the bridge ceiling. The
 * instructions kind already leaves `instructions.<step>.turn-cost` (or its
 * unpriced twin); this pins the same pair for `project-brain.analyzing`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from '../../kinds/project-brain.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const SESSION_ID = '2026-06-27T10-00-00';
const PRICED_COST_USD = 0.4321;
const CEILING_USD = 5;

type EventRow = Record<string, unknown> & { metadata?: Record<string, unknown> };

function setup(statusExtras: Record<string, unknown> = {}): { forgeRoot: string; projectRoot: string; sessionDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-cost-'));
  const projectRoot = join(forgeRoot, 'projects', 'demoproj');
  const sessionDir = projectBrainSessionDir(join(forgeRoot, '_logs'), 'demoproj', SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), '# demoproj\n');
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: SESSION_ID,
    project: 'demoproj',
    project_repo_path: projectRoot,
    phase: 'analyzing',
    prompt: 'focus on the build + test conventions',
    updated_at: new Date().toISOString(),
    ...statusExtras,
  } as ProjectBrainStatus);
  return { forgeRoot, projectRoot, sessionDir };
}

/** Stages one theme, then ends with a priced `result` — or, when `priced` is false, with none. */
function stubQueryFn(sessionDir: string, priced: boolean): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      const staging = join(sessionDir, 'themes');
      mkdirSync(staging, { recursive: true });
      writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
      if (priced) yield { type: 'result', total_cost_usd: PRICED_COST_USD };
    }
    return gen();
  };
}

function readEvents(forgeRoot: string): EventRow[] {
  return readFileSync(join(forgeRoot, '_logs', `_project-brain-${SESSION_ID}`, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as EventRow);
}

async function runAnalyzing(forgeRoot: string, projectRoot: string, queryFn: QueryFn): Promise<void> {
  await runProjectBrainTurn({
    sessionId: SESSION_ID, project: 'demoproj', projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs'), queryFn,
  });
}

test('analyzing turn leaves exactly one priced project-brain.analyzing.turn-cost row', async () => {
  const { forgeRoot, projectRoot, sessionDir } = setup();
  try {
    await runAnalyzing(forgeRoot, projectRoot, stubQueryFn(sessionDir, true));

    const rows = readEvents(forgeRoot).filter((e) => e['message'] === 'project-brain.analyzing.turn-cost');
    assert.equal(rows.length, 1, 'exactly one turn-cost row for the one analyzing turn');
    const row = rows[0]!;
    assert.equal(row['event_type'], 'end');
    assert.equal(row['cost_usd'], PRICED_COST_USD);
    assert.equal(row['phase'], 'project-brain');
    assert.equal(row['skill'], 'project-brain-builder');
    assert.equal(row.metadata?.['priced'], true);
    assert.equal(
      readEvents(forgeRoot).some((e) => e['message'] === 'project-brain.analyzing.turn-ended-unpriced'),
      false,
      'a priced turn never also leaves the unpriced twin',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('an analyzing turn that ends without a result leaves the unpriced row — no cost_usd, priced:false, upper_bound_usd', async () => {
  const { forgeRoot, projectRoot, sessionDir } = setup({ costCeilingUsd: CEILING_USD });
  try {
    await runAnalyzing(forgeRoot, projectRoot, stubQueryFn(sessionDir, false));

    const events = readEvents(forgeRoot);
    assert.equal(events.some((e) => e['message'] === 'project-brain.analyzing.turn-cost'), false, 'no priced row for an unpriced turn');
    const rows = events.filter((e) => e['message'] === 'project-brain.analyzing.turn-ended-unpriced');
    assert.equal(rows.length, 1, 'exactly one unpriced row for the one analyzing turn');
    const row = rows[0]!;
    assert.equal(row['event_type'], 'end');
    assert.equal(Object.hasOwn(row, 'cost_usd'), false, 'absent, never zeroed');
    assert.equal(row['phase'], 'project-brain');
    assert.equal(row['skill'], 'project-brain-builder');
    assert.equal(row.metadata?.['priced'], false);
    assert.equal(row.metadata?.['unpriced_reason'], 'no-result');
    assert.equal(row.metadata?.['upper_bound_usd'], CEILING_USD, 'the cap the turn ran under (nothing spent before it)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
