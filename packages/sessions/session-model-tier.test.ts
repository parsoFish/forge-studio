/**
 * W8-B3 (sessions-kinds-R06 / sessions-kinds-31) — the fixed-tier fallback.
 *
 * The defect: the three `strategy:fixed` session kinds (architect,
 * project-brain, onboarding) never named their model ANYWHERE — the kickoff
 * chip printed the literal string "fixed · read-only", the session chip read
 * "model: not recorded" seconds after start, and the sessions index MODEL
 * column showed "—". On a cost review there was no way to tell what the most
 * expensive session kind in forge actually ran on.
 *
 * These run against the REAL session-kind registry and the REAL SKILL.md
 * files in this repo, not fixtures, so the day an agent's strategy changes the
 * assertion moves with it rather than pinning a stale answer.
 *
 * RUN: node --experimental-strip-types --test cli/session-model-tier.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixedTierForSessionKind } from './session-model-tier.ts';
import { loadSessionKinds } from './studio/session-kinds.ts';
import { loadAgentDefinition } from '../../orchestrator/studio/registry.ts';

const FORGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KINDS = loadSessionKinds(FORGE_ROOT);
const kind = (id: string) => KINDS.find((k) => k.id === id)!;

test('R06: every session kind whose agent declares strategy:fixed resolves a REAL tier — none is left unnamed', () => {
  let checked = 0;
  for (const descriptor of KINDS) {
    const def = loadAgentDefinition(join(FORGE_ROOT, 'skills', descriptor.agent, 'SKILL.md'));
    if (def.runtime.strategy !== 'fixed') continue;
    checked++;
    const tier = fixedTierForSessionKind(FORGE_ROOT, descriptor);
    assert.ok(
      tier !== null,
      `${descriptor.id} (agent ${descriptor.agent}, strategy:fixed, model ${def.runtime.model}) must resolve a tier — this is the whole "the model is never named" defect`,
    );
    assert.ok(['fable', 'opus', 'sonnet', 'haiku'].includes(tier), `${descriptor.id} resolved a non-vocabulary tier: ${tier}`);
  }
  // A live premise: if the registry ever had NO fixed-strategy kind, this
  // whole test would pass vacuously, so the count is asserted too.
  assert.ok(checked > 0, 'expected at least one strategy:fixed session kind in the live registry');
});

test('R06: a strategy:range agent resolves NULL — "not recorded" stays the honest answer where the tier really is unknowable', () => {
  let checked = 0;
  for (const descriptor of KINDS) {
    const def = loadAgentDefinition(join(FORGE_ROOT, 'skills', descriptor.agent, 'SKILL.md'));
    if (def.runtime.strategy !== 'range') continue;
    checked++;
    assert.equal(
      fixedTierForSessionKind(FORGE_ROOT, descriptor),
      null,
      `${descriptor.id} (agent ${descriptor.agent}) is strategy:range — an untiered session of that kind ran on whatever the default was AT THE TIME, which today's default may not be. Guessing here would be a fabricated fact.`,
    );
  }
  assert.ok(checked > 0, 'expected at least one strategy:range session kind in the live registry');
});

test('R06: an unresolvable agent degrades to null, never a throw — this runs on a live read route', () => {
  assert.equal(fixedTierForSessionKind(FORGE_ROOT, { ...kind('architect'), agent: 'no-such-agent-anywhere' }), null);
  // A traversal-shaped agent id is refused by the shared guard, not followed.
  assert.equal(fixedTierForSessionKind(FORGE_ROOT, { ...kind('architect'), agent: '../../etc' }), null);
});
