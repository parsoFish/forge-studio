/**
 * Acceptance tests — Home dashboard derivation (R6-07).
 *
 * THE DEFECT CLASS: declared-data-fails-open. The mockup
 * (mockups/studio-endstate-v2/views-home.jsx + data.jsx) invents
 * `flow.status` / `agent.status` / `kb.status` fields that do not exist on
 * the real wire types (`Flow`, `Agent`, `Project`, `Kb` in ./studio-client —
 * none carry a `status` field). Live status on Home MUST be DERIVED from the
 * run-model (`Run[]` from `fetchRuns()`) and the attention aggregate
 * (`ProjectAttentionItem[]` from `fetchProjectAttention()`), never read off
 * a fabricated field. Every fixture below deliberately constructs Flow /
 * Agent / Kb objects WITHOUT a `status` property — TypeScript itself refuses
 * to compile one in, which is the point: a wrong implementation that reads
 * `flow.status` has nowhere on the real type to read it from.
 *
 * RUN: cd forge-ui && npx vitest run lib/home-view.test.ts
 */
import { test, expect } from 'vitest';
import {
  deriveFlowStatus,
  deriveAgentStatus,
  deriveProjectStatus,
  buildConstellation,
  buildHomeAttention,
  type HomeHex,
} from './home-view.ts';
import type { Flow, Agent, Project, Kb, Run, FlowNode } from './studio-client.ts';
import type { ProjectAttentionItem } from './bridge-client.ts';

// ---- fixtures --------------------------------------------------------------

function makeFlow(id: string, nodes: FlowNode[] = []): Flow {
  return { id, name: id, goal: '', nodes, edges: [], triggers: [] };
}

function makeAgent(id: string): Agent {
  return { id, name: id, purpose: '', skills: [], tools: [], mcps: [], guards: [], hooks: [] };
}

function makeProject(id: string): Project {
  return { id, name: id, skills: [] };
}

function makeKb(id: string): Kb {
  return { id, name: id, binding: { kind: 'unique' }, counts: { index: 0, themes: 0, raw: 0 } };
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

function makeAttention(overrides: Partial<ProjectAttentionItem> & { projectId: string }): ProjectAttentionItem {
  return {
    name: overrides.projectId,
    link: `/projects/${overrides.projectId}/roadmap`,
    planned: 0,
    inFlight: 0,
    gated: 0,
    merged: 0,
    flagged: 0,
    ...overrides,
  };
}

// ---- deriveFlowStatus: the ruling-49 core ----------------------------------

test('deriveFlowStatus: a gated run on the flow -> hex status "gated"', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'gated' })];
  expect(deriveFlowStatus('f1', runs)).toBe('gated');
});

test('deriveFlowStatus: flip the run to active -> hex status "active" (active wins over gated)', () => {
  const runs = [
    makeRun({ id: 'r1', flowId: 'f1', status: 'gated' }),
    makeRun({ id: 'r2', flowId: 'f1', status: 'active' }),
  ];
  expect(deriveFlowStatus('f1', runs)).toBe('active');
});

test('deriveFlowStatus: no matching run at all -> "idle" (not a fabricated status)', () => {
  // Kills an impl that defaults to 'active'/'gated' when it can't find the
  // flow.status field it wrongly expects to exist.
  expect(deriveFlowStatus('f1', [])).toBe('idle');
});

test('deriveFlowStatus: removing the run drops the flow back to "idle"', () => {
  const withRun = deriveFlowStatus('f1', [makeRun({ id: 'r1', flowId: 'f1', status: 'active' })]);
  const withoutRun = deriveFlowStatus('f1', []);
  expect(withRun).toBe('active');
  expect(withoutRun).toBe('idle');
});

test('deriveFlowStatus: flowLineage path — a threaded run whose flowId is elsewhere still lights up f1', () => {
  // Kills an impl that only checks run.flowId and ignores flowLineage, which
  // would leave a threaded spine run's traversed flows permanently 'idle'.
  const runs = [makeRun({ id: 'r1', flowId: 'x', flowLineage: ['forge-architect', 'f1', 'forge-reflect'], status: 'active' })];
  expect(deriveFlowStatus('f1', runs)).toBe('active');
});

// ---- deriveAgentStatus ------------------------------------------------------

test('deriveAgentStatus: active iff an active run has an active phase on a node this agent owns', () => {
  const node: FlowNode = { id: 'dev', agent: 'developer' };
  const flows = [makeFlow('f1', [node])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'active' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('active');
});

test('deriveAgentStatus: idle when the owning node\'s phase is pending, not active', () => {
  const node: FlowNode = { id: 'dev', agent: 'developer' };
  const flows = [makeFlow('f1', [node])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'pending' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('idle');
});

test('deriveAgentStatus: idle when no flow node references this agent at all', () => {
  // Kills an impl that defaults an unmapped agent to 'active' rather than
  // failing closed to 'idle'.
  const flows = [makeFlow('f1', [{ id: 'dev', agent: 'someone-else' }])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'active' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('idle');
});

// ---- deriveProjectStatus -----------------------------------------------------

test('deriveProjectStatus: gated > 0 -> "gated"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 1, inFlight: 3 })];
  expect(deriveProjectStatus('p1', attention)).toBe('gated');
});

test('deriveProjectStatus: no gated but inFlight > 0 -> "active"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, inFlight: 2 })];
  expect(deriveProjectStatus('p1', attention)).toBe('active');
});

test('deriveProjectStatus: nothing gated or in flight -> "idle"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, inFlight: 0 })];
  expect(deriveProjectStatus('p1', attention)).toBe('idle');
});

test('deriveProjectStatus: project absent from the attention list -> "idle" (fail closed, not fabricated)', () => {
  expect(deriveProjectStatus('missing', [])).toBe('idle');
});

// ---- buildConstellation ------------------------------------------------------

test('buildConstellation: one hex per object, correct glyph per kind, count == flows+agents+projects+kbs', () => {
  const flows = [makeFlow('f1'), makeFlow('f2')];
  const agents = [makeAgent('a1')];
  const projects = [makeProject('p1')];
  const kbs = [makeKb('kb1'), makeKb('kb2'), makeKb('kb3')];
  const hexes = buildConstellation({ flows, agents, projects, kbs, runs: [], attention: [] });

  expect(hexes).toHaveLength(flows.length + agents.length + projects.length + kbs.length);

  const byKind = (kind: HomeHex['kind']) => hexes.filter((h) => h.kind === kind);
  expect(byKind('flow')).toHaveLength(2);
  expect(byKind('agent')).toHaveLength(1);
  expect(byKind('project')).toHaveLength(1);
  expect(byKind('kb')).toHaveLength(3);

  for (const h of byKind('flow')) expect(h.glyph).toBe('⬡');
  for (const h of byKind('agent')) expect(h.glyph).toBe('⬢');
  for (const h of byKind('kb')) expect(h.glyph).toBe('◈');
});

test('buildConstellation: every hex href points at its OWNING surface', () => {
  const flows = [makeFlow('f1')];
  const agents = [makeAgent('a1')];
  const projects = [makeProject('p1')];
  const kbs = [makeKb('kb1')];
  const hexes = buildConstellation({ flows, agents, projects, kbs, runs: [], attention: [] });

  const flowHex = hexes.find((h) => h.kind === 'flow' && h.id === 'f1')!;
  const agentHex = hexes.find((h) => h.kind === 'agent' && h.id === 'a1')!;
  const projectHex = hexes.find((h) => h.kind === 'project' && h.id === 'p1')!;
  const kbHex = hexes.find((h) => h.kind === 'kb' && h.id === 'kb1')!;

  expect(flowHex.href).toBe('/flows/f1');
  expect(agentHex.href).toBe('/agents/a1');
  expect(projectHex.href).toBe('/projects/p1');
  // KB surface prefix only — the exact kb detail route is not pinned here.
  expect(kbHex.href.startsWith('/knowledge')).toBe(true);
});

test('buildConstellation: kb status is always "idle" — no live read exists for KBs', () => {
  const kbs = [makeKb('kb1')];
  const hexes = buildConstellation({ flows: [], agents: [], projects: [], kbs, runs: [], attention: [] });
  expect(hexes[0].status).toBe('idle');
});

test('buildConstellation: hex status equals the derive* result for each object (flow + project cases)', () => {
  const flows = [makeFlow('f1')];
  const projects = [makeProject('p1')];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'gated' })];
  const attention = [makeAttention({ projectId: 'p1', gated: 2 })];

  const hexes = buildConstellation({ flows, agents: [], projects, kbs: [], runs, attention });

  const flowHex = hexes.find((h) => h.kind === 'flow' && h.id === 'f1')!;
  const projectHex = hexes.find((h) => h.kind === 'project' && h.id === 'p1')!;

  expect(flowHex.status).toBe(deriveFlowStatus('f1', runs));
  expect(flowHex.status).toBe('gated');
  expect(projectHex.status).toBe(deriveProjectStatus('p1', attention));
  expect(projectHex.status).toBe('gated');
});

// ---- buildHomeAttention (mirrors R4-11-F4) -----------------------------------

test('buildHomeAttention: nothing gated and nothing flagged -> empty array (fires only on a real condition)', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, flagged: 0, inFlight: 5 })];
  expect(buildHomeAttention(attention)).toEqual([]);
});

test('buildHomeAttention: gated > 0 -> exactly one item, href/projectId pulled from the source row', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 2, link: '/projects/p1/roadmap' })];
  const items = buildHomeAttention(attention);
  expect(items).toHaveLength(1);
  expect(items[0].href).toBe('/projects/p1/roadmap');
  expect(items[0].projectId).toBe('p1');
  expect(items[0].kind).toBe('gate');
});

test('buildHomeAttention: flagged > 0 alone (no gated) also fires', () => {
  const attention = [makeAttention({ projectId: 'p2', gated: 0, flagged: 1, link: '/projects/p2/roadmap' })];
  const items = buildHomeAttention(attention);
  expect(items).toHaveLength(1);
  expect(items[0].projectId).toBe('p2');
});

test('buildHomeAttention: mixed list only surfaces the rows that actually need attention', () => {
  const attention = [
    makeAttention({ projectId: 'quiet', gated: 0, flagged: 0, inFlight: 9 }),
    makeAttention({ projectId: 'noisy', gated: 1, flagged: 0 }),
  ];
  const items = buildHomeAttention(attention);
  expect(items.map((i) => i.projectId)).toEqual(['noisy']);
});
