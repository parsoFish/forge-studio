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
/** The initiative manifest shape — the SSOT flows, factory and sessions all
 *  read and write (M4-sessions s3, T1 ruling 81). */
export * from './manifest-types.ts';
/** `isRunnableSource` — the ONE rule for whether `enqueueFlowRun` claims a
 *  manifest for a flow, plus the develop flow's id (forge-8vfn.7.6.132). */
export * from './runnable-source.ts';

/** The run view's shape (ADR 028 §3) — moved from `packages/flows`, forge-8vfn.5.17. */
export * from './run-view-types.ts';
/** The demo declaration's pure extraction rules — shared by stations, factory
 *  and projects (bead forge-mfv5.2.2), plus the presentation-only skill-id
 *  vocabulary (bead forge-mfv5.2.8). */
export * from './demo-declaration.ts';

// ── Work items ──

export type WorkItemStatus = 'pending' | 'in-progress' | 'complete' | 'failed';
export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['pending', 'in-progress', 'complete', 'failed'];

/**
 * `WI-<n>` are dev work items (PM-emitted); `UWI-<n>` are unifier work items
 * (ADR 026). The trailing `[a-z]?` is the SPLIT SUFFIX (ADR 015, 2026-08-23
 * amendment / ON-7): the plan agent names the halves of a split work item
 * `WI-4a` / `WI-4b` unprompted, and the pattern admits exactly that — ONE
 * optional lowercase letter. `WI-4a1`, `WI-4-a`, `wi-4a`, `WI-4A` and
 * `WI-4ab` stay invalid. THIS IS THE SINGLE SOURCE OF TRUTH — moved here
 * (pure transfer, `packages/flows/work-item.ts`) so `packages/agents/ralph/
 * runner.ts` (rank 3) can use the dev-only pattern without reaching into
 * `packages/flows` (rank 5).
 */
export const WORK_ITEM_ID_PATTERN = /^U?WI-\d+[a-z]?$/;
/** The same id as it appears in a spec FILENAME (`WI-4a.md`). */
export const WORK_ITEM_FILE_PATTERN = /^U?WI-\d+[a-z]?\.md$/;
/** Dev work items only (never the `UWI-` unifier queue). */
export const DEV_WORK_ITEM_ID_PATTERN = /^WI-\d+[a-z]?$/;

/**
 * The NUMERIC STEM of a dev work-item id — `WI-4a` and `WI-4b` both stem 4 —
 * or null when the id is not a dev work item. This is the ordering primitive
 * ADR 037's hidden-coupling reject->compile derives its `depends_on`
 * direction from, and the one `nextDevWorkItemId` counts from; a split
 * sibling must not be invisible to either.
 */
export function devWorkItemIdStem(id: string): number | null {
  const m = /^WI-(\d+)[a-z]?$/.exec(id);
  return m ? Number(m[1]) : null;
}

// ── Trigger payloads (ADR 041) ──

/** The owner/repo regex — strict-charset validator for a GitHub-shaped
 *  `"owner/name"` full name. The SAME object every repo-shaped field is
 *  validated against, never a hand-copied equivalent (`packages/flows/
 *  trigger-payload.ts`'s webhook extraction, `packages/projects/
 *  project-config.ts`'s declared-repo field). */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// ── Session stages ──

/**
 * The onboarding session-kind stage vocabulary (R4-17 / R4-21 / W6-CR-3
 * history — see `packages/sessions/studio/session-kinds.ts` for the full
 * per-token provenance). Moved here (pure transfer) so `packages/projects/
 * contract-stages.ts` (rank 2) can derive its five-stage contract-order
 * vocabulary without reaching into `packages/sessions` (rank 4) for it.
 */
export const SESSION_STAGES = Object.freeze([
  'contract',
  'instructions',
  'secrets',
  'demo',
  'roadmap',
  'brain',
  'authoring',
] as const);
export type SessionStage = (typeof SESSION_STAGES)[number];

/** Presence, never a verdict (D11) — `forge preflight`'s exit code is the
 *  only authoritative contract-green signal; a row says "this artifact is
 *  present/absent, here is its source", never "this clause passes". */
export type ContractStageStatus = 'present' | 'absent';

/** The five onboarding stages — `SESSION_STAGES` minus 'brain' (project-brain
 *  owns that stage; D2). */
export type ContractStage = Exclude<SessionStage, 'brain'>;

export type ContractStageRow = {
  readonly stage: ContractStage;
  readonly status: ContractStageStatus;
  /** Which real on-disk artifact this row's presence answer is about — named
   *  even when `status` is 'absent' (a dropped row is indistinguishable from
   *  "we never looked"; naming the source at least says "we looked here"). */
  readonly source: string;
  /** Presence facts only (D11) — never verdict language ("pass"/"fail"/
   *  "clause"/"green"/"red"/"compliant"). */
  readonly detail: string[];
  /** The real byte length read from disk for the two prose-file-backed
   *  stages (`instructions`, `roadmap`); `null` for the three config/lock-
   *  JSON-backed stages (`contract`, `secrets`, `demo`). */
  readonly bytes: number | null;
};

// ── Trigger kinds (ADR 041) ──

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

// ── Agent bands (ADR 039) ──

/**
 * A band key selects an orchestrator-implemented pre/post band around the
 * generic spawn — unlike a toggle guard, it does not switch one behaviour on.
 *
 * Exported here because `apps/studio` may import nothing else, so this is the
 * only legal source for the vocabulary if the UI ever needs it. It is NOT
 * mirrored in the UI today: a flow's band vocabulary reaches the browser as
 * DERIVED data over HTTP, so no parity test points at this constant.
 */
export const BAND_GUARD_IDS = ['wi-contract', 'reflection-close', 'integrate-band', 'review-band', 'onboard-preflight'] as const;
export type BandGuardId = (typeof BAND_GUARD_IDS)[number];

/**
 * The toggle-style guard ids (ADR-027 R3-03 amendment) — platform behaviours
 * an agent switches on/off, as opposed to `BAND_GUARD_IDS`'s dispatch-routing
 * ids. Each has a display row in `studio/catalog.yaml`'s `guards:` section
 * but, unlike a band guard, resolves nothing through `resolveBandGuard` —
 * each is read directly by its own subsystem (event-log by the logger config,
 * cost-guard by the budget enforcer, ...).
 *
 * MOVED VERBATIM from `packages/agents/agent-bands.ts` (M4-library PR 2):
 * `packages/library/studio/hook-library.ts` needs `PLATFORM_GUARD_IDS` and
 * library (rank 2) may not import agents (rank 3). `BAND_GUARD_IDS` was
 * already here, so the union is now computed in ONE place instead of being
 * split across two packages.
 */
export const TOGGLE_GUARD_IDS = ['event-log', 'cost-guard', 'stall-watchdog', 'merge-gate', 'scratch-strip'] as const;

/**
 * The full closed set of platform guard ids (ADR-027 R3-03 amendment) — the
 * union of the 5 toggle ids and the 5 band ids. This is the "is this id
 * platform machinery, not a library hook" check `lintHookComposition`
 * (`packages/library/studio/hook-library.ts`) needs to enforce the
 * `composition.hooks` vs `composition.guards` split — a fixed
 * platform-vocabulary constant, deliberately NOT re-derived from
 * `studio/catalog.yaml`, because catalog.yaml is a DISPLAY surface over these
 * ids (a hand-edited name/desc row), not their source of truth, and a lint
 * fixture root legitimately may not seed a catalog.yaml at all.
 */
export const PLATFORM_GUARD_IDS: readonly string[] = [...TOGGLE_GUARD_IDS, ...BAND_GUARD_IDS];

// ── Spend ceilings ──

/** The default per-kickoff cost ceiling, in USD, when the operator names none. */
export const DEFAULT_KICKOFF_COST_CEILING_USD = 10;
/** The hard cap the bridge refuses to exceed, in USD. */
export const MAX_KICKOFF_COST_CEILING_USD = 500;

// ── Bridge — SSOT for `apps/forge/forge-watch.ts` ──

/**
 * The fixed bridge port, so one browser tab stays pinned across re-runs
 * (CLAUDE.md, ADR 031). Previously pinned by a SOURCE-TEXT comparison because
 * `apps/forge/forge-watch.ts` is a CLI entry point the UI cannot safely import; a
 * shared constant replaces a text pin with a real import.
 */
export const DEFAULT_BRIDGE_PORT = 4123;

// ── KB drain ──
/** Max drain rounds (fresh lint → auto → agent turns → fresh lint): the ONE definition knowledge and studio import (forge-8vfn.5.25.2). */
export const KB_DRAIN_MAX_ROUNDS = 5;

// ── Materials ──
/** Closed, order-significant upload-materials vocabulary: the ONE definition agents and studio import (forge-ni3). */
export const MATERIAL_KINDS = Object.freeze(['images', 'documents', 'audio', 'data-files'] as const);
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

// ── Cycle outcome ──

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

// ── Failure signatures (M7 row 150, ruling 1794 round 3) ──

/**
 * `CostCeilingError` (`packages/flows/flow-budgets.ts`) and `OperatorStopError`
 * (`packages/flows/operator-stop.ts`) each prefix their thrown message with
 * one of these — the exact literal `failure-classifier.ts` scans incoming
 * `event_type: 'error'` messages for. `agents` (rank 3) may not import
 * `@forge/flows` (rank 5), so the prefix cannot live beside either error class
 * without a boundary violation; `contracts` (rank 0) is the one place both
 * the writer and the reader can import, keeping ONE literal instead of two
 * hand-typed copies that could drift apart.
 */
export const COST_CEILING_MESSAGE_PREFIX = 'cost-ceiling:' as const;
export const OPERATOR_STOP_MESSAGE_PREFIX = 'operator-stop:' as const;
/**
 * Row 157 (bead forge-8vfn.8.1.45, ruling 1873): the project-manager phase
 * (`packages/stations/phases/project-manager.ts`) prefixes its rejection
 * summary with this literal when an acceptance-gate violation (ADR 051
 * decision 2) survives the ONE bounded revise turn — `failure-classifier.ts`
 * scans for it to classify the failure as PM-phase, deterministic and
 * resumable from the plan node, instead of "could not be classified".
 */
export const PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX = 'pm-acceptance-gate-unresolved:' as const;
/**
 * Row 159 (bead forge-8vfn.8.1.47, ruling 1891): the architect runner
 * (`packages/sessions/kinds/architect-draft-repair.ts`) prefixes its
 * classified throw with this literal when a draft's manifest-validation
 * error (ADR 051's `requireDraftAcceptanceCriteria` / `requireChangeClass`,
 * `architect-manifest.ts`) survives the ONE bounded repair turn —
 * `failure-classifier.ts` scans an `architect`-phase error event for it, the
 * same convention as `PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX` above.
 */
export const ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX = 'architect-draft-manifest-unresolved:' as const;
