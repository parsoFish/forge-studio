/**
 * DOM regression + acceptance tests (R6-01 WI-4) for a NEW component,
 * `components/studio/agent-builder/StandingTriggers.tsx`, that does not
 * exist yet — every import below is a legitimate RED (module not found)
 * until the implementer creates it with the exact export/props this file
 * names. Renders via `react-dom/server`'s `renderToStaticMarkup`, following
 * `./run-log-render.test.ts` / `./run-panel-render.test.ts`'s established
 * precedent (no jsdom / `@testing-library/react` in this repo — see those
 * files' headers for the full rationale).
 *
 * Sibling precedent: `components/studio/agent-builder/UsedInFlows.tsx` — a
 * read-only list derived by filtering an already-fetched prop
 * (`flows: Flow[]`), rendered with no fetch of its own. `StandingTriggers`
 * follows the SAME shape: it receives an already-fetched
 * `triggers: StandingTrigger[]` (the caller's `GET /api/triggers` result)
 * plus `agentSlug`, and filters with `./standing-triggers.ts`'s
 * `standingTriggersForAgent` (pinned separately in
 * `./standing-triggers.test.ts`) — this file does NOT re-test the filter
 * logic, only the render contract of a component that uses it.
 *
 * RESERVED DOM CONTRACT (docs/forge-ui-dom-and-harness.md:832-836, "Trigger
 * provenance — named, not yet attached"): a standing-trigger row renders
 * `[data-standing-trigger][data-trigger-kind][data-trigger-target]
 * [data-trigger-scope-count]`. That doc explicitly states "no attribute...
 * is attached to any DOM element by [R2-08-F4]... the consuming surfaces...
 * attach them when they render this data" — `StandingTriggers.tsx` is that
 * consuming surface for the R6-01-F4 kickoff-panel list. The doc does NOT
 * pin the exact `data-trigger-scope-count` ENCODING (only the attribute
 * name) — this file pins the encoding as:
 *
 *   projects === null   -> data-trigger-scope-count="all"   (unscoped: every project)
 *   projects === []     -> data-trigger-scope-count="0"     (scoped to nothing)
 *   projects === [...N] -> data-trigger-scope-count="<N>"   (scoped to N named projects)
 *
 * This is the only encoding that keeps `null` and `[]` DISTINGUISHABLE on
 * the DOM (the task's explicit, named requirement) while still reading as a
 * genuine "count" for the scoped case — collapsing null to "0" (a plausible
 * wrong implementation) would make an unscoped, always-fires trigger read
 * as if it were scoped to nothing.
 *
 * `data-standing-trigger` follows this codebase's own established
 * convention for a flag attribute carrying an explicit STRING value, not a
 * bare/boolean attribute (`run-log-render.test.ts`'s `data-log-line="true"`,
 * `RunPanel.tsx`'s `data-run-dispatchable="true"`) — pinned below as
 * `data-standing-trigger="true"`.
 *
 * ASSUMED EXPORT from `components/studio/agent-builder/StandingTriggers.tsx`:
 *
 *   export function StandingTriggers(props: {
 *     agentSlug: string;
 *     triggers: StandingTrigger[];  // the FULL unfiltered GET /api/triggers result
 *   }): JSX.Element
 *
 * Empty-state precedent: `./run-log-render.test.ts`'s
 * `data-component="run-log-empty"` — an HONEST empty state, never a
 * fabricated/placeholder row, when the agent has no standing triggers.
 * Pinned below as `data-component="standing-triggers-empty"`.
 *
 * RUN: npx vitest run lib/standing-triggers-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StandingTriggers } from '@/components/studio/agent-builder/StandingTriggers';
import type { StandingTrigger } from './standing-triggers.ts';

function render(agentSlug: string, triggers: StandingTrigger[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(StandingTriggers as any, { agentSlug, triggers }));
}

test('no matching triggers -> an honest empty state, not a fabricated/placeholder row — kills "renders a sample/placeholder row when nothing matches" (mirrors run-log-render.test.ts\'s empty-state precedent)', () => {
  const html = render('reflector', []);
  expect(html).toContain('data-component="standing-triggers-empty"');
  expect(html).not.toContain('data-standing-trigger');
});

test('a flow-targeted trigger for a different agent produces the empty state too, never a stray row — kills a component that renders every trigger passed in without filtering by agentSlug itself', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'demo-agent' }, projects: null, sourceFlowId: 'forge-develop' },
  ];
  const html = render('reflector', triggers);
  expect(html).toContain('data-component="standing-triggers-empty"');
  expect(html).not.toContain('data-standing-trigger');
});

test('one matching trigger renders exactly one row carrying data-trigger-kind (the trigger\'s `on`) and data-trigger-target (the target ref) — kills a row that omits the reserved attributes or renders the wrong field into them (e.g. sourceFlowId into data-trigger-target)', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: null, sourceFlowId: 'forge-develop' },
  ];
  const html = render('reflector', triggers);
  expect((html.match(/data-standing-trigger="true"/g) ?? []).length).toBe(1);
  expect(html).toContain('data-trigger-kind="merged"');
  expect(html).toContain('data-trigger-target="reflector"');
});

test('projects: null (unscoped) renders data-trigger-scope-count="all" — kills a component that renders nothing / omits the attribute / stringifies null as "null" for the unscoped case', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: null, sourceFlowId: 'forge-develop' },
  ];
  const html = render('reflector', triggers);
  expect(html).toContain('data-trigger-scope-count="all"');
});

test('projects: [] (scoped to nothing) renders data-trigger-scope-count="0", DISTINCT from the unscoped "all" — kills a component that collapses null and [] to the same rendered value (the exact defect the task brief calls out)', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: [], sourceFlowId: 'forge-develop' },
  ];
  const html = render('reflector', triggers);
  expect(html).toContain('data-trigger-scope-count="0"');
  expect(html).not.toContain('data-trigger-scope-count="all"');
});

test('projects: ["gitpulse","betterado"] (scoped to 2 named projects) renders data-trigger-scope-count="2" — kills a component that only distinguishes null vs [] but ignores the actual scoped count', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: ['gitpulse', 'betterado'], sourceFlowId: 'forge-develop' },
  ];
  const html = render('reflector', triggers);
  expect(html).toContain('data-trigger-scope-count="2"');
});

test('two matching triggers for the same agent render two distinct rows, each with its own on/target values — kills a component that renders only the first match or merges multiple rows into one', () => {
  const triggers: StandingTrigger[] = [
    { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: null, sourceFlowId: 'forge-develop' },
    { on: 'cron', target: { kind: 'agent', ref: 'reflector' }, projects: [], sourceFlowId: 'forge-nightly' },
  ];
  const html = render('reflector', triggers);
  expect((html.match(/data-standing-trigger="true"/g) ?? []).length).toBe(2);
  expect(html).toContain('data-trigger-kind="merged"');
  expect(html).toContain('data-trigger-kind="cron"');
});
