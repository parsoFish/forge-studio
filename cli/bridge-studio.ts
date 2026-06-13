/**
 * Forge Studio bridge routes (M1-2, ADR-027/028).
 *
 * Boolean-returning route module plugged into handleHttp after handleReflect.
 * All routes are read-only GET endpoints; write routes land in M2.
 *
 * Routes:
 *   GET /api/runs                           → { runs: Run[] }
 *   GET /api/runs?flow=<id>                 → { runs: Run[] } (filtered)
 *   GET /api/runs/<id>                      → { run: Run }
 *   GET /api/runs/<id>/phases/<node>/log    → { lines } (stderr=1 to filter)
 *   GET /api/studio/agents                  → { agents: AgentDefinition[] }
 *   GET /api/studio/flows                   → { flows: FlowDefinition[] }
 *   GET /api/studio/projects                → { projects }
 *   GET /api/studio/kbs                     → { kbs }
 *   GET /api/studio/catalog                 → catalog content
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { listRuns, buildNodeMapping } from '../orchestrator/run-model.ts';
import type { Run } from '../orchestrator/run-model.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';
import {
  listAgentDefinitions,
  loadFlowDefinition,
  loadKbDescriptor,
  loadProjectsRegistry,
  loadCatalog,
} from '../orchestrator/studio/registry.ts';

// ---------------------------------------------------------------------------
// Context surface needed by studio routes
// ---------------------------------------------------------------------------

export type StudioContext = {
  forgeRoot: string;
  logsRoot: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(payload);
}

/** Parse the query-string from a URL string (e.g. '/api/runs?flow=forge-cycle'). */
function parseQuery(rawUrl: string): URLSearchParams {
  const idx = rawUrl.indexOf('?');
  return new URLSearchParams(idx >= 0 ? rawUrl.slice(idx + 1) : '');
}

/** Strip the query-string from a URL string. */
function pathOnly(rawUrl: string): string {
  const idx = rawUrl.indexOf('?');
  return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
}

// ---------------------------------------------------------------------------
// Phase log line derivation (design §7)
// ---------------------------------------------------------------------------

type LogLineKind = 'info' | 'tool' | 'cost' | 'stderr' | 'retry';

type LogLine = { at: string; kind: LogLineKind; text: string };

/**
 * Classify a single EventLogEntry into a log line for the phase log route.
 *
 * kind mapping (design §7):
 *   error                                          → stderr
 *   tool_use                                       → tool
 *   usage_delta / agent_heartbeat / cost-only log  → cost
 *   failure_classification with recoverable=true   → retry
 *   else                                           → info
 */
function classifyEvent(e: EventLogEntry): LogLine {
  let kind: LogLineKind = 'info';

  if (e.event_type === 'error') {
    kind = 'stderr';
  } else if (e.event_type === 'tool_use') {
    kind = 'tool';
  } else if (
    e.message === 'usage_delta' ||
    e.event_type === 'agent_heartbeat' ||
    (e.cost_usd !== undefined && e.cost_usd > 0 && e.event_type === 'log')
  ) {
    kind = 'cost';
  } else if (e.message === 'failure_classification' && e.metadata?.recoverable === true) {
    kind = 'retry';
  }

  // Build a concise text from message + brief metadata
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.event_type === 'tool_use' && e.metadata?.tool_name) {
    parts.push(`[${String(e.metadata.tool_name)}]`);
  }
  if (e.cost_usd !== undefined && e.cost_usd > 0) {
    parts.push(`$${e.cost_usd.toFixed(4)}`);
  }
  if (kind === 'retry' && e.metadata?.reason) {
    parts.push(`(${String(e.metadata.reason)})`);
  }
  if (parts.length === 0 && e.metadata?.message) {
    parts.push(String(e.metadata.message));
  }
  if (parts.length === 0) {
    parts.push(e.event_type);
  }

  return { at: e.started_at, kind, text: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Runs helpers
// ---------------------------------------------------------------------------

/** Find a Run by id (cycleId or initiativeId). Returns null if not found. */
function findRun(forgeRoot: string, id: string): Run | null {
  const runs = listRuns(forgeRoot, Date.now());
  return runs.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// KBs with layer counts
// ---------------------------------------------------------------------------

type KbWithCounts = {
  id: string;
  name: string;
  scope: string;
  desc: string;
  path: string;
  counts: { index: number; themes: number; raw: number };
};

function countLayerFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/**
 * Walk brain/ for kb.yaml files and enrich each with layer counts.
 * Looks for kb.yaml in every direct sub-directory of brain/.
 */
function loadKbDescriptors(forgeRoot: string): KbWithCounts[] {
  const brainRoot = join(resolve(forgeRoot), 'brain');
  if (!existsSync(brainRoot)) return [];

  let dirs: string[];
  try {
    dirs = readdirSync(brainRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const result: KbWithCounts[] = [];
  for (const d of dirs) {
    const kbYamlPath = join(brainRoot, d, 'kb.yaml');
    if (!existsSync(kbYamlPath)) continue;
    try {
      const kb = loadKbDescriptor(kbYamlPath);
      const kbDir = join(brainRoot, d);
      const counts = {
        index: existsSync(join(kbDir, 'INDEX.md')) ? 1 : 0,
        themes: countLayerFiles(join(kbDir, 'themes')),
        raw: countLayerFiles(join(kbDir, '_raw')),
      };
      result.push({ ...kb, counts });
    } catch {
      // Skip unreadable kb.yaml
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Projects with merged project.json data
// ---------------------------------------------------------------------------

type ProjectWithMeta = {
  id: string;
  path: string;
  northStar?: string;
  kb?: string;
  instructions?: string;
  skills?: string[];
};

function loadProjectsWithMeta(forgeRoot: string): ProjectWithMeta[] {
  const projectsYamlPath = join(resolve(forgeRoot), 'studio', 'projects.yaml');
  if (!existsSync(projectsYamlPath)) return [];

  let registry;
  try {
    registry = loadProjectsRegistry(projectsYamlPath);
  } catch {
    return [];
  }

  return registry.projects.map((ref) => {
    const projectJsonPath = join(resolve(forgeRoot), ref.path, '.forge', 'project.json');
    const result: ProjectWithMeta = { id: ref.id, path: ref.path };
    if (existsSync(projectJsonPath)) {
      try {
        const raw = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>;
        if (typeof raw.northStar === 'string') result.northStar = raw.northStar;
        if (typeof raw.kb === 'string') result.kb = raw.kb;
        if (typeof raw.instructions === 'string') result.instructions = raw.instructions;
        if (Array.isArray(raw.skills) && raw.skills.every((s) => typeof s === 'string')) {
          result.skills = raw.skills as string[];
        }
      } catch {
        // ignore unreadable project.json
      }
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Flows loader
// ---------------------------------------------------------------------------

function loadAllFlows(forgeRoot: string) {
  const flowsDir = join(resolve(forgeRoot), 'studio', 'flows');
  if (!existsSync(flowsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(flowsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const flows = [];
  for (const entry of entries) {
    const flowYamlPath = join(flowsDir, entry, 'flow.yaml');
    if (!existsSync(flowYamlPath)) continue;
    try {
      flows.push(loadFlowDefinition(flowYamlPath));
    } catch {
      // Skip unreadable flow
    }
  }
  return flows;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle Forge Studio read-only GET routes.
 *
 * Returns true if the route was handled (even on error), false for unknown URLs.
 * Never throws — all errors caught, returned as JSON.
 *
 * @param _req  - Incoming request (unused for GET routes; kept for signature parity with handleArchitect)
 * @param res   - Server response
 * @param ctx   - Minimal context: forgeRoot + logsRoot
 * @param rawUrl - Full URL including query string (e.g. '/api/runs?flow=forge-cycle')
 * @param method - HTTP method string
 */
export async function handleStudioRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);

  // ---- /api/runs (list) ---------------------------------------------------
  if (url === '/api/runs') {
    try {
      const qs = parseQuery(rawUrl);
      const flowFilter = qs.get('flow');
      let runs = listRuns(ctx.forgeRoot, Date.now());
      if (flowFilter) {
        runs = runs.filter((r) => r.flowId === flowFilter);
      }
      sendJson(res, 200, { runs });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/runs/<id>/phases/<node>/log  (must be matched before /api/runs/<id>) ----
  const phaseLogMatch = url.match(/^\/api\/runs\/([^/]+)\/phases\/([^/]+)\/log$/);
  if (phaseLogMatch) {
    const runId = decodeURIComponent(phaseLogMatch[1]);
    const nodeId = decodeURIComponent(phaseLogMatch[2]);

    if (!runId || !nodeId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>/phases/<node>/log' });
      return true;
    }

    try {
      const qs = parseQuery(rawUrl);
      const stderrOnly = qs.get('stderr') === '1';

      // The run id is the cycleId for non-planned runs
      const eventsPath = join(ctx.logsRoot, runId, 'events.jsonl');
      if (!existsSync(eventsPath)) {
        sendJson(res, 404, { error: 'no events.jsonl for run', runId });
        return true;
      }

      // Build node mapping to resolve phase → nodeId
      const nodeMapping = buildNodeMapping(ctx.forgeRoot);

      // Read events, filter to this node, classify, cap last 200
      const raw = readFileSync(eventsPath, 'utf8');
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line) as EventLogEntry); } catch { /* skip malformed */ }
      }

      const nodeEvents = events.filter((e) => nodeMapping.get(e.phase) === nodeId);

      let lines = nodeEvents.map(classifyEvent);
      if (stderrOnly) {
        lines = lines.filter((l) => l.kind === 'stderr');
      }

      // Cap last 200
      if (lines.length > 200) {
        lines = lines.slice(lines.length - 200);
      }

      sendJson(res, 200, { lines });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/runs/<id> (single run) ----------------------------------------
  const runIdMatch = url.match(/^\/api\/runs\/([^/]+)$/);
  if (runIdMatch) {
    const runId = decodeURIComponent(runIdMatch[1]);
    if (!runId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>' });
      return true;
    }
    try {
      const run = findRun(ctx.forgeRoot, runId);
      if (!run) {
        sendJson(res, 404, { error: 'run not found', runId });
        return true;
      }
      sendJson(res, 200, { run });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/studio/agents -------------------------------------------------
  if (url === '/api/studio/agents') {
    try {
      const skillsDir = join(resolve(ctx.forgeRoot), 'skills');
      const agents = listAgentDefinitions(skillsDir);
      sendJson(res, 200, { agents });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/studio/flows --------------------------------------------------
  if (url === '/api/studio/flows') {
    try {
      const flows = loadAllFlows(ctx.forgeRoot);
      sendJson(res, 200, { flows });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/studio/projects -----------------------------------------------
  if (url === '/api/studio/projects') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot);
      sendJson(res, 200, { projects });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/studio/kbs ----------------------------------------------------
  if (url === '/api/studio/kbs') {
    try {
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      sendJson(res, 200, { kbs });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // ---- /api/studio/catalog ------------------------------------------------
  if (url === '/api/studio/catalog') {
    try {
      const catalogPath = join(resolve(ctx.forgeRoot), 'studio', 'catalog.yaml');
      if (!existsSync(catalogPath)) {
        sendJson(res, 404, { error: 'catalog.yaml not found' });
        return true;
      }
      const catalog = loadCatalog(catalogPath);
      sendJson(res, 200, { catalog });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  return false;
}
