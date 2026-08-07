/**
 * ACCEPTANCE TESTS (T3, R6-01 WI-3 / F5) — the run-detail TIMELINE ROW
 * click-through render contract: an expanded node renders that node's own
 * log lines through the SHARED `RunLog` (never a forked renderer), and its
 * typed-outputs section stays honestly empty (no per-node artifact data
 * source exists — measured, see below).
 *
 * WHY A PURE PROP, NOT A CLICK: there is no jsdom in this repo, so no unit
 * test can exercise a click or a React state change (same documented gap as
 * `./flow-run-detail-render.test.ts`'s own header). The click itself, and
 * the fetch it triggers, are proven by a journey beat (`scripts/journeys/
 * flows-run.mjs`'s `flows-run-detail-reachable`, extended in the same PR).
 * This file pins the PROPS-DRIVEN RENDER ONLY: given a row already resolved
 * to "expanded, with these lines", does `FlowRunDetail` compose `RunLog`
 * correctly and never invent per-node output data.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED NEW PROPS on `@/components/studio/FlowRunDetail`'s
 * `FlowRunDetailProps` (do not exist yet — every assertion below is a
 * legitimate RED against the unmodified component):
 *
 *   expandedNodeId: string | null;                  // which row, if any, is open
 *   nodeLogLines: Record<string, RunLogLine[]>;      // keyed by nodeId
 *
 * ASSUMED NEW data-* CONTRACT — deliberately NOT reusing `data-node-id` on
 * the new elements (that attribute is ALREADY the exact-match anchor
 * `./flow-run-detail-render.test.ts`'s own `rowMarkup()` helper keys off via
 * `html.indexOf('data-node-id="<id>"')` — a second element carrying the same
 * attribute value, positioned BEFORE the existing timeline row in the
 * markup, would silently break that PINNED helper for every one of its
 * existing tests. New elements use `data-detail-for-node` instead — same
 * information, a name that cannot collide):
 *
 *   [data-timeline-row="true"][data-node-id][data-status][data-phase-cost-usd]
 *     gains: [data-node-expanded="true"|"false"]   (ADDITIVE — existing
 *            `.toContain(...)` assertions in flow-run-detail-render.test.ts
 *            are unaffected by an extra attribute)
 *   [data-section="node-detail"][data-detail-for-node]   only when expanded
 *     [data-section="node-log"]  wrapping the composed <RunLog lines={...} />
 *       -> RunLog's OWN existing contract, verbatim, reused not forked:
 *          [data-component="run-log"|"run-log-empty"]
 *          [data-log-line="true"][data-log-kind]
 *     [data-section="node-outputs"][data-outputs-count]
 *       -> [data-component="node-outputs-empty"] when count is 0
 *
 * MEASURED GROUNDS (task report has the full trace):
 *   - `forge-ui/lib/flow-run-timeline.ts`'s own header (already shipped,
 *     WI-2): "`artifacts` is always `[]` — there is no per-node artifact
 *     data anywhere in the run model (`artifactsReady` is run-level, keyed
 *     by artifact TYPE)". `FlowRunTimelineRow.artifacts: string[]` is the
 *     ONLY per-node output field that exists; it is always `[]` today.
 *   - This initiative's own D6/D7 (ledger, R2-05-F2 composed-output
 *     measurement): DEFERRED — `ARTIFACT_KINDS` has no `composed` kind,
 *     0/10 real agents declare an output surface, 7/7 on-disk templates are
 *     `file`/`git-state`. There is NO data source to build a real per-node
 *     typed-outputs mapping from — same "never-populating-surface" trap
 *     R6-04's own `RunOutputsSection` already refuses (`outputs: []`,
 *     "honestly always empty... rather than fabricated").
 *   - Therefore: the node-outputs section below MUST stay empty using
 *     `row.artifacts` (already-shipped, already `[]`) — NEVER read
 *     `run.artifactsReady` (run-level) to fabricate a per-node entry. The
 *     test below proves that even when `run.artifactsReady` is non-empty,
 *     the node section stays honestly empty.
 *
 * RUN: npx vitest run lib/flow-run-node-log-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowRunDetail, type FlowRunDetailProps } from '@/components/studio/FlowRunDetail';
import type { Flow, Run } from './studio-client.ts';
import type { FlowRunTimelineRow } from './flow-run-timeline.ts';
import type { RunLogLine } from './run-log-line.ts';

// ---------------------------------------------------------------------------
// Fixtures — same shapes as flow-run-detail-render.test.ts's own fixtures
// ---------------------------------------------------------------------------

function developFlow(): Flow {
  return {
    id: 'forge-develop',
    name: 'Develop',
    goal: 'Build the initiative.',
    nodes: [
      { id: 'dev', agent: 'developer-ralph' },
      { id: 'demo', agent: 'demo-agent', resumable: true },
    ],
    edges: [],
    triggers: [],
  };
}

function archivedRun(over: Partial<Run> = {}): Run {
  return {
    id: '2026-01-01T00-00-00_INIT-done-2',
    flowId: 'forge-develop',
    initiativeId: 'INIT-done-2',
    initiative: 'Archived probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 4.1,
    startedAt: '2026-01-01T00:05:00Z',
    phases: { dev: 'complete' },
    phaseMeta: { dev: { costUsd: 3.5, retries: 0 } },
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-develop'],
    ...over,
  };
}

function rows(): FlowRunTimelineRow[] {
  return [
    { nodeId: 'dev', agent: 'developer-ralph', status: 'complete', costUsd: 3.5, note: '4 files · +120 · 2 commits', artifacts: [] },
    { nodeId: 'demo', agent: 'demo-agent', status: 'pending', costUsd: 0, note: null, artifacts: [] },
  ];
}

function baseProps(over: Partial<FlowRunDetailProps> = {}): FlowRunDetailProps {
  return {
    runId: '2026-01-01T00-00-00_INIT-done-2',
    found: true,
    flow: developFlow(),
    run: archivedRun(),
    rows: rows(),
    findings: null,
    expandedNodeId: null,
    nodeLogLines: {},
    ...over,
  } as FlowRunDetailProps;
}

function render(over: Partial<FlowRunDetailProps> = {}): string {
  return renderToStaticMarkup(React.createElement(FlowRunDetail as never, baseProps(over) as never));
}

/** The row's OWN opening tag only — same technique as
 *  `flow-run-detail-render.test.ts`'s own `rowMarkup()`, duplicated here
 *  (not imported) so this file has no dependency on that test file's
 *  internals. Scoping to the opening tag matters: `data-status` also
 *  appears on a sibling decorative `<span className="status-dot"
 *  data-status=...>` inside the SAME row, so a whole-html `.toContain()`
 *  check cannot tell "the row's own attribute is present" apart from "some
 *  element anywhere in this row carries it" — a mutation that drops the
 *  attribute from the row's own opening tag but leaves the span's copy
 *  intact would pass a whole-html check by accident. */
function rowTag(html: string, nodeId: string): string {
  const i = html.indexOf(`data-node-id="${nodeId}"`);
  if (i === -1) throw new Error(`no element with data-node-id="${nodeId}" in rendered markup`);
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  return html.slice(start, end + 1);
}

/** The detail panel for one node — from its own `data-detail-for-node`
 *  marker up to the NEXT row or detail marker (or end of string). Returns
 *  null when no such panel is present at all. */
function detailMarkup(html: string, nodeId: string): string | null {
  const marker = `data-detail-for-node="${nodeId}"`;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const nextRow = html.indexOf('data-timeline-row="true"', start + marker.length);
  const nextDetail = html.indexOf('data-detail-for-node="', start + marker.length);
  const candidates = [nextRow, nextDetail].filter((n) => n !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : html.length;
  return html.slice(start, end);
}

const DEV_LINES: RunLogLine[] = [
  { kind: 'out', text: 'start · developer-ralph', eventType: 'start' },
  { kind: 'tool', text: 'DEV-TOOL-MARKER', eventType: 'tool_use' },
  { kind: 'think', text: 'iteration (developer-loop)', eventType: 'iteration' },
];

// ---------------------------------------------------------------------------
// Collapsed by default — no row leaks a detail panel unasked
// ---------------------------------------------------------------------------

test('no row renders a detail panel when nothing is expanded — kills an always-open or eagerly-rendered log section', () => {
  const html = render();
  expect(html).not.toContain('data-section="node-detail"');
  expect(html).not.toContain('data-detail-for-node');
  // The row itself still renders, honestly reporting its own collapsed state.
  expect(html).toContain('data-node-expanded="false"');
});

test('the existing timeline-row contract from WI-2 is untouched by the new prop — kills accidentally dropping data-node-id/status/cost off the row\'s own opening tag while adding expansion', () => {
  // Scoped to the row's own tag (see rowTag()'s header) — a whole-html
  // substring check would pass even if the mutation below stripped
  // data-status from the row, because a sibling decorative
  // <span data-status=...> inside the same row still carries the value.
  const tag = rowTag(render(), 'dev');
  expect(tag).toContain('data-timeline-row="true"');
  expect(tag).toContain('data-node-id="dev"');
  expect(tag).toContain('data-status="complete"');
  expect(tag).toContain('data-phase-cost-usd="3.50"');
});

// ---------------------------------------------------------------------------
// Expanded — that node's OWN lines, through the SHARED RunLog
// ---------------------------------------------------------------------------

test('the expanded node renders its OWN log lines through the shared RunLog component — kills a forked/second log renderer', () => {
  const html = render({ expandedNodeId: 'dev', nodeLogLines: { dev: DEV_LINES } });

  const panel = detailMarkup(html, 'dev');
  expect(panel).not.toBeNull();
  expect(panel).toContain('data-section="node-log"');
  // RunLog's OWN contract, reused verbatim — not a parallel vocabulary.
  expect(panel).toContain('data-component="run-log"');
  expect(panel).toContain('data-log-line="true"');
  expect(panel).toContain('data-log-kind="tool"');
  expect(panel).toContain('data-log-kind="think"');
  expect(panel).toContain('DEV-TOOL-MARKER');
});

test('only the expanded node shows a detail panel — a sibling row stays collapsed even when it has its own cached lines', () => {
  // KILLS: a component that expands EVERY row once any node has cached
  // lines (e.g. rendering off `Object.keys(nodeLogLines)` instead of
  // `expandedNodeId`) — the classic "shows everyone's log at once" defect.
  const html = render({
    expandedNodeId: 'dev',
    nodeLogLines: { dev: DEV_LINES, demo: [{ kind: 'out', text: 'DEMO-ONLY-LINE', eventType: 'log' }] },
  });

  expect(detailMarkup(html, 'dev')).not.toBeNull();
  expect(detailMarkup(html, 'demo')).toBeNull();
  expect(html).not.toContain('DEMO-ONLY-LINE');
});

test('the row reports its own expanded state honestly via data-node-expanded', () => {
  const html = render({ expandedNodeId: 'dev', nodeLogLines: { dev: DEV_LINES } });
  const at = (needle: string) => html.indexOf(needle);
  // dev's own row (not its detail panel) carries expanded="true"; demo's
  // row — found by searching from where dev's block ends — stays "false".
  const devRowStart = at('data-node-id="dev"');
  const devRowEnd = html.indexOf('>', devRowStart);
  expect(html.slice(html.lastIndexOf('<', devRowStart), devRowEnd)).toContain('data-node-expanded="true"');

  const demoRowStart = at('data-node-id="demo"');
  const demoRowEnd = html.indexOf('>', demoRowStart);
  expect(html.slice(html.lastIndexOf('<', demoRowStart), demoRowEnd)).toContain('data-node-expanded="false"');
});

test('an expanded node with NO cached lines yet renders RunLog\'s own honest-empty state — never invented filler', () => {
  // KILLS: rendering a placeholder like "Loading…" or "No data" authored
  // OUTSIDE RunLog (a second empty-state string drifting from RunLog's own
  // "No log lines yet."), and kills treating an empty array as "not yet
  // expanded" (which would silently collapse the row back).
  const html = render({ expandedNodeId: 'dev', nodeLogLines: { dev: [] } });

  const panel = detailMarkup(html, 'dev');
  expect(panel).not.toBeNull();
  expect(panel).toContain('data-component="run-log-empty"');
  expect(panel).toContain('No log lines yet.');
});

test('an expanded node with no cache entry AT ALL (undefined, not []) also renders the honest-empty state, never throws', () => {
  // KILLS: a lookup like `nodeLogLines[nodeId]` passed straight to RunLog
  // without a `?? []` fallback — `RunLog` maps over `lines`, so an
  // `undefined` would throw at render time instead of degrading.
  expect(() => render({ expandedNodeId: 'dev', nodeLogLines: {} })).not.toThrow();
  const html = render({ expandedNodeId: 'dev', nodeLogLines: {} });
  expect(detailMarkup(html, 'dev')).toContain('data-component="run-log-empty"');
});

// ---------------------------------------------------------------------------
// Typed outputs — honestly empty; NEVER sourced from run.artifactsReady
// ---------------------------------------------------------------------------

test('the expanded node\'s outputs section is honestly empty — there is no per-node output data source (measured: row.artifacts is always [])', () => {
  const html = render({ expandedNodeId: 'dev', nodeLogLines: { dev: DEV_LINES } });
  const panel = detailMarkup(html, 'dev');
  expect(panel).toContain('data-section="node-outputs"');
  expect(panel).toContain('data-outputs-count="0"');
  expect(panel).toContain('data-component="node-outputs-empty"');
});

test('a non-empty run.artifactsReady (run-level) is NEVER used to fabricate this node\'s outputs — kills the exact declared-data-fails-open shape this campaign keeps finding', () => {
  // The run has real artifacts ready (plan/work-items) — but they are
  // RUN-level, not attributable to any one node. The expanded row's own
  // `artifacts` field (from `flow-run-timeline.ts`, always []) is the only
  // legitimate per-node source; this proves nothing reaches past it into
  // `run.artifactsReady` to manufacture a node-level entry.
  const run = archivedRun({ artifactsReady: { plan: 'view', 'work-items': 'view' } });
  const html = render({ run, expandedNodeId: 'dev', nodeLogLines: { dev: DEV_LINES } });

  const panel = detailMarkup(html, 'dev');
  expect(panel).toContain('data-outputs-count="0"');
  expect(panel).toContain('data-component="node-outputs-empty"');
});

test('a row with real artifacts (a future data source) would render a non-zero count — proves the count is read from the row, not hardcoded to 0', () => {
  // Guards the OTHER direction: if `row.artifacts` were ever non-empty (a
  // real future data source), the section must reflect it — pinning that
  // "0" today is a fact about the data, not a hardcoded literal in the view.
  const withArtifact = rows();
  withArtifact[0] = { ...withArtifact[0], artifacts: ['plan'] };
  const html = render({ rows: withArtifact, expandedNodeId: 'dev', nodeLogLines: { dev: DEV_LINES } });

  const panel = detailMarkup(html, 'dev');
  expect(panel).toContain('data-outputs-count="1"');
  expect(panel).not.toContain('data-component="node-outputs-empty"');
});
