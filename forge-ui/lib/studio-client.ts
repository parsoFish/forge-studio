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
  workItems?: { id: string; status: RunPhaseStatus; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[];
};

export type AgentRuntime = {
  sdk: string;
  strategy: string;
  model: string | null;
  range: string[];
  label?: string;
  loopStrategy?: string; // A7: 'ralph' | 'one-shot' (dev-loop strategy)
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
  allowedTools?: string[];
  disallowedTools?: string[];
};

export type FlowNode = {
  id: string;
  agent?: string;
  x?: number;
  y?: number;
  lane?: string;
  kind?: string;
  gate?: string;    // gate id (e.g. 'plan', 'verdict') — node blocks until approved
  fanOut?: string;  // upstream artifact name driving runtime multiplicity (mirrors server type)
  resumable?: boolean; // node can be resumed after a crash/ceiling
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

export type DemoStep = { kind: 'capture' | 'verify' | 'present'; text: string };

export type Project = {
  id: string;
  name: string;
  northStar?: string;
  instructions?: string;
  demoProcess?: DemoStep[];
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

export type KbLayer = 'index' | 'theme' | 'raw' | 'guidance';

export type KbNode = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  updatedAt?: string;
};

export type KbEdge = { from: string; to: string };

export type KbGraph = { nodes: KbNode[]; edges: KbEdge[] };

export type KbHealth = {
  layerBalance: { index: number; theme: number; raw: number };
  orphans: number;
  linkDensity: number;
  staleness: { staleRawCount: number; staleThemeCount: number };
  lintFlags: number;
  lintErrors: number;
};

export type KbNodeArticle = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  body: string;
  inbound: { id: string; title: string }[];
  outbound: { id: string; title: string }[];
  touchedBy?: string;
};

export type KbDetail = {
  kb: Kb;
  graph: KbGraph;
  health: KbHealth;
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
  kind: 'info' | 'tool' | 'cost' | 'stderr' | 'retry' | 'reasoning';
  text: string;
  /** Expandable detail (M3): reasoning text, tool inputs, error reason, raw metadata. */
  detail?: string;
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

async function studioPut(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function studioPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, error: String(err) };
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
  wiId?: string,
): Promise<PhaseLogLine[]> {
  const params = new URLSearchParams();
  if (stderr) params.set('stderr', '1');
  if (wiId) params.set('wiId', wiId); // per-WI scoping (#11)
  const qs = params.toString() ? `?${params.toString()}` : '';
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

/**
 * Map a raw AgentDefinition (server shape) to the client Agent type.
 * Server: slug, composition.{skills,tools,mcps,hooks}, body, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools
 * Client: id, skills, tools, mcps, hooks, process, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools
 */
function parseAgentDefinition(raw: unknown): Agent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const comp = (r['composition'] ?? {}) as Record<string, unknown>;
  const rt = (r['runtime'] ?? {}) as Partial<AgentRuntime>;
  return {
    id:             typeof r['slug']          === 'string' ? r['slug']          : '',
    name:           typeof r['name']          === 'string' ? r['name']          : '',
    purpose:        typeof r['purpose']       === 'string' ? r['purpose']       : '',
    skills:         Array.isArray(comp['skills'])  ? (comp['skills']  as string[]) : [],
    tools:          Array.isArray(comp['tools'])   ? (comp['tools']   as string[]) : [],
    mcps:           Array.isArray(comp['mcps'])    ? (comp['mcps']    as string[]) : [],
    hooks:          Array.isArray(comp['hooks'])   ? (comp['hooks']   as string[]) : [],
    process:        typeof r['body']          === 'string' ? r['body']          : '',
    interactivity:  typeof r['interactivity'] === 'string' ? r['interactivity'] : '',
    brainAccess:    typeof r['brainAccess']   === 'string' ? r['brainAccess']   : 'none',
    phase:          typeof r['phase']         === 'string' ? r['phase']         : undefined,
    allowedTools:   Array.isArray(r['allowedTools'])    ? (r['allowedTools']    as string[]) : [],
    disallowedTools:Array.isArray(r['disallowedTools']) ? (r['disallowedTools'] as string[]) : [],
    runtime: {
      sdk:           typeof rt.sdk           === 'string' ? rt.sdk           : 'claude-code',
      strategy:      (rt.strategy === 'fixed' || rt.strategy === 'range') ? rt.strategy : 'fixed',
      model:         typeof rt.model         === 'string' ? rt.model         : null,
      range:         Array.isArray(rt.range)             ? rt.range          : [],
      loopStrategy:  typeof rt.loopStrategy  === 'string' ? rt.loopStrategy  : undefined,
    },
  };
}

/** Fetch all agent definitions. */
export async function fetchStudioAgents(): Promise<Agent[]> {
  const body = await studioGet<{ agents: unknown[] }>('/api/studio/agents', { agents: [] });
  return (body.agents ?? []).map(parseAgentDefinition);
}

/** Fetch the curated OOTB starter agents (ADR-033) for the New-Agent picker. */
export async function fetchStarters(): Promise<Agent[]> {
  const body = await studioGet<{ starters: unknown[] }>('/api/studio/starters', { starters: [] });
  return (body.starters ?? []).map(parseAgentDefinition);
}

/** Fetch the curated starter flow (plan → dev → review) the New-Flow canvas seeds from. */
export async function fetchStarterFlow(): Promise<Flow | null> {
  const body = await studioGet<{ flow?: Flow | null }>('/api/studio/starters', { flow: null });
  return body.flow ?? null;
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

/** Fetch a single KB with its graph and health. Returns null if not found. */
export async function fetchKb(id: string): Promise<KbDetail | null> {
  const body = await studioGet<{ kb?: Kb; graph?: KbGraph; health?: KbHealth } | null>(
    `/api/studio/kbs/${encodeURIComponent(id)}`,
    null,
  );
  if (!body?.kb || !body.graph || !body.health) return null;
  return { kb: body.kb, graph: body.graph, health: body.health };
}

/** Fetch a single KB node article. Returns null if not found. */
export async function fetchKbNode(id: string, nodeId: string): Promise<KbNodeArticle | null> {
  const body = await studioGet<{ node?: KbNodeArticle } | null>(
    `/api/studio/kbs/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
    null,
  );
  return body?.node ?? null;
}

/** Fetch the studio catalog. */
export async function fetchStudioCatalog(): Promise<Catalog> {
  const body = await studioGet<{ catalog?: Catalog }>('/api/studio/catalog', {});
  return body.catalog ?? {};
}

/** Save (PUT) an agent definition by slug. */
export async function saveAgent(
  slug: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/agents/${encodeURIComponent(slug)}`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, findings: Array.isArray(r.data?.findings) ? r.data!.findings : [] };
}

/** Save (PUT) a project's config fields. */
export async function saveProject(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const r = await studioPut(`/api/studio/projects/${encodeURIComponent(id)}`, body);
  return { ok: r.ok, error: r.error };
}

/** Author a plain composable skill (P2): writes skills/<slug>/SKILL.md. */
export async function createSkill(
  body: { name: string; description: string; body?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await studioPost('/api/studio/skills', body);
  return { ok: r.ok, id: typeof r.data?.id === 'string' ? r.data.id : undefined, error: r.error };
}

/** Bootstrap a freshly-created KB with real content (P3): seed profile + index. */
export async function bootstrapKb(
  id: string,
  body: { name?: string; summary?: string },
): Promise<{ ok: boolean; error?: string }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/bootstrap`, body);
  return { ok: r.ok, error: r.error };
}

/** Run a manual brain-maintenance op on a KB (K3): 'lint' or 'index'. */
export async function runKbMaintenance(
  id: string,
  op: 'lint' | 'index',
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/maintenance`, { op });
  return { ok: r.ok, error: r.error, data: r.data };
}

/** Onboard (create) a new project: registers it + scaffolds .forge/project.json. */
export async function createProject(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await studioPost('/api/studio/projects', body);
  return { ok: r.ok, id: typeof r.data?.id === 'string' ? r.data.id : undefined, error: r.error };
}

/** Fetch a single flow definition by id. */
export async function fetchFlow(id: string): Promise<Flow | null> {
  const body = await studioGet<{ flow?: Flow } | null>(
    `/api/studio/flows/${encodeURIComponent(id)}`,
    null,
  );
  return body?.flow ?? null;
}

/** Save (PUT) a flow definition by id. Bumps version server-side. */
export async function saveFlow(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; version?: number; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/flows/${encodeURIComponent(id)}`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    version: typeof r.data?.version === 'number' ? (r.data.version as number) : undefined,
    findings: Array.isArray(r.data?.findings) ? (r.data!.findings as unknown[]) : [],
  };
}

export type PreflightClause = {
  id: string;
  title: string;
  hard: boolean;
  pass: boolean;
  detail: string;
};

export type PreflightResult = {
  clauses: PreflightClause[];
  ready: boolean;
};

export async function fetchPreflight(projectId: string): Promise<PreflightResult | null> {
  const body = await studioGet<PreflightResult | null>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/preflight`,
    null,
  );
  return body;
}

/**
 * Pin a human guidance note to a KB.
 *
 * Posts to POST /api/studio/kbs/:id/guidance {text, targetNode?}.
 * On success, the guidance file is written under brain/<kb-id>/_guidance/
 * and will appear as an amber-diamond node in the KB graph on the next fetch.
 * brain-ingest consumes and deletes it on the next ingest pass.
 */
export async function pinGuidance(
  kbId: string,
  text: string,
  targetNode?: string,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  const body: Record<string, unknown> = { text };
  if (targetNode) body['targetNode'] = targetNode;
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(kbId)}/guidance`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, file: typeof r.data?.file === 'string' ? (r.data.file as string) : undefined };
}

/**
 * Resolve which KB owns a given node id.
 * Calls GET /api/studio/kbs/resolve-node/:nodeId → { kbId: string }.
 * Returns null if the node is not found or the bridge is offline.
 */
export async function resolveKbNode(nodeId: string): Promise<{ kbId: string } | null> {
  const body = await studioGet<{ kbId?: string } | null>(
    `/api/studio/kbs/resolve-node/${encodeURIComponent(nodeId)}`,
    null,
  );
  if (!body?.kbId) return null;
  return { kbId: body.kbId };
}

/** Create a new KB (scaffold brain/<id>/ + kb.yaml + themes/ + _raw/). */
export async function createKb(body: {
  id: string;
  name: string;
  scope: string;
  desc: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await studioPost('/api/studio/kbs', body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: typeof r.data?.id === 'string' ? (r.data.id as string) : body.id };
}
