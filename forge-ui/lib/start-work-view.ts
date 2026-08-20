/**
 * Start-work action-group derivation (W7-B6, operator note 11 / orch-02,
 * projects-18/-20) — the PURE half of `components/studio/StartWorkActions.tsx`.
 *
 * Turns the roadmap read model into the four primary actions' enablement:
 *   - Plan               → the first unplanned-but-dependency-ready pending
 *                          initiative (decompose it into work items);
 *   - Start development  → every pending + ready + PLANNED initiative (the
 *                          same eligibility rule RoadmapView's batch button
 *                          uses — a WI-less initiative is never eligible);
 *   - Run a flow         → the flows an initiative can be enqueued onto
 *                          (everything except the idea-kickoff — that IS the
 *                          Architect action — and trigger-only flows);
 *   - Architect          → always available (link; never disabled).
 *
 * Disabled actions carry an honest reason (crosscut-25), never a bare grey
 * button.
 */

export type StartWorkInitiative = {
  initiativeId: string;
  title: string;
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
  ready: boolean;
  workItems?: unknown[];
};

export type StartWorkFlow = {
  id: string;
  name: string;
  kickoff?: { kind?: string };
};

export type StartWorkState = {
  /** Pending + dependency-ready + NOT yet decomposed — Plan targets. */
  unplannedReady: StartWorkInitiative[];
  /** Pending + dependency-ready + decomposed — Start-development targets. */
  eligible: StartWorkInitiative[];
  /** Flows an existing initiative can be enqueued onto. */
  runnableFlows: StartWorkFlow[];
  /** Initiatives offered in the Run-a-flow picker (pending, any planned state
   *  — the bridge itself refuses un-runnable shapes with a typed status). */
  runCandidates: StartWorkInitiative[];
  planDisabledReason: string | null;
  startDisabledReason: string | null;
  runFlowDisabledReason: string | null;
};

export function deriveStartWorkState(
  initiatives: StartWorkInitiative[] | null,
  flows: StartWorkFlow[],
): StartWorkState {
  const list = initiatives ?? [];
  const pendingReady = list.filter((i) => i.status === 'pending' && i.ready);
  const unplannedReady = pendingReady.filter((i) => i.workItems === undefined);
  const eligible = pendingReady.filter((i) => i.workItems !== undefined);
  const runnableFlows = flows.filter((f) => {
    const kind = f.kickoff?.kind;
    return kind !== 'idea' && kind !== 'trigger-only';
  });
  const runCandidates = list.filter((i) => i.status === 'pending');

  return {
    unplannedReady,
    eligible,
    runnableFlows,
    runCandidates,
    planDisabledReason:
      unplannedReady.length > 0
        ? null
        : list.length === 0
          ? 'no roadmap yet — start with the Architect'
          : 'every ready initiative is already planned',
    startDisabledReason:
      eligible.length > 0
        ? null
        : list.length === 0
          ? 'no roadmap yet — start with the Architect'
          : unplannedReady.length > 0
            ? 'the ready initiatives are not planned yet — Plan first'
            : 'nothing is ready to start (blocked, running, or done)',
    runFlowDisabledReason:
      runnableFlows.length === 0
        ? 'no runnable flow is installed'
        : runCandidates.length === 0
          ? 'no pending initiative to enqueue — plan one with the Architect'
          : null,
  };
}
