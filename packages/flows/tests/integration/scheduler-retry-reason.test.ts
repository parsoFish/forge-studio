/**
 * decideAutoRetry: parse failures must not read as I/O failures
 * (forge-8vfn.6.10.16). Split out of scheduler.test.ts (check-file-size:
 * that file is already at the 800-line cap) rather than growing it further.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decideAutoRetry } from '../../scheduler.ts';
import { getPaths } from '../../queue.ts';

function setupQueue(): { dir: string; paths: ReturnType<typeof getPaths> } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-sched-retry-'));
  const paths = getPaths(join(dir, '_queue'));
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
    mkdirSync(p, { recursive: true });
  }
  return { dir, paths };
}

function writeFailureLog(logDir: string, mode: string, recoverable: boolean): string {
  const logPath = join(logDir, 'events.jsonl');
  const entry = {
    event_id: 'EV_test_fc',
    cycle_id: 'cycle-test',
    initiative_id: 'INIT-2026-05-10-x',
    started_at: new Date().toISOString(),
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'failure_classification',
    metadata: {
      cycle_id: 'cycle-test',
      failure_mode: mode,
      recoverable,
    },
  };
  writeFileSync(logPath, JSON.stringify(entry) + '\n');
  return logPath;
}

test('decideAutoRetry: in-flight manifest missing `class` (ADR 051) → reason names the parse failure, not a read failure', () => {
  const { dir, paths } = setupQueue();
  try {
    // No `class:` line — parseFullManifest throws "manifest missing required
    // field: class" (manifest.ts stringField). Before the fix this collapsed
    // into the same 'manifest read failed' reason as an actual I/O error.
    writeFileSync(
      join(paths.inFlight, 'INIT-2026-05-10-r7.md'),
      `---
initiative_id: INIT-2026-05-10-r7
project: trafficGame
project_repo_path: projects/trafficGame
created_at: 2026-05-10T18:00:00Z
iteration_budget: 1
cost_budget_usd: 1.0
phase: in-flight
---

# INIT-2026-05-10-r7
`,
    );
    const logDir = mkdtempSync(join(tmpdir(), 'forge-log-'));
    const logPath = writeFailureLog(logDir, 'transient', true);
    try {
      const decision = decideAutoRetry('INIT-2026-05-10-r7.md', paths, logPath);
      assert.equal(decision.retry, false);
      if (!decision.retry) {
        assert.match(decision.reason, /manifest parse failed/);
        assert.match(decision.reason, /class/);
      }
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
