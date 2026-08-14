/**
 * Acceptance tests — Library card render contract (forge-n5r/forge-3oq,
 * R6-07 batch-H honesty pass).
 *
 * Renders the REAL `FlowCard` / `AgentCard` / `ProjectCard` / `KbCard`
 * (forge-ui/components/studio/LibraryCard.tsx) via `react-dom/server`'s
 * `renderToStaticMarkup`, matching the precedent + rationale in
 * `./run-panel-render.test.ts`'s header (no jsdom/@testing-library, no new
 * dependency — react/react-dom are already forge-ui deps; the
 * `resolve.alias['@']` + `oxc.jsx: {runtime:'automatic'}` this needs are
 * ALREADY in `forge-ui/vitest.config.ts`, added by that same prior pass).
 * `.test.ts` (not `.test.tsx`, matching vitest.config.ts's `include` glob
 * and run-panel-render.test.ts's own convention) — components are built via
 * `React.createElement`, never angle-bracket JSX.
 *
 * TWO DEFECTS this file pins:
 *
 *  - forge-n5r: `LibraryCard.tsx`'s FlowCard does
 *    `runs.filter(r => r.flowId === flow.id)` (line 115) — it ignores
 *    `run.flowLineage`, so a threaded-spine run leaves the card wrongly
 *    quiet. `lib/home-view.ts`'s `deriveFlowStatus`/the flow monitor
 *    (`app/flows/[id]/page.tsx:101`) each carry their own copy of the
 *    correct predicate — see `./home-view.test.ts`'s "runsForFlow" section
 *    for the pure-logic pins. This file pins the RENDER-level contract: a
 *    NEW `data-flow-status` attribute (FlowCard renders none today) that
 *    must equal `deriveFlowStatus(flow.id, runs)` exactly.
 *
 *  - forge-3oq: `ProvenanceBadge` is fed by `provenanceOfFlowOrigin(flow.origin)`
 *    — a CLIENT-side inference — and only Flow has any per-object signal at
 *    all (AgentCard/ProjectCard/KbCard render no `data-provenance` today).
 *    The server is gaining a per-type `provenance` field on the wire; every
 *    card must READ it verbatim, never re-derive it. Also pins the wire
 *    boundary that field arrives through: `fetchStudioKbs`/`Flows`/`Agents`/
 *    `Projects` must PARSE (validate + normalise) `provenance`/`lint`, not
 *    cast — an absent/garbage `provenance` -> `'unknown'`, an absent/garbage
 *    `lint` -> `null`, NEVER a fabricated `{errors:0,flags:0}` "clean".
 *
 * RUN: npx vitest run lib/library-card-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowCard, AgentCard, ProjectCard, KbCard } from '@/components/studio/LibraryCard';
import { deriveFlowStatus } from './home-view.ts';
import {
  fetchStudioKbs,
  fetchStudioFlows,
  fetchStudioAgents,
  fetchStudioProjects,
} from './studio-client.ts';
import type { Flow, Agent, Project, Kb, Run } from './studio-client.ts';
// forge-3oq: NOT exported by studio-client.ts yet at pin time — type-only,
// so this import is erased at runtime (no crash) and shows up as a real
// `tsc --noEmit` error ("has no exported member 'Provenance'/'KbLintSummary'")
// until the seam lands. Every fixture below that assigns `provenance`/`lint`
// literal values is exercising exactly that not-yet-real contract.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Provenance, KbLintSummary } from './studio-client.ts';

// Fetch harness matches lib/studio-client.test.ts's own AT-F1-1 precedent
// verbatim: `resolveBridgeUrl` is vi.mock'd to a fixed base (matches by
// RESOLVED path — this file lives in lib/, same dir as studio-client.ts's
// own extensionless `from './bridge-client'` import), `fetch` is stubbed
// per-test.
vi.mock('./bridge-client.ts', () => ({
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- fixtures ---------------------------------------------------------------

function makeFlow(overrides: Partial<Flow> & { id: string }): Flow {
  return { id: overrides.id, name: overrides.id, goal: '', nodes: [], edges: [], triggers: [], ...overrides };
}

function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  return { id: overrides.id, name: overrides.id, purpose: '', skills: [], tools: [], mcps: [], guards: [], hooks: [], ...overrides };
}

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return { id: overrides.id, name: overrides.id, skills: [], ...overrides };
}

function makeKb(overrides: Partial<Kb> & { id: string }): Kb {
  return { id: overrides.id, name: overrides.id, binding: { kind: 'unique' }, counts: { index: 0, themes: 0, raw: 0 }, ...overrides };
}

function makeRun(overrides: Partial<Run> & { id: string; flowId: string }): Run {
  return {
    initiativeId: overrides.id,
    initiative: overrides.id,
    status: 'active',
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: [overrides.flowId],
    ...overrides,
  };
}

// ---- FlowCard: data-flow-status via runsForFlow (forge-n5r) ----------------

test('FlowCard: a run whose flowId is a DIFFERENT flow but whose flowLineage includes this flow still lights up data-flow-status="active" — kills LibraryCard.tsx:115\'s `runs.filter(r => r.flowId === flow.id)`, which ignores flowLineage entirely', () => {
  const flow = makeFlow({ id: 'forge-develop' });
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'forge-develop'], status: 'active' }),
  ];
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain('data-flow-status="active"');
});

test("FlowCard: the gated/failed 'needs you'/'failed' chips also reflect lineage-matched runs, not just direct flowId matches", () => {
  const flow = makeFlow({ id: 'forge-develop' });
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'forge-develop'], status: 'gated' }),
    makeRun({ id: 'r2', flowId: 'forge-reflect', flowLineage: ['forge-reflect', 'forge-develop'], status: 'failed' }),
  ];
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain('1 needs you');
  expect(html).toContain('1 failed');
});

test('FlowCard: data-flow-status equals deriveFlowStatus(flow.id, runs) EXACTLY — kills a fix that corrects the filter but leaves the card computing its own second, independent status', () => {
  const flow = makeFlow({ id: 'f1' });
  const runs = [
    makeRun({ id: 'r1', flowId: 'x', flowLineage: ['f1'], status: 'gated' }),
    makeRun({ id: 'r2', flowId: 'f1', status: 'active' }),
  ];
  const expected = deriveFlowStatus(flow.id, runs);
  expect(expected).toBe('active'); // sanity: a real, non-vacuous status (active wins over gated)
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain(`data-flow-status="${expected}"`);
});

test('FlowCard: no matching run at all -> data-flow-status="idle" (never a fabricated default)', () => {
  const flow = makeFlow({ id: 'f1' });
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs: [], projects: [], index: 0 }));
  expect(html).toContain('data-flow-status="idle"');
});

// ---- FlowCard: data-flow-failed-count / data-flow-gated-count (review round,
// ---- GAP 3) ------------------------------------------------------------------
//
// `deriveFlowStatus` stays a 3-state derivation (active|gated|idle) shared
// byte-for-byte with the flow monitor (exit row 13 parity) — a 4th 'failed'
// state must NOT be pinned into HomeStatus. The real defect: the failed/
// gated counts exist ONLY as scraped chip TEXT ("N failed"/"N needs you"),
// so DOM-driven automation reading `data-flow-status` alone cannot tell a
// failed-only flow apart from a never-run one — both read "idle". FlowCard
// must ALSO emit numeric `data-flow-failed-count`/`data-flow-gated-count`
// attributes (always present, `"0"` when none), sourced from the SAME
// lineage-aware `runsForFlow` set that already feeds the chips (CLAUDE.md's
// data-* mirroring rule: load-bearing UI state belongs in data-*, not text).

test('FlowCard: a flow whose ONLY matching run is status:"failed" renders data-flow-status="idle" AND data-flow-failed-count="1" — both true, both DOM-readable (kills reading data-flow-status alone as the whole truth)', () => {
  const flow = makeFlow({ id: 'f1' });
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'failed' })];
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain('data-flow-status="idle"');
  expect(html).toContain('data-flow-failed-count="1"');
  expect(html).toContain('data-flow-gated-count="0"');
});

test('FlowCard: no matching runs at all -> data-flow-failed-count="0" and data-flow-gated-count="0", always present (never absent/undefined) — kills an implementation that omits the attribute entirely when the count is zero', () => {
  const flow = makeFlow({ id: 'f1' });
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs: [], projects: [], index: 0 }));
  expect(html).toContain('data-flow-status="idle"');
  expect(html).toContain('data-flow-failed-count="0"');
  expect(html).toContain('data-flow-gated-count="0"');
});

test('FlowCard: a run matched ONLY via flowLineage (not flowId) and status:"failed" still counts in data-flow-failed-count — kills a counts implementation that reverts to the non-lineage `runs.filter(r => r.flowId === flow.id)` filter forge-n5r already fixed for the chips/status', () => {
  const flow = makeFlow({ id: 'forge-develop' });
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'forge-develop'], status: 'failed' }),
  ];
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain('data-flow-failed-count="1"');
});

test('FlowCard: data-flow-gated-count mirrors the SAME lineage-aware contract for gated runs', () => {
  const flow = makeFlow({ id: 'forge-develop' });
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'forge-develop'], status: 'gated' }),
  ];
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs, projects: [], index: 0 }));
  expect(html).toContain('data-flow-gated-count="1"');
  expect(html).toContain('data-flow-failed-count="0"');
});

// ---- per-card-type data-provenance (forge-3oq) ------------------------------

test('FlowCard: data-provenance carries the SERVER field verbatim — NOT re-derived from flow.origin client-side', () => {
  // flow.origin ('studio') would map via provenanceOfFlowOrigin to
  // 'operator' today; the real server-sourced provenance says 'ootb'. A card
  // reading the server field renders 'ootb'; a card still inferring from
  // origin renders 'operator' — this is a WRONG-VALUE red today, not a
  // missing-attribute one (FlowCard already renders SOME data-provenance).
  const flow = { ...makeFlow({ id: 'f1', origin: 'studio' }), provenance: 'ootb' } as Flow;
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs: [], projects: [], index: 0 }));
  expect(html).toContain('data-provenance="ootb"');
});

test('FlowCard: a server value of "unknown" renders verbatim — kills a card that silently upgrades an unattested type to "operator" (claiming knowledge it does not have)', () => {
  const flow = { ...makeFlow({ id: 'f1' }), provenance: 'unknown' } as Flow;
  const html = renderToStaticMarkup(React.createElement(FlowCard, { flow, runs: [], projects: [], index: 0 }));
  expect(html).toContain('data-provenance="unknown"');
});

test('AgentCard: renders data-provenance from the server field — AgentCard has NO data-provenance attribute at all today', () => {
  const agent = { ...makeAgent({ id: 'a1' }), provenance: 'ootb' } as Agent;
  const html = renderToStaticMarkup(React.createElement(AgentCard, { agent, index: 0 }));
  expect(html).toContain('data-provenance="ootb"');
});

test('ProjectCard: renders data-provenance from the server field — ProjectCard has NO data-provenance attribute at all today', () => {
  const project = { ...makeProject({ id: 'p1' }), provenance: 'operator' } as Project;
  const html = renderToStaticMarkup(React.createElement(ProjectCard, { project, kbs: [], index: 0 }));
  expect(html).toContain('data-provenance="operator"');
});

test('KbCard: renders data-provenance from the server field, including the honest "unknown" (the-server-cannot-attest) value — KbCard has NO data-provenance attribute at all today', () => {
  const kb = { ...makeKb({ id: 'k1' }), provenance: 'unknown' } as Kb;
  const html = renderToStaticMarkup(React.createElement(KbCard, { kb, index: 0 }));
  expect(html).toContain('data-provenance="unknown"');
});

// ---- wire-boundary parse (forge-3oq/forge-2am): cast-not-parse is the ------
// ---- exact defect class this PR closes -------------------------------------
//
// Today `fetchStudioKbs`/`fetchStudioFlows`/`fetchStudioProjects` do a raw
// cast (`return body.kbs;` etc — no per-item transform at all) and
// `fetchStudioAgents`'s `parseAgentDefinition` has no `provenance`/`lint`
// handling yet (those keys are simply absent from its return object
// literal). Every assertion below is RED today for one of two honest
// reasons: a garbage/absent wire value passes straight through unchanged
// (wrong value), or the parsed field is simply absent (`undefined`, not
// `'unknown'`/`null`).

const KB_SHAPE = { binding: { kind: 'unique' as const }, counts: { index: 0, themes: 0, raw: 0 } };

function stubFetchJson(json: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => json })));
}

test('fetchStudioKbs: garbage/absent `provenance` parses to "unknown" — never passed through raw, never defaulted to "operator"', async () => {
  stubFetchJson({
    kbs: [
      { id: 'k-garbage', name: 'K garbage', ...KB_SHAPE, provenance: 'bogus-value' },
      { id: 'k-absent', name: 'K absent', ...KB_SHAPE },
      { id: 'k-wellformed', name: 'K wellformed', ...KB_SHAPE, provenance: 'ootb' },
    ],
  });
  const kbs = await fetchStudioKbs();
  expect(kbs.find((k) => k.id === 'k-garbage')?.provenance).toBe('unknown');
  expect(kbs.find((k) => k.id === 'k-absent')?.provenance).toBe('unknown');
  // Happy-path passthrough must keep working — this row is already correct
  // today (a raw cast happens to pass a well-formed value through fine); the
  // point of this assertion is that the REAL parser must not break it while
  // fixing the two rows above.
  expect(kbs.find((k) => k.id === 'k-wellformed')?.provenance).toBe('ootb');
});

test('fetchStudioKbs: garbage/absent `lint` parses to null — never a fabricated {errors:0,flags:0} "clean" verdict', async () => {
  stubFetchJson({
    kbs: [
      { id: 'k-garbage', name: 'K garbage', ...KB_SHAPE, lint: 'not-an-object' },
      { id: 'k-absent', name: 'K absent', ...KB_SHAPE },
      { id: 'k-real', name: 'K real', ...KB_SHAPE, lint: { errors: 2, flags: 1, checksRun: 3, checksTotal: 10 } },
    ],
  });
  const kbs = await fetchStudioKbs();
  expect(kbs.find((k) => k.id === 'k-garbage')?.lint).toBe(null);
  expect(kbs.find((k) => k.id === 'k-absent')?.lint).toBe(null);
  expect(kbs.find((k) => k.id === 'k-real')?.lint).toEqual({ errors: 2, flags: 1, checksRun: 3, checksTotal: 10 });
});

test('fetchStudioFlows: garbage `provenance` parses to "unknown" — today a raw cast passes it through verbatim', async () => {
  stubFetchJson({ flows: [{ id: 'f1', name: 'F1', goal: '', nodes: [], edges: [], triggers: [], provenance: 'nonsense-value' }] });
  const flows = await fetchStudioFlows();
  expect(flows.find((f) => f.id === 'f1')?.provenance).toBe('unknown');
});

test('fetchStudioAgents: absent `provenance` parses to "unknown" — today parseAgentDefinition has no provenance handling at all (the field is simply undefined)', async () => {
  stubFetchJson({ agents: [{ slug: 'a1', name: 'A1', composition: {} }] });
  const agents = await fetchStudioAgents();
  expect(agents.find((a) => a.id === 'a1')?.provenance).toBe('unknown');
});

test('fetchStudioProjects: garbage `provenance` (wrong type, not even a string) parses to "unknown" — today a raw cast passes it through verbatim', async () => {
  stubFetchJson({ projects: [{ id: 'p1', name: 'P1', skills: [], provenance: 42 }] });
  const projects = await fetchStudioProjects();
  expect(projects.find((p) => p.id === 'p1')?.provenance).toBe('unknown');
});
