/**
 * RuntimeAdapter interface — the named contract formalising the two existing
 * injectable seams in the Ralph loop:
 *
 *   QueryFn          (loops/ralph/claude-agent.ts:22) — the raw SDK-call boundary.
 *   AgentInvocation  (loops/ralph/runner.ts:133)      — one Ralph iteration.
 *
 * M6-1 (ADR 029): extraction, not redesign. The Claude adapter wraps
 * createClaudeAgent + sdkQuery and is the reference implementation.
 *
 * Re-exports the canonical contract types so adapter authors import from here,
 * not from the underlying implementation files.
 */

export type { AgentInvocation, AgentIterationInfo } from '../ralph/runner.ts';
export type { QueryFn, ClaudeAgentOptions } from '../ralph/claude-agent.ts';

import type { AgentInvocation } from '../ralph/runner.ts';
import type { QueryFn, ClaudeAgentOptions } from '../ralph/claude-agent.ts';

/**
 * The options an adapter's `createAgent` accepts. Starts as the full
 * ClaudeAgentOptions superset — a real second adapter implements the subset it
 * supports and documents any unsupported fields.
 *
 * R2-03-F4 caveat — `externalSignal` (the fanout node's wedge-kill, chained so
 * an in-flight per-item subprocess is actually cancelled) is honored ONLY by
 * the reference `claude` adapter today. Other adapters (`gemini`, `aider`,
 * `example`) accept the field but do not yet wire it into their SDK's
 * cancellation, so a wedge-kill on a node running under one of those adapters
 * still leaves the in-flight iteration to finish on its own. The conformance
 * suite does not assert cancellation because those adapters are unprovisioned.
 * Tracked in known-gaps §4.12; the ADR-028 "no zombie work" guarantee is
 * therefore scoped to the claude adapter until a second adapter honors it.
 */
export type AdapterAgentOptions = ClaudeAgentOptions;

/**
 * RuntimeAdapter — the pluggable SDK seam (ADR 029).
 *
 * Every adapter must satisfy this interface. The conformance suite
 * (loops/_adapters/conformance.ts, M6-2) is the admission gate.
 *
 * Fields:
 *   id          — sdk id registered in the catalog ('claude', 'example', …).
 *   available   — whether the underlying SDK/dep is present and usable.
 *   createAgent — returns the Ralph-runner callable (AgentInvocation).
 *   query       — the raw SDK-call boundary used by direct-stream phases
 *                 (PM / reflector / architect inject this as QueryFn).
 */
export type RuntimeAdapter = {
  id: string;
  available: boolean;
  createAgent(opts: AdapterAgentOptions): AgentInvocation;
  query: QueryFn;
};
