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
  const sessionDir = join(projectRoot, '_architect', 'sess-1');
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
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
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
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      new RegExp(MARKER),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-17 (positive control) NO ceiling declared — spend never trips the guard', async () => {
  const { projectRoot, logsRoot, root } = plantSession({}, 999);
  try {
    await assert.rejects(
      runArchitectTurn({ manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, logsRoot, brainCwd: root, queryFn: markerQueryFn as never }),
      new RegExp(MARKER),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
