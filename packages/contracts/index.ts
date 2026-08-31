/**
 * @forge/contracts — browser-safe types and constants only.
 *
 * The ONE package `apps/studio` may import (`docs/roadmaps/1.0.md` §0, ADR 046
 * rule 2). Nothing here may touch the filesystem, the network, a child process
 * or a node builtin: a value that needs any of those is not a contract, and the
 * boundary lint will not stop it from being wrong here — only review will.
 *
 * WHAT LIVES HERE AND WHY IT IS THE SSOT, NOT A THIRD COPY. Each constant below
 * was defined in a legacy module and hand-mirrored in `forge-ui`, with a
 * two-sided parity test holding the two in step. Moving the DEFINITION here and
 * re-exporting it back through `orchestrator/_pkg/contracts.ts` keeps exactly
 * one definition: the legacy module still exports the same value, the UI mirror
 * still exists, and the parity test now compares the mirror against this
 * package. Had this file merely re-declared the values, the parity test would
 * have proved the UI matches contracts while legacy drifted — weaker than what
 * it proved before, which is the trap.
 */

/** The Studio object model (ADR 027) — pure types, moved here with history. */
export * from './studio-types.ts';

// ---------------------------------------------------------------------------
// Work items — SSOT for `orchestrator/work-item.ts`
// ---------------------------------------------------------------------------

export type WorkItemStatus = 'pending' | 'in-progress' | 'complete' | 'failed';
export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['pending', 'in-progress', 'complete', 'failed'];

// ---------------------------------------------------------------------------
// Trigger kinds (ADR 041) — SSOT for `orchestrator/flow-trigger.ts`
// ---------------------------------------------------------------------------

/**
 * The trigger-kind registry. `status: 'reserved'` rows are vocabulary-reserved:
 * the parser accepts them so nobody squats different semantics on the id, and
 * flow validation rejects them until the owning runtime ships. No stubs.
 */
export const TRIGGER_KINDS = [
  { id: 'flow-complete', origin: 'platform', status: 'shipped', fires: 'lifecycle' },
  { id: 'agent-complete', origin: 'platform', status: 'shipped', fires: 'lifecycle' },
  { id: 'merged', origin: 'ootb', status: 'shipped', fires: 'lifecycle' },
  { id: 'pr-merged', origin: 'ootb', status: 'shipped', fires: 'external' },
  { id: 'issue-raised', origin: 'ootb', status: 'shipped', fires: 'external' },
  { id: 'manual', origin: 'platform', status: 'reserved', fires: 'operator' },
  { id: 'cron', origin: 'platform', status: 'shipped', fires: 'temporal' },
  { id: 'webhook', origin: 'platform', status: 'shipped', fires: 'external' },
  { id: 'feed', origin: 'platform', status: 'reserved', fires: 'external' },
] as const;

export type TriggerKindId = (typeof TRIGGER_KINDS)[number]['id'];
export const TRIGGER_KIND_IDS: readonly TriggerKindId[] = TRIGGER_KINDS.map((k) => k.id);
export const SHIPPED_TRIGGER_KIND_IDS: readonly TriggerKindId[] = TRIGGER_KINDS.filter(
  (k) => k.status === 'shipped',
).map((k) => k.id);

// ---------------------------------------------------------------------------
// Agent bands (ADR 039) — SSOT for `orchestrator/agent-bands.ts`
// ---------------------------------------------------------------------------

/**
 * A band key selects an orchestrator-implemented pre/post band around the
 * generic spawn — unlike a toggle guard, it does not switch one behaviour on.
 *
 * Exported here because `apps/studio` may import nothing else, so this is the
 * only legal source for the vocabulary if the UI ever needs it. It is NOT
 * mirrored in the UI today: a flow's band vocabulary reaches the browser as
 * DERIVED data over HTTP, so no parity test points at this constant.
 */
export const BAND_GUARD_IDS = ['wi-contract', 'reflection-close', 'demo-band', 'review-band', 'onboard-preflight'] as const;
export type BandGuardId = (typeof BAND_GUARD_IDS)[number];

// ---------------------------------------------------------------------------
// Spend ceilings — SSOT for `orchestrator/config.ts`
// ---------------------------------------------------------------------------

/** The default per-kickoff cost ceiling, in USD, when the operator names none. */
export const DEFAULT_KICKOFF_COST_CEILING_USD = 10;
/** The hard cap the bridge refuses to exceed, in USD. */
export const MAX_KICKOFF_COST_CEILING_USD = 500;

// ---------------------------------------------------------------------------
// Bridge — SSOT for `cli/forge-watch.ts`
// ---------------------------------------------------------------------------

/**
 * The fixed bridge port, so one browser tab stays pinned across re-runs
 * (CLAUDE.md, ADR 031). Previously pinned by a SOURCE-TEXT comparison because
 * `cli/forge-watch.ts` is a CLI entry point the UI cannot safely import; a
 * shared constant replaces a text pin with a real import.
 */
export const DEFAULT_BRIDGE_PORT = 4123;

// ---------------------------------------------------------------------------
// Cycle outcome — SSOT for `orchestrator/cycle-context.ts`
// ---------------------------------------------------------------------------

/**
 * Final cycle outcome after the closure step folds in the operator-merge
 * confirmation. `merged` is reachable ONLY there (never from the reviewer)
 * and ONLY when `gh pr view --json state` == MERGED. `failed` is not a member:
 * a failure throws.
 *
 * It lives here because it is the return type of the `PhaseExecutor` port
 * (SPEC.md §2 Station), and kernel — which declares that port — may import
 * contracts and nothing else.
 */
export type CycleOutcome = 'merged' | 'pr-open' | 'ready-for-review';
