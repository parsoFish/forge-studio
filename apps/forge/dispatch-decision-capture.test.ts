/**
 * Characterization (golden) test — pins the RESOLVED dispatch decision for
 * every real on-disk roster agent (`listAgentDefinitions`) and every real
 * flow's node kinds (`resolveNodeKind`), so the R4-01 `composition.hooks` →
 * `composition.guards` vocabulary migration (renaming the field across 16
 * SKILL.mds, `studio/catalog.yaml`, the registry, validate, and the agent
 * builder) can prove byte-level no-behavioural-delta on DISPATCH ITSELF —
 * distinct from the four spawn-capture fixtures (pm/reflector/demo-agent/
 * adversarial-review), which each pin one pipeline's exact spawn call.
 *
 * DESIGN CONSTRAINT: this fixture records the RESOLVED decision only. It
 * never contains the raw `composition.hooks`/`composition.guards` array or
 * any field name from it — every row is built by calling the PRODUCT
 * functions (`resolveBandGuard`, `resolveNodeKind`), never by re-implementing
 * or echoing the underlying scan. The upcoming rename must be invisible to
 * this fixture; any change to what dispatch actually DOES must not be.
 *
 * IDENTIFIER RENAME (2026-08-04, adversarial-review Job B): `agent-bands.ts`'s
 * `resolveBandHook`/`BAND_HOOK_IDS`/`BandHookId` are being renamed to
 * `resolveBandGuard`/`BAND_GUARD_IDS`/`BandGuardId` to finish the vocabulary
 * split ahead of the follow-on PR that reintroduces `composition.hooks` for a
 * disjoint, user-authorable lifecycle-hook vocabulary. `BAND_CANONICAL_SLUG`
 * and `AGENT_BAND_EXECUTORS` keep their names (no "hook" in either). This
 * file's imports/locals are updated below; the fixture's `bandHookIds` JSON
 * KEY is deliberately left unchanged (see the note beside it) — only the
 * source identifier populating it moved.
 *
 * `dispatchPath` mirrors `execAgent`'s branch order exactly
 * (`orchestrator/flow-runner.ts` ~L1065-1130: band guard wins first, then a
 * declared `loopStrategy: 'ralph'`, else the generic one-shot/legacy spawn)
 * by calling the SAME `resolveBandGuard` the product uses and reading the
 * SAME `runtime.loopStrategy` field `execAgent` reads — no re-implementation
 * of the guard-scan itself, only the same three-way sequencing `execAgent`
 * already performs.
 *
 * ## Stated limit
 *
 * `AGENT_BAND_EXECUTORS` (`orchestrator/flow-runner.ts` ~L1155) — the
 * band-guard-id → concrete `NodeExecutor` table `execAgent` looks up once it
 * has resolved a band guard — is NOT pinned by this fixture, and cannot be
 * with zero production change. It is a module-private `const`, never
 * exported; nothing in `flow-runner.ts`'s public surface
 * (`runFlow`/`resolveNodeKind`/`flowPathForId`/`readOnDiskFlowVersion`/
 * `checkFlowVersionSeam`/`triggeredRunContextLine`) re-exposes it, and
 * `runFlow`'s own injectable seam (`FlowRunArgs.nodeExecutors`) is keyed by
 * `NodeKind` ('architect'|'review'|'agent'|'unknown'), a coarser grain than
 * `BandGuardId` — overriding it replaces `execAgent` wholesale rather than
 * observing what it would have looked up. The only way to OBSERVE the table
 * without an export or source-scraping would be to drive each band's real
 * pipeline end-to-end through a full `runFlow` run (real git worktrees, WI
 * fixtures, demo dirs, etc., one per guard id) and infer the executor
 * identity indirectly from each pipeline's own event vocabulary — that is
 * not pinning the TABLE (a static mapping), only re-demonstrating, through a
 * far heavier mechanism, exactly what the four dedicated spawn-capture
 * fixtures (`pm-spawn-capture.test.ts`, `reflector-spawn-capture.test.ts`,
 * `demo-agent-spawn-capture.test.ts`, `adversarial-review-spawn-capture.test.ts`)
 * and the pipelines' own unit tests already cover. Per instruction, this is
 * reported rather than silently omitted or worked around with an export or
 * text-scrape: `BAND_GUARD_IDS` + `BAND_CANONICAL_SLUG` (the DECLARED-DATA
 * side of band dispatch — the KEY) are pinned below; the internal
 * guard→executor wiring (the platform-code side, ADR-039's "the platform
 * bakes only execution machinery") is not.
 *
 * `allDefinitions` is a SECOND, wider table over the SAME fixture: every
 * on-disk `SKILL.md` under `skills/` that declares a `composition:` block at
 * all — 19 defs, not just the 11 `listAgentDefinitions` returns. `isStudioAgent`
 * filters 8 of those 19 out of the composable roster (`library: false`:
 * `architect-completeness-critic`, `brain-fix`, `brain-maintenance`,
 * `creation-agent`, `demo-builder`, `instructions-creator`, `preflight-fix`,
 * `project-brain-builder`) — but the upcoming rename sweeps ALL 19 SKILL.mds
 * regardless of that flag, so `roster` alone would leave those 8 with no brake
 * at all. (Counts corrected R4-19-F2: the prose still said 16/10/6 while the
 * fixture already held 18/11/7 before this branch added brain-maintenance —
 * measured off the regenerated capture, not incremented by hand.) Enumerated by
 * disk walk (`listSkillMdDirs`), never a hardcoded slug list: a def is
 * included iff its raw frontmatter has a `composition` key (checked via
 * gray-matter on the RAW file, before `loadAgentDefinition`'s parsing) —
 * `roster` itself is untouched (same computation, same bytes) so it stays
 * the pin for the composable set specifically.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/dispatch-decision-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/dispatch-decisions.json from current code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

import { isStudioAgent, listAgentDefinitions, loadAgentDefinition, listFlowIds, loadFlowDefinition } from '../../orchestrator/studio/registry.ts';
import { resolveBandGuard, BAND_GUARD_IDS, BAND_CANONICAL_SLUG, type BandGuardId } from '@forge/agents/agent-bands.ts';
import { resolveNodeKind, flowPathForId } from '@forge/flows/flow-runner.ts';
import { skillsDir, listSkillMdDirs } from '@forge/agents/skill-path.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { assertMatchesJsonSnapshot } from '../../orchestrator/test-fixtures/spawn-capture/normalize.ts';

// §15.14: moved from orchestrator/ to apps/forge/, so the '..' chain was one
// level short. Taken from kernel, which owns the constant.
import { FORGE_ROOT } from '@forge/kernel';
const FIXTURE_PATH = resolve(FORGE_ROOT, 'orchestrator', 'test-fixtures', 'spawn-capture', 'dispatch-decisions.json');

/**
 * The branch `execAgent` (flow-runner.ts) takes for a resolved 'agent'-kind
 * node carrying this def, expressed as a string — band wins first (keyed by
 * the resolved `BandGuardId`), then a declared ralph loop, else the generic
 * one-shot/legacy spawn. Uses `resolveBandGuard` (the product function) for
 * the band decision; the sequencing below is the same three-way order
 * `execAgent` performs, not a re-implementation of the guard scan itself.
 */
function dispatchPathFor(def: AgentDefinition): string {
  const bandGuard = resolveBandGuard(def);
  if (bandGuard) return `band:${bandGuard}`;
  if (def.runtime.loopStrategy === 'ralph') return 'ralph';
  return 'generic';
}

/** Raw-frontmatter check (gray-matter on the file text, NOT the parsed
 * `AgentDefinition`) — whether this SKILL.md declares a `composition:` block
 * at all, independent of whether it also has a `runtime:` block (the
 * `loadAgentDefinition` precondition) or `library: false` (the
 * `isStudioAgent` composable-roster filter). `{}` opts out of gray-matter's
 * parse cache, mirroring `registry.ts`'s own `isStudioAgent`. */
function hasCompositionBlock(skillMdPath: string): boolean {
  const raw = readFileSync(skillMdPath, 'utf8');
  const { data } = matter(raw, {});
  return data != null && typeof data === 'object' && 'composition' in (data as Record<string, unknown>);
}

test('dispatch decisions: every roster agent + every flow node, resolved via the product functions (characterization)', () => {
  const roster = listAgentDefinitions(skillsDir(FORGE_ROOT));
  assert.ok(roster.length > 0, 'expected at least one roster agent');

  const rosterRows = roster
    .map((def) => {
      const bandGuard: BandGuardId | null = resolveBandGuard(def) ?? null;
      return {
        slug: def.slug,
        band: bandGuard,
        canonicalSlug: bandGuard ? BAND_CANONICAL_SLUG[bandGuard] : null,
        loopStrategy: def.runtime.loopStrategy ?? null,
        dispatchPath: dispatchPathFor(def),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const agentsBySlug = new Map(roster.map((d) => [d.slug, d]));

  // The wider table (see header): every SKILL.md with a composition block,
  // including the `library: false` 6 the composable roster filters out.
  // Enumerated by disk walk — `listSkillMdDirs` never hardcodes a slug list.
  const allSkillMdPaths = listSkillMdDirs(skillsDir(FORGE_ROOT))
    .map((dir) => join(dir, 'SKILL.md'))
    .filter(hasCompositionBlock);
  assert.ok(allSkillMdPaths.length > 0, 'expected at least one SKILL.md with a composition block');

  const allDefinitionsRows = allSkillMdPaths
    .map((skillMdPath) => {
      // No try/catch: a composition-bearing SKILL.md that `loadAgentDefinition`
      // cannot parse (e.g. missing the `runtime:` block it requires) is a def
      // this fixture cannot confidently classify — fail loud rather than
      // guess or silently drop it from the table.
      const def = loadAgentDefinition(skillMdPath);
      const bandGuard: BandGuardId | null = resolveBandGuard(def) ?? null;
      return {
        slug: def.slug,
        band: bandGuard,
        canonicalSlug: bandGuard ? BAND_CANONICAL_SLUG[bandGuard] : null,
        loopStrategy: def.runtime.loopStrategy ?? null,
        dispatchPath: dispatchPathFor(def),
        inComposableRoster: isStudioAgent(skillMdPath),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const flowIds = listFlowIds(FORGE_ROOT).sort();
  assert.ok(flowIds.length > 0, 'expected at least one registered flow');

  const flows = flowIds.map((id) => {
    const flow = loadFlowDefinition(flowPathForId(id));
    const nodes = flow.nodes.map((n) => ({
      id: n.id,
      agent: n.agent ?? null,
      resolvedKind: resolveNodeKind(n, agentsBySlug),
    }));
    return { id: flow.id, nodes };
  });

  const fixture = {
    roster: rosterRows,
    allDefinitions: allDefinitionsRows,
    // KEY STAYS `bandHookIds` on purpose (Job B identifier rename,
    // 2026-08-04): only the imported symbol moved from `BAND_HOOK_IDS` to
    // `BAND_GUARD_IDS` — do NOT "tidy" this JSON key to `bandGuardIds`, that
    // would move the fixture bytes for a rename that must be invisible to it.
    bandHookIds: [...BAND_GUARD_IDS],
    bandCanonicalSlug: { ...BAND_CANONICAL_SLUG },
    flows,
  };

  assertMatchesJsonSnapshot(FIXTURE_PATH, fixture);
});
