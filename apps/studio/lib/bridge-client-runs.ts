/**
 * `forge-8vfn.7.6.135` — the run/kickoff client surface, split out of
 * `bridge-client.ts` (pure move; the exported shape is unchanged, only which
 * file declares it). Covers gate verdicts, starting development, the plan
 * trigger, per-flow run triggers, the structured demo model, and the M3-4
 * run + gate write endpoints.
 */
import { bridgeFetch, bridgePost, bridgeReadOr404 } from './bridge-client-core.ts';

export type AcceptanceCriterion = { given: string; when: string; then: string };

export type VerdictSubmission =
  | { kind: 'approve'; initiativeId: string; rationale: string }
  | { kind: 'send-back'; initiativeId: string; rationale: string; acceptanceCriteria: AcceptanceCriterion[] };

export async function submitVerdict(input: VerdictSubmission): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/verdict', input);
}

// ---- Start development (S7 / DEC-3) --------------------------------------

export type DevelopStartItemResult = {
  ok: boolean;
  initiativeId: string;
  /** W7-FIX-A3 (round-2 findings 6+8): the union carries EVERY status the
   *  route can send — `already-done` (a shipped manifest is never re-run from
   *  an operator action) and `not-planned` (the develop decomposition gate)
   *  were both reachable on the wire while absent from the type, so a
   *  `never`-checked switch would silently drop them. */
  status?: 'enqueued' | 'not-found' | 'already-developing' | 'already-done' | 'not-planned'
    /** W8-A3 (`flows-37`): the initiative is queued under a flow OTHER than
     *  `forge-architect`, and this batch route cannot disclose which — the
     *  roadmap payload carries no flow id — so the hand-off is refused rather
     *  than performed blind. */
    | 'repoint-requires-confirm'
    | 'error';
  cycleId?: string;
  flowId?: string;
  /** Present on `repoint-requires-confirm` — the flow it is queued under today. */
  currentFlowId?: string;
  detail?: string;
};

export type StartDevelopmentResult = {
  ok: boolean;
  error?: string;
  results?: DevelopStartItemResult[];
};

/**
 * Trigger the forge-develop flow for one or more decomposed initiatives (the
 * roadmap "start development" / "start eligible" buttons). Repoints each
 * manifest at forge-develop + threads its cycle_id, then the scheduler
 * claims it. plan-everything-before-kickoff: batch — one request, one
 * result per id (no single HTTP status can represent N outcomes).
 *
 * forge-shc WI-1: `costCeilingUsd` is an optional per-run cost-ceiling
 * override, valid ONLY when `initiativeIds` is a single id (the bridge route
 * refuses a scalar ceiling against a multi-id batch with a 400 — a single
 * number can't map onto N manifests unambiguously). Omit it to leave the
 * initiative's manifest-derived ceiling untouched, exactly as before this
 * field existed.
 */
export async function startDevelopment(
  initiativeIds: string[],
  costCeilingUsd?: number,
  /** W8-A3 (`flows-37`): the operator's answer — the flow they were shown. Only
   *  the per-card, single-initiative control ever sends it; the route REFUSES it
   *  outright on a multi-id batch, so this is enforced rather than conventional. */
  opts: { confirmRepointFrom?: string } = {},
): Promise<StartDevelopmentResult> {
  const base = costCeilingUsd === undefined ? { initiativeIds } : { initiativeIds, costCeilingUsd };
  const body = opts.confirmRepointFrom !== undefined
    ? { ...base, confirmRepointFrom: opts.confirmRepointFrom }
    : base;
  const r = await bridgePost('/api/develop/start', body);
  return {
    ok: r.ok,
    error: r.error,
    results: r.data?.results as DevelopStartItemResult[] | undefined,
  };
}

// ---- Plan trigger (R4-05-F4 / R4-11-F2) ----------------------------------

export type PlanInitiativeResult = {
  status: 'enqueued' | 'not-found' | 'already-running'
    /** W8-A3 (`flows-37`): the initiative is queued under a flow other than
     *  `forge-architect` and the operator has not confirmed moving it off it. */
    | 'repoint-requires-confirm'
    | 'error';
  initiativeId: string;
  cycleId?: string;
  flowId?: string;
  /** Present on `repoint-requires-confirm` — the flow it is queued under today. */
  currentFlowId?: string;
  detail?: string;
};

/**
 * Trigger the forge-architect (decompose) flow for a WI-less initiative (the
 * roadmap's per-initiative "Plan" trigger, R4-11-F2). Repoints the manifest
 * at forge-architect + threads its cycle_id, then the scheduler claims it.
 *
 * Unlike `startDevelopment`'s batch envelope, `POST /api/initiatives/:id/plan`
 * maps its single outcome onto a real HTTP status (200 enqueued / 404
 * not-found / 409 already-running / 500 error) with every field (status,
 * detail, cycleId, flowId) meaningful on every outcome — `bridgePost`'s
 * generic non-2xx handling only preserves a bare `error` string, so this
 * reads the JSON body directly instead of going through that envelope.
 */
export async function planInitiative(
  initiativeId: string,
  /** W8-A3 (`flows-37`): the operator's answer — the flow they were shown. */
  opts: { confirmRepointFrom?: string } = {},
): Promise<PlanInitiativeResult> {
  try {
    const res = await bridgeFetch(`/api/initiatives/${encodeURIComponent(initiativeId)}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(opts.confirmRepointFrom !== undefined ? { confirmRepointFrom: opts.confirmRepointFrom } : {}),
    });
    const body = (await res.json()) as Partial<PlanInitiativeResult> & { error?: string };
    if (body.status) {
      return {
        status: body.status,
        initiativeId,
        cycleId: body.cycleId,
        flowId: body.flowId,
        currentFlowId: body.currentFlowId,
        detail: body.detail,
      };
    }
    return { status: 'error', initiativeId, detail: body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { status: 'error', initiativeId, detail: String(err) };
  }
}

// ---- Per-flow run trigger (W7-A3, flows-02/03) ---------------------------

export type StartFlowRunResult = {
  ok: boolean;
  /** W7-FIX-A3 (round-2 finding 8): `already-done` is a REAL outcome of
   *  `POST /api/flows/:id/run` (a `_queue/done` manifest is refused, 409) and
   *  `startFlowRun` passes `body.status` straight through — the union said it
   *  was impossible, so any exhaustive switch fell to its default branch and a
   *  `never` check could not catch the omission. */
  status?: 'enqueued' | 'not-found' | 'already-running' | 'already-done' | 'not-planned'
    /** W8-A3 (`flows-37`): the initiative is queued under another flow and the
     *  operator has not confirmed moving it. Nothing was written. */
    | 'repoint-requires-confirm'
    | 'error';
  cycleId?: string;
  flowId?: string;
  /** Present on `repoint-requires-confirm` — the flow it is queued under today. */
  currentFlowId?: string;
  error?: string;
};

/**
 * Enqueue an EXISTING initiative onto a specific flow — the flow monitor's
 * generic "Start Run" (`POST /api/flows/:id/run`, `enqueueFlowRun` behind it).
 * Reads the JSON body directly (same reason as `planInitiative`: the route maps
 * every outcome onto a real HTTP status and every field is meaningful on every
 * outcome — the generic envelope would drop `status`/`detail`).
 */
export async function startFlowRun(
  flowId: string,
  initiativeId: string,
  /** W8-A3 (`flows-37`): the operator's answer — the FLOW they were shown and
   *  confirmed moving it off (a compare-and-swap; see `enqueue-flow-run.ts`).
   *  Omitted is what an un-answered start sends, and a confirmation that has
   *  gone stale under a refetch fails closed at the enqueue rather than moving
   *  the initiative off a flow the operator was never shown. */
  opts: { confirmRepointFrom?: string } = {},
): Promise<StartFlowRunResult> {
  try {
    const res = await bridgeFetch(`/api/flows/${encodeURIComponent(flowId)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(
        opts.confirmRepointFrom !== undefined
          ? { initiativeId, confirmRepointFrom: opts.confirmRepointFrom }
          : { initiativeId },
      ),
    });
    const body = (await res.json()) as Partial<StartFlowRunResult> & { error?: string; detail?: string };
    if (body.status) {
      return {
        ok: body.status === 'enqueued',
        status: body.status,
        cycleId: body.cycleId,
        flowId: body.flowId,
        currentFlowId: body.currentFlowId,
        error: body.status === 'enqueued' ? undefined : (body.detail ?? body.error ?? body.status),
      };
    }
    return { ok: false, status: 'error', error: body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 'error', error: String(err) };
  }
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
  // Mirror of packages/stations/demo-model.ts — a kind:'video' checkpoint carries a relative
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
  // Rich structured sections (mirrors packages/stations/demo-model.ts DemoModel)
  summary?: DemoSummarySection;
  apiDiff?: DemoApiDiffEntry[];
  testEvidence?: DemoTestResultRow[];
  filesChanged?: Array<{ path: string; note?: string }>;
  // New-capability fields (sibling agent adds to packages/stations/demo-model.ts)
  usage_example?: string;
  impact?: string[];
};

/** Fetch the cycle's structured demo (mirrored into _logs/<cycle>/artifacts/
 *  by snapshotCycleArtefacts). Returns null when absent or unparseable. */
export async function fetchDemoModel(cycleId: string): Promise<DemoModel | null> {
  return bridgeReadOr404<DemoModel>(`/api/artifact/${encodeURIComponent(cycleId)}/demo.json`);
}

// ---- Run + gate write endpoints (M3-4) ----------------------------------

/** Start a planned run for the given initiativeId. */
export async function startRun(
  initiativeId: string,
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const r = await bridgePost('/api/runs', { initiativeId, origin: 'human-directed' });
  return { ok: r.ok, error: r.error, runId: r.data?.runId as string | undefined };
}

/** Resume a failed run (wraps forge requeue --resume-from=integrate). */
export async function resumeRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/runs/${encodeURIComponent(runId)}/resume`);
}

/** Post a gate verdict for a run (approve or send-back). */
export async function postGate(
  runId: string,
  gateId: string,
  verdict: 'approve' | 'send-back',
  /**
   * W6-SW-3 (sweep C8#1): `project` is required by the bridge for
   * gateId==='plan' (applyPlanVerdict 400s without it) — GateBar passes it
   * whenever it has one resolved for a plan gate.
   *
   * W6-SW-3 (reviewer HIGH): `kind` is required alongside `verdict:'send-back'`
   * for gateId==='plan' — the route maps `kind` from `verdict` only for
   * 'approve'|'revise'|'reject', so a bare send-back falls through to
   * `kind:''` and 400s. See lib/gate-verdict-body.ts's `buildGateVerdictBody`.
   */
  options?: { notes?: string; rationale?: string; acceptanceCriteria?: unknown[]; project?: string; kind?: string },
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gateId)}`, {
    verdict,
    ...options,
  });
}
