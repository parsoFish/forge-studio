/**
 * Forge Studio — Run Aggregator (M1-1, ADR-027/028)
 *
 * Pure aggregation: queue state + manifest + _logs/<cycleId>/events.jsonl
 * + artifacts dir → a structured Run object for the Studio UI.
 *
 * No caching. Called per-request from the bridge (logs are small; note
 * perf deferral to M3 if needed).
 *
 * Node↔phase mapping: derived at runtime from studio/flows/forge-cycle/flow.yaml
 * + skills/<agent>/SKILL.md frontmatter `phase` field. Each flow node with an
 * `agent` field maps: SKILL.md[phase] → node.id.
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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  findGateNote,
  findFailure,
} from './run-model-derive.ts';

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
  flowId: string;                    // 'forge-cycle'
  initiativeId: string;
  initiative: string;                // manifest title
  status: RunStatus;
  origin: 'architect' | 'human-directed';
  costUsd: number;
  startedAt?: string;
  phases: Record<string, RunPhaseStatus>;       // keyed by FLOW NODE id
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection', 'view' | 'gate'>>;
  gate?: string;                     // node id awaiting human ('review')
  gateNote?: string;
  failedAt?: string;                 // node id
  failNote?: string;
  workItems?: { id: string; status: RunPhaseStatus; task?: string; dependsOn?: string[] }[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hardcoded because today the scheduler only ever runs forge-cycle.yaml —
// every run IS a forge-cycle run, so this constant is always correct.
// When multi-flow scheduling lands (ADR-028 engine, M3+), derive the real
// flow id from the manifest / the flow definition that spawned the run so
// the M4 edit-lock predicate (bridge-studio.ts: r.flowId === id) correctly
// locks user-authored flows too — not just forge-cycle.
const FLOW_ID = 'forge-cycle';

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
 * Build the event-phase → flow-node-id mapping from the real forge-cycle
 * flow definition and agent SKILL.md frontmatter. Falls back to the hardcoded
 * table if the studio/ directory or any required file is missing.
 *
 * Called once per aggregateRun / listRuns invocation. Results are not cached
 * (bridge adds none in M1 — definitions are small).
 *
 * Exported for testing; not part of the public run-aggregation API.
 */
export function buildNodeMapping(root: string): Map<string, string | null> {
  try {
    const flowPath = join(resolve(root), 'studio', 'flows', 'forge-cycle', 'flow.yaml');
    const skillsDir = join(resolve(root), 'skills');

    const flow = loadFlowDefinition(flowPath);
    const agents = listAgentDefinitions(skillsDir);

    // Index agents by slug for O(1) lookup
    const agentBySlug = new Map(agents.map((a) => [a.slug, a]));

    const mapping = new Map<string, string | null>();

    // Apply canonicalization overrides first so they take precedence
    for (const [phase, nodeId] of Object.entries(CANONICAL_PHASE_OVERRIDES)) {
      mapping.set(phase, nodeId);
    }

    // Derive from flow nodes that have an agent
    for (const node of flow.nodes) {
      if (!node.agent) continue; // gate-only nodes have no agent
      const agentDef = agentBySlug.get(node.agent);
      if (!agentDef?.phase) continue;
      // Only set if not already covered by a canonicalization override
      if (!mapping.has(agentDef.phase)) {
        mapping.set(agentDef.phase, node.id);
      }
      // Also handle 'reflector' frontmatter → 'reflect' node via the reflection override
      // (already covered: CANONICAL_PHASE_OVERRIDES sets reflection → reflect)
    }

    return mapping;
  } catch (err) {
    // Flow or registry unavailable — fall back to the hardcoded table so the
    // bridge never crashes mid-edit. Log anything that is NOT a plain ENOENT
    // so real configuration errors are observable.
    const isEnoent =
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err instanceof Error && err.message.includes('no such file'));
    if (!isEnoent) {
      console.error('[run-model] definition load failed, using fallback mapping:', err);
    }
    return new Map(Object.entries(FALLBACK_PHASE_TO_NODE));
  }
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
  return aggregateRunWithMapping({ ...args, nodeMapping });
}

export function listRuns(root: string, nowMs: number): Run[] {
  const runs: Run[] = [];
  const allStates: QueueState[] = ['pending', 'in-flight', 'ready-for-review', 'done', 'failed'];
  // Build mapping once for the entire list pass
  const nodeMapping = buildNodeMapping(root);

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
        runs.push(aggregateRunWithMapping({ root, queueState: state, manifestPath, nowMs, nodeMapping }));
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
}): Run {
  const { root, queueState, manifestPath, nowMs, nodeMapping } = args;

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

  return buildRun({ manifest, cycleId, events, logDir, root, runStatus, nowMs, nodeMapping });
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
}): Run {
  const { manifest, cycleId, events, logDir, root, runStatus, nowMs, nodeMapping } = args;

  // --- Phase status derivation (ported from forge-ui/lib/phases.ts) ---
  const phases = deriveNodeStatuses(events, runStatus, nodeMapping);

  // --- Per-node metadata ---
  const phaseMeta = deriveNodeMeta(events, manifest.iteration_budget, nowMs, nodeMapping);

  // --- Work items (dev node fanOut) ---
  const workItems = deriveWorkItems(events, nodeMapping);

  // --- Reflection present flag (from events, not just files) ---
  const hasReflectionEvents = events.some((e) => e.phase === 'reflection');

  // --- Artifacts ---
  const artifactsReady = deriveArtifacts(logDir, root, runStatus, manifest.initiative_id, hasReflectionEvents);

  // --- Cost rollup ---
  const costUsd = events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

  // --- startedAt from first orchestrator start or first event ---
  const startedAt = findStartedAt(events);

  // --- Origin from cycle.start event or manifest ---
  const origin = findOrigin(events) ?? manifest.origin;

  // --- Gate ---
  const gate = runStatus === 'gated' ? 'review' : undefined;
  const gateNote = gate ? findGateNote(logDir) : undefined;

  // --- Failure ---
  const { failedAt, failNote } = findFailure(events, nodeMapping);

  // --- Initiative title from manifest body first heading ---
  const initiative = extractTitle(manifest.body, manifest.initiative_id);

  const validatedOrigin: Run['origin'] = (origin !== undefined && VALID_ORIGINS.has(origin)) ? (origin as Run['origin']) : 'architect';

  return {
    id: cycleId,
    flowId: FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative,
    status: runStatus,
    origin: validatedOrigin,
    costUsd,
    startedAt,
    phases,
    phaseMeta,
    artifactsReady,
    ...(gate !== undefined ? { gate, gateNote } : {}),
    ...(failedAt !== undefined ? { failedAt, failNote } : {}),
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

function readEventsJsonl(path: string): EventLogEntry[] {
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
    flowId: FLOW_ID,
    initiativeId: manifest.initiative_id,
    initiative: extractTitle(manifest.body, manifest.initiative_id),
    status: 'planned',
    origin,
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
  };
}

function makeDegradedRun(initiativeId: string, state: QueueState, _manifestPath: string): Run {
  return {
    id: initiativeId,
    flowId: FLOW_ID,
    initiativeId,
    initiative: '(unreadable manifest)',
    status: QUEUE_STATE_TO_RUN_STATUS[state],
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
  };
}
