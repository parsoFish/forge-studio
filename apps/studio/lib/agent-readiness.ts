/**
 * Pure readiness-check computation for the /agents/[id] builder's
 * ReadinessPanel (R2-02-F4; connections check added R3-04-F3).
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
 * CONTENT-COMPLETENESS checks (purpose/skill/guard/process/interactivity) are
 * independent readiness signals — did the operator fill in the form — and
 * are not "the hardcoded heuristic" the AC targets, so they stay as direct
 * field checks, unrelated to the descriptor.
 *
 * CONNECTIONS check (R3-04-F3, D9.3): whether every bound tool/mcp is REAL
 * probe-`available` — sourced from `connection-library-view.ts`'s
 * `unreadyBoundConnections`, itself driven by real `ConnectionWire.probe.state`
 * (D3: readiness is EXECUTED, never declared). `connectionsUnready` is
 * OPTIONAL and the check is APPENDED only when it is defined (not merely
 * empty) — undefined means "the connections fetch has not resolved yet" and
 * the check is omitted rather than fabricated as ready or not-ready. This
 * also keeps `agent-readiness.test.ts`'s pre-existing "exactly 6 checks"
 * pin intact for every caller that never supplies the field; the 7th check
 * only appears once the agent-builder page (the one real caller) has loaded
 * real connection data.
 */
import type { AgentCapabilityDescriptor } from './studio-client';
import { blockedRunMessage, type UnreadyConnectionRef } from './connection-library-view';

export type ReadinessInput = {
  purpose: string;
  skills: string[];
  guards: string[];
  process: string;
  interactivity: string;
  /** Server-computed F1 descriptor; undefined only before the first load/save round-trip. */
  capability?: AgentCapabilityDescriptor;
  /** R3-04-F3 — this agent's bound-but-not-`available` tools/mcps (real probe
   *  state). Undefined = not yet determined (see module header); `[]` = every
   *  bound connection is ready (or none are bound). */
  connectionsUnready?: readonly UnreadyConnectionRef[];
};

export type ReadinessCheck = { key: string; label: string; ok: boolean; detail?: string };

/**
 * The readiness-check list: 6 content/capability checks, plus a 7th
 * `connections` check IFF `state.connectionsUnready` is defined (see module
 * header — omitted rather than fabricated while connection data is still
 * loading). `runtime`'s `ok` is descriptor-sourced
 * (`capability.runtimeSdks.length > 0`) — a missing/empty runtime (including
 * a not-yet-loaded descriptor) reads not-ready, per the AC "an agent missing
 * a runtime reads not-ready".
 */
export function computeReadinessChecks(state: ReadinessInput): ReadinessCheck[] {
  const runtimeSdks = state.capability?.runtimeSdks ?? [];
  const checks: ReadinessCheck[] = [
    { key: 'purpose', label: 'Purpose defined', ok: state.purpose.trim().length > 0 },
    { key: 'skill', label: 'At least one skill', ok: state.skills.length > 0 },
    { key: 'guard', label: 'Observability guard attached', ok: state.guards.length > 0 },
    { key: 'process', label: 'Process described', ok: state.process.trim().length > 0 },
    { key: 'interactivity', label: 'Interactivity described', ok: state.interactivity.trim().length > 0 },
    { key: 'runtime', label: 'Runtime configured (SDK + model)', ok: runtimeSdks.length > 0 },
  ];
  if (state.connectionsUnready !== undefined) {
    const unready = state.connectionsUnready;
    checks.push({
      key: 'connections',
      label: 'Bound tools/MCPs ready',
      ok: unready.length === 0,
      ...(unready.length > 0 ? { detail: blockedRunMessage(unready) } : {}),
    });
  }
  return checks;
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
