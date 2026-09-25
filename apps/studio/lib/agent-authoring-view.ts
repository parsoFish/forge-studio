/**
 * agent-authoring-view — pure state translation for the agent builder page
 * (W7-B4). Moved out of app/agents/[id]/page.tsx so the load/save mapping is
 * unit-testable (lib/library-authoring-render.test.ts pins it):
 *
 *   - parseAgentToState:   server Agent → flat builder state (unchanged move)
 *   - buildAgentPutBody:   flat state → PUT body; carries `create: true` for
 *                          the /agents/new path ONLY (agents-28 — the bridge
 *                          409s a colliding create instead of overwriting)
 *   - duplicateAgentState: agents-09 — a prefill for /agents/new?duplicate=,
 *                          slug cleared (save derives a fresh one) and the
 *                          name marked as a copy.
 *   - EMPTY_STATE/BLANK_STATE: (forge-6gv.19, W8-B4) the builder's two seed
 *                          states, moved here from app/agents/[id]/page.tsx —
 *                          a `'use client'` Next `page.tsx` may only export
 *                          Next's own whitelisted names
 *                          (apps/studio/tests/contract/page-exports-whitelist.test.ts
 *                          enforces it), so they were not importable by a
 *                          test in their old home. See BLANK_STATE's own
 *                          comment below for the security-fence rationale.
 *
 * No DOM, no React, no network. Immutability: every function returns new
 * objects, never mutates its input.
 */

import type { Agent, AgentCapabilityDescriptor, AgentRuntime, AgentFanout, AgentBudgets } from './studio-client';
// Explicit `.ts` extension (moduleResolution: "bundler" tolerates it, and
// Next/vitest already resolve `./authoring-package-shape`-style extension-
// less siblings fine either way) — this is a VALUE import (unlike the
// `import type` above, which is erased entirely and needs no runtime
// resolution), and it must resolve under plain Node ESM too:
// apps/forge/tests/regression/bridge-studio-write-tool-fence.test.ts imports THIS module directly
// via `node --experimental-strip-types`, which does not do bundler-style
// extension-less resolution.
import { TOOL_FENCE_REQUIRED_NAMES } from './tool-fence-required-names.ts';

export type AgentBuilderState = {
  slug: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  guards: string[];
  /** Library hook ids this agent carries (R3-03-F4) — distinct vocabulary
   *  from guards; binding happens ONLY in the Agent Builder. */
  hooks: string[];
  process: string;
  interactivity: string;
  runtime: AgentRuntime;
  brainAccess: string;
  /** R2-09 — the closed upload-kind vocabulary this agent accepts. */
  materials: string[];
  // read-only (SKILL.md-authored)
  allowedTools: string[];
  disallowedTools: string[];
  phase: string;
  capability?: AgentCapabilityDescriptor;
  /** W7-B5 (agents-21): the agent's own declared default ceiling
   *  (SKILL budgets.maxBudgetUsd) — seeds the Run panel's field ahead of the
   *  run-level policy default. Carried through the W7-B4 extraction of this
   *  type out of app/agents/[id]/page.tsx: B5 added it to the inline type on
   *  main while B4 was moving that type here, so the merge had to port it
   *  rather than let either side win. */
  declaredMaxBudgetUsd?: number;
  costCeilingEnforceable: boolean;
  /**
   * agents-15 — SKILL.md-authored, read-only in the builder UI (same class
   * as `phase`/`allowedTools` above): never edited here, only carried
   * through load → Definition Preview so the preview can show the
   * definition as it will actually be saved (the server preserves it
   * unchanged from `existing` when the PUT body omits it — see
   * `buildAgentPutBody`, which does not send it for exactly that reason).
   */
  fanout?: AgentFanout;
  /**
   * agents-15 (forge-6gv.5.1) — the SAME read-only pass-through class as
   * `fanout` above, reachable now that `Agent` (lib/agent-wire.ts, split out
   * of studio-client.ts) actually parses them off the wire.
   * `description`/`surface`/`executor` de-optionalize to `''` the same way
   * `phase` already does above (a real, absent wire value both collapse to
   * the same "nothing declared" builder state); `library`/`budgets` stay
   * optional like `capability`/`fanout` — an object/boolean's ABSENCE is
   * itself meaningful and must not be coerced into a fabricated default.
   */
  description: string;
  library?: boolean;
  surface: string;
  executor: string;
  budgets?: AgentBudgets;
};

export const DEFAULT_AGENT_RUNTIME: AgentRuntime = {
  sdk: 'sdk-claude',
  strategy: 'fixed',
  model: null,
  range: [],
};

/** Server Agent → flat builder state (the GET denormalises composition.*). */
export function parseAgentToState(raw: Agent): AgentBuilderState {
  const rt = raw.runtime ?? { ...DEFAULT_AGENT_RUNTIME };
  return {
    slug: raw.id ?? '',
    name: raw.name ?? '',
    purpose: raw.purpose ?? '',
    skills: (raw.skills ?? []).slice(),
    tools: (raw.tools ?? []).slice(),
    mcps: (raw.mcps ?? []).slice(),
    guards: (raw.guards ?? []).slice(),
    hooks: (raw.hooks ?? []).slice(),
    process: raw.process ?? '',
    interactivity: raw.interactivity ?? '',
    runtime: {
      sdk: rt.sdk ?? 'sdk-claude',
      strategy: rt.strategy ?? 'fixed',
      model: rt.model ?? null,
      range: (rt.range ?? []).slice(),
      // R4-01-F2: loopStrategy is load-bearing declared dispatch (ADR-039).
      loopStrategy: rt.loopStrategy,
    },
    brainAccess: raw.brainAccess ?? 'none',
    materials: raw.materials ?? [],
    allowedTools: ((raw as Record<string, unknown>).allowedTools as string[] | undefined) ?? [],
    disallowedTools: ((raw as Record<string, unknown>).disallowedTools as string[] | undefined) ?? [],
    phase: raw.phase ?? '',
    capability: raw.capability,
    costCeilingEnforceable: raw.costCeilingEnforceable === true,
    declaredMaxBudgetUsd: raw.declaredMaxBudgetUsd,
    fanout: raw.fanout,
    // agents-15 (forge-6gv.5.1)
    description: raw.description ?? '',
    library: raw.library,
    surface: raw.surface ?? '',
    executor: raw.executor ?? '',
    budgets: raw.budgets,
  };
}

/** Flat builder state → the PUT body. `create: true` rides ONLY when the
 *  caller is minting a new agent — an update must never carry it (a stray
 *  create flag on an edit would 409 every save of an existing agent).
 *
 *  forge-hoq: `allowedTools`/`disallowedTools` ride on EVERY save, not just
 *  edits — these are SKILL.md-authored, read-only in the builder UI (ADR-027
 *  A4: not surfaced for editing), but "not editable" is a UI choice and
 *  "not preserved" is data loss. Before this fix the PUT body omitted both
 *  fields entirely, so a brand-new agent minted from a fenced starter
 *  (applyStarter, forge-ui/app/agents/[id]/page.tsx) or a duplicate of a
 *  fenced agent (duplicateAgentState below) landed on disk with NO
 *  disallowed-tools — the bridge's PUT merge (apps/forge/bridge-studio-writes.ts)
 *  has nothing in the body to fall back to `existing` FROM, because there is
 *  no `existing` for a brand-new slug. The bridge still decides
 *  explicit-body-value-wins vs inherit-when-omitted (same convention as
 *  `materials`); this function's job is only to make sure the value the
 *  builder loaded is actually offered. */
export function buildAgentPutBody(state: AgentBuilderState, opts: { create: boolean }): Record<string, unknown> {
  return {
    ...(opts.create ? { create: true } : {}),
    name: state.name.trim(),
    purpose: state.purpose,
    process: state.process, // server maps process → body
    interactivity: state.interactivity,
    brainAccess: state.brainAccess,
    materials: state.materials,
    allowedTools: state.allowedTools,
    disallowedTools: state.disallowedTools,
    composition: {
      skills: state.skills,
      tools: state.tools,
      mcps: state.mcps,
      guards: state.guards,
      hooks: state.hooks,
    },
    runtime: {
      sdk: state.runtime.sdk,
      strategy: state.runtime.strategy,
      model: state.runtime.model ?? undefined,
      range: state.runtime.range,
      loopStrategy: state.runtime.loopStrategy,
    },
  };
}

/**
 * agents-15 — the Definition Preview's ONE data source. Spreads
 * `buildAgentPutBody`'s own return value (so every field that function
 * sends on save — today's composition/runtime/materials/allowedTools/
 * disallowedTools, and whatever future field a save-path change adds —
 * reaches the preview with no second hand-maintained list to keep in
 * sync), then attaches the read-only pass-through fields `buildAgentPutBody`
 * deliberately does NOT send (they are not editable in the builder, so
 * sending them risks nothing today, but the preview must still show them:
 * the server round-trips them unchanged into the saved SKILL.md either
 * way). `slug` rides too — the PUT route param, not a body field, but part
 * of the definition being previewed.
 */
export function buildAgentPreviewModel(state: AgentBuilderState): Record<string, unknown> {
  return {
    slug: state.slug,
    ...buildAgentPutBody(state, { create: false }),
    phase: state.phase,
    fanout: state.fanout,
    // agents-15 (forge-6gv.5.1): same read-only pass-through treatment as
    // phase/fanout above — never sent by buildAgentPutBody, but real and
    // shown here since the server round-trips them unchanged either way.
    description: state.description,
    library: state.library,
    surface: state.surface,
    executor: state.executor,
    budgets: state.budgets,
  };
}

/** agents-09 — the duplicate prefill: the source agent's whole composition
 *  with the slug cleared (save derives a fresh one from the editable name)
 *  and the name marked as a copy so two agents never silently share one. */
export function duplicateAgentState(source: Agent): AgentBuilderState {
  const parsed = parseAgentToState(source);
  return { ...parsed, slug: '', name: `${parsed.name || parsed.slug} (copy)` };
}

/** The builder's baseline "nothing loaded/selected yet" state — the initial
 *  `useState` value, the placeholder before a starter is chosen, and (as of
 *  forge-6gv.19) NEVER the state a Save can actually be issued from: the
 *  page's Save/Discard bar only renders once `starterChosen` is true, which
 *  requires transiting through `applyStarter`/`applyBlank`/an existing-agent
 *  load/a duplicate prefill first — every one of which replaces this object
 *  wholesale before the builder becomes save-reachable. */
export const EMPTY_STATE: AgentBuilderState = {
  slug: '',
  name: '',
  purpose: '',
  skills: [],
  tools: [],
  mcps: [],
  guards: [],
  hooks: [],
  process: '',
  interactivity: '',
  runtime: { ...DEFAULT_AGENT_RUNTIME },
  brainAccess: 'none',
  materials: [],
  allowedTools: [],
  disallowedTools: [],
  phase: '',
  costCeilingEnforceable: false,
  // agents-15 (forge-6gv.5.1)
  description: '',
  surface: '',
  executor: '',
};

/**
 * A "Blank" agent still ships sensible defaults so it is creatable with
 * near-zero input (UX spec §2 — defaults over choices): a default model +
 * the event-log guard means a blank agent passes validation without opening
 * Advanced.
 *
 * forge-6gv.19 (W8-B4) — SECURITY FENCE. `orchestrator/studio/skill-md-
 * fidelity.ts`'s `projectAgentFrontmatter` writes BOTH `allowed-tools` and
 * `disallowed-tools` UNCONDITIONALLY the moment a full re-serialize runs
 * (which a brand-new agent's first save always is — there is no
 * `originalRaw` to byte-preserve). That makes both keys PRESENT in the
 * written SKILL.md regardless of content, which trips `cli/studio-lint-
 * tool-fence.ts`'s presence-only scope test
 * (`declaresToolFrontmatter = 'allowed-tools' in data || 'disallowed-tools'
 * in data` — deliberately content-blind; see that file's header for why).
 * `disallowed-tools` is the only key whose CONTENT that check reads (it is
 * the only real fence against the subagent-spawn tool — `allowed-tools` is
 * advisory-only, no production spawn site sets `options.tools`), so it is
 * the one that must actually carry the fence.
 *
 * The fix seeds `disallowedTools` from `TOOL_FENCE_REQUIRED_NAMES`
 * (apps/studio/lib/tool-fence-required-names.ts) — the SAME array
 * `packages/library/studio-lint-tool-fence.ts` exports and checks against
 * (`packages/library/tests/contract/tool-fence-required-names-parity.test.ts` proves the two arrays
 * cannot drift apart), rather than a bare `['Task', 'Agent']` literal here.
 * `allowedTools` is deliberately left `[]`: the ruling this fixes ("seed
 * BOTH keys' worth of correctness — the enumeration point") means reasoning
 * about both of the producer's two unconditional writes, not that both
 * arrays must carry names — an empty, honestly-advisory `allowed-tools` is
 * already correct for a blank agent (it should pre-approve nothing extra),
 * and `allowed-tools`'s CONTENT plays no part in the lint's missing-names
 * check either way.
 */
export const BLANK_STATE: AgentBuilderState = {
  ...EMPTY_STATE,
  guards: ['event-log'],
  runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
  brainAccess: 'none',
  // A2: a sensible, editable starting point for interactivity — not a blank box.
  interactivity: 'Autonomous — runs to completion without human input.',
  disallowedTools: [...TOOL_FENCE_REQUIRED_NAMES],
};
