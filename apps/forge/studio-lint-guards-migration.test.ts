/**
 * MIGRATION ACCEPTANCE TESTS (must be RED on today's code) — A3 and part of
 * C4 of the ADR-027-amendment-#2 `composition.hooks` → `composition.guards`
 * rename, both driven through the REAL `forge studio lint` entry point
 * (`runStudioLint`, `apps/forge/studio-lint.ts`) rather than a hand-rolled lint —
 * co-located here (not in `orchestrator/studio/`) because both need that
 * entry point directly.
 *
 * === A3 — stale composition.hooks fails loud ===
 *
 * REDIRECT (2026-08-04 peer review): the check does NOT live in `validate.ts`
 * as a new standalone function (the first draft's `validateLegacyHooksFrontmatter`
 * proposal was rejected). It mirrors the existing ADR-027/R2-04 precedent
 * already in this codebase — `parseFlowTrigger` fails loud on a stale `flow:`
 * key, no back-compat parsing. The contract: `loadAgentDefinition`
 * (`orchestrator/studio/registry.ts`) itself THROWS when a SKILL.md's
 * `composition:` block still carries a `hooks:` key. The thrown message must
 * name the offending file, name `composition.hooks`, and point at
 * `composition.guards`.
 *
 * ONE detection point, TWO surfaces (no second implementation):
 *  - direct: `loadAgentDefinition(path)` throws.
 *  - `forge studio lint`: `apps/forge/studio-lint.ts` (~L217-229) already wraps every
 *    `loadAgentDefinition` call in a try/catch and pushes
 *    `{level:'error', object:'agent:<slug>', check:'load', message}` — so
 *    once the throw exists, the lint surfacing comes free. Driven here
 *    through the REAL `runStudioLint` entry point, reusing the exact fixture
 *    conventions `apps/forge/studio-lint.test.ts` already established
 *    (`tmpRoot`/`validSkillMd`-shaped SKILL.md content/`validCatalogYaml`/
 *    `seedValidProject`) — never a hand-rolled lint.
 *
 * Both A3 assertions are RED today: `loadAgentDefinition` does not throw on a
 * stale `hooks:` key (it parses it into `.composition.hooks` normally), so
 * neither the direct throw nor the derived studio-lint `load` error finding
 * exists yet.
 *
 * === A3 SUPERSEDED (2026-08-04, R3-03 landed) — retired by DESIGN, not a
 * rollback ===
 *
 * WHAT A3 PROTECTED: between the two PRs (guards-migration landing,
 * library-hooks not yet landed), `composition.hooks` had no valid meaning at
 * all — any SKILL.md still carrying the key was necessarily a legacy file
 * silently mis-read as guards, so a hard load-time throw was the correct,
 * maximally-loud guard for that specific window.
 *
 * WHY THE RULE ENDED: ADR-027's R3-03 amendment (docs/decisions/
 * 027-studio-object-model.md) says so explicitly — item 1 deletes the field,
 * item 2 REINTRODUCES it with the library-hook meaning. The moment
 * `composition.hooks` is valid data again, "throw on any hooks: key" is not
 * a security rule any more, it is a rule that rejects a legitimate feature.
 * `loadAgentDefinition` correctly stopped throwing (see registry.ts's
 * updated comment at the same call site) — this was a deliberate, PLANNED
 * expiry of A3's job, decided in the redirect that created A3 in the first
 * place ("the transitional rule").
 *
 * WHICH RULE CARRIES THE GUARANTEE NOW: `lintHookComposition`'s
 * `hook-library/guard-in-hooks` check (`orchestrator/studio/hook-library.ts`)
 * — strictly MORE precise than A3 ever was. A3 could only say "this key is
 * stale, don't read it as guards" (true for every value). The new rule
 * resolves the id: a legacy value under `composition.hooks` is READ as a
 * library-hook reference, and because all nine legacy platform-guard ids
 * (`PLATFORM_GUARD_IDS`, `orchestrator/agent-bands.ts`) collide with a real
 * guard id, every one of them resolves to "this is a guard id sitting in the
 * wrong field" — `hook-library/guard-in-hooks`, not a generic "stale key"
 * error. A hand-authored id that is NOT a guard id (a real library hook)
 * correctly does NOT fire this check — which A3 could never have expressed,
 * since A3 didn't know library hooks existed. The two A3 cases below are
 * REWRITTEN (not deleted) to assert this replacement guarantee directly, on
 * both the direct-call and the real-`runStudioLint`-entry-point surfaces —
 * including an exhaustive sweep of all nine legacy values, since "all nine
 * legacy values are guard ids" is the specific claim that makes the
 * replacement watertight rather than coincidental for `event-log` alone.
 *
 * === C4 (real-entry-point half) — composition/guard-unknown must actually
 * fire through forge studio lint, not only when validateAgent is hand-called
 * with a manually-passed validGuardIds set ===
 *
 * `orchestrator/studio/guards-migration-validate-rules.test.ts` pins the
 * `validateAgent(def, validModelIds, validGuardIds)` direct-call contract
 * (C4a/C4b). That alone does not prove the REAL lint entry point ever
 * SUPPLIES `validGuardIds` — an optional parameter the production caller
 * forgets to pass is an inert rule (a lint that lints nothing), which is
 * exactly the declared-data-fails-open failure class this whole migration
 * exists to close. So this file separately drives a roster/fixture agent
 * declaring a bogus `composition.guards` id through `runStudioLint` itself
 * and asserts the `composition/guard-unknown` error actually appears in the
 * real aggregate findings — pinning BOTH call paths, per instruction.
 */

import { libraryAgentFacts } from './library-agent-facts.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { lintHookComposition } from '@forge/library/studio/hook-library.ts';
import { PLATFORM_GUARD_IDS } from '@forge/agents/agent-bands.ts';
import { runStudioLint } from './studio-lint.ts';

const LEGACY_SLUG = 'legacy-hooks-fixture';

/** A SKILL.md still declaring the old `composition.hooks` field (no
 * `composition.guards` key at all) — the exact "still on the old field"
 * shape the migration must reject loudly. Mirrors `studio-lint.test.ts`'s
 * `validSkillMd` minimal-valid-agent shape, with the one deliberate
 * deviation this test exists to exercise. Parametrized by `hookId` (default
 * `event-log`) so the SAME fixture shape drives both the single-id A3 cases
 * and the exhaustive "all nine legacy values" sweep below. */
function legacyHooksSkillMd(slug: string, hookId = 'event-log'): string {
  return `---
name: ${slug}
description: A fixture agent still declaring the old composition.hooks field.
library: true
purpose: Prove the legacy-hooks load-time guard fires.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  hooks: [${hookId}]
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent still declares composition.hooks.
`;
}

/** Minimal valid catalog.yaml — mirrors studio-lint.test.ts's `validCatalogYaml`. */
function validCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
hooks: []
`;
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

test('A3 (direct) SUPERSEDED: loadAgentDefinition no longer throws — composition.hooks parses, and lintHookComposition flags the legacy value directly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-migration-legacy-hooks-'));
  try {
    const skillDir = join(dir, 'skills', LEGACY_SLUG);
    mkdirSync(skillDir, { recursive: true });
    const skillMdPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillMdPath, legacyHooksSkillMd(LEGACY_SLUG));

    // The transitional throw is GONE by design — composition.hooks is valid
    // data again (R3-03 reintroduction). See the file header's "A3
    // SUPERSEDED" paragraph.
    assert.doesNotThrow(
      () => loadAgentDefinition(skillMdPath),
      'loadAgentDefinition must no longer throw on a composition.hooks key — it is reintroduced, valid data',
    );

    // The REPLACEMENT guarantee, at the direct-call level: a legacy value
    // under composition.hooks resolves as a library-hook reference to a real
    // guard id, which is precisely hook-library/guard-in-hooks — strictly
    // more precise than A3's old "stale key" throw (it NAMES the collision).
    const findings = lintHookComposition(dir, libraryAgentFacts);
    const hit = findings.find((f) => f.object === `agent:${LEGACY_SLUG}` && f.check === 'hook-library/guard-in-hooks');
    assert.ok(
      hit,
      `expected lintHookComposition to flag "event-log" under composition.hooks as hook-library/guard-in-hooks — got: ${JSON.stringify(findings)}`,
    );
    assert.equal(hit!.level, 'error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A3 (lint surface) SUPERSEDED: forge studio lint reports a legacy composition.hooks key as hook-library/guard-in-hooks, not a generic "load" error', () => {
  const root = mkdtempSync(join(tmpdir(), 'guards-migration-legacy-hooks-lint-'));
  try {
    const skillDir = join(root, 'skills', LEGACY_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), legacyHooksSkillMd(LEGACY_SLUG));

    mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
    writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
    seedValidProject(root);

    const result = runStudioLint(root);

    // The old "load" error can never fire again for this fixture (the throw
    // it depended on is gone) — assert its ABSENCE explicitly, so a future
    // regression that reintroduces the throw is caught here too, not just
    // the presence of the new check.
    const staleLoadErrors = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${LEGACY_SLUG}` && f.check === 'load',
    );
    assert.deepEqual(staleLoadErrors, [], 'the superseded "load" error must not reappear — A3 is retired, not merely unobserved');

    const guardInHooksErrors = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${LEGACY_SLUG}` && f.check === 'hook-library/guard-in-hooks',
    );
    assert.strictEqual(
      guardInHooksErrors.length,
      1,
      `expected exactly 1 agent:${LEGACY_SLUG} hook-library/guard-in-hooks error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A3 SUPERSEDED — exhaustive sweep: "all nine legacy values are guard ids"
// is the specific claim that makes the replacement watertight rather than
// coincidental for "event-log" alone. Direct-call (lintHookComposition),
// not a 9x real-runStudioLint spin-up — the real-entry-point wiring is
// already proven once above; this sweep's job is exhaustiveness over ids,
// not re-proving the wiring.
// ---------------------------------------------------------------------------

// R4-18 mechanical amendment (2026-08-10): a 5th band, 'onboard-preflight',
// joins PLATFORM_GUARD_IDS — the count pin below is now ten, not nine. RED
// until R4-18's production change lands (orchestrator/agent-bands.ts).
test('A3 SUPERSEDED (exhaustive): every one of the ten legacy PLATFORM_GUARD_IDS values fires hook-library/guard-in-hooks under composition.hooks', () => {
  assert.strictEqual(PLATFORM_GUARD_IDS.length, 10, 'sanity: the migration note claims ten legacy values — pin the count so this sweep cannot silently under-cover');

  for (const hookId of PLATFORM_GUARD_IDS) {
    const dir = mkdtempSync(join(tmpdir(), `guards-migration-legacy-sweep-${hookId}-`));
    try {
      const skillDir = join(dir, 'skills', LEGACY_SLUG);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), legacyHooksSkillMd(LEGACY_SLUG, hookId));

      const findings = lintHookComposition(dir, libraryAgentFacts);
      const hit = findings.find((f) => f.object === `agent:${LEGACY_SLUG}` && f.check === 'hook-library/guard-in-hooks');
      assert.ok(hit, `legacy value "${hookId}" must fire hook-library/guard-in-hooks — got: ${JSON.stringify(findings)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// C4 (real-entry-point half) — composition/guard-unknown via runStudioLint
// ---------------------------------------------------------------------------

const GUARD_UNKNOWN_SLUG = 'guard-unknown-fixture';

/** A SKILL.md in the TRUE future vocabulary — `composition.guards`, no
 * `hooks:` key at all — declaring one real guard id and one typo'd one. */
function guardUnknownSkillMd(slug: string): string {
  return `---
name: ${slug}
description: A fixture agent declaring a typo'd composition.guards id.
library: true
purpose: Prove composition/guard-unknown fires through the real lint entry point.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: [event-log, not-a-real-guard]
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent declares an unknown guard id.
`;
}

/** A catalog.yaml in the TRUE future vocabulary (`guards:`, not `hooks:`),
 * carrying the 9 real ids — the real "known guard id" ground truth
 * `validGuardIds` must eventually be built from. */
function validGuardsCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards:
  - { id: event-log, name: JSONL event log }
  - { id: cost-guard, name: Cost guard }
  - { id: stall-watchdog, name: Stall watchdog }
  - { id: merge-gate, name: Merge gate }
  - { id: scratch-strip, name: Scratch strip }
  - { id: wi-contract, name: WI contract band }
  - { id: reflection-close, name: Reflection close band }
  - { id: demo-band, name: Demo band }
  - { id: review-band, name: Review band }
`;
}

test('C4 (real entry point): forge studio lint reports composition/guard-unknown for a typo\'d composition.guards id (RED — proposed, and not yet threaded through runStudioLint)', () => {
  const root = mkdtempSync(join(tmpdir(), 'guards-migration-guard-unknown-'));
  try {
    const skillDir = join(root, 'skills', GUARD_UNKNOWN_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), guardUnknownSkillMd(GUARD_UNKNOWN_SLUG));

    mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
    writeFileSync(join(root, 'studio', 'catalog.yaml'), validGuardsCatalogYaml());
    seedValidProject(root);

    const result = runStudioLint(root);

    const guardUnknownErrors = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${GUARD_UNKNOWN_SLUG}` && f.check === 'composition/guard-unknown',
    );
    assert.strictEqual(
      guardUnknownErrors.length,
      1,
      `expected exactly 1 agent:${GUARD_UNKNOWN_SLUG} composition/guard-unknown error from forge studio lint (not just from a hand-called validateAgent) — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
