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
 *
 * No DOM, no React, no network. Immutability: every function returns new
 * objects, never mutates its input.
 */

import type { Agent, AgentCapabilityDescriptor, AgentRuntime } from './studio-client';

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
  costCeilingEnforceable: boolean;
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
  };
}

/** Flat builder state → the PUT body. `create: true` rides ONLY when the
 *  caller is minting a new agent — an update must never carry it (a stray
 *  create flag on an edit would 409 every save of an existing agent). */
export function buildAgentPutBody(state: AgentBuilderState, opts: { create: boolean }): Record<string, unknown> {
  return {
    ...(opts.create ? { create: true } : {}),
    name: state.name.trim(),
    purpose: state.purpose,
    process: state.process, // server maps process → body
    interactivity: state.interactivity,
    brainAccess: state.brainAccess,
    materials: state.materials,
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

/** agents-09 — the duplicate prefill: the source agent's whole composition
 *  with the slug cleared (save derives a fresh one from the editable name)
 *  and the name marked as a copy so two agents never silently share one. */
export function duplicateAgentState(source: Agent): AgentBuilderState {
  const parsed = parseAgentToState(source);
  return { ...parsed, slug: '', name: `${parsed.name || parsed.slug} (copy)` };
}
