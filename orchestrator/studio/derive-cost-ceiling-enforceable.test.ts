/**
 * Acceptance tests for WI-3 (R6-04): `agentCapabilityDescriptor()` gains a
 * new FACT, `costCeilingEnforceable: boolean`, computed SERVER-SIDE as
 * `runtime.loopStrategy === 'one-shot'` (orchestrator/studio/derive.ts).
 *
 * WHY this fact, computed HERE: the bridge route `POST /api/agents/:slug/run`
 * (cli/ui-bridge.ts, R6-04 WI-2) already refuses an operator-supplied
 * `costCeilingUsd` for any agent whose `runtime.loopStrategy !== 'one-shot'`
 * (14 of 19 real dispatchable roster agents take that legacy path, which has
 * no budget concept at all — see cli/ui-bridge-agent-run-ceiling.test.ts's
 * round-7/8 header). Today the kickoff UI has NO way to know this in advance:
 * it can only find out by submitting a ceiling and getting a 400 back. This
 * fact closes that gap — it must be computed ONCE, server-side, and threaded
 * onto the wire, per this codebase's established convention for capability
 * facts (see `interactive` / `runtimeSdks` in the SAME descriptor — R2-02-F1
 * forbids a capability fact that exists only in UI code).
 *
 * Placement: `node --test` home (package.json's test glob includes
 * `orchestrator/studio/*.test.ts`), alongside the existing `derive.test.ts`.
 * Kept as a SEPARATE file rather than appended to `derive.test.ts` so this
 * WI's tests are independently reviewable; `derive.test.ts`'s own two
 * full-descriptor `deepEqual` literals were amended (not duplicated here) to
 * add the new key — see the comment at those two call sites.
 *
 * RUN: node --test --experimental-strip-types orchestrator/studio/derive-cost-ceiling-enforceable.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { agentCapabilityDescriptor, executionPathForSurface, FORGE_ROOT } from './derive.ts';
import { listAgentDefinitions } from './registry.ts';
import type { AgentDefinition } from './types.ts';

/** Minimal AgentDefinition fixture; override only what a given test cares
 *  about. Mirrors derive.test.ts's own `baseAgentDefFixture` (independently
 *  owned — this file does not import test-local helpers from that file). */
function baseAgentDefFixture(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'fixture-agent',
    name: 'Fixture Agent',
    description: 'A fixture agent for descriptor tests.',
    purpose: 'Testing descriptor computation.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: '# Fixture\n',
    path: '/fixture/skills/fixture-agent/SKILL.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Core pin: costCeilingEnforceable === (runtime.loopStrategy === 'one-shot')
// ---------------------------------------------------------------------------

test('agentCapabilityDescriptor: runtime.loopStrategy "one-shot" -> costCeilingEnforceable true', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' } });
  assert.equal(agentCapabilityDescriptor(def).costCeilingEnforceable, true);
});

// Kills "an agent with no loopStrategy field is treated as enforceable" —
// the exact defect shape WI-2's route guard exists to prevent (a ceiling
// silently accepted then silently unenforced for 14 of 19 roster agents).
test('agentCapabilityDescriptor: absent runtime.loopStrategy -> costCeilingEnforceable false', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' } });
  assert.equal(agentCapabilityDescriptor(def).costCeilingEnforceable, false);
});

// Kills a loose truthy check (`!!loopStrategy` instead of `=== 'one-shot'`):
// 'ralph' is a real, truthy, declared loopStrategy value that is NOT
// enforceable — distinct from the "absent" case above, which a truthy check
// would also get right by accident.
test('agentCapabilityDescriptor: runtime.loopStrategy "ralph" (declared, non-one-shot) -> costCeilingEnforceable false', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'ralph' } });
  assert.equal(agentCapabilityDescriptor(def).costCeilingEnforceable, false);
});

// Kills a case-collapsed or substring match ("One-Shot", "one-shot-ish",
// "not-one-shot" all containing the substring "one-shot" in some form must
// not slip through a loose `.includes('one-shot')` check).
test('agentCapabilityDescriptor: loopStrategy values that merely CONTAIN "one-shot" as a substring are NOT enforceable — exact match only', () => {
  for (const value of ['One-Shot', 'one-shot-ish', 'not-one-shot', 'ONE-SHOT']) {
    const def = baseAgentDefFixture({ runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: value } });
    assert.equal(agentCapabilityDescriptor(def).costCeilingEnforceable, false, `loopStrategy=${JSON.stringify(value)} must not be enforceable`);
  }
});

// Kills conflating enforceability with `interactive`/`surface` — the two
// facts must vary independently. An interactive one-shot agent is still
// enforceable; an unattended non-one-shot agent is still not.
test('agentCapabilityDescriptor: costCeilingEnforceable is independent of surface/interactive', () => {
  const interactiveOneShot = baseAgentDefFixture({
    surface: 'interactive',
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
  });
  assert.equal(agentCapabilityDescriptor(interactiveOneShot).interactive, true);
  assert.equal(agentCapabilityDescriptor(interactiveOneShot).costCeilingEnforceable, true);

  const unattendedLegacy = baseAgentDefFixture({ surface: 'unattended' });
  assert.equal(agentCapabilityDescriptor(unattendedLegacy).interactive, false);
  assert.equal(agentCapabilityDescriptor(unattendedLegacy).costCeilingEnforceable, false);
});

// ---------------------------------------------------------------------------
// Grounded against the REAL roster, not just synthetic fixtures — kills
// "works for the hand-built fixture's exact YAML shape but not the real
// SKILL.md frontmatter parse path".
// ---------------------------------------------------------------------------

test('agentCapabilityDescriptor: real roster — project-manager (loopStrategy: one-shot) -> costCeilingEnforceable true', () => {
  const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
  const pm = defs.find((d) => d.slug === 'project-manager');
  assert.ok(pm, 'expected skills/project-manager in the real roster');
  assert.equal(pm!.runtime.loopStrategy, 'one-shot', 'sanity: project-manager SKILL.md must declare loopStrategy: one-shot');
  assert.equal(agentCapabilityDescriptor(pm!).costCeilingEnforceable, true);
});

test('agentCapabilityDescriptor: real roster — architect (no loopStrategy, absent surface) -> costCeilingEnforceable false', () => {
  const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
  const architect = defs.find((d) => d.slug === 'architect');
  assert.ok(architect, 'expected skills/architect in the real roster');
  assert.equal(architect!.runtime.loopStrategy, undefined, 'sanity: architect SKILL.md must declare no loopStrategy');
  assert.equal(agentCapabilityDescriptor(architect!).costCeilingEnforceable, false);
});

// Full-roster sweep: the fact must be a boolean for every real agent, and it
// must agree EXACTLY with the raw frontmatter field for each — no agent's
// descriptor may diverge from its own declared loopStrategy.
test('agentCapabilityDescriptor: computes a boolean costCeilingEnforceable for every real roster agent, always matching runtime.loopStrategy === "one-shot"', () => {
  const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
  assert.ok(defs.length > 0, 'roster must be non-empty');
  for (const def of defs) {
    const descriptor = agentCapabilityDescriptor(def);
    assert.equal(typeof descriptor.costCeilingEnforceable, 'boolean', `${def.slug}: costCeilingEnforceable must be a boolean`);
    assert.equal(
      descriptor.costCeilingEnforceable,
      def.runtime.loopStrategy === 'one-shot',
      `${def.slug}: costCeilingEnforceable must equal (runtime.loopStrategy === 'one-shot')`,
    );
  }
});

// Sanity anchor so this file's own real-roster tests aren't vacuous: the
// executionPathForSurface import is unused otherwise, so re-confirm the
// import surface stays consistent with derive.test.ts's own convention.
test('sanity: executionPathForSurface is still importable from derive.ts (import-surface guard)', () => {
  assert.equal(executionPathForSurface('unattended'), 'unattended');
});
