/**
 * Client-side glue to the forge-ui-bridge.
 *
 * Bridge URL discovery is RUNTIME: the client fetches /api/forge-config
 * (a Next.js route that reads process.env.FORGE_BRIDGE_URL at request
 * time). This avoids the build-time embedding fragility of next.config
 * `env` blocks across `forge watch` restarts.
 *
 * One subscribe() opens a single WebSocket; the page is expected to
 * call this once for the lifetime of the mount. Cycle-selection filtering
 * lives in the handler the page provides — the bridge broadcasts events
 * for every live cycle.
 */

export type Cycle = {
  cycleId: string;
  initiativeId: string;
  project?: string;
  status: 'in-flight' | 'ready-for-review' | 'done' | 'failed' | 'pending';
  startedAt?: string;
  endedAt?: string;
  /**
   * Feature #10: cross-initiative dependency edges (manifest
   * `depends_on_initiatives`). Drives the per-project roadmap spine's
   * topological level ordering. Empty / absent = no prerequisites (the
   * initiative lays flat at level 0).
   */
  dependsOnInitiatives?: string[];
};

export type CycleListSnapshot = { live: Cycle[]; recent: Cycle[] };

export type EventLogEntry = {
  event_id: string;
  cycle_id?: string;
  initiative_id: string;
  started_at: string;
  phase: string;
  skill: string;
  event_type: string;
  message?: string;
  metadata?: Record<string, unknown>;
  // Present on SDK-backed events (iteration / end). Declared optional so the
  // UI can surface per-agent cost + token totals from the event stream.
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
};

export type BridgeMessage =
  | { type: 'snapshot'; cycles: CycleListSnapshot }
  | { type: 'event'; cycleId: string; event: EventLogEntry }
  | { type: 'cycle-list-changed' }
  | { type: 'architect-list-changed' }
  | { type: 'instructions-list-changed' }
  | { type: 'demo-list-changed' };

// `daemon-stalled` (Feature #8): the bridge is reachable but the scheduler
// daemon's heartbeats have gone stale past a generous threshold — the daemon
// process is wedged / dead. Distinct from `reconnecting` (bridge unreachable).
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'no-bridge' | 'daemon-stalled';

// ---- runtime bridge URL --------------------------------------------------

// Cache the PROMISE rather than the value so concurrent callers
// (Strict Mode double-mount, two effects running on the same tick)
// share a single network request.
let cachedBridgeUrl: Promise<string> | null = null;

/**
 * Build the bridge base URL from `window.location` + the port the
 * server-side API route resolved. Same-hostname-as-the-browser is
 * essential for WSL2 + Windows browser: the Windows browser sees
 * `localhost` (forwarded into WSL by WSL2), while a Linux/WSL browser
 * sees the actual WSL hostname. Either way, the bridge port piggybacks
 * on the same hostname-forwarding the UI port already uses.
 */
export function resolveBridgeUrl(): Promise<string> {
  if (cachedBridgeUrl) return cachedBridgeUrl;
  cachedBridgeUrl = (async () => {
    try {
      const res = await fetch('/api/forge-config', { cache: 'no-store' });
      if (!res.ok) throw new Error(`forge-config → ${res.status}`);
      const body = (await res.json()) as { bridgePort: number | null };
      if (!body.bridgePort) return '';
      // Same hostname as the page so WSL2 (or any other localhost-
      // forwarding scheme) routes the request the same way it routed
      // the UI's HTTP fetch.
      const loc = typeof window !== 'undefined' ? window.location : null;
      if (!loc) return ''; // SSR — client-only code path
      return `${loc.protocol}//${loc.hostname}:${body.bridgePort}`;
    } catch {
      return '';
    }
  })();
  return cachedBridgeUrl;
}

function clearBridgeCache(): void {
  cachedBridgeUrl = null;
}

// ---- fetch envelopes -----------------------------------------------------
// Every read/write helper below shares one of these two shapes. Keeping the
// envelope in one place means the "no bridge → fallback", "non-ok → fallback",
// and "throw → fallback" semantics can't drift between endpoints.

/** GET a bridge JSON endpoint; returns `fallback` on no-bridge / non-ok / throw. */
async function bridgeGet<T>(path: string, fallback: T): Promise<T> {
  const base = await resolveBridgeUrl();
  if (!base) return fallback;
  try {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/**
 * POST to a bridge endpoint (JSON body when provided, bare POST otherwise) and
 * normalise the reply to the `{ ok, error }` envelope. `data` carries the
 * parsed body for the rare caller that needs an extra field (e.g. sessionId).
 */
async function bridgePost(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, body === undefined
      ? { method: 'POST', headers: { 'x-forge-csrf': '1' } }
      : { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify(body) });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---- HTTP API ------------------------------------------------------------

export async function fetchCycles(): Promise<CycleListSnapshot> {
  const base = await resolveBridgeUrl();
  if (!base) throw new Error('no bridge configured');
  const res = await fetch(`${base}/api/cycles`);
  if (!res.ok) throw new Error(`bridge /api/cycles → ${res.status}`);
  return res.json();
}

export async function fetchEvents(cycleId: string): Promise<EventLogEntry[]> {
  const body = await bridgeGet<{ events: EventLogEntry[] }>(
    `/api/events/${encodeURIComponent(cycleId)}`,
    { events: [] },
  );
  return body.events;
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
  return bridgeGet<WorkItemDetail | null>(
    `/api/work-item/${encodeURIComponent(cycleId)}/${encodeURIComponent(wiId)}`,
    null,
  );
}

// ---- Per-project roadmap (S6) -----------------------------------------------

export type RoadmapWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
};

export type RoadmapInitiative = {
  initiativeId: string;
  title: string;
  status: 'in-flight' | 'ready-for-review' | 'done' | 'failed' | 'pending';
  dependsOnInitiatives: string[];
  workItems?: RoadmapWorkItem[];
};

export type ProjectRoadmap = {
  projectId: string;
  initiatives: RoadmapInitiative[];
};

/**
 * Fetch the per-project roadmap (S6 DEC-3): all initiatives for this project
 * across all queue states, each with nested WI sub-graph when decomposed.
 * Returns null when the bridge is offline or the project is unknown.
 */
export async function fetchRoadmap(projectId: string): Promise<ProjectRoadmap | null> {
  const body = await bridgeGet<{ roadmap: ProjectRoadmap } | null>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/roadmap`,
    null,
  );
  return body?.roadmap ?? null;
}

export type CostSummary = {
  cycleId: string;
  totalUsd: number;
  perPhase: Record<string, { cost_usd: number; iterations: number; duration_ms: number }>;
  perSkill: Record<string, { invocations: number; cost_usd: number; duration_ms: number }>;
};

export async function fetchCost(cycleId: string): Promise<CostSummary | null> {
  return bridgeGet<CostSummary | null>(`/api/cost/${encodeURIComponent(cycleId)}`, null);
}

// ---- Recovery surface (DEC-6 — replaces forge review/requeue/abandon CLI) ----

export type RecoveryInspect = {
  found: boolean;
  initiativeId: string;
  state?: 'pending' | 'in-flight' | 'ready-for-review' | 'done' | 'failed';
  worktree?: string | null;
  worktreeExists?: boolean;
  branch?: string;
  commits?: string[];
  diffStat?: string;
  prDraftChars?: number;
};

/** Inspect a stuck cycle (read-only): worktree / branch / commits / diff / PR draft. */
export async function fetchRecovery(initiativeId: string): Promise<RecoveryInspect | null> {
  return bridgeGet<RecoveryInspect | null>(`/api/recovery/${encodeURIComponent(initiativeId)}`, null);
}

/** Requeue a stuck initiative back to pending/ (optionally reset retries / resume-from-unifier). */
export async function recoveryRequeue(
  initiativeId: string,
  opts: { resetRetries?: boolean; resumeFromUnifier?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/recovery/${encodeURIComponent(initiativeId)}/requeue`, opts);
}

/** Abandon a stuck initiative: move to failed/ + clean its worktree + branch. */
export async function recoveryAbandon(initiativeId: string): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/recovery/${encodeURIComponent(initiativeId)}/abandon`);
}

// ---- Daemon-stall liveness (Feature #8) ----------------------------------

export type LivenessReport = {
  inFlightCount: number;
  maxHeartbeatAgeMs: number;
  staleHeartbeatMs: number;
  stallThresholdMs: number;
  stalled: boolean;
};

/** Fetch the daemon-stall liveness report (max heartbeat age across in-flight
 *  cycles vs the stall threshold). Returns null when the bridge is offline. */
export async function fetchLiveness(): Promise<LivenessReport | null> {
  return bridgeGet<LivenessReport | null>('/api/liveness', null);
}

export type SchedulerStatus = {
  running: boolean;
  pid?: number;
  paused?: boolean;
};

export async function fetchSchedulerStatus(): Promise<SchedulerStatus | null> {
  return bridgeGet<SchedulerStatus | null>('/api/scheduler/status', null);
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

export type AcceptanceCriterion = { given: string; when: string; then: string };

export type VerdictSubmission =
  | { kind: 'approve'; initiativeId: string; rationale: string }
  | { kind: 'send-back'; initiativeId: string; rationale: string; acceptanceCriteria: AcceptanceCriterion[] };

export async function submitVerdict(input: VerdictSubmission): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/verdict', input);
}

// ---- Start development (S7 / DEC-3) --------------------------------------

export type StartDevelopmentResult = {
  ok: boolean;
  error?: string;
  status?: 'enqueued' | 'not-found' | 'already-developing';
  cycleId?: string;
  flowId?: string;
};

/**
 * Trigger the forge-develop flow for a decomposed initiative (the roadmap
 * "start development" button). Repoints the manifest at forge-develop +
 * threads its cycle_id, then the scheduler claims it.
 */
export async function startDevelopment(initiativeId: string): Promise<StartDevelopmentResult> {
  const r = await bridgePost('/api/develop/start', { initiativeId });
  return {
    ok: r.ok,
    error: r.error,
    status: r.data?.status as StartDevelopmentResult['status'],
    cycleId: r.data?.cycleId as string | undefined,
    flowId: r.data?.flowId as string | undefined,
  };
}

// ---- Structured demo (ADR 021) ------------------------------------------

export type DemoHarnessMetricRow = {
  label: string;
  unit?: string;
  before: string | null;
  after: string | null;
  deltaPct: number | null;
  parity: 'match' | 'within' | 'diverged' | 'incomplete';
};

export type DemoModelCheckpoint = {
  label: string;
  kind?: 'screenshot' | 'video' | 'harness';
  caption: string;
  beforeNote?: string;
  afterNote?: string;
  // CLI/output checkpoint — real captured stdout (before on baseRef, after on the
  // branch HEAD), shown side-by-side as terminal output instead of a prose note.
  command?: string;
  beforeOutput?: string | null;
  afterOutput?: string | null;
  metrics?: DemoHarnessMetricRow[];
  beforeImage?: string | null;
  afterImage?: string | null;
  // Mirror of cli/demo-model.ts — a kind:'video' checkpoint carries a relative
  // sibling path (served via the bridge artifact route, NOT a data: URI).
  beforeVideoSrc?: string | null;
  afterVideoSrc?: string | null;
};

export type DemoSummarySection = {
  bullets: string[];
  prUrl?: string;
  branch?: string;
  commitSha?: string;
};

export type DemoApiDiffEntry = {
  name: string;
  change: 'added' | 'changed' | 'removed';
  before?: string;
  after?: string;
};

export type DemoTestResultRow = {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  delta?: string;
};

/** Per-acceptance-criterion evaluated output (MVUS req b). */
export type DemoAcEvaluation = {
  criterion: string;
  verdict: 'met' | 'partial' | 'missed';
  evidence: string;
};

export type DemoModel = {
  title: string;
  essence: string;
  project: string;
  initiativeId?: string;
  baseRef?: string;
  changedRef?: string;
  checkpoints: DemoModelCheckpoint[];
  diffStat: string;
  acceptanceCriteria?: string[];
  /**
   * Per-AC evaluated output. When present, the review screen foregrounds a
   * dedicated "Intent & Outcome" section (MVUS req b). One entry per AC
   * with a verdict (met/partial/missed) and concrete evidence.
   */
  acEvaluations?: DemoAcEvaluation[];
  // Rich structured sections (mirrors cli/demo-model.ts DemoModel)
  summary?: DemoSummarySection;
  apiDiff?: DemoApiDiffEntry[];
  testEvidence?: DemoTestResultRow[];
  filesChanged?: Array<{ path: string; note?: string }>;
  // New-capability fields (sibling agent adds to cli/demo-model.ts)
  usage_example?: string;
  impact?: string[];
};

/** Fetch the cycle's structured demo (mirrored into _logs/<cycle>/artifacts/
 *  by snapshotCycleArtefacts). Returns null when absent or unparseable. */
export async function fetchDemoModel(cycleId: string): Promise<DemoModel | null> {
  return bridgeGet<DemoModel | null>(`/api/artifact/${encodeURIComponent(cycleId)}/demo.json`, null);
}

// ---- Architect (ADR 020) -------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type ArchitectQuestion = {
  question: string;
  header: string;
  /** Options may be absent when the architect poses an open-ended question. */
  options?: { label: string; description: string }[];
};

export type ArchitectSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: ArchitectPhase;
  round: number;
  idea: string;
  questions: ArchitectQuestion[] | null;
  planUrl: string | null;
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. */
  staleMs?: number;
};

export async function fetchArchitectSessions(): Promise<ArchitectSessionSummary[]> {
  const body = await bridgeGet<{ sessions: ArchitectSessionSummary[] }>(
    '/api/architect/sessions',
    { sessions: [] },
  );
  return body.sessions ?? [];
}

/** Absolutise a bridge-relative `planUrl` (e.g. `/api/architect/file/...`) for
 *  an iframe `src`. Returns '' when no bridge is configured. */
export async function architectFileUrl(relative: string): Promise<string> {
  const base = await resolveBridgeUrl();
  return base ? `${base}${relative}` : '';
}

export async function startArchitect(input: {
  project: string;
  idea: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/architect/start', input);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

export async function postArchitectAnswers(input: {
  project: string;
  sessionId: string;
  answers: { question: string; answer: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/architect/answer', input);
}

export type PlanVerdict = {
  project: string;
  sessionId: string;
  kind: 'approve' | 'revise' | 'reject';
  rationale?: string;
};

export async function postPlanVerdict(input: PlanVerdict): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/plan-verdict', input);
}

// ---- Instructions-creator (Stage A) --------------------------------------
//
// Mirrors the architect client: an operator-driven, file-checkpointed runner
// that authors a managed project's AGENTS.md (interview → draft → verdict →
// finalize).

export type InstructionsPhase =
  | 'briefing'
  | 'interviewing'
  | 'awaiting-answers'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type InstructionsSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: InstructionsPhase;
  /** 'init' (no AGENTS.md yet) or 'edit' (carries the existing file as context). */
  mode: 'init' | 'edit';
  round: number;
  prompt: string;
  questions: ArchitectQuestion[] | null;
  /** Existing AGENTS.md content (edit mode) shown on the briefing screen, or null. */
  currentInstructions: string | null;
  /** The agent-instruction file backing `currentInstructions` (e.g. 'AGENTS.md'), or null. */
  currentInstructionsFile: string | null;
  /** Bridge-relative URL to the pending AGENTS.draft.md, or null until drafted. */
  draftUrl: string | null;
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. */
  staleMs?: number;
};

export async function listInstructionsSessions(): Promise<InstructionsSessionSummary[]> {
  const body = await bridgeGet<{ sessions: InstructionsSessionSummary[] }>(
    '/api/instructions/sessions',
    { sessions: [] },
  );
  return body.sessions ?? [];
}

/**
 * Open a new instructions session in phase 'briefing' (does NOT spawn the agent).
 * `mode: 'edit'` carries the existing AGENTS.md as context; `'init'` creates one.
 * The operator reviews on the briefing screen, then kicks off via {@link instructionsBrief}.
 */
export async function startInstructions(input: {
  project: string;
  mode: 'init' | 'edit';
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'init' | 'edit'; error?: string }> {
  const r = await bridgePost('/api/instructions/start', { project: input.project, mode: input.mode });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    mode: (r.data?.mode === 'init' || r.data?.mode === 'edit') ? r.data.mode : undefined,
  };
}

/** Record briefing notes and kick off the instructions agent (briefing → interviewing). */
export async function instructionsBrief(input: {
  project: string;
  sessionId: string;
  brief: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/instructions/brief', input);
}

export async function answerInstructions(input: {
  project: string;
  sessionId: string;
  answers: { question: string; answer: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/instructions/answer', input);
}

export async function instructionsVerdict(input: {
  project: string;
  sessionId: string;
  kind: 'approve' | 'revise' | 'reject';
  feedback?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/instructions/verdict', input);
}

// ---- Demo-builder (Stage B) ----------------------------------------------
//
// Mirrors the instructions client: an operator-driven, file-checkpointed runner
// that authors a managed project's DEMO.html (generate → review → lock). The
// DEMO.html lives in the project repo (.forge/demo/), served via `demoUrl`.

export type DemoBuilderPhase =
  | 'briefing'
  | 'generating'
  | 'awaiting-review'
  | 'locking'
  | 'locked'
  | 'abandoned';

export type DemoSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: DemoBuilderPhase;
  /** 'create' (no locked demo yet) or 'update' (carries the existing demo as context). */
  mode: 'create' | 'update';
  /** True when the project already has a reproducible demo locked in (.forge/demo/). */
  hasLockedDemo: boolean;
  iteration: number;
  prompt: string;
  /** Bridge-relative URL to the generated DEMO.html, or null until generated. */
  demoUrl: string | null;
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. */
  staleMs?: number;
};

export async function listDemoSessions(): Promise<DemoSessionSummary[]> {
  const body = await bridgeGet<{ sessions: DemoSessionSummary[] }>(
    '/api/demo-builder/sessions',
    { sessions: [] },
  );
  return body.sessions ?? [];
}

/** A previously-locked demo snapshot for a project (newest first). */
export type DemoHistoryEntry = {
  id: string;
  /** Bridge-relative path serving the snapshotted DEMO.html (use architectFileUrl). */
  demoUrl: string;
  lockedAt: string | null;
  prompt: string;
  iterations: number | null;
};

/** List a project's previously-locked demos (snapshots under .forge/demo/history/). */
export async function listDemoHistory(project: string): Promise<DemoHistoryEntry[]> {
  const body = await bridgeGet<{ history: DemoHistoryEntry[] }>(
    `/api/demo-builder/history/${encodeURIComponent(project)}`,
    { history: [] },
  );
  return body.history ?? [];
}

/**
 * Open a new demo session in phase 'briefing' (does NOT spawn the agent).
 * `mode: 'update'` carries the existing locked demo as context; `'create'` builds one.
 * The operator reviews on the briefing screen, then kicks off via {@link demoBuilderBrief}.
 */
export async function startDemoBuilder(input: {
  project: string;
  mode: 'create' | 'update';
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'create' | 'update'; error?: string }> {
  const r = await bridgePost('/api/demo-builder/start', { project: input.project, mode: input.mode });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    mode: (r.data?.mode === 'create' || r.data?.mode === 'update') ? r.data.mode : undefined,
  };
}

/** Record briefing notes and kick off the demo agent (briefing → generating). */
export async function demoBuilderBrief(input: {
  project: string;
  sessionId: string;
  brief: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/brief', input);
}

export async function demoBuilderFeedback(input: {
  project: string;
  sessionId: string;
  feedback: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/feedback', input);
}

export async function demoBuilderLock(input: {
  project: string;
  sessionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/lock', input);
}

export async function demoBuilderAbandon(input: {
  project: string;
  sessionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/abandon', input);
}

// ---- Run + gate write endpoints (M3-4) ----------------------------------

/** Start a planned run for the given initiativeId. */
export async function startRun(
  initiativeId: string,
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const r = await bridgePost('/api/runs', { initiativeId, origin: 'human-directed' });
  return { ok: r.ok, error: r.error, runId: r.data?.runId as string | undefined };
}

/** Resume a failed run (wraps forge requeue --resume-from=unifier). */
export async function resumeRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/runs/${encodeURIComponent(runId)}/resume`);
}

/** Post a gate verdict for a run (approve or send-back). */
export async function postGate(
  runId: string,
  gateId: string,
  verdict: 'approve' | 'send-back',
  options?: { notes?: string; rationale?: string; acceptanceCriteria?: unknown[] },
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gateId)}`, {
    verdict,
    ...options,
  });
}

// ---- Reflection (the third human moment, in-UI) -------------------------

export type ReflectionData = {
  cycleId: string;
  questions: ArchitectQuestion[];
  answered: boolean;
};

export async function fetchReflection(cycleId: string): Promise<ReflectionData | null> {
  return bridgeGet<ReflectionData | null>(`/api/reflect/${encodeURIComponent(cycleId)}`, null);
}

export async function postReflectionAnswers(input: {
  cycleId: string;
  answers: { question: string; answer: string }[];
  freeform?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/reflect/${encodeURIComponent(input.cycleId)}/answer`, {
    answers: input.answers,
    freeform: input.freeform,
  });
}

// ---- WebSocket subscription ---------------------------------------------

export type Subscription = { close: () => void };

export type SubscribeHandlers = {
  onMessage: (msg: BridgeMessage) => void;
  onState?: (state: ConnectionState) => void;
};

export function subscribe(handlers: SubscribeHandlers): Subscription {
  // `socket` is the CURRENT live socket. `closed` flips when the
  // consumer cancels the subscription; once true, no new sockets are
  // created and any in-flight `connect()` aborts after its await.
  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  let connecting = false; // serialises connect() against itself
  const setState = (s: ConnectionState): void => handlers.onState?.(s);

  const connect = async (): Promise<void> => {
    if (closed || connecting) return;
    connecting = true;
    try {
      const base = await resolveBridgeUrl();
      // CRITICAL: between subscribe() returning and the await above
      // resolving, the consumer (e.g., React Strict Mode cleanup) may
      // have called close(). Re-check before creating a socket — without
      // this, every dev-mode mount leaks a WS that survives the cleanup.
      if (closed) return;
      if (!base) {
        setState('no-bridge');
        setTimeout(() => { clearBridgeCache(); void connect(); }, 2000);
        return;
      }
      setState('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
      } catch {
        setState('reconnecting');
        setTimeout(() => { void connect(); }, backoff);
        backoff = Math.min(backoff * 2, 5000);
        return;
      }
      socket = ws;
      ws.onopen = () => {
        if (closed) { try { ws.close(); } catch { /* */ } return; }
        backoff = 500;
        setState('open');
      };
      ws.onmessage = (ev) => {
        if (closed) return;
        try { handlers.onMessage(JSON.parse(ev.data)); } catch { /* malformed */ }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (closed) return;
        setState('reconnecting');
        setTimeout(() => { void connect(); }, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
      ws.onerror = () => {
        try { ws.close(); } catch { /* already closed */ }
      };
    } finally {
      connecting = false;
    }
  };

  void connect();

  return {
    close: () => {
      closed = true;
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
    },
  };
}
