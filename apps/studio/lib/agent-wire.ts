/**
 * agent-wire — the `Agent` wire type and its parse function(s), plus its
 * sibling agent-only helpers (capability/fanout/tier/budgets parsing and the
 * separate `AgentCapability` descriptor). Split out of `studio-client.ts`
 * (agents-15, forge-6gv.5.1) so that file can grow the fields the Definition
 * Preview needs and never had — `description`/`library`/`surface`/
 * `executor`/`budgets` — without breaking its own 800-line file-size ratchet
 * (`scripts/baselines/file-size.json`, `check-file-size.mjs` fails on ANY
 * growth of a baselined file, exempted or not).
 *
 * Mirrors the split `run-cost-guards.ts` did out of the same file (#842,
 * forge-byh): pure, no-I/O functions move; the `fetch*` functions that ride
 * `studio-client.ts`'s own `bridgeFetch`/`studioRead` transport stay put and
 * import `Agent`/`parseAgentDefinition`/`AgentCapability`/
 * `parseAgentCapability` from here instead.
 *
 * `Provenance`/`parseProvenance` and `parseMaterials` stay in
 * `studio-client.ts` — both are used well beyond agents (Flow, Kb, …) — and
 * are imported back into this module. `studio-client.ts` in turn imports
 * `Agent`/`parseAgentDefinition` (and this module's other exports) from
 * here, so the two files reference each other. That is safe: every
 * cross-referenced value below is a hoisted `function` declaration (never a
 * `const`), so both modules are fully defined before either one's top-level
 * code actually calls into the other — the cycle is inert at load and only
 * ever resolved lazily, inside a function body, exactly like every other
 * call site of these parsers.
 */

import type { AgentBudgets, AgentFanout } from '@forge/contracts';
import { parseMaterials, parseProvenance, type Provenance } from './studio-client';

export type { AgentBudgets, AgentFanout };

export type AgentRuntime = {
  sdk: string;
  strategy: string;
  model: string | null;
  range: string[];
  label?: string;
  loopStrategy?: string; // A7: 'ralph' | 'one-shot' (dev-loop strategy)
};

/**
 * Server-computed per-agent capability descriptor (R2-02-F1,
 * orchestrator/studio/derive.ts `agentCapabilityDescriptor`). Re-declared
 * client-side per studio-client.ts's header convention — threaded onto the
 * wire by the bridge (GET /api/studio/agents, GET /api/studio/starters) and
 * carried through as-is by `parseAgentDefinition`; NEVER re-derived here (a
 * capability fact computed only in UI code is the exact thing R2-02-F1
 * forbids).
 */
export type AgentCapabilityDescriptor = {
  interactive: boolean;
  runtimeSdks: string[];
  /** R2-03-F2 — true iff the agent declares a `fanout:` block. */
  fanoutCapable: boolean;
};

/** W6-B6 — client mirror of `orchestrator/phase-agent.ts`'s `ModelTier`
 *  (re-declared per studio-client.ts's own convention). */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export type Agent = {
  id: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  guards: string[];
  // Library hook ids this agent carries (R3-03-F4) — a DISTINCT vocabulary
  // from `guards` (ADR-027 R3-03 amendment: composition.hooks holds library
  // hook ids, composition.guards holds the fixed platform dispatch-key set).
  hooks: string[];
  /**
   * R2-09 D1/D2 — the closed set of upload kinds (see MATERIAL_KINDS in
   * studio-client.ts) this agent declares it accepts. `undefined` = not
   * declared on the wire payload (parse failure or genuinely absent —
   * parseMaterials collapses both, see its header); `[]` = declared-empty
   * ("accepts nothing"), a meaningful value distinct from absence. Never
   * fabricate one from the other.
   */
  materials?: string[];
  interactivity?: string;
  process?: string;
  runtime?: AgentRuntime;
  brainAccess?: string;
  phase?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  capability?: AgentCapabilityDescriptor;
  /** R2-03-F2 — the agent's declared fanout block (drives the node fanOut binding). */
  fanout?: AgentFanout;
  /**
   * R6-04 WI-3 — server-computed FACT (orchestrator/studio/derive.ts
   * `agentCapabilityDescriptor().costCeilingEnforceable`), read directly off
   * the wire's `capability` object rather than through `parseCapability`
   * (whose 3-key return shape is pinned byte-for-byte by
   * `studio-client.test.ts`'s existing `toEqual` assertions — adding a 4th
   * key there would break those unrelated, already-green pins). Mirrors the
   * SAME "own top-level field, parsed independently of `capability`"
   * precedent `materials` already established above. Absent/malformed wire
   * payload degrades to `false` — never fabricated as enforceable.
   */
  costCeilingEnforceable?: boolean;
  /** W7-B5 (agents-21): the agent's own declared `budgets.maxBudgetUsd`
   *  (its default standalone-run ceiling — docs/reference/agent-cost-ceilings.md).
   *  Absent = the agent declares none; the run-level policy default
   *  applies. */
  declaredMaxBudgetUsd?: number;
  /**
   * W6-B6 (ADR-043 2026-08-15 amendment §3) — server-computed FACT
   * (`orchestrator/studio/derive.ts`'s `agentCapabilityDescriptor().
   * allowedTiers`), read directly off the wire's `capability` object —
   * SAME "own top-level field, parsed independently of `capability`"
   * precedent `costCeilingEnforceable` establishes immediately above (its
   * doc explains why: `capability`'s 3-key return shape is pinned
   * byte-for-byte by `studio-client.test.ts`'s existing `toEqual` pins).
   * Present ONLY for a `strategy:range` skill (the full SKILL-declared tier
   * envelope, cheapest-first); absent for `strategy:fixed` — the kickoff
   * page's model-tier picker renders a radio group when present, a
   * read-only chip naming `runtime.model` when absent. Absent/malformed
   * wire payload degrades to `undefined` (no picker), never a fabricated
   * single-tier array.
   */
  allowedTiers?: ModelTier[];
  /**
   * forge-3oq: server-sourced provenance (see `Provenance`'s header in
   * studio-client.ts). Optional on the client TYPE (not the wire payload)
   * so pre-existing empty/fallback Agent literals elsewhere in forge-ui keep
   * compiling — `parseAgentDefinition` always attaches a real value
   * (`'unknown'` at worst) for every agent that actually came off the wire.
   */
  provenance?: Provenance;
  /**
   * agents-15 (forge-6gv.5.1) — SKILL.md-authored metadata the Definition
   * Preview needs: the skill frontmatter `description`, studio-roster
   * visibility `library`, launch `surface`, and declared flow-engine
   * `executor` kind (mirrors `@forge/contracts`'s `AgentDefinition`).
   * `description` is a REQUIRED server field but stays optional on this
   * client type — same "optional on the TYPE, always-real off the parser"
   * discipline `provenance` documents just above, so pre-existing hand-built
   * `Agent` fixtures across forge-ui keep compiling without this field.
   */
  description?: string;
  library?: boolean;
  surface?: string;
  executor?: string;
  /**
   * agents-15 (forge-6gv.5.1) — the agent's full declared budgets block
   * (`@forge/contracts`'s `AgentBudgets`, reused rather than re-declared —
   * see this module's header). `declaredMaxBudgetUsd` above already
   * surfaces ONE of its members (`maxBudgetUsd`) for the Run panel's
   * ceiling seed; this carries the WHOLE block for the Definition Preview,
   * which shows every declared budget lever, not just the one the Run panel
   * pre-fills from.
   */
  budgets?: AgentBudgets;
};

/**
 * Parse a raw `capability` field (server shape, R2-02-F1) into the client
 * `AgentCapabilityDescriptor` type. Carries the server-computed value
 * through verbatim — no capability fact is derived here. Returns undefined
 * if the field is absent or malformed (e.g. an older bridge payload).
 * Exported for direct unit testing (AC3: the value is carried, not
 * re-derived — see `studio-client.test.ts`).
 */
export function parseCapability(raw: unknown): AgentCapabilityDescriptor | undefined {
  const c = raw as Partial<AgentCapabilityDescriptor> | undefined;
  if (!c || typeof c.interactive !== 'boolean' || !Array.isArray(c.runtimeSdks)) return undefined;
  // fanoutCapable is optional-tolerant: an older bridge payload without it
  // degrades to false (not the whole descriptor to undefined).
  return { interactive: c.interactive, runtimeSdks: c.runtimeSdks as string[], fanoutCapable: c.fanoutCapable === true };
}

/** R2-03-F2 — carry the raw AgentDefinition.fanout block through; undefined if absent/malformed. */
export function parseFanout(raw: unknown): AgentFanout | undefined {
  const f = raw as Partial<AgentFanout> | undefined;
  if (!f || typeof f.drivingArtifact !== 'string' || typeof f.isolation !== 'string') return undefined;
  return {
    drivingArtifact: f.drivingArtifact,
    isolation: f.isolation,
    ...(typeof f.concurrencyCap === 'number' ? { concurrencyCap: f.concurrencyCap } : {}),
    ...(typeof f.perItemGate === 'string' ? { perItemGate: f.perItemGate } : {}),
  };
}

/**
 * agents-15 (forge-6gv.5.1) — parse the raw AgentDefinition.budgets block
 * (server-required, `@forge/contracts`'s `AgentBudgets`) into the client
 * field. Mirrors `parseFanout`'s per-key spread-conditional discipline
 * rather than reject-the-whole-object: `AgentBudgets` has no required key to
 * anchor an all-or-nothing decision on, so a malformed VALUE for one key is
 * omitted while every other valid key still rides, never a crash. A
 * non-object raw payload (absent/null/array/primitive) parses to
 * `undefined` — genuinely no budgets info, distinct from a real-but-empty
 * declared object (`{}`, an agent that declares the block with no overrides).
 */
export function parseBudgets(raw: unknown): AgentBudgets | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const b = raw as Record<string, unknown>;
  return {
    ...(typeof b['iterationFloor'] === 'number' ? { iterationFloor: b['iterationFloor'] } : {}),
    ...(typeof b['iterationCap'] === 'number' ? { iterationCap: b['iterationCap'] } : {}),
    ...(typeof b['maxTurnsPerIteration'] === 'number' ? { maxTurnsPerIteration: b['maxTurnsPerIteration'] } : {}),
    ...(typeof b['wedgeKillMs'] === 'number' ? { wedgeKillMs: b['wedgeKillMs'] } : {}),
    ...(typeof b['maxTurns'] === 'number' ? { maxTurns: b['maxTurns'] } : {}),
    ...(typeof b['maxBudgetUsd'] === 'number' ? { maxBudgetUsd: b['maxBudgetUsd'] } : {}),
    ...(typeof b['maxBudgetUsdShare'] === 'number' ? { maxBudgetUsdShare: b['maxBudgetUsdShare'] } : {}),
  };
}

const MODEL_TIER_VALUES: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

/** W8-B3 — the single-tier sibling of `parseAllowedTiers` below: a value
 *  outside the closed `ModelTier` vocabulary is refused, never coerced. */
function isModelTier(raw: unknown): raw is ModelTier {
  return typeof raw === 'string' && (MODEL_TIER_VALUES as readonly string[]).includes(raw);
}

/** W6-B6 — carry `capability.allowedTiers` through verbatim; `undefined` for
 *  an absent/malformed value (an older bridge payload, or a `strategy:fixed`
 *  skill that never carries the key at all) — never a fabricated single-tier
 *  array. Every element must be a real `ModelTier`; ANY unrecognised element
 *  degrades the WHOLE array to `undefined` rather than silently dropping
 *  just that one entry (a partial tier list would let the kickoff picker
 *  offer a narrower-than-real range without any signal something's wrong). */
function parseAllowedTiers(raw: unknown): ModelTier[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (!raw.every((t): t is ModelTier => typeof t === 'string' && (MODEL_TIER_VALUES as readonly string[]).includes(t))) return undefined;
  return raw;
}

/**
 * Map a raw AgentDefinition (server shape) to the client Agent type.
 * Server: slug, composition.{skills,tools,mcps,guards}, body, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools, capability
 * Client: id, skills, tools, mcps, guards, process, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools, capability
 */
export function parseAgentDefinition(raw: unknown): Agent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const comp = (r['composition'] ?? {}) as Record<string, unknown>;
  const rt = (r['runtime'] ?? {}) as Partial<AgentRuntime>;
  const cap = (r['capability'] ?? {}) as Record<string, unknown>;
  return {
    id:             typeof r['slug']          === 'string' ? r['slug']          : '',
    name:           typeof r['name']          === 'string' ? r['name']          : '',
    purpose:        typeof r['purpose']       === 'string' ? r['purpose']       : '',
    skills:         Array.isArray(comp['skills'])  ? (comp['skills']  as string[]) : [],
    tools:          Array.isArray(comp['tools'])   ? (comp['tools']   as string[]) : [],
    mcps:           Array.isArray(comp['mcps'])    ? (comp['mcps']    as string[]) : [],
    guards:         Array.isArray(comp['guards'])  ? (comp['guards']  as string[]) : [],
    hooks:          Array.isArray(comp['hooks'])   ? (comp['hooks']   as string[]) : [],
    process:        typeof r['body']          === 'string' ? r['body']          : '',
    interactivity:  typeof r['interactivity'] === 'string' ? r['interactivity'] : '',
    brainAccess:    typeof r['brainAccess']   === 'string' ? r['brainAccess']   : 'none',
    phase:          typeof r['phase']         === 'string' ? r['phase']         : undefined,
    // agents-15 (forge-6gv.5.1): SKILL.md-authored metadata, same
    // "declared-or-absent, never fabricated" discipline as `phase` above.
    description:    typeof r['description']   === 'string'  ? r['description']   : '',
    library:        typeof r['library']       === 'boolean' ? r['library']       : undefined,
    surface:        typeof r['surface']       === 'string'  ? r['surface']       : undefined,
    executor:       typeof r['executor']      === 'string'  ? r['executor']      : undefined,
    allowedTools:   Array.isArray(r['allowedTools'])    ? (r['allowedTools']    as string[]) : [],
    disallowedTools:Array.isArray(r['disallowedTools']) ? (r['disallowedTools'] as string[]) : [],
    capability:     parseCapability(r['capability']),
    fanout:         parseFanout(r['fanout']),
    materials:      parseMaterials(r['materials']),
    costCeilingEnforceable: cap['costCeilingEnforceable'] === true,
    // W7-B5 (agents-21): the agent's OWN declared default ceiling
    // (SKILL.md `budgets.maxBudgetUsd`) — seeds the kickoff field ahead of
    // the run-level policy default. Absent stays absent.
    declaredMaxBudgetUsd: typeof (r['budgets'] as Record<string, unknown> | undefined)?.['maxBudgetUsd'] === 'number'
      ? ((r['budgets'] as Record<string, unknown>)['maxBudgetUsd'] as number)
      : undefined,
    // agents-15 (forge-6gv.5.1): the WHOLE declared budgets block — see
    // `Agent.budgets`'s own header for why this carries more than the one
    // member `declaredMaxBudgetUsd` already surfaces above.
    budgets:        parseBudgets(r['budgets']),
    allowedTiers:   parseAllowedTiers(cap['allowedTiers']),
    provenance:     parseProvenance(r['provenance']),
    runtime: {
      sdk:           typeof rt.sdk           === 'string' ? rt.sdk           : 'claude-code',
      strategy:      (rt.strategy === 'fixed' || rt.strategy === 'range') ? rt.strategy : 'fixed',
      model:         typeof rt.model         === 'string' ? rt.model         : null,
      range:         Array.isArray(rt.range)             ? rt.range          : [],
      loopStrategy:  typeof rt.loopStrategy  === 'string' ? rt.loopStrategy  : undefined,
    },
  };
}

/**
 * W6-B6 fix (wave-6 final gate, journey demo-builder DB-4) — the FULL server
 * `AgentCapabilityDescriptor` (orchestrator/studio/derive.ts), fetched
 * directly for ONE named slug via `fetchAgentCapability` (studio-client.ts).
 * NOT the roster's 3-key `capability` field `parseCapability` above parses
 * (whose shape is pinned separately — see that function's own header for
 * why); this type carries every key the server descriptor has, `allowedTiers`
 * included.
 *
 * Exists because `/api/studio/agents`' roster (`fetchStudioAgents`) filters
 * out every `library: false` agent (`@forge/agents`'s
 * `isStudioAgent`) — every kickoff-only system agent (demo-builder,
 * instructions-creator, brain-maintenance, creation-agent,
 * project-brain-builder) sets that flag, so NONE of them were ever
 * resolvable through the roster. This type/fetch pair resolves ONE agent
 * directly against the bridge's UNFILTERED per-slug capability route
 * instead.
 */
export type AgentCapability = {
  interactive: boolean;
  runtimeSdks: string[];
  fanoutCapable: boolean;
  materials: string[];
  costCeilingEnforceable: boolean;
  allowedTiers?: ModelTier[];
  /**
   * W8-B3 (sessions-kinds-R06) — the ONE tier a `strategy:fixed` agent can
   * run on, server-derived off its SKILL.md `runtime.model`. The exact
   * mirror of `allowedTiers`: present only for `fixed`, absent for `range`,
   * so precisely one of the two keys ever arrives and the PRESENCE carries
   * the fact. The kickoff picker names it in the read-only chip instead of
   * printing the literal string "fixed · read-only", which is why the three
   * fixed-tier session kinds never named their model anywhere.
   */
  fixedTier?: ModelTier;
};

/** Parse `GET /api/studio/agents/:slug/capability`'s `capability` field.
 *  Returns `null` for an absent/malformed payload (unknown slug, older
 *  bridge, or the no-bridge-configured fallback `{}`) — never a fabricated
 *  stand-in descriptor. Exported for direct unit testing, same precedent as
 *  `parseCapability` above. */
export function parseAgentCapability(raw: unknown): AgentCapability | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c['interactive'] !== 'boolean' || !Array.isArray(c['runtimeSdks'])) return null;
  const allowedTiers = parseAllowedTiers(c['allowedTiers']);
  return {
    interactive: c['interactive'] as boolean,
    runtimeSdks: c['runtimeSdks'] as string[],
    fanoutCapable: c['fanoutCapable'] === true,
    materials: Array.isArray(c['materials']) ? (c['materials'] as string[]) : [],
    costCeilingEnforceable: c['costCeilingEnforceable'] === true,
    // Omit the key entirely when absent (never `allowedTiers: undefined`) —
    // same discipline as the server's own AgentCapabilityDescriptor
    // (orchestrator/studio/derive.ts) and PhaseAgentSpec.allowedTiers.
    ...(allowedTiers ? { allowedTiers } : {}),
    // W8-B3 — same discipline; a malformed/absent value stays absent rather
    // than becoming a fabricated tier.
    ...(isModelTier(c['fixedTier']) ? { fixedTier: c['fixedTier'] } : {}),
  };
}
