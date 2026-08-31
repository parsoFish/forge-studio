/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — C1-C4 of the
 * ADR-027-amendment-#2 `composition.hooks` → `composition.guards` rename,
 * targeting `orchestrator/studio/validate.ts`'s `validateAgent`/`validateCatalog`.
 *
 * TWO fixture shapes are used, deliberately, and neither is a claim about the
 * real future schema on its own:
 *
 *  - `crashFixture` (the SANITY test only) is the TRUE post-migration shape —
 *    `composition.guards` present, `composition.hooks` absent entirely (per
 *    the ADR: "no back-compat, no shim, no fallback read"). Today's
 *    `validateAgent` unconditionally reads `def.composition.hooks.length` at
 *    its very first composition-touching check (`readiness/hook`, right
 *    after `readiness/skill`) — so ANY genuinely migrated def crashes there
 *    immediately, before any of the more specific rules below ever run. That
 *    crash is real and worth proving on its own (it shows the current code is
 *    not just "unaware" of guards, it is actively incompatible with the data
 *    shape the migration produces) — see the one sanity test.
 *
 *  - `mk(...)` (every other test) additionally carries a placeholder
 *    `hooks: []` alongside the real `guards: [...]` content. This is a TEST-
 *    HARNESS SCAFFOLD ONLY, not a claim the migrated schema keeps a `hooks`
 *    key — its sole purpose is to let execution get PAST the early
 *    `readiness/hook` crash so each test can isolate and prove the SPECIFIC
 *    rule-by-rule blindness to `composition.guards` the migration must fix
 *    (C1-C4), rather than have every single test collapse into the identical
 *    one-line crash the sanity test already covers.
 *
 * C1-C3 call the real, unmigrated `validateAgent(def)` as-is. C4 proposes a
 * THIRD optional parameter, `validGuardIds?: ReadonlySet<string>` — mirroring
 * the existing `validModelIds?: ReadonlySet<string>` second parameter used for
 * the `runtime/model-catalog` cross-check — via an explicit function-type
 * cast (`validateAgentFuture`), since calling today's real 2-parameter
 * `validateAgent` with 3 arguments is itself a `tsc` error under this repo's
 * strict config (this file is `include`d by `tsconfig.json`). The cast
 * changes nothing about what runs — it is the SAME real `validateAgent`,
 * called with an extra argument the real implementation currently ignores.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAgent, type Finding } from './validate.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

function mk(slug: string, over: Record<string, unknown> = {}): AgentDefinition {
  const base: Record<string, unknown> = {
    slug,
    name: slug,
    description: 'd',
    library: true,
    purpose: 'p',
    // Placeholder-empty hooks — see header. Every override below re-specifies
    // the FULL composition object (mirroring validate.test.ts's own `mk`
    // convention, which shallow-merges `over` on top of `base`).
    composition: { skills: [], tools: [], mcps: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'autonomous',
    budgets: {},
    allowedTools: ['Read'],
    disallowedTools: [],
    body: 'b',
    path: `/skills/${slug}/SKILL.md`,
  };
  return { ...base, ...over } as unknown as AgentDefinition;
}

// ---------------------------------------------------------------------------
// Sanity — validateAgent must survive the TRUE post-migration shape at all
// (RED today: it crashes outright, which is stronger than merely "unaware").
// ---------------------------------------------------------------------------

test('sanity: validateAgent does not throw on a TRUE post-migration def (composition.guards present, composition.hooks entirely absent) (RED until migrated)', () => {
  const crashFixture = mk('crash-fixture', { composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log'] } });
  assert.doesNotThrow(
    () => validateAgent(crashFixture),
    'expected validateAgent to handle a genuinely hooks-less, guards-only def without throwing — today it crashes reading composition.hooks.length, which is a stronger gap than mere unawareness',
  );
});

// ---------------------------------------------------------------------------
// C1 — readiness/guard (was readiness/hook)
// ---------------------------------------------------------------------------

test('C1: readiness/guard flags empty composition.guards (RED — today the check is readiness/hook, and it is blind to guards)', () => {
  const def = mk('some-agent', {
    composition: { skills: ['demo'], tools: [], mcps: [], hooks: ['event-log'], guards: [] },
  });
  const findings = validateAgent(def);
  const f = findings.find((x) => x.check === 'readiness/guard');
  assert.ok(f, `expected a readiness/guard finding for empty composition.guards — got: ${JSON.stringify(findings.map((x) => x.check))}`);
});

// ---------------------------------------------------------------------------
// C2 — composition/band-guard, sourced from composition.guards
// ---------------------------------------------------------------------------

test('C2a: a foreign def declaring wi-contract in composition.guards → composition/band-guard error (canonical-slug restriction)', () => {
  const findings = validateAgent(
    mk('some-agent', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log', 'wi-contract'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    }),
  );
  const bandErrs = findings.filter((x) => x.check === 'composition/band-guard' && x.level === 'error');
  assert.ok(bandErrs.length >= 1, `expected >=1 composition/band-guard error for a foreign guards declarer — got ${JSON.stringify(findings.map((f) => f.check))}`);
});

test('C2b: two band ids in composition.guards → "at most one" error', () => {
  const findings = validateAgent(
    mk('project-manager', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['wi-contract', 'reflection-close'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    }),
  );
  assert.ok(
    findings.some((x) => x.check === 'composition/band-guard' && x.message.includes('at most one')),
    `expected an "at most one" composition/band-guard error — got ${JSON.stringify(findings.map((f) => f.check))}`,
  );
});

test('C2c: a band id in composition.guards without loopStrategy/budget caps → the three specific errors', () => {
  const findings = validateAgent(
    mk('project-manager', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['wi-contract'] },
    }),
  );
  assert.ok(findings.some((x) => x.check === 'composition/band-guard' && x.message.includes('one-shot')), 'expected the one-shot requirement error');
  assert.ok(findings.some((x) => x.check === 'composition/band-guard' && x.message.includes('maxTurns')), 'expected the maxTurns requirement error');
  assert.ok(findings.some((x) => x.check === 'composition/band-guard' && x.message.includes('budget cap')), 'expected the budget-cap requirement error');
});

test('C2d: the canonical agent DOES carry its band id in composition.guards → the inverse guard must NOT false-positive', () => {
  const findings = validateAgent(
    mk('reflector', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', loopStrategy: 'one-shot' },
      budgets: { maxTurns: 60, maxBudgetUsd: 1.5 },
    }),
  );
  assert.ok(
    !findings.some((x) => x.check === 'composition/band-guard' && x.message.includes('must declare its')),
    `expected NO "must declare its" inverse-guard error since composition.guards DOES carry reflection-close — got ${JSON.stringify(
      findings.filter((f) => f.check === 'composition/band-guard'),
    )}`,
  );
});

// ---------------------------------------------------------------------------
// C3 — composition-entry regex check now covers composition/guards
// ---------------------------------------------------------------------------

test('C3: a bad-char entry in composition.guards → composition/guards entry-regex error', () => {
  const findings = validateAgent(
    mk('some-agent', {
      composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['bad guard!'] },
    }),
  );
  assert.ok(
    findings.some((x) => x.check === 'composition/guards'),
    `expected a composition/guards entry-regex error — got ${JSON.stringify(findings.map((f) => f.check))}`,
  );
});

// ---------------------------------------------------------------------------
// C4 — NEW rule: composition/guard-unknown (a typo'd guard id is a lint error)
// ---------------------------------------------------------------------------

type ValidateAgentWithGuardCatalog = (
  def: AgentDefinition,
  validModelIds?: ReadonlySet<string>,
  validGuardIds?: ReadonlySet<string>,
) => Finding[];

// Proposed signature growth (see header) — the SAME real validateAgent, cast
// to accept the extra parameter so this file type-checks under strict tsc.
const validateAgentFuture = validateAgent as unknown as ValidateAgentWithGuardCatalog;

test('C4a: a composition.guards entry not in the catalog guard-id set → composition/guard-unknown error (RED — proposed, not implemented)', () => {
  const validGuardIds = new Set(['event-log', 'wi-contract']);
  const findings = validateAgentFuture(
    mk('some-agent', { composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log', 'totally-typod-guard'] } }),
    undefined,
    validGuardIds,
  );
  assert.ok(
    findings.some((x) => x.check === 'composition/guard-unknown'),
    `expected a composition/guard-unknown error for a typo'd guard id — got ${JSON.stringify(findings.map((f) => f.check))}`,
  );
});

// C4b asserts the "no false positive" direction of composition/guard-unknown:
// a def whose EVERY composition.guards entry resolves to a real catalog id
// must NOT be flagged. This is genuinely load-bearing (it is what stops the
// new rule from over-firing on legitimate agents once implemented), and it
// is green today for a real reason — not because the assertion is inert in
// both directions, but because "no error fires" is trivially true when the
// rule that would fire doesn't exist yet either. C4a (above) is the paired
// assertion that DOES bite today: a typo'd guard id currently produces zero
// composition/guard-unknown findings, which is the actual gap.
test('C4b: every composition.guards entry resolves to a real catalog guard id → no composition/guard-unknown finding (the "no false positive" half of the contract — see comment above)', () => {
  const validGuardIds = new Set(['event-log', 'wi-contract']);
  const findings = validateAgentFuture(
    mk('some-agent', { composition: { skills: [], tools: [], mcps: [], hooks: [], guards: ['event-log', 'wi-contract'] } }),
    undefined,
    validGuardIds,
  );
  assert.deepEqual(findings.filter((x) => x.check === 'composition/guard-unknown'), []);
});
