/**
 * Pure readiness-check computation for the /agents/[id] builder's
 * ReadinessPanel (R2-02-F4).
 *
 * CAPABILITY facts (whether a runtime SDK is configured, whether the agent
 * is interactive) are sourced from the server-computed F1 capability
 * descriptor (`AgentCapabilityDescriptor` — threaded onto the wire by
 * GET /api/studio/agents + GET /api/studio/starters, carried through
 * verbatim by `parseAgentDefinition`, see `studio-client.ts`) — never
 * re-derived here. That client-side re-derivation
 * (`runtimeConfigured(rt)`: sdk truthy + model/range chosen) was the
 * "hardcoded heuristic" R2-02-F4's AC replaces.
 *
 * CONTENT-COMPLETENESS checks (purpose/skill/hook/process/interactivity) are
 * independent readiness signals — did the operator fill in the form — and
 * are not "the hardcoded heuristic" the AC targets, so they stay as direct
 * field checks, unrelated to the descriptor.
 */
import type { AgentCapabilityDescriptor } from './studio-client';

export type ReadinessInput = {
  purpose: string;
  skills: string[];
  hooks: string[];
  process: string;
  interactivity: string;
  /** Server-computed F1 descriptor; undefined only before the first load/save round-trip. */
  capability?: AgentCapabilityDescriptor;
};

export type ReadinessCheck = { key: string; label: string; ok: boolean };

/**
 * The 6-check readiness list. `runtime`'s `ok` is descriptor-sourced
 * (`capability.runtimeSdks.length > 0`) — a missing/empty runtime (including
 * a not-yet-loaded descriptor) reads not-ready, per the AC "an agent missing
 * a runtime reads not-ready".
 */
export function computeReadinessChecks(state: ReadinessInput): ReadinessCheck[] {
  const runtimeSdks = state.capability?.runtimeSdks ?? [];
  return [
    { key: 'purpose', label: 'Purpose defined', ok: state.purpose.trim().length > 0 },
    { key: 'skill', label: 'At least one skill', ok: state.skills.length > 0 },
    { key: 'hook', label: 'Observability hook attached', ok: state.hooks.length > 0 },
    { key: 'process', label: 'Process described', ok: state.process.trim().length > 0 },
    { key: 'interactivity', label: 'Interactivity described', ok: state.interactivity.trim().length > 0 },
    { key: 'runtime', label: 'Runtime configured (SDK + model)', ok: runtimeSdks.length > 0 },
  ];
}

/**
 * The `interactive` capability fact, surfaced for the operator to see the
 * panel visibly reflect the derived descriptor. Informational — NOT a
 * pass/fail readiness gate on the agent itself (both interactive and
 * unattended agents are valid), so it is deliberately excluded from
 * `computeReadinessChecks`'s check list / ready-count.
 */
export function capabilityInteractive(capability: AgentCapabilityDescriptor | undefined): boolean {
  return capability?.interactive ?? false;
}
