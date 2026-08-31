/**
 * ACCEPTANCE TEST (must be RED until the rename lands) — D1/D2, retargeted
 * for Job B of the 2026-08-04 post-migration adversarial review: finishing
 * the vocabulary split in the CODE IDENTIFIERS, not just the data field.
 *
 * `composition.hooks` → `composition.guards` (the field) already landed —
 * `resolveBandHook` (`orchestrator/agent-bands.ts`) already reads
 * `def.composition.guards` today, and these two tests were fully green
 * against that. What's being renamed NOW is the FUNCTION/CONSTANT/TYPE
 * identifiers themselves: `resolveBandHook` → `resolveBandGuard`,
 * `BAND_HOOK_IDS` → `BAND_GUARD_IDS`, `BandHookId` → `BandGuardId` (this
 * file uses only the function). Rationale (per the reviewer): the follow-on
 * PR reintroduces `composition.hooks` for a DISJOINT, user-authorable
 * lifecycle-hook vocabulary — leaving `resolveBandHook`/`BandHookId` named
 * after "hook" would let a guard concept and a real hook concept collide on
 * the same word one layer down, reproducing the exact two-vocabularies-one-
 * name hazard this whole migration exists to eliminate. `BAND_CANONICAL_SLUG`
 * and `AGENT_BAND_EXECUTORS` keep their names (no "hook" in either).
 *
 * This file's import (`resolveBandHook` → `resolveBandGuard`) now names an
 * identifier that does not exist in today's `agent-bands.ts` — that import
 * failure (Node's ESM loader: "does not provide an export named
 * 'resolveBandGuard'") is this file's RED signal, exactly the pattern
 * `dispatch-decision-capture.test.ts`'s A3-style import-failure red used
 * earlier in this migration: a clear, unambiguous, single-cause failure
 * rather than a downstream assertion mismatch.
 *
 * `composition.guards` fixtures are built via a local
 * `Record<string, unknown>`-typed composition object (harmless now that
 * `guards` is a real field, kept for continuity with the original D1/D2
 * shape) and passed to the real function via an explicit
 * `as unknown as AgentDefinition` cast — never a hand-rolled reimplementation
 * of the resolution logic itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// RENAMED import (Job B) — does not exist on today's agent-bands.ts. This
// import is the file's RED signal; see header.
import { resolveBandGuard } from './agent-bands.ts';
import type { AgentDefinition } from './studio/types.ts';

/** A def in the real post-migration shape: `composition.guards` present,
 * `composition.hooks` absent entirely (no back-compat key). */
function makeGuardsOnlyAgent(guards: string[]): AgentDefinition {
  const composition: Record<string, unknown> = { skills: [], tools: [], mcps: [], guards };
  return {
    slug: 'guards-only-fixture',
    name: 'Guards-only fixture',
    description: 'A fixture agent in the true post-migration composition shape.',
    purpose: 'Prove resolveBandGuard resolves from composition.guards.',
    composition,
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Process body.',
    path: '/skills/guards-only-fixture/SKILL.md',
  } as unknown as AgentDefinition;
}

test('D1: resolveBandGuard resolves a declared band id from composition.guards (RED until the Job B rename lands)', () => {
  const def = makeGuardsOnlyAgent(['wi-contract']);
  assert.equal(
    resolveBandGuard(def),
    'wi-contract',
    'expected resolveBandGuard to read composition.guards for a real post-migration def',
  );
});

test('D2: resolveBandGuard returns undefined for an empty composition.guards (RED until the Job B rename lands)', () => {
  const def = makeGuardsOnlyAgent([]);
  assert.equal(
    resolveBandGuard(def),
    undefined,
    'expected resolveBandGuard to handle an empty-guards def cleanly (no band declared)',
  );
});
