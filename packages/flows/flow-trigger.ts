/**
 * R2-04 (ADR-041) — the typed trigger-kind registry + generic, declaration-driven
 * trigger firing.
 *
 * A flow declares zero or more `triggers: [{ on, target, …per-kind config }]` in
 * its flow.yaml. This module is the SINGLE path that fires lifecycle kinds —
 * there is no hardcoded "on merge run reflect" anywhere:
 *
 *   - the flow-runner fires `on: flow-complete` triggers on a flow's terminal
 *     success (dispatch = stage a claimable flow-run request), and
 *   - orchestrator/finalize-merged.ts fires `on: merged` triggers once a merged PR
 *     is confirmed (dispatch = run the target inline with the merged cycle's
 *     context — e.g. forge-develop's `{on: merged, target: {kind: agent, ref:
 *     reflector}}`, the R4-09-F1 standalone-reflect target).
 *
 * External kinds (`cron`, `webhook`) fire from their own arms (cron-triggers.ts,
 * the bridge's /api/hooks route) but ALWAYS by staging a claimable flow-run
 * request — dispatch stays behind the daemon's NO_SPAWN/dry-bridge perimeter.
 *
 * The dispatcher is injected, so the same generic firing logic serves both the
 * "enqueue a fresh run" and the "run inline with cycle context" cases, and unit
 * tests assert firing without touching the queue or spawning an agent.
 */
import type { FlowDefinition, FlowTrigger } from '@forge/contracts/studio/types.ts';
import { stageFlowRunRequest, decideTriggerProjectScope } from './flow-run-requests.ts';

/**
 * The trigger-kind registry (ADR-041): rows-as-data, one per `on:` vocabulary
 * member. `origin: 'ootb'` rows are domain events the OOTB suite contributes
 * (never platform literals); `status: 'reserved'` rows are vocabulary-reserved
 * — `parseFlowTrigger` accepts them so nobody squats different semantics on
 * the id, but `validateFlow` errors (`trigger-kind-reserved`) until the owning
 * roadmap item ships the runtime. No stubs anywhere.
 * - `flow-complete` — the flow reached terminal SUCCESS (fired by the flow-runner).
 * - `agent-complete` — a standalone (non-flow) agent run completed (R2-08-F2:
 *   fired by `fireAgentCompleteTriggers`, scanning the flow roster for rows
 *   whose `agent:` identity-matches the completed slug).
 * - `merged` — the flow's PR was merged + finalized (fired by finalize-merged,
 *   async + post-run; the flow itself terminated earlier at `ready-for-review`).
 * - `pr-merged` — a GitHub pull request was merged (R2-08-F3: signature-verified
 *   receipt on the bridge's EXISTING /api/hooks/:hookId route, own `on:` value
 *   carrying its own `webhook:` config block — never a sub-event under
 *   `on: webhook`; fire = stage). GitHub only; gitlab/gitea stay schema-reserved
 *   with zero stub handlers until a real payload shape grounds one.
 * - `issue-raised` — a GitHub issue was opened (R2-08-F3, same receiver + GitHub-only
 *   scope as `pr-merged`).
 * - `manual` — reserved (kickoff-kind unification).
 * - `cron` — temporal (croner-armed in the scheduler; fire = stage a request).
 * - `webhook` — external (signature-verified receipt on the bridge; fire = stage).
 * - `feed` — reserved (external content feeds).
 */
export { TRIGGER_KINDS, TRIGGER_KIND_IDS, SHIPPED_TRIGGER_KIND_IDS } from '@forge/contracts';
export type { TriggerKindId } from '@forge/contracts';


/**
 * The lifecycle events `fireFlowTriggers` routes (the two kinds fired from
 * inside the run machinery; external kinds have their own arms).
 */
export const FLOW_TRIGGER_EVENTS = ['flow-complete', 'merged'] as const;
export type FlowTriggerEvent = (typeof FLOW_TRIGGER_EVENTS)[number];

export type FireFlowTriggersDeps = {
  /**
   * Dispatch one matching trigger. Injected — the flow-runner stages a claimable
   * run; finalize-merged runs the target inline with the merged cycle context.
   */
  dispatch: (trigger: FlowTrigger, event: FlowTriggerEvent) => void | Promise<void>;
  /** Observability hook fired just before each matching trigger dispatches. */
  onFire?: (trigger: FlowTrigger) => void;
  /**
   * R2-08 (forge-f9g fix, W8-A1) — opt-in fire-time project-scope
   * enforcement: the choke point for dispatch mechanisms that never reach
   * `drainFlowRunRequests` (the staged-request path's own enforcement
   * point, `orchestrator/flow-run-requests.ts`). `finalize-merged.ts`'s
   * inline `on: merged` dispatch is the motivating case — it never stages a
   * `FlowRunRequest`, so without this the drain's scope check simply never
   * ran for it (the exact gap the R2-08 addendum,
   * docs/decisions/027-studio-object-model.md, worked around by making
   * `projects:` unauthorable on `on: merged` — withdrawn now that this
   * choke point exists). Both this and the drain call the SAME
   * `decideTriggerProjectScope` predicate — one implementation of the rule.
   *
   * Gating is OPT-IN via the KEY's presence on this deps object, not its
   * value — `{ dispatch, eventProject: undefined }` opts IN (resolution was
   * attempted and failed, so a declared scope fails closed); a deps object
   * that never mentions `eventProject` at all opts OUT (no fire-time
   * gating — every matching trigger dispatches unconditionally, exactly the
   * pre-existing behaviour). The flow-runner's `flow-complete` firing site
   * (`orchestrator/flow-runner.ts`) deliberately omits this key: T1's
   * round-4 ruling requires that path to stage EVERY trigger
   * unconditionally (including an out-of-scope one) and enforce scope ONLY
   * at `drainFlowRunRequests` — filtering at THIS fire site would make the
   * drain's `skipped-out-of-scope` status unreachable for staged requests
   * (pinned by `orchestrator/flow-runner.test.ts`'s round-4 test). An
   * unscoped trigger (`projects:` absent) always dispatches regardless of
   * whether this key is present.
   */
  eventProject?: string | null;
  /**
   * Observability for a fire-time scope skip (forge-f9g). Called instead of
   * `onFire`/`dispatch` for an out-of-scope trigger; that trigger is never
   * pushed onto the returned `fired` array — never a silent drop. Only
   * reachable when `eventProject` is present in `deps` (gating opted in).
   */
  onSkip?: (trigger: FlowTrigger, reason: string) => void;
};

/**
 * Fire the triggers a flow declares for `event`. Reads `flow.triggers`, selects
 * those whose `on` matches `event`, dispatches each via the injected `dispatch`
 * (awaited in declaration order), and returns the triggers that fired. A flow
 * with no matching trigger fires nothing — the empty, expected case.
 *
 * When `deps.eventProject` is present (opted in — see the field doc), each
 * matching trigger is first checked via `decideTriggerProjectScope`; an
 * out-of-scope one is skipped (never dispatched, never pushed onto `fired`)
 * and reported through `deps.onSkip` instead.
 */
export async function fireFlowTriggers(
  flow: Pick<FlowDefinition, 'id' | 'triggers'>,
  event: FlowTriggerEvent,
  deps: FireFlowTriggersDeps,
): Promise<FlowTrigger[]> {
  const fired: FlowTrigger[] = [];
  const scopeGated = Object.prototype.hasOwnProperty.call(deps, 'eventProject');
  for (const trigger of flow.triggers) {
    if (trigger.on !== event) continue;
    if (scopeGated) {
      const verdict = decideTriggerProjectScope(trigger.projects, deps.eventProject);
      if (!verdict.inScope) {
        deps.onSkip?.(trigger, verdict.reason);
        continue;
      }
    }
    deps.onFire?.(trigger);
    await deps.dispatch(trigger, event);
    fired.push(trigger);
  }
  return fired;
}

export type FireAgentCompleteTriggersOpts = {
  queueRoot?: string;
  /** R2-08-F1: the completed agent run's own project (T1 ruling), carried
   *  onto every staged request as `eventProject`. Absent ⇒ unresolved
   *  (a standalone run with no project binding). */
  eventProject?: string;
};

/**
 * R2-08-F2 — fire every `on: 'agent-complete'` row (across the given flow
 * roster) whose `agent:` config identity-matches `completedAgentSlug`, the
 * source agent that just completed a standalone run. Firing STAGES a
 * claimable flow-run request via `stageFlowRunRequest` — this function never
 * dispatches; dispatch stays exclusively in the guarded daemon sweep
 * (`drainFlowRunRequests`, ADR-041 §3).
 *
 * Matching is strict identity (`===`), never prefix/substring/case-insensitive
 * — `agent: 'developer'` must not fire for a completed slug of
 * `'developer-ralph'` or `'x/developer'`. A row with `agent` absent (a lint
 * error — `trigger-agent-complete`) can never match any real slug, so it
 * fails closed at runtime too, defense in depth alongside the lint.
 *
 * Mirrors `fireFlowTriggers`'s own "no match → []" contract: a flow roster
 * with no agent-complete row for this slug fires nothing.
 */
export async function fireAgentCompleteTriggers(
  flows: Array<Pick<FlowDefinition, 'id' | 'triggers'>>,
  completedAgentSlug: string,
  opts: FireAgentCompleteTriggersOpts = {},
): Promise<FlowTrigger[]> {
  const fired: FlowTrigger[] = [];
  let offsetMs = 0;
  for (const flow of flows) {
    for (const trigger of flow.triggers) {
      if (trigger.on !== 'agent-complete') continue;
      if (trigger.agent !== completedAgentSlug) continue;
      fired.push(trigger);
      // stageFlowRunRequest's filename is keyed on `target.ref` + `createdAt`
      // with no collision-uniquification (unlike mintTriggeredInitiative's
      // idExistsInQueue loop) — a strictly-increasing timestamp per fire in
      // this same call guarantees distinct files when two rows share a target.
      const createdAt = new Date(Date.now() + offsetMs++).toISOString();
      stageFlowRunRequest(
        {
          target: trigger.target,
          origin: 'agent-complete',
          triggeredBy: `agent-complete:${completedAgentSlug}`,
          sourceAgent: completedAgentSlug,
          createdAt,
          // R2-08-F1: absent stays absent — never coerce `undefined` to `[]`.
          ...(trigger.projects !== undefined ? { projects: trigger.projects } : {}),
          ...(opts.eventProject !== undefined ? { eventProject: opts.eventProject } : {}),
        },
        { queueRoot: opts.queueRoot },
      );
    }
  }
  return fired;
}
