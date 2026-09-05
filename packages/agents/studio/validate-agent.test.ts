/**
 * Tests for `validate-agent.ts` — one test per rule, fixtures as plain typed
 * objects. Moved verbatim from `apps/forge/validate.test.ts` with the validator
 * itself (T1 ruling 159): the tests follow their subject into the package that
 * owns the vocabulary they assert on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { SURFACE_KINDS, PHASE_EXECUTOR_KINDS } from './agent-registry.ts';
import { MATERIAL_KINDS } from './materials.ts';
import { validateAgent } from './validate-agent.ts';

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

  // -------------------------------------------------------------------------
  // 2026-08-05 adversarial-review round 2, finding B/5: the SAME unknown
  // value repeated must yield ONE finding per DISTINCT value, not one per
  // array element — a `for (const value of def.materials)` loop with no
  // dedup emits a duplicate finding for a duplicate value.
  // -------------------------------------------------------------------------

  it('the SAME unknown value repeated twice → exactly ONE finding, not one per element', () => {
    const findings = validateAgent(makeAgent({ materials: ['holograms', 'holograms'] }));
    const matEnum = findings.filter((f) => f.check === 'materials/enum');
    assert.equal(matEnum.length, 1, `expected one finding per DISTINCT unknown value, got: ${JSON.stringify(matEnum)}`);
  });

  it('the same unknown value repeated three times, mixed with a distinct unknown value → exactly TWO findings (one per distinct value)', () => {
    const findings = validateAgent(makeAgent({ materials: ['holograms', 'holograms', 'holograms', 'smells'] }));
    const matEnum = findings.filter((f) => f.check === 'materials/enum');
    assert.equal(matEnum.length, 2, `expected 2 findings (holograms, smells) regardless of repeat count, got: ${JSON.stringify(matEnum)}`);
  });

  // -------------------------------------------------------------------------
  // 2026-08-05 adversarial-review round 2, finding B/4: a non-array
  // `materials` (e.g. a bare string) is a SHAPE problem, not a per-value
  // enum problem. Today's `for (const value of def.materials)` iterates a
  // STRING CHARACTER BY CHARACTER — 'images' (6 chars) currently produces 6
  // nonsense materials/enum findings, one per character. The fix must
  // recognise the shape is wrong up front and emit exactly ONE finding
  // naming the shape problem, never iterate a non-array as if it already
  // were the parsed value list.
  // -------------------------------------------------------------------------

  it('a non-array (bare string) materials value → exactly ONE finding naming the SHAPE problem, not six per-character enum findings', () => {
    const agent = makeAgent({ materials: 'images' as unknown as string[] });
    const findings = validateAgent(agent);
    const materialsFindings = findings.filter((f) => f.object === 'agent:my-agent' && f.check.startsWith('materials'));
    assert.equal(
      materialsFindings.length,
      1,
      `expected exactly one shape-level finding for a non-array materials, got: ${JSON.stringify(materialsFindings)}`,
    );
    assert.equal(materialsFindings[0].level, 'error');
    assert.notEqual(
      materialsFindings[0].check,
      'materials/enum',
      'a SHAPE error must be a distinct check from the per-value materials/enum lint, not that same check fired once per character',
    );
    assert.match(materialsFindings[0].message, /array/i, 'the message must name the actual problem: materials must be an array');
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
