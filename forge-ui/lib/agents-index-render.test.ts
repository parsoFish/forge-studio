/**
 * DOM contract + acceptance tests for the `/agents` index route's pure view
 * (`components/studio/AgentsIndexView.tsx`, T2 lane W6-IA-3), a component
 * that does not exist yet. Every assertion below is a legitimate RED
 * against a not-yet-created file.
 *
 * WHY A PURE PRESENTATIONAL COMPONENT, SEPARATE FROM `app/agents/page.tsx`:
 * same documented gap as `./run-view-client.ts` / `./history-ledger-render.
 * test.ts` — no jsdom, no `@testing-library/react` in this repo, and
 * `StudioNav` reads the route via a client-only hook that needs the Next.js
 * router context bare `react-dom/server` rendering cannot provide. So the
 * actual page is a thin client shell (fetches the roster + the merged
 * "recent agent runs" ledger, renders `<StudioNav/>` then this component)
 * and THIS component takes fully-resolved props and is what gets rendered
 * here via `renderToStaticMarkup` — mirrors `./run-view-render.test.ts` and
 * `./history-ledger-render.test.ts`'s own precedent exactly.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `@/components/studio/AgentsIndexView` (none exist yet):
 *
 *   export type AgentsIndexViewProps = {
 *     ready: boolean;
 *     agents: Agent[];
 *     recentRunsReady: boolean;
 *     recentRuns: LedgerRow[];
 *     nowMs: number;
 *   };
 *   export function AgentsIndexView(props: AgentsIndexViewProps): JSX.Element
 *
 * ASSUMED DOM CONTRACT:
 *   <main data-page="agents-index" data-page-ready={ready} data-agent-count={agents.length}>
 *     <section data-section="agent-roster" data-count={agents.length}>
 *       <a data-action="new-agent" href="/agents/new">...</a>
 *       !ready            -> <div data-component="agent-roster-loading">
 *       ready && count=0  -> <div data-component="agent-roster-empty">
 *       ready && count>0  -> one AgentCard (LibraryCard.tsx, reused unchanged) per agent
 *     </section>
 *     <section data-section="recent-agent-runs">
 *       !recentRunsReady  -> <div data-component="recent-agent-runs-loading">
 *       recentRunsReady   -> <HistoryLedger rows={recentRuns} nowMs={nowMs}/> (reused unchanged)
 *     </section>
 *   </main>
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentsIndexView, type AgentsIndexViewProps } from '@/components/studio/AgentsIndexView';
import type { Agent } from './studio-client';
import type { LedgerRow } from './history-ledger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'architect',
    name: 'Architect',
    purpose: 'Plans the roadmap.',
    skills: ['architect-skill'],
    tools: [],
    mcps: [],
    guards: ['event-log'],
    hooks: [],
    ...over,
  };
}

function ledgerRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'RUN-a',
    when: '2026-01-01T00:00:00Z',
    what: 'Ship the ledger',
    narrative: null,
    narrativeKinds: [],
    status: 'complete',
    costUsd: 1.5,
    href: '/agents/architect/run/RUN-a',
    ...over,
  };
}

const FIXED_NOW = new Date('2026-01-01T03:00:00Z').getTime();

function render(over: Partial<AgentsIndexViewProps> = {}): string {
  const props: AgentsIndexViewProps = {
    ready: true,
    agents: [agent()],
    recentRunsReady: true,
    recentRuns: [],
    nowMs: FIXED_NOW,
    ...over,
  };
  return renderToStaticMarkup(React.createElement(AgentsIndexView, props));
}

/** The single element carrying `data-card-id="<id>"`, as raw markup —
 *  same extraction technique `./history-ledger-render.test.ts`'s own
 *  `rowMarkup` uses for `data-run-id`. */
function elementMarkup(html: string, attr: string): string {
  const i = html.indexOf(attr);
  if (i === -1) throw new Error(`no element carrying ${attr} in rendered markup: ${html}`);
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  return html.slice(start, end + 1);
}

function tagOf(markup: string): string {
  const m = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(markup);
  if (!m) throw new Error(`could not extract a tag name from: ${markup}`);
  return m[1].toLowerCase();
}

// ---------------------------------------------------------------------------
// ROOT STRUCTURE
// ---------------------------------------------------------------------------

test('the root is data-page="agents-index", carrying data-page-ready and data-agent-count', () => {
  const html = render({ ready: true, agents: [agent({ id: 'a' }), agent({ id: 'b' })] });
  expect(html).toContain('data-page="agents-index"');
  expect(html).toContain('data-page-ready="true"');
  expect(html).toContain('data-agent-count="2"');
});

test('data-page-ready reflects the ready prop exactly — false before the roster fetch resolves', () => {
  const html = render({ ready: false, agents: [] });
  expect(html).toContain('data-page-ready="false"');
});

// ---------------------------------------------------------------------------
// AGENT ROSTER — loading / zero-state / grid
// ---------------------------------------------------------------------------

test('agent-roster: not ready yet -> the honest loading state, never a fabricated empty-state claim', () => {
  const html = render({ ready: false, agents: [] });
  expect(html).toContain('data-component="agent-roster-loading"');
  expect(html).not.toContain('data-component="agent-roster-empty"');
  expect(html).not.toContain('data-card-type="agent"');
});

test('agent-roster: ready with zero agents -> the honest empty state, never a fabricated card', () => {
  const html = render({ ready: true, agents: [] });
  expect(html).toContain('data-section="agent-roster"');
  expect(html).toContain('data-count="0"');
  expect(html).toContain('data-component="agent-roster-empty"');
  expect(html).not.toContain('data-component="agent-roster-loading"');
  expect(html).not.toContain('data-card-type="agent"');
});

test('agent-roster: ready with agents -> one REAL AgentCard per agent, reused unchanged from LibraryCard.tsx (data-card-type="agent")', () => {
  const html = render({
    ready: true,
    agents: [agent({ id: 'architect', name: 'Architect' }), agent({ id: 'developer-ralph', name: 'Developer Ralph' })],
  });
  expect(html).toContain('data-count="2"');
  expect((html.match(/data-card-type="agent"/g) ?? []).length).toBe(2);
  expect(html).toContain('data-card-id="architect"');
  expect(html).toContain('data-card-id="developer-ralph"');
  // AgentCard links to the agent builder — the actual reused component, not
  // a hand-rolled lookalike.
  expect(html).toContain('href="/agents/architect"');
  expect(html).toContain('href="/agents/developer-ralph"');
});

test('agent-roster: the "+ New agent" CTA is a REAL <a href="/agents/new">, present in every ready/loading/empty state', () => {
  for (const state of [{ ready: false, agents: [] }, { ready: true, agents: [] }, { ready: true, agents: [agent()] }]) {
    const html = render(state);
    const markup = elementMarkup(html, 'data-action="new-agent"');
    expect(tagOf(markup)).toBe('a');
    expect(markup).toContain('href="/agents/new"');
  }
});

// ---------------------------------------------------------------------------
// RECENT AGENT RUNS — reuses HistoryLedger unchanged (D2)
// ---------------------------------------------------------------------------

test('recent-agent-runs: not ready yet -> the honest loading state, never HistoryLedger\'s own empty state standing in for "unknown"', () => {
  const html = render({ recentRunsReady: false, recentRuns: [] });
  expect(html).toContain('data-component="recent-agent-runs-loading"');
  // HistoryLedger's own section must not render at all while unresolved —
  // its honest-empty state ("No runs yet.") would misrepresent "not fetched
  // yet" as "fetched, genuinely empty".
  expect(html).not.toContain('data-section="history-ledger"');
});

test('recent-agent-runs: ready with zero rows -> renders the REAL HistoryLedger, whose own honest empty state fires (data-ledger-count="0")', () => {
  const html = render({ recentRunsReady: true, recentRuns: [] });
  expect(html).toContain('data-section="history-ledger"');
  expect(html).toContain('data-ledger-count="0"');
  expect(html).toContain('data-component="history-ledger-empty"');
  expect(html).not.toContain('data-component="recent-agent-runs-loading"');
});

test('recent-agent-runs: rows are rendered VERBATIM by the REAL HistoryLedger — this view derives nothing itself (D2, the reuse seam)', () => {
  const html = render({
    recentRunsReady: true,
    recentRuns: [ledgerRow({ id: 'sentinel', href: '/agents/architect/run/SENTINEL-99', status: 'gated', costUsd: 4.25 })],
  });
  expect(html).toContain('data-section="history-ledger"');
  expect(html).toContain('data-ledger-count="1"');
  const rowMarkup = elementMarkup(html, 'data-run-id="sentinel"');
  expect(tagOf(rowMarkup)).toBe('a');
  expect(rowMarkup).toContain('href="/agents/architect/run/SENTINEL-99"');
  expect(rowMarkup).toContain('data-run-status="gated"');
  expect(rowMarkup).toContain('data-ledger-cost-usd="4.25"');
});

test('the roster and the runs ledger are two INDEPENDENT readiness facts — the roster can be ready while the runs ledger is still loading, and vice versa', () => {
  const rosterReadyRunsLoading = render({ ready: true, agents: [agent()], recentRunsReady: false, recentRuns: [] });
  expect(rosterReadyRunsLoading).not.toContain('data-component="agent-roster-loading"');
  expect(rosterReadyRunsLoading).toContain('data-component="recent-agent-runs-loading"');

  const rosterLoadingRunsReady = render({ ready: false, agents: [], recentRunsReady: true, recentRuns: [] });
  expect(rosterLoadingRunsReady).toContain('data-component="agent-roster-loading"');
  expect(rosterLoadingRunsReady).toContain('data-section="history-ledger"');
});
