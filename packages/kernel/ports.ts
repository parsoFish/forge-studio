/**
 * The ports `docs/roadmaps/1.0.md` §4 M2 Lane B cuts, and the closed band
 * registry that replaces `flow-runner.ts`'s hardcoded band table.
 *
 * A port earns a place in kernel when two packages must agree on a call shape
 * without either importing the other. Nothing here touches the filesystem, a
 * child process or the network: these are declarations plus one 20-line map.
 */

import type { CycleOutcome } from '@forge/contracts';
import type { PreflightOptions, PreflightReport } from './project-contract.ts';

/**
 * SPEC.md §2 Station: "The runner holds the port, not the phases. A station is
 * executed through `PhaseExecutor { run(nodeId, ctx) → CycleOutcome }`."
 *
 * `Ctx` is deliberately unconstrained. The runner's per-node context carries
 * flows-only values — the cycle input, the wedge detector, the mutable
 * cross-node state — and none of them may enter kernel; the spec leaves `ctx`
 * unconstrained for the same reason. The returned outcome is the run's outcome
 * as of this node: most nodes return it unchanged.
 */
export interface PhaseExecutor<Ctx = unknown> {
  run(nodeId: string, ctx: Ctx): Promise<CycleOutcome>;
}

/**
 * SPEC.md §6 Project: "Flows reach the preflight through a port.
 * `ProjectGate { runPreflight }` is injected; a flow does not import the
 * project package." The preflight is pure — it returns a structured report and
 * runs no quality gate — so the port is one call and no lifecycle.
 */
export interface ProjectGate {
  runPreflight(projectDir: string, opts?: PreflightOptions): PreflightReport;
}

/** What a band contributes: a pre/post band around the generic spawn (ADR 039). */
export type BandExecutor<Ctx> = (ctx: Ctx) => Promise<void>;

export interface BandRegistry<Ctx> {
  /** Register `exec` under `id`. Throws on an id outside the allowed set, or on a duplicate. */
  registerBand(id: string, exec: BandExecutor<Ctx>): void;
  get(id: string): BandExecutor<Ctx> | undefined;
  /** Exactly what has been registered, in registration order. */
  ids(): readonly string[];
}

/**
 * A band id is declared data — a `composition.guards` entry on an agent's
 * SKILL.md — so the registry is closed over `allowedIds`: SPEC.md §1 requires
 * that an unknown guard "is rejected naming the offending value and the allowed
 * set". A duplicate is rejected too, so dispatch can never depend on the order
 * in which modules happened to register.
 */
export function createBandRegistry<Ctx>(allowedIds: readonly string[]): BandRegistry<Ctx> {
  const allowed = new Set(allowedIds);
  const bands = new Map<string, BandExecutor<Ctx>>();
  return {
    registerBand(id, exec) {
      if (!allowed.has(id)) {
        throw new Error(
          `registerBand: unknown band id '${id}' — allowed: ${[...allowed].join(', ')}`,
        );
      }
      if (bands.has(id)) throw new Error(`registerBand: band '${id}' is already registered`);
      bands.set(id, exec);
    },
    get: (id) => bands.get(id),
    ids: () => [...bands.keys()],
  };
}
