/**
 * W7-B5 render pins — the DOM contracts this lane adds across the agents +
 * runs surfaces, via `renderToStaticMarkup` (the repo's established no-jsdom
 * pattern; interaction behaviour lives in the pure-logic suites —
 * agent-dispatch.test.ts, agents-index.test.ts, run-view-client.test.ts).
 *
 * Pins, by finding:
 *   - agents-21: the Run control STATES the ceiling in force
 *     (`data-run-ceiling` + "$N cap" text) and a ralph agent's panel is
 *     blocked with the honest reason (`data-component="standalone-blocked"`).
 *   - agents-36: the connection-block message gains links to
 *     /connections/<id> (`data-action="fix-connection"`), while the verbatim
 *     message contract is untouched.
 *   - agents-04/32: HistoryLedger's optional agent chip
 *     (`data-ledger-agent`), paging (`data-ledger-shown` +
 *     `data-action="ledger-show-more"`) and status filter
 *     (`data-ledger-filter`) — each byte-identical-when-absent (the D8
 *     discipline), pinned by rendering the same rows with and without the
 *     new inputs.
 *   - agents-40: the recent-agent-runs section publishes data-count +
 *     data-limit and a `data-action="recent-runs-show-all"` affordance.
 *   - agents-13: ReadinessPanel rows carry `data-ok` + accessible pass/fail
 *     text.
 *   - agents-17/41: RuntimePicker segments share the `data-active`
 *     convention and the option-card groups are real radiogroups.
 *   - sessions-kinds-34: StageSelector renders one tab per declared stage
 *     with the selected one marked.
 *   - projects-31: OnboardWithAgent renders the brief inputs.
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunPanel } from '@/components/studio/agent-builder/RunPanel';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { AgentsIndexView } from '@/components/studio/AgentsIndexView';
import { ReadinessPanel } from '@/components/studio/agent-builder/ReadinessPanel';
import { RuntimePicker } from '@/components/studio/agent-builder/RuntimePicker';
import { StageSelector } from '@/components/studio/session/StageSelector';
import { OnboardWithAgent } from '@/components/studio/project-builder/OnboardWithAgent';
import type { LedgerRow } from '@/lib/history-ledger';

/* eslint-disable @typescript-eslint/no-explicit-any */
function render(component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(component as any, props));
}

/** A safe window of html around the FIRST occurrence of `marker` — clamped
 *  so a marker near the start never produces a negative-start slice. */
function windowAround(html: string, marker: string, before = 300, after = 200): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  return html.slice(Math.max(0, idx - before), idx + marker.length + after);
}

/** The smallest `<tag ...>` open-tag substring containing `marker` — exact
 *  attribute scoping for one element (mirrors run-panel-render.test.ts's
 *  own `tagContaining`). */
function openTagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// RunPanel — ceiling on the Run control, ralph block, connection links
// ---------------------------------------------------------------------------

function runPanelProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'test-agent',
    interactive: false,
    canRun: true,
    blockedMessage: '',
    projects: [],
    declaredMaterialKinds: [],
    defaultCostCeilingUsd: 10,
    costCeilingEnforceable: true,
    sessionEntryHref: null,
    ...overrides,
  };
}

test('agents-21: the Run control states the ceiling that will be in force — data-run-ceiling + "$N cap" text', () => {
  const html = render(RunPanel, runPanelProps({ defaultCostCeilingUsd: 7.5 }));
  expect(html).toContain('data-run-ceiling="7.5"');
  expect(html).toContain('Run agent ($7.5 cap)');
});

test('agents-21: an unenforceable ceiling renders the honest "no cost cap" wording, never a fabricated cap', () => {
  const html = render(RunPanel, runPanelProps({ costCeilingEnforceable: false }));
  expect(html).toContain('Run agent (no cost cap)');
  expect(html).toContain('data-run-ceiling=""');
});

test('agents-21: a ralph agent is blocked with the honest reason and the Run control is disabled', () => {
  const html = render(RunPanel, runPanelProps({
    standaloneBlockedReason: 'This agent is a multi-iteration (ralph) loop — it runs inside the develop flow, never as a standalone dispatch. Start it through its flow instead.',
  }));
  expect(html).toContain('data-component="standalone-blocked"');
  expect(html).toContain('multi-iteration (ralph) loop');
  const btn = windowAround(html, 'data-action="run-agent"', 200, 200);
  expect(btn).toContain('disabled');
});

test('agents-36: the connection-block message keeps its verbatim contract AND gains fix links to /connections/<id>', () => {
  const html = render(RunPanel, runPanelProps({
    blockedMessage: 'Run blocked — not ready: mcp "filesystem" (not-installed)',
    unreadyConnectionIds: ['filesystem'],
  }));
  expect(html).toContain('Run blocked — not ready: mcp &quot;filesystem&quot; (not-installed)');
  expect(html).toContain('data-component="connection-run-block-links"');
  expect(html).toContain('data-action="fix-connection"');
  expect(html).toContain('href="/connections/filesystem"');
});

// ---------------------------------------------------------------------------
// HistoryLedger — agent chip / paging / filter, byte-identical when absent
// ---------------------------------------------------------------------------

function ledgerRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'RUN-a',
    when: '2026-08-01T00:00:00Z',
    what: 'Ship the ledger',
    narrative: null,
    narrativeKinds: [],
    status: 'complete',
    costUsd: 1.5,
    href: '/flows/f/run/RUN-a',
    ...over,
  };
}

const NOW = Date.parse('2026-08-02T00:00:00Z');

test('agents-04: a row carrying `agent` renders the attribution chip + data-ledger-agent', () => {
  const html = render(HistoryLedger, { rows: [ledgerRow({ agent: 'architect, project-manager' })], nowMs: NOW });
  expect(html).toContain('data-ledger-agent="architect, project-manager"');
  expect(html).toContain('data-ledger-agent-badge');
  expect(html).toContain('architect, project-manager');
});

test('D8 byte-parity: legacy rows with NO new props/fields render byte-identically to the pre-B5 contract surface (no filter, no paging, no agent chip, legacy scroller)', () => {
  const html = render(HistoryLedger, { rows: [ledgerRow()], nowMs: NOW });
  expect(html).not.toContain('data-ledger-filter');
  expect(html).not.toContain('data-ledger-shown');
  expect(html).not.toContain('data-action="ledger-show-more"');
  expect(html).not.toContain('data-ledger-agent');
  expect(html).toContain('max-height:220px');
});

test('agents-32: pageSize renders only the first N rows + a show-more control + data-ledger-shown, and drops the fixed-height scroller', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ledgerRow({ id: `RUN-${i}`, href: `/flows/f/run/RUN-${i}` }));
  const html = render(HistoryLedger, { rows, nowMs: NOW, pageSize: 3 });
  expect(html).toContain('data-ledger-count="7"');
  expect(html).toContain('data-ledger-shown="3"');
  expect(html.split('data-ledger-row="true"').length - 1).toBe(3);
  expect(html).toContain('data-action="ledger-show-more"');
  expect(html).toContain('Show more (4 more)');
  expect(html).not.toContain('max-height:220px');
});

test('agents-32: filterable renders the status filter with the DISTINCT statuses actually present, each vocabulary verbatim (D12 — never a mapped shared vocabulary)', () => {
  const rows = [
    ledgerRow({ id: 'a', status: 'complete' }),
    ledgerRow({ id: 'b', status: 'exploring' }),
    ledgerRow({ id: 'c', status: 'budget-exceeded' }),
    ledgerRow({ id: 'd', status: 'complete' }),
  ];
  const html = render(HistoryLedger, { rows, nowMs: NOW, filterable: true });
  expect(html).toContain('data-ledger-filter');
  expect(html).toContain('>all (4)</option>');
  expect(html).toContain('>complete</option>');
  expect(html).toContain('>exploring</option>');
  expect(html).toContain('>budget-exceeded</option>');
  // Distinct — 'complete' appears once as an option.
  expect(html.split('>complete</option>').length - 1).toBe(1);
});

// ---------------------------------------------------------------------------
// AgentsIndexView — section count/limit + show-all (agents-40)
// ---------------------------------------------------------------------------

test('agents-40: the recent-agent-runs section publishes data-count + data-limit and the show-all affordance', () => {
  const html = render(AgentsIndexView, {
    ready: true,
    agents: [],
    recentRunsReady: true,
    recentRuns: [ledgerRow()],
    nowMs: NOW,
    recentRunsLimit: 20,
    onShowAllRecentRuns: () => {},
  });
  const section = windowAround(html, 'data-section="recent-agent-runs"', 200, 300);
  expect(section).toContain('data-count="1"');
  expect(section).toContain('data-limit="20"');
  expect(html).toContain('data-action="recent-runs-show-all"');
});

test('agents-40: already expanded (onShowAllRecentRuns null) renders no show-all affordance', () => {
  const html = render(AgentsIndexView, {
    ready: true,
    agents: [],
    recentRunsReady: true,
    recentRuns: [],
    nowMs: NOW,
    recentRunsLimit: 100,
    onShowAllRecentRuns: null,
  });
  expect(html).not.toContain('data-action="recent-runs-show-all"');
});

// ---------------------------------------------------------------------------
// ReadinessPanel — data-ok + accessible pass/fail text (agents-13)
// ---------------------------------------------------------------------------

test('agents-13: each readiness row carries data-ok and an aria-label naming the outcome — pass/fail is data + text, not only a CSS class', () => {
  const html = render(ReadinessPanel, {
    state: {
      purpose: 'exists',
      skills: ['brain-query'],
      guards: [],
      process: 'described',
      interactivity: 'described',
      capability: { interactive: false, runtimeSdks: ['claude'], fanoutCapable: false },
    },
  });
  expect(html).toContain('data-check="purpose" data-ok="true"');
  expect(html).toContain('data-check="guard" data-ok="false"');
  expect(html).toContain('aria-label="Purpose defined: passed"');
  expect(html).toContain('aria-label="Observability guard attached: not met"');
  // The title always states the outcome, not only for the connections check.
  expect(html).toContain('Observability guard attached — not met');
});

// ---------------------------------------------------------------------------
// RuntimePicker — data-active convention + radio roles (agents-17/41)
// ---------------------------------------------------------------------------

const CATALOG = {
  sdks: [{ id: 'claude', name: 'Claude Agent SDK', vendor: 'Anthropic', available: true }],
  models: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', sdk: 'claude', tier: 'worker' }],
};

test('agents-17: the Fixed/Range strategy segments expose data-active like the loop-strategy segments (one convention)', () => {
  const html = render(RuntimePicker, {
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
    brainAccess: 'none',
    catalog: CATALOG,
    onRuntimeChange: () => {},
    onBrainAccessChange: () => {},
    onToast: () => {},
  });
  const fixedTag = openTagContaining(html, 'id="seg-fixed"');
  expect(fixedTag).toContain('data-active="true"');
  const rangeTag = openTagContaining(html, 'id="seg-range"');
  expect(rangeTag).not.toContain('data-active');
});

test('agents-41: brain options are role=radio with aria-checked inside a radiogroup; sdk cards and model chips carry roles + checked state', () => {
  const html = render(RuntimePicker, {
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
    brainAccess: 'advisory',
    catalog: CATALOG,
    onRuntimeChange: () => {},
    onBrainAccessChange: () => {},
    onToast: () => {},
  });
  expect(html).toContain('role="radiogroup" aria-label="Knowledge access"');
  const advisory = windowAround(html, 'data-access="advisory"');
  expect(advisory).toContain('role="radio"');
  expect(advisory).toContain('aria-checked="true"');
  const mandatory = windowAround(html, 'data-access="mandatory"');
  expect(mandatory).toContain('aria-checked="false"');
  const sdkCard = windowAround(html, 'data-sdk-id="claude"');
  expect(sdkCard).toContain('role="radio"');
  const chip = windowAround(html, 'data-model-id="claude-sonnet-4-6"');
  expect(chip).toContain('role="checkbox"');
  expect(chip).toContain('aria-checked="true"');
});

// ---------------------------------------------------------------------------
// StageSelector (sessions-kinds-34)
// ---------------------------------------------------------------------------

test('sessions-kinds-34: one tab per declared stage, in declared order, selected one marked data-active + aria-selected', () => {
  const html = render(StageSelector, {
    stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    selectedStage: 'secrets',
    onSelect: () => {},
  });
  expect(html).toContain('data-component="stage-selector"');
  expect(html.split('data-action="select-stage"').length - 1).toBe(5);
  const secrets = windowAround(html, 'data-stage="secrets"');
  expect(secrets).toContain('aria-selected="true"');
  expect(secrets).toContain('data-active="true"');
  const contract = windowAround(html, 'data-stage="contract"');
  expect(contract).toContain('aria-selected="false"');
  // Declared order preserved.
  expect(html.indexOf('data-stage="contract"')).toBeLessThan(html.indexOf('data-stage="roadmap"'));
});

// ---------------------------------------------------------------------------
// OnboardWithAgent — the brief inputs exist (projects-31)
// ---------------------------------------------------------------------------

test('projects-31: the onboarding panel renders the optional brief inputs (northStar / gateCommand / constraints)', () => {
  const html = render(OnboardWithAgent, { projectId: 'gitpulse' });
  expect(html).toContain('data-section="onboard-brief"');
  expect(html).toContain('data-onboard-input="northStar"');
  expect(html).toContain('data-onboard-input="gateCommand"');
  expect(html).toContain('data-onboard-input="constraints"');
  // The pre-existing journey contract survives.
  expect(html).toContain('data-action="run-onboarding-agent"');
  expect(html).toContain('data-onboard-run-status="idle"');
});

// ---------------------------------------------------------------------------
// RunPanel — every hook sits ABOVE the `interactive` early return
// ---------------------------------------------------------------------------

/**
 * REGRESSION PIN (W7-B5 review round 1). The cancel state (`cancelArmed` /
 * `cancelBusy`) was first written next to the `onCancel` handler that reads
 * it — which is BELOW `if (interactive) { return … }`. `interactive` is not a
 * constant: `app/agents/[id]/page.tsx` passes
 * `state.capability?.interactive === true`, which is `false` until the async
 * agent fetch resolves and changes again whenever the operator picks a
 * different agent. When it flipped true on an already-mounted panel, React
 * saw 11 hooks where the previous render had 13 and threw error #300
 * ("Rendered fewer hooks than expected"), unmounting the whole builder page.
 * The walkthrough gate caught it live on `/agents/community-refresh`
 * (`never-ready` + a console `pageerror`) — no unit test could, since this
 * repo renders with `renderToStaticMarkup` and has no jsdom/re-render
 * harness (adding one is a dependency decision, not this lane's call).
 *
 * So the pin is structural, over the source itself: inside `RunPanel`'s own
 * function body, no hook call may appear after the early return. That is
 * exactly the Rules-of-Hooks invariant the crash violated, and it reds the
 * moment someone re-adds a hook down beside its handler again.
 */
test('agents-30 REGRESSION: every hook in RunPanel is called ABOVE the `interactive` early return (React error #300 class)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'components', 'studio', 'agent-builder', 'RunPanel.tsx'), 'utf8');
  const lines = src.split('\n');

  const start = lines.findIndex((l) => l.startsWith('export function RunPanel('));
  expect(start, 'RunPanel must be declared as `export function RunPanel(` for this scan to be meaningful').toBeGreaterThan(-1);

  // The component body ends where its brace depth returns to 0.
  let depth = 0;
  let end = lines.length - 1;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
    if (i > start && depth <= 0) { end = i; break; }
  }

  const guard = lines.findIndex((l, i) => i > start && i < end && /^ {2}if \(interactive\) \{/.test(l));
  expect(guard, 'the `if (interactive) {` early return must still exist — this pin is about what may follow it').toBeGreaterThan(-1);

  const HOOK = /(?:^|[^.\w])(use[A-Z]\w*)\s*\(/;
  const offenders: string[] = [];
  for (let i = guard; i < end; i++) {
    const m = lines[i].match(HOOK);
    if (m) offenders.push(`RunPanel.tsx:${i + 1}  ${m[1]}(  →  ${lines[i].trim().slice(0, 80)}`);
  }
  expect(
    offenders,
    'A React hook is called after RunPanel\'s `if (interactive)` early return. When `interactive` flips true on a '
    + 'mounted panel the render takes that return and calls FEWER hooks than the previous render — React error #300, '
    + 'which unmounts the agent builder. Move the hook up with the others, above the guard.',
  ).toEqual([]);
});
