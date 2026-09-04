/**
 * Forge Studio — Run Aggregator (M1-1, ADR-027/028)
 *
 * Pure aggregation: queue state + manifest + _logs/<cycleId>/events.jsonl
 * + artifacts dir → a structured Run object for the Studio UI.
 *
 * No caching. Called per-request from the bridge (logs are small; note
 * perf deferral to M3 if needed).
 *
 * Node↔phase mapping: derived at runtime from the UNION of every seed flow under
 * studio/flows/ (S8/DEC-3 retired the forge-cycle monolith) + skills/<agent>/SKILL.md
 * frontmatter `phase` field. Each flow node with an `agent` field maps:
 * SKILL.md[phase] → node.id.
 *
 * Canonicalization layer (hardcoded — ADR-028 engine will own the full table in M3):
 *   reflection  → reflect node (frontmatter says 'reflector', events say 'reflection')
 *   review-loop → review node (gate-only; no agent in flow.yaml)
 *   closure     → review node (closure folds into the review node)
 *   orchestrator/brain → null (ignored for phase status)
 *
 * If flow.yaml or registry loading fails the fallback hardcoded table is used.
 *
 * Derivation helpers (phase status, node meta, work items, artifacts, failure)
 * live in ./run-model-derive.ts.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseManifest, initiativeTitle } from './manifest.ts';
import type { InitiativeManifest } from './manifest.ts';
import type { EventLogEntry } from '@forge/kernel';
import type { QueueState } from './queue.ts';
import { normalizeProjectId } from '@forge/kernel';
import type { TriggerKindId } from './flow-trigger.ts';
import {
  deriveNodeStatuses,
  deriveNodeMeta,
  deriveWorkItems,
  deriveArtifacts,
  deriveStopOnBudget,
  findGateNodeId,
  findGateNote,
  findFailure,
  findPrUrl,
  findReflectionLoss,
  WEDGE_THRESHOLD_MS,
} from './run-model-derive.ts';
import { sumAuthoritativeCostUsd } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Exported types (binding API per M1 design §1)
// ---------------------------------------------------------------------------

export type { RunStatus, RunPhaseStatus, RunPhaseMeta, Run } from './run-view-types.ts';
import type { RunStatus, Run } from './run-view-types.ts';

import {
  buildNodeMapping,
  buildAgentSlugToNodeId,
  buildFlowNodeSets,
  computeFlowLineage,
  FALLBACK_FLOW_ID,
} from './run-model-flow-graph.ts';

// Re-exported so the package door and every existing importer are unchanged.
export { buildNodeMapping, buildAgentSlugToNodeId, buildFlowNodeSets, computeFlowLineage };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


/**
 * Valid origin values for a Run — anything else defaults to 'architect'.
 * R2-08-F4 fidelity fix: `'triggered'` (manifest.ts's own
 * `InitiativeOrigin`) belongs in this set too — it was previously silently
 * coerced to `'architect'` here, which made a triggered run indistinguishable
 * from an autonomous architect one.
 */
const VALID_ORIGINS = new Set(['architect', 'human-directed', 'triggered']);

/**
 * Queue dir name → RunStatus.
 *
 * `merged` (R4-11-F1) maps to `'complete'`: a PR-confirmed merge means the
 * run itself is effectively done (reflection is tracked separately, not as
 * run activity) — same bucket as `done`. `RunStatus` itself gains no new
 * value for this.
 */
const QUEUE_STATE_TO_RUN_STATUS: Record<QueueState, RunStatus> = {
  'pending': 'planned',
  'in-flight': 'active',
  'ready-for-review': 'gated',
  'merged': 'complete',
  'done': 'complete',
  'failed': 'failed',
};




// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function aggregateRun(args: {
  root: string;
  queueState: QueueState;
  manifestPath: string;
  nowMs: number;
  /**
   * ADR-044 P1 (`packages/flows/run-list-cache.ts`) additive-optional escape hatch: a
   * caller deriving MANY runs in one pass (the mtime-keyed cached list
   * builder) can build buildNodeMapping/buildFlowNodeSets/
   * buildAgentSlugToNodeId ONCE for the whole pass instead of once per
   * manifest — mirroring how listRuns() below already does for its own
   * loop. Omitted (the default) → unchanged behavior: every existing call
   * site, including listRuns itself, builds its own and is untouched.
   * ADR-042 disclosure: additive-optional fields on an already-exported
   * function signature, not a new orchestrator export.
   */
  nodeMapping?: Map<string, string | null>;
  flowNodeSets?: Map<string, Set<string>>;
  agentSlugToNodeId?: Map<string, string>;
}): Run {
  // Build mapping once per call from flow.yaml + registry (falls back if unavailable),
  // unless the caller already built one for a shared pass (see doc above).
  const nodeMapping = args.nodeMapping ?? buildNodeMapping(args.root);
  const flowNodeSets = args.flowNodeSets ?? buildFlowNodeSets(args.root);
  const agentSlugToNodeId = args.agentSlugToNodeId ?? buildAgentSlugToNodeId(args.root);
  return aggregateRunWithMapping({ ...args, nodeMapping, flowNodeSets, agentSlugToNodeId });
}

export function listRuns(root: string, nowMs: number): Run[] {
  const runs: Run[] = [];
  const allStates: QueueState[] = [
    'pending',
    'in-flight',
    'ready-for-review',
    'merged',
    'done',
    'failed',
  ];
  // Build mapping + flow-node-sets once for the entire list pass
  const nodeMapping = buildNodeMapping(root);
  const flowNodeSets = buildFlowNodeSets(root);
  const agentSlugToNodeId = buildAgentSlugToNodeId(root);

  for (const state of allStates) {
    const queueDir = join(resolve(root), '_queue', state);
    if (!existsSync(queueDir)) continue;

    let files: string[];
    try {
      files = readdirSync(queueDir).filter((f) => f.endsWith('.md') && !f.endsWith('.heartbeat'));
    } catch {
      continue;
    }

    for (const file of files) {
      const manifestPath = join(queueDir, file);
      try {
        runs.push(aggregateRunWithMapping({ root, queueState: state, manifestPath, nowMs, nodeMapping, flowNodeSets, agentSlugToNodeId }));
      } catch (err) {
        // Corrupt manifest: produce a degraded Run entry rather than crashing the list
        const initId = file.replace(/\.md$/, '');
        runs.push(makeDegradedRun(initId, state, manifestPath));
      }
    }
  }

  // Sort newest-first by startedAt (plans without startedAt go to end)
  runs.sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return runs;
}

// ---------------------------------------------------------------------------
// Internal implementation (accepts pre-built node mapping)
// ---------------------------------------------------------------------------

function aggregateRunWithMapping(args: {
  root: string;
  queueState: QueueState;
  manifestPath: string;
  nowMs: number;
  nodeMapping: Map<string, string | null>;
  flowNodeSets: Map<string, Set<string>>;
  agentSlugToNodeId: Map<string, string>;
}): Run {
  const { root, queueState, manifestPath, nowMs, nodeMapping, flowNodeSets, agentSlugToNodeId } = args;

  // Parse manifest (throws on unreadable — caller wraps for listRuns)
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const runStatus = QUEUE_STATE_TO_RUN_STATUS[queueState];

  // For planned runs there's no cycle log yet
  if (runStatus === 'planned') {
    return makePlannedRun(manifest);
  }

  // Resolve cycleId: prefer manifest.cycle_id, else find newest matching log dir
  const cycleId = manifest.cycle_id ?? findNewestCycleId(root, manifest.initiative_id);

  if (!cycleId) {
    // No log dir found — treat as planned
    return makePlannedRun(manifest);
  }

  const logDir = join(resolve(root), '_logs', cycleId);
  const eventsPath = join(logDir, 'events.jsonl');
  const events = existsSync(eventsPath) ? readEventsJsonl(eventsPath) : [];

  return buildRun({ manifest, cycleId, events, logDir, root, runStatus, nowMs, nodeMapping, flowNodeSets, agentSlugToNodeId });
}

// ---------------------------------------------------------------------------
// Core build function
// ---------------------------------------------------------------------------

function buildRun(args: {
  manifest: ReturnType<typeof parseManifest>;
  cycleId: string;
  events: EventLogEntry[];
  logDir: string;
  root: string;
  runStatus: RunStatus;
  nowMs: number;
  nodeMapping: Map<string, string | null>;
  flowNodeSets: Map<string, Set<string>>;
  agentSlugToNodeId: Map<string, string>;
}): Run {
  const { manifest, cycleId, events, logDir, root, runStatus, nowMs, nodeMapping, flowNodeSets, agentSlugToNodeId } = args;

  // --- Phase status derivation (see orchestrator/run-model-derive.ts) ---
  const phases = deriveNodeStatuses(events, runStatus, nodeMapping, agentSlugToNodeId);

  // --- Per-node metadata ---
  const phaseMeta = deriveNodeMeta(events, manifest.iteration_budget, nowMs, nodeMapping, agentSlugToNodeId);

  // --- Work items (dev node fanOut) ---
  const workItems = deriveWorkItems(events, nodeMapping, agentSlugToNodeId);

  // --- Reflection present flag (from events, not just files) ---
  const hasReflectionEvents = events.some((e) => e.phase === 'reflection');

  // --- Artifacts ---
  const artifactsReady = deriveArtifacts(logDir, root, runStatus, manifest.initiative_id, hasReflectionEvents);

  // --- Cost rollup (authoritative rule — orchestrator/event-cost.ts, item 1.8;
  // the naive all-events sum double/triple-counted iteration-loop phases) ---
  const costUsd = sumAuthoritativeCostUsd(events);

  // --- startedAt from first orchestrator start or first event ---
  const startedAt = findStartedAt(events);

  // --- completedAt (W6-RV-2): the real cycle-end instant, or its
  // crash-tail fallback — see the Run.completedAt doc comment above. ---
  const completedAt = findCompletedAt(events);

  // --- Origin from cycle.start event or manifest ---
  const origin = findOrigin(events) ?? manifest.origin;

  // --- Gate ---
  // G9: name the node the run actually parked at, derived from its own event
  // trail — not hardcoded to the seed flow's 'review' node id (a
  // user-authored flow can name its gate node anything; some flows have no
  // review node at all).
  const gate = runStatus === 'gated' ? findGateNodeId(events, nodeMapping, agentSlugToNodeId) : undefined;
  const gateNote = gate ? findGateNote(logDir) : undefined;

  // --- Failure ---
  const { failedAt, failNote } = findFailure(events, nodeMapping, agentSlugToNodeId);

  // --- Stop-on-budget (ON-7 defect 2b, W8-A2): derived from this same
  // events array + the workItems already computed above — see the
  // deriveStopOnBudget doc comment in run-model-derive.ts. Computed in this
  // same pass, alongside failure/gate/reflection derivation, not stored. ---
  const stopOnBudget = deriveStopOnBudget(events, workItems);

  // --- Initiative title: manifest metadata (title: / initiative_id), W7-A4 ---
  const initiative = initiativeTitle(manifest);

  const validatedOrigin: Run['origin'] = (origin !== undefined && VALID_ORIGINS.has(origin)) ? (origin as Run['origin']) : 'architect';

  // Reconcile the queue-derived status against the derived phase map. A manifest
  // can land in _queue/done/ (→ 'complete') a beat before the cycle's own
  // review/closure events are written (merge-confirmation closure runs in a
  // separate sweep), so the left panel would flash 'complete' while the review
  // hex is still gated/active. Hold 'complete' until the terminal node (reflect
  // when present, else review) has actually resolved. Flows without a review
  // node are unaffected (terminalNode undefined ⇒ no change).
  // ...but bound that hold by staleness: a merged cycle whose reflector started
  // and never emitted `end` (crashed / interrupted) would otherwise be stranded
  // 'active' forever. Once the cycle has been quiet longer than the wedge
  // threshold it is no longer live — trust the done/ placement and report
  // 'complete'. A genuinely-live cycle still mid-reflection has recent events
  // and keeps showing 'active'.
  const terminalNode = phases['reflect'] ?? phases['review'];
  const lastEventMs = events.reduce((max, e) => {
    const t = Date.parse(e.started_at);
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);
  const isStale = lastEventMs > 0 && nowMs - lastEventMs > WEDGE_THRESHOLD_MS;
  const reconciledStatus: RunStatus =
    runStatus === 'complete' &&
    terminalNode !== undefined &&
    terminalNode !== 'complete' &&
    terminalNode !== 'failed' &&
    !isStale
      ? 'active'
      : runStatus;

  // 2.10 reflection-loss surfacing: a merged cycle whose reflection was lost
  // (explicit cycle.reflection-lost event, or reflector stranded start-no-end
  // + stale) carries the loss as a flag — the status above stays 'complete',
  // matching the gate/failedAt field pattern rather than a new top-level state.
  const reflectionLoss = findReflectionLoss(events, {
    queueComplete: runStatus === 'complete',
    isStale,
  });

  // --- Trigger provenance (R2-08-F4) ---
  const trigger = deriveTrigger(manifest, events);

  // --- PR link (W7-B7, artifact-plan-17): from the run's own
  // `reviewer.pr-opened` event — honestly absent when none exists. ---
  const prUrl = findPrUrl(events);

  return {
    id: cycleId,
    // ADR-028 / J5: associate the run with the flow its manifest names, so a
    // flow's run surfaces under /flows/<flow_id>. Pre-S8 manifests carry no
    // flow_id → 'unknown' (the forge-cycle default was retired; S8/DEC-3).
    flowId: manifest.flow_id ?? FALLBACK_FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative,
    project: manifest.project,
    ...(manifest.architect_session_id ? { architectSessionId: manifest.architect_session_id } : {}),
    status: reconciledStatus,
    origin: validatedOrigin,
    costUsd,
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    phases,
    phaseMeta,
    artifactsReady,
    // S9: surface the run under every flow whose nodes it executed (the threaded
    // spine shows under forge-architect + forge-develop).
    flowLineage: computeFlowLineage(Object.keys(phases), manifest.flow_id ?? FALLBACK_FLOW_ID, flowNodeSets),
    ...(gate !== undefined ? { gate, gateNote } : {}),
    // W8-A2 (ON-7): `failNote` is NOT gated on `failedAt`. They answer
    // different questions — failedAt is WHERE, failNote is WHY — and coupling
    // them meant an unattributable failure (no flow node resolves) silently
    // dropped its reason. That was invisible while findFailure fabricated
    // `failedAt: 'unifier'` for every such run; the moment that retired-phase
    // default was removed, the error text this lane exists to surface would
    // have vanished with it. Pinned in run-model.test.ts.
    ...(failedAt !== undefined ? { failedAt } : {}),
    ...(failNote !== undefined ? { failNote } : {}),
    ...(stopOnBudget !== null ? { stopOnBudget } : {}),
    ...(reflectionLoss !== undefined
      ? { reflectionLost: reflectionLoss.cause, reflectionLostNote: reflectionLoss.note }
      : {}),
    ...(workItems.length > 0 ? { workItems } : {}),
    ...(trigger !== undefined ? { trigger } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function findStartedAt(events: readonly EventLogEntry[]): string | undefined {
  for (const e of events) {
    if (e.phase === 'orchestrator' && e.event_type === 'start') return e.started_at;
  }
  return events[0]?.started_at;
}

/**
 * W6-RV-2: the real cycle-completion instant — see the `Run.completedAt`
 * doc comment for the full provenance rule. Primary: the FIRST (there is
 * only ever one) `{phase:'orchestrator', skill:'cycle', event_type:'end'}`
 * event's `started_at`. Fallback (crash-then-requeue tail with no such
 * event): the LAST event whose `phase` is not `'reflection'` — the
 * exclusion matters only here, since it's the only path that can otherwise
 * walk into a standalone reflector-rerun event appended to the same log
 * long after the cycle itself finished (or failed to).
 */
function findCompletedAt(events: readonly EventLogEntry[]): string | undefined {
  for (const e of events) {
    if (e.phase === 'orchestrator' && e.skill === 'cycle' && e.event_type === 'end') return e.started_at;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].phase !== 'reflection') return events[i].started_at;
  }
  return undefined;
}

function findOrigin(events: readonly EventLogEntry[]): string | undefined {
  for (const e of events) {
    const origin = e.metadata?.origin;
    if (e.message === 'cycle.start' && typeof origin === 'string') {
      return origin;
    }
  }
  return undefined;
}

/**
 * R2-08-F4: find the run's own `*.trigger-firing` event — the ONLY source
 * flow-complete (flow-runner.ts) / merged (finalize-merged.ts) provenance
 * has, since chaining/merged-dispatch never mint a fresh manifest (they
 * repoint or run inline within the SAME initiative). Both emitters write the
 * identical `metadata: { on, target, source_flow }` shape; `on` IS the
 * TriggerKindId string ('flow-complete' | 'merged') and `source_flow` is the
 * declaring flow id — never operator prose, never payload text. The first
 * matching event wins (a run fires at most one trigger per cycle in
 * practice; this mirrors `findOrigin`'s own first-match convention).
 */
function findTriggerFiringEvent(events: readonly EventLogEntry[]): { on: string; sourceFlow: string } | undefined {
  for (const e of events) {
    if (e.message !== 'flow-runner.trigger-firing' && e.message !== 'finalize.trigger-firing') continue;
    const on = e.metadata?.on;
    const sourceFlow = e.metadata?.source_flow;
    if (typeof on === 'string' && typeof sourceFlow === 'string') {
      return { on, sourceFlow };
    }
  }
  return undefined;
}

/**
 * R2-08-F4 (ADR-027 amendment): derive `Run.trigger`. Two independent
 * sources, because the shipped kinds differ in whether a run is minted at
 * all (see the module-level `Run.trigger` doc):
 *
 *   1. cron / webhook / agent-complete originate a NEW run — provenance was
 *      persisted onto THIS SAME manifest at mint time
 *      (`mintTriggeredInitiative`'s `trigger_kind`/`trigger_source`/
 *      `trigger_scope`).
 *   2. flow-complete / merged mint nothing — provenance comes from the run's
 *      own `*.trigger-firing` event instead; `scope` is the run's OWN
 *      project (there is no separate "event project" to resolve — the
 *      dispatch runs inline within/against this exact initiative), read
 *      through the SAME `normalizeProjectId` every other project-id
 *      comparison in the codebase uses.
 *
 * Absent provenance (a plain architect-originated run) returns `undefined`
 * — never a fabricated placeholder.
 */
function deriveTrigger(
  manifest: Pick<InitiativeManifest, 'trigger_kind' | 'trigger_source' | 'trigger_scope' | 'project'>,
  events: readonly EventLogEntry[],
): Run['trigger'] {
  if (manifest.trigger_kind && manifest.trigger_source) {
    return {
      kind: manifest.trigger_kind as TriggerKindId,
      source: manifest.trigger_source,
      scope: manifest.trigger_scope ?? null,
    };
  }
  const firing = findTriggerFiringEvent(events);
  if (firing) {
    return {
      kind: firing.on as TriggerKindId,
      source: firing.sourceFlow,
      scope: manifest.project ? normalizeProjectId(manifest.project) : null,
    };
  }
  return undefined;
}

/**
 * mtime+size-keyed cache for parsed event logs. At roadmap scale (150+ cycle
 * dirs, 40k+ events) re-parsing every events.jsonl on every listRuns call
 * pinned the bridge at ~75% CPU and pushed /api/health latency past 4s —
 * only in-flight cycles' logs actually change between calls. Entries are
 * evicted lazily on stat mismatch; the map stays bounded by the number of
 * cycle dirs on disk.
 */
const eventsCache = new Map<string, { mtimeMs: number; size: number; entries: EventLogEntry[] }>();

function readEventsJsonl(path: string): EventLogEntry[] {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(path);
  } catch {
    return [];
  }
  const hit = eventsCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entries;
  const content = readFileSync(path, 'utf8');
  const entries: EventLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as EventLogEntry);
    } catch {
      // Skip malformed lines
    }
  }
  eventsCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, entries });
  return entries;
}

/**
 * Find the newest cycle log directory for this initiative.
 * cycleId format: <ISO-dashes>_<initiativeId>
 */
function findNewestCycleId(root: string, initiativeId: string): string | null {
  const logsRoot = join(resolve(root), '_logs');
  if (!existsSync(logsRoot)) return null;

  let candidates: string[];
  try {
    candidates = readdirSync(logsRoot)
      .filter((d) => d.endsWith(`_${initiativeId}`));
  } catch {
    return null;
  }

  if (candidates.length === 0) return null;

  // Sort descending by dir name (ISO prefix ensures lexicographic = chronological)
  candidates.sort((a, b) => b.localeCompare(a));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Degraded / planned run constructors
// ---------------------------------------------------------------------------

function makePlannedRun(manifest: ReturnType<typeof parseManifest>): Run {
  const origin: Run['origin'] = VALID_ORIGINS.has(manifest.origin) ? (manifest.origin as Run['origin']) : 'architect';
  // R2-08-F4: a planned (pending) run has no cycle log yet, so only the
  // manifest-persisted branch of deriveTrigger can ever match here (a
  // flow-complete/merged run always already has events by the time it
  // exists at all — see the module-level Run.trigger doc).
  const trigger = deriveTrigger(manifest, []);
  return {
    id: manifest.initiative_id,
    flowId: manifest.flow_id ?? FALLBACK_FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative: initiativeTitle(manifest),
    project: manifest.project,
    ...(manifest.architect_session_id ? { architectSessionId: manifest.architect_session_id } : {}),
    status: 'planned',
    origin,
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    // A planned run hasn't executed any phase yet → lineage is just its own flow.
    flowLineage: [manifest.flow_id ?? FALLBACK_FLOW_ID].filter((f) => f !== FALLBACK_FLOW_ID),
    ...(trigger !== undefined ? { trigger } : {}),
  };
}

/**
 * Build the degraded placeholder Run for a manifest that failed to parse
 * (corrupt YAML frontmatter, unreadable file, …) — pure, total, no I/O of
 * its own; `state` alone picks the reported status via the same
 * queue-dir→RunStatus table `aggregateRunWithMapping` uses. `listRuns`
 * below calls this in its per-file catch so one bad manifest degrades
 * instead of crashing the whole list.
 *
 * ADR-042 disclosure: exported per the ratified boundary "a pure function
 * with an explicit error contract may be exported for direct tests" — its
 * second caller is `packages/flows/run-list-cache.ts`'s `deriveFresh` fail path, which
 * needs the IDENTICAL degraded shape `listRuns` produces rather than a
 * hand-duplicated twin that can drift from this one.
 */
export function makeDegradedRun(initiativeId: string, state: QueueState, _manifestPath: string): Run {
  return {
    id: initiativeId,
    flowId: FALLBACK_FLOW_ID,
    initiativeId,
    initiative: '(unreadable manifest)',
    status: QUEUE_STATE_TO_RUN_STATUS[state],
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: [],
  };
}
