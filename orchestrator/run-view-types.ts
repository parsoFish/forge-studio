/**
 * The run view's shape (ADR 028 §3: "a run is derived, never stored").
 *
 * It sits BELOW both `run-model.ts` and `run-model-derive.ts` so neither has to
 * import the other. Before M2-B they were a cycle: the derive module imported
 * these four types back out of the module that imports its functions, and the
 * fix is to move the shared declaration down, not to re-order imports
 * (`docs/roadmaps/1.0.md` §4 M2 Lane B). This module imports neither.
 *
 * These four are ALSO hand-mirrored in `apps/studio/lib/studio-client.ts` so
 * `'use client'` components can import them without pulling in node builtins,
 * with no parity test comparing the two declarations (`studio-client.test.ts`
 * says so itself, citing bead `forge-cv9`). Their eventual home is
 * `@forge/contracts`, which is the one package `apps/studio` may import — but
 * moving them there today takes that package to 1,032 lines against its
 * ratified 1,000-line cap (`QUARRY.md`), and the cap's own note says the fix is
 * a cull, not a raise: `studio-types.ts` must be pruned to types and constants
 * first. That prune and the UI repoint are one M4 change, and this module is
 * what it will move.
 */

import type { TriggerKindId } from './_pkg/contracts.ts';

export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;          // ISO — UI computes "Nm ago"
  /**
   * R6-01 WI-1 F1: ISO timestamp of the LATEST event attributed to this node
   * by eventToNodeId, over EVERY EventType — unlike lastProgressAt (above),
   * NOT filtered to PROGRESS_EVENT_TYPES. A node narrating exclusively via
   * `log`/`error` events (7 of 11 EventType members are excluded from
   * lastProgressAt) still advances this field, so the Studio phase drawer's
   * log-refresh signal (apps/studio/lib/phase-log-refresh.ts) has something to
   * key off even when no tool/file/test/iteration progress has occurred.
   * Computed in run-model-derive.ts's computeLastEventAt, reusing the same
   * per-node event bucket (built via eventToNodeId) as lastProgressAt.
   */
  lastEventAt?: string;
  wedged?: boolean;                 // no tool progress ≥30 min while active|retrying
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];  // unifier node, M1-3 events
  /**
   * R6-05 WI-1: the adversarial-review node's finding counts, derived
   * verbatim from the LATEST `review.findings.authored` event on this node
   * (orchestrator/phases/adversarial-review.ts:332). Only the five COUNT
   * fields — the event's `path`/`head_sha`/`agent_slug` metadata keys never
   * leak in. Honest-absent: no event -> no key, never a fabricated
   * `{total:0,...}`; a genuine all-zero clean pass DOES populate it (the
   * event fired), matching the `gateChecks` guard's own convention of gating
   * on fact-presence rather than truthiness.
   */
  findings?: { total: number; blocker: number; major: number; minor: number; info: number };
};

export type Run = {
  id: string;                        // cycleId (or initiativeId for planned runs)
  flowId: string;                    // the manifest's flow_id (e.g. forge-develop); 'unknown' for pre-S8 manifests
  initiativeId: string;
  initiative: string;                // manifest title
  /**
   * W6-SW-3 (sweep C8#1): the manifest's own `project` slug, carried through
   * so a plan gate's Approve/Send-back control (GateBar) can thread it into
   * `postGate` — the bridge's `gateId==='plan'` route 400s without it
   * (`applyPlanVerdict` requires `project`). Optional because
   * `makeDegradedRun`'s corrupt-manifest fallback has no manifest to read it
   * from.
   */
  project?: string;
  /**
   * W8-A3 (`flows-23`): the architect session that produced this initiative,
   * straight off the manifest's `architect_session_id`. The stuck-plan story
   * from operator note 4 is "I am looking at a queued run and cannot get back
   * to the conversation that planned it". Absent when the manifest names none
   * — never fabricated, and never stored anywhere but the manifest.
   */
  architectSessionId?: string;
  status: RunStatus;
  origin: 'architect' | 'human-directed' | 'triggered';
  costUsd: number;
  startedAt?: string;
  /**
   * W6-RV-2: the real cycle-completion instant, for the roadmap canvas's
   * time axis (`cli/bridge-studio.ts::buildProjectRoadmap`). Derived the same
   * way `startedAt` is (a forward scan of THIS cycle's already-parsed
   * `events`, no second events.jsonl read) — the `started_at` of the
   * `{phase:'orchestrator', skill:'cycle', event_type:'end'}` event, which
   * `orchestrator/cycle.ts::runCycle` emits exactly once per cycle, strictly
   * BEFORE any out-of-band reflector rerun ever appends to the same log
   * (`reflector-rerun.ts` only ever emits `phase:'reflection'` events).
   * Falls back to the last non-`'reflection'` event when no such event exists
   * (a crash-then-requeue tail whose process died before the emit) — the
   * `'reflection'` exclusion matters ONLY on this fallback path, so a
   * standalone reflector rerun (e.g. the 2026-07-10 boot-reconcile flood)
   * can never smear a stale cycle's completion date onto its rerun date.
   * Additive-optional and honestly absent (never fabricated) when neither
   * source yields a timestamp — see `findCompletedAt` below.
   */
  completedAt?: string;
  phases: Record<string, RunPhaseStatus>;       // keyed by FLOW NODE id
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection', 'view' | 'gate'>>;
  gate?: string;                     // node id awaiting human, derived from the run's own events (G9)
  gateNote?: string;
  failedAt?: string;                 // node id
  failNote?: string;
  /**
   * ON-7 defect 2 (W8-A2): a cost-ceiling stop is a DIFFERENT terminal
   * outcome from an ordinary crash — the flow hit its budget at a clean,
   * resumable phase boundary with real work already done, not zero.
   * `status` stays 'failed' (no new queue state — that's an ask-first
   * architectural change, parked); this is additive context alongside it,
   * same pattern as `gate`/`gateNote` and `reflectionLost` below. Derived
   * from the run's own `flow.cost-ceiling-stop` event + its already-derived
   * `workItems` tally (see `deriveStopOnBudget` in run-model-derive.ts) —
   * nothing stored, so there is no settable "stopped on budget" field for a
   * future writer to forget to flip (`derive-status-dont-store-it`).
   */
  stopOnBudget?: {
    spentUsd: number;
    ceilingUsd: number;
    resumable: true;
    completedWorkItems: number;
    totalWorkItems: number;
    /**
     * W8-A2 (ON-7 defect 2b) — this field was missing from the TYPE even
     * though `deriveStopOnBudget` (run-model-derive.ts) has always returned
     * it and this object is built directly from that return value (see
     * `const stopOnBudget = deriveStopOnBudget(events, workItems);` below):
     * the resumable boundary the operator needs ("stopped before demo")
     * silently type-erased at the assignment — a real pre-existing `tsc`
     * error (`run-model.test.ts` reads it via `.stopOnBudget?.
     * stoppedBeforeNode`). Omitted, never invented, when the triggering
     * `flow.cost-ceiling-stop` event did not carry one.
     */
    stoppedBeforeNode?: string;
  };
  /**
   * 2.10 reflector pipeline honesty: set when the cycle merged/closed but its
   * reflection was lost (reflector crash, budget/turn exhaustion, or killed —
   * see cycle-context REFLECTION_LOST_EVENT + run-model-derive
   * findReflectionLoss). Value is the loss cause ('crash' | 'budget-exhausted'
   * | 'max-turns' | 'error' | 'manifest-unreadable' | 'brain-gate-failed' |
   * 'interrupted'). Carried as a flag alongside status — same pattern as
   * gate/gateNote — NOT a new top-level RunStatus; a successful rerun
   * (reflect-reconcile / `forge reflect --rerun`) clears it.
   */
  reflectionLost?: string;
  reflectionLostNote?: string;
  workItems?: { id: string; status: RunPhaseStatus; costUsd: number; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[];
  /**
   * W7-B7 (artifact-plan-17): the run's pull-request URL, derived from its
   * own `reviewer.pr-opened` event (see `findPrUrl` in run-model-derive.ts).
   * Additive-optional (ADR-042 disclose-not-park) and honestly absent when
   * the cycle never opened a PR — never fabricated.
   */
  prUrl?: string;
  /**
   * S9 (DEC-2/DEC-3): the seed flows this run traversed (derived from its phases ∩
   * each flow's nodes). A threaded spine run carries [forge-architect,
   * forge-develop] so each flow's monitor renders its own slice (the reflect
   * flow wrapper was retired in W7-C1 — reflection is a standalone agent
   * run, not a flow, so it adds no lineage entry). A single-flow run carries
   * just its own flow id.
   */
  flowLineage: string[];
  /**
   * R2-08-F4 (ADR-027 amendment): what started this run — a closed triple,
   * derived and never stored/authored. Absent when the run carries no
   * derivable provenance (a plain architect-originated run) — NEVER a
   * fabricated default. See `deriveTrigger` below for the two derivation
   * sources (cron/webhook/agent-complete mint a manifest carrying
   * `trigger_kind`/`trigger_source`/`trigger_scope`; flow-complete/merged
   * mint nothing, so their provenance comes from the run's own
   * `*.trigger-firing` event instead).
   */
  trigger?: {
    kind: TriggerKindId;
    source: string;
    scope: string | null;
  };
};
