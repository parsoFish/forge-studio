/**
 * yaml-preview-render.test.ts — agents-15: the Definition Preview
 * (`components/studio/agent-builder/YamlPreview.tsx`) rendered catalog
 * display names for slug/name/purpose/composition(5)/materials/process/
 * interactivity/runtime/brainAccess and silently omitted `phase`, `fanout`,
 * `allowed-tools` and `disallowed-tools`, so an operator reading "Definition
 * Preview" before Save had no way to know those fields even existed, let
 * alone what would be written for them. THE FIX: the preview now renders
 * `buildAgentPreviewModel`'s output (agent-authoring-view.ts) — the SAME
 * object built by spreading the real save-path serializer
 * (`buildAgentPutBody`) plus the read-only pass-through fields — instead of
 * individually hand-passed props, so a field missing from the preview can
 * only mean it is missing from the model, never a second hand-maintained
 * prop list drifting from it.
 *
 * FOLLOW-UP (agents-15, forge-6gv.5.1): the finding also named
 * `description`/`library`/`surface`/`executor`/`budgets` as omitted —
 * `Agent` (lib/studio-client.ts) never parsed them off the wire at all, and
 * that file was pinned at its 800-line file-size ratchet ceiling
 * (2540/2540). The wire type + parser moved to `lib/agent-wire.ts`
 * (`check-file-size.mjs` fails on ANY growth of a baselined file, so this
 * needed room made first, not a line squeezed into the old file), and now
 * parses all five. This suite covers them below, same discipline as the
 * four fields above: read straight off `buildAgentPreviewModel`'s output,
 * no second hand-maintained field list.
 *
 * Render harness matches apps/studio/tests/integration/run-panel-render.test.ts's
 * precedent: `renderToStaticMarkup` over `createElement`, no jsdom.
 *
 * RUN: cd apps/studio && npx vitest run apps/studio/tests/integration/yaml-preview-render.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { YamlPreview } from '@/components/studio/agent-builder/YamlPreview';
import { buildAgentPreviewModel, type AgentBuilderState } from '@/lib/agent-authoring-view';
import type { Catalog } from '@/lib/studio-client';

const CATALOG: Catalog = {};

function fullState(): AgentBuilderState {
  return {
    slug: 'contract-check',
    name: 'Contract Check',
    purpose: 'Declare the onboard-preflight band guard.',
    skills: [],
    tools: [],
    mcps: [],
    guards: ['event-log', 'onboard-preflight'],
    hooks: [],
    process: 'Body text.',
    interactivity: 'Never runs on the flow path.',
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-haiku-4-5-20251001', range: [] },
    brainAccess: 'advisory',
    materials: [],
    allowedTools: ['Read'],
    disallowedTools: ['Bash', 'Task'],
    phase: 'contract-check-phase',
    costCeilingEnforceable: false,
    fanout: { drivingArtifact: 'work-items', isolation: 'per-item-worktree', concurrencyCap: 3 },
    // agents-15 (forge-6gv.5.1): the five fields Agent never parsed off the
    // wire before the agent-wire.ts split — distinct text from `purpose`
    // above so a match on one can't accidentally pass on the other.
    description: 'Reusable contract-check guard for onboarding flows.',
    library: true,
    surface: 'flow-node',
    executor: 'unifier',
    budgets: { maxBudgetUsd: 12.5, maxTurns: 40 },
  };
}

function render(state: AgentBuilderState): string {
  const model = buildAgentPreviewModel(state);
  return renderToStaticMarkup(
    React.createElement(YamlPreview, { definition: model, catalog: CATALOG }),
  );
}

test('THE DEFECT: phase, fanout, allowed-tools and disallowed-tools all appear in the preview', () => {
  const html = render(fullState());
  // phase
  expect(html).toMatch(/contract-check-phase/);
  // fanout
  expect(html).toMatch(/work-items/);
  expect(html).toMatch(/per-item-worktree/);
  // allowed-tools / disallowed-tools
  expect(html).toMatch(/allowed-tools/);
  expect(html).toMatch(/disallowed-tools/);
  expect(html).toMatch(/\bRead\b/);
  expect(html).toMatch(/\bBash\b/);
  expect(html).toMatch(/\bTask\b/);
});

test('agents-15 (forge-6gv.5.1): description, library, surface, executor and budgets all appear in the preview', () => {
  const html = render(fullState());
  expect(html).toMatch(/Reusable contract-check guard for onboarding flows\./);
  expect(html).toMatch(/library:<\/span> <span class="yaml-val">true/);
  expect(html).toMatch(/surface:<\/span> <span class="yaml-val">flow-node/);
  expect(html).toMatch(/executor:<\/span> <span class="yaml-val">unifier/);
  expect(html).toMatch(/maxBudgetUsd/);
  expect(html).toMatch(/12\.5/);
  expect(html).toMatch(/maxTurns/);
  expect(html).toMatch(/\b40\b/);
});

test('description/library/surface/executor/budgets absent from the definition are not fabricated', () => {
  const bare: AgentBuilderState = {
    ...fullState(),
    description: '',
    library: undefined,
    surface: '',
    executor: '',
    budgets: undefined,
  };
  const html = render(bare);
  expect(html).not.toMatch(/Reusable contract-check guard for onboarding flows\./);
  expect(html).not.toMatch(/yaml-key">library:/);
  expect(html).not.toMatch(/yaml-key">surface:/);
  expect(html).not.toMatch(/yaml-key">executor:/);
  expect(html).not.toMatch(/maxBudgetUsd/);
});

test('fields absent from the definition are not fabricated (a bare agent renders no fanout block, no phase row)', () => {
  const bare: AgentBuilderState = { ...fullState(), fanout: undefined, phase: '' };
  const html = render(bare);
  expect(html).not.toMatch(/work-items/);
  expect(html).not.toMatch(/per-item-worktree/);
  expect(html).not.toMatch(/contract-check-phase/);
});

test('derives the preview from the REAL save-path serializer: a value only buildAgentPutBody would send (allowedTools) shows up automatically', () => {
  const state = fullState();
  const model = buildAgentPreviewModel(state);
  expect(model['allowedTools']).toEqual(state.allowedTools);
  expect(model['disallowedTools']).toEqual(state.disallowedTools);
});
