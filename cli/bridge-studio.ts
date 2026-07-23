/**
 * Forge Studio bridge routes (M1-2, ADR-027/028).
 *
 * Boolean-returning route module plugged into handleHttp after handleReflect.
 * All routes are read-only GET endpoints; write routes land in M2.
 * POST run/gate routes (M3-4) live in bridge-studio-runs.ts.
 *
 * Routes:
 *   GET /api/runs                           → { runs: Run[] }
 *   GET /api/runs?flow=<id>                 → { runs: Run[] } (filtered)
 *   GET /api/runs/<id>                      → { run: Run }
 *   GET /api/runs/<id>/phases/<node>/log    → { lines } (stderr=1 to filter)
 *   GET /api/studio/agents                  → { agents: (AgentDefinition & { capability: AgentCapabilityDescriptor })[] }
 *   GET /api/studio/flows                   → { flows: FlowDefinition[] }
 *   GET /api/studio/projects                → { projects }
 *   GET /api/studio/projects/attention      → { attention: ProjectAttentionItem[] } (R4-11-F4)
 *   GET /api/studio/catalog                 → catalog content
 *
 * KB routes (GET + POST) live in bridge-studio-kbs.ts.
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { runPreflight } from './preflight.ts';
import { classifyClause } from './preflight-resolve.ts';
import { hasPendingStudioChanges, STUDIO_BRANCH } from '../orchestrator/project-repo-tx.ts';
import { listRuns, buildNodeMapping, buildAgentSlugToNodeId } from '../orchestrator/run-model.ts';
import { eventToNodeId } from '../orchestrator/run-model-derive.ts';
import { listPlannedInitiatives } from '../orchestrator/planned-initiatives.ts';
import { checkInitiativeDeps } from '../orchestrator/scheduler.ts';
import type { Run } from '../orchestrator/run-model.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';
import {
  listAgentDefinitions,
  listStarterAgents,
  loadStarterFlow,
  loadFlowDefinition,
  discoverProjects,
  loadCatalog,
  listDemoElements,
  listPlainSkills,
} from '../orchestrator/studio/registry.ts';
import { skillsDir as toSkillsDir } from '../orchestrator/skill-path.ts';
import { agentCapabilityDescriptor } from '../orchestrator/studio/derive.ts';
import type { FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { isSdkAvailable } from '../loops/_adapters/registry.ts';
import { parseManifest } from '../orchestrator/manifest.ts';
import { readAgentInstructionsFile } from '../orchestrator/project-config.ts';
import { parseWorkItem } from '../orchestrator/work-item.ts';
import type { QueueState } from '../orchestrator/queue.ts';
import { getPaths } from '../orchestrator/queue.ts';

// ---------------------------------------------------------------------------
// Context surface needed by studio routes
// ---------------------------------------------------------------------------

export type StudioContext = {
  forgeRoot: string;
  logsRoot: string;
};

// Safe-ID guard: blocks path traversal in run/gate IDs
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

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
 * Exported so alias catch-blocks in ui-bridge.ts can reuse it (M2).
 */
export function sanitizeError(err: unknown): string {
  return String(err).replace(/\/[^\s:,'"]+/g, '[path]');
}

/** Parse the query-string from a URL string (e.g. '/api/runs?flow=forge-cycle'). */
export function parseQuery(rawUrl: string): URLSearchParams {
  const idx = rawUrl.indexOf('?');
  return new URLSearchParams(idx >= 0 ? rawUrl.slice(idx + 1) : '');
}

/** Strip the query-string from a URL string. */
export function pathOnly(rawUrl: string): string {
  const idx = rawUrl.indexOf('?');
  return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Read and parse the JSON request body. Used by write routes.
 * Caps at MAX_BODY_BYTES; destroys the socket and rejects on oversize.
 * Shared helper (mirrors readJson in ui-bridge.ts).
 */
export function readJson(req: IncomingMessage): Promise<unknown> {
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

// ---------------------------------------------------------------------------
// Phase log line derivation (design §7)
// ---------------------------------------------------------------------------

type LogLineKind = 'info' | 'tool' | 'cost' | 'stderr' | 'retry' | 'reasoning';

type LogLine = { at: string; kind: LogLineKind; text: string; detail?: string };

/**
 * The expandable detail behind a one-line log entry (M3): the agent's actual
 * reasoning text, a tool's inputs, an error reason, and any remaining metadata —
 * so the operator can dig into what an agent actually did, not just a summary.
 */
function eventDetail(e: EventLogEntry): string | undefined {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  // Reasoning / free text: the agent's thinking stream.
  for (const key of ['text', 'reasoning', 'message'] as const) {
    const v = m[key];
    if (typeof v === 'string' && v.trim() && v.trim() !== e.message) { lines.push(v.trim()); break; }
  }
  if (e.event_type === 'tool_use') {
    if (typeof m.tool_name === 'string') lines.push(`tool: ${m.tool_name}`);
    if (m.input_summary !== undefined) {
      lines.push(`input: ${typeof m.input_summary === 'string' ? m.input_summary : JSON.stringify(m.input_summary)}`);
    }
  }
  if (typeof m.reason === 'string') lines.push(`reason: ${m.reason}`);
  if (typeof m.runner_error === 'string' && m.runner_error) lines.push(`error: ${m.runner_error}`);
  // Any remaining metadata, compactly, for full transparency.
  const shown = new Set(['text', 'reasoning', 'message', 'tool_name', 'input_summary', 'reason', 'runner_error', 'kind', 'work_item_id']);
  const rest = Object.fromEntries(Object.entries(m).filter(([k]) => !shown.has(k)));
  if (Object.keys(rest).length > 0) lines.push(JSON.stringify(rest));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

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
  } else if (e.event_type === 'log' && e.metadata?.kind === 'reasoning') {
    kind = 'reasoning'; // the agent's thinking stream (#11)
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

  return { at: e.started_at, kind, text: parts.join(' '), detail: eventDetail(e) };
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
// Projects with merged project.json data
// ---------------------------------------------------------------------------

type ProjectWithMeta = {
  id: string;
  name: string;
  path: string;
  northStar?: string;
  kb?: string;
  instructions?: string;
  /** Where `instructions` came from: the agent-instruction file (single source —
   *  `AGENTS.md`, or legacy `CLAUDE.md`) or the legacy project.json field. Drives
   *  the read-only (file-bound) vs editable (json) UI binding. */
  instructionsSource?: 'AGENTS.md' | 'CLAUDE.md' | 'project.json';
  skills?: string[];
  demoProcess?: Array<{ kind: string; text: string; element?: string }>;
  /** True when a demo-builder run has locked a reproducible demo into the repo
   *  (`.forge/demo/demo.lock.json`) — drives the "update the demo" entry + the
   *  locked-demo indicator on the project page. */
  hasLockedDemo?: boolean;
};

function loadProjectsWithMeta(forgeRoot: string): ProjectWithMeta[] {
  // B1: projects are auto-discovered from disk — scan `<projectsDir>/*` rather
  // than reading a registry file. All discovered dirs are listed (a
  // half-onboarded dir without `.forge/project.json` still surfaces, with
  // id-as-name defaults, so the operator can SEE it and finish onboarding —
  // `forge studio lint` warns about the missing contract file separately).
  const projectsDir = resolveProjectsDir(resolve(forgeRoot), loadConfig());
  const discovered = discoverProjects(projectsDir, forgeRoot);

  return discovered.map((ref) => {
    const result: ProjectWithMeta = { id: ref.id, name: ref.id, path: ref.path };
    // Instructions are single-sourced from the project's AGENTS.md (Stage A):
    // when it exists, its content IS the instructions and the UI binds read-only
    // to it. Read it BEFORE the no-config early-return — an AGENTS.md can precede
    // a full `.forge/project.json` (so a half-onboarded project still surfaces it).
    const agentFile = readAgentInstructionsFile(ref.absPath);
    if (agentFile) {
      result.instructions = agentFile.content;
      result.instructionsSource = agentFile.file as 'AGENTS.md' | 'CLAUDE.md';
    }
    // Locked-demo state (read regardless of project.json) — the demo-builder lock.
    result.hasLockedDemo = existsSync(join(ref.absPath, '.forge', 'demo', 'demo.lock.json'));
    if (!ref.hasConfig) return result;
    const projectJsonPath = join(ref.absPath, '.forge', 'project.json');
    try {
      const raw = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as Record<string, unknown>;
      if (typeof raw.name === 'string' && raw.name.trim()) result.name = raw.name.trim();
      if (typeof raw.northStar === 'string') result.northStar = raw.northStar;
      if (typeof raw.kb === 'string') result.kb = raw.kb;
      // Only fall back to the legacy project.json `instructions` field when no
      // agent-instruction file exists (the agent file always wins — single source).
      if (!agentFile && typeof raw.instructions === 'string') {
        result.instructions = raw.instructions;
        result.instructionsSource = 'project.json';
      }
      if (Array.isArray(raw.skills) && raw.skills.every((s) => typeof s === 'string')) {
        result.skills = raw.skills as string[];
      }
      // Surface the typed demo steps so the editor + ContractReadiness reflect
      // a persisted demo. CARRY the optional `element` (the library element-kind
      // a step composes from) — without it the UI can't show per-element controls
      // and a save round-trip would silently drop the binding.
      if (Array.isArray(raw.demoProcess)) {
        result.demoProcess = (raw.demoProcess as Array<Record<string, unknown>>)
          .filter((s) => s && typeof s.kind === 'string' && typeof s.text === 'string')
          .map((s) => ({
            kind: s.kind as string,
            text: s.text as string,
            ...(typeof s.element === 'string' && s.element ? { element: s.element as string } : {}),
          }));
      }
    } catch {
      // ignore unreadable project.json
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
/** Read a preflight-fix run's terminal state from its event log. Mirrors
 *  readBrainFixState — a local log reader so the bridge needn't import the
 *  SDK-laden runner module. */
function readPreflightFixState(
  forgeRoot: string,
  runId: string,
): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean } {
  const evPath = join(forgeRoot, '_logs', `_preflight-fix-${runId}`, 'events.jsonl');
  if (!existsSync(evPath)) return { state: 'running', cleared: false };
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('preflight-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      return { state: cleared ? 'cleared' : 'not-cleared', cleared };
    }
    if (ev.event_type === 'error' || ev.message === 'preflight-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

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
        // Match by lineage, not just current flowId: a run whose manifest was
        // repointed mid-saga (architect→develop hand-off) stays visible on
        // every flow page in its lineage. Filtering on flowId alone made the
        // selected run's card vanish from the rail on the next
        // cycle-list-changed tick — selection appeared to snap to the top run.
        runs = runs.filter((r) => r.flowId === flowFilter || (r.flowLineage ?? []).includes(flowFilter));
      }
      sendJson(res, 200, { runs }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/planned (develop-able initiatives) -----------------------
  // Stage C: the forge-develop kickoff surface (kind: initiative-select). MUST
  // precede /api/runs/<id> below (else "planned" parses as a run id).
  if (url === '/api/runs/planned') {
    try {
      const planned = listPlannedInitiatives(join(resolve(ctx.forgeRoot), '_queue'));
      sendJson(res, 200, { planned }, origin);
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
      const wiId = qs.get('wiId') ?? '';

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

      // Build node mapping to resolve phase → nodeId. R2-01-F4: also build the
      // agent-slug map so a generic-agent node's events (phase:'orchestrator'
      // + metadata.agent_slug — nodeMapping.get('orchestrator') is null) are
      // resolved via eventToNodeId instead of being silently dropped.
      const nodeMapping = buildNodeMapping(ctx.forgeRoot);
      const agentSlugToNodeId = buildAgentSlugToNodeId(ctx.forgeRoot);

      // Read events, filter to this node, classify, cap last 200
      const raw = readFileSync(eventsPath, 'utf8');
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line) as EventLogEntry); } catch { /* skip malformed */ }
      }

      let nodeEvents = events.filter((e) => eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata) === nodeId);
      // Per-WI scoping (#11): when a WI hex is clicked, show ONLY that WI's own
      // events — each fanOut dev agent has an independent stream, not the pooled
      // dev-loop log. Events already carry metadata.work_item_id.
      if (wiId) {
        nodeEvents = nodeEvents.filter((e) => e.metadata?.work_item_id === wiId);
      }

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
      const skillsDir = toSkillsDir(resolve(ctx.forgeRoot));
      const agents = listAgentDefinitions(skillsDir);
      // R2-02-F1: thread the server-computed capability descriptor onto each
      // agent's wire payload — no capability fact may exist only in UI code.
      sendJson(
        res,
        200,
        { agents: agents.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a) })) },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/starters -----------------------------------------------
  // The curated OOTB starter agents (ADR-033) the New-Agent picker offers.
  // Same capability-descriptor threading as /api/studio/agents (R2-02-F1) —
  // starters carry a real AgentDefinition the builder reads via the same
  // client parser, so the fact must be present here too.
  if (url === '/api/studio/starters') {
    try {
      const starters = listStarterAgents(ctx.forgeRoot);
      const flow = loadStarterFlow(ctx.forgeRoot);
      sendJson(
        res,
        200,
        { starters: starters.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a) })), flow },
        origin,
      );
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

  // ---- /api/studio/flows/:id (single flow) --------------------------------
  const flowGetMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (flowGetMatch) {
    try {
      const id = decodeURIComponent(flowGetMatch[1]);

      // Slug-guard blocks path traversal before any fs path construction
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid flow id' }, origin);
        return true;
      }

      const flowsBase = resolve(ctx.forgeRoot, 'studio', 'flows');
      const flowYamlPath = resolve(flowsBase, id, 'flow.yaml');
      if (!flowYamlPath.startsWith(flowsBase + sep)) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }

      if (!existsSync(flowYamlPath)) {
        sendJson(res, 404, { error: 'unknown flow' }, origin);
        return true;
      }

      const flow = loadFlowDefinition(flowYamlPath);
      sendJson(res, 200, { flow }, origin);
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

  // ---- /api/studio/projects/attention (R4-11-F4) --------------------------
  // Cross-project "which projects need my attention" aggregate for the
  // library landing strip. One best-effort entry per registered project —
  // a single project's read failure never sinks the whole aggregate.
  if (url === '/api/studio/projects/attention') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot);
      const attention = projects.map((p) => buildProjectAttention(p.id, p.name, ctx.forgeRoot, ctx.logsRoot));
      sendJson(res, 200, { attention }, origin);
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
      // Reconcile the static yaml `available` flag with the live adapter registry.
      // An SDK is selectable iff a registered adapter reports available — this is
      // the source of truth. When a real Codex/Gemini adapter is registered later,
      // isSdkAvailable flips its flag to true automatically.
      const reconciledSdks = catalog.sdks.map((sdk) => ({
        ...sdk,
        available: isSdkAvailable(sdk.id),
      }));
      // A1: surface the curated community skills as the agent-builder Skills
      // library (the palette reads catalog.skills) so skills are draggable too.
      // R3-01-F2: union in filesystem plain skills (SKILL.md, no runtime block)
      // — e.g. one authored via `/skills/new` — so it appears in the palette on
      // the next fetch with no bridge restart (known-gaps §4.11). Community
      // entries win on an id collision (they carry provenance/stars metadata).
      const community = (catalog.communitySkills ?? []).map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
      const seen = new Set(community.map((s) => s.id));
      const local = listPlainSkills(ctx.forgeRoot).filter((s) => !seen.has(s.id));
      const skills = [...community, ...local];
      sendJson(res, 200, { catalog: { ...catalog, sdks: reconciledSdks, skills } }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/demo-elements ------------------------------------------
  // The forge demo-element library (skill-creating skills) — the palette of demo
  // components an operator composes a demoProcess from. Body (the generator
  // prompt) is omitted; the picker needs only the metadata.
  if (url === '/api/studio/demo-elements') {
    try {
      const elements = listDemoElements(ctx.forgeRoot).map((e) => ({
        id: e.id, name: e.name, phase: e.phase, description: e.description, configHint: e.configHint,
      }));
      sendJson(res, 200, { elements }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/:id/preflight ---------------------------------
  const preflightMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight$/);
  if (preflightMatch) {
    try {
      const id = decodeURIComponent(preflightMatch[1]);
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      // B1: resolve the project by disk scan rather than the projects.yaml
      // registry. A dir without `.forge/project.json` still preflights (the
      // operator runs preflight to learn WHY it is not yet contract-green).
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      const projectRoot = projectRef.absPath;
      if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
        sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
        return true;
      }
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const clauses = report.clauses.map((c) => {
        const cls = classifyClause(c);
        return {
          id: c.clause,
          title: c.title,
          hard: c.hard,
          pass: c.pass,
          detail: c.detail,
          resolution: cls.resolution,
          route: cls.route,
          fixHint: cls.fixHint,
        };
      });
      sendJson(res, 200, { clauses, ready: report.ok }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/:id/repo-status (R1-2) — pending studio changes -
  const repoStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/repo-status$/);
  if (repoStatusMatch) {
    try {
      const id = decodeURIComponent(repoStatusMatch[1]);
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      sendJson(res, 200, { pending: hasPendingStudioChanges(projectRef.absPath), branch: STUDIO_BRANCH }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/:id/preflight/fix-agent/:runId (Stage D) -------
  const pfStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-agent\/([^/]+)$/);
  if (pfStatusMatch) {
    const runId = decodeURIComponent(pfStatusMatch[2]);
    if (!SAFE_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid run id' }, origin);
      return true;
    }
    sendJson(res, 200, { ok: true, runId, ...readPreflightFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  // ---- /api/studio/projects/:id/roadmap -----------------------------------
  const roadmapMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/roadmap$/);
  if (roadmapMatch) {
    try {
      const id = decodeURIComponent(roadmapMatch[1]);
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const roadmap = buildProjectRoadmap(id, ctx.forgeRoot, ctx.logsRoot);
      sendJson(res, 200, { roadmap }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Roadmap read model (S6 DEC-3 / per-project Roadmap tab)
// ---------------------------------------------------------------------------

export type RoadmapWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
};

export type RoadmapInitiative = {
  initiativeId: string;
  title: string;
  status: QueueState;
  dependsOnInitiatives: string[];
  /**
   * plan-everything-before-kickoff: whether this initiative's build deps are
   * satisfied yet (reuses the scheduler's own `checkInitiativeDeps` gate —
   * only meaningful while `status === 'pending'`; other states default to
   * ready/unblocked since the gate only ever applies at pending-claim time).
   */
  ready: boolean;
  blockedBy: string[];
  /**
   * R4-11-F2: present once the initiative has been decomposed (a WI snapshot
   * exists) — regardless of queue status. This is the "planned" fact the
   * roadmap's per-initiative Plan trigger + blocked-until-planned lock read;
   * a `pending` initiative with no WI snapshot yet is unplanned even though
   * it is otherwise a normal, readable queue entry.
   */
  workItems?: RoadmapWorkItem[];
};

export type ProjectRoadmap = {
  projectId: string;
  initiatives: RoadmapInitiative[];
};

/** One manifest owned by a project, resolved during a queue-wide scan. */
type ScannedManifestEntry = {
  initId: string;
  status: QueueState;
  /** Bare filename (e.g. `INIT-1.md`) — what `checkInitiativeDeps` expects. */
  file: string;
  manifest: ReturnType<typeof parseManifest>;
};

/**
 * Scan every queue-state dir for manifests owned by `projectId`, in the same
 * first-match-wins precedence ui-bridge/roadmap have always used (in-flight →
 * ready-for-review → merged → done → failed → pending). Shared by
 * `buildProjectRoadmap` and `buildProjectAttention` (R4-11-F4) so there is
 * exactly one manifest-ownership scan, not two.
 */
function scanProjectManifests(projectId: string, forgeRoot: string): ScannedManifestEntry[] {
  const queuePaths = getPaths(join(resolve(forgeRoot), '_queue'));
  const stateDirs: Array<[string, QueueState]> = [
    [queuePaths.inFlight, 'in-flight'],
    [queuePaths.readyForReview, 'ready-for-review'],
    // R4-11-F1: `merged` — the brief pass-through between a confirmed merge
    // and its promotion to `done/` in the same sweep.
    [queuePaths.merged, 'merged'],
    [queuePaths.done, 'done'],
    [queuePaths.failed, 'failed'],
    [queuePaths.pending, 'pending'],
  ];

  const seen = new Set<string>();
  const entries: ScannedManifestEntry[] = [];

  for (const [dir, status] of stateDirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      const initId = file.replace(/\.md$/, '');
      if (seen.has(initId)) continue;
      const fp = join(dir, file);
      let manifest: ReturnType<typeof parseManifest>;
      try {
        manifest = parseManifest(readFileSync(fp, 'utf8'));
      } catch {
        continue;
      }
      if (manifest.project !== projectId) continue;
      seen.add(initId);
      entries.push({ initId, status, file, manifest });
    }
  }

  return entries;
}

/**
 * Build a read-only roadmap for a project by scanning all queue dirs for
 * manifests owned by this project. For each initiative, `workItems` reads
 * WI-*.md from the work-items-snapshot in `_logs/` (or the live worktree)
 * regardless of queue status — decomposition is a fact about the WI
 * snapshot, not a function of which queue dir the manifest sits in
 * (R4-11-F2: a pending initiative can already be planned; the roadmap's
 * Plan-trigger lock reads `workItems === undefined` as "unplanned").
 *
 * Mirrors the queueStatusFor pattern from cli/ui-bridge.ts:195.
 */
function buildProjectRoadmap(projectId: string, forgeRoot: string, logsRoot: string): ProjectRoadmap {
  const queuePaths = getPaths(join(resolve(forgeRoot), '_queue'));
  const entries = scanProjectManifests(projectId, forgeRoot);

  const initiatives: RoadmapInitiative[] = entries.map(({ initId, status, file, manifest }) => {
    // Extract title from manifest body: first non-empty heading line, or fall back to id.
    const titleMatch = manifest.body.match(/^##?\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : initId;

    const items = readWorkItemsForInitiative(initId, manifest.cycle_id ?? null, forgeRoot, logsRoot);
    const workItems = items.length > 0 ? items : undefined;

    const blockedBy = checkInitiativeDeps(file, queuePaths);

    return {
      initiativeId: initId,
      title,
      status,
      dependsOnInitiatives: manifest.depends_on_initiatives ?? [],
      ready: blockedBy.length === 0,
      blockedBy,
      ...(workItems !== undefined ? { workItems } : {}),
    };
  });

  return { projectId, initiatives };
}

// ---------------------------------------------------------------------------
// Cross-project attention aggregate (R4-11-F4)
// ---------------------------------------------------------------------------

export type ProjectAttentionItem = {
  projectId: string;
  name: string;
  /** Link target for the strip item — the project's roadmap tab. */
  link: string;
  /** Count of this project's manifests in `_queue/pending/`. */
  planned: number;
  /** Count in `_queue/in-flight/`. */
  inFlight: number;
  /** Count in `_queue/ready-for-review/` — the `gated` RunStatus (an
   *  operator verdict is pending). */
  gated: number;
  /** Count in `_queue/merged/` (R4-11-F1 transient state). */
  merged: number;
  /** Count of initiatives whose latest `plan.completeness` event (R4-05-F6)
   *  has `flagged: true`. */
  flagged: number;
};

/** Queue states an attention strip cares about — done/failed are terminal
 *  and carry nothing left for the operator to act on. */
const ATTENTION_BEARING_STATES: ReadonlySet<QueueState> = new Set([
  'pending',
  'in-flight',
  'ready-for-review',
  'merged',
]);

/**
 * Build the cross-project attention summary for one project. Reuses the same
 * manifest-ownership scan as `buildProjectRoadmap` — no second queue scan.
 * Best-effort throughout: an unreadable manifest or missing event log never
 * throws, it just doesn't count toward that initiative.
 */
function buildProjectAttention(
  projectId: string,
  name: string,
  forgeRoot: string,
  logsRoot: string,
): ProjectAttentionItem {
  const entries = scanProjectManifests(projectId, forgeRoot);

  let planned = 0;
  let inFlight = 0;
  let gated = 0;
  let merged = 0;
  let flagged = 0;

  for (const { initId, status, manifest } of entries) {
    if (!ATTENTION_BEARING_STATES.has(status)) continue;

    if (status === 'pending') planned += 1;
    else if (status === 'in-flight') inFlight += 1;
    else if (status === 'ready-for-review') gated += 1;
    else if (status === 'merged') merged += 1;

    if (isCompletenessFlagged(initId, manifest.cycle_id ?? null, logsRoot)) {
      flagged += 1;
    }
  }

  return { projectId, name, link: `/projects/${projectId}`, planned, inFlight, gated, merged, flagged };
}

/**
 * Whether an initiative's LATEST `plan.completeness` event (R4-05-F6, emitted
 * by orchestrator/phases/project-manager.ts on the PM pass's success path)
 * has `metadata.flagged === true`.
 *
 * Bound: exactly ONE file read per initiative — `_logs/<cycleId>/events.jsonl`
 * — scanned line-by-line from the end (mirrors readPreflightFixState's
 * reverse-scan-for-latest-event pattern above) so a re-decomposition's newer
 * event is the one that counts, without needing a second full-file pass.
 * Best-effort: any missing cycle/file/malformed line is treated as
 * "not flagged" rather than thrown — never sinks the whole aggregate.
 */
function isCompletenessFlagged(
  initId: string,
  cycleIdFromManifest: string | null,
  logsRoot: string,
): boolean {
  const logsRootAbs = resolve(logsRoot);
  const cycleId = cycleIdFromManifest ?? discoverCycleIdFromLogs(logsRootAbs, initId);
  if (!cycleId) return false;
  const evPath = join(logsRootAbs, cycleId, 'events.jsonl');
  if (!existsSync(evPath)) return false;
  let raw: string;
  try {
    raw = readFileSync(evPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { message?: string; metadata?: { flagged?: boolean } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.message === 'plan.completeness') {
      return ev.metadata?.flagged === true;
    }
  }
  return false;
}

/**
 * Read work items for an initiative, independent of its queue status. Tries
 * the work-items-snapshot in `_logs/<cycleId>/` first (reliable for
 * done/in-flight); falls back to the live worktree spec if the snapshot
 * isn't present yet. Always returns an array — `[]` (never `undefined`)
 * when nothing is found, so callers decide what an empty result means.
 */
function readWorkItemsForInitiative(
  initId: string,
  cycleId: string | null,
  forgeRoot: string,
  logsRoot: string,
): RoadmapWorkItem[] {
  const logsRootAbs = resolve(logsRoot);
  const forgeRootAbs = resolve(forgeRoot);

  // 1. Snapshot path (post-PM, reliable for done cycles).
  if (cycleId) {
    const snapshotDir = join(logsRootAbs, cycleId, 'work-items-snapshot');
    const items = tryReadWorkItemDir(snapshotDir);
    if (items !== null) return items;
  }
  // 2. Also try discovering the cycleId from logs dir if not stamped on manifest.
  if (!cycleId) {
    const discovered = discoverCycleIdFromLogs(logsRootAbs, initId);
    if (discovered) {
      const snapshotDir = join(logsRootAbs, discovered, 'work-items-snapshot');
      const items = tryReadWorkItemDir(snapshotDir);
      if (items !== null) return items;
    }
  }
  // 3. Live worktree path (in-flight cycle, PM just ran).
  const liveDir = join(forgeRootAbs, '_worktrees', initId, '.forge', 'work-items');
  const items = tryReadWorkItemDir(liveDir);
  return items ?? [];
}

/** Try to read WI-*.md files from a directory; returns null if dir absent. */
function tryReadWorkItemDir(dir: string): RoadmapWorkItem[] | null {
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^WI-\d+\.md$/.test(f));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const items: RoadmapWorkItem[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      const wi = parseWorkItem(raw);
      // Extract title from WI body: first heading line or fall back to id.
      const titleMatch = raw.match(/^##?\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : wi.work_item_id;
      items.push({ id: wi.work_item_id, title, dependsOn: wi.depends_on });
    } catch {
      // skip unparseable WI
    }
  }
  return items;
}

/** Scan _logs/ for the latest cycle dir belonging to initId. */
function discoverCycleIdFromLogs(logsRoot: string, initId: string): string | null {
  if (!existsSync(logsRoot)) return null;
  try {
    const dirs = readdirSync(logsRoot).filter((d) => d.endsWith(`_${initId}`));
    if (dirs.length === 0) return null;
    dirs.sort();
    return dirs[dirs.length - 1] ?? null;
  } catch {
    return null;
  }
}

// Write routes (PUT agents/projects/flows) live in bridge-studio-writes.ts.
// Re-export for callers that still import from this module.
export { handleStudioWriteRoutes } from './bridge-studio-writes.ts';
