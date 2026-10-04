/**
 * Row 207 (bead `forge-8vfn.8.5.57`), item C1's reader half — an operator-
 * stopped attempt now ends with its own `cycle.end` (status `stopped`), so a
 * recap that read the FIRST cycle.end would name a stopped-then-resumed run
 * by its stop. The recap's outcome line reads the LAST attempt's status.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderCycleRecap } from '../../cycle-recap.ts';

test('renderCycleRecap: a stopped first attempt never names a resumed run — the last cycle.end does', () => {
  const root = mkdtempSync(join(tmpdir(), 'recap-last-attempt-'));
  try {
    const cycleId = '2026-10-04T17-05-02_INIT-2026-10-04-coupling-sort-flag';
    mkdirSync(join(root, '_logs', cycleId), { recursive: true });
    const row = (event_type: string, message: string, metadata?: Record<string, unknown>) =>
      JSON.stringify({ event_id: `EV_${message}_${event_type}_${Math.random()}`, phase: 'orchestrator', skill: 'cycle', event_type, message, started_at: '2026-10-04T17:08:16.184Z', ...(metadata ? { metadata } : {}) });
    writeFileSync(join(root, '_logs', cycleId, 'events.jsonl'), [
      row('start', 'cycle.start'),
      row('end', 'cycle.end', { status: 'stopped', error: 'OperatorStopError: operator-stop:' }),
      row('start', 'cycle.start'),
      row('end', 'cycle.end', { status: 'pr-open' }),
    ].join('\n') + '\n');
    const md = renderCycleRecap({
      forgeRoot: root, logsRoot: join(root, '_logs'), cycleId, initiativeId: 'INIT-2026-10-04-coupling-sort-flag',
      manifestPath: join(root, 'missing.md'), projectName: 'gitpulse', themesWritten: [], cycleArchivePath: join(root, 'a.md'),
      lintStatus: 'skipped', reflectorCostUsd: 0, reflectorDurationMs: 0,
    });
    assert.match(md, /pr-open — project `gitpulse`/);
    assert.doesNotMatch(md, /stopped — project/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
