/**
 * Tests for `validate-flow.ts` — the flow's STRUCTURE rules (version, slug,
 * nodes, edges, acyclicity, fan-out, gates, kickoff) plus `validateArtifactRef`.
 * The trigger rules are the sibling file `validate-flow-triggers.test.ts`; this
 * file was split when the move brought it past the 800-line cap.
 *
 * One test per rule, fixtures as plain typed objects. Moved verbatim from `apps/forge/validate.test.ts` with the validator
 * itself (T1 ruling 159): the tests follow their subject into the package that
 * owns the flow semantics they assert on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import { validateArtifactRef, validateFlow } from './validate-flow.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'my-agent',
    name: 'My Agent',
    description: 'An agent.',
    purpose: 'Do things.',
    composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log'] },
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

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'my-flow',
    name: 'My Flow',
    version: 1,
    goal: 'Do something.',
    project: null,
    kb: null,
    costCeilingUsd: 10,
    origin: 'seed',
    nodes: [
      { id: 'step-a', agent: 'my-agent' },
      { id: 'gate', gate: 'verdict' },
    ],
    edges: [{ from: 'step-a', to: 'gate', artifact: 'result' }],
    triggers: [],
    path: '/studio/flows/my-flow/flow.yaml',
    ...overrides,
  };
}

function makeAgentMap(...agents: AgentDefinition[]): ReadonlyMap<string, AgentDefinition> {
  return new Map(agents.map((a) => [a.slug, a]));
}

// ---------------------------------------------------------------------------
// validateFlow
// ---------------------------------------------------------------------------

describe('validateFlow — version', () => {
  it('version < 1 → error version', () => {
    const findings = validateFlow(makeFlow({ version: 0 }), makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'version');
    assert.ok(f, 'expected version finding');
    assert.equal(f.level, 'error');
  });

  it('non-integer version → error version', () => {
    const findings = validateFlow(makeFlow({ version: 1.5 }), makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'version');
    assert.ok(f, 'expected version finding');
    assert.equal(f.level, 'error');
  });

  it('version 1 → no version finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'version'));
  });
});

describe('validateFlow — slug', () => {
  it('flow id not matching SLUG_RE → error slug', () => {
    const findings = validateFlow(makeFlow({ id: 'My_Flow' }), makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('My_Flow'));
  });

  it('valid flow id → no slug finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'slug'));
  });
});

describe('validateFlow — duplicate node ids', () => {
  it('duplicate node ids → error node-ids', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'step-a', agent: 'my-agent' },
        { id: 'step-a', agent: 'my-agent' },
      ],
      edges: [],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'node-ids');
    assert.ok(f, 'expected node-ids finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('step-a'));
  });

  it('unique node ids → no node-ids finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'node-ids'));
  });
});

describe('validateFlow — node shape', () => {
  it('node with neither agent nor gate → error node-shape', () => {
    const flow = makeFlow({
      nodes: [{ id: 'bare' }, { id: 'gate', gate: 'verdict' }],
      edges: [],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'node-shape');
    assert.ok(f, 'expected node-shape finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('bare'));
  });

  it('gate-only node (gate set, no agent) → NO node-shape error', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'step-a', agent: 'my-agent' },
        { id: 'review', gate: 'verdict' },
      ],
      edges: [{ from: 'step-a', to: 'review', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'node-shape'));
  });

  it('node with agent and gate set → no node-shape error (both present is valid)', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'step-a', agent: 'my-agent', gate: 'plan' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [{ from: 'step-a', to: 'gate', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'node-shape'));
  });
});

describe('validateFlow — agent-ref', () => {
  it('node.agent slug absent from agents map → error agent-ref', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'step-a', agent: 'unknown-agent' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [{ from: 'step-a', to: 'gate', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'agent-ref');
    assert.ok(f, 'expected agent-ref finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('unknown-agent'));
  });

  it('node.agent slug present in agents map → no agent-ref finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'agent-ref'));
  });
});

describe('validateFlow — node-executor (R2-01-F2; descriptor-sourced R2-02-F3)', () => {
  it('node references an interactive agent with no declared executor → error node-executor', () => {
    const interactiveAgent = makeAgent({ slug: 'my-agent', surface: 'interactive' });
    const findings = validateFlow(makeFlow(), makeAgentMap(interactiveAgent));
    const f = findings.find((x) => x.check === 'node-executor');
    assert.ok(f, 'expected node-executor finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('my-agent'));
    assert.ok(f.message.includes('interactive'));
  });

  it('node references an unattended agent with no declared executor → no node-executor finding', () => {
    const unattendedAgent = makeAgent({ slug: 'my-agent', surface: 'unattended' });
    const findings = validateFlow(makeFlow(), makeAgentMap(unattendedAgent));
    assert.ok(!findings.some((x) => x.check === 'node-executor'));
  });

  it('node references an interactive agent that DOES declare an executor (a phase agent) → no node-executor finding', () => {
    const phaseAgent = makeAgent({ slug: 'my-agent', surface: 'interactive', executor: 'pm' });
    const findings = validateFlow(makeFlow(), makeAgentMap(phaseAgent));
    assert.ok(!findings.some((x) => x.check === 'node-executor'));
  });

  it('node references an unknown agent slug → no node-executor finding (agent-ref already covers it)', () => {
    const flow = makeFlow({
      nodes: [{ id: 'step-a', agent: 'ghost-agent' }, { id: 'gate', gate: 'verdict' }],
      edges: [{ from: 'step-a', to: 'gate', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'node-executor'));
  });

  it('node references a surface:"both" agent with no declared executor → no node-executor finding (agentCapabilityDescriptor treats "both" as unattended, per derive.ts)', () => {
    const bothAgent = makeAgent({ slug: 'my-agent', surface: 'both' });
    const findings = validateFlow(makeFlow(), makeAgentMap(bothAgent));
    assert.ok(!findings.some((x) => x.check === 'node-executor'));
  });
});

describe('validateFlow — edge-ref', () => {
  it('edge.from referencing unknown node id → error edge-ref', () => {
    const flow = makeFlow({
      nodes: [{ id: 'step-a', agent: 'my-agent' }, { id: 'gate', gate: 'verdict' }],
      edges: [{ from: 'nonexistent', to: 'gate', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'edge-ref');
    assert.ok(f, 'expected edge-ref finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('nonexistent'));
  });

  it('edge.to referencing unknown node id → error edge-ref', () => {
    const flow = makeFlow({
      nodes: [{ id: 'step-a', agent: 'my-agent' }, { id: 'gate', gate: 'verdict' }],
      edges: [{ from: 'step-a', to: 'nowhere', artifact: 'result' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'edge-ref');
    assert.ok(f, 'expected edge-ref finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('nowhere'));
  });

  it('all edge endpoints reference valid node ids → no edge-ref finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'edge-ref'));
  });
});

describe('validateFlow — edge-artifact (bead forge-8vfn.5.12.1, half (b))', () => {
  // The save route (`PUT /api/studio/flows/:id`) runs validateFlow and nothing
  // else; `validateArtifactRef` is `forge studio lint`-only. So an edge with no
  // artifact label passed validation, `serializeFlowDefinition` wrote
  // `edges: [{from,to}]`, and the very next read — `parseFlowEdge`'s
  // `reqString(e,'artifact')` — THREW. `loadAllFlows` caught it and SKIPPED the
  // flow, so the page the operator was just redirected to rendered
  // `data-page="not-found"`: the flow they had built, saved successfully, was
  // invisible.
  //
  // These pins hold the writer to the READER'S OWN PREDICATE. `reqString`
  // (packages/kernel/studio/yaml-fields.ts:12) rejects a non-string or an empty
  // string and nothing else — so this check must reject exactly those, no more.
  // A trimming check would refuse `' '`, which the loader accepts, and the two
  // would disagree again in the opposite direction.

  it('edge with an empty artifact → error edge-artifact naming the edge', () => {
    const flow = makeFlow({
      edges: [{ from: 'step-a', to: 'gate', artifact: '' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'edge-artifact');
    assert.ok(f, 'expected edge-artifact finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('step-a'), f.message);
    assert.ok(f.message.includes('gate'), f.message);
  });

  it('edge with NO artifact key at all → error edge-artifact (the builder\'s real shape)', () => {
    // `rfEdgesToFlow` maps `artifact: e.data?.artifact`, which is `undefined`
    // for an edge the declared connect handle drew or the picker left
    // unlabelled. The type says `artifact: string`; the PUT route receives JSON
    // from a browser, so the cast is what actually crosses the boundary.
    const flow = makeFlow({
      edges: [{ from: 'step-a', to: 'gate' } as unknown as FlowDefinition['edges'][number]],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'edge-artifact');
    assert.ok(f, 'expected edge-artifact finding');
    assert.equal(f.level, 'error');
  });

  it('edge whose artifact is not a string → error edge-artifact', () => {
    const flow = makeFlow({
      edges: [{ from: 'step-a', to: 'gate', artifact: 7 } as unknown as FlowDefinition['edges'][number]],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(findings.some((x) => x.check === 'edge-artifact'));
  });

  it('whitespace-only artifact → NO edge-artifact finding, because the loader accepts it', () => {
    // Deliberate, and the reason it is a test: the check mirrors `reqString`,
    // which does not trim. Refusing `' '` here would make the save route
    // stricter than the reader — the same disagreement this bead exists to
    // close, pointing the other way.
    const flow = makeFlow({
      edges: [{ from: 'step-a', to: 'gate', artifact: ' ' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'edge-artifact'));
  });

  it('every edge labelled → no edge-artifact finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'edge-artifact'));
  });
});

describe('validateFlow — acyclic', () => {
  it('cycle a→b→a → error acyclic', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', agent: 'my-agent' },
        { id: 'b', agent: 'my-agent' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [
        { from: 'a', to: 'b', artifact: 'x' },
        { from: 'b', to: 'a', artifact: 'y' },
        { from: 'b', to: 'gate', artifact: 'z' },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'acyclic');
    assert.ok(f, 'expected acyclic finding');
    assert.equal(f.level, 'error');
  });

  it('linear a→b→c (no cycle) → no acyclic finding', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', agent: 'my-agent' },
        { id: 'b', agent: 'my-agent' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [
        { from: 'a', to: 'b', artifact: 'x' },
        { from: 'b', to: 'gate', artifact: 'y' },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'acyclic'));
  });
});

describe('validateFlow — fan-out', () => {
  it('node with fanOut but no inbound edge with matching artifact → error fan-out', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'pm', agent: 'my-agent' },
        { id: 'dev', agent: 'my-agent', fanOut: 'work-items' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [
        { from: 'pm', to: 'dev', artifact: 'plan' }, // artifact 'plan', not 'work-items'
        { from: 'dev', to: 'gate', artifact: 'result' },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'fan-out');
    assert.ok(f, 'expected fan-out finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('work-items'));
  });

  it('node with fanOut and matching inbound artifact on a fanout-capable agent → no fan-out/capability finding', () => {
    const fanoutAgent = makeAgent({ fanout: { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 1 } });
    const flow = makeFlow({
      nodes: [
        { id: 'pm', agent: 'my-agent' },
        { id: 'dev', agent: 'my-agent', fanOut: 'work-items' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [
        { from: 'pm', to: 'dev', artifact: 'work-items' },
        { from: 'dev', to: 'gate', artifact: 'result' },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(fanoutAgent));
    assert.ok(!findings.some((x) => x.check === 'fan-out' || x.check === 'fanout-capability'));
  });

  // R2-03-F2 — the fanout-capability check
  it('fanOut targeting a NON-fanout-capable agent → error fanout-capability', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'pm', agent: 'my-agent' },
        { id: 'dev', agent: 'my-agent', fanOut: 'work-items' },
        { id: 'gate', gate: 'verdict' },
      ],
      edges: [
        { from: 'pm', to: 'dev', artifact: 'work-items' },
        { from: 'dev', to: 'gate', artifact: 'result' },
      ],
    });
    // makeAgent() has no fanout: block ⇒ not fanout-capable.
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'fanout-capability');
    assert.ok(f, 'expected fanout-capability finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /not fanout-capable/);
  });
});

describe('validateFlow — zero-gate', () => {
  it('no gate nodes and disposable falsy → error zero-gate', () => {
    const flow = makeFlow({
      nodes: [{ id: 'step-a', agent: 'my-agent' }],
      edges: [],
      disposable: false,
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'zero-gate');
    assert.ok(f, 'expected zero-gate finding');
    assert.equal(f.level, 'error');
  });

  it('no gate nodes and disposable absent → error zero-gate', () => {
    const flow = makeFlow({ nodes: [{ id: 'step-a', agent: 'my-agent' }], edges: [] });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'zero-gate');
    assert.ok(f, 'expected zero-gate finding');
    assert.equal(f.level, 'error');
  });

  it('no gate nodes and disposable: true → no zero-gate error', () => {
    const flow = makeFlow({
      nodes: [{ id: 'step-a', agent: 'my-agent' }],
      edges: [],
      disposable: true,
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'zero-gate'));
  });

  it('flow with at least one gate node → no zero-gate finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'zero-gate'));
  });
});

describe('validateFlow — kickoff', () => {
  it('each valid kickoff kind → no kickoff finding', () => {
    for (const kind of ['idea', 'initiative-select', 'trigger-only'] as const) {
      const findings = validateFlow(makeFlow({ kickoff: { kind } }), makeAgentMap(makeAgent()));
      assert.ok(!findings.some((x) => x.check === 'kickoff/kind'), `kind "${kind}" must be accepted`);
    }
  });

  it('unknown kickoff kind → error kickoff/kind', () => {
    const findings = validateFlow(
      makeFlow({ kickoff: { kind: 'bogus' as never } }),
      makeAgentMap(makeAgent()),
    );
    assert.ok(findings.some((x) => x.level === 'error' && x.check === 'kickoff/kind'));
  });

  it('absent kickoff → no kickoff finding', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'kickoff/kind'));
  });
});

describe('validateFlow — clean flow', () => {
  it('fully-valid flow with gate → no findings', () => {
    const findings = validateFlow(makeFlow(), makeAgentMap(makeAgent()));
    assert.deepEqual(findings, []);
  });
});

describe('validateArtifactRef', () => {
  // AT-38 (R3-06/R2-05-F1): promoted from advisory `flag` to `error`
  // (ADR-027 pre-authorised the promotion once all seed flows ship templates;
  // verified 2026-08 — `forge studio lint` reports 0 artifact/no-template
  // findings on the real repo). This is an intentional, recorded behaviour
  // change, not a regression — see docs/decisions/027 + R2-05-F1.
  it('AT-38: edge artifact with no template → ERROR artifact/no-template (promoted from flag)', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', agent: 'x' },
        { id: 'b', agent: 'y' },
      ],
      edges: [{ from: 'a', to: 'b', artifact: 'ghost' }],
    });
    const f = validateArtifactRef(flow, new Set(['plan'])).find((x) => x.check === 'artifact/no-template');
    assert.ok(f, 'expected artifact/no-template finding');
    assert.equal(f.level, 'error', 'artifact/no-template must now be an error, not an advisory flag');
  });

  it('edge artifact with a registered template → no findings', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', agent: 'x' },
        { id: 'b', agent: 'y' },
      ],
      edges: [{ from: 'a', to: 'b', artifact: 'plan' }],
    });
    assert.deepEqual(validateArtifactRef(flow, new Set(['plan'])), []);
  });
});
