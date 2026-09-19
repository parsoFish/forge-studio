/**
 * forge-8vfn.5.12 (bead, 1st open acceptance criterion) — a flow's bound
 * knowledge base was persisted (`flow.yaml` carries `kb: gitpulse`) but
 * mirrored to NO `data-*` anywhere on the flow builder page: a story could
 * open the Advanced panel and read `[data-field="kb-select"]`'s CURRENT
 * value, but that is the operator's LOCAL edit, not a fact about what is on
 * disk — selecting a different kb in the dropdown (never saved) would flip
 * it, which is exactly the shape this bead forbids ("not only the input's
 * local state").
 *
 * `FlowHeader` already derives one other fact this same way — the launch
 * surface badge (`data-kickoff-kind`, T1 ruling 167): fall back to the
 * flow's entry in the ALREADY-FETCHED roster (the `flows` prop, itself
 * `fetchStudioFlows()` — a persisted read, independent of `state`) until a
 * save in this mount reports a fresher answer. `data-flow-kb` follows the
 * identical shape, on the SAME root the kickoff badge and `data-goal-set`
 * already publish from (`[data-component="flow-header"]`) — one stable
 * element, not a second copy of the fact.
 *
 * The empty/unbound value is `''`, never absent — the same ratified shape
 * the DOM contract already uses for "no id yet" (rulings 409/422/436/438:
 * "'' before the mint, the id after, NEVER absent" — an observer that reads
 * `data-*` in one pass cannot tell "no key" from "not yet"), and it matches
 * the kb-select's OWN unbound sentinel (`<option value="">— none —</option>`,
 * KbSelector.tsx / FlowHeader.tsx:469) rather than inventing a second one.
 *
 * Renders the REAL `FlowHeader` via `react-dom/server` — no jsdom in this
 * repo (see ../contract/flow-header-render.test.ts's header), so the
 * "updates immediately after a successful save" half of this behaviour
 * (`setSavedKb` in the save-wrapper) is implemented but not directly
 * click-tested here — the same limitation `data-kickoff-kind`'s own
 * post-save transition already has in this suite.
 *
 * Pinned RED at branch base.
 * RUN: npx vitest run --root apps/studio tests/regression/flow-header-persisted-kb.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowHeader, type FlowHeaderState } from '@/components/studio/flow-builder/FlowHeader';
import type { Flow } from '@/lib/studio-client';

function baseState(overrides: Partial<FlowHeaderState> = {}): FlowHeaderState {
  return { name: 'Story Flow', goal: 'Ship it.', project: '', kb: '', triggers: [], ...overrides };
}

function renderHeader(flows: Flow[], state: FlowHeaderState, flowId = 'story-flow'): string {
  return renderToStaticMarkup(
    React.createElement(FlowHeader, {
      flowId,
      state,
      onChange: () => {},
      onSave: async () => ({ ok: true as const }),
      flows,
      onFlowSelect: () => {},
    }),
  );
}

test('data-flow-kb reflects the roster\'s PERSISTED kb, not the select\'s local (unsaved) edit', () => {
  const flows: Flow[] = [
    { id: 'story-flow', name: 'Story Flow', goal: '', kb: 'gitpulse', nodes: [], edges: [], triggers: [] },
  ];
  // The operator has picked a DIFFERENT kb in the dropdown but not saved —
  // `state.kb` disagrees with the persisted roster entry on purpose.
  const html = renderHeader(flows, baseState({ kb: 'forge-dev' }));

  expect(html).toContain('data-flow-kb="gitpulse"');
  // The local edit must not leak onto the persisted-fact attribute.
  expect(html).not.toContain('data-flow-kb="forge-dev"');
});

test('data-flow-kb is an explicit empty string when the flow has no bound kb — never absent', () => {
  const flows: Flow[] = [
    { id: 'story-flow', name: 'Story Flow', goal: '', nodes: [], edges: [], triggers: [] }, // no `kb`
  ];
  const html = renderHeader(flows, baseState({ kb: '' }));

  expect(html).toContain('data-component="flow-header"');
  expect(html).toContain('data-flow-kb=""');
});

test('data-flow-kb is "" for a brand-new flow not yet in the roster at all', () => {
  const html = renderHeader([], baseState(), 'new');
  expect(html).toContain('data-flow-kb=""');
});
