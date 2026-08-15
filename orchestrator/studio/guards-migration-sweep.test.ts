/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — sweep
 * completeness for the ADR-027-amendment-#2 `composition.hooks` →
 * `composition.guards` rename (at that migration's landing the 9 ids were
 * unchanged: the 5 toggles
 * `event-log`/`cost-guard`/`stall-watchdog`/`merge-gate`/`scratch-strip` and
 * the 4 bands `wi-contract`/`reflection-close`/`demo-band`/`review-band`.
 * R4-18 later added a 10th id, the 5th band `onboard-preflight` — see
 * `EXPECTED_GUARDS_BY_SLUG` and `agent-bands.ts`'s `BAND_GUARD_IDS` for the
 * current set).
 *
 * This is the STRONGEST acceptance test in the migration suite: it proves
 * the eventual sweep commit moved every single declared guard id across all
 * 20 composition-bearing SKILL.mds and dropped none.
 *
 * A1 — `EXPECTED_GUARDS_BY_SLUG` below is a HARDCODED literal table, GENERATED
 * by reading the on-disk `composition.hooks` data (`grep`/manual transcription)
 * BEFORE any sweep happens — frozen ground truth, deliberately independent of
 * whatever the sweep commit does to disk. It covers all 20 SKILL.mds that
 * declare a `composition:` block (`architect`, `architect-completeness-critic`,
 * `brain-fix`, `demo-builder`, `instructions-creator`, `preflight-fix`,
 * `project-brain-builder` included — NOT just the 11 in the composable
 * roster; the rename sweeps every SKILL.md regardless of `library: false`).
 * 16 at generation time (2026-08-04); R4-18 added `contract-check` — a 17th
 * composition-bearing SKILL.md that is also the 11th member of the composable
 * roster (it declares `library: true`) — R4-21 added `creation-agent`
 * (18th, `library: false`, with its own real `event-log` guard) — and
 * R4-19-F2 added `brain-maintenance` (19th, `library: false`, its own
 * single `event-log` guard, same shape as `brain-fix`/`creation-agent`) —
 * and W6-CR-3 added `community-refresh` (20th, `library: true`, its own
 * single `event-log` guard, same shape as the three above); all four were
 * appended rather than backdated into the "generated" set.
 * The test asserts `composition.guards` (once it exists) deep-equals this
 * table for every one of them, sorted for stable comparison.
 *
 * A2 — asserts NO SKILL.md anywhere under `skills/` OR
 * `studio/starters/agents/` still carries a `hooks:` key inside its
 * `composition:` block, read from the RAW frontmatter (gray-matter on the
 * file text, not the parsed `AgentDefinition`) — a parsed object can
 * silently drop an unrecognized key, so this assertion exists specifically
 * to catch a leftover the parser would otherwise ignore.
 *
 * `studio/starters/agents/` (2026-08-04 coverage-gap close): the ORIGINAL
 * A2 only scanned `skills/`, but `studio/starters/agents/{plan,dev,review}`
 * also carry `composition:` blocks and ALSO flow through `loadAgentDefinition`
 * (via `listStarterAgents`, `orchestrator/studio/registry.ts` — the New-Agent
 * picker's StarterPicker source) — a directory the sweep could silently miss
 * while `skills/` alone stayed clean, since nothing else pinned it. These
 * three are the ONLY other on-disk `composition:`-bearing definitions:
 * confirmed by grepping every `loadAgentDefinition(...)` call site in
 * `orchestrator/`/`cli/` — every one resolves either through `skillPath()`
 * (`skills/<slug>/SKILL.md`) or through `listStarterAgents`'s
 * `studio/starters/agents/` walk; `studio/starters/flows/` (flow.yaml, not
 * agent SKILL.mds) and `studio/starters/projects/` (project scaffolds) never
 * reach `loadAgentDefinition` at all. If a THIRD such directory is ever
 * added, it must be added here too — this is the one general "no residual
 * hooks: anywhere loadAgentDefinition can reach" sweep-completeness gate.
 *
 * `composition.guards` does not exist on today's `AgentDefinition` type
 * (`AgentComposition` still declares only `hooks: string[]`). Referencing it
 * would be a real `tsc` error under this repo's strict config (which type-
 * checks `.test.ts` files too — see tsconfig.json's `include`), so `guards` is
 * read through an explicit `as unknown as { guards?: string[] }` cast on the
 * composition sub-object — never a hand-rolled reimplementation of the field,
 * just a type-safe way to ask "does this not-yet-existing field have this
 * value" of the REAL, unmigrated `loadAgentDefinition` output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

import { loadAgentDefinition } from './registry.ts';
import { skillsDir, listSkillMdDirs } from '../skill-path.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * A1 ground truth — generated 2026-08-04 by reading each SKILL.md's
 * `composition.hooks:` array directly off disk, before any sweep. Each
 * entry's id list is stored SORTED (the test sorts the actual value the same
 * way before comparing, so declaration order is not part of the pin).
 */
const EXPECTED_GUARDS_BY_SLUG: Readonly<Record<string, readonly string[]>> = {
  'adversarial-review': ['event-log', 'review-band'],
  architect: ['event-log'],
  'architect-completeness-critic': ['event-log'],
  'brain-fix': ['event-log'],
  'brain-ingest': ['event-log'],
  // R4-19-F2: brain-maintenance — a new `library: false` interactive helper
  // dispatched by the bridge for one KB's brain-lint findings (never
  // composed into a flow) — declares only the `event-log` guard, the same
  // single-guard shape as `brain-fix`/`creation-agent`.
  'brain-maintenance': ['event-log'],
  // W6-CR-3: community-refresh — a new `library: true` interactive agent
  // (the community-registry refresh agent, kicked off from /community) —
  // declares only the `event-log` guard, the same single-guard shape as
  // brain-fix/creation-agent/brain-maintenance above; added to this frozen
  // table so the sweep-completeness assertion below stays meaningful for
  // this newly-added composition-bearing SKILL.md too.
  'community-refresh': ['event-log'],
  // R4-18: contract-check declares the onboard-preflight band guard (its
  // display identity + composition.guards entry — see skills/contract-check).
  'contract-check': ['event-log', 'onboard-preflight'],
  // R4-21: creation-agent — a new `library: false` interactive helper
  // (mirrors demo-builder/instructions-creator/onboarding-agent's own
  // single `event-log` guard) — added to this frozen table so the sweep-
  // completeness assertion below stays meaningful for the newly-added
  // composition-bearing SKILL.md, not just the 16 that existed when this
  // table was generated.
  'creation-agent': ['event-log'],
  'demo-agent': ['demo-band', 'event-log'],
  'demo-builder': ['event-log'],
  'developer-ralph': ['cost-guard', 'event-log', 'scratch-strip', 'stall-watchdog'],
  'instructions-creator': ['event-log'],
  'onboarding-agent': ['event-log'],
  'preflight-fix': ['event-log'],
  'project-brain-builder': ['event-log'],
  'project-manager': ['event-log', 'wi-contract'],
  'project-scoped-review': ['event-log'],
  reflector: ['event-log', 'reflection-close'],
  'release-finalizer': ['event-log'],
};

/** Raw-frontmatter check (gray-matter on the file text) — whether this
 * SKILL.md declares a `composition:` block at all, independent of whether it
 * also has a `runtime:` block or `library: false`. Mirrors
 * `dispatch-decision-capture.test.ts`'s `hasCompositionBlock`. */
function hasCompositionBlock(skillMdPath: string): { has: boolean; composition: Record<string, unknown> | null } {
  const raw = readFileSync(skillMdPath, 'utf8');
  const { data } = matter(raw, {});
  if (data == null || typeof data !== 'object' || !('composition' in (data as Record<string, unknown>))) {
    return { has: false, composition: null };
  }
  const comp = (data as Record<string, unknown>)['composition'];
  return { has: true, composition: comp != null && typeof comp === 'object' && !Array.isArray(comp) ? (comp as Record<string, unknown>) : {} };
}

test('A1: every composition-bearing SKILL.md carries composition.guards matching the frozen pre-sweep hooks table (RED until the sweep lands)', () => {
  const skillMdPaths = listSkillMdDirs(skillsDir(FORGE_ROOT)).map((dir) => join(dir, 'SKILL.md'));
  const compositionBearing = skillMdPaths.filter((p) => hasCompositionBlock(p).has);

  const foundSlugs = compositionBearing
    .map((p) => loadAgentDefinition(p).slug)
    .sort((a, b) => a.localeCompare(b));
  const expectedSlugs = Object.keys(EXPECTED_GUARDS_BY_SLUG).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    foundSlugs,
    expectedSlugs,
    'sanity: the frozen table must cover exactly the composition-bearing SKILL.mds on disk today (20) — if this fails, the table itself is stale, not the migration',
  );

  const mismatches: Array<{ slug: string; expected: readonly string[]; actual: string[] | undefined }> = [];
  for (const skillMdPath of compositionBearing) {
    const def = loadAgentDefinition(skillMdPath);
    const expected = [...EXPECTED_GUARDS_BY_SLUG[def.slug]!].sort((a, b) => a.localeCompare(b));
    const actualGuards = (def.composition as unknown as { guards?: string[] }).guards;
    const actual = actualGuards ? [...actualGuards].sort((a, b) => a.localeCompare(b)) : undefined;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push({ slug: def.slug, expected, actual });
    }
  }

  assert.deepEqual(
    mismatches,
    [],
    `expected composition.guards to match the frozen pre-sweep hooks table for every def — mismatches: ${JSON.stringify(mismatches, null, 2)}`,
  );
});

/** Every directory a real `loadAgentDefinition(...)` call site can reach
 * (see the A2 header note) — `skills/` (the live roster + installed
 * packages, same physical tree) and `studio/starters/agents/` (the
 * New-Agent picker's StarterPicker source, via `listStarterAgents`). */
function loadAgentDefinitionReachableDirs(forgeRoot: string): string[] {
  return [skillsDir(forgeRoot), join(forgeRoot, 'studio', 'starters', 'agents')];
}

test('A2: no SKILL.md under skills/ or studio/starters/agents/ still declares a raw composition.hooks key (RED until the sweep lands)', () => {
  const skillMdPaths = loadAgentDefinitionReachableDirs(FORGE_ROOT).flatMap((dir) =>
    listSkillMdDirs(dir).map((d) => join(d, 'SKILL.md')),
  );
  assert.ok(skillMdPaths.length > 0, 'expected at least one SKILL.md across skills/ + studio/starters/agents/');

  const offenders: string[] = [];
  for (const skillMdPath of skillMdPaths) {
    const { has, composition } = hasCompositionBlock(skillMdPath);
    if (has && composition && Object.prototype.hasOwnProperty.call(composition, 'hooks')) {
      offenders.push(skillMdPath);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `expected zero SKILL.mds with a leftover composition.hooks key — found ${offenders.length}: ${JSON.stringify(offenders, null, 2)}`,
  );
});
