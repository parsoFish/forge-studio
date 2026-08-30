/**
 * Render pin for `MonitorSummaryStrip` — the four-tile headline Home and
 * `/monitor` both render over the merged everything-ledger (W8-B1).
 *
 * No jsdom in this repo: the component's initial-render DOM contract is
 * pinned with `react-dom/server`'s `renderToStaticMarkup`, the same way every
 * other `*-render.test.ts` here does it.
 *
 * RUN: npx vitest run lib/monitor-summary-strip-render.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';

// `next/link` renders an <a>; stub it so the strip can be rendered without an
// app-router provider (the same stub shape other render tests here use).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    React.createElement('a', { href, ...rest }, children as never),
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitorSummaryStrip } from '@/components/studio/MonitorSummaryStrip';
import { buildMonitorSummary } from './monitor-view';
import type { LedgerRow } from './history-ledger';
import type { Run, SessionIndexRow } from './studio-client';

function row(id: string, status: string): LedgerRow {
  return { id, when: '', what: 'r', narrative: null, narrativeKinds: [], status, costUsd: null, href: '/x' } as LedgerRow;
}

const SUMMARY = buildMonitorSummary({
  ledgerRows: [row('a', 'running'), row('b', 'running'), row('c', 'failed'), row('d', 'complete')],
  runs: [{ id: 'p', status: 'planned' } as Run, { id: 'g', status: 'gated' } as Run],
  sessions: [{ sessionId: 's', terminal: false, needsYou: true } as SessionIndexRow],
  attentionCount: 2,
});

test('the strip carries every count as a data-* attribute on the section itself', () => {
  // Kills a strip whose numbers exist only as rendered text — automation
  // (and the journey harness) reads structured state, never scraped copy.
  const html = renderToStaticMarkup(React.createElement(MonitorSummaryStrip, { summary: SUMMARY }));
  expect(html).toContain('data-section="monitor-summary"');
  expect(html).toContain(`data-monitor-live="${SUMMARY.live}"`);
  expect(html).toContain(`data-monitor-needs-you="${SUMMARY.needsYou}"`);
  expect(html).toContain(`data-monitor-failed="${SUMMARY.failed}"`);
  expect(html).toContain(`data-monitor-queued="${SUMMARY.queued}"`);
  expect(html).toContain(`data-monitor-total="${SUMMARY.total}"`);
  expect(html).toContain(`data-monitor-gated-runs="${SUMMARY.gatedRuns}"`);
  expect(html).toContain(`data-monitor-sessions-live="${SUMMARY.sessionsLive}"`);
});

test('the rendered counts are the summary values, tile for tile', () => {
  // Kills a tile that renders a different number from the one it declares.
  const html = renderToStaticMarkup(React.createElement(MonitorSummaryStrip, { summary: SUMMARY }));
  expect(html).toContain(`data-summary-tile="live" data-count="${SUMMARY.live}"`);
  expect(html).toContain(`data-summary-tile="needs-you" data-count="${SUMMARY.needsYou}"`);
  expect(html).toContain(`data-summary-tile="failed" data-count="${SUMMARY.failed}"`);
  expect(html).toContain(`data-summary-tile="queued" data-count="${SUMMARY.queued}"`);
});

test('the Home variant links through to /monitor; the Monitor variant does not self-link', () => {
  // Kills a dead self-link on the destination page, and kills a Home strip
  // that shows numbers with no way through to the detail behind them.
  const home = renderToStaticMarkup(React.createElement(MonitorSummaryStrip, { summary: SUMMARY, variant: 'home' }));
  expect(home).toContain('data-monitor-variant="home"');
  expect(home).toContain('data-action="open-monitor"');
  expect(home).toContain('href="/monitor"');

  const monitor = renderToStaticMarkup(React.createElement(MonitorSummaryStrip, { summary: SUMMARY, variant: 'monitor' }));
  expect(monitor).toContain('data-monitor-variant="monitor"');
  expect(monitor).not.toContain('data-action="open-monitor"');
  expect(monitor).not.toContain('href="/monitor"');
});

test('every tile still renders at zero, and the strip says it is not ready yet', () => {
  // Kills a strip whose rows disappear when there is nothing running —
  // "nothing is live" and "the strip broke" must not look the same.
  const empty = buildMonitorSummary({ ledgerRows: [], runs: [], sessions: [], attentionCount: 0 });
  const html = renderToStaticMarkup(React.createElement(MonitorSummaryStrip, { summary: empty, ready: false }));
  for (const tile of ['live', 'needs-you', 'failed', 'queued']) {
    expect(html).toContain(`data-summary-tile="${tile}" data-count="0"`);
  }
  expect(html).toContain('data-monitor-ready="false"');
});
