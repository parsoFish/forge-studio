/**
 * W7-C1 (agents-27) — render pins for `UsedInFlows`
 * (components/studio/agent-builder/UsedInFlows.tsx).
 *
 * THE DEFECT THIS KILLS: release-finalizer and project-scoped-review are
 * shipped agents that belong to no flow, so their agent pages read
 * "Not yet used in any flow." — which presents a production-wired agent
 * (release-finalizer runs inside the approve→merge finalization chain
 * whenever the project declares a releaseProcess) and a deliberately
 * operator-triggered utility (project-scoped-review) as orphans. The panel
 * now accepts an optional `dispatchNote` — derived per agent from its OWN
 * SKILL-declared `phase` by `dispatchProvenanceNote` (lib/
 * agent-dispatch-provenance.ts) — rendered alongside the honest flow-usage
 * fact, never replacing it.
 *
 * Render harness matches lib/run-panel-render.test.ts's precedent:
 * `renderToStaticMarkup` over `createElement` — no jsdom in this repo.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { UsedInFlows } from '@/components/studio/agent-builder/UsedInFlows';
import { dispatchProvenanceNote } from '@/lib/agent-dispatch-provenance';
import type { Flow } from '@/lib/studio-client';

function makeFlow(overrides: Partial<Flow> & { id: string }): Flow {
  return { id: overrides.id, name: overrides.id, goal: '', nodes: [], edges: [], triggers: [], ...overrides };
}

// ---- dispatchProvenanceNote (the pure derivation) ---------------------------

test('dispatchProvenanceNote: release-finalize phase names the merge-finalization chain', () => {
  const note = dispatchProvenanceNote('release-finalize');
  expect(note).toBeTruthy();
  expect(note).toContain('releaseProcess');
});

test('dispatchProvenanceNote: audit phase names the operator-triggered Run panel entry', () => {
  const note = dispatchProvenanceNote('audit');
  expect(note).toBeTruthy();
  expect(note).toMatch(/[Oo]perator/);
});

test('dispatchProvenanceNote: reflection phase names the on: merged standing trigger', () => {
  const note = dispatchProvenanceNote('reflection');
  expect(note).toBeTruthy();
  expect(note).toContain('merged');
});

test('dispatchProvenanceNote: unknown/absent phase -> null (never a fabricated provenance)', () => {
  expect(dispatchProvenanceNote('developer')).toBe(null);
  expect(dispatchProvenanceNote(undefined)).toBe(null);
});

// ---- UsedInFlows render ------------------------------------------------------

test('UsedInFlows: no flows + no dispatchNote -> the plain "Not yet used in any flow." line, no provenance block', () => {
  const html = renderToStaticMarkup(
    React.createElement(UsedInFlows, { agentSlug: 'some-agent', flows: [] }),
  );
  expect(html).toContain('Not yet used in any flow.');
  expect(html).not.toContain('data-dispatch-note');
});

test('W7-C1 (agents-27): no flows + a dispatchNote -> the note renders verbatim under data-dispatch-note, alongside the honest flow-usage fact', () => {
  const note = dispatchProvenanceNote('release-finalize');
  const html = renderToStaticMarkup(
    React.createElement(UsedInFlows, { agentSlug: 'release-finalizer', flows: [], dispatchNote: note }),
  );
  expect(html).toContain('data-dispatch-note');
  expect(html).toContain('releaseProcess');
  // The flow-usage fact stays honest — the note explains, it never fabricates
  // a flow membership.
  expect(html).toContain('Not yet used in any flow.');
});

test('UsedInFlows: an agent genuinely used in a flow renders the flow chip link (unchanged contract)', () => {
  const flows = [makeFlow({ id: 'forge-develop', name: 'Forge Develop', nodes: [{ id: 'dev', agent: 'developer-ralph' }] as Flow['nodes'] })];
  const html = renderToStaticMarkup(
    React.createElement(UsedInFlows, { agentSlug: 'developer-ralph', flows }),
  );
  expect(html).toContain('href="/flows/forge-develop"');
  expect(html).toContain('Forge Develop');
});
