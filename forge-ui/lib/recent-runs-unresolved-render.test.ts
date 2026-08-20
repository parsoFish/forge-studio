/**
 * W7-FIX-A1 (A1-09) — the recent-agent-runs ledger is honest about reads it
 * could NOT make. `fetchRecentAgentRunsWithMeta` (lib/agents-index.ts)
 * surfaces the `unresolved` count; the section renders it as
 * `UnresolvedHistoriesNotice` (`components/studio/UnresolvedHistoriesNotice.tsx`)
 * ABOVE whatever rows WERE read — never a fabricated row, never a silent
 * empty ledger for a total outage.
 *
 * Contract (docs/forge-ui-dom-and-harness.md → `/agents` recent-agent-runs
 * + Home "activity"):
 *   [role="status"][data-component="recent-agent-runs-unresolved"]
 *     [data-unresolved-count=<n>][data-unresolved-total=<m>]
 *   + [data-action="retry-recent-runs"] when a retry is wired.
 *   Absent entirely when `unresolved === 0` (an empty ledger with no notice
 *   IS the honest "never ran" state).
 *   The section root carries `data-recent-runs-unresolved=<n>` (0 when clean).
 *
 * Wrong implementations these pins kill:
 *   - the count parsed then discarded (the pre-fix state);
 *   - a notice that REPLACES the rows that were read (partial data hidden);
 *   - the notice riding `[data-component="fetch-error"]` — it is not a
 *     page/panel-level fetch failure (the roster read succeeded), and the
 *     journeys' healthy-bridge check counts fetch-error nodes;
 *   - a notice rendered when nothing was unresolved.
 *
 * RUN: cd forge-ui && npx vitest run lib/recent-runs-unresolved-render.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { UnresolvedHistoriesNotice } from '@/components/studio/UnresolvedHistoriesNotice';
import { AgentsIndexView, type AgentsIndexViewProps } from '@/components/studio/AgentsIndexView';
import type { LedgerRow } from './history-ledger';

function ledgerRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'RUN-a', when: '2026-01-01T00:00:00Z', what: 'Ship the ledger', narrative: null,
    narrativeKinds: [], status: 'complete', costUsd: 1.5, href: '/agents/architect/run/RUN-a', ...over,
  };
}

function view(over: Partial<AgentsIndexViewProps> = {}): string {
  return renderToStaticMarkup(
    React.createElement(AgentsIndexView, {
      ready: true, agents: [], recentRunsReady: true, recentRuns: [], nowMs: Date.parse('2026-01-02T00:00:00Z'), ...over,
    }),
  );
}

test('UnresolvedHistoriesNotice: unresolved>0 → role="status" notice carrying count + total, the human sentence, and Retry when wired', () => {
  const html = renderToStaticMarkup(React.createElement(UnresolvedHistoriesNotice, { unresolved: 2, total: 5, onRetry: () => {} }));
  expect(html).toContain('data-component="recent-agent-runs-unresolved"');
  expect(html).toContain('role="status"');
  expect(html).toContain('data-unresolved-count="2"');
  expect(html).toContain('data-unresolved-total="5"');
  expect(html).toMatch(/2 of 5 agent histories could not be read/);
  expect(html).toContain('data-action="retry-recent-runs"');
  expect(html).not.toContain('data-component="fetch-error"');
});

test('UnresolvedHistoriesNotice: unresolved===0 → renders NOTHING (an empty ledger with no notice is the honest never-ran state)', () => {
  expect(renderToStaticMarkup(React.createElement(UnresolvedHistoriesNotice, { unresolved: 0, total: 5 }))).toBe('');
});

test('UnresolvedHistoriesNotice: no onRetry → no retry control (never a dead button)', () => {
  const html = renderToStaticMarkup(React.createElement(UnresolvedHistoriesNotice, { unresolved: 5, total: 5 }));
  expect(html).toContain('data-unresolved-count="5"');
  expect(html).not.toContain('data-action="retry-recent-runs"');
});

test('AgentsIndexView: recentRunsUnresolved>0 → the notice renders ABOVE the real HistoryLedger, and the rows that WERE read still render (partial data never hidden)', () => {
  const html = view({ recentRuns: [ledgerRow({ id: 'RUN-kept' })], recentRunsUnresolved: 1, recentRunsTotal: 3, onRetryRecentRuns: () => {} });
  const notice = html.indexOf('data-component="recent-agent-runs-unresolved"');
  const ledger = html.indexOf('data-section="history-ledger"');
  expect(notice).toBeGreaterThan(-1);
  expect(ledger).toBeGreaterThan(-1);
  expect(notice).toBeLessThan(ledger);
  expect(html).toContain('RUN-kept');
  expect(html).toContain('data-recent-runs-unresolved="1"');
  expect(html).toContain('data-action="retry-recent-runs"');
});

test('AgentsIndexView: a TOTAL outage (unresolved === total, zero rows) shows the notice — never the bare empty ledger of a fleet that has never run', () => {
  const html = view({ recentRuns: [], recentRunsUnresolved: 4, recentRunsTotal: 4 });
  expect(html).toContain('data-unresolved-count="4"');
  expect(html).toContain('data-unresolved-total="4"');
  expect(html).toContain('data-recent-runs-unresolved="4"');
});

test('AgentsIndexView: recentRunsUnresolved omitted/0 → no notice, section root data-recent-runs-unresolved="0", root data-fetch-status stays "ok" (the roster read succeeded)', () => {
  const clean = view({ recentRuns: [ledgerRow()] });
  expect(clean).not.toContain('data-component="recent-agent-runs-unresolved"');
  expect(clean).toContain('data-recent-runs-unresolved="0"');
  expect(clean).toContain('data-fetch-status="ok"');
});

test('AgentsIndexView: while the runs fetch is still loading, no notice renders even if a stale count is passed (loading is loading)', () => {
  const html = view({ recentRunsReady: false, recentRunsUnresolved: 2, recentRunsTotal: 2 });
  expect(html).toContain('data-component="recent-runs-loading"');
  expect(html).not.toContain('data-component="recent-agent-runs-unresolved"');
});
