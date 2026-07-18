/**
 * Derive a PhaseAgentSpec from a studio SKILL.md (ADR-027).
 *
 * M0 no-drift lock: until M2 flips invocation files to single-source, the
 * SKILL.md frontmatter and the hardcoded PhaseAgentSpec constants in the
 * invocation modules must agree. `derive.test.ts` enforces this with a
 * deep-equal assertion on every in-cycle agent.
 */

import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_BY_TIER, type ModelTier, type PhaseAgentSpec } from '../phase-agent.ts';
import { rangeTiers } from '../model-range.ts';
import { loadAgentDefinition, loadCatalog } from './registry.ts';
import type { AgentDefinition } from './types.ts';

/**
 * The forge install root (this file lives at orchestrator/studio/). Used as
 * the default resolution root for forge-root-relative skill paths: the phase
 * invocation modules call deriveAgentSpec at module load, and processes like
 * the orchestrated demo capture (`forge demo capture`) run with cwd set to a
 * PROJECT WORKTREE — a cwd default made every such spawn crash on import
 * (2026-07-11, INIT-2026-07-10-framework-auth-parity capture_ok:false).
 */
export const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
export function deriveAgentSpec(skillPathFromRoot: string, root = FORGE_ROOT): PhaseAgentSpec {
  const def = loadAgentDefinition(resolve(root, skillPathFromRoot));
  if (!def.phase) throw new Error(`${def.path}: cannot derive spec — no phase field`);

  let tier: ModelTier;

  if (def.runtime.strategy === 'fixed') {
    if (!def.runtime.model) {
      throw new Error(
        `${def.path}: cannot derive spec — strategy:fixed requires a model field`,
      );
    }
    const resolved = TIER_BY_MODEL[def.runtime.model];
    if (!resolved) {
      throw new Error(
        `${def.path}: unknown model ${def.runtime.model} — not in MODEL_BY_TIER`,
      );
    }
    tier = resolved;
  } else {
    // strategy:range — pick cheapest tier in the range as the spawn default
    if (!def.runtime.range || def.runtime.range.length === 0) {
      throw new Error(
        `${def.path}: cannot derive spec — strategy:range requires a non-empty range field`,
      );
    }
    const catalogPath = join(root, 'studio', 'catalog.yaml');
    const catalog = loadCatalog(catalogPath);
    const tiers = rangeTiers(def.runtime.range, catalog);
    tier = tiers[0]; // cheapest-first; escalation is applied at spawn time
  }

  return {
    phase: def.phase,
    skill: skillPathFromRoot,
    tier,
    allowedTools: def.allowedTools,
    disallowedTools: def.disallowedTools,
    // ADR 029: carry the SKILL.md runtime.sdk through to the spec so the
    // orchestrator can spawn the phase on a non-claude runtime. Previously
    // dropped here; resolveSdkId gates it at the dev-loop call site.
    sdk: def.runtime.sdk,
  };
}

/**
 * Map an agent's `surface` (R2-01-F5) onto the flow engine's execution-path
 * discriminant. Pure — no I/O. Consumed by a later task (R2-01-F2) to resolve
 * an agent's execution path from the DEFINITION instead of a hardcoded table.
 *
 * - 'interactive' → 'interactive'
 * - 'unattended' → 'unattended'
 * - 'operator-triggered' → 'unattended' — describes the LAUNCH, not mid-run
 *   interactivity; e.g. project-scoped-review is operator-triggered yet its
 *   own frontmatter says "Fully autonomous once launched — asks no
 *   questions, never blocks mid-run."
 * - 'both' → 'unattended' — runs unattended with an optional operator pause
 *   (e.g. reflector); the unattended path is the safe default.
 * - absent / unknown → 'unattended' — the default. (The only absent-surface
 *   roster agent is architect, which is resolved via the gate table, never
 *   through this helper.)
 */
export function executionPathForSurface(surface: string | undefined): 'interactive' | 'unattended' {
  return surface === 'interactive' ? 'interactive' : 'unattended';
}

/**
 * Server-computed per-agent capability descriptor (R2-02-F1). A pure,
 * no-I/O projection of `AgentDefinition` — the single source for capability
 * FACTS the studio wire threads to the builder UI, so no capability fact is
 * ever re-derived client-side.
 */
export type AgentCapabilityDescriptor = {
  /** true iff the agent runs through the interactive-session runner (not a flow node). */
  interactive: boolean;
  /**
   * The runtime SDK(s) the agent declares — today a one-element set from
   * `runtime.sdk` (a single required string); extension point for R2-06
   * multi-adapter. A surfaced FACT, not a constraint.
   */
  runtimeSdks: string[];
  // Extension points (documented; NOT computed in wave 1 — added where their
  // authoring source lands):
  //   fanoutCapable — R2-03-F2 ;  artifactOutputs — R2-05-F2.
};

/** Compute the wave-1 capability descriptor for an agent definition. Pure — no I/O. */
export function agentCapabilityDescriptor(def: AgentDefinition): AgentCapabilityDescriptor {
  return {
    interactive: executionPathForSurface(def.surface) === 'interactive',
    runtimeSdks: def.runtime.sdk ? [def.runtime.sdk] : [],
  };
}
