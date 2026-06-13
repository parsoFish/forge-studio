/**
 * Derive a PhaseAgentSpec from a studio SKILL.md (ADR-027).
 *
 * M0 no-drift lock: until M2 flips invocation files to single-source, the
 * SKILL.md frontmatter and the hardcoded PhaseAgentSpec constants in the
 * invocation modules must agree. `derive.test.ts` enforces this with a
 * deep-equal assertion on every in-cycle agent.
 */

import { resolve } from 'node:path';

import { MODEL_BY_TIER, type ModelTier, type PhaseAgentSpec } from '../phase-agent.ts';
import { loadAgentDefinition } from './registry.ts';

const TIER_BY_MODEL: Record<string, ModelTier> = Object.fromEntries(
  (Object.entries(MODEL_BY_TIER) as [ModelTier, string][]).map(([t, m]) => [m, t]),
);

/**
 * Derive the PhaseAgentSpec view from a studio SKILL.md (ADR-027).
 *
 * @param skillPathFromRoot MUST be forge-root-relative (e.g.
 *   `skills/project-manager/SKILL.md`) — it is echoed verbatim into the
 *   returned spec's `skill` field, which is root-relative by contract
 *   (see PhaseAgentSpec doc). Do not pass absolute paths.
 */
export function deriveAgentSpec(skillPathFromRoot: string, root = process.cwd()): PhaseAgentSpec {
  const def = loadAgentDefinition(resolve(root, skillPathFromRoot));
  if (!def.phase) throw new Error(`${def.path}: cannot derive spec — no phase field`);
  if (def.runtime.strategy !== 'fixed' || !def.runtime.model) {
    throw new Error(
      `${def.path}: cannot derive spec — runtime must be strategy:fixed with a model (range routing lands M6)`,
    );
  }
  const tier = TIER_BY_MODEL[def.runtime.model];
  if (!tier) {
    throw new Error(
      `${def.path}: unknown model ${def.runtime.model} — not in MODEL_BY_TIER`,
    );
  }
  return {
    phase: def.phase,
    skill: skillPathFromRoot,
    tier,
    allowedTools: def.allowedTools,
    disallowedTools: def.disallowedTools,
  };
}
