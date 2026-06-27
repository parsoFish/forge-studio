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
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

import { classifyClause } from './preflight-resolve.ts';
import { applyPreflightAutoFixes } from './preflight-fix-auto.ts';
import { ensureStudioBranch, commitStudioChange, withStudioWrite, saveProjectRepo } from '../orchestrator/project-repo-tx.ts';
import type { ClauseResult } from './preflight.ts';

import {
  listAgentDefinitions,
  loadAgentDefinition,
  loadFlowDefinition,
  discoverProjects,
  serializeAgentDefinition,
  serializeFlowDefinition,
} from '../orchestrator/studio/registry.ts';
import type { AgentDefinition, FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE, validateAgent, validateFlow } from '../orchestrator/studio/validate.ts';
import { validateProjectConfig, readAgentInstructionsFile } from '../orchestrator/project-config.ts';
import { readArtifactRoot } from '../orchestrator/brain-paths.ts';
import { loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { runPreflight } from './preflight.ts';
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
// C4 contract-artifact scaffolding (B3)
// ---------------------------------------------------------------------------

/**
 * Idempotently scaffold the machine-readable architecture context the C4
 * preflight clause requires: a `roadmap.md` at the project root and the
 * project's brain sub-wiki `profile.md` (under the project.json `artifactRoot`,
 * default `.`). Each file is written ONLY if absent — an existing operator file
 * is never clobbered. The stubs are clearly marked as TODO scaffolding so a
 * hollow roadmap is never written silently. A git repo is initialised if the
 * project dir is not already inside one (C6/preflight needs a git surface).
 *
 * Returns the list of relative paths actually created (empty if everything was
 * already present), so the caller can tell the operator what it touched.
 */
export function scaffoldContractArtifacts(projectRoot: string, name: string): string[] {
  const created: string[] = [];

  // git init if the dir is not already a git work tree.
  let isGit = false;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot, stdio: 'ignore' });
    isGit = true;
  } catch {
    isGit = false;
  }
  if (!isGit) {
    try {
      execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
      created.push('.git/');
    } catch {
      // git unavailable or dir not writable — preflight will surface C6.
    }
  }

  // roadmap.md (C4) — TODO stub, clearly marked.
  const roadmapPath = resolve(projectRoot, 'roadmap.md');
  if (!existsSync(roadmapPath)) {
    writeFileSync(
      roadmapPath,
      `# ${name} — Roadmap\n\n` +
        `> TODO (scaffold): replace this stub with the real product roadmap.\n` +
        `> Forge's architect/PM read this file to decompose work; an empty roadmap\n` +
        `> means they have nothing to plan against. List the features/milestones\n` +
        `> you want built, largest-chunk-first.\n\n` +
        `## Milestones\n\n- [ ] TODO: describe the first milestone.\n`,
      'utf8',
    );
    created.push('roadmap.md');
  }

  // brain sub-wiki profile.md (C4, Brain 3) under the artifactRoot.
  const artifactRoot = readArtifactRoot(projectRoot);
  const brainRel = artifactRoot === '.' ? join('brain', 'profile.md') : join(artifactRoot, 'brain', 'profile.md');
  const profilePath = resolve(projectRoot, brainRel);
  if (!existsSync(profilePath)) {
    mkdirSync(resolve(profilePath, '..'), { recursive: true });
    writeFileSync(
      profilePath,
      `# ${name} — Project Profile (Brain 3)\n\n` +
        `> TODO (scaffold): replace this stub with the project's machine-readable\n` +
        `> architecture profile — the durable facts forge's planners query before\n` +
        `> designing (stack, module map, conventions, invariants). See\n` +
        `> docs/forge-project-contract.md (clause C4) and the forge-onboard-project skill.\n\n` +
        `## Stack\n\nTODO\n\n## Module map\n\nTODO\n\n## Conventions & invariants\n\nTODO\n`,
      'utf8',
    );
    created.push(brainRel.split(sep).join('/'));
  }

  return created;
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
// ---------------------------------------------------------------------------
// Stage D — preflight resolution helpers
// ---------------------------------------------------------------------------

/** Resolve a managed-project id to its absolute root, or send an error + return null. */
function resolveManagedProject(
  ctx: StudioContext,
  id: string,
  res: ServerResponse,
  origin: string | undefined,
): string | null {
  if (!SLUG_RE.test(id)) {
    sendJson(res, 400, { error: 'invalid project id' }, origin);
    return null;
  }
  const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
  const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
  if (!projectRef) {
    sendJson(res, 404, { error: 'unknown project' }, origin);
    return null;
  }
  const projectRoot = projectRef.absPath;
  if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
    sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
    return null;
  }
  return projectRoot;
}

function toClauseDto(c: ClauseResult): {
  id: string; title: string; hard: boolean; pass: boolean; detail: string;
  resolution: string; route?: string; fixHint?: string;
} {
  const cls = classifyClause(c);
  return { id: c.clause, title: c.title, hard: c.hard, pass: c.pass, detail: c.detail, resolution: cls.resolution, route: cls.route, fixHint: cls.fixHint };
}

/** Spawn ONE detached `forge preflight fix` agent turn; events stream to
 *  _logs/_preflight-fix-<runId>/events.jsonl. Mirrors spawnBrainFix. */
function spawnPreflightFix(
  forgeRoot: string,
  p: { project: string; clause: string; instruction: string; detail: string; runId: string },
): void {
  // Harness guard: tests pin FORGE_ARCHITECT_NO_SPAWN=1 so the route is exercised
  // without launching a real SDK agent.
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1') return;
  const logDir = join(forgeRoot, '_logs', `_preflight-fix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'orchestrator/cli.ts', 'preflight', 'fix',
    '--project', p.project, '--clause', p.clause, '--run-id', p.runId,
    '--instruction', p.instruction, '--detail', p.detail,
  ];
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

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

  // ---- POST /api/studio/projects/:id/save-repo (R1-2) ----------------------
  // Merge the project's accumulated forge-studio changes into main + push.
  const saveRepoMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/save-repo$/);
  if (saveRepoMatch && method === 'POST') {
    try {
      const projectRoot = resolveManagedProject(ctx, decodeURIComponent(saveRepoMatch[1]), res, origin);
      if (!projectRoot) return true;
      const result = saveProjectRepo(projectRoot);
      sendJson(res, 200, { ok: true, ...result }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/:id/preflight/fix-auto (Stage D) ----------
  const pfAutoMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-auto$/);
  if (pfAutoMatch && method === 'POST') {
    try {
      const projectRoot = resolveManagedProject(ctx, decodeURIComponent(pfAutoMatch[1]), res, origin);
      if (!projectRoot) return true;
      const before = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      try { ensureStudioBranch(projectRoot); } catch { /* non-git */ }
      const result = applyPreflightAutoFixes({ projectDir: projectRoot, forgeRoot: ctx.forgeRoot, clauses: before.clauses });
      try { commitStudioChange(projectRoot, 'forge-studio: preflight auto-fix'); } catch { /* best-effort */ }
      const after = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      sendJson(res, 200, { ok: true, applied: result.applied, skipped: result.skipped, clauses: after.clauses.map(toClauseDto), ready: after.ok }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/:id/preflight/fix-agent (Stage D) ---------
  const pfAgentMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-agent$/);
  if (pfAgentMatch && method === 'POST') {
    try {
      const id = decodeURIComponent(pfAgentMatch[1]);
      const projectRoot = resolveManagedProject(ctx, id, res, origin);
      if (!projectRoot) return true;
      let body: Record<string, unknown>;
      try {
        body = (await readJson(req)) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      const clauseId = typeof body.clauseId === 'string' ? body.clauseId : '';
      const instruction = typeof body.instruction === 'string' ? body.instruction : '';
      if (!clauseId) {
        sendJson(res, 400, { error: 'fix-agent requires clauseId' }, origin);
        return true;
      }
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const clause = report.clauses.find((c) => c.clause === clauseId);
      if (!clause) {
        sendJson(res, 404, { error: `unknown clause ${clauseId}` }, origin);
        return true;
      }
      const cls = classifyClause(clause);
      if (cls.resolution === 'auto') {
        sendJson(res, 400, { error: `${clauseId} is auto-tier — use fix-auto`, route: 'auto' }, origin);
        return true;
      }
      if (cls.resolution === 'agent') {
        // C8→instructions, DEMO/DEMO-SKILL→demo-builder, BRAIN→brain-fix. The UI
        // navigates to the existing builder surface; no spawn here.
        sendJson(res, 200, { ok: true, resolution: 'agent', route: cls.route, fixHint: cls.fixHint }, origin);
        return true;
      }
      // USER-tier — spawn the generic preflight-fix agent with the operator's decision.
      const runId = `${id}-${clauseId}-${Date.now().toString(36)}`;
      try {
        spawnPreflightFix(ctx.forgeRoot, { project: id, clause: clauseId, instruction, detail: clause.detail, runId });
      } catch (err) {
        sendJson(res, 500, { error: `failed to dispatch preflight-fix: ${sanitizeError(err)}` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, resolution: 'user', route: 'preflight-fix', runId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

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
        sdk: typeof rtIn['sdk'] === 'string' ? rtIn['sdk'] : (existing?.runtime.sdk ?? 'claude'),
        strategy: (['fixed', 'range'] as const).includes(rtIn['strategy'] as 'fixed' | 'range')
          ? (rtIn['strategy'] as 'fixed' | 'range')
          : (existing?.runtime.strategy ?? 'fixed'),
        model: typeof rtIn['model'] === 'string' ? rtIn['model'] : existing?.runtime.model,
        range: Array.isArray(rtIn['range']) ? (rtIn['range'] as string[]) : existing?.runtime.range,
        loopStrategy: typeof rtIn['loopStrategy'] === 'string' ? rtIn['loopStrategy'] : existing?.runtime.loopStrategy,
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

  // ---- POST /api/studio/projects (create / onboard) ------------------------
  // Onboard a project: scaffold the `.forge/project.json` contract (C1 quality
  // gate + DEMO) plus idempotent C4 artifact stubs (roadmap.md + the project's
  // brain sub-wiki profile.md), git-init if absent, then preflight and report
  // which clauses still fail. Projects are auto-discovered from disk (B1) — no
  // registry file to append to.
  if (url === '/api/studio/projects' && method === 'POST') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }
      const b = body as Record<string, unknown>;

      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      if (!name) { sendJson(res, 400, { error: 'name is required' }, origin); return true; }

      // Derive a slug id from an explicit id or the name.
      const rawId = typeof b['id'] === 'string' && b['id'].trim() ? b['id'].trim() : name;
      const id = rawId.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!SLUG_RE.test(id)) { sendJson(res, 400, { error: 'could not derive a valid slug id from the name' }, origin); return true; }

      // quality_gate_cmd: accept argv array or a whitespace-split string.
      const toArgv = (v: unknown): string[] | null =>
        Array.isArray(v) ? v.map(String).filter(Boolean)
          : typeof v === 'string' && v.trim() ? v.trim().split(/\s+/) : null;
      const qualityGate = toArgv(b['qualityGateCmd']);
      if (!qualityGate) { sendJson(res, 400, { error: 'qualityGateCmd is required (the project quality-gate command)' }, origin); return true; }

      const demoShape = typeof b['demoShape'] === 'string' && b['demoShape'] ? b['demoShape'] : 'harness';
      const demoCommand = toArgv(b['demoCommand']) ?? qualityGate;

      // Reject a duplicate id by disk scan (B1: projects are discovered, not
      // registered). Resolve + guard the repo path under the projects root.
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
      if (discoverProjects(projectsDir, ctx.forgeRoot).some((p) => p.id === id)) {
        sendJson(res, 409, { error: `project "${id}" already exists` }, origin); return true;
      }
      const repoPathRel = typeof b['repoPath'] === 'string' && b['repoPath'].trim() ? b['repoPath'].trim() : `projects/${id}`;
      const projectRoot = resolve(ctx.forgeRoot, repoPathRel);
      if (!projectRoot.startsWith(resolve(ctx.forgeRoot) + sep)) {
        sendJson(res, 400, { error: 'repo path escapes the forge root' }, origin); return true;
      }

      // Scaffold the .forge/project.json (validated before write).
      const cfg: Record<string, unknown> = {
        name,
        northStar: typeof b['northStar'] === 'string' ? b['northStar'].trim() : '',
        instructions: typeof b['instructions'] === 'string' && b['instructions'].trim()
          ? b['instructions'].trim()
          : 'Managed by forge. See AGENTS.md for project-specific rules.',
        demoProcess: [
          { kind: 'capture', text: 'Capture the before state of the change.' },
          { kind: 'verify', text: 'Run the quality gate to verify the change.' },
        ],
        quality_gate_cmd: qualityGate,
        demo: demoShape === 'none' ? { shape: 'none' } : { shape: demoShape, command: demoCommand },
      };
      try { validateProjectConfig(cfg); }
      catch (err) { sendJson(res, 400, { error: String(err) }, origin); return true; }

      const forgeDir = resolve(projectRoot, '.forge');
      if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
      writeFileSync(resolve(forgeDir, 'project.json'), JSON.stringify(cfg, null, 2), 'utf8');

      // B3: scaffold the C4 artifacts the architect/PM need so a freshly
      // onboarded project is preflight-green (or at least clear about what is
      // missing). All writes are idempotent — never clobber an existing
      // operator file, and the stubs are clearly marked as TODO scaffolding.
      const scaffolded = scaffoldContractArtifacts(projectRoot, name);

      // Re-run preflight and surface the clauses that still fail so the UI can
      // either celebrate (ready) or hand off to forge-onboard-project.
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const failing = report.clauses
        .filter((c) => c.hard && !c.pass)
        .map((c) => ({ id: c.clause, title: c.title, detail: c.detail }));

      sendJson(res, 200, { ok: true, id, ready: report.ok, scaffolded, failingClauses: failing }, origin);
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

      // 2. Resolve the project by disk scan (B1: auto-discovered from disk).
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }

      // 3. Resolve the project.json path and prefix-guard it
      const projectRoot = projectRef.absPath;
      // Guard: the discovered path must not escape the forge root (defensive —
      // discoverProjects already relativises under the projects root).
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
      // AGENTS.md single-source (Stage A): when the project has an agent-instruction
      // file (AGENTS.md / CLAUDE.md), that file IS the instructions — never write a
      // divergent copy into project.json from the editor save (the UI binds the
      // panel read-only to AGENTS.md, but guard here too so any caller is safe).
      const hasAgentFile = readAgentInstructionsFile(projectRoot) !== null;
      if (!hasAgentFile && typeof b['instructions'] === 'string') {
        merged['instructions'] = b['instructions'];
      }
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

      // 7. Write back (pretty, 2-space), committed to the project's forge-studio branch.
      const forgeDir = resolve(projectRoot, '.forge');
      if (!existsSync(forgeDir)) {
        mkdirSync(forgeDir, { recursive: true });
      }
      withStudioWrite(
        projectRoot,
        'forge-studio: update .forge/project.json',
        () => writeFileSync(projectJsonPath, JSON.stringify(merged, null, 2), 'utf8'),
        ['.forge/project.json'],
      );

      // F5: when demoProcess was in the save body, signal that the demo-design
      // skill should be run to generate per-project demo machinery. The UI
      // surfaces this as data-demo-design-state="needed" on the project page
      // so the operator can trigger: `forge run skill demo-design --project <id>`.
      const demoDesignNeeded = Array.isArray(b['demoProcess']);

      sendJson(res, 200, { ok: true, id, ...(demoDesignNeeded ? { demoDesignNeeded: true } : {}) }, origin);
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
      // The predicate `r.flowId === id` is correct: since S8/DEC-3 run-model stamps
      // each run with the flowId its manifest names (forge-architect / forge-develop
      // / forge-reflect), so a run of THIS flow is locked while in flight.
      // Pre-S8 manifests with no flow_id stamp as 'unknown' (never matches a real
      // editable flow id) — correct, an unknowable archival flow is not editable.
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

  // ---- POST /api/studio/skills (P2) — author a plain composable skill ---------
  // A "skill" here is a plain SKILL.md (name + description + body, no runtime
  // block) — composable into agents. Distinct from a studio agent (which has a
  // runtime block); `forge studio lint` skips non-studio skills, so this is safe.
  if (url === '/api/studio/skills' && method === 'POST') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      const description = typeof b['description'] === 'string' ? b['description'].trim() : '';
      const skillBody = typeof b['body'] === 'string' ? b['body'] : '';
      if (!name) { sendJson(res, 400, { error: 'name is required' }, origin); return true; }
      if (!description) { sendJson(res, 400, { error: 'description is required' }, origin); return true; }

      const slug = (typeof b['id'] === 'string' && b['id'].trim() ? b['id'].trim() : name)
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!SLUG_RE.test(slug)) { sendJson(res, 400, { error: 'could not derive a valid slug from the name' }, origin); return true; }

      const skillsBase = resolve(ctx.forgeRoot, 'skills');
      const skillDir = resolve(skillsBase, slug);
      if (!skillDir.startsWith(skillsBase + sep)) { sendJson(res, 400, { error: 'path traversal detected' }, origin); return true; }
      const skillMdPath = resolve(skillDir, 'SKILL.md');
      if (existsSync(skillMdPath)) { sendJson(res, 409, { error: `skill "${slug}" already exists` }, origin); return true; }

      const md = matter.stringify(
        '\n' + (skillBody.trim() || `# ${name}\n\n${description}\n`) + '\n',
        { name, description },
      );
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillMdPath, md, 'utf8');
      sendJson(res, 200, { ok: true, id: slug }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
