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
import { MATERIAL_KINDS } from './materials.ts';
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
  // ADR-043 §3 amendment (wave-6): the full SKILL-declared tier envelope, set
  // ONLY for strategy:range (see PhaseAgentSpec.allowedTiers's own doc for
  // why strategy:fixed leaves this undefined rather than restating [tier]).
  let allowedTiers: ModelTier[] | undefined;

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
    allowedTiers = tiers;
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
    // ADR-043 §3 amendment: omit the key entirely for strategy:fixed (never
    // set to `undefined`) so the M0 frontmatter-regression literal-equality
    // lock (derive.test.ts) stays byte-identical for every fixed-strategy
    // skill — an explicit `allowedTiers: undefined` key would still show up
    // in `Object.keys()` and break that deep-equal.
    ...(allowedTiers ? { allowedTiers } : {}),
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
  /**
   * true iff the agent runs through the interactive-session runner.
   *
   * ⚑ Corrected R6-06 (2026-08-08): this said "(not a flow node)", which is
   * FALSE and was load-bearing for a decision. `interactive` is derived
   * SOLELY from `def.surface` (`executionPathForSurface` below) and says
   * nothing about flow membership — the two axes are independent.
   * Counter-examples, both measured: `architect` declares no `surface:` key,
   * so it is `interactive: false`, yet it is BOTH a flow node
   * (`studio/flows/forge-architect/flow.yaml`) and a session kind
   * (`studio/session-kinds.yaml`) — it is in fact the only agent on all
   * three execution paths, which is what makes R6-06's per-agent history
   * ledger demonstrable at all. And `project-brain-builder` is a session
   * kind while declaring `surface: unattended`. Read this flag as "is
   * worker-dispatchable or not"; to ask whether an agent is a flow node,
   * read the flow definitions.
   */
  interactive: boolean;
  /**
   * The runtime SDK(s) the agent declares — today a one-element set from
   * `runtime.sdk` (a single required string); extension point for R2-06
   * multi-adapter. A surfaced FACT, not a constraint.
   */
  runtimeSdks: string[];
  /**
   * R2-03-F2 — true iff the agent declares a `fanout:` block (dispatches one
   * instance per driving-artifact item). A surfaced FACT: lint rejects a node
   * whose `fanOut` targets a non-fanout-capable agent, and the builder gates
   * the fanout toggle on it. The full fanout block (driving artifact, isolation,
   * cap) rides on the AgentDefinition itself, already spread onto the wire.
   */
  fanoutCapable: boolean;
  /**
   * R2-09 D4 — the materials this agent accepts, filtered to MATERIAL_KINDS.
   * Absent AND declared-empty definitions both project to `[]` (D2 collapses
   * on the wire, though the two stay distinguishable on the AgentDefinition
   * itself). A value that slipped past `materials/enum` lint (declared on the
   * def but outside the vocabulary) is filtered OUT here — a def that never
   * ran lint must never advertise a non-vocabulary capability on the wire.
   */
  materials: string[];
  /**
   * ⚑ AMENDED W7-B5 (agents-21) — true iff the standalone spawn path can
   * enforce a per-run ceiling: loopStrategy absent (the legacy invocation
   * path) OR exactly 'one-shot'. Both real spawn shapes now enforce — the
   * one-shot stream via `options.maxBudgetUsd` (runOneShotSpawn) and the
   * legacy invocation path via the adapter's `maxBudgetUsdPerIteration`
   * (one invocation run == one iteration, so the per-iteration cap IS the
   * run ceiling — `orchestrator/run-agent.ts` runInvocationSpawn). 'ralph'
   * stays false for a stronger reason than enforceability: `runAgent`
   * refuses a standalone ralph dispatch outright (loops are
   * orchestrator-band), so there is no run to cap at all; an UNKNOWN
   * declared strategy also stays false (runAgent refuses it too). R6-04's
   * original derivation was `=== 'one-shot'`, from when the legacy path had
   * no budget wiring — see derive-cost-ceiling-enforceable.test.ts's
   * amended pins.
   */
  costCeilingEnforceable: boolean;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam;
   * reviewer fix, B5): the full SKILL-declared tier envelope, cheapest-first
   * — the SAME `rangeTiers` computation `deriveAgentSpec` uses for
   * `PhaseAgentSpec.allowedTiers` (see that field's own doc). Present ONLY
   * for a `strategy:range` skill; a `strategy:fixed` skill has exactly one
   * legal tier and leaves this key entirely absent (never `undefined`) so a
   * literal deep-equal against a fixed-strategy descriptor stays
   * byte-identical. This is the wire-facing FACT the kickoff model-tier
   * picker (B6) renders directly — it must never re-derive the envelope
   * from raw `runtime.range` client-side, which is exactly the
   * re-derivation this type's own doc comment forbids.
   */
  allowedTiers?: ModelTier[];
  /**
   * W8-B3 (sessions-kinds-R06 / sessions-kinds-31) — the ONE tier a
   * `strategy:fixed` skill can ever run on, resolved from its declared
   * `runtime.model` by the SAME `TIER_BY_MODEL` lookup `deriveAgentSpec`
   * uses. Present ONLY for `strategy:fixed`; a `strategy:range` skill leaves
   * this key entirely absent (never `undefined`), exactly mirroring how
   * `allowedTiers` above is present only for range — so precisely one of the
   * two keys is ever present, and the *presence* carries the fact.
   *
   * Why it exists: the capability payload exposed the RANGE but never the
   * resolved tier, so for the three fixed-tier kinds (architect,
   * project-brain, onboarding) the whole chain read blank — the kickoff chip
   * printed the literal string "fixed · read-only", the session chip "model:
   * not recorded", and the sessions index "—". On a cost review there was no
   * way to tell what the most expensive session kind in forge actually ran
   * on. A fixed-tier agent still HAS a tier; this names it.
   *
   * DERIVED, never stored: it is read off the SKILL.md at request time, so a
   * skill re-pointed at a different model can never leave a stale copy
   * behind. It is also why the fallback it enables is scoped to
   * `strategy:fixed` ONLY — a range agent's session that recorded no tier ran
   * on whatever the default was at the time, which today's default may no
   * longer be, so "not recorded" stays the honest answer there.
   */
  fixedTier?: ModelTier;
  // Extension point (documented; added where its authoring source lands):
  //   artifactOutputs — R2-05-F2.
};

/**
 * Compute the wave-1 capability descriptor for an agent definition.
 *
 * Pure over its OWN inputs (`def`, `root`) — no network/DB I/O, no mutation
 * — but NOT literally zero filesystem reads: a `strategy:range` def reads
 * `<root>/studio/catalog.yaml` to cost-sort `allowedTiers`, the SAME small
 * read `deriveAgentSpec`'s own range branch performs for `PhaseAgentSpec`.
 * `root` defaults to `FORGE_ROOT` (this module's real forge-install root,
 * matching `deriveAgentSpec`'s own default-param convention) so every
 * existing call site (none of which pass a `root` today) is unaffected.
 */
export function agentCapabilityDescriptor(def: AgentDefinition, root: string = FORGE_ROOT): AgentCapabilityDescriptor {
  // Mirrors the materials guard immediately below: a hand-built/malformed
  // def (or a root with no readable catalog.yaml) must degrade to an ABSENT
  // allowedTiers, never crash the whole capability-descriptor response over
  // one agent — the same "guard the shape first" discipline this function
  // already applies to `def.materials`.
  let allowedTiers: ModelTier[] | undefined;
  if (def.runtime.strategy === 'range' && Array.isArray(def.runtime.range) && def.runtime.range.length > 0) {
    try {
      const catalog = loadCatalog(join(root, 'studio', 'catalog.yaml'));
      allowedTiers = rangeTiers(def.runtime.range, catalog);
    } catch {
      allowedTiers = undefined;
    }
  }

  // W8-B3 (sessions-kinds-R06) — the resolved tier for a strategy:fixed
  // skill, by the SAME TIER_BY_MODEL lookup deriveAgentSpec uses. A model
  // string outside the catalog leaves the key absent rather than guessing —
  // the same degrade-don't-crash discipline the allowedTiers branch above
  // applies (and unlike deriveAgentSpec, this descriptor must not throw over
  // one malformed agent: it is served on a live read route).
  const fixedTier: ModelTier | undefined =
    def.runtime.strategy === 'fixed' && typeof def.runtime.model === 'string'
      ? TIER_BY_MODEL[def.runtime.model]
      : undefined;

  return {
    interactive: executionPathForSurface(def.surface) === 'interactive',
    runtimeSdks: def.runtime.sdk ? [def.runtime.sdk] : [],
    fanoutCapable: def.fanout !== undefined,
    // 2026-08-05 adversarial-review round 2, finding B/3: `def.materials` may
    // be a non-array shape on any hand-built AgentDefinition that didn't go
    // through `loadAgentDefinition` (`(def.materials ?? []).filter(...)`
    // threw `TypeError: ....filter is not a function` on a bare string,
    // crashing the WHOLE capability-descriptor response over one malformed
    // agent). Guard the shape first — a non-array materials value degrades
    // to `[]`, never a throw.
    materials: Array.isArray(def.materials)
      ? def.materials.filter((m) => (MATERIAL_KINDS as readonly string[]).includes(m))
      : [],
    // Exact match only — see the field's own doc comment above for why a
    // truthy/substring check is the wrong shape here.
    costCeilingEnforceable:
      def.runtime.loopStrategy === undefined || def.runtime.loopStrategy === 'one-shot',
    // Omit the key entirely when absent (never `allowedTiers: undefined`) —
    // same discipline as PhaseAgentSpec.allowedTiers, so a fixed-strategy
    // descriptor's literal deep-equal stays byte-identical.
    ...(allowedTiers ? { allowedTiers } : {}),
    // W8-B3 — same omit-the-key-entirely discipline, and the exact mirror of
    // allowedTiers: precisely one of the two is ever present.
    ...(fixedTier ? { fixedTier } : {}),
  };
}
