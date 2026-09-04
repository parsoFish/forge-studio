/**
 * The BUILD tab tells the operator how the flow they are building will be
 * launched (T1 ruling 167, bead `forge-8vfn.6.11.1`).
 *
 * THE DEFECT BEHIND IT. `kickoff` was a hand-written YAML field the builder
 * neither wrote nor showed, so a flow assembled in Studio always rendered
 * `data-kickoff-kind="generic"` on its monitor and could not be launched from
 * an idea however it was built (S4 beat 8). The kind is now DERIVED at save,
 * in `@forge/flows`, from the flow's head station.
 *
 * WHY THIS TEST IS ABOUT ABSENCE AS MUCH AS PRESENCE. `apps/studio` imports
 * contracts only (`docs/roadmaps/1.0.md` §0), so the builder structurally
 * cannot re-derive the kind — it renders what the server decided. A control
 * that let the operator SET it would be a second source of truth for the same
 * fact, which is `flows-25` all over again (`canStartFlow` as a second
 * enumeration of which kinds launch). So the row is asserted read-only:
 * no input, no select, no action.
 *
 * Renders the REAL `FlowHeader` with `react-dom/server` — the convention of
 * `flow-kickoff-render.test.ts` beside it.
 */
import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowHeader, type FlowHeaderState } from '../components/studio/flow-builder/FlowHeader.tsx';
import { KICKOFF_SURFACES, kickoffSurfaceIdOfKind } from './kickoff-surface.ts';

const STATE: FlowHeaderState = { name: 'Story Flow', goal: 'Ship it.', project: '', kb: '', triggers: [] };

/** The kickoff kind that produces each surface id (`generic` = no kickoff block). */
const KIND_FOR_SURFACE: Record<string, string | null> = {
  idea: 'idea',
  'initiative-select': 'initiative-select',
  'trigger-only': 'trigger-only',
  generic: null,
};

/**
 * Renders the header for a flow whose SAVED definition carries `kind`. The
 * kind reaches the header the way it does in the product — off the flow list
 * the header already receives — rather than through a prop invented for the
 * test, so a wiring that only works in this file cannot pass.
 *
 * FlowHeader holds hooks, so it is rendered as an ELEMENT (React installs its
 * dispatcher only for a real render) rather than called.
 */
function renderHeader(kind: string | null): string {
  const flow = {
    id: 'story-flow',
    name: 'Story Flow',
    goal: 'Ship it.',
    nodes: [],
    edges: [],
    triggers: [],
    ...(kind === null ? {} : { kickoff: { kind } }),
  };
  return renderToStaticMarkup(
    createElement(FlowHeader, {
      flowId: 'story-flow',
      state: STATE,
      onChange: () => {},
      onSave: async () => ({ ok: true, version: 2 }),
      flows: [flow] as never,
      onFlowSelect: () => {},
    }),
  );
}

test('the builder names the launch surface the save derived — one row per kind, no kind unnamed', () => {
  const ids = Object.keys(KICKOFF_SURFACES);
  expect(ids.sort()).toEqual(['generic', 'idea', 'initiative-select', 'trigger-only']);

  for (const id of ids) {
    const markup = renderHeader(KIND_FOR_SURFACE[id]);
    expect(markup, `${id}: the builder must publish the surface it was told about`).toContain(
      `data-kickoff-kind="${id}"`,
    );
    const { builderLabel } = KICKOFF_SURFACES[id as keyof typeof KICKOFF_SURFACES];
    expect(builderLabel.length, `${id}: every surface must name itself to the operator`).toBeGreaterThan(0);
    // React escapes the em dash's neighbours, not the words — match on the
    // leading clause rather than the whole punctuated string.
    expect(markup, `${id}: the row renders the id but not its meaning`).toContain(
      builderLabel.split(' —')[0],
    );
  }
});

test('the row is READ-ONLY — the derived kind has no control that could contradict the canvas', () => {
  const markup = renderHeader('idea');

  const tag = /<(\w+)[^>]*data-kickoff-kind=/.exec(markup)?.[1];
  expect(tag, 'nothing in the header carries data-kickoff-kind').toBeTruthy();
  expect(['input', 'select', 'button', 'textarea'], `the derived kind is editable — it renders as <${tag}>`)
    .not.toContain(tag);

  // ...and no separate control names it either.
  expect(markup).not.toContain('data-field="kickoff-kind"');
  expect(markup).not.toContain('data-action="set-kickoff-kind"');
});

test('an unknown or absent kind falls to the generic surface rather than rendering a kind that does not exist', () => {
  expect(kickoffSurfaceIdOfKind(undefined)).toBe('generic');
  expect(kickoffSurfaceIdOfKind(null)).toBe('generic');
  expect(kickoffSurfaceIdOfKind('not-a-kind')).toBe('generic');
  expect(renderHeader('not-a-kind')).toContain('data-kickoff-kind="generic"');
});
