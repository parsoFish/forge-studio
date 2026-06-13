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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { listRuns, buildNodeMapping } from '../orchestrator/run-model.ts';
import type { Run } from '../orchestrator/run-model.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';
import {
  listAgentDefinitions,
  loadAgentDefinition,
  loadFlowDefinition,
  loadKbDescriptor,
  loadProjectsRegistry,
  loadCatalog,
  serializeAgentDefinition,
} from '../orchestrator/studio/registry.ts';
import type { AgentDefinition, FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE, validateAgent } from '../orchestrator/studio/validate.ts';
import { validateProjectConfig } from '../orchestrator/project-config.ts';

// ---------------------------------------------------------------------------
// Context surface needed by studio routes
// ---------------------------------------------------------------------------

export type StudioContext = {
  forgeRoot: string;
  logsRoot: string;
};

// ---------------------------------------------------------------------------
// Anti-CSRF + CORS helpers
// ---------------------------------------------------------------------------

/** Anti-CSRF sentinel. Any non-GET request must include this header.
 *  The value is a static sentinel — security comes from it being a
 *  non-safelisted header (requires a preflight), not from secrecy. */
export const CSRF_HEADER = 'x-forge-csrf';

/** Regex matching the forge-ui dev origin (any port on localhost/127.0.0.1). */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Returns the request's Origin if it matches the forge-ui dev-origin pattern,
 * otherwise returns 'null' (the literal string that signals "no access").
 * Used to tighten CORS beyond the old wildcard.
 */
export function allowedOrigin(req: IncomingMessage, _pattern?: RegExp): string {
  const origin = req.headers?.['origin'];
  if (typeof origin === 'string' && LOCAL_ORIGIN_RE.test(origin)) return origin;
  return 'null';
}

export function sendJson(res: ServerResponse, status: number, body: unknown, origin = 'null'): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'vary': 'origin',
  });
  res.end(payload);
}

/**
 * Strip absolute filesystem paths from error strings before sending them to
 * the browser. Prevents leaking the operator's directory layout.
 * Pattern: any token starting with / that looks like a path segment.
 */
function sanitizeError(err: unknown): string {
  return String(err).replace(/\/[^\s:,'"]+/g, '[path]');
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

  if (e.message === 'failure_classification' && e.metadata?.recoverable === true) {
    kind = 'retry';
  } else if (e.event_type === 'error') {
    kind = 'stderr';
  } else if (e.event_type === 'tool_use') {
    kind = 'tool';
  } else if (
    e.message === 'usage_delta' ||
    e.event_type === 'agent_heartbeat' ||
    (e.cost_usd !== undefined && e.cost_usd > 0 && e.event_type === 'log')
  ) {
    kind = 'cost';
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

function loadAllFlows(forgeRoot: string): FlowDefinition[] {
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

  const flows: FlowDefinition[] = [];
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
 * @param req    - Incoming request (used for origin check)
 * @param res   - Server response
 * @param ctx   - Minimal context: forgeRoot + logsRoot
 * @param rawUrl - Full URL including query string (e.g. '/api/runs?flow=forge-cycle')
 * @param method - HTTP method string
 */
export async function handleStudioRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- /api/runs (list) ---------------------------------------------------
  if (url === '/api/runs') {
    try {
      const qs = parseQuery(rawUrl);
      const flowFilter = qs.get('flow');
      let runs = listRuns(ctx.forgeRoot, Date.now());
      if (flowFilter) {
        runs = runs.filter((r) => r.flowId === flowFilter);
      }
      sendJson(res, 200, { runs }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/<id>/phases/<node>/log  (must be matched before /api/runs/<id>) ----
  const phaseLogMatch = url.match(/^\/api\/runs\/([^/]+)\/phases\/([^/]+)\/log$/);
  if (phaseLogMatch) {
    const runId = decodeURIComponent(phaseLogMatch[1]);
    const nodeId = decodeURIComponent(phaseLogMatch[2]);

    if (!runId || !nodeId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>/phases/<node>/log' }, origin);
      return true;
    }

    try {
      const qs = parseQuery(rawUrl);
      const stderrOnly = qs.get('stderr') === '1';

      // Guard against path traversal via a crafted runId.
      const safeLogsBase = resolve(ctx.logsRoot);
      const eventsPath = resolve(safeLogsBase, runId, 'events.jsonl');
      if (!eventsPath.startsWith(safeLogsBase + sep)) {
        sendJson(res, 400, { error: 'invalid run id' }, origin);
        return true;
      }
      if (!existsSync(eventsPath)) {
        sendJson(res, 404, { error: 'no events.jsonl for run', runId }, origin);
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

      sendJson(res, 200, { lines }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/<id> (single run) ----------------------------------------
  const runIdMatch = url.match(/^\/api\/runs\/([^/]+)$/);
  if (runIdMatch) {
    const runId = decodeURIComponent(runIdMatch[1]);
    if (!runId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>' }, origin);
      return true;
    }
    try {
      const run = findRun(ctx.forgeRoot, runId);
      if (!run) {
        sendJson(res, 404, { error: 'run not found' }, origin);
        return true;
      }
      sendJson(res, 200, { run }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/agents -------------------------------------------------
  if (url === '/api/studio/agents') {
    try {
      const skillsDir = join(resolve(ctx.forgeRoot), 'skills');
      const agents = listAgentDefinitions(skillsDir);
      sendJson(res, 200, { agents }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/flows --------------------------------------------------
  if (url === '/api/studio/flows') {
    try {
      const flows = loadAllFlows(ctx.forgeRoot);
      sendJson(res, 200, { flows }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects -----------------------------------------------
  if (url === '/api/studio/projects') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot);
      sendJson(res, 200, { projects }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/kbs ----------------------------------------------------
  if (url === '/api/studio/kbs') {
    try {
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      sendJson(res, 200, { kbs }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/catalog ------------------------------------------------
  if (url === '/api/studio/catalog') {
    try {
      const catalogPath = join(resolve(ctx.forgeRoot), 'studio', 'catalog.yaml');
      if (!existsSync(catalogPath)) {
        sendJson(res, 404, { error: 'catalog.yaml not found' }, origin);
        return true;
      }
      const catalog = loadCatalog(catalogPath);
      sendJson(res, 200, { catalog }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Write routes (M2-2) — PUT /api/studio/agents/:slug, PUT /api/studio/projects/:id
// ---------------------------------------------------------------------------

/**
 * Handle Forge Studio write (PUT) routes.
 *
 * Returns true iff the route was handled (even on error). Returns false for
 * unrecognised URLs so the caller can chain to the next handler.
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 *
 * Security invariants (see self-audit in implementation plan):
 *   1. Slug/id validated against SLUG_RE BEFORE any fs path construction.
 *   2. Resolved fs paths prefix-guarded to their containing directory.
 *   3. Load-merge-write pattern: never clobbers preserved fields.
 *   4. validateAgent / validateProjectConfig block writes on error-level findings.
 */
export async function handleStudioWriteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'PUT') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- PUT /api/studio/agents/:slug ----------------------------------------
  const agentMatch = url.match(/^\/api\/studio\/agents\/([^/]+)$/);
  if (agentMatch) {
    try {
      const slug = decodeURIComponent(agentMatch[1]);

      // 1. Validate slug before any fs operation (blocks path traversal)
      if (!SLUG_RE.test(slug)) {
        sendJson(res, 400, { error: 'invalid slug — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }

      // 2. Resolve and prefix-guard the SKILL.md path
      const skillsBase = resolve(ctx.forgeRoot, 'skills');
      const skillMdPath = resolve(skillsBase, slug, 'SKILL.md');
      if (!skillMdPath.startsWith(skillsBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      // 3. Parse request body
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 4. Load existing def or scaffold minimal one
      let existing: AgentDefinition | null = null;
      if (existsSync(skillMdPath)) {
        try {
          existing = loadAgentDefinition(skillMdPath);
        } catch (err) {
          sendJson(res, 500, { error: sanitizeError(err) }, origin);
          return true;
        }
      }

      // 5. Build merged definition: preserve slug/phase/surface/allowedTools/disallowedTools/budgets
      const name = typeof b['name'] === 'string' ? b['name'] : existing?.name ?? slug;
      const purpose = typeof b['purpose'] === 'string' ? b['purpose'] : existing?.purpose ?? '';
      // UI sends `process` for the body field
      const body_text = typeof b['process'] === 'string' ? b['process'] : existing?.body ?? '';
      const interactivity = typeof b['interactivity'] === 'string' ? b['interactivity'] : existing?.interactivity ?? '';
      const brainAccess = (['mandatory', 'advisory', 'none'] as const).includes(
        b['brainAccess'] as 'mandatory' | 'advisory' | 'none',
      )
        ? (b['brainAccess'] as 'mandatory' | 'advisory' | 'none')
        : existing?.brainAccess ?? 'none';

      // Composition: merge from body, fall back to existing
      const rawComp = b['composition'];
      const compIn: Record<string, unknown> =
        rawComp !== null && typeof rawComp === 'object' && !Array.isArray(rawComp)
          ? (rawComp as Record<string, unknown>)
          : {};
      const composition = {
        skills: Array.isArray(compIn['skills']) ? (compIn['skills'] as string[]) : (existing?.composition.skills ?? []),
        tools: Array.isArray(compIn['tools']) ? (compIn['tools'] as string[]) : (existing?.composition.tools ?? []),
        mcps: Array.isArray(compIn['mcps']) ? (compIn['mcps'] as string[]) : (existing?.composition.mcps ?? []),
        hooks: Array.isArray(compIn['hooks']) ? (compIn['hooks'] as string[]) : (existing?.composition.hooks ?? []),
      };

      // Runtime: merge from body, fall back to existing
      const rawRt = b['runtime'];
      const rtIn: Record<string, unknown> =
        rawRt !== null && typeof rawRt === 'object' && !Array.isArray(rawRt)
          ? (rawRt as Record<string, unknown>)
          : {};
      const runtime = {
        sdk: typeof rtIn['sdk'] === 'string' ? rtIn['sdk'] : (existing?.runtime.sdk ?? 'claude-code'),
        strategy: (['fixed', 'range'] as const).includes(rtIn['strategy'] as 'fixed' | 'range')
          ? (rtIn['strategy'] as 'fixed' | 'range')
          : (existing?.runtime.strategy ?? 'fixed'),
        model: typeof rtIn['model'] === 'string' ? rtIn['model'] : existing?.runtime.model,
        range: Array.isArray(rtIn['range']) ? (rtIn['range'] as string[]) : existing?.runtime.range,
        subagentModel: typeof rtIn['subagentModel'] === 'string' ? rtIn['subagentModel'] : existing?.runtime.subagentModel,
      };

      const merged: AgentDefinition = {
        slug,
        name,
        description: existing?.description ?? name,
        phase: existing?.phase,
        surface: existing?.surface,
        purpose,
        composition,
        runtime,
        brainAccess,
        interactivity,
        budgets: existing?.budgets ?? {},
        allowedTools: existing?.allowedTools ?? [],
        disallowedTools: existing?.disallowedTools ?? [],
        body: body_text,
        path: skillMdPath,
      };

      // 6. Validate — reject on any error-level finding
      const findings = validateAgent(merged);
      const hasErrors = findings.some((f) => f.level === 'error');
      if (hasErrors) {
        sendJson(res, 400, { error: 'validation failed', findings }, origin);
        return true;
      }

      // 7. Serialize and write
      const serialized = serializeAgentDefinition(merged);
      const skillDir = resolve(skillsBase, slug);
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true });
      }
      writeFileSync(skillMdPath, serialized, 'utf8');

      const flagFindings = findings.filter((f) => f.level === 'flag');
      sendJson(res, 200, { ok: true, slug, findings: flagFindings }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- PUT /api/studio/projects/:id ----------------------------------------
  const projectMatch = url.match(/^\/api\/studio\/projects\/([^/]+)$/);
  if (projectMatch) {
    try {
      const id = decodeURIComponent(projectMatch[1]);

      // 1. Validate id before any fs operation
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }

      // 2. Resolve the project path from studio/projects.yaml
      const projectsYamlPath = join(resolve(ctx.forgeRoot), 'studio', 'projects.yaml');
      if (!existsSync(projectsYamlPath)) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      let registry;
      try {
        // Note: projectRef.path is operator-authored config from projects.yaml.
        // It is now guarded below against escaping the forge root.
        registry = loadProjectsRegistry(projectsYamlPath);
      } catch {
        sendJson(res, 500, { error: 'failed to load projects registry' }, origin);
        return true;
      }
      const projectRef = registry.projects.find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }

      // 3. Resolve the project.json path and prefix-guard it
      const projectRoot = resolve(ctx.forgeRoot, projectRef.path);
      // Guard: projectRef.path from projects.yaml must not escape the forge root.
      // Stops an absolute or `..`-containing path writing outside the repo.
      if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
        sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
        return true;
      }
      const projectJsonPath = resolve(projectRoot, '.forge', 'project.json');
      if (!projectJsonPath.startsWith(projectRoot + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      // 4. Parse request body
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // 5. Load existing project.json (if present) and merge M2 fields over it
      let existingRaw: Record<string, unknown> = {};
      if (existsSync(projectJsonPath)) {
        try {
          existingRaw = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
          sendJson(res, 500, { error: sanitizeError(err) }, origin);
          return true;
        }
      }

      // Merge: only override M2 fields from body; preserve all other fields
      const merged: Record<string, unknown> = { ...existingRaw };
      if (typeof b['northStar'] === 'string') merged['northStar'] = b['northStar'];
      if (typeof b['instructions'] === 'string') merged['instructions'] = b['instructions'];
      if (Array.isArray(b['demoProcess'])) merged['demoProcess'] = b['demoProcess'];
      if (Array.isArray(b['skills'])) merged['skills'] = b['skills'];
      // kb can be string or null
      if (b['kb'] !== undefined) merged['kb'] = b['kb'];

      // 6. Validate the merged config (throws on invalid)
      try {
        validateProjectConfig(merged);
      } catch (err) {
        sendJson(res, 400, { error: String(err) }, origin);
        return true;
      }

      // 7. Write back (pretty, 2-space)
      const forgeDir = resolve(projectRoot, '.forge');
      if (!existsSync(forgeDir)) {
        mkdirSync(forgeDir, { recursive: true });
      }
      writeFileSync(projectJsonPath, JSON.stringify(merged, null, 2), 'utf8');

      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Read and parse the JSON request body. Used by write routes.
 * Caps at MAX_BODY_BYTES; destroys the socket and rejects on oversize.
 * Shared helper (mirrors readJson in ui-bridge.ts).
 */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
}
