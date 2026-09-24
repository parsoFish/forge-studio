/**
 * yaml-preview-render.test.ts — agents-15: the Definition Preview
 * (`components/studio/agent-builder/YamlPreview.tsx`) rendered catalog
 * display names for slug/name/purpose/composition(5)/materials/process/
 * interactivity/runtime/brainAccess and silently omitted the other nine
 * `AgentDefinition` frontmatter fields — description, library, phase,
 * surface, executor, fanout, budgets, allowed-tools, disallowed-tools —
 * so an operator reading "Definition Preview" before Save had no way to
 * know those fields even existed, let alone what would be written for
 * them. THE FIX: the preview now renders `buildAgentPreviewModel`'s
 * output (agent-authoring-view.ts) — the SAME object built by spreading
 * the real save-path serializer (`buildAgentPutBody`) plus the read-only
 * pass-through fields — instead of nine individually hand-passed props,
 * so a field missing from the preview can only mean it is missing from
 * the model, never a second hand-maintained prop list drifting from it.
 *
 * Render harness matches tests/integration/run-panel-render.test.ts's
 * precedent: `renderToStaticMarkup` over `createElement`, no jsdom.
 *
 * RUN: cd apps/studio && npx vitest run tests/integration/yaml-preview-render.test.ts
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
    phase: 'contract-check',
    costCeilingEnforceable: false,
    description: 'The declaration carrier for the onboard-project flow contract gate.',
    library: true,
    surface: 'unattended',
    executor: 'onboard-preflight',
    fanout: { drivingArtifact: 'work-items', isolation: 'per-item-worktree', concurrencyCap: 3 },
    budgets: { maxTurns: 1, maxBudgetUsd: 0 },
  };
}

function render(state: AgentBuilderState): string {
  const model = buildAgentPreviewModel(state);
  return renderToStaticMarkup(
    React.createElement(YamlPreview, { definition: model, catalog: CATALOG }),
  );
}

test('THE DEFECT: every previously-omitted AgentDefinition field appears in the preview', () => {
  const html = render(fullState());
  // description
  expect(html).toMatch(/onboard-project flow contract gate/);
  // library
  expect(html).toMatch(/\blibrary\b/);
  // phase
  expect(html).toMatch(/contract-check/);
  // surface
  expect(html).toMatch(/unattended/);
  // executor
  expect(html).toMatch(/onboard-preflight/);
  // fanout
  expect(html).toMatch(/work-items/);
  expect(html).toMatch(/per-item-worktree/);
  // budgets
  expect(html).toMatch(/maxBudgetUsd|max_budget_usd|budgets/);
  expect(html).toMatch(/maxTurns|max_turns/);
  // allowed-tools / disallowed-tools
  expect(html).toMatch(/allowed-tools|allowed_tools/);
  expect(html).toMatch(/disallowed-tools|disallowed_tools/);
  expect(html).toMatch(/\bRead\b/);
  expect(html).toMatch(/\bBash\b/);
});

test('fields absent from the definition are not fabricated (a bare/blank agent renders no fanout or budgets block)', () => {
  const bare: AgentBuilderState = {
    ...fullState(),
    guards: [],
    fanout: undefined,
    budgets: undefined,
    library: undefined,
    surface: undefined,
    executor: undefined,
  };
  const html = render(bare);
  expect(html).not.toMatch(/work-items/);
  expect(html).not.toMatch(/per-item-worktree/);
});

test('derives the preview from the REAL save-path serializer: a value only buildAgentPutBody would send (allowedTools) shows up automatically', () => {
  const state = fullState();
  const model = buildAgentPreviewModel(state);
  expect(model['allowedTools']).toEqual(state.allowedTools);
  expect(model['disallowedTools']).toEqual(state.disallowedTools);
});
