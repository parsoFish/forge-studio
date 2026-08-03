/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — D1/D2 of the
 * ADR-027-amendment-#2 `composition.hooks` → `composition.guards` rename:
 * `resolveBandHook` (`orchestrator/agent-bands.ts`) must resolve the declared
 * band hook from `composition.guards`, not `composition.hooks`.
 *
 * Today's `resolveBandHook` body is a single unconditional read:
 *   `for (const hook of def.composition.hooks) { ... }`
 * — no branch, no fallback, nothing to isolate. Per the ADR ("no back-compat,
 * no shim, no fallback read"), a genuinely migrated `AgentDefinition` will
 * carry `composition.guards` and NO `composition.hooks` key at all — so both
 * fixtures below are built in that TRUE post-migration shape (guards present,
 * hooks entirely absent — never a placeholder `hooks: []`), and both crash
 * `resolveBandHook` on the exact same line: iterating `undefined` throws
 * `TypeError: def.composition.hooks is not iterable`. That crash — for BOTH
 * a populated-guards def (D1) and an empty-guards def (D2) — is the honest
 * RED signal: it is not a subtle logic gap to isolate, it is a real,
 * unconditional incompatibility with the post-migration data shape that
 * exists regardless of what `guards` contains.
 *
 * `composition.guards` does not exist on today's `AgentComposition` type, so
 * fixtures are built via a local `Record<string, unknown>`-typed composition
 * object (sidestepping TS's excess-property check, which would otherwise
 * reject an inline `guards` key on a type that only declares `hooks`) and
 * passed to the real `resolveBandHook` via an explicit
 * `as unknown as AgentDefinition` cast — never a hand-rolled reimplementation
 * of the resolution logic itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBandHook } from './agent-bands.ts';
import type { AgentDefinition } from './studio/types.ts';

/** A def in the TRUE post-migration shape: `composition.guards` present,
 * `composition.hooks` absent entirely (no back-compat key at all). */
function makeGuardsOnlyAgent(guards: string[]): AgentDefinition {
  const composition: Record<string, unknown> = { skills: [], tools: [], mcps: [], guards };
  return {
    slug: 'guards-only-fixture',
    name: 'Guards-only fixture',
    description: 'A fixture agent in the true post-migration composition shape.',
    purpose: 'Prove resolveBandHook resolves from composition.guards.',
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

test('D1: resolveBandHook resolves a declared band id from composition.guards (RED until migrated)', () => {
  const def = makeGuardsOnlyAgent(['wi-contract']);
  assert.equal(
    resolveBandHook(def),
    'wi-contract',
    'expected resolveBandHook to read composition.guards for a real post-migration def',
  );
});

test('D2: resolveBandHook returns undefined for an empty composition.guards (RED until migrated)', () => {
  const def = makeGuardsOnlyAgent([]);
  assert.equal(
    resolveBandHook(def),
    undefined,
    'expected resolveBandHook to handle a genuinely hooks-less, empty-guards def without throwing',
  );
});
