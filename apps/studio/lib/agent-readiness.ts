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
 * (D3: readiness is EXECUTED, never declared).
 *
 * THE CHECK LIST IS CLOSED (rulings 400/410, T1 M6). This check used to be
 * APPENDED only when `connectionsUnready` was defined, so the LENGTH of the
 * list moved with whether the agent happened to have a tool bound. Measured
 * on S5 beat 9 (`data-ready-count: expected "6", got "7"`): a bound that
 * moves with what it measures measures nothing, and no harness or screen
 * reader can assert it. Every check this module can name is now always
 * named; what varies is its STATE.
 *
 * THAT IS WHY A CHECK HAS THREE ANSWERS, NOT TWO. `connectionsUnready:
 * undefined` means "the connections fetch has not resolved yet" — neither
 * ready nor not-ready. The old code was RIGHT to refuse to fabricate either
 * answer; its mistake was expressing that refusal by dropping the row. Both
 * halves are kept: the row is always there, and while the fetch is
 * unresolved it says `pending` in its own words. A caller that shows a
 * "ready" badge must therefore wait for every row to RESOLVE, not merely
 * count the ones that pass — see `ReadinessPanel.tsx`.
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

/**
 * A check has three answers. `pending` is not a shade of not-ready: it is the
 * absence of an answer, and a surface that renders it as either failure or
 * success is lying about what it knows (rulings 400/410).
 */
export type ReadinessState = 'ready' | 'not-ready' | 'pending';

export type ReadinessCheck = { key: string; label: string; state: ReadinessState; detail?: string };

/** The one place a boolean becomes a state, so no caller re-derives the mapping. */
const stateOf = (ok: boolean): ReadinessState => (ok ? 'ready' : 'not-ready');

/**
 * The readiness-check list: SEVEN checks, always, in a fixed order (rulings
 * 400/410 — see the module header for why the length may never move).
 * `runtime`'s state is descriptor-sourced (`capability.runtimeSdks.length >
 * 0`) — a missing/empty runtime (including a not-yet-loaded descriptor)
 * reads not-ready, per the AC "an agent missing a runtime reads not-ready".
 * `connections` is the only check that can read `pending`, because it is the
 * only one whose input arrives from a fetch rather than from form state.
 */
export function computeReadinessChecks(state: ReadinessInput): ReadinessCheck[] {
  const runtimeSdks = state.capability?.runtimeSdks ?? [];
  const unready = state.connectionsUnready;
  return [
    { key: 'purpose', label: 'Purpose defined', state: stateOf(state.purpose.trim().length > 0) },
    { key: 'skill', label: 'At least one skill', state: stateOf(state.skills.length > 0) },
    { key: 'guard', label: 'Observability guard attached', state: stateOf(state.guards.length > 0) },
    { key: 'process', label: 'Process described', state: stateOf(state.process.trim().length > 0) },
    { key: 'interactivity', label: 'Interactivity described', state: stateOf(state.interactivity.trim().length > 0) },
    { key: 'runtime', label: 'Runtime configured (SDK + model)', state: stateOf(runtimeSdks.length > 0) },
    {
      key: 'connections',
      label: 'Bound tools/MCPs ready',
      state: unready === undefined ? 'pending' : stateOf(unready.length === 0),
      ...(unready !== undefined && unready.length > 0 ? { detail: blockedRunMessage(unready) } : {}),
    },
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
