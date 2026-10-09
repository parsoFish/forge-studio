/**
 * W7-B6 WI-3 — architect session cost-ceiling enforcement (projects-14).
 *
 * The ceiling is DECLARED at kickoff (status.costCeilingUsd, validated by the
 * bridge) — declaring it without enforcement would be the exact
 * declared-data-fails-open shape this campaign keeps closing. These pins
 * prove the runner half: a turn that would START at/past the ceiling refuses
 * (with the reason in the throw + an `error` event), and the guard never
 * fires without a ceiling or under it (positive control via a marker
 * queryFn: reaching the marker proves the guard let the turn proceed).
 */

import { test } from 'node:test';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';

const MARKER = 'MARKER: past the ceiling guard';

function plantSession(over: Partial<ArchitectStatus>, spentUsd: number | null): { projectRoot: string; logsRoot: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-ceiling-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(root, '_logs', '_sessions', 'p1', '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1',
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round: 1,
    idea: 'test the ceiling',
    updated_at: new Date().toISOString(),
    ...over,
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  const logsRoot = join(root, '_logs');
  const logDir = join(logsRoot, '_architect-sess-1');
  mkdirSync(logDir, { recursive: true });
  if (spentUsd !== null) {
    // The session's own event log — the ONE source the runner derives spend
    // from (never a stored copy).
    writeFileSync(
      join(logDir, 'events.jsonl'),
      `${JSON.stringify({ event_id: 'e1', started_at: new Date().toISOString(), cost_usd: spentUsd, event_type: 'end' })}\n`,
      'utf8',
    );
  }
  return { projectRoot, logsRoot, root };
}

function markerQueryFn(): never {
  throw new Error(MARKER);
}

test('AT-B6-15 (RED) a turn at/past the ceiling REFUSES with the reason — the marker queryFn is never reached', async () => {
  const { projectRoot, logsRoot, root } = plantSession({ costCeilingUsd: 0.05 }, 0.11);
  try {
    await assert.rejects(
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1', logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      (err: Error) => {
        assert.match(err.message, /cost ceiling reached/i, `expected the ceiling refusal — got: ${err.message}`);
        assert.doesNotMatch(err.message, new RegExp(MARKER), 'the turn must never start (queryFn unreached)');
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-16 (positive control) under the ceiling the guard stands aside — the turn proceeds to the marker', async () => {
  const { projectRoot, logsRoot, root } = plantSession({ costCeilingUsd: 5 }, 0.02);
  try {
    await assert.rejects(
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1', logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      new RegExp(MARKER),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Re-pinned by T1's ruling on the row-2 park (forge-nk1y.5): with no ceiling
// declared the architect's own $10 budget binds, so the positive control is now
// "priced calls that stay under the ceiling never trip it".
test('AT-B6-17 (positive control) priced spend under the ceiling never trips the guard', async () => {
  const { projectRoot, logsRoot, root } = plantSession({}, 5);
  try {
    await assert.rejects(
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1', logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      new RegExp(MARKER),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// T1 ruling on the row-2 park (forge-nk1y.5), condition 2: a crashed call is
// charged its cap — the REMAINING cap, never more. $6 priced of the
// architect's $10 budget, then a crash: the unpriced row is bounded at exactly
// $4 and the session's priced + bounded spend lands ON the ceiling, not past it.
test('a crashed call never charges more than the remaining cap (no overspend)', async () => {
  const { projectRoot, logsRoot, root } = plantSession({}, 6);
  try {
    await assert.rejects(
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1', logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      new RegExp(MARKER),
    );
    const { readFileSync } = await import('node:fs');
    const { sessionSpentUsd } = await import('../../turn-budget.ts');
    const rows = readFileSync(join(logsRoot, '_architect-sess-1', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { metadata?: Record<string, unknown> });
    const bounds = rows.filter((r) => r.metadata?.['priced'] === false).map((r) => r.metadata?.['upper_bound_usd']);
    assert.deepEqual(bounds, [4], 'the crashed call is charged the $4 that remained, not the $10 budget');
    assert.equal(sessionSpentUsd(logsRoot, '_architect-sess-1'), 10, 'priced + bounded spend lands on the ceiling, never past it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
