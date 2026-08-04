/**
 * connectionsReadinessFor (WI-3's shared combinator, R3-04 D9/D-D) — the pure
 * function `orchestrator/run-agent.ts`'s pre-spawn block AND the bridge run
 * route will both consume (not built this round — WI-3). Kind-agnostic: it
 * only ever inspects `ProbeResult.state`, never `.kind`, so a probe-kind
 * change in `connection-probe.ts` can never ripple into this file.
 *
 * Declared-data-fails-open guard: a bound connection ABSENT from
 * `probeResults` is treated as `not-installed`, never assumed available. A
 * caller that forgot to probe a bound connection (or a probe that threw and
 * was swallowed upstream) must never read as "ready" by omission.
 */

import type { ConnectionKind } from './connection-library.ts';
import type { AgentDefinition } from './types.ts';
import type { ProbeResult, ProbeState } from './connection-probe.ts';

export interface UnreadyConnection {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly state: ProbeState;
}

/**
 * Returns every bound-but-not-`available` component for `def`, each carrying
 * its id/kind/state — never just the first (a run may be blocked by several
 * components at once, and every AC that consumes this expects to see all of
 * them). An unbound agent (no `composition.tools`/`composition.mcps`) always
 * returns `[]`, regardless of `probeResults`.
 */
export function connectionsReadinessFor(
  def: AgentDefinition,
  probeResults: ReadonlyMap<string, ProbeResult>,
): UnreadyConnection[] {
  const bound: { id: string; kind: ConnectionKind }[] = [
    ...def.composition.tools.map((id) => ({ id, kind: 'tool' as const })),
    ...def.composition.mcps.map((id) => ({ id, kind: 'mcp' as const })),
  ];

  const unready: UnreadyConnection[] = [];
  for (const { id, kind } of bound) {
    const result = probeResults.get(id);
    const state: ProbeState = result?.state ?? 'not-installed';
    if (state !== 'available') {
      unready.push({ id, kind, state });
    }
  }
  return unready;
}
