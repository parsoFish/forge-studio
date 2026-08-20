/**
 * W7-B2 pinned render tests — the shared `RecentRuns` widget (knowledge-20
 * extraction from AgentsIndexView; consumed by /agents and the KB health
 * tab, and by B5's agent surfaces next).
 */

import { test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecentRuns, type RecentRunsProps } from '@/components/RecentRuns';
import type { LedgerRow } from './history-ledger';

const NOW = new Date('2026-08-20T12:00:00Z').getTime();

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'forge-dev-drain-abc',
    when: '2026-08-20T10:00:00.000Z',
    what: 'Drain to green',
    narrative: 'round 2/5',
    narrativeKinds: ['kb-run-detail'],
    status: 'green',
    costUsd: 0.31,
    href: '/knowledge?id=forge-dev&tab=health#kb-drain-panel',
    ...overrides,
  };
}

function render(overrides: Partial<RecentRunsProps> = {}): string {
  return renderToStaticMarkup(React.createElement(RecentRuns, {
    section: 'kb-recent-runs', title: 'Recent runs for this KB',
    ready: true, rows: [], nowMs: NOW,
    ...overrides,
  }));
}

test('renders its caller-declared data-section token (per-surface DOM contract)', () => {
  expect(render()).toContain('data-section="kb-recent-runs"');
  expect(render({ section: 'recent-agent-runs' })).toContain('data-section="recent-agent-runs"');
});

test('not ready → the honest loading state, never HistoryLedger\'s empty state standing in for "unknown"', () => {
  const html = render({ ready: false });
  expect(html).toContain('data-component="recent-runs-loading"');
  expect(html).not.toContain('data-section="history-ledger"');
});

test('ready with rows → the REAL HistoryLedger rows, ids + statuses verbatim', () => {
  const html = render({ rows: [row()] });
  expect(html).toContain('data-section="history-ledger"');
  expect(html).toContain('data-run-id="forge-dev-drain-abc"');
  expect(html).toContain('data-run-status="green"');
});

test('a failed rows read renders the shared FetchErrorState — never an honest-looking empty ledger (W7-A1 discipline)', () => {
  const html = render({ error: { message: 'bridge unreachable', status: undefined } });
  expect(html).toContain('data-component="fetch-error"');
  expect(html).not.toContain('data-section="history-ledger"');
});

test('ready with zero rows → HistoryLedger\'s own honest empty state (data-ledger-count="0")', () => {
  const html = render({ rows: [] });
  expect(html).toContain('data-ledger-count="0"');
});
