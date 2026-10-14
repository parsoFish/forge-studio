/**
 * forge-mfv5.1.37 row 2 — `aggregateRun` serves `runBase`: the commit the
 * entry rebase (a Kickoff Start onto a preserved branch, or a resume) put the
 * branch onto, i.e. the base the dev loop started on. A run with no entry
 * rebase omits the key — never a guessed sha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun } from '../../run-model.ts';

const INIT = 'INIT-2026-10-14-run-base';
const CYCLE = `2026-10-14T00-00-00_${INIT}`;

function ev(phase: string, event_type: string, message?: string, metadata?: Record<string, unknown>): object {
  return {
    event_id: `EV_${Math.random().toString(36).slice(2)}`, cycle_id: CYCLE, initiative_id: INIT, phase, skill: phase,
    event_type, input_refs: [], output_refs: [], started_at: new Date().toISOString(),
    ...(message !== undefined ? { message } : {}), ...(metadata !== undefined ? { metadata } : {}),
  };
}

function ground(lines: object[]): { root: string; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'run-model-run-base-'));
  const queueDir = join(root, '_queue', 'in-flight');
  mkdirSync(queueDir, { recursive: true });
  const manifestPath = join(queueDir, `${INIT}.md`);
  writeFileSync(manifestPath, `---\ninitiative_id: '${INIT}'\nproject: 'p'\nproject_repo_path: '/tmp/p'\ncreated_at: '2026-10-14T00:00:00Z'\niteration_budget: 10\ncost_budget_usd: 5\nclass: 'code'\nphase: 'in-flight'\norigin: 'architect'\ncycle_id: '${CYCLE}'\n---\n\nbody\n`);
  const logDir = join(root, '_logs', CYCLE);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { root, manifestPath };
}

test('aggregateRun: a Start that rebased at entry serves runBase = the onto sha', () => {
  const g = ground([
    ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }),
    ev('orchestrator', 'log', 'cycle.resume-rebased', { entry: 'start', onto_sha: '93fbaec2aaaa', from_sha: 'e516ce8b', to_sha: 'cccc' }),
    ev('developer-loop', 'start'),
  ]);
  try {
    assert.equal(aggregateRun({ root: g.root, queueState: 'in-flight', manifestPath: g.manifestPath, nowMs: Date.now() }).runBase, '93fbaec2aaaa');
  } finally {
    rmSync(g.root, { recursive: true, force: true });
  }
});

test('aggregateRun: a run with no entry rebase omits runBase', () => {
  const g = ground([ev('orchestrator', 'start', 'cycle.start', { origin: 'architect' }), ev('developer-loop', 'start')]);
  try {
    assert.equal('runBase' in aggregateRun({ root: g.root, queueState: 'in-flight', manifestPath: g.manifestPath, nowMs: Date.now() }), false);
  } finally {
    rmSync(g.root, { recursive: true, force: true });
  }
});
