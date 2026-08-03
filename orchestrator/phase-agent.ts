/**
 * ADR 024 — the orchestrator → agent → skills seam, made concrete.
 *
 * A `PhaseAgentSpec` is the ORCHESTRATOR-SIDE declaration of a phase agent:
 * which skill it composes (the single source of phase intent), which model
 * TIER the orchestrator spawns it at, and its tool allow-list. The orchestrator
 * binds the run context (worktree, cycle id, artifacts) + this spec, then spawns
 * a clean agent — it does NOT author the phase's intent (that lives in the skill).
 *
 * The model is chosen by TIER, not hard-coded per phase: mechanical/cheap work
 * runs on Haiku, standard implementation on Sonnet, deep reasoning on Opus. One
 * place (`MODEL_BY_TIER`) maps tier → concrete model id, so a tier re-point is a
 * single edit.
 *
 * The seam is consumed by every phase agent's binding (e.g. the demo agent's
 * `deriveAgentSpec(skillPath('demo-agent'))`); each phase sources its intent
 * from its `SKILL.md` via `PhaseAgentSpec` (ADR 024, migration complete —
 * R4-01-F4 retired the last legacy phase, the unifier). Pure data + a resolver
 * — no SDK / IO.
 */

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Tier → concrete model id. Centralised so model-tier policy is one edit.
 * IDs per the running environment (Opus 4.8 / Sonnet 4.6 / Haiku 4.5).
 */
export const MODEL_BY_TIER: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};

export type PhaseAgentSpec = {
  /** The phase this agent runs (matches the event-log phase / UI hex). */
  phase: string;
  /**
   * The skill it composes — the single source of phase intent. Path relative to
   * the forge root (e.g. `skills/developer-unifier/SKILL.md`).
   */
  skill: string;
  /** Model tier the orchestrator spawns it at. */
  tier: ModelTier;
  /** Tool allow-list the agent runs with. */
  allowedTools: readonly string[];
  /** Tools explicitly denied. */
  disallowedTools: readonly string[];
  /**
   * The runtime SDK id (ADR 029) this agent runs on — mirrors the SKILL.md
   * `runtime.sdk` frontmatter (e.g. `claude`, `gemini`, `aider`). Free-text
   * here is gated at the call site by `resolveSdkId` before it reaches
   * `getAdapter` (which throws on an unregistered id), so an unknown/unavailable
   * sdk falls back to `claude` rather than crashing the phase.
   */
  sdk?: string;
};

/** Resolve the concrete model id the orchestrator spawns this agent at. */
export function modelForSpec(spec: PhaseAgentSpec): string {
  return MODEL_BY_TIER[spec.tier];
}
