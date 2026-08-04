/**
 * MIGRATION ACCEPTANCE TESTS (must be RED on today's code) — A3 and part of
 * C4 of the ADR-027-amendment-#2 `composition.hooks` → `composition.guards`
 * rename, both driven through the REAL `forge studio lint` entry point
 * (`runStudioLint`, `cli/studio-lint.ts`) rather than a hand-rolled lint —
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
 *  - `forge studio lint`: `cli/studio-lint.ts` (~L217-229) already wraps every
 *    `loadAgentDefinition` call in a try/catch and pushes
 *    `{level:'error', object:'agent:<slug>', check:'load', message}` — so
 *    once the throw exists, the lint surfacing comes free. Driven here
 *    through the REAL `runStudioLint` entry point, reusing the exact fixture
 *    conventions `cli/studio-lint.test.ts` already established
 *    (`tmpRoot`/`validSkillMd`-shaped SKILL.md content/`validCatalogYaml`/
 *    `seedValidProject`) — never a hand-rolled lint.
 *
 * Both A3 assertions are RED today: `loadAgentDefinition` does not throw on a
 * stale `hooks:` key (it parses it into `.composition.hooks` normally), so
 * neither the direct throw nor the derived studio-lint `load` error finding
 * exists yet.
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentDefinition } from '../orchestrator/studio/registry.ts';
import { runStudioLint } from './studio-lint.ts';

const LEGACY_SLUG = 'legacy-hooks-fixture';

/** A SKILL.md still declaring the old `composition.hooks` field (no
 * `composition.guards` key at all) — the exact "still on the old field"
 * shape the migration must reject loudly. Mirrors `studio-lint.test.ts`'s
 * `validSkillMd` minimal-valid-agent shape, with the one deliberate
 * deviation this test exists to exercise. */
function legacyHooksSkillMd(slug: string): string {
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
  hooks: [event-log]
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

test('A3 (direct): loadAgentDefinition throws on a stale composition.hooks key, naming both fields (RED until migrated)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-migration-legacy-hooks-'));
  try {
    const skillDir = join(dir, 'skills', LEGACY_SLUG);
    mkdirSync(skillDir, { recursive: true });
    const skillMdPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillMdPath, legacyHooksSkillMd(LEGACY_SLUG));

    assert.throws(
      () => loadAgentDefinition(skillMdPath),
      (err: unknown): boolean => {
        const message = err instanceof Error ? err.message : String(err);
        return message.includes(skillMdPath) && message.includes('composition.hooks') && message.includes('composition.guards');
      },
      'expected loadAgentDefinition to throw naming the file, composition.hooks, and composition.guards',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A3 (lint surface): forge studio lint reports a stale composition.hooks key as an agent:<slug> "load" error, not a crash or a silent skip (RED until migrated)', () => {
  const root = mkdtempSync(join(tmpdir(), 'guards-migration-legacy-hooks-lint-'));
  try {
    const skillDir = join(root, 'skills', LEGACY_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), legacyHooksSkillMd(LEGACY_SLUG));

    mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
    writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
    seedValidProject(root);

    const result = runStudioLint(root);

    const loadErrors = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${LEGACY_SLUG}` && f.check === 'load',
    );
    assert.strictEqual(
      loadErrors.length,
      1,
      `expected exactly 1 agent:${LEGACY_SLUG} "load" error from a stale composition.hooks key — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
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
