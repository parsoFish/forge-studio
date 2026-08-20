/**
 * Client-side glue to the forge-ui-bridge.
 *
 * Bridge URL discovery (W6-P4, redesigned per review): the client tries the
 * FIXED-PORT DEFAULT optimistically first (zero-RTT — see
 * `resolveBridgeUrl`'s own doc below), and falls back to `/api/forge-config`
 * (a Next.js route that reads process.env.FORGE_BRIDGE_URL at request time —
 * the authoritative source, correct under a `--bridge-port` override) only
 * if that first real bridge call fails outright. This still avoids the
 * build-time embedding fragility of `next.config` `env` blocks across
 * `forge watch` restarts — the DEFAULT inlined by the root layout is a
 * plain literal, never an observed env value that could go stale.
 *
 * One subscribe() opens a single WebSocket; the page is expected to
 * call this once for the lifetime of the mount. Cycle-selection filtering
 * lives in the handler the page provides — the bridge broadcasts events
 * for every live cycle.
 */
import { DEFAULT_BRIDGE_PORT } from './bridge-port.ts';
import {
  readBridgeJson,
  unwrapBridgeRead,
  unwrapBridgeReadOr404,
  type BridgeReadResult,
} from './bridge-result.ts';

export type Cycle = {
  cycleId: string;
  initiativeId: string;
  project?: string;
  // R4-11-F1: `merged` is the transient pass-through a confirmed-merge
  // manifest briefly occupies between closure's two terminal moves (→merged,
  // then merged→done in the same sweep) — distinct from the unrelated
  // `CycleOutcome`/`CycleResult.status` `'merged'` VALUE (an event outcome).
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
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

// W6-P4 (redesigned per review): `app/layout.tsx` inlines the FIXED-PORT
// DEFAULT (a build-time literal — see lib/bridge-port.ts, never an env
// read, so the layout stays statically prerendered) as this global. Never a
// host — see the function doc below.
declare global {
  interface Window {
    __FORGE_BRIDGE_PORT__?: number | null;
  }
}

// Cache the PROMISE rather than the value so concurrent callers
// (Strict Mode double-mount, two effects running on the same tick)
// share a single network request.
let cachedBridgeUrl: Promise<string> | null = null;

// True once resolveBridgeUrl has produced at least one value. The FIRST
// resolution is always the OPTIMISTIC fixed-port-default guess (zero-RTT —
// no fetch at all). Every resolution AFTER an invalidation
// (clearBridgeCache, below) goes straight to the authoritative,
// env-derived `/api/forge-config` route instead of re-guessing the same
// default a second time — the guess already proved wrong once.
let hasResolvedBefore = false;

/** Build the bridge base URL from `window.location` + a port. The host
 *  segment ALWAYS comes from `window.location.hostname` — essential for
 *  WSL2 + Windows browser: the Windows browser sees `localhost` (forwarded
 *  into WSL by WSL2), while a Linux/WSL browser sees the actual WSL
 *  hostname — NEVER from a server-supplied value (global or fetched), on
 *  either resolution path below. */
function buildBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>, port: number): string {
  return `${loc.protocol}//${loc.hostname}:${port}`;
}

/** The authoritative, env-derived answer — or `''` when the route failed or
 *  answered `bridgePort: null` (a Next process started without
 *  `FORGE_BRIDGE_URL`). `''` is NOT "there is no bridge": the caller falls
 *  back to the fixed-port default (W7-FIX-A1, A1-06). */
async function fetchAuthoritativeBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>): Promise<string> {
  try {
    const res = await fetch('/api/forge-config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`forge-config → ${res.status}`);
    const body = (await res.json()) as { bridgePort: number | null };
    if (!body.bridgePort) return '';
    return buildBridgeUrl(loc, body.bridgePort);
  } catch {
    return '';
  }
}

/** The fixed-port convention's default URL — the FIRST guess, and the last
 *  resort whenever the authoritative route has nothing better to offer. */
function defaultBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>): string {
  return buildBridgeUrl(loc, window.__FORGE_BRIDGE_PORT__ ?? DEFAULT_BRIDGE_PORT);
}

/**
 * Resolve the bridge base URL. Resolution order (W6-P4, redesigned per
 * review — never trade the app's static shells for a per-request fact that
 * has a stable default):
 *   1. FIRST call ever: `window.__FORGE_BRIDGE_PORT__` (the fixed-port
 *      convention's default, inlined by the static root layout) —
 *      OPTIMISTIC, zero network round-trips. Used immediately for the
 *      first real bridge call; `bridgeFetch` (below) corrects it if that
 *      call fails outright.
 *   2. Any resolution AFTER `clearBridgeCache()`: the authoritative,
 *      env-derived `/api/forge-config` route — correct even under a
 *      `--bridge-port` override, at the cost of one round trip. ONLY a
 *      successful, non-null answer is authoritative (W7-FIX-A1, A1-06): a
 *      failed route / `bridgePort: null` falls back to the fixed-port
 *      default again — never to an empty base that would make every later
 *      `bridgeFetch` throw 'no bridge configured' before any fetch, wedging
 *      the tab past what the banner's Retry or the health probe can undo.
 */
export function resolveBridgeUrl(): Promise<string> {
  if (cachedBridgeUrl) return cachedBridgeUrl;
  const useOptimisticDefault = !hasResolvedBefore;
  hasResolvedBefore = true;
  cachedBridgeUrl = (async () => {
    const loc = typeof window !== 'undefined' ? window.location : null;
    if (!loc) return ''; // SSR — client-only code path
    if (useOptimisticDefault) return defaultBridgeUrl(loc);
    const authoritative = await fetchAuthoritativeBridgeUrl(loc);
    return authoritative || defaultBridgeUrl(loc);
  })();
  return cachedBridgeUrl;
}

/**
 * Invalidate the current resolution so the NEXT `resolveBridgeUrl()` call
 * re-derives — always via the authoritative `/api/forge-config` route past
 * the first resolution (see `hasResolvedBefore` above). Two callers:
 *   - `bridgeFetch`'s one-shot correction, when the FIRST real bridge call
 *     against the optimistic guess fails outright.
 *   - `subscribe()`'s WS reconnect loop, after N consecutive close
 *     failures — a bridge that restarted on a different port must be
 *     re-discovered, not retried on the dead one forever.
 */
function clearBridgeCache(): void {
  cachedBridgeUrl = null;
}

// ---- fetch envelopes -----------------------------------------------------
// Every read/write helper below shares one of these shapes. W7-A1
// (home-sessions-V01 / crosscut-01): reads NEVER resolve with a caller-
// supplied empty fallback any more — `bridgeRead` returns an explicit
// `BridgeReadResult` and the typed helpers THROW `BridgeReadError` (or map a
// 404 to `null` where "no such object" is a real answer). Writes keep the
// `{ok, error}` envelope, with the bridge's own `error`/`message` verbatim.

// W6-P4: one-shot correction gate for `bridgeFetch`. Set when a bridge
// call's raw `fetch()` throws (a network-level failure — nothing is
// listening at the guessed URL, e.g. a `--bridge-port` override moved the
// bridge off the fixed-port default). W7-A1 (crosscut-22/-26): RE-ARMED by
// any bridge call whose fetch RESOLVES (regardless of status) — so a bridge
// that later restarts on a different port is re-discovered again, while a
// since-broken bridge still can't retry-storm `/api/forge-config` (the gate
// only re-arms on a real success, and each failure spends it once).
let correctionAttempted = false;

/**
 * W7-A1: listeners told when a bridge fetch THROWS (transport-level — the
 * bridge was never reached). The bridge-status store (lib/bridge-status.ts)
 * registers here so a page's failed read triggers an immediate health probe
 * instead of waiting for the WS reconnect loop. A registry (not a direct
 * import) keeps this module free of any import back into the store.
 */
type TransportFailureListener = (error: string) => void;
const transportFailureListeners = new Set<TransportFailureListener>();

export function onBridgeTransportFailure(listener: TransportFailureListener): () => void {
  transportFailureListeners.add(listener);
  return () => { transportFailureListeners.delete(listener); };
}

function notifyTransportFailure(err: unknown): void {
  const text = err instanceof Error ? err.message : String(err);
  for (const l of transportFailureListeners) {
    try { l(text); } catch { /* a listener must never break a fetch */ }
  }
}

/**
 * `fetch(base + path, init)` against the CURRENTLY resolved bridge URL, with
 * the W6-P4 one-shot correction: if a real bridge fetch THROWS (connection
 * refused / DNS failure — not a normal non-ok status, which is left entirely
 * to the caller) and the correction is armed, invalidate the cached URL,
 * re-resolve via the authoritative route, and retry exactly once against
 * the corrected URL. Exported (W7-A1, crosscut-26) so `studio-client.ts`
 * rides the SAME transport — one URL resolution + correction policy for
 * every bridge call in Studio, not two.
 */
/** `AbortError` (caller abort) / `TimeoutError` (`AbortSignal.timeout`) —
 *  the fetch was cut short by the CALLER, not refused by the network. */
function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

export async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await resolveBridgeUrl();
  if (!base) throw new Error('no bridge configured');
  try {
    const res = await fetch(`${base}${path}`, init);
    correctionAttempted = false; // reached the bridge — re-arm for a future move
    return res;
  } catch (err) {
    // A caller-imposed timeout / abort (the bounded health probe, an
    // unmounting page) is NOT evidence of a wrong port: never spend the
    // one-shot correction or clear the app-wide URL cache on it (review
    // round 2 — a slow-but-up bridge would otherwise thrash the cache and
    // pay an extra /api/forge-config round trip on every probe).
    if (isAbortLike(err)) { notifyTransportFailure(err); throw err; }
    if (correctionAttempted) { notifyTransportFailure(err); throw err; }
    correctionAttempted = true;
    clearBridgeCache();
    const corrected = await resolveBridgeUrl();
    if (!corrected || corrected === base) { notifyTransportFailure(err); throw err; } // nothing to gain from retrying
    try {
      const res = await fetch(`${corrected}${path}`, init);
      correctionAttempted = false;
      return res;
    } catch (err2) {
      notifyTransportFailure(err2);
      throw err2;
    }
  }
}

/**
 * W7-A1 — GET a bridge JSON endpoint as an explicit result. NEVER resolves
 * with a caller-supplied fallback: `{ok:false,status,error}` when the bridge
 * refused, `{ok:false,error}` (no status) when it was never reached. The
 * classification itself lives in `./bridge-result.ts` (shared with
 * studio-client.ts).
 */
export async function bridgeRead<T>(path: string): Promise<BridgeReadResult<T>> {
  return readBridgeJson<T>(() => bridgeFetch(path));
}

/** GET as a value; THROWS `BridgeReadError` on any failure — a caller with a
 *  plain `Promise<T>` signature receives no value it could mistake for empty. */
async function bridgeReadOrThrow<T>(path: string): Promise<T> {
  return unwrapBridgeRead(path, await bridgeRead<T>(path));
}

/** GET as a value where a 404 is a real answer (→ null); every other failure
 *  throws `BridgeReadError`. */
async function bridgeReadOr404<T>(path: string): Promise<T | null> {
  return unwrapBridgeReadOr404(path, await bridgeRead<T>(path));
}

/**
 * W7-A1 — the bridge-status store's health probe: `GET /api/health` must
 * answer 2xx with the forge bridge identity (`service: 'forge-bridge'`, the
 * same identity `forge studio` itself probes before reusing a port —
 * CLAUDE.md "Studio session workflow"). A foreign process on the port, a
 * non-2xx, or a transport throw are all `ok:false` with the reason.
 */
/** W7-FIX-A1 (A1-08): the probe is BOUNDED — a port that accepts the TCP
 *  connection but never answers must not hold the banner's Retry in
 *  "Checking…" for the raw socket timeout. */
export const BRIDGE_HEALTH_PROBE_TIMEOUT_MS = 4000;

export async function probeBridgeHealth(): Promise<{ ok: true } | { ok: false; error: string }> {
  const init: RequestInit = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(BRIDGE_HEALTH_PROBE_TIMEOUT_MS) }
    : {};
  const r = await readBridgeJson<{ service?: unknown }>(() => bridgeFetch('/api/health', init));
  if (!r.ok) return { ok: false, error: r.error };
  if (r.data?.service !== 'forge-bridge') return { ok: false, error: 'port answered, but not by the forge bridge' };
  return { ok: true };
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
  try {
    const res = await bridgeFetch(path, body === undefined
      ? { method: 'POST', headers: { 'x-forge-csrf': '1' } }
      : { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? data.message ?? `HTTP ${res.status}` };
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---- HTTP API ------------------------------------------------------------

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
 * itself in `./studio-client.ts`), so this mirrors `orchestrator/work-item.ts`'s
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
   * W6-RV-1: the WI's own status (mirrors `orchestrator/work-item.ts`'s
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
  workItems?: RoadmapWorkItem[];
  /**
   * W6-RV-2: the real cycle-completion instant (ISO), sourced from
   * `Run.completedAt` (orchestrator/run-model.ts) via `buildProjectRoadmap`
   * (cli/bridge-studio.ts). Drives the roadmap canvas's completion-time X
   * axis — absent (never fabricated) for a still-open initiative, or one
   * whose cycle log carries no derivable completion; such a card lands in
   * the canvas's projected zone with an honest "no date" marker instead.
   */
  completedAt?: string;
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

/** Requeue a stuck initiative back to pending/ (optionally reset retries / resume-from-demo). */
export async function recoveryRequeue(
  initiativeId: string,
  opts: { resetRetries?: boolean; resumeFromDemo?: boolean } = {},
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
  return bridgeReadOr404<LivenessReport>('/api/liveness');
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
  status?: 'enqueued' | 'not-found' | 'already-developing' | 'already-done' | 'not-planned' | 'error';
  cycleId?: string;
  flowId?: string;
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
export async function startDevelopment(initiativeIds: string[], costCeilingUsd?: number): Promise<StartDevelopmentResult> {
  const body = costCeilingUsd === undefined ? { initiativeIds } : { initiativeIds, costCeilingUsd };
  const r = await bridgePost('/api/develop/start', body);
  return {
    ok: r.ok,
    error: r.error,
    results: r.data?.results as DevelopStartItemResult[] | undefined,
  };
}

// ---- Plan trigger (R4-05-F4 / R4-11-F2) ----------------------------------

export type PlanInitiativeResult = {
  status: 'enqueued' | 'not-found' | 'already-running' | 'error';
  initiativeId: string;
  cycleId?: string;
  flowId?: string;
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
export async function planInitiative(initiativeId: string): Promise<PlanInitiativeResult> {
  try {
    const res = await bridgeFetch(`/api/initiatives/${encodeURIComponent(initiativeId)}/plan`, {
      method: 'POST',
      headers: { 'x-forge-csrf': '1' },
    });
    const body = (await res.json()) as Partial<PlanInitiativeResult> & { error?: string };
    if (body.status) {
      return {
        status: body.status,
        initiativeId,
        cycleId: body.cycleId,
        flowId: body.flowId,
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
  status?: 'enqueued' | 'not-found' | 'already-running' | 'already-done' | 'not-planned' | 'error';
  cycleId?: string;
  flowId?: string;
  error?: string;
};

/**
 * Enqueue an EXISTING initiative onto a specific flow — the flow monitor's
 * generic "Start Run" (`POST /api/flows/:id/run`, `enqueueFlowRun` behind it).
 * Reads the JSON body directly (same reason as `planInitiative`: the route maps
 * every outcome onto a real HTTP status and every field is meaningful on every
 * outcome — the generic envelope would drop `status`/`detail`).
 */
export async function startFlowRun(flowId: string, initiativeId: string): Promise<StartFlowRunResult> {
  try {
    const res = await bridgeFetch(`/api/flows/${encodeURIComponent(flowId)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ initiativeId }),
    });
    const body = (await res.json()) as Partial<StartFlowRunResult> & { error?: string; detail?: string };
    if (body.status) {
      return {
        ok: body.status === 'enqueued',
        status: body.status,
        cycleId: body.cycleId,
        flowId: body.flowId,
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
  return bridgeReadOr404<DemoModel>(`/api/artifact/${encodeURIComponent(cycleId)}/demo.json`);
}

// ---- Architect (ADR 020) -------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'exploring'
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

export type CompletenessCriticFinding = {
  severity: 'high' | 'medium' | 'low';
  /** Omitted for a finding that spans the whole plan (no single owner). */
  initiativeId?: string;
  gap: string;
};

/** Result of the architect-completeness-critic FINALIZE gate. Presence means
 *  the critic already ran for this session (one-shot-per-session). */
export type CompletenessCriticStatus = {
  ranAt: string;
  findings: CompletenessCriticFinding[];
  crashed?: boolean;
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
  /** Null until the critic has run for this session. */
  completenessCritic: CompletenessCriticStatus | null;
  /**
   * W7-A3 (sessions-kinds-08/12, artifact-plan-22/23): the initiative ids this
   * session drafted, DERIVED by the bridge from `<session>/manifests/*.md` at
   * read time (nothing stored). Present on every phase; `[]` before the
   * architect has drafted anything.
   */
  initiativeIds?: string[];
};

export async function fetchArchitectSessions(): Promise<ArchitectSessionSummary[]> {
  const body = await bridgeReadOrThrow<{ sessions?: ArchitectSessionSummary[] }>('/api/architect/sessions');
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

/** R4-11-T5 — StuckWarning's one-click re-run: re-spawns the existing
 *  session's turn as-is (no answers/round mutation). Mirrors
 *  `postArchitectAnswers`'s bridgePost shape. */
export async function rerunArchitectSession(
  project: string,
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/architect/rerun', { project, sessionId });
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
  const body = await bridgeReadOrThrow<{ sessions?: InstructionsSessionSummary[] }>('/api/instructions/sessions');
  return body.sessions ?? [];
}

/**
 * Open a new instructions session in phase 'briefing' (does NOT spawn the agent).
 * `mode: 'edit'` carries the existing AGENTS.md as context; `'init'` creates one.
 * The operator reviews on the session shell, then kicks off via the generic
 * `question-form` affordance the `briefing` phase derives (W6-B9,
 * `postSessionAffordance('instructions', sessionId, 'briefing-question-form', ...)`,
 * `@/lib/session-client`) — `POST /api/instructions/brief` (the bespoke route
 * this used to read a dedicated `instructionsBrief` client function for) is
 * unchanged server-side but has no remaining forge-ui caller.
 */
export async function startInstructions(input: {
  project: string;
  mode: 'init' | 'edit';
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — an operator-chosen kickoff
   *  model tier, validated server-side against instructions-creator's own
   *  SKILL.md-declared envelope (`resolveKickoffModelTier`). Omit for the
   *  spec's spawn-default tier. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'init' | 'edit'; error?: string }> {
  const r = await bridgePost('/api/instructions/start', {
    project: input.project, mode: input.mode,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    mode: (r.data?.mode === 'init' || r.data?.mode === 'edit') ? r.data.mode : undefined,
  };
}

// W6-B9 — `instructionsBrief`/`answerInstructions`/`instructionsVerdict`
// (the bespoke `/api/instructions/{brief,answer,verdict}` client wrappers)
// are RETIRED here — their sole caller, `SessionInstructionsPanel`, is
// deleted; every instructions affordance now POSTs through the generic
// `postSessionAffordance` (`@/lib/session-client`) instead. The three bridge
// routes themselves are unchanged server-side (still real, independently
// tested bridge surface — cli/ui-bridge-instructions.test.ts) — only their
// forge-ui client wrappers had no remaining caller.

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
  /** When set, the session is iterating ONE demo-element kind (per-element iteration). */
  targetElement: string | null;
  /** True when the project already has a reproducible demo locked in (.forge/demo/). */
  hasLockedDemo: boolean;
  iteration: number;
  prompt: string;
  /** Bridge-relative URL to the generated DEMO.html, or null until generated. */
  demoUrl: string | null;
  /** Element ids that have a rendered fragment in the repo
   *  (.forge/demo/fragments/<id>.html) — each viewable independently. */
  fragments: string[];
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. */
  staleMs?: number;
};

/** Bridge-relative URL serving one element's rendered fragment for a demo session. */
export function demoFragmentUrl(project: string, sessionId: string, element: string): string {
  return `/api/demo-builder/fragment/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(element)}`;
}

/** R4-16: bridge-relative URL serving one file out of a specific demo
 *  generation snapshot (`GET /api/demo-builder/generation/<project>/<sid>/
 *  <n>/<filename>`, cli/ui-bridge.ts). `generation` is the snapshot's own
 *  recorded number (GenerationGalleryEntry.number), never an array index. */
export function demoGenerationFileUrl(project: string, sessionId: string, generation: number, filename: string): string {
  return `/api/demo-builder/generation/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}/${generation}/${encodeURIComponent(filename)}`;
}

export async function listDemoSessions(): Promise<DemoSessionSummary[]> {
  const body = await bridgeReadOrThrow<{ sessions?: DemoSessionSummary[] }>('/api/demo-builder/sessions');
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
  const body = await bridgeReadOrThrow<{ history?: DemoHistoryEntry[] }>(
    `/api/demo-builder/history/${encodeURIComponent(project)}`,
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
  /** Iterate ONE demo-element kind (per-element iteration); omit to compose the full demo. */
  targetElement?: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against demo-builder's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'create' | 'update'; error?: string }> {
  const r = await bridgePost('/api/demo-builder/start', {
    project: input.project, mode: input.mode,
    ...(input.targetElement ? { targetElement: input.targetElement } : {}),
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
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
  /** Override/narrow the per-element iteration target for this run. */
  targetElement?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/brief', input);
}

// --- R1-3b — agentic project-brain builder ----------------------------------

export type ProjectBrainSession = {
  session_id: string;
  project: string;
  phase: 'briefing' | 'analyzing' | 'awaiting-review' | 'committing' | 'committed' | 'abandoned';
  prompt: string;
};

/** Start a project-brain builder session (phase=briefing). */
export async function startProjectBrain(input: {
  project: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against project-brain-builder's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/project-brain/start', {
    project: input.project,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

/** Record the operator's focus + kick off the analysis (briefing → analyzing). */
export async function projectBrainBrief(input: { project: string; sessionId: string; brief: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/brief', input);
}

/** Approve the staged themes → commit into the central brain (awaiting-review → committing). */
export async function projectBrainApprove(input: { project: string; sessionId: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/approve', input);
}

/** Abandon a project-brain session. */
export async function projectBrainAbandon(input: { project: string; sessionId: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/abandon', input);
}

/** Fetch all project-brain sessions. */
export async function fetchProjectBrainSessions(): Promise<ProjectBrainSession[]> {
  const body = await bridgeReadOrThrow<{ sessions?: ProjectBrainSession[] }>('/api/project-brain/sessions');
  return body.sessions ?? [];
}

/** Fetch the staged theme files for a session under review. */
export async function fetchStagedThemes(project: string, sessionId: string): Promise<Array<{ name: string; content: string }>> {
  const body = await bridgeReadOrThrow<{ themes?: Array<{ name: string; content: string }> }>(
    `/api/project-brain/themes/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}`,
  );
  return body.themes ?? [];
}

// ---- Authoring (R4-21 T3, BLOCKER-2 fix — the creation-agent session) ----

/**
 * Start an authoring session (kind: 'authoring', agent: creation-agent) —
 * mirrors {@link startProjectBrain}/{@link startInstructions}'s shape
 * exactly: POSTs the operator's own words (never a fabricated form-field
 * label) and returns the real, server-minted `sessionId`. The session is a
 * scratch working directory only — `project` picks WHERE the session's
 * bookkeeping lives (the generic session-shell's `<project>/_<kind>/<id>`
 * convention every kind uses), not what the drafted skill/hook belongs to;
 * skills and hooks are forge-wide, project-agnostic library artifacts.
 */
export async function startAuthoring(input: {
  project: string;
  prompt: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against creation-agent's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/studio/authoring/start', {
    project: input.project, prompt: input.prompt,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

/**
 * Save an authoring session's CURRENT drafted package into the real skill or
 * hook library — `POST /api/studio/authoring/finalize`
 * (`cli/bridge-studio-authoring.ts`). R4-21 phase 2, WI-2 (D5): the wire
 * contract is EXACTLY `{project, sessionId, kind, id}` — the route drives the
 * session's own `committing` turn server-side and installs the LANDED
 * package; no package bytes, hook metadata, or `upstream` ride on this
 * request (the operator reviews the drafted package in the session's own
 * file-package artifact pane, not a form here). Lands as a DRAFT
 * (`paletteVisible:false` for a skill; unbound for a hook) — approval /
 * binding stay the operator's own SEPARATE, later act (D6 — never
 * auto-approved here).
 */
export async function finalizeAuthoring(input: {
  project: string;
  sessionId: string;
  kind: 'skill' | 'hook';
  id: string;
}): Promise<{ ok: boolean; kind?: 'skill' | 'hook'; id?: string; error?: string }> {
  const r = await bridgePost('/api/studio/authoring/finalize', input);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    kind: r.data?.kind === 'skill' || r.data?.kind === 'hook' ? r.data.kind : undefined,
    id: typeof r.data?.id === 'string' ? r.data.id : undefined,
  };
}

// ---- Community refresh (W6-CR-3 — the community-registry refresh agent) ----

/**
 * Start a community-refresh session (kind: 'community-refresh', agent:
 * community-refresh) — `POST /api/studio/community-refresh/start`.
 * UNLIKE every other session-kickoff route, this one takes NO
 * `project`/prompt at all: the community registry is forge's own single,
 * forge-wide file, not a per-project artifact — the session anchors under a
 * fixed pseudo-project the bridge resolves server-side and returns as
 * `project` on the response (mirrors {@link startProjectBrain}'s own
 * server-resolved-project shape, kb-cleanup's own precedent).
 */
export async function startCommunityRefresh(input: {
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against community-refresh's own SKILL.md envelope. */
  modelTier?: string;
  /** W7-B3 (community-08) — optional operator focus ("find me skills for X").
   *  Omitted entirely when absent: the agent reads no-brief as a full
   *  refresh. */
  brief?: string;
}): Promise<{ ok: boolean; sessionId?: string; project?: string; error?: string }> {
  const r = await bridgePost('/api/studio/community-refresh/start', {
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
    ...(input.brief ? { brief: input.brief } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    project: typeof r.data?.project === 'string' ? r.data.project : undefined,
  };
}

/** One demo-element kind from the forge library (the demoProcess composition palette). */
export type DemoElementSummary = {
  id: string;
  name: string;
  phase: 'capture' | 'verify' | 'present';
  description: string;
  configHint: string;
};

/** List the forge demo-element library (skill-creating skills) for the composer palette. */
export async function listDemoElements(): Promise<DemoElementSummary[]> {
  const body = await bridgeReadOrThrow<{ elements?: DemoElementSummary[] }>('/api/studio/demo-elements');
  return body.elements ?? [];
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
  /** R4-16 (D6): names which generation snapshot to lock — validated
   *  server-side (integer >= 1) BEFORE any write. Omitted = lock the
   *  current/live sample (the pre-R4-16 behaviour, unchanged). */
  generation?: number;
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

/** Resume a failed run (wraps forge requeue --resume-from=demo). */
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

// ---- Reflection (the third human moment, in-UI) -------------------------

/**
 * A reflection question. Structurally an ArchitectQuestion plus R4-09-F3
 * automated-mode provenance: in automated mode the reflector self-answers
 * each question from the cycle logs/demo/diff, so `answer` carries the
 * inferred answer and `inferred: true` flags it for read-only rendering.
 * Both absent in interactive mode.
 */
export type ReflectionQuestion = ArchitectQuestion & {
  answer?: string;
  inferred?: boolean;
};

export type ReflectionData = {
  cycleId: string;
  questions: ReflectionQuestion[];
  answered: boolean;
  /**
   * R4-09-F3: the durable reflect mode (from the backend's reflect-mode
   * sidecar). The authoritative signal for the automated read-only view —
   * robust to per-question inferred-marker compliance. Absent on pre-F3
   * cycles ⇒ fall back to the per-question inferred heuristic.
   */
  mode?: 'interactive' | 'automated';
};

export async function fetchReflection(cycleId: string): Promise<ReflectionData | null> {
  return bridgeReadOr404<ReflectionData>(`/api/reflect/${encodeURIComponent(cycleId)}`);
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
  // Review fix #2: consecutive `onclose` events with no intervening `onopen`
  // — a WS that keeps failing to (re)connect. After N of these, the bridge
  // may have restarted on a DIFFERENT port (e.g. a `--bridge-port` override
  // across a `forge watch` restart); without this, `cachedBridgeUrl` stayed
  // pinned to the dead port forever and every reconnect attempt kept
  // retrying it. Reset to 0 on any successful `onopen`.
  let consecutiveCloseFailures = 0;
  const RECONNECT_REPROBE_THRESHOLD = 3;
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
        consecutiveCloseFailures = 0;
        setState('open');
      };
      ws.onmessage = (ev) => {
        if (closed) return;
        try { handlers.onMessage(JSON.parse(ev.data)); } catch { /* malformed */ }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (closed) return;
        consecutiveCloseFailures += 1;
        if (consecutiveCloseFailures >= RECONNECT_REPROBE_THRESHOLD) {
          // Review fix #2: re-derive via the authoritative /api/forge-config
          // route instead of retrying a dead port forever.
          clearBridgeCache();
          consecutiveCloseFailures = 0;
        }
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
