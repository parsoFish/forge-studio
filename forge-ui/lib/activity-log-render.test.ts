/**
 * DOM regression tests for `ActivityLog.tsx`
 * (forge-ui/components/studio/ActivityLog.tsx) — the shared full-width
 * bottom drawer (W6-B7), documented as the `[data-component=
 * "activity-drawer"]` contract in `docs/forge-ui-dom-and-harness.md`.
 *
 * Class heuristic this file exists to close (reviewer finding on
 * feat/w6-b7-activity-log): a new load-bearing `data-*` contract needs its
 * `renderToStaticMarkup` pin the moment it ships — `lib/activity-log-
 * view.test.ts` only proves the pure `ActivityRow[]` derivation is correct;
 * it can't catch a wrong/renamed attribute in the JSX that actually renders
 * those rows (e.g. `data-activty-kind`, or `data-drawer-open` spelled
 * `data-drawer-state`). This file renders the REAL component via
 * `react-dom/server`'s `renderToStaticMarkup` (same convention as
 * `run-panel-render.test.ts` — no jsdom/`@testing-library/react` added;
 * `forge-ui/vitest.config.ts`'s `resolve.alias`/`oxc.jsx` already support
 * this from that file's own addition) and asserts on the markup string.
 *
 * DISCLOSED RESIDUAL GAP (same class `run-panel-render.test.ts` already
 * discloses for its own cost-ceiling re-render): `renderToStaticMarkup`
 * renders ONCE per call — there is no persistent component instance, no
 * reconciler, and no click simulation. So the INITIAL value of every
 * `data-*` attribute driven by `useState` is pinned here (`data-drawer-open`
 * via the `defaultOpen` prop, which the two states below use to reach both
 * initial values without needing a click; `data-activity-expanded="false"`,
 * the only reachable initial value for a fresh mount), but the POST-CLICK
 * transition itself (toggling the drawer, expand-all, or a single row's
 * expand) is not exercised here — that needs a real reconciler (jsdom/
 * testing-library, a new-dependency decision) or a real-browser journey
 * beat, neither of which this file adds.
 *
 * RUN: npx vitest run lib/activity-log-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ActivityLog, type ActivityLogProps } from '@/components/studio/ActivityLog';
import type { EventLogEntry } from '@/lib/bridge-client';
import { ACTIVITY_THINKING_CLAMP_CHARS } from '@/lib/activity-log-view';

// ---------------------------------------------------------------------------
// Fixtures — one event per row kind `toActivityRows` (lib/activity-log-view.ts)
// derives, mirroring the real W6-B1 wire shapes (see that file's header).
// ---------------------------------------------------------------------------

function ev(partial: { event_id: string; event_type: string; message?: string; metadata?: Record<string, unknown> }): EventLogEntry {
  return {
    event_id: partial.event_id,
    initiative_id: 'init-1',
    started_at: '2026-08-15T00:00:00.000Z',
    phase: 'architect',
    skill: 'architect-runner',
    event_type: partial.event_type,
    message: partial.message,
    metadata: partial.metadata,
  };
}

const TOOL_EVENT = ev({ event_id: 'tool-1', event_type: 'tool_use', metadata: { tool: 'Read', input_summary: 'src/foo.ts' } });
const COALESCED_EVENT = ev({
  event_id: 'coalesced-1',
  event_type: 'tool_use',
  metadata: { coalesced: true, coalesced_count: 12, sampled_out_count: 30 },
});
const THINKING_LONG = 'a'.repeat(ACTIVITY_THINKING_CLAMP_CHARS + 50); // clampable — 50 hidden chars
const THINKING_EVENT = ev({ event_id: 'thinking-1', event_type: 'log', message: THINKING_LONG, metadata: { kind: 'thinking' } });
const REASONING_LONG = 'b'.repeat(ACTIVITY_THINKING_CLAMP_CHARS + 30); // clampable — 30 hidden chars
const REASONING_EVENT = ev({ event_id: 'reasoning-1', event_type: 'log', message: REASONING_LONG, metadata: { kind: 'reasoning' } });
const REDACTED_EVENT = ev({ event_id: 'redacted-1', event_type: 'log', message: '[thinking redacted]', metadata: { kind: 'thinking' } });
const CAPPED_EVENT = ev({
  event_id: 'capped-1',
  event_type: 'log',
  message: '[thinking capped after 300 rows]',
  metadata: { kind: 'thinking', capped: true },
});

const ALL_EVENTS: EventLogEntry[] = [
  TOOL_EVENT,
  COALESCED_EVENT,
  THINKING_EVENT,
  REASONING_EVENT,
  REDACTED_EVENT,
  CAPPED_EVENT,
];

function baseProps(overrides: Partial<ActivityLogProps> = {}): ActivityLogProps {
  return {
    label: 'test activity',
    events: ALL_EVENTS,
    ...overrides,
  };
}

function render(overrides: Partial<ActivityLogProps> = {}): string {
  return renderToStaticMarkup(React.createElement(ActivityLog, baseProps(overrides)));
}

/** Smallest `<tag ...>` substring containing `marker` — same tiny
 *  string-based helper `run-panel-render.test.ts` uses (no real DOM parser;
 *  sufficient because none of this component's attribute values contain
 *  `<`/`>`). */
function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

/** The substring for ONE row `<div data-activity-kind="kind" ...>...</div>`,
 *  up to (not including) the next row's opening tag or the end of the
 *  string. Assumes at most one row of `kind` in the fixture set used by a
 *  given test (true for every test below) and no `data-activity-kind=`
 *  marker nested inside a row's own children (true for this component's
 *  flat row markup). */
function rowSlice(html: string, kind: string): string {
  const marker = `data-activity-kind="${kind}"`;
  const markerStart = html.indexOf(marker);
  if (markerStart === -1) return '';
  const rowStart = html.lastIndexOf('<div', markerStart);
  const nextMarkerIdx = html.indexOf('data-activity-kind="', markerStart + marker.length);
  const rowEnd = nextMarkerIdx === -1 ? html.length : html.lastIndexOf('<div', nextMarkerIdx);
  return html.slice(rowStart, rowEnd === -1 ? html.length : rowEnd);
}

// ---------------------------------------------------------------------------
// Root drawer contract
// ---------------------------------------------------------------------------

test('root: data-component="activity-drawer" and data-activity-count reflect the derived row count', () => {
  const html = render();
  expect(html).toContain('data-component="activity-drawer"');
  expect(html).toContain(`data-activity-count="${ALL_EVENTS.length}"`);
});

test('root: data-activity-count="0" for an empty event list, and the honest empty-state row', () => {
  const html = render({ events: [] });
  expect(html).toContain('data-activity-count="0"');
  expect(html).toContain('Waiting for activity');
});

test('data-drawer-open: defaultOpen=true renders data-drawer-open="true"; defaultOpen=false renders "false" — both reachable without simulating a click', () => {
  expect(render({ defaultOpen: true })).toContain('data-drawer-open="true"');
  expect(render({ defaultOpen: false })).toContain('data-drawer-open="false"');
});

// ---------------------------------------------------------------------------
// The three data-action values
// ---------------------------------------------------------------------------

test('data-action="toggle-activity-drawer": present in BOTH open and collapsed states (it is what flips between them)', () => {
  expect(render({ defaultOpen: true })).toContain('data-action="toggle-activity-drawer"');
  expect(render({ defaultOpen: false })).toContain('data-action="toggle-activity-drawer"');
});

test('data-action="expand-all-thinking": present when open with at least one clampable row', () => {
  const html = render({ defaultOpen: true });
  expect(html).toContain('data-action="expand-all-thinking"');
});

test('data-action="expand-all-thinking": absent while collapsed — nothing to expand-all when the row list is not even shown', () => {
  const html = render({ defaultOpen: false });
  expect(html).not.toContain('data-action="expand-all-thinking"');
});

test('data-action="expand-all-thinking": absent when there are no clampable rows at all — kills a bare always-render', () => {
  const html = render({ events: [TOOL_EVENT], defaultOpen: true });
  expect(html).not.toContain('data-action="expand-all-thinking"');
});

test('data-action="expand-activity-row": present on a clampable row, absent on a non-clampable row', () => {
  const html = render({ defaultOpen: true });
  expect(rowSlice(html, 'thinking')).toContain('data-action="expand-activity-row"');
  expect(rowSlice(html, 'tool')).not.toContain('data-action="expand-activity-row"');
});

// ---------------------------------------------------------------------------
// Per-row data-activity-kind fixtures
// ---------------------------------------------------------------------------

test('tool row: data-activity-kind="tool" carries the tool name + full (never-clamped) input summary', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'tool');
  expect(row).toContain('Read');
  expect(row).toContain('src/foo.ts');
  expect(row).not.toContain('data-action="expand-activity-row"');
});

test('tool-coalesced row: data-activity-kind="tool-coalesced" summarises coalesced_count/sampled_out_count', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'tool-coalesced');
  expect(row).toContain('12 coalesced');
  expect(row).toContain('30 sampled out');
});

test('thinking row: data-activity-kind="thinking" clamped with data-activity-expanded="false" initially and the "+N chars" label', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'thinking');
  expect(row).toContain('data-action="expand-activity-row"');
  expect(row).toContain('data-activity-expanded="false"');
  expect(row).toContain('+50 chars');
});

test('reasoning row: data-activity-kind="reasoning" gets the SAME clamp treatment as thinking', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'reasoning');
  expect(row).toContain('data-action="expand-activity-row"');
  expect(row).toContain('data-activity-expanded="false"');
  expect(row).toContain('+30 chars');
});

test('redacted row: data-activity-kind="thinking-redacted" renders the literal marker verbatim, never clamped', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'thinking-redacted');
  expect(row).toContain('[thinking redacted]');
  expect(row).not.toContain('data-action="expand-activity-row"');
});

test('cap-marker row: data-activity-kind="capped" renders the literal per-sink cap message verbatim, never clamped', () => {
  const html = render({ defaultOpen: true });
  const row = rowSlice(html, 'capped');
  expect(row).toContain('[thinking capped after 300 rows]');
  expect(row).not.toContain('data-action="expand-activity-row"');
});

// ---------------------------------------------------------------------------
// Phase chip + collapsed last-line components
// ---------------------------------------------------------------------------

test('phase chip: [data-component="activity-phase-chip"][data-phase-active] rendered only when phaseLabel is given, active mirrors phaseActive', () => {
  const active = render({ phaseLabel: 'interviewing', phaseActive: true });
  expect(active).toContain('data-component="activity-phase-chip"');
  expect(active).toContain('data-phase-active="true"');
  expect(active).toContain('interviewing');

  const inactive = render({ phaseLabel: 'awaiting-verdict', phaseActive: false });
  expect(inactive).toContain('data-phase-active="false"');
});

test('phase chip: omitted entirely when no phaseLabel prop is given — never a fabricated chip', () => {
  const html = render({ phaseLabel: undefined });
  expect(html).not.toContain('data-component="activity-phase-chip"');
});

test('collapsed state: [data-component="activity-last-line"] renders INSTEAD of the row list', () => {
  const html = render({ defaultOpen: false });
  expect(html).toContain('data-component="activity-last-line"');
  expect(html).not.toContain('data-activity-kind="tool"');
});

test('open state: [data-component="activity-last-line"] is absent — the row list is shown instead', () => {
  const html = render({ defaultOpen: true });
  expect(html).not.toContain('data-component="activity-last-line"');
  expect(html).toContain('data-activity-kind="tool"');
});
