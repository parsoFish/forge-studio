/**
 * Shared pre-spawn connection-readiness gate (R3-04 D9, `_wave5/specs/R3-04.md`).
 * The ONE derivation both real enforcement points consume:
 *
 *   - `packages/agents/run-agent.ts`'s D9.1 pre-spawn block (the seam all six
 *     `runAgent` callers pass through — flow-runner, agent-dispatch, and the
 *     four phase bindings).
 *   - `apps/forge/ui-bridge.ts`'s D9.2 refusal on `POST /api/agents/:slug/run`.
 *
 * Both compose the already-shipped PURE `connectionsReadinessFor`
 * (`connection-readiness.ts`) with a REAL probe of exactly the connections
 * `def` binds. Kept as one module so the two enforcement points can never
 * open-code a second derivation with a different vocabulary — the exact
 * mistake the R3-01 integration caught.
 *
 * Cost discipline (D9): an agent binding nothing (`composition.tools` AND
 * `composition.mcps` both empty) never calls a prober at all — not the real
 * one, not an injected one. `unreadyConnectionsFor` returns `[]` before
 * touching `probeFn`, so the "no bound connections" case is a true
 * zero-probe-children fast path, not just an empty result after probing.
 */

import { connectionsReadinessFor, type UnreadyConnection } from '@forge/library/studio/connection-readiness.ts';
import { connectionById } from '@forge/library/studio/connection-library.ts';
import { probeConnection as probeConnectionReal, type ProbeResult } from '@forge/library/studio/connection-probe.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

/**
 * The real production prober: resolves `id` against `forgeRoot`'s curated
 * catalog (`connectionById`) and probes it for real (`probeConnection`). An
 * id that does not resolve to a curated connection at all is reported
 * `not-installed` — the declared-data-fails-open guard applied one layer up:
 * a bound id that isn't even a real catalog connection cannot possibly read
 * as ready.
 */
export function defaultProbeConnection(forgeRoot: string, id: string): ProbeResult {
  const conn = connectionById(forgeRoot, id);
  return conn ? probeConnectionReal(forgeRoot, conn) : { state: 'not-installed' };
}

/**
 * Every bound-but-not-ready connection for `def`, or `[]` for an agent that
 * binds nothing. `probeFn` is test-injection only (mirrors `RunContext.
 * queryFn`'s shape) — production omits it and gets the real default prober
 * above, scoped to `forgeRoot`.
 */
export function unreadyConnectionsFor(
  forgeRoot: string,
  def: AgentDefinition,
  probeFn?: (id: string) => ProbeResult,
): UnreadyConnection[] {
  const boundIds = new Set([...def.composition.tools, ...def.composition.mcps]);
  if (boundIds.size === 0) return [];

  const probe = probeFn ?? ((id: string) => defaultProbeConnection(forgeRoot, id));
  const results = new Map<string, ProbeResult>();
  for (const id of boundIds) results.set(id, probe(id));
  return connectionsReadinessFor(def, results);
}

/**
 * Formats the D9 "name the component + its state" error message — one
 * wording, shared by both enforcement points, so an operator sees the same
 * vocabulary whether the block came from the bridge route or the runAgent
 * seam. "Agent not ready" alone is a failure of this AC — every unready
 * component's id and state are named explicitly.
 */
export function formatUnreadyConnections(def: AgentDefinition, unready: UnreadyConnection[]): string {
  const detail = unready.map((u) => `${u.id} (${u.kind}): ${u.state}`).join(', ');
  return `agent "${def.slug}" is not ready to run — unready bound connection(s): ${detail}`;
}
