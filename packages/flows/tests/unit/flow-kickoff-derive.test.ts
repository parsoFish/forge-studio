/**
 * `deriveFlowKickoff` — a flow's launch surface, derived at save from its head
 * station (T1 ruling 167, bead `forge-8vfn.6.11.1`).
 *
 * THE DEFECT. `kickoffSurfaceId` (`apps/studio/lib/kickoff-surface.ts`) reads a
 * DECLARED `flow.kickoff.kind`. Only the two shipped YAML flows declare one and
 * the flow builder writes none, so every Studio-authored flow rendered
 * `data-kickoff-kind="generic"` and could not be launched from an idea however
 * it was built — with the architect placed or not. S4 beat 8, an independent
 * product gap rather than a cascade of beat 4.
 *
 * Kills, each a way the fix could be written and still be wrong:
 *  (a) a derivation that overwrites a DECLARED kind — the `fillOnly` shape
 *      §15.166 measured in `packages/projects` (`starterValue !== undefined ?
 *      starterValue : current` reads as a fill and behaves as a rewrite);
 *  (b) a derivation that reads `nodes[0]` instead of the graph's head — node
 *      ORDER in flow.yaml is not entry order, and the builder writes whatever
 *      order react-flow holds;
 *  (c) a derivation that guesses `initiative-select` from `triggers.length > 0`
 *      — a flow's triggers are OUTBOUND dispatches (forge-develop fires the
 *      reflector on `merged`), never a statement about its own entry;
 *  (d) a derivation that disagrees with the only two ground-truth flows in the
 *      repo — the shipped-flow control below loads them off disk and requires
 *      the derived kind to equal the hand-declared one;
 *  (e) a derivation that answers for an ambiguous graph (no head, or several).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';

import { deriveFlowKickoff } from '../../studio/flow-kickoff.ts';
import { loadFlowDefinition } from '../../studio/flow-registry.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'my-agent',
    name: 'My Agent',
    description: 'An agent.',
    purpose: 'Do things.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Process body here.',
    path: '/skills/my-agent/SKILL.md',
    ...overrides,
  };
}

/** The roster the derivation reads: a plain agent, and one that fans out over work items. */
const AGENTS: ReadonlyMap<string, AgentDefinition> = new Map([
  ['architect', makeAgentDef({ slug: 'architect', name: 'Architect', phase: 'architect' })],
  ['plan', makeAgentDef({ slug: 'plan', name: 'Plan' })],
  ['dev', makeAgentDef({ slug: 'dev', name: 'Dev' })],
  ['review', makeAgentDef({ slug: 'review', name: 'Review' })],
  [
    'developer-ralph',
    makeAgentDef({
      slug: 'developer-ralph',
      name: 'Developer (Ralph)',
      fanout: { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 1, perItemGate: 'item-declared' },
    }),
  ],
]);

function flow(over: Partial<FlowDefinition>): FlowDefinition {
  return {
    id: 'f', name: 'F', version: 1, goal: 'g', project: null, kb: null,
    costCeilingUsd: 5, origin: 'studio', nodes: [], edges: [], triggers: [],
    path: '/studio/flows/f/flow.yaml',
    ...over,
  };
}

test('an architect head derives the idea surface — the S4 beat-8 case', () => {
  const def = flow({
    nodes: [
      { id: 'architect', agent: 'architect', gate: 'plan' },
      { id: 'plan', agent: 'plan' },
      { id: 'dev', agent: 'dev' },
      { id: 'review', agent: 'review' },
    ],
    edges: [
      { from: 'architect', to: 'plan', artifact: 'plan' },
      { from: 'plan', to: 'dev', artifact: 'plan' },
      { from: 'dev', to: 'review', artifact: 'pr' },
    ],
  });
  assert.deepEqual(deriveFlowKickoff(def, AGENTS), { kind: 'idea' });
});

test('(b) the head is the node with no inbound edge, not nodes[0] — the architect placed LAST still derives idea', () => {
  // The builder writes react-flow's own node order; a station placed onto the
  // canvas after the seeded three lands at the END of the array while being
  // the graph's entry. `nodes[0]` here is `plan`, which derives nothing.
  const def = flow({
    nodes: [
      { id: 'plan', agent: 'plan' },
      { id: 'dev', agent: 'dev' },
      { id: 'review', agent: 'review' },
      { id: 'architect', agent: 'architect', gate: 'plan' },
    ],
    edges: [
      { from: 'architect', to: 'plan', artifact: 'plan' },
      { from: 'plan', to: 'dev', artifact: 'plan' },
      { from: 'dev', to: 'review', artifact: 'pr' },
    ],
  });
  assert.deepEqual(deriveFlowKickoff(def, AGENTS), { kind: 'idea' });
});

/**
 * (f) THE SHAPE THE BUILDER ACTUALLY PRODUCES. `FlowBuilderCanvas.placeStationAt`
 * creates a station carrying `{agentRef}` and nothing else — no gate, ever —
 * and `rfNodesToFlow` spreads `gate` in only when the node data has one. So the
 * architect an operator drags out of the palette saves WITHOUT `gate: 'plan'`.
 * A derivation that read the gate alone would have answered `generic` for every
 * flow the builder can produce, which is the defect, not the fix.
 */
test('(f) a builder-placed architect head — agent only, NO gate — still derives idea', () => {
  const def = flow({
    nodes: [
      { id: 'fn-m5b3x', agent: 'architect', x: 40, y: 120 },
      { id: 'plan', agent: 'plan' },
      { id: 'dev', agent: 'dev' },
      { id: 'review', agent: 'review', gate: 'verdict' },
    ],
    edges: [
      { from: 'fn-m5b3x', to: 'plan', artifact: 'plan' },
      { from: 'plan', to: 'dev', artifact: 'plan' },
      { from: 'dev', to: 'review', artifact: 'pr' },
    ],
  });
  assert.deepEqual(deriveFlowKickoff(def, AGENTS), { kind: 'idea' });
});

test('a bare plan-GATE head with no agent at all still derives idea — the shipped seed shape', () => {
  const def = flow({
    nodes: [{ id: 'plan-gate', gate: 'plan' }, { id: 'dev', agent: 'dev' }],
    edges: [{ from: 'plan-gate', to: 'dev', artifact: 'plan' }],
  });
  assert.deepEqual(deriveFlowKickoff(def, AGENTS), { kind: 'idea' });
});

test('a head that fans out over work items derives the initiative picker', () => {
  const def = flow({
    nodes: [
      { id: 'dev', agent: 'developer-ralph' },
      { id: 'review', gate: 'verdict' },
    ],
    edges: [{ from: 'dev', to: 'review', artifact: 'pr' }],
  });
  assert.deepEqual(deriveFlowKickoff(def, AGENTS), { kind: 'initiative-select' });
});

test('a plain head derives NOTHING — the generic launcher stays the default, it is not a guess', () => {
  const def = flow({
    nodes: [
      { id: 'plan', agent: 'plan' },
      { id: 'dev', agent: 'dev' },
      { id: 'review', agent: 'review', gate: 'verdict' },
    ],
    edges: [
      { from: 'plan', to: 'dev', artifact: 'plan' },
      { from: 'dev', to: 'review', artifact: 'pr' },
    ],
  });
  assert.equal(deriveFlowKickoff(def, AGENTS), undefined);
});

test('(c) a declared trigger does NOT make a plain-headed flow initiative-select — triggers are outbound dispatches', () => {
  const def = flow({
    nodes: [
      { id: 'plan', agent: 'plan' },
      { id: 'dev', agent: 'dev' },
    ],
    edges: [{ from: 'plan', to: 'dev', artifact: 'plan' }],
    triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'reflector' } }],
  });
  assert.equal(deriveFlowKickoff(def, AGENTS), undefined);
});

test('(e) an ambiguous entry derives nothing: a cycle has no head, and two heads name no single first station', () => {
  const cycle = flow({
    nodes: [{ id: 'a', agent: 'plan' }, { id: 'b', agent: 'dev' }],
    edges: [{ from: 'a', to: 'b', artifact: 'plan' }, { from: 'b', to: 'a', artifact: 'pr' }],
  });
  assert.equal(deriveFlowKickoff(cycle, AGENTS), undefined, 'no node without an inbound edge');

  const twoHeads = flow({
    nodes: [
      { id: 'architect', agent: 'architect', gate: 'plan' },
      { id: 'dev', agent: 'developer-ralph' },
      { id: 'review', gate: 'verdict' },
    ],
    edges: [
      { from: 'architect', to: 'review', artifact: 'plan' },
      { from: 'dev', to: 'review', artifact: 'pr' },
    ],
  });
  assert.equal(deriveFlowKickoff(twoHeads, AGENTS), undefined, 'two entries — the launch surface is not decidable');

  const empty = flow({ nodes: [], edges: [] });
  assert.equal(deriveFlowKickoff(empty, AGENTS), undefined);
});

test('a head whose agent is not in the roster derives nothing rather than guessing', () => {
  const def = flow({
    nodes: [{ id: 'mystery', agent: 'not-installed' }, { id: 'dev', agent: 'dev' }],
    edges: [{ from: 'mystery', to: 'dev', artifact: 'plan' }],
  });
  assert.equal(deriveFlowKickoff(def, AGENTS), undefined);
});

/**
 * (a) THE FILL/OVERWRITE CONTROL. §15.166's class, in the flow door: the
 * derivation must fill an ABSENCE and never rewrite a hand-declared kind. The
 * head here contradicts the declaration on purpose — an architect head under a
 * declared `trigger-only`. `trigger-only` is a DECLARED-ONLY kind (a flow's own
 * file cannot say it is trigger-entered — there is no trigger station, and
 * triggers are outbound), so this is the exact shape an operator authors by
 * hand, and it is the shape a derivation must not touch.
 */
test('(a) a DECLARED kickoff is authoritative — the derivation fills an absence, it never rewrites', () => {
  const declared = flow({
    kickoff: { kind: 'trigger-only' },
    nodes: [{ id: 'architect', agent: 'architect', gate: 'plan' }, { id: 'plan', agent: 'plan' }],
    edges: [{ from: 'architect', to: 'plan', artifact: 'plan' }],
  });
  assert.deepEqual(
    deriveFlowKickoff(declared, AGENTS),
    { kind: 'trigger-only' },
    'a derivation that returned `idea` here would silently retarget a hand-authored launch surface',
  );
});

/**
 * (d) THE SHIPPED-FLOW CONTROL. The repo holds exactly two flows whose kickoff
 * kind was decided by a human and has been live since Stage C. A derivation
 * that disagrees with either of them is wrong about the product, whatever the
 * unit fixtures say — so this reads them off disk with the real loader and the
 * real roster shape, and requires agreement. It is also what makes the
 * `initiative-select` row non-decorative: `forge-develop`'s head is
 * `developer-ralph`, and nothing else in the repo has that shape.
 */
test('(d) both shipped flows derive exactly the kind their YAML declares', () => {
  for (const [id, expected] of [['forge-architect', 'idea'], ['forge-develop', 'initiative-select']] as const) {
    const def = loadFlowDefinition(join(REPO_ROOT, 'studio', 'flows', id, 'flow.yaml'));
    assert.deepEqual(def.kickoff, { kind: expected }, `${id}/flow.yaml no longer declares ${expected}`);
    const { kickoff: _declared, ...undeclared } = def;
    assert.deepEqual(
      deriveFlowKickoff(undeclared, AGENTS),
      { kind: expected },
      `the derivation disagrees with the shipped ${id} flow`,
    );
  }
});
