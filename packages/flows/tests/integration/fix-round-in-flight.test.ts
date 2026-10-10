/**
 * Bead forge-nk1y.23 — after the D-20 drain re-enters a fix round the manifest
 * sits in `_queue/in-flight/` (still `resume_from: develop`, `review_rounds: 1`,
 * a pending compiled fix WI). The ONE fact reader and the run model must say
 * "fix round 1, running" and "develop is running" there — and stay quiet on
 * every shape that is not that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun } from '../../run-model.ts';
import { manifestDevelopRunning, manifestFixRound } from '../../kickoff-facts.ts';
import { parseManifest } from '../../manifest.ts';
import { plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

const NOW = Date.parse('2026-10-10T06:00:00.000Z');

function withFix(queueDir: 'ready-for-review' | 'in-flight', fn: (root: string, manifestPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-fix-round-in-flight-'));
  try { fn(root, plantStrandedFixRound(root, { queueDir }).manifestPath); } finally { rmSync(root, { recursive: true, force: true }); }
}

const source = (root: string, manifestPath: string, queueDir: string) => ({
  queueDir, manifest: parseManifest(readFileSync(manifestPath, 'utf8')), logsRoot: join(root, '_logs'), forgeRoot: root,
});

test('kickoff facts: an in-flight re-entered fix round reads round 1, running, and develop running', () => {
  withFix('in-flight', (root, p) => {
    const s = source(root, p, 'in-flight');
    assert.deepEqual(manifestFixRound(s), { round: 1, running: true });
    assert.equal(manifestDevelopRunning(s), true);
  });
});

test('kickoff facts: the parked fix round is unchanged — round 1, not running, develop not running', () => {
  withFix('ready-for-review', (root, p) => {
    const s = source(root, p, 'ready-for-review');
    assert.deepEqual(manifestFixRound(s), { round: 1, running: false });
    assert.equal(manifestDevelopRunning(s), false);
  });
});

test('kickoff facts: any other queue dir reads nothing', () => {
  withFix('in-flight', (root, p) => {
    for (const dir of ['pending', 'done', 'failed', 'merged']) {
      assert.equal(manifestFixRound(source(root, p, dir)), null, dir);
      assert.equal(manifestDevelopRunning(source(root, p, dir)), false, dir);
    }
  });
});

test('run model: an in-flight run carries fixRound, fixRoundRunning and developRunning; it is active, never complete-dated', () => {
  withFix('in-flight', (root, p) => {
    const run = aggregateRun({ root, queueState: 'in-flight', manifestPath: p, nowMs: NOW });
    assert.equal(run.status, 'active');
    assert.equal(run.completedAt, undefined, 'the earlier park\'s cycle.end is not a completion of the re-entered round');
    assert.equal(run.fixRound, 1);
    assert.equal(run.fixRoundRunning, true);
    assert.equal(run.developRunning, true);
  });
});

test('run model: the parked run still carries fixRound but neither running flag', () => {
  withFix('ready-for-review', (root, p) => {
    const run = aggregateRun({ root, queueState: 'ready-for-review', manifestPath: p, nowMs: NOW });
    assert.equal(run.fixRound, 1);
    assert.equal(run.fixRoundRunning, undefined);
    assert.equal(run.developRunning, undefined);
  });
});
