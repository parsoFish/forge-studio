/**
 * bridge-agents-run-state.ts — how a standalone agent run's state is READ.
 *
 * Carved out of `apps/forge/ui-bridge.ts` (M4-agents, exit row 2), where this
 * derivation sat between the bridge's other route families for no reason but
 * history: every symbol in this file serves the `/api/agents/*` routes and
 * nothing else, which was checked per symbol before the move rather than
 * assumed — the only mentions outside the agent surface were four doc
 * comments.
 *
 * WHY THE DEPS. `packages/agents` is rank 3. The liveness check
 * (`isTurnAlive`), the stall ceiling (`DEFAULT_STALL_CEILING_MS`), the crash
 * text extraction (`extractErrorMessage`) and the guarded event parse
 * (`parseGuardedEventsJsonl`) all live in `@forge/sessions` (rank 4), so they
 * arrive as `AgentRunStateDeps`, bound at `apps/forge/routes.ts`. Moving their
 * SOURCE here instead would have relocated four boundary violations rather
 * than closed them, which is the trap this carve exists to avoid.
 *
 * WHAT DID NOT CHANGE. The `resolveGuardedPath` / `guardedReadFile` choke
 * point is `@forge/kernel`'s and is imported directly — a containment guard is
 * never injected, because an injected guard is a guard a caller can replace.
 * Every derivation rule below, and every comment explaining one, is carried
 * verbatim: the staleness override's "a terminal marker is NEVER overridden",
 * the "no log dir at all stays running, an honest unknown" rule, and the
 * deliberate absence of the session path's `turnAlive && !hasChannel`
 * exemption are behaviour this file must keep, not prose it may summarise.
 */

import { statSync } from 'node:fs';

import { guardedReadFile, resolveGuardedPath } from '@forge/kernel';

/**
 * The rank-4 reads this derivation needs, declared STRUCTURALLY so this package
 * names no forbidden module even in a type position (`check-boundaries` runs
 * with `tsPreCompilationDeps: true`, so a type-only import is still an edge).
 * `apps/forge/routes.ts` supplies the real implementations.
 */
export type AgentRunStateDeps = {
  /** `parseGuardedEventsJsonl` — `null` for "no events observed", never a throw. */
  parseGuardedEventsJsonl(logsRoot: string, runEntryName: string): readonly Record<string, unknown>[] | null;
  /** `isTurnAlive(pid, ownershipMark)` — the same ownership proof the cancel route trusts. */
  isTurnAlive(pid: number, ownershipMark: string): boolean;
  /** `extractErrorMessage` — the crash-message extraction sessions already use. */
  extractErrorMessage(stderrText: string): string;
  /** `DEFAULT_STALL_CEILING_MS` — ONE ceiling across the product, not a second one invented here. */
  stallCeilingMs: number;
};

/**
 * The flows `Run` shape, narrowed to the eight fields this package actually
 * reads. Declared rather than imported for the same rank reason as the deps
 * above; the host passes the REAL run object, so its other fields serialize
 * onto the wire unchanged and no consumer observes a difference.
 */
export type AgentFlowRun = {
  id: string;
  flowId: string;
  status: string;
  initiative?: string;
  startedAt?: string;
  costUsd?: number | null;
  phases: Record<string, string>;
  phaseMeta: Record<string, { costUsd?: number | null } | undefined>;
};

/**
 * One row of an agent's run-history ledger — a flow-node run, a standalone
 * dispatch, or an interactive session, each carrying its OWN status/cost
 * (D3: never a run-level or cross-run aggregate) verbatim in its own native
 * vocabulary (D12: no cross-vocabulary status mapping).
 *
 * R6-06 ROUND 8/9 fix: `id`/`status`/`costUsd`/`href`/`linkKind` are the
 * PRE-EXISTING fields (kept byte-identical — every node test written
 * against Task 1's original acceptance battery, `cli/ui-bridge-agent-
 * history.test.ts`, still reads them directly and must keep passing). The
 * defect this round fixes is that the CLIENT (`apps/studio/lib/agent-ledger.ts`)
 * never received the raw per-path FACTS it needs to derive `when`/`what`/
 * `narrative` itself — so each variant now ALSO carries exactly what its own
 * client-side entry type (`AgentFlowNodeRunEntry`/`AgentStandaloneRunEntry`/
 * `AgentSessionRunEntry`, agent-ledger.ts) declares: the full `run`+`nodeId`
 * for a flow-node row (the client derives status/cost/narrative from THAT,
 * never from this row's own `status`/`costUsd` — those two stay here only
 * because deleting them would break the pre-existing acceptance battery,
 * not because the client reads them), or `when`+`what` for standalone/
 * session rows. Purely ADDITIVE — no existing consumer of the original five
 * fields observes any change.
 */
// R6-04 WI-4 — GET /api/agents/runs/<runId>'s `lines` field cap. A fixed
// cap (not a proportion of the log size) so a runaway log is never served
// whole; the TAIL (most-recently-written lines) is preserved when capping,
// so a long-running run's log view never looks frozen at dispatch.
// Carved from `apps/forge/ui-bridge.ts:140`, where it was declared among the host's
// own constants but read by exactly one function — this file's
// `deriveStandaloneStateFromEvents`. Its host declaration is deleted, not
// duplicated: two copies of a cap drift, and this is the only reader.
const RUN_LOG_LINES_MAX = 500;

export type AgentHistoryRow =
  | { id: string; linkKind: 'flow-node'; href: string; status: string; costUsd: number | null; run: AgentFlowRun; nodeId: string }
  | { id: string; linkKind: 'standalone'; href: string; status: string; costUsd: number | null; when: string; what: string }
  | { id: string; linkKind: 'session'; href: string; status: string; costUsd: number | null; when: string; what: string };

export type StandaloneRunState = {
  /**
   * W8-A2 (ON-7 defect 4) — 'stalled' added. Every OTHER member is derived
   * from a TERMINAL MARKER the run's own events.jsonl recorded (an `end`
   * event, a `agent-dispatch.{failed,cancelled}` log, a suppression
   * message) — there was no time-based signal at all, so a process
   * SIGKILLed with no terminal marker read byte-identical to one that
   * started two seconds ago: 'running' forever. 'stalled' is the ONLY
   * member derived from silence rather than a marker — see
   * `applyStandaloneStaleness`'s doc comment for the exact rule (reusing
   * the session lifecycle's own stall ceiling / liveness proof, never a
   * second invented one).
   */
  state: 'running' | 'done' | 'failed' | 'suppressed' | 'budget-exceeded' | 'cancelled' | 'stalled';
  costUsd: number | null;
  events: number;
  lines: Record<string, unknown>[];
  /** W7-B5 (agents-19): the dispatch failure's own recorded reason
   *  (`agent-dispatch.failed` metadata.error) — absent when the run never
   *  failed. Served verbatim; never summarised into the bare word "failed". */
  errorText?: string;
  /** W7-B5 (agents-06 / forge-75j): the terminal end event's own
   *  `output_refs` — what the run actually produced. `[]` until an end
   *  event exists. */
  outputRefs: string[];
  /** W7-B5 (agents-31): the ceiling in force, read from ANY event carrying
   *  `metadata.kickoff_ceiling_usd` (the t0 `agent-run.dispatched` marker,
   *  the `start` event, or the terminal `end`) — latest wins. Absent when
   *  no ceiling was ever recorded. */
  ceilingUsd?: number;
};

/**
 * Guarded parse of `<root>/<entryName>/events.jsonl` (R6-06 round 6,
 * adversarial-containment-review — replaces the former unguarded
 * `parseEventsJsonl(eventsPath: string)`, which called plain
 * `existsSync`/`readFileSync` on a path built from an ENTRY NAME the caller
 * read off disk via `readdirSync` — a directory symlink at `entryName`, a
 * file symlink at the `events.jsonl` leaf, or a hardlinked leaf were all
 * silently followed and served. `entryName` is a SINGLE directory-entry name
 * (never a multi-segment path — every caller below passes one literal
 * `readdirSync`-sourced or registry-derived name), so `resolveGuardedPath`'s
 * per-segment identity walk plus its `nlink===1` leaf check close all three
 * shapes (symlinked entry dir, symlinked leaf, hardlinked leaf) in one choke
 * point. `root` MUST be a fixed, config-derived constant (logsRoot) per
 * `resolveGuardedPath`'s own contract — see its module docstring's
 * root-folding warning; NEVER fold `entryName` into `root` before calling
 * this.
 *
 * `null` covers BOTH "the file doesn't exist yet" (a legitimate no-events-
 * yet run) AND "the guard rejected this entry" (a poisoned symlink/hardlink)
 * — collapsed into the exact same outcome so a poisoned entry is never
 * distinguishable from an absent one to any caller (the no-oracle rule).
 * A malformed individual JSONL line is skipped, not fatal — unchanged from
 * the prior behaviour. */
// W8-F6 (bead forge-6gv.27): the implementation MOVED, verbatim, to
// packages/sessions/session-readability.ts so the legacy-session read path and these four
// call sites share ONE guarded parse instead of two copies. Imported at the
// top of this file; the doc comment above travelled with it.


/**
 * The SHARED standalone status/cost derivation — extracted verbatim from
 * what was previously inlined in `GET /api/agents/runs/<runId>` (the
 * suppressed/failed/ceiling-stopped/done/running vocabulary), with ONE
 * honesty fix (Amendment 2): a run with no `end` event reports `costUsd:
 * null` (nothing has been spent AND FINISHED yet is not the same claim as
 * "spent exactly $0.00") rather than a fabricated `0`. Operates on an
 * ALREADY-PARSED events array so both call sites below (a run resolved by
 * id, and a run discovered by directory-enumeration in
 * `collectStandaloneRows`) share this exact evaluation — never a second,
 * independently-written copy (D3.5).
 */
export function deriveStandaloneStateFromEvents(parsed: readonly Record<string, unknown>[]): StandaloneRunState {
  const suppressed = parsed.some((e) => e['message'] === 'run-agent.spawn-suppressed');
  // `runAgent` emits `end` only on success; a crashed dispatch writes a
  // terminal 'agent-dispatch.failed' marker (packages/agents/agent-run.ts) instead —
  // without it the run would read 'running' forever.
  const failedMarker = [...parsed].reverse().find((e) => e['message'] === 'agent-dispatch.failed');
  // W7-B5 (agents-30): an operator cancel writes a durable
  // 'agent-dispatch.cancelled' marker (the cancel route). STICKY — it wins
  // over every other terminal fact, including an `end` event that lands
  // after the cancel (a SIGTERM'd agent finishing anyway must never
  // resurrect the run as 'done' — the same sticky-cancel rule W7-A2
  // established for sessions).
  const cancelled = parsed.some((e) => e['message'] === 'agent-dispatch.cancelled');
  const endEvent = parsed.find((e) => e['event_type'] === 'end');
  // R6-04 (WI-2): a ceiling-stop (SDK `result_subtype: 'error_max_budget_usd'`,
  // recorded into the end event's metadata by runAgent) is a DISTINCT
  // terminal state, never collapsed into an ordinary successful 'done'.
  const endMetadata = endEvent?.['metadata'] as Record<string, unknown> | undefined;
  const ceilingStopped = endMetadata?.['result_subtype'] === 'error_max_budget_usd';
  const state: StandaloneRunState['state'] =
    cancelled ? 'cancelled'
      : failedMarker ? 'failed'
        : suppressed ? 'suppressed'
          : ceilingStopped ? 'budget-exceeded'
            : endEvent ? 'done'
              : 'running';
  const costUsd = typeof endEvent?.['cost_usd'] === 'number' ? (endEvent['cost_usd'] as number) : null;
  const failedMeta = failedMarker?.['metadata'] as Record<string, unknown> | undefined;
  const errorText = typeof failedMeta?.['error'] === 'string' ? (failedMeta['error'] as string) : undefined;
  const outputRefs = Array.isArray(endEvent?.['output_refs'])
    ? (endEvent!['output_refs'] as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  // Latest recorded ceiling across ALL events (dispatched marker → start
  // → end); a run that never recorded one stays honestly absent. TWO keys,
  // in precedence order (review round 1): `kickoff_ceiling_usd` is the
  // OPERATOR's explicit ceiling, `effective_ceiling_usd` is whatever cap the
  // run actually executed under — the agent's own declared
  // `budgets.maxBudgetUsd` when no operator ceiling was given. Reading only
  // the first meant every dispatch that relied on a declared default (the
  // whole onboarding route, and any agent run without an explicit ceiling)
  // reported "no ceiling was recorded" for a cap that was genuinely in
  // force. Same event may carry both; the operator's wins.
  let ceilingUsd: number | undefined;
  for (const e of parsed) {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    const recorded = typeof meta?.['kickoff_ceiling_usd'] === 'number'
      ? (meta['kickoff_ceiling_usd'] as number)
      : typeof meta?.['effective_ceiling_usd'] === 'number'
        ? (meta['effective_ceiling_usd'] as number)
        : undefined;
    if (recorded !== undefined) ceilingUsd = recorded;
  }
  // `events` stays the COUNT (uncapped); `lines` is the tail slice served for
  // rendering — a fixed cap regardless of log size, TAIL-preserving.
  const lines = parsed.slice(-RUN_LOG_LINES_MAX);
  return {
    state,
    costUsd,
    events: parsed.length,
    lines,
    outputRefs,
    ...(errorText !== undefined ? { errorText } : {}),
    ...(ceilingUsd !== undefined ? { ceilingUsd } : {}),
  };
}

/**
 * W8-A2 (ON-7 defect 4) — a standalone run's OWN on-disk liveness facts.
 * `spawnAgentDispatch` (this file) writes `events.jsonl`, `stderr.log` AND
 * `turn.pid` into the SAME `_logs/<runId>/` directory — unlike a
 * SESSION-bound dispatch (onboarding etc.), whose tracked `turn.pid` lives
 * in the session's OWN log dir while its events/stderr live in a DIFFERENT
 * one (`_logs/<runId>/`; see `readSessionLifecycleFacts`'s doc comment in
 * bridge-studio-lifecycle.ts). Because a standalone run never splits those
 * facts across two directories, `lastActivityMs`/`turnAlive` are read the
 * same guarded way `readSessionLifecycleFacts` reads them, just against one
 * flat directory instead of a per-kind session template.
 */
function readStandaloneLivenessFacts(deps: AgentRunStateDeps, logsRoot: string, runEntryName: string): {
  idleMs: number | null;
  turnAlive: boolean;
  stderr: { text: string; mtimeMs: number } | null;
} {
  const guardedMtime = (segments: readonly string[]): number | null => {
    const guarded = resolveGuardedPath(logsRoot, segments);
    if (!guarded.ok || !guarded.exists) return null;
    try {
      return statSync(guarded.realPath).mtimeMs; // guard-terminal: `guarded.realPath` IS the guard's own output.
    } catch {
      return null;
    }
  };
  const eventsMtimeMs = guardedMtime([runEntryName, 'events.jsonl']);
  const stderrMtimeMs = guardedMtime([runEntryName, 'stderr.log']);
  const pidMtimeMs = guardedMtime([runEntryName, 'turn.pid']);
  const candidates = [eventsMtimeMs, stderrMtimeMs, pidMtimeMs].filter((m): m is number => m !== null);
  const lastActivityMs = candidates.length > 0 ? Math.max(...candidates) : null;

  const pidRaw = guardedReadFile(logsRoot, [runEntryName, 'turn.pid']);
  const turnPid = pidRaw !== null && /^\d+\s*$/.test(pidRaw.trim()) ? Number.parseInt(pidRaw.trim(), 10) : null;
  // Ownership mark = the runId itself, a whole argv element — the SAME
  // contract `killTrackedRun` already trusts for the cancel route
  // (`--run-id <runId>`, buildAgentDispatchArgs).
  const turnAlive = turnPid !== null && deps.isTurnAlive(turnPid, runEntryName);

  const stderrText = stderrMtimeMs !== null ? guardedReadFile(logsRoot, [runEntryName, 'stderr.log']) : null;
  const stderr = stderrText !== null && stderrText.trim().length > 0 && stderrMtimeMs !== null ? { text: stderrText, mtimeMs: stderrMtimeMs } : null;

  return {
    idleMs: lastActivityMs !== null ? Math.max(0, Date.now() - lastActivityMs) : null,
    turnAlive,
    stderr,
  };
}

/**
 * W8-A2 (ON-7 defect 4) — narrows a 'running' verdict to 'stalled' using the
 * run's own liveness facts. Every OTHER state is a terminal marker and is
 * NEVER overridden (a `done`/`failed`/`cancelled` run cannot un-happen
 * because a later poll finds an old mtime). `idleMs === null` (no log dir
 * at all — no liveness signal to be silent on) stays 'running': an honest
 * "unknown", never a guess — the SAME rule `deriveSessionLifecycle` applies
 * to a session with no log dir.
 *
 * Reuses `DEFAULT_STALL_CEILING_MS` (bridge-studio-lifecycle.ts) — ONE
 * ceiling across the product, not a second invented one for standalone
 * runs — and `isTurnAlive`, the SAME ownership-proof liveness check the
 * cancel route already trusts.
 *
 * NO `turnAlive && !hasChannel` exemption (the sibling rule
 * `deriveSessionLifecycle:159` applies for SESSION-bound dispatches, whose
 * tracked turn.pid can live in a directory with no heartbeat/events channel
 * at all). A standalone run's `turn.pid`, `events.jsonl` and `stderr.log`
 * are ALL written into this SAME directory by `spawnAgentDispatch` — so a
 * live pid always shares its directory with a real events channel once
 * anything has landed, and a live-but-silent-past-ceiling standalone run (a
 * wedged tool call, a hung SDK turn) is exactly the zombie shape this
 * exists to catch, not exempt from. Applying the session's exemption here
 * would mean a standalone run could NEVER be caught stalled while its
 * process happens to still be alive — the real leaked dirs on disk today
 * (`_agent-onboarding-agent-*`, `_agent-w7-throwaway-agent-*`) are dead
 * processes with no live pid at all, where the exemption is moot anyway;
 * a live-but-wedged one is the case it would wrongly protect.
 */
function applyStandaloneStaleness(
  deps: AgentRunStateDeps,
  state: StandaloneRunState['state'],
  liveness: { idleMs: number | null },
): StandaloneRunState['state'] {
  if (state !== 'running') return state;
  if (liveness.idleMs === null) return 'running';
  return liveness.idleMs > deps.stallCeilingMs ? 'stalled' : 'running';
}

/** The ONE seam every caller of `deriveStandaloneStateFromEvents` routes a
 *  result through before using it — so a future caller cannot forget the
 *  staleness override, mirroring `deriveRowLifecycle`'s same role for
 *  sessions. When the override promotes 'running' to 'stalled' AND a real
 *  stderr.log exists, `errorText` carries the runner's own last words
 *  (`extractErrorMessage` — the SAME crash-message extraction sessions use)
 *  rather than the bare word "stalled"; a stalled run with an empty/absent
 *  stderr stays honestly errorText-less, same as a stalled SESSION's
 *  `error: null`. */
export function withStandaloneLiveness(deps: AgentRunStateDeps, logsRoot: string, runEntryName: string, base: StandaloneRunState): StandaloneRunState {
  const liveness = readStandaloneLivenessFacts(deps, logsRoot, runEntryName);
  const state = applyStandaloneStaleness(deps, base.state, liveness);
  if (state === base.state) return base;
  return {
    ...base,
    state,
    ...(liveness.stderr !== null ? { errorText: deps.extractErrorMessage(liveness.stderr.text) } : {}),
  };
}

/** Full derivation for a standalone run directory: handles the "dispatched,
 *  no event has landed yet" state (no `events.jsonl` at all, OR a poisoned
 *  entry the guard rejected — both collapse to the same honest "no events
 *  observed" outcome, never a leak) honestly — `running`/`costUsd: null` —
 *  then delegates to the shared per-event derivation above, then the
 *  staleness override (ON-7 defect 4). Used by BOTH `GET /api/agents/runs/
 *  <runId>` and the history route's standalone-path rows. Takes `logsRoot`
 *  + the run's own directory NAME (never a pre-joined path) so the guarded
 *  parse below can identity-check that name as its own path segment (R6-06
 *  round 6). */
export function deriveStandaloneRunState(deps: AgentRunStateDeps, logsRoot: string, runEntryName: string): StandaloneRunState {
  const parsed = deps.parseGuardedEventsJsonl(logsRoot, runEntryName);
  const base: StandaloneRunState = parsed === null
    ? { state: 'running', costUsd: null, events: 0, lines: [], outputRefs: [] }
    : deriveStandaloneStateFromEvents(parsed);
  return withStandaloneLiveness(deps, logsRoot, runEntryName, base);
}

/** D4 (amended, round 3): standalone identity is EXACT EQUALITY against the
 *  run's OWN events, on EITHER `metadata.agent_slug` (the shape `runAgent`'s
 *  real start/end events carry) OR top-level `skill` (the shape a
 *  materials-staged-only run carries, no `metadata.agent_slug` key at all —
 *  see `POST /api/agents/:slug/run`'s own 'agent-run.materials-staged' log
 *  event). NEVER a runId prefix/substring match — `_agent-probe-x-…` must
 *  never satisfy a query for `probe` just because the string starts with
 *  `_agent-probe-`. */
export function standaloneRunMatchesSlug(events: readonly Record<string, unknown>[], slug: string): boolean {
  return events.some((e) => {
    const metadata = e['metadata'] as Record<string, unknown> | undefined;
    return metadata?.['agent_slug'] === slug || e['skill'] === slug;
  });
}

/** The literal prefix `runId = _agent-<slug>-<stamp>` mints (POST
 *  /api/agents/:slug/run). Used ONLY to narrow which `_logs/` entries are
 *  even candidate standalone-dispatch directories, before parsing their
 *  events — a coarse, slug-INDEPENDENT structural filter (distinguishing
 *  standalone dirs from flow-cycle dirs and `_<kind>-<sessionId>` session-log
 *  dirs), never used as an identity check (that stays exact-match on the
 *  run's own events, per D4 above — this constant plays no role in deciding
 *  whether a given candidate BELONGS to the queried slug). */
export const STANDALONE_RUN_DIR_PREFIX = '_agent-';

/**
 * Path 1 — flow-node rows. `buildAgentSlugToNodeId` (run-model.ts) resolves
 * the slug straight to the flow node id that declares it, from the union of
 * every seed flow's `flow.yaml` under `studio/flows/` (no fallback table — an unresolvable slug
 * simply yields no flow-node rows, never a crash). For every run whose
 * `phases` map actually reached that node, the row's status/cost come from
 * THAT NODE's own `phases[nodeId]`/`phaseMeta[nodeId]` — never
 * `run.status`/`run.costUsd` (the run-level aggregate over every phase in the
 * cycle) — D9/D3.
 */
