/**
 * `forge-8vfn.7.6.135` — the roadmap/cycles client surface, split out of
 * `bridge-client.ts` (pure move; the exported shape is unchanged, only which
 * file declares it). Covers cycle + work-item reads, the per-project
 * roadmap, cross-project attention, cost, recovery, and the scheduler.
 */
import {
  bridgeReadOrThrow,
  bridgeReadOr404,
  bridgePost,
  type CycleListSnapshot,
  type EventLogEntry,
} from './bridge-client-core.ts';

/** W7-FIX-A1 (review): rides the shared classifier so a bridge-ANSWERED
 *  non-2xx carries its status (`BridgeReadError{status}`) — the showcase /
 *  project-page error states frame "the bridge refused (HTTP n)" vs "could not
 *  reach the bridge" honestly (library-13), never a plain Error with no status. */
export async function fetchCycles(): Promise<CycleListSnapshot> {
  return bridgeReadOrThrow<CycleListSnapshot>('/api/cycles');
}

/** W7-A1: a 404 (no event log written yet — home-sessions-11, A2's bridge
 *  fix) is the honest empty tail; every OTHER failure throws `BridgeReadError`
 *  (the tail hook keeps its last snapshot; it never renders a failed read as
 *  "no events"). */
export async function fetchEvents(cycleId: string): Promise<EventLogEntry[]> {
  const body = await bridgeReadOr404<{ events: EventLogEntry[] }>(
    `/api/events/${encodeURIComponent(cycleId)}`,
  );
  return body?.events ?? [];
}

// ---- Work-item definition (WI detail — /artifact viewer) -----------------

export type WorkItemAcceptanceCriterion = { given: string; when: string; then: string };

export type WorkItemDetail = {
  work_item_id: string;
  acceptance_criteria: WorkItemAcceptanceCriterion[];
  files_in_scope: string[];
  quality_gate_cmd: string[];
  body: string;
};

/**
 * Fetch a single work item's on-disk definition (acceptance criteria,
 * files_in_scope, quality_gate_cmd, body) for the /artifact viewer. Reads the
 * immutable cycle snapshot if present, else the live worktree spec. Returns
 * null when the bridge is offline or the WI isn't found yet (pre-PM emission).
 */
export async function fetchWorkItem(cycleId: string, wiId: string): Promise<WorkItemDetail | null> {
  return bridgeReadOr404<WorkItemDetail>(
    `/api/work-item/${encodeURIComponent(cycleId)}/${encodeURIComponent(wiId)}`,
  );
}

// ---- Per-project roadmap (S6) -----------------------------------------------

/**
 * W6-RV-1: forge-ui cannot import `orchestrator/` TypeScript directly in
 * production code (the same constraint `SHIPPED_TRIGGER_KINDS` documents for
 * itself in `./studio-client.ts`), so this mirrors `packages/flows/work-item.ts`'s
 * `WORK_ITEM_STATUSES` as a runtime array (not just a re-typed literal union)
 * so `./wi-status-parity.test.ts` can pin it against that SSOT — follows the
 * same precedent as `SHIPPED_TRIGGER_KINDS` / `./trigger-kind-parity.test.ts`.
 * Keep in lockstep by hand; the parity test goes red the moment either drifts.
 */
export const WI_STATUSES = ['pending', 'in-progress', 'complete', 'failed'] as const;
type WiStatus = (typeof WI_STATUSES)[number];

export type RoadmapWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
  /**
   * W6-RV-1: the WI's own status (mirrors `packages/flows/work-item.ts`'s
   * `WorkItemStatus` via `WI_STATUSES` above), read straight off its
   * frontmatter. Feeds the collapsed roadmap card's "done/total" micro-badge.
   * Optional — legacy WI snapshots or a read that predates this field leave
   * it undefined; callers treat undefined as "not complete" rather than
   * fabricating a status.
   */
  status?: WiStatus;
};

export type RoadmapInitiative = {
  initiativeId: string;
  title: string;
  // R4-11-F1: `merged` — brief pass-through between a confirmed merge and its
  // promotion to `done/` in the same sweep.
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
  dependsOnInitiatives: string[];
  /** plan-everything-before-kickoff: dependency-gate eligibility (meaningful while status==='pending'). */
  ready: boolean;
  blockedBy: string[];
  /** 7.6.18 — see the `[data-blocked-clauses]` row in studio-dom-contract.md. */
  blockedClauses?: string[];
  /** 7.6.132 — would `enqueueFlowRun` claim this for forge-develop? Derived server-side by `isRunnableSource`. */
  canStartDevelopment?: boolean;
  workItems?: RoadmapWorkItem[];
  /**
   * W6-RV-2: the real cycle-completion instant (ISO), sourced from
   * `Run.completedAt` (packages/flows/run-model.ts) via `buildProjectRoadmap`
   * (apps/forge/bridge-studio.ts). Drives the roadmap canvas's completion-time X
   * axis — absent (never fabricated) for a still-open initiative, or one
   * whose cycle log carries no derivable completion; such a card lands in
   * the canvas's projected zone with an honest "no date" marker instead.
   */
  completedAt?: string;
  /**
   * M7 findings row 59: forge-architect and forge-develop both terminate at
   * the SAME status word (`ready-for-review`), so `status` alone cannot
   * tell a card apart. Sourced from `manifest.flow_id` via
   * `buildProjectRoadmap` (apps/forge/bridge-studio.ts) — absent (never
   * fabricated) for a manifest that carries no `flow_id`.
   */
  flowId?: string;
};

export type ProjectRoadmap = {
  projectId: string;
  initiatives: RoadmapInitiative[];
  /** `forge-8vfn.7.6.23` — manifests in this project's queue dirs that the
   *  parser REFUSED, each with the parser's own message. Absent when there are
   *  none; never an empty array, so "no field" and "nothing failed" are the same
   *  answer and neither is confused with "the scan did not look". The empty
   *  state reads it so an operator is told "N manifests failed to parse" rather
   *  than the false "No initiatives found for this project". */
  unparseable?: { path: string; message: string }[];
};

/**
 * Fetch the per-project roadmap (S6 DEC-3): all initiatives for this project
 * across all queue states, each with nested WI sub-graph when decomposed.
 * Returns null when the bridge is offline or the project is unknown.
 */
export async function fetchRoadmap(projectId: string): Promise<ProjectRoadmap | null> {
  const body = await bridgeReadOr404<{ roadmap: ProjectRoadmap }>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/roadmap`,
  );
  return body?.roadmap ?? null;
}

// ---- Cross-project attention strip (R4-11-F4) --------------------------------

export type ProjectAttentionItem = {
  projectId: string;
  name: string;
  /** Link target for the strip item — the project's roadmap tab. */
  link: string;
  /** Count of this project's manifests in `_queue/pending/`. */
  planned: number;
  /** Count in `_queue/in-flight/`. */
  inFlight: number;
  /** Count in `_queue/ready-for-review/` — the `gated` RunStatus (awaiting an operator verdict). */
  gated: number;
  /** Count in `_queue/merged/` (R4-11-F1 transient state). */
  merged: number;
  /** Count of initiatives whose latest `plan.completeness` event (R4-05-F6) is flagged. */
  flagged: number;
};

/**
 * Fetch the cross-project attention aggregate (R4-11-F4) — one best-effort
 * entry per registered project — for Home's attention strip. W7-A1: THROWS
 * `BridgeReadError` when the bridge is unreachable or refuses (it used to
 * resolve `[]`, so an outage rendered as "nothing needs you" — crosscut-01).
 */
export async function fetchProjectAttention(): Promise<ProjectAttentionItem[]> {
  const body = await bridgeReadOrThrow<{ attention?: ProjectAttentionItem[] }>('/api/studio/projects/attention');
  return body.attention ?? [];
}

export type CostSummary = {
  cycleId: string;
  totalUsd: number;
  perPhase: Record<string, { cost_usd: number; iterations: number; duration_ms: number }>;
  perSkill: Record<string, { invocations: number; cost_usd: number; duration_ms: number }>;
};

export async function fetchCost(cycleId: string): Promise<CostSummary | null> {
  return bridgeReadOr404<CostSummary>(`/api/cost/${encodeURIComponent(cycleId)}`);
}

// ---- Recovery surface (DEC-6 — replaces forge review/requeue/abandon CLI) ----

export type RecoveryInspect = {
  found: boolean;
  initiativeId: string;
  // R4-11-F1: `merged` included defensively — a crash between closure's
  // →merged move and the merged→done promotion would otherwise strand a
  // manifest somewhere recovery can't represent.
  state?: 'pending' | 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed';
  worktree?: string | null;
  worktreeExists?: boolean;
  branch?: string;
  commits?: string[];
  diffStat?: string;
  prDraftChars?: number;
};

/** Inspect a stuck cycle (read-only): worktree / branch / commits / diff / PR draft. */
export async function fetchRecovery(initiativeId: string): Promise<RecoveryInspect | null> {
  return bridgeReadOr404<RecoveryInspect>(`/api/recovery/${encodeURIComponent(initiativeId)}`);
}

/** Requeue a stuck initiative back to pending/ (optionally reset retries / resume-from-integrate). */
export async function recoveryRequeue(
  initiativeId: string,
  opts: { resetRetries?: boolean; resumeFromIntegrate?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/recovery/${encodeURIComponent(initiativeId)}/requeue`, opts);
}

/** Abandon a stuck initiative: move to failed/ + clean its worktree + branch. */
export async function recoveryAbandon(initiativeId: string): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/recovery/${encodeURIComponent(initiativeId)}/abandon`);
}

export type SchedulerStatus = {
  running: boolean;
  pid?: number | null;
  paused?: boolean;
  /** W7-A3: pid-file mtime while running (daemonState), else null. */
  startedAt?: string | null;
  /** W7-FIX-A3 (A3-07): SIGTERM sent, pid still alive — draining in-flight
   *  runs (daemonState folds the stop marker in while THAT pid is alive). */
  stopping?: boolean;
};

export async function fetchSchedulerStatus(): Promise<SchedulerStatus | null> {
  return bridgeReadOr404<SchedulerStatus>('/api/scheduler/status');
}

export async function startScheduler(): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/scheduler/start');
}

/** Pause the scheduler (stops claiming new work; in-flight cycles keep going). */
export async function pauseScheduler(): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/scheduler/pause');
}

/** Resume claiming pending work. */
export async function resumeScheduler(): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/scheduler/resume');
}

/** Stop the daemon (SIGTERM — drains in-flight cycles, then exits). */
export async function stopScheduler(): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/scheduler/stop');
}
