/**
 * Forge Studio PUT write route handlers — agents, projects, flows (M2-2).
 *
 * Extracted from bridge-studio.ts to keep both modules under 800 LOC.
 * Imports shared helpers (sendJson, allowedOrigin, sanitizeError, readJson,
 * pathOnly, SLUG_RE) from bridge-studio.ts — no duplication, no circular
 * import (this module imports FROM bridge-studio, not vice versa).
 *
 * Routes:
 *   PUT /api/studio/agents/:slug   → upsert agent SKILL.md
 *   PUT /api/studio/projects/:id   → update project.json
 *   PUT /api/studio/flows/:id      → upsert flow.yaml
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  listAgentDefinitions,
  loadAgentDefinition,
  loadFlowDefinition,
  loadProjectsRegistry,
  serializeAgentDefinition,
  serializeFlowDefinition,
} from '../orchestrator/studio/registry.ts';
import type { AgentDefinition, FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE, validateAgent, validateFlow } from '../orchestrator/studio/validate.ts';
import { validateProjectConfig } from '../orchestrator/project-config.ts';
import { listRuns } from '../orchestrator/run-model.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';

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
  if (method !== 'PUT' && method !== 'POST') return false;

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
      if (typeof b['name'] === 'string') merged['name'] = b['name'];
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

  // ---- PUT /api/studio/flows/:id -------------------------------------------
  const flowMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (flowMatch) {
    try {
      const id = decodeURIComponent(flowMatch[1]);

      // 1. Slug-guard before any fs path construction (blocks path traversal)
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid flow id — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }

      // 2. Resolve and prefix-guard the flow.yaml path
      const flowsBase = resolve(ctx.forgeRoot, 'studio', 'flows');
      const flowYamlPath = resolve(flowsBase, id, 'flow.yaml');
      if (!flowYamlPath.startsWith(flowsBase + sep)) {
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

      // 4. Load existing flow (or scaffold for new flow)
      let existing: FlowDefinition | null = null;
      if (existsSync(flowYamlPath)) {
        try {
          existing = loadFlowDefinition(flowYamlPath);
        } catch (err) {
          sendJson(res, 500, { error: sanitizeError(err) }, origin);
          return true;
        }
      }

      // 5. Merge UI-editable fields over existing; preserve id/origin/disposable/path
      const name = typeof b['name'] === 'string' ? b['name'] : existing?.name ?? id;
      const goal = typeof b['goal'] === 'string' ? b['goal'] : existing?.goal ?? '';
      const project =
        b['project'] !== undefined
          ? (typeof b['project'] === 'string' ? b['project'] : null)
          : (existing?.project ?? null);
      const kb =
        b['kb'] !== undefined
          ? (typeof b['kb'] === 'string' ? b['kb'] : null)
          : (existing?.kb ?? null);
      const costCeilingUsd =
        typeof b['costCeilingUsd'] === 'number'
          ? b['costCeilingUsd']
          : existing?.costCeilingUsd ?? 2.0;

      // nodes/edges/triggers: only override if provided in body
      const nodes = Array.isArray(b['nodes']) ? b['nodes'] : (existing?.nodes ?? []);
      const edges = Array.isArray(b['edges']) ? b['edges'] : (existing?.edges ?? []);
      const triggers = Array.isArray(b['triggers']) ? b['triggers'] : (existing?.triggers ?? []);

      // Bump version: n+1 for existing, 1 for new
      const version = (existing?.version ?? 0) + 1;

      const merged: FlowDefinition = {
        id,
        name,
        version,
        goal,
        project,
        kb,
        costCeilingUsd,
        origin: existing?.origin ?? 'studio',
        disposable: existing?.disposable,
        nodes: nodes as FlowDefinition['nodes'],
        edges: edges as FlowDefinition['edges'],
        triggers: triggers as FlowDefinition['triggers'],
        path: flowYamlPath,
      };

      // 6. Build agents map for validateFlow
      const skillsDir = resolve(ctx.forgeRoot, 'skills');
      let agentsList: AgentDefinition[] = [];
      try {
        agentsList = listAgentDefinitions(skillsDir);
      } catch {
        // skills dir absent in tests — proceed with empty map (agent-ref check will flag)
      }
      const agentsMap = new Map(agentsList.map((a) => [a.slug, a]));

      // 7. Validate — reject on any error-level finding
      const findings = validateFlow(merged, agentsMap);
      const hasErrors = findings.some((f) => f.level === 'error');
      if (hasErrors) {
        sendJson(res, 400, { error: 'validation failed', findings }, origin);
        return true;
      }

      // 8. Edit-lock: reject if a run of this flowId is currently active (ADR-028 D6)
      // The predicate `r.flowId === id` is correct. It is fully effective today
      // because run-model stamps every run with flowId = 'forge-cycle' (the only
      // flow the scheduler runs). When multi-flow scheduling lands, run-model must
      // derive the real flowId from the manifest/flow that spawned each run (see
      // FLOW_ID note in run-model.ts) — until then, non-forge-cycle flows would
      // not be locked (latent gap; no such flows exist today).
      const activeRun = listRuns(ctx.forgeRoot, Date.now()).find(
        (r) => r.flowId === id && r.status === 'active',
      );
      if (activeRun) {
        sendJson(res, 423, { error: 'flow locked — a run is in flight', runId: activeRun.id }, origin);
        return true;
      }

      // 9. Serialize and write
      const serialized = serializeFlowDefinition(merged);
      const flowDir = resolve(flowsBase, id);
      if (!existsSync(flowDir)) {
        mkdirSync(flowDir, { recursive: true });
      }
      writeFileSync(flowYamlPath, serialized, 'utf8');

      const flagFindings = findings.filter((f) => f.level === 'flag');
      sendJson(res, 200, { ok: true, id, version, findings: flagFindings }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
