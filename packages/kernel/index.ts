/**
 * @forge/kernel — the facts every other package needs and none of them owns.
 *
 * Populated by QUARRY, not written here: `1.0.md` §4 M2 caps this package at
 * 3,000 lines of NEW logic, and this milestone added none. Every module below
 * moved with its history and its tests.
 *
 * `resolveRoot` is deliberately ABSENT. Spec §3 lists it among kernel's
 * contents, but ADR 045 — which designs it — says of itself: "Accepted
 * (2026-08-23, operator) — design only. Nothing in this ADR is built by the
 * change that lands it." There is nothing to quarry, and writing it here would
 * be new kernel logic. Operator ruling at H5, 2026-08-31: it lands in M4 under
 * ADR 045's own roadmap items.
 */

/** The JSONL event log (ADR 008) — SPEC.md §3 Artifact. */
export * from './logging.ts';
/** The one cost rule: stream usage to dollars, computed in exactly one place. */
export * from './event-cost.ts';
/** Config and layout, plus the env-assertion boundary. */
export * from './config.ts';
/** First-run scaffolding: the `_queue/`, `_worktrees/`, `_logs/` layout. */
export * from './init.ts';
/** The realpath containment guard every request-derived path passes through. */
export * from './path-guard.ts';

/** The project-contract report shape the `ProjectGate` port carries (SPEC.md §6). */
export * from './project-contract.ts';
/** The ports M2-B cuts, and the closed band registry (SPEC.md §2 Station). */
export * from './ports.ts';

/** The id vocabulary and the ONE slug guard every studio object id passes. */
export * from './ids.ts';
/** Project-layout SSOT: id normalisation, on-disk discovery, and the
 *  per-project brain dirs (ADR 035) shared by projects/knowledge/library. */
export * from './project-layout.ts';
/** The child-process env allowlist seam: deny-by-default, one composer. */
export * from './spawn-env.ts';
/** The route-table shape every package's `routes.ts` declares, and the
 *  first-match-wins dispatcher `apps/forge` assembles them into (M4 §4 step 2). */
export * from './route-entry.ts';
/** The HTTP response envelope every carved route table needs: origin decision,
 *  JSON write, error sanitisation, URL splitting, `StudioContext`. */
export * from './http-envelope.ts';
