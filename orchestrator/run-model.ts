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
import { parseManifest } from './manifest.ts';
import type { EventLogEntry } from './logging.ts';
import type { QueueState } from './queue.ts';
import { loadFlowDefinition, listAgentDefinitions } from './studio/registry.ts';
import {
  deriveNodeStatuses,
  deriveNodeMeta,
  deriveWorkItems,
  deriveArtifacts,
  findGateNodeId,
  findGateNote,
  findFailure,
  findReflectionLoss,
  WEDGE_THRESHOLD_MS,
} from './run-model-derive.ts';
import { sumAuthoritativeCostUsd } from './event-cost.ts';

// ---------------------------------------------------------------------------
// Exported types (binding API per M1 design §1)
// ---------------------------------------------------------------------------

export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;          // ISO — UI computes "Nm ago"
  wedged?: boolean;                 // no tool progress ≥30 min while active|retrying
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];  // unifier node, M1-3 events
};

export type Run = {
  id: string;                        // cycleId (or initiativeId for planned runs)
  flowId: string;                    // the manifest's flow_id (e.g. forge-develop); 'unknown' for pre-S8 manifests
  initiativeId: string;
  initiative: string;                // manifest title
  status: RunStatus;
  origin: 'architect' | 'human-directed';
  costUsd: number;
  startedAt?: string;
  phases: Record<string, RunPhaseStatus>;       // keyed by FLOW NODE id
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection', 'view' | 'gate'>>;
  gate?: string;                     // node id awaiting human, derived from the run's own events (G9)
  gateNote?: string;
  failedAt?: string;                 // node id
  failNote?: string;
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
   * S9 (DEC-2/DEC-3): the seed flows this run traversed (derived from its phases ∩
   * each flow's nodes). A threaded spine run carries [forge-architect, forge-develop,
   * forge-reflect] so it surfaces under all three flow monitors, each rendering its
   * own slice. A single-flow run carries just its own flow id.
   */
  flowLineage: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A run's flow id comes from its manifest's `flow_id` (architect → forge-architect,
// develop → forge-develop, reflect → forge-reflect). This constant
// is the fallback ONLY for pre-S8 manifests that predate the flow_id field — the
// flow they ran (forge-cycle) was retired (S8/DEC-3), so it is honestly labelled
// 'unknown' rather than pointing at a seed that no longer exists. The M4 edit-lock
// predicate (bridge-studio.ts: r.flowId === id) never matches 'unknown', which is
// correct — an unknowable archival flow is not editable.
const FALLBACK_FLOW_ID = 'unknown';

/** Valid origin values for a Run — anything else defaults to 'architect'. */
const VALID_ORIGINS = new Set(['architect', 'human-directed']);

/** Queue dir name → RunStatus */
const QUEUE_STATE_TO_RUN_STATUS: Record<QueueState, RunStatus> = {
  'pending': 'planned',
  'in-flight': 'active',
  'ready-for-review': 'gated',
  'done': 'complete',
  'failed': 'failed',
};

/**
 * Canonicalization overrides applied on top of the derived mapping.
 * ADR-028 engine will own this table in M3.
 *
 * - reflection → reflect (frontmatter phase is 'reflector', events emit 'reflection')
 * - review-loop/closure → review (gate-only node; no agent in flow.yaml)
 * - orchestrator/brain → null (ignored for phase status)
 */
const CANONICAL_PHASE_OVERRIDES: Record<string, string | null> = {
  reflection: 'reflect',   // events say 'reflection'; frontmatter says 'reflector'
  'review-loop': 'review', // gate-only node has no agent
  closure: 'review',       // closure folds into review node
  orchestrator: null,      // ignored for phase status
  brain: null,             // ignored for phase status
};

/**
 * Fallback mapping used when flow.yaml or registry loading fails.
 * Kept in sync with the expected derived result manually.
 */
const FALLBACK_PHASE_TO_NODE: Record<string, string | null> = {
  architect: 'architect',
  'project-manager': 'pm',
  'developer-loop': 'dev',
  unifier: 'unifier',
  'review-loop': 'review',
  closure: 'review',
  reflection: 'reflect',
  orchestrator: null,
  brain: null,
};

/**
 * Build the event-phase → flow-node-id mapping from the seed flow definitions on
 * disk + agent SKILL.md frontmatter. Falls back to the hardcoded table if the
 * studio/ directory or any required file is missing.
 *
 * S8/DEC-3: forge-cycle was retired, so this derives from the UNION of EVERY flow
 * under studio/flows/ (forge-architect / forge-develop / forge-reflect)
 * rather than the single monolith. Each flow node with an
 * `agent` maps SKILL.md[phase] → node.id; the first flow to map a phase wins (all
 * seed flows share the canonical node ids, so the union is unambiguous), and any
 * canonical phase a flow never declares is back-filled from the hardcoded table.
 *
 * Called once per aggregateRun / listRuns invocation. Results are not cached
 * (bridge adds none in M1 — definitions are small).
 *
 * Exported for testing; not part of the public run-aggregation API.
 */
export function buildNodeMapping(root: string): Map<string, string | null> {
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const skillsDir = join(resolve(root), 'skills');

    const agents = listAgentDefinitions(skillsDir);
    // Index agents by slug for O(1) lookup
    const agentBySlug = new Map(agents.map((a) => [a.slug, a]));

    const mapping = new Map<string, string | null>();

    // Apply canonicalization overrides first so they take precedence
    for (const [phase, nodeId] of Object.entries(CANONICAL_PHASE_OVERRIDES)) {
      mapping.set(phase, nodeId);
    }

    // Derive from every seed flow's nodes (union; first-write-wins per phase).
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir) : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = loadFlowDefinition(flowPath);
      } catch {
        continue; // a single malformed flow must not sink the whole mapping
      }
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        const agentDef = agentBySlug.get(node.agent);
        if (!agentDef?.phase) continue;
        if (!mapping.has(agentDef.phase)) mapping.set(agentDef.phase, node.id);
      }
    }

    // Back-fill any canonical phase no flow declared, so the mapping is always
    // complete (e.g. a stripped studio/ dir). Never overwrites a derived value.
    for (const [phase, nodeId] of Object.entries(FALLBACK_PHASE_TO_NODE)) {
      if (!mapping.has(phase)) mapping.set(phase, nodeId);
    }

    return mapping;
  } catch (err) {
    // Registry unavailable — fall back to the hardcoded table so the bridge
    // never crashes mid-edit. Log anything that is NOT a plain ENOENT so real
    // configuration errors are observable.
    const isEnoent =
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err instanceof Error && err.message.includes('no such file'));
    if (!isEnoent) {
      console.error('[run-model] definition load failed, using fallback mapping:', err);
    }
    return new Map(Object.entries(FALLBACK_PHASE_TO_NODE));
  }
}

/**
 * R2-01-F4: agent slug → flow-node-id, built directly from every seed flow's
 * `node.agent` field (union over studio/flows/*, same pattern as
 * buildNodeMapping; first-write-wins per slug — every seed flow shares
 * canonical node ids for a shared agent, so the union is unambiguous).
 *
 * Deliberately a DIFFERENT derivation from buildNodeMapping: that map routes
 * through the agent's SKILL.md `phase:` frontmatter (event.phase → node.id),
 * because phase-named events (architect/project-manager/…) carry that phase
 * string directly. A generic execAgent/runAgent event (orchestrator/
 * run-agent.ts) never carries a resolvable phase — it always carries the
 * literal `phase:'orchestrator'` plus `metadata.agent_slug` — so it needs the
 * agent's own slug resolved straight to the node id declaring it, no
 * frontmatter indirection. Consumed by eventToNodeId (run-model-derive.ts)
 * as an additive resolution path ahead of the orchestrator→null override.
 *
 * Missing/unreadable studio/flows/ degrades to an empty map (no generic-agent
 * node resolves) — the same fail-safe shape as buildFlowNodeSets, and never
 * throws so aggregateRun/listRuns stay crash-safe.
 *
 * Exported for testing; not part of the public run-aggregation API.
 */
export function buildAgentSlugToNodeId(root: string): Map<string, string> {
  const mapping = new Map<string, string>();
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir).sort() : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = loadFlowDefinition(flowPath);
      } catch {
        continue; // a single malformed flow must not sink the whole mapping
      }
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        if (!mapping.has(node.agent)) mapping.set(node.agent, node.id);
      }
    }
  } catch {
    // Registry unavailable — degrade to an empty map, same effect as a flow
    // set that declares no generic-agent nodes; existing eventToNodeId
    // resolution is entirely untouched either way (additive fix).
  }
  return mapping;
}

/**
 * S9: map each seed flow id → its set of node ids, so a run's flow LINEAGE can be
 * derived (the flows whose nodes the run actually executed). Built once per list
 * pass, alongside buildNodeMapping. Empty map when studio/flows is unavailable.
 */
export function buildFlowNodeSets(root: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir).sort() : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      try {
        const flow = loadFlowDefinition(flowPath);
        result.set(flow.id, new Set(flow.nodes.map((n) => n.id)));
      } catch {
        continue; // a malformed flow must not sink the lineage of every run
      }
    }
  } catch {
    /* registry unavailable — degrade to flow-id-only lineage */
  }
  return result;
}

/**
 * S9 (DEC-2/DEC-3): the seed flows this run traversed — every flow at least one of
 * whose nodes the run executed (its phases). A threaded spine run (one cycle_id whose
 * manifest flow_id is repointed architect→develop at the hand-off) therefore surfaces
 * under forge-architect + forge-develop + forge-reflect, so each flow's monitor renders
 * its own slice. The manifest's own flow is always included.
 */
export function computeFlowLineage(
  phaseNodeIds: readonly string[],
  manifestFlowId: string,
  flowNodeSets: Map<string, Set<string>>,
): string[] {
  const ran = new Set(phaseNodeIds);
  // Count how many flows each node id appears in, so we can key lineage off nodes
  // GLOBALLY UNIQUE to a flow.
  const nodeFlowCount = new Map<string, number>();
  for (const nodeIds of flowNodeSets.values()) {
    for (const nid of nodeIds) nodeFlowCount.set(nid, (nodeFlowCount.get(nid) ?? 0) + 1);
  }
  const lineage: string[] = [];
  for (const [flowId, nodeIds] of flowNodeSets) {
    if (flowId === manifestFlowId) { lineage.push(flowId); continue; }
    // Include another flow only if the run executed a node UNIQUE to it (present in
    // exactly one flow). The spine stages own unique nodes (architect+pm, reflect),
    // so they join the lineage; a parity copy/subset flow (e.g. forge-develop-scratch,
    // whose dev/unifier/review are shared with forge-develop) owns no unique node, so
    // it never falsely claims a run.
    let hasUniqueRanNode = false;
    for (const nid of nodeIds) {
      if (ran.has(nid) && nodeFlowCount.get(nid) === 1) { hasUniqueRanNode = true; break; }
    }
    if (hasUniqueRanNode) lineage.push(flowId);
  }
  if (manifestFlowId !== FALLBACK_FLOW_ID && !lineage.includes(manifestFlowId)) lineage.push(manifestFlowId);
  return lineage;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function aggregateRun(args: {
  root: string;
  queueState: QueueState;
  manifestPath: string;
  nowMs: number;
}): Run {
  // Build mapping once per call from flow.yaml + registry (falls back if unavailable)
  const nodeMapping = buildNodeMapping(args.root);
  const flowNodeSets = buildFlowNodeSets(args.root);
  const agentSlugToNodeId = buildAgentSlugToNodeId(args.root);
  return aggregateRunWithMapping({ ...args, nodeMapping, flowNodeSets, agentSlugToNodeId });
}

export function listRuns(root: string, nowMs: number): Run[] {
  const runs: Run[] = [];
  const allStates: QueueState[] = ['pending', 'in-flight', 'ready-for-review', 'done', 'failed'];
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

  // --- Phase status derivation (ported from forge-ui/lib/phases.ts) ---
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

  // --- Initiative title from manifest body first heading ---
  const initiative = extractTitle(manifest.body, manifest.initiative_id);

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

  return {
    id: cycleId,
    // ADR-028 / J5: associate the run with the flow its manifest names, so a
    // flow's run surfaces under /flows/<flow_id>. Pre-S8 manifests carry no
    // flow_id → 'unknown' (the forge-cycle default was retired; S8/DEC-3).
    flowId: manifest.flow_id ?? FALLBACK_FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative,
    status: reconciledStatus,
    origin: validatedOrigin,
    costUsd,
    startedAt,
    phases,
    phaseMeta,
    artifactsReady,
    // S9: surface the run under every flow whose nodes it executed (the threaded
    // spine shows under forge-architect + forge-develop + forge-reflect).
    flowLineage: computeFlowLineage(Object.keys(phases), manifest.flow_id ?? FALLBACK_FLOW_ID, flowNodeSets),
    ...(gate !== undefined ? { gate, gateNote } : {}),
    ...(failedAt !== undefined ? { failedAt, failNote } : {}),
    ...(reflectionLoss !== undefined
      ? { reflectionLost: reflectionLoss.cause, reflectionLostNote: reflectionLoss.note }
      : {}),
    ...(workItems.length > 0 ? { workItems } : {}),
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

function findOrigin(events: readonly EventLogEntry[]): string | undefined {
  for (const e of events) {
    const origin = e.metadata?.origin;
    if (e.message === 'cycle.start' && typeof origin === 'string') {
      return origin;
    }
  }
  return undefined;
}

function extractTitle(body: string, fallback: string): string {
  const match = body.match(/^#+ (.+)/m);
  return match ? match[1].trim() : fallback;
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
  return {
    id: manifest.initiative_id,
    flowId: manifest.flow_id ?? FALLBACK_FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative: extractTitle(manifest.body, manifest.initiative_id),
    status: 'planned',
    origin,
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    // A planned run hasn't executed any phase yet → lineage is just its own flow.
    flowLineage: [manifest.flow_id ?? FALLBACK_FLOW_ID].filter((f) => f !== FALLBACK_FLOW_ID),
  };
}

function makeDegradedRun(initiativeId: string, state: QueueState, _manifestPath: string): Run {
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
