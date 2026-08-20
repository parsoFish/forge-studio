/**
 * W7-B2 pinned tests — kb-runs.ts (knowledge-20): KB run-history rows →
 * shared LedgerRow mapping.
 */

import { test, expect } from 'vitest';

import { toKbRunLedgerRow, toKbRunLedgerRows } from './kb-runs';
import type { KbRunRow } from './studio-client';

const drainRun: KbRunRow = {
  kind: 'drain', id: 'forge-dev-drain-abc', when: '2026-08-20T10:00:00.000Z',
  status: 'green', costUsd: 0.31, detail: 'round 2/5 · auto 3 · agent 1 · you 0',
};

test('drain run → ledger row: what/status/cost verbatim, href = the KB health tab', () => {
  const row = toKbRunLedgerRow('forge-dev', drainRun);
  expect(row.what).toBe('Drain to green');
  expect(row.status).toBe('green');
  expect(row.costUsd).toBe(0.31);
  expect(row.narrative).toBe('round 2/5 · auto 3 · agent 1 · you 0');
  expect(row.narrativeKinds).toEqual(['kb-run-detail']);
  expect(row.href).toBe('/knowledge?id=forge-dev&tab=health#kb-drain-panel');
});

test('cleanup run → ledger row: href is the REAL session page with its anchor project', () => {
  const row = toKbRunLedgerRow('forge-dev', {
    kind: 'cleanup', id: '2026-08-20T09-00-00-ab12', when: '2026-08-20T09:00:00.000Z',
    status: 'awaiting-approval', costUsd: null, detail: null, project: '.kb-forge-dev',
  });
  expect(row.what).toBe('Cleanup plan');
  expect(row.href).toBe('/sessions/kb-cleanup/2026-08-20T09-00-00-ab12?project=.kb-forge-dev');
  // history-ledger invariant: narrativeKinds is [] iff narrative === null.
  expect(row.narrative).toBeNull();
  expect(row.narrativeKinds).toEqual([]);
  // An absent cost stays null — never a fabricated 0.
  expect(row.costUsd).toBeNull();
});

test('rows come back newest-first regardless of input order', () => {
  const rows = toKbRunLedgerRows('forge-dev', [
    { ...drainRun, id: 'old', when: '2026-08-01T00:00:00.000Z' },
    { ...drainRun, id: 'new', when: '2026-08-20T00:00:00.000Z' },
  ]);
  expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
});
