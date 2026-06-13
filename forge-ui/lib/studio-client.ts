/**
 * Client-side fetch helpers for the Studio bridge routes (M1-2).
 *
 * Mirrors the server-side types from orchestrator/run-model.ts and
 * orchestrator/studio/types.ts — re-declared client-side so they can be
 * imported into 'use client' components without pulling in Node.js modules.
 * Same pattern as EventLogEntry declared in bridge-client.ts.
 *
 * All helpers share the same no-bridge fallback pattern as bridge-client.ts:
 * returns the fallback value when the bridge URL is absent or the fetch fails.
 */

import { resolveBridgeUrl } from './bridge-client';

// ---------------------------------------------------------------------------
// Types mirroring server shapes
// ---------------------------------------------------------------------------

export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;
  wedged?: boolean;
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];
};

export type Run = {
  id: string;
  flowId: string;
  initiativeId: string;
  initiative: string;
  status: RunStatus;
  origin: 'architect' | 'human-directed';
  costUsd: number;
  startedAt?: string;
  phases: Record<string, RunPhaseStatus>;
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<
    'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection',
    'view' | 'gate'
  >>;
  gate?: string;
  gateNote?: string;
  failedAt?: string;
  failNote?: string;
  workItems?: { id: string; status: RunPhaseStatus }[];
};

export type AgentRuntime = {
  sdk: string;
  strategy: string;
  model: string | null;
  range: string[];
  subagentModel?: string;
  label?: string;
};

export type Agent = {
  id: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  hooks: string[];
  interactivity?: string;
  process?: string;
  runtime?: AgentRuntime;
  brainAccess?: string;
  phase?: string;
};

export type FlowNode = {
  id: string;
  agent?: string;
  x?: number;
  y?: number;
  lane?: string;
  kind?: string;
  fanOut?: string; // upstream artifact name driving runtime multiplicity (mirrors server type)
};

export type FlowEdge = {
  from: string;
  to: string;
  artifact?: string;
};

export type FlowTrigger = {
  on: string;
  flow: string;
  note?: string;
};

export type Flow = {
  id: string;
  name: string;
  goal: string;
  project?: string;
  kb?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  triggers: FlowTrigger[];
  costCeilingUsd?: number;
};

export type Project = {
  id: string;
  name: string;
  northStar?: string;
  instructions?: string;
  demoProcess?: string;
  skills: string[];
  kb?: string;
};

export type Kb = {
  id: string;
  name: string;
  desc?: string;
  scope: string;
  counts: { index: number; themes: number; raw: number };
};

export type CatalogItem = {
  id: string;
  name: string;
  desc?: string;
  [key: string]: unknown;
};

export type Catalog = {
  skills?: CatalogItem[];
  tools?: CatalogItem[];
  mcps?: CatalogItem[];
  hooks?: CatalogItem[];
  artifacts?: CatalogItem[];
  models?: CatalogItem[];
  sdks?: CatalogItem[];
};

export type PhaseLogLine = {
  at: string;
  kind: 'info' | 'tool' | 'cost' | 'stderr' | 'retry';
  text: string;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function studioGet<T>(path: string, fallback: T): Promise<T> {
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

/** Fetch all runs (optionally filtered by flowId). */
export async function fetchRuns(flowId?: string): Promise<Run[]> {
  const qs = flowId ? `?flow=${encodeURIComponent(flowId)}` : '';
  const body = await studioGet<{ runs: unknown[] }>(`/api/runs${qs}`, { runs: [] });
  return (body.runs ?? []).map(parseRun);
}

/** Fetch a single run by id. */
export async function fetchRun(id: string): Promise<Run | null> {
  const body = await studioGet<{ run: unknown } | null>(
    `/api/runs/${encodeURIComponent(id)}`,
    null,
  );
  if (!body?.run) return null;
  return parseRun(body.run);
}

/** Fetch phase log lines for a run's node. */
export async function fetchPhaseLog(
  runId: string,
  nodeId: string,
  stderr?: boolean,
): Promise<PhaseLogLine[]> {
  const qs = stderr ? '?stderr=1' : '';
  const body = await studioGet<{ lines: PhaseLogLine[] }>(
    `/api/runs/${encodeURIComponent(runId)}/phases/${encodeURIComponent(nodeId)}/log${qs}`,
    { lines: [] },
  );
  return body.lines;
}

/**
 * Normalise a raw server Run, filling in any missing sub-shapes so
 * downstream components never crash on an incomplete response.
 */
export function parseRun(raw: unknown): Run {
  const r = (raw ?? {}) as Partial<Run>;
  return {
    id:            r.id            ?? '',
    flowId:        r.flowId        ?? '',
    initiativeId:  r.initiativeId  ?? '',
    initiative:    r.initiative    ?? '',
    status:        r.status        ?? 'planned',
    origin:        r.origin        ?? 'human-directed',
    costUsd:       r.costUsd       ?? 0,
    startedAt:     r.startedAt,
    phases:        r.phases        ?? {},
    phaseMeta:     r.phaseMeta     ?? {},
    artifactsReady: r.artifactsReady ?? {},
    gate:          r.gate,
    gateNote:      r.gateNote,
    failedAt:      r.failedAt,
    failNote:      r.failNote,
    workItems:     r.workItems     ?? [],
  };
}

/** Fetch all agent definitions. */
export async function fetchStudioAgents(): Promise<Agent[]> {
  const body = await studioGet<{ agents: Agent[] }>('/api/studio/agents', { agents: [] });
  return body.agents;
}

/** Fetch all flow definitions. */
export async function fetchStudioFlows(): Promise<Flow[]> {
  const body = await studioGet<{ flows: Flow[] }>('/api/studio/flows', { flows: [] });
  return body.flows;
}

/** Fetch all projects. */
export async function fetchStudioProjects(): Promise<Project[]> {
  const body = await studioGet<{ projects: Project[] }>('/api/studio/projects', { projects: [] });
  return body.projects;
}

/** Fetch all knowledge bases. */
export async function fetchStudioKbs(): Promise<Kb[]> {
  const body = await studioGet<{ kbs: Kb[] }>('/api/studio/kbs', { kbs: [] });
  return body.kbs;
}

/** Fetch the studio catalog. */
export async function fetchStudioCatalog(): Promise<Catalog> {
  const body = await studioGet<Catalog>('/api/studio/catalog', {});
  return body;
}
