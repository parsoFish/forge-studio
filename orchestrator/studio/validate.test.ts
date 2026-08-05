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
import { SURFACE_KINDS, PHASE_EXECUTOR_KINDS } from './registry.ts';
import { MATERIAL_KINDS } from './materials.ts';
import {
  SLUG_RE,
  validateAgent,
  validateArtifactRef,
  validateArtifactTemplate,
  validateCatalog,
  validateFlow,
  validateInstructionSeed,
  validateKb,
  validateLibraryFlag,
  validateProject,
  validateDiscoveredProjects,
} from './validate.ts';
import type { InstructionSeed } from './types.ts';

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

function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [{ id: 'Read', name: 'Read' }],
    mcps: [],
    guards: [{ id: 'event-log', name: 'Event Log', kind: 'toggle' }],
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
      makeAgent({ composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log'] } }),
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

describe('validateAgent — readiness/guard', () => {
  it('empty composition.guards → flag readiness/guard', () => {
    const findings = validateAgent(
      makeAgent({ composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: [] } }),
    );
    const f = findings.find((x) => x.check === 'readiness/guard');
    assert.ok(f, 'expected readiness/guard finding');
    assert.equal(f.level, 'flag');
  });

  it('non-empty composition.guards → no readiness/guard finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'readiness/guard'));
  });
});

describe('validateAgent — fanout/isolation (R2-03)', () => {
  it('shipped provider (worktree) → no fanout/isolation finding', () => {
    const findings = validateAgent(
      makeAgent({ fanout: { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 1 } }),
    );
    assert.ok(!findings.some((x) => x.check === 'fanout/isolation'));
  });

  it('none provider → no fanout/isolation finding', () => {
    const findings = validateAgent(
      makeAgent({ fanout: { drivingArtifact: 'work-items', isolation: 'none' } }),
    );
    assert.ok(!findings.some((x) => x.check === 'fanout/isolation'));
  });

  it('typo provider (worktre) → flag (soft, not error)', () => {
    const findings = validateAgent(
      makeAgent({ fanout: { drivingArtifact: 'work-items', isolation: 'worktre' } }),
    );
    const f = findings.find((x) => x.check === 'fanout/isolation');
    assert.ok(f, 'expected fanout/isolation finding');
    assert.equal(f.level, 'flag', 'isolation ref is open — an unknown value warns, never errors');
  });

  it('no fanout block → no fanout/isolation finding', () => {
    const findings = validateAgent(makeAgent());
    assert.ok(!findings.some((x) => x.check === 'fanout/isolation'));
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

// ---------------------------------------------------------------------------
// validateAgent — executor/enum (R2-01-F2 review finding)
// ---------------------------------------------------------------------------

describe('validateAgent — executor/enum', () => {
  for (const value of PHASE_EXECUTOR_KINDS) {
    it(`valid executor "${value}" → no executor/enum finding`, () => {
      const findings = validateAgent(makeAgent({ executor: value }));
      assert.ok(!findings.some((x) => x.check === 'executor/enum'));
    });
  }

  it('absent executor → no executor/enum finding', () => {
    const findings = validateAgent(makeAgent({ executor: undefined }));
    assert.ok(!findings.some((x) => x.check === 'executor/enum'));
  });

  it('unknown executor value → blocking executor/enum finding', () => {
    const findings = validateAgent(makeAgent({ executor: 'xyz' }));
    const f = findings.find((x) => x.check === 'executor/enum');
    assert.ok(f, 'expected executor/enum finding');
    assert.equal(f.level, 'error');
    assert.ok(f.object.startsWith('agent:'));
    assert.match(f.message, /unknown executor "xyz"/);
    assert.match(f.message, new RegExp(PHASE_EXECUTOR_KINDS.join('\\|')));
  });

  it('blank/whitespace-only executor → no executor/enum finding (treated as absent)', () => {
    const findings = validateAgent(makeAgent({ executor: '   ' }));
    assert.ok(!findings.some((x) => x.check === 'executor/enum'));
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
  it('fully-ready agent with populated skills+guards → [] findings', () => {
    const findings = validateAgent(makeAgent());
    assert.deepEqual(findings, []);
  });

  it('fully-ready agent with empty skills+guards → flags only (2), no errors', () => {
    const findings = validateAgent(
      makeAgent({ composition: { skills: [], tools: [], mcps: [], hooks: [], guards: [] } }),
    );
    assert.ok(findings.every((f) => f.level === 'flag'));
    assert.equal(findings.length, 2);
  });
});

// ---------------------------------------------------------------------------
// validateAgent — materials/enum (R2-09 D1)
// ---------------------------------------------------------------------------

describe('validateAgent — materials/enum', () => {
  it('an unknown material kind → exactly ONE error finding naming both the offending value AND the allowed set', () => {
    const agent = makeAgent({ materials: ['holograms'] });
    const findings = validateAgent(agent);
    const matEnum = findings.filter((f) => f.check === 'materials/enum');
    assert.equal(matEnum.length, 1);
    assert.equal(matEnum[0].level, 'error');
    assert.ok(matEnum[0].message.includes('holograms'), 'message must name the offending value');
    for (const kind of MATERIAL_KINDS) {
      assert.ok(
        matEnum[0].message.includes(kind),
        `message must list the full allowed set (missing "${kind}") — a sibling finding in this campaign named the value but not the set`,
      );
    }
  });

  it('all-valid kinds → zero materials/enum findings', () => {
    const findings = validateAgent(makeAgent({ materials: ['images', 'audio'] }));
    assert.deepEqual(findings.filter((f) => f.check === 'materials/enum'), []);
  });

  it('absent materials → zero materials/enum findings', () => {
    const findings = validateAgent(makeAgent());
    assert.deepEqual(findings.filter((f) => f.check === 'materials/enum'), []);
  });

  it('materials: [] → zero materials/enum findings (declared-empty is legal)', () => {
    const findings = validateAgent(makeAgent({ materials: [] }));
    assert.deepEqual(findings.filter((f) => f.check === 'materials/enum'), []);
  });

  it('two unknown values → two findings, one per value', () => {
    const findings = validateAgent(makeAgent({ materials: ['holograms', 'smells'] }));
    assert.equal(findings.filter((f) => f.check === 'materials/enum').length, 2);
  });
});

// ---------------------------------------------------------------------------
// validateLibraryFlag (R3-01-F2)
// ---------------------------------------------------------------------------

describe('validateLibraryFlag', () => {
  it('unset (key absent) → error', () => {
    const findings = validateLibraryFlag('my-agent', { name: 'my-agent' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'error');
    assert.equal(findings[0].object, 'agent:my-agent');
    assert.equal(findings[0].check, 'library');
  });

  it('non-boolean value → error', () => {
    const findings = validateLibraryFlag('my-agent', { library: 'true' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'error');
  });

  it('explicit true → clean', () => {
    assert.deepEqual(validateLibraryFlag('my-agent', { library: true }), []);
  });

  it('explicit false → clean', () => {
    assert.deepEqual(validateLibraryFlag('my-agent', { library: false }), []);
  });

  it('null/non-object frontmatter → error, no throw', () => {
    assert.equal(validateLibraryFlag('my-agent', null).length, 1);
    assert.equal(validateLibraryFlag('my-agent', undefined).length, 1);
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

// ---------------------------------------------------------------------------
// validateFlow — triggers (R2-04, ADR-041)
// ---------------------------------------------------------------------------

describe('validateFlow — trigger-kind', () => {
  it('bogus "on" value → error trigger-kind', () => {
    const flow = makeFlow({
      triggers: [{ on: 'bogus', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-kind');
    assert.ok(f, 'expected trigger-kind finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('bogus'));
  });

  it('shipped kind ("flow-complete") → no trigger-kind finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-kind'));
  });
});

describe('validateFlow — trigger-kind-reserved', () => {
  it('reserved kind (agent-complete) → error trigger-kind-reserved', () => {
    const flow = makeFlow({
      triggers: [{ on: 'agent-complete', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-kind-reserved');
    assert.ok(f, 'expected trigger-kind-reserved finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /schema-reserved/);
  });

  it('shipped kind ("merged") → no trigger-kind-reserved finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-kind-reserved'));
  });
});

describe('validateFlow — trigger-target', () => {
  it('flow target referencing its own flow → error trigger-target (self-loop)', () => {
    const flow = makeFlow({
      id: 'my-flow',
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'my-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /self-loop/);
  });

  it('flow target referencing an unregistered flow (flowIds provided) → error trigger-target', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'ghost-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow']) });
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('ghost-flow'));
  });

  it('flow target referencing an unregistered flow WITHOUT flowIds → no trigger-target finding (opts is optional)', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'ghost-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('agent target referencing an unknown agent → error trigger-target', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'ghost-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('ghost-agent'));
  });

  it('on:merged agent target with the reflection-close band → no trigger-target finding', () => {
    const reflectAgent = makeAgent({
      composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] },
    });
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent));
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('R4-09-F1: on:merged agent target WITHOUT the reflection-close band → error trigger-target', () => {
    // makeAgent's default guards are ['event-log'] — no reflection-close band —
    // so finalize-merged would never dispatch it; lint must reject it.
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /reflection-close/);
  });

  it('flow target referencing a real registered flow → no trigger-target finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
    });
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('trigger missing "target" entirely (hand-crafted PUT body) → error trigger-target, no thrown TypeError', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged' } as any],
    });
    assert.doesNotThrow(() => validateFlow(flow, makeAgentMap(makeAgent())));
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /missing a well-formed/);
  });
});

describe('validateFlow — trigger-cron', () => {
  const validCron = () => ({
    on: 'cron' as const,
    target: { kind: 'flow' as const, ref: 'other-flow' },
    schedule: '0 0 * * *',
    concurrency: 'forbid' as const,
  });

  it('missing schedule → error trigger-cron', () => {
    const t = validCron();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, schedule: undefined }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /schedule/);
  });

  it('unparseable schedule pattern → error trigger-cron', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...validCron(), schedule: 'not a cron pattern' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
  });

  it('concurrency "replace" → error trigger-cron (enum-reserved)', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...validCron(), concurrency: 'replace' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /enum-reserved/);
  });

  it('TARGET flow has no project → error trigger-cron (ADR-041: the mint uses the target flow project)', () => {
    // validCron targets `other-flow`; the DECLARING flow's project is irrelevant.
    const flow = makeFlow({ project: 'someproj', triggers: [validCron()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? null : 'someproj');
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /project/);
  });

  it('target flow HAS a project → no trigger-cron project finding (declaring flow project null is fine)', () => {
    const flow = makeFlow({ project: null, triggers: [validCron()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? 'someproj' : null);
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    assert.equal(findings.filter((x) => x.check === 'trigger-cron' && /project/.test(x.message)).length, 0);
  });

  it('no flowProjectOf supplied → project check skipped (single-flow PUT without registry)', () => {
    const flow = makeFlow({ project: null, triggers: [validCron()] });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.equal(findings.filter((x) => x.check === 'trigger-cron' && /project/.test(x.message)).length, 0);
  });

  it('fully-valid cron trigger → no trigger-cron finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [validCron()],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-cron'));
  });
});

describe('validateFlow — trigger-webhook', () => {
  const validWebhook = () => ({
    on: 'webhook' as const,
    target: { kind: 'flow' as const, ref: 'other-flow' },
    webhook: {
      id: 'push-hook',
      provider: 'github' as const,
      events: ['push' as const],
      secretEnv: 'WEBHOOK_SECRET',
      sources: ['org/repo'],
    },
  });

  it('missing webhook block → error trigger-webhook', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ on: 'webhook', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /webhook/);
  });

  it('bad id slug → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, id: 'Push_Hook' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('Push_Hook'));
  });

  it('bad provider → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, provider: 'bitbucket' as never } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('bitbucket'));
  });

  it('provider typo ("gitllab") is preserved, not silently coerced to "github" → error trigger-webhook matching /provider/', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, provider: 'gitllab' as any } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook' && /provider/.test(x.message));
    assert.ok(f, 'expected trigger-webhook provider finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('gitllab'));
  });

  it('empty events → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, events: [] } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /events/);
  });

  it('bad secretEnv (lowercase) → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, secretEnv: 'webhook_secret' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('webhook_secret'));
  });

  it('bad secretEnvPrevious (lowercase) → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, secretEnvPrevious: 'old_secret' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('old_secret'));
  });

  it('empty sources → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, sources: [] } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /sources/);
  });

  it('TARGET flow has no project → error trigger-webhook (ADR-041: the mint uses the target flow project)', () => {
    const flow = makeFlow({ project: 'someproj', triggers: [validWebhook()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? null : 'someproj');
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /project/);
  });

  it('webhook target flow HAS a project → no trigger-webhook project finding', () => {
    const flow = makeFlow({ project: null, triggers: [validWebhook()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? 'someproj' : null);
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    assert.equal(findings.filter((x) => x.check === 'trigger-webhook' && /project/.test(x.message)).length, 0);
  });

  it('fully-valid webhook trigger → no trigger-webhook finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [validWebhook()],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-webhook'));
  });

  // trigger-webhook-unique (cross-flow id uniqueness) is enforced in
  // cli/studio-lint.ts, which sees the full flow roster — validateFlow only
  // sees one flow at a time and cannot check it.
});

describe('validateFlow — trigger-shape', () => {
  it('cron fields on a flow-complete trigger → error trigger-shape (naming both stray fields)', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          schedule: '0 0 * * *',
          concurrency: 'forbid',
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const shapeFindings = findings.filter((x) => x.check === 'trigger-shape');
    assert.ok(shapeFindings.length >= 2, 'expected both stray schedule and concurrency findings');
    assert.ok(shapeFindings.every((f) => f.level === 'error'));
    assert.ok(shapeFindings.some((f) => f.message.includes('schedule')));
    assert.ok(shapeFindings.some((f) => f.message.includes('concurrency')));
  });

  it('webhook block on a non-webhook trigger → error trigger-shape', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          webhook: {
            id: 'push-hook',
            provider: 'github',
            events: ['push'],
            secretEnv: 'WEBHOOK_SECRET',
            sources: ['org/repo'],
          },
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-shape');
    assert.ok(f, 'expected trigger-shape finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /webhook/);
  });

  // R4-09-F3 — the reflect `mode` field
  const reflectAgent = () =>
    makeAgent({ composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] } });

  it('mode: automated on an on:merged reflect-agent target → no trigger-mode/shape finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' }, mode: 'automated' }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-mode' || x.check === 'trigger-shape'), `unexpected finding: ${JSON.stringify(findings)}`);
  });

  it('an invalid mode value → error trigger-mode', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' }, mode: 'bogus' as never }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent()));
    const f = findings.find((x) => x.check === 'trigger-mode');
    assert.ok(f, 'expected trigger-mode finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /interactive\|automated/);
  });

  it('mode on a non-merged / non-agent trigger → error trigger-shape', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' }, mode: 'automated' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-shape' && /mode/.test(x.message));
    assert.ok(f, 'expected trigger-shape finding for stray mode');
    assert.equal(f.level, 'error');
  });

  it('schedule/concurrency on cron, webhook block on webhook → no trigger-shape finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [
        {
          on: 'cron',
          target: { kind: 'flow', ref: 'other-flow' },
          schedule: '0 0 * * *',
          concurrency: 'forbid',
        },
        {
          on: 'webhook',
          target: { kind: 'flow', ref: 'other-flow' },
          webhook: {
            id: 'push-hook',
            provider: 'github',
            events: ['push'],
            secretEnv: 'WEBHOOK_SECRET',
            sources: ['org/repo'],
          },
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-shape'));
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
      binding: { kind: 'flow', ref: 'forge-develop' },
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
      binding: { kind: 'flow', ref: 'forge-develop' },
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

  it('duplicate guard ids → error unique-ids', () => {
    const catalog = makeCatalog({
      guards: [
        { id: 'event-log', name: 'Event Log', kind: 'toggle' },
        { id: 'event-log', name: 'Event Log Dup', kind: 'toggle' },
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

// ── runtime/loop-strategy (R4-01-F2 review finding) ────────────────────────
describe('validateAgent runtime/loop-strategy', () => {
  const inline = (slug: string, loopStrategy: string) => ({
    slug,
    name: slug,
    description: 'd',
    library: true,
    purpose: 'p',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log'] },
    runtime: { sdk: 'claude', strategy: 'fixed' as const, model: 'claude-sonnet-4-6', loopStrategy },
    brainAccess: 'none' as const,
    interactivity: 'autonomous',
    budgets: {},
    allowedTools: ['Read'],
    disallowedTools: [],
    body: 'b',
    path: `/skills/${slug}/SKILL.md`,
  });

  it('unknown loopStrategy value → runtime/loop-strategy error', () => {
    const findings = validateAgent(inline('some-agent', 'spiral'));
    assert.ok(findings.some((f) => f.check === 'runtime/loop-strategy' && f.level === 'error'));
  });

  it('ralph on a non-canonical slug → runtime/loop-strategy error', () => {
    const findings = validateAgent(inline('some-agent', 'ralph'));
    assert.ok(findings.some((f) => f.check === 'runtime/loop-strategy' && f.level === 'error'));
  });

  it('ralph on developer-ralph is clean; one-shot valid anywhere', () => {
    assert.ok(!validateAgent(inline('developer-ralph', 'ralph')).some((f) => f.check === 'runtime/loop-strategy'));
    assert.ok(!validateAgent(inline('some-agent', 'one-shot')).some((f) => f.check === 'runtime/loop-strategy'));
  });
});

// ── composition/band-guard + budgets/range (R4-01 whole-branch review) ──────
describe('validateAgent composition/band-guard + budgets/range', () => {
  const mk = (slug: string, over: Record<string, unknown> = {}) => ({
    slug,
    name: slug,
    description: 'd',
    library: true,
    purpose: 'p',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log'] },
    runtime: { sdk: 'claude', strategy: 'fixed' as const, model: 'claude-sonnet-4-6' },
    brainAccess: 'none' as const,
    interactivity: 'autonomous',
    budgets: {},
    allowedTools: ['Read'],
    disallowedTools: [],
    body: 'b',
    path: `/skills/${slug}/SKILL.md`,
    ...over,
  });
  const bandErrs = (f: Array<{ check: string; level: string }>) =>
    f.filter((x) => x.check === 'composition/band-guard' && x.level === 'error');

  it('a foreign def declaring wi-contract → error (canonical-slug restriction)', () => {
    const findings = validateAgent(mk('some-agent', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log', 'wi-contract'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    }));
    assert.ok(bandErrs(findings).length >= 1);
  });

  it('two band guards on one def → error; band guard without one-shot/caps → errors', () => {
    const both = validateAgent(mk('project-manager', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['wi-contract', 'reflection-close'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    }));
    assert.ok(both.some((x) => x.check === 'composition/band-guard' && x.message.includes('at most one')));

    const bare = validateAgent(mk('project-manager', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['wi-contract'] },
    }));
    assert.ok(bare.some((x) => x.check === 'composition/band-guard' && x.message.includes('one-shot')));
    assert.ok(bare.some((x) => x.check === 'composition/band-guard' && x.message.includes('maxTurns')));
    assert.ok(bare.some((x) => x.check === 'composition/band-guard' && x.message.includes('budget cap')));
  });

  it('the canonical agents must CARRY their band guard (inverse guard)', () => {
    const stripped = validateAgent(mk('reflector', {
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 60, maxBudgetUsd: 1.5 },
    }));
    assert.ok(stripped.some((x) => x.check === 'composition/band-guard' && x.message.includes('must declare its')));
  });

  it('the real shipped PM/reflector shapes are band-lint clean', () => {
    const pm = validateAgent(mk('project-manager', {
      composition: { skills: ['brain-query'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'wi-contract'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 70, maxBudgetUsd: 2.5, maxBudgetUsdShare: 0.2 },
    }));
    assert.equal(bandErrs(pm).length, 0);
  });

  it('budgets/range: negative/zero/out-of-range caps are errors', () => {
    const findings = validateAgent(mk('some-agent', {
      budgets: { maxTurns: 0, maxBudgetUsd: -1, maxBudgetUsdShare: 1.5 },
    }));
    const range = findings.filter((x) => x.check === 'budgets/range');
    assert.equal(range.length, 3);
  });
});

// ---------------------------------------------------------------------------
// validateInstructionSeed (R3-05-F1)
// ---------------------------------------------------------------------------

function mkSeed(overrides: Partial<InstructionSeed> = {}): InstructionSeed {
  return {
    id: 'ts-node',
    title: 'TypeScript conventions',
    kind: 'language',
    appliesTo: ['typescript'],
    scope: 'project',
    provenance: 'forge CLAUDE.md',
    body: 'Use tsc --noEmit.',
    path: '/studio/instruction-seeds/ts-node.md',
    ...overrides,
  };
}

describe('validateInstructionSeed (R3-05)', () => {
  it('a well-formed seed produces no findings', () => {
    assert.deepEqual(validateInstructionSeed(mkSeed()), []);
  });

  it('a non-slug id → error', () => {
    const f = validateInstructionSeed(mkSeed({ id: 'Bad Id' }));
    assert.ok(f.some((x) => x.check === 'slug'));
  });

  it('empty appliesTo → error (can never match a project)', () => {
    const f = validateInstructionSeed(mkSeed({ appliesTo: [] }));
    assert.ok(f.some((x) => x.check === 'applies-to'));
  });

  it('a non-slug appliesTo tag → error', () => {
    const f = validateInstructionSeed(mkSeed({ appliesTo: ['type script'] }));
    assert.ok(f.some((x) => x.check === 'applies-to/slug'));
  });

  it('blank provenance → error (corpus-grounding: no hand-invented practices)', () => {
    const f = validateInstructionSeed(mkSeed({ provenance: '   ' }));
    assert.ok(f.some((x) => x.check === 'provenance'));
  });

  it('empty body → error', () => {
    const f = validateInstructionSeed(mkSeed({ body: '' }));
    assert.ok(f.some((x) => x.check === 'body'));
  });

  it('blank title → error', () => {
    const f = validateInstructionSeed(mkSeed({ title: '  ' }));
    assert.ok(f.some((x) => x.check === 'title'));
  });
});

