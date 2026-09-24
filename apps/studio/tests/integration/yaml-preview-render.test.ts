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
 * SCOPE NOTE: the finding also named `description`/`library`/`surface`/
 * `executor`/`budgets` as omitted. Those five stay omitted here too —
 * `Agent` (lib/studio-client.ts) never parses them off the wire at all, and
 * that file is pinned at its 800-line file-size ratchet ceiling
 * (`scripts/baselines/file-size.json`: 2540/2540 — `check-file-size.mjs`
 * fails on ANY growth of a baselined file). Wiring them through needs that
 * file split first, a separate initiative; this fix covers the four fields
 * reachable without touching studio-client.ts (see final report).
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
    phase: 'contract-check-phase',
    costCeilingEnforceable: false,
    fanout: { drivingArtifact: 'work-items', isolation: 'per-item-worktree', concurrencyCap: 3 },
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
