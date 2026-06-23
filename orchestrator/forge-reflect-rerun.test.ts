/**
 * Tests for orchestrator/forge-reflect-rerun.ts — manifest-id resolution.
 *
 * The cycleId handed to a rerun is usually the timestamped log-dir name
 * (`<ts>_<initiativeId>`), but the manifest is named by initiativeId. Recovering
 * the initiativeId is what makes the auto-rerun (POST + startup reconcile)
 * actually find the manifest instead of throwing "no manifest".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveInitiativeId } from './forge-reflect-rerun.ts';

test('resolveInitiativeId: reads initiative_id from the cycle event log', () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'rerun-resolve-'));
  try {
    const cycleId = '2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta';
    mkdirSync(join(logsRoot, cycleId), { recursive: true });
    writeFileSync(
      join(logsRoot, cycleId, 'events.jsonl'),
      JSON.stringify({ cycle_id: cycleId, initiative_id: 'INIT-2026-06-22-compare-ref-analytics-delta', message: 'reflector.start' }),
    );
    assert.equal(resolveInitiativeId(cycleId, logsRoot), 'INIT-2026-06-22-compare-ref-analytics-delta');
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('resolveInitiativeId: falls back to stripping a leading timestamp prefix when no event log', () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'rerun-resolve-'));
  try {
    // No _logs dir for this cycle → prefix-strip heuristic.
    assert.equal(
      resolveInitiativeId('2026-06-22T08-23-03_INIT-foo-bar', logsRoot),
      'INIT-foo-bar',
    );
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('resolveInitiativeId: a bare initiativeId (no timestamp prefix) is returned unchanged', () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'rerun-resolve-'));
  try {
    assert.equal(resolveInitiativeId('INIT-already-an-id', logsRoot), 'INIT-already-an-id');
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});
