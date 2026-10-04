/**
 * Row 207 (bead `forge-8vfn.8.5.57`), T1 ruling 1973qh (2) — a lost
 * reflection's own `reflector.end` carries the failed marker
 * (`status: 'failed'`), and no stations reader may count it as a completed
 * reflection: the boot reconcile must still rerun over newer feedback, and
 * the recap must still add the closing pass's own cost.
 *
 * Fixture rows are the R6j capture's (S10 `2026-10-02T05-13-08_…`), plus the
 * end the emitter now writes after the loss row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lastReflectorEndMs } from '../../reflect-reconcile.ts';
import { renderCycleRecap } from '../../cycle-recap.ts';

const CYCLE = '2026-10-02T05-13-08_INIT-2026-10-02-exclude-author-flag-complete';
const INIT = 'INIT-2026-10-02-exclude-author-flag-complete';
const base = { cycle_id: CYCLE, initiative_id: INIT, phase: 'reflection', skill: 'reflector', input_refs: [], output_refs: [] };
const R6J_START = { ...base, event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T05:59:03.187Z', event_type: 'start', message: 'reflector.start' };
const R6J_LOST = {
  ...base, event_id: 'EV_muqkc78w_43etnnmk', parent_event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T06:09:22.352Z',
  event_type: 'error', message: 'cycle.reflection-lost',
  metadata: { cause: 'budget-exhausted', detail: 'reflector SDK run ended with result subtype "error_max_budget_usd" — reflection outputs are incomplete', result_subtype: 'error_max_budget_usd', cost_usd: 3.04, duration_ms: 617470 },
};
/** The end the emitter now writes for that start (the R6j capture predates it). */
const R6J_FAILED_END = {
  ...base, event_id: 'EV_r207_failed_end', parent_event_id: 'EV_muqjyxhv_3hfdxtnr', started_at: '2026-10-02T06:09:22.353Z',
  event_type: 'end', message: 'reflector.end',
  metadata: { status: 'failed', error: 'cycle.reflection-lost budget-exhausted: reflector SDK run ended with result subtype "error_max_budget_usd" — reflection outputs are incomplete' },
};

function writeLog(rows: object[]): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'reflector-failed-end-'));
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  const path = join(root, '_logs', CYCLE, 'events.jsonl');
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { root, path };
}

test('lastReflectorEndMs: a failed reflector.end is not the last ingest — a lost reflection leaves no end to compare feedback against', () => {
  const { root, path } = writeLog([R6J_START, R6J_LOST, R6J_FAILED_END]);
  try {
    assert.equal(lastReflectorEndMs(path), null, 'a lost reflection ingested nothing — feedback newer than it must still rerun');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lastReflectorEndMs: a closed rerun end after the failed one is the last ingest', () => {
  const rerunEnd = { ...base, event_id: 'EV_muqkdcfe_zf9vr1q2', parent_event_id: 'EV_muqkc7s4_3wrx4wzu', started_at: '2026-10-02T06:10:15.722Z', event_type: 'end', message: 'reflector.end', metadata: { status: 'closed' } };
  const { root, path } = writeLog([R6J_START, R6J_LOST, R6J_FAILED_END, rerunEnd]);
  try {
    assert.equal(lastReflectorEndMs(path), Date.parse('2026-10-02T06:10:15.722Z'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderCycleRecap: a lost pass\'s failed reflector.end does not stand in for the closing pass — its cost is still added', () => {
  const { root } = writeLog([R6J_START, R6J_LOST, R6J_FAILED_END]);
  try {
    const md = renderCycleRecap({
      forgeRoot: root, logsRoot: join(root, '_logs'), cycleId: CYCLE, initiativeId: INIT,
      manifestPath: join(root, 'missing.md'), projectName: 'gitpulse', themesWritten: [], cycleArchivePath: join(root, 'a.md'),
      lintStatus: 'clean', reflectorCostUsd: 0.34, reflectorDurationMs: 50_685,
    });
    assert.match(md, /Cost \(total\): \$0\.34/, 'the closing pass has no end yet — its own $0.34 is counted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
