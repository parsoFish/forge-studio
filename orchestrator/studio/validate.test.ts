/**
 * Tests for orchestrator/studio/validate.ts
 * One test per rule, fixtures as plain typed objects.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AgentDefinition,
  Catalog,
  FlowDefinition,
  KbDescriptor,
  ProjectDefinition,
} from './types.ts';
import { SURFACE_KINDS } from './registry.ts';
import {
  SLUG_RE,
  validateAgent,
  validateArtifactRef,
  validateArtifactTemplate,
  validateCatalog,
  validateFlow,
  validateKb,
  validateProject,
  validateDiscoveredProjects,
} from './validate.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'my-agent',
    name: 'My Agent',
    description: 'An agent.',
    purpose: 'Do things.',
    composition: { skills: ['demo'], tools: [], mcps: [], hooks: ['event-log'] },
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

function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [{ id: 'Read', name: 'Read' }],
    mcps: [],
    hooks: [{ id: 'event-log', name: 'Event Log' }],
    path: '/studio/catalog.yaml',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SLUG_RE
// ---------------------------------------------------------------------------

describe('SLUG_RE', () => {
  it('matches lowercase-starting slug with hyphens and digits', () => {
    assert.ok(SLUG_RE.test('my-agent'));
    assert.ok(SLUG_RE.test('developer-ralph'));
    assert.ok(SLUG_RE.test('agent1'));
  });

  it('rejects slugs starting with uppercase, underscore, digit', () => {
    assert.ok(!SLUG_RE.test('My_Agent'));
    assert.ok(!SLUG_RE.test('1agent'));
    assert.ok(!SLUG_RE.test('_agent'));
  });

  it('rejects consecutive hyphens and trailing hyphens', () => {
    assert.ok(!SLUG_RE.test('my--agent'));
    assert.ok(!SLUG_RE.test('agent-'));
  });

  it('accepts single-char slug and multi-segment slugs', () => {
    assert.ok(SLUG_RE.test('a'));
    assert.ok(SLUG_RE.test('forge-cycle'));
    assert.ok(SLUG_RE.test('claude-harness'));
  });
});

// ---------------------------------------------------------------------------
// validateAgent — readiness checks
// ---------------------------------------------------------------------------

describe('validateAgent — readiness/purpose', () => {
  it('missing purpose → error readiness/purpose', () => {
    const findings = validateAgent(makeAgent({ purpose: '' }));
    const f = findings.find((x) => x.check === 'readiness/purpose');
    assert.ok(f, 'expected readiness/purpose finding');
    assert.equal(f.level, 'error');
    assert.ok(f.object.startsWith('agent:'));
  });

  it('blank-only purpose → error readiness/purpose', () => {
    const findings = validateAgent(makeAgent({ purpose: '   ' }));
    const f = findings.find((x) => x.check === 'readiness/purpose');
    assert.ok(f, 'expected readiness/purpose finding');
    assert.equal(f.level, 'error');
  });

  it('non-empty purpose → no readiness/purpose finding', () => {
    const findings = validateAgent(makeAgent({ purpose: 'Do things.' }));
    assert.ok(!findings.some((x) => x.check === 'readiness/purpose'));
  });
});

describe('validateAgent — readiness/skill', () => {
  it('empty composition.skills → flag readiness/skill', () => {
    const findings = validateAgent(
      makeAgent({ composition: { skills: [], tools: [], mcps: [], hooks: ['event-log'] } }),
    );
    const f = findings.find((x) => x.check === 'readiness/skill');
    assert.ok(f, 'expected readiness/skill finding');
    assert.equal(f.level, 'flag');
  });

  it('non-empty composition.skills → no readiness/skill finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/skill'));
  });
});

describe('validateAgent — readiness/hook', () => {
  it('empty composition.hooks → flag readiness/hook', () => {
    const findings = validateAgent(
      makeAgent({ composition: { skills: ['demo'], tools: [], mcps: [], hooks: [] } }),
    );
    const f = findings.find((x) => x.check === 'readiness/hook');
    assert.ok(f, 'expected readiness/hook finding');
    assert.equal(f.level, 'flag');
  });

  it('non-empty composition.hooks → no readiness/hook finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/hook'));
  });
});

describe('validateAgent — readiness/process', () => {
  it('blank body → error readiness/process', () => {
    const findings = validateAgent(makeAgent({ body: '' }));
    const f = findings.find((x) => x.check === 'readiness/process');
    assert.ok(f, 'expected readiness/process finding');
    assert.equal(f.level, 'error');
  });

  it('whitespace-only body → error readiness/process', () => {
    const findings = validateAgent(makeAgent({ body: '\n\n   \n' }));
    const f = findings.find((x) => x.check === 'readiness/process');
    assert.ok(f, 'expected readiness/process finding');
    assert.equal(f.level, 'error');
  });

  it('non-empty body → no readiness/process finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/process'));
  });
});

describe('validateAgent — readiness/interactivity', () => {
  it('blank interactivity → error readiness/interactivity', () => {
    const findings = validateAgent(makeAgent({ interactivity: '' }));
    const f = findings.find((x) => x.check === 'readiness/interactivity');
    assert.ok(f, 'expected readiness/interactivity finding');
    assert.equal(f.level, 'error');
  });

  it('non-empty interactivity → no readiness/interactivity finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/interactivity'));
  });
});

// ---------------------------------------------------------------------------
// validateAgent — surface/enum (R2-01-F5)
// ---------------------------------------------------------------------------

describe('validateAgent — surface/enum', () => {
  for (const value of SURFACE_KINDS) {
    it(`valid surface "${value}" → no surface/enum finding`, () => {
      const findings = validateAgent(makeAgent({ surface: value }));
      assert.ok(!findings.some((x) => x.check === 'surface/enum'));
    });
  }

  it('absent surface → no surface/enum finding', () => {
    const findings = validateAgent(makeAgent({ surface: undefined }));
    assert.ok(!findings.some((x) => x.check === 'surface/enum'));
  });

  it('unknown surface value → blocking surface/enum finding', () => {
    const findings = validateAgent(makeAgent({ surface: 'bogus' }));
    const f = findings.find((x) => x.check === 'surface/enum');
    assert.ok(f, 'expected surface/enum finding');
    assert.equal(f.level, 'error');
    assert.ok(f.object.startsWith('agent:'));
    assert.match(f.message, /unknown surface "bogus"/);
    assert.match(f.message, new RegExp(SURFACE_KINDS.join('\\|')));
  });

  it('blank/whitespace-only surface → no surface/enum finding (treated as absent)', () => {
    const findings = validateAgent(makeAgent({ surface: '   ' }));
    assert.ok(!findings.some((x) => x.check === 'surface/enum'));
  });
});

describe('validateAgent — readiness/runtime', () => {
  it('strategy:fixed with no model → error readiness/runtime', () => {
    const findings = validateAgent(
      makeAgent({ runtime: { sdk: 'claude', strategy: 'fixed' } }),
    );
    const f = findings.find((x) => x.check === 'readiness/runtime');
    assert.ok(f, 'expected readiness/runtime finding');
    assert.equal(f.level, 'error');
  });

  it('strategy:range with empty range → error readiness/runtime', () => {
    const findings = validateAgent(
      makeAgent({ runtime: { sdk: 'claude', strategy: 'range', range: [] } }),
    );
    const f = findings.find((x) => x.check === 'readiness/runtime');
    assert.ok(f, 'expected readiness/runtime finding');
    assert.equal(f.level, 'error');
  });

  it('strategy:range with non-empty range → no readiness/runtime finding', () => {
    const findings = validateAgent(
      makeAgent({ runtime: { sdk: 'claude', strategy: 'range', range: ['claude-sonnet-4-6'] } }),
    );
    assert.ok(!findings.some((x) => x.check === 'readiness/runtime'));
  });

  it('strategy:fixed with model set → no readiness/runtime finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/runtime'));
  });
});

describe('validateAgent — runtime model-catalog (when validModelIds provided)', () => {
  const valid = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);

  it('fixed model not in catalog → error runtime/model-catalog', () => {
    const findings = validateAgent(
      makeAgent({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-ghost-9' } }),
      valid,
    );
    const f = findings.find((x) => x.check === 'runtime/model-catalog');
    assert.ok(f, 'expected runtime/model-catalog finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('claude-ghost-9'));
  });

  it('range entry not in catalog → error runtime/range-catalog', () => {
    const findings = validateAgent(
      makeAgent({
        runtime: {
          sdk: 'claude',
          strategy: 'range',
          range: ['claude-haiku-4-5-20251001', 'claude-ghost-9'],
        },
      }),
      valid,
    );
    const f = findings.find((x) => x.check === 'runtime/range-catalog');
    assert.ok(f, 'expected runtime/range-catalog finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('claude-ghost-9'));
  });

  it('all referenced model ids valid → no *-catalog findings', () => {
    const findings = validateAgent(
      makeAgent({
        runtime: {
          sdk: 'claude',
          strategy: 'range',
          range: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
        },
      }),
      valid,
    );
    assert.ok(!findings.some((x) => x.check.endsWith('-catalog')));
  });

  it('validModelIds omitted → no model-catalog check (backward compatible)', () => {
    const findings = validateAgent(
      makeAgent({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-ghost-9' } }),
    );
    assert.ok(!findings.some((x) => x.check.endsWith('-catalog')));
  });
});

describe('validateAgent — slug', () => {
  it('slug not matching SLUG_RE → error slug', () => {
    const findings = validateAgent(makeAgent({ slug: 'My_Agent' }));
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('My_Agent'));
  });

  it('valid slug → no slug finding', () => {
    const findings = validateAgent(makeAgent({ slug: 'my-agent' }));
    assert.ok(!findings.some((x) => x.check === 'slug'));
  });
});

describe('validateAgent — fully-ready agent', () => {
  it('fully-ready agent with populated skills+hooks → [] findings', () => {
    const findings = validateAgent(makeAgent());
    assert.deepEqual(findings, []);
  });

  it('fully-ready agent with empty skills+hooks → flags only (2), no errors', () => {
    const findings = validateAgent(
      makeAgent({ composition: { skills: [], tools: [], mcps: [], hooks: [] } }),
    );
    assert.ok(findings.every((f) => f.level === 'flag'));
    assert.equal(findings.length, 2);
  });
});

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

  it('node with fanOut and matching inbound artifact → no fan-out finding', () => {
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
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'fan-out'));
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

// ---------------------------------------------------------------------------
// validateKb
// ---------------------------------------------------------------------------

describe('validateKb — slug', () => {
  it('id failing SLUG_RE → error slug', () => {
    const kb: KbDescriptor = {
      id: 'Cycles_KB',
      name: 'Cycles',
      scope: 'flow',
      desc: 'Patterns.',
      path: '/brain/cycles/kb.yaml',
    };
    const findings = validateKb(kb);
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('Cycles_KB'));
  });

  it('valid kb → no findings', () => {
    const kb: KbDescriptor = {
      id: 'cycles',
      name: 'Cycles',
      scope: 'flow',
      desc: 'Patterns.',
      path: '/brain/cycles/kb.yaml',
    };
    const findings = validateKb(kb);
    assert.deepEqual(findings, []);
  });
});

// ---------------------------------------------------------------------------
// validateCatalog
// ---------------------------------------------------------------------------

describe('validateArtifactTemplate', () => {
  const base = { id: 'plan', name: 'Plan', kind: 'file' as const, schema: {}, body: '', path: '/x/plan.md' };

  it('bad slug id → error slug', () => {
    assert.ok(validateArtifactTemplate({ ...base, id: 'Bad Id' }).some((f) => f.check === 'slug'));
  });

  it('bad producer slug → error producer/slug', () => {
    assert.ok(validateArtifactTemplate({ ...base, producer: 'Bad Slug' }).some((f) => f.check === 'producer/slug'));
  });

  it('valid template → no findings', () => {
    assert.deepEqual(
      validateArtifactTemplate({ ...base, producer: 'architect', consumer: 'project-manager' }),
      [],
    );
  });
});

describe('validateArtifactRef', () => {
  it('edge artifact with no template → advisory artifact/no-template', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', agent: 'x' },
        { id: 'b', agent: 'y' },
      ],
      edges: [{ from: 'a', to: 'b', artifact: 'ghost' }],
    });
    const f = validateArtifactRef(flow, new Set(['plan'])).find((x) => x.check === 'artifact/no-template');
    assert.ok(f, 'expected artifact/no-template finding');
    assert.equal(f.level, 'flag');
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

describe('validateCatalog — model-sdk', () => {
  it('model with sdk not among declared sdk ids → error model-sdk', () => {
    const catalog = makeCatalog({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet', sdk: 'nope', tier: 'sonnet' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'model-sdk');
    assert.ok(f, 'expected model-sdk finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('nope') && f.message.includes('claude-sonnet-4-6'));
  });

  it('model with valid sdk → no model-sdk finding', () => {
    const findings = validateCatalog(makeCatalog());
    assert.ok(!findings.some((x) => x.check === 'model-sdk'));
  });
});

describe('validateCatalog — unique-ids', () => {
  it('duplicate model ids → error unique-ids', () => {
    const catalog = makeCatalog({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet', sdk: 'claude', tier: 'sonnet' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet Dup', sdk: 'claude', tier: 'sonnet' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('claude-sonnet-4-6'));
  });

  it('duplicate sdk ids → error unique-ids', () => {
    const catalog = makeCatalog({
      sdks: [
        { id: 'claude', name: 'Claude', available: true },
        { id: 'claude', name: 'Claude Dup', available: false },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
  });

  it('duplicate hook ids → error unique-ids', () => {
    const catalog = makeCatalog({
      hooks: [
        { id: 'event-log', name: 'Event Log' },
        { id: 'event-log', name: 'Event Log Dup' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
  });

  it('clean catalog → no findings', () => {
    const findings = validateCatalog(makeCatalog());
    assert.deepEqual(findings, []);
  });
});

// ---------------------------------------------------------------------------
// validateDiscoveredProjects
// ---------------------------------------------------------------------------

describe('validateCatalog — community-skills', () => {
  it('duplicate community-skill id → error unique-ids', () => {
    const findings = validateCatalog(
      makeCatalog({
        communitySkills: [
          { id: 'handoff', name: 'Handoff', provenance: 'a', source: 'u', category: 'memory' },
          { id: 'handoff', name: 'Handoff 2', provenance: 'b', source: 'u', category: 'memory' },
        ],
      }),
    );
    assert.ok(findings.some((f) => f.check === 'unique-ids' && f.message.includes('communitySkills')));
  });

  it('invalid tier → error community-skill/tier', () => {
    const findings = validateCatalog(
      makeCatalog({
        communitySkills: [
          { id: 'handoff', name: 'Handoff', provenance: 'a', source: 'u', category: 'memory', tier: 'turbo' },
        ],
      }),
    );
    const f = findings.find((x) => x.check === 'community-skill/tier');
    assert.ok(f, 'expected community-skill/tier finding');
    assert.equal(f.level, 'error');
  });

  it('composedBy with bad slug → error community-skill/composed-by', () => {
    const findings = validateCatalog(
      makeCatalog({
        communitySkills: [
          { id: 'handoff', name: 'Handoff', provenance: 'a', source: 'u', category: 'memory', composedBy: ['Bad Slug'] },
        ],
      }),
    );
    assert.ok(findings.some((f) => f.check === 'community-skill/composed-by'));
  });

  it('valid community skills → no community-skill findings', () => {
    const findings = validateCatalog(
      makeCatalog({
        communitySkills: [
          {
            id: 'handoff',
            name: 'Handoff',
            provenance: 'obra/superpowers',
            source: 'https://example',
            category: 'memory',
            tier: 'haiku',
            composedBy: ['developer-ralph'],
          },
        ],
      }),
    );
    assert.ok(!findings.some((f) => f.check.startsWith('community-skill')));
  });
});

describe('validateDiscoveredProjects — unique-ids', () => {
  it('duplicate project id → error unique-ids', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
      { id: 'betterado', path: 'projects/betterado-2', hasConfig: true },
    ]);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('betterado'));
  });

  it('unique project ids → no unique-ids finding', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
      { id: 'claude-harness', path: 'projects/claude-harness', hasConfig: true },
    ]);
    assert.ok(!findings.some((x) => x.check === 'unique-ids'));
  });
});

describe('validateDiscoveredProjects — slug', () => {
  it('id failing SLUG_RE → error slug', () => {
    const findings = validateDiscoveredProjects([
      { id: 'My_Project', path: 'projects/my', hasConfig: true },
    ]);
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('My_Project'));
  });

  it('clean, configured projects → no findings', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
    ]);
    assert.deepEqual(findings, []);
  });
});

describe('validateDiscoveredProjects — missing config', () => {
  it('project dir without .forge/project.json → flag missing-config', () => {
    const findings = validateDiscoveredProjects([
      { id: 'half-onboarded', path: 'projects/half-onboarded', hasConfig: false },
    ]);
    const f = findings.find((x) => x.check === 'missing-config');
    assert.ok(f, 'expected missing-config finding');
    assert.equal(f.level, 'flag');
    assert.ok(f.message.includes('half-onboarded'));
  });

  it('zero projects → no findings', () => {
    assert.deepEqual(validateDiscoveredProjects([]), []);
  });
});

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    id: 'my-project',
    name: 'My Project',
    northStar: 'Build something great.',
    instructions: 'Always write tests.',
    demoProcess: [{ kind: 'capture', text: 'Screenshot home.' }],
    skills: ['demo'],
    kb: null,
    ...overrides,
  };
}

describe('validateProject — slug', () => {
  it('id not matching SLUG_RE → error slug', () => {
    const findings = validateProject(makeProject({ id: 'My_Project' }));
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('My_Project'));
  });

  it('valid id → no slug finding', () => {
    const findings = validateProject(makeProject());
    assert.ok(!findings.some((x) => x.check === 'slug'));
  });
});

describe('validateProject — readiness/north-star', () => {
  it('empty northStar → flag readiness/north-star', () => {
    const findings = validateProject(makeProject({ northStar: '' }));
    const f = findings.find((x) => x.check === 'readiness/north-star');
    assert.ok(f, 'expected readiness/north-star finding');
    assert.equal(f.level, 'flag');
    assert.ok(f.object.startsWith('project:'));
  });

  it('northStar > 140 chars → error readiness/north-star', () => {
    const findings = validateProject(makeProject({ northStar: 'x'.repeat(141) }));
    const f = findings.find((x) => x.check === 'readiness/north-star');
    assert.ok(f, 'expected readiness/north-star finding');
    assert.equal(f.level, 'error');
  });

  it('northStar exactly 140 chars → no readiness/north-star finding', () => {
    const findings = validateProject(makeProject({ northStar: 'x'.repeat(140) }));
    assert.ok(!findings.some((x) => x.check === 'readiness/north-star'));
  });

  it('non-empty northStar ≤ 140 → no readiness/north-star finding', () => {
    const findings = validateProject(makeProject());
    assert.ok(!findings.some((x) => x.check === 'readiness/north-star'));
  });
});

describe('validateProject — demoProcess kinds', () => {
  it('demoProcess step with invalid kind → error demoProcess/kind', () => {
    const findings = validateProject(
      makeProject({ demoProcess: [{ kind: 'invalid' as never, text: 'step' }] }),
    );
    const f = findings.find((x) => x.check === 'demoProcess/kind');
    assert.ok(f, 'expected demoProcess/kind finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('invalid'));
  });

  it('demoProcess with all valid kinds → no demoProcess/kind finding', () => {
    const findings = validateProject(
      makeProject({
        demoProcess: [
          { kind: 'capture', text: 'a' },
          { kind: 'verify', text: 'b' },
          { kind: 'present', text: 'c' },
        ],
      }),
    );
    assert.ok(!findings.some((x) => x.check === 'demoProcess/kind'));
  });

  it('empty demoProcess array → no demoProcess/kind finding', () => {
    const findings = validateProject(makeProject({ demoProcess: [] }));
    assert.ok(!findings.some((x) => x.check === 'demoProcess/kind'));
  });
});

describe('validateProject — skills', () => {
  it('skills array containing a non-string entry → error skills/type', () => {
    const findings = validateProject(
      makeProject({ skills: [42 as unknown as string, 'demo'] }),
    );
    const f = findings.find((x) => x.check === 'skills/type');
    assert.ok(f, 'expected skills/type finding');
    assert.equal(f.level, 'error');
  });

  it('skills array of strings → no skills/type finding', () => {
    const findings = validateProject(makeProject({ skills: ['demo', 'tdd-workflow'] }));
    assert.ok(!findings.some((x) => x.check === 'skills/type'));
  });

  it('empty skills array → no skills/type finding', () => {
    const findings = validateProject(makeProject({ skills: [] }));
    assert.ok(!findings.some((x) => x.check === 'skills/type'));
  });
});

describe('validateProject — fully valid project', () => {
  it('fully-valid project → [] findings', () => {
    const findings = validateProject(makeProject());
    assert.deepEqual(findings, []);
  });
});
