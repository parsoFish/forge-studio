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
 *   PUT /api/studio/flows/:id      → upsert flow.yaml
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 *
 * M4-PROJECTS CARVE (§4 step 2, worker B): every PROJECTS route this file
 * used to answer — `POST /api/studio/projects/create`, `POST
 * /api/studio/projects` (onboard), `PUT`+`POST /api/studio/projects/:id`,
 * `POST /api/studio/projects/:id/save-repo`, `POST /api/studio/projects/:id/
 * preflight/fix-auto`, and the projects half of `POST /api/studio/projects/
 * :id/preflight/fix-agent` — has MOVED to `packages/projects/routes.ts`
 * (table) via `bridge-studio-project-onboard.ts` and `bridge-studio-project-preflight-write.ts` (T2
 * assembles the table; not done in this file). `scaffoldContractArtifacts`
 * and `demoProcessChanged` below are now thin re-exports of the moved
 * implementations in `@forge/projects/project-contract-scaffold.ts` and
 * `@forge/projects/bridge-studio-project-onboard.ts` — kept ONLY because two existing test
 * files (`apps/forge/onboard-git-init.test.ts`, `cli/bridge-studio-writes-demo-
 * design.test.ts`) import them directly from this module; every other
 * projects-only helper (`checkContractArtifactContainment`,
 * `resolveManagedProject`, `toClauseDto`, `needsGitInit`, …) moved with no
 * shim, since nothing else in this repo imported them directly. `spawnPreflightFix`
 * stays here (now exported) — it is SESSIONS-owned, not projects', per the
 * M4-projects routes budget row 12b, and `bridge-studio-project-preflight-write.ts`'s
 * `POST .../fix-agent` handler now calls it through an injected dependency
 * instead of a direct import.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { listAgentDefinitions, listStarterAgents, loadAgentDefinition, loadFlowDefinition, discoverProjects, serializeAgentDefinition, serializeFlowDefinition, listFlowIds } from '../../orchestrator/studio/registry.ts';
import { skillsDir as toSkillsDir } from '@forge/agents/skill-path.ts';
import { resolveGuardedPath, guardedFile, guardedWriteFile } from '@forge/kernel';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import { SLUG_RE, isReservedId, validateFlow } from '../../orchestrator/studio/validate.ts';
import { readArtifactRoot } from '@forge/knowledge/brain-paths.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { isDryBridge } from './dry-bridge.ts';
import { cachedListRuns } from '@forge/flows/run-list-cache.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
// ---------------------------------------------------------------------------
// C4 contract-artifact scaffolding (B3) — MOVED to
// @forge/projects/project-contract-scaffold.ts (M4-projects carve, worker B).
// `scaffoldContractArtifacts` is re-exported here, with `readArtifactRoot`
// wired to the real @forge/knowledge implementation (already an accepted,
// baselined `legacy-to-package-not-via-shim` edge for this legacy file —
// see scripts/baselines/boundaries.json), ONLY because
// apps/forge/onboard-git-init.test.ts imports it directly from this module. Every
// other helper that used to live here (ScaffoldContainmentError,
// contractArtifactTargets, needsGitInit, isPackageManagerShaped,
// PM_NATIVE_SUBCOMMANDS, resolveScriptName, needsPackageJsonScaffold,
// checkContractArtifactContainment) moved with NO shim: nothing else in this
// repo imported them directly.
// ---------------------------------------------------------------------------
import { scaffoldContractArtifacts as scaffoldContractArtifactsImpl } from '@forge/projects/project-contract-scaffold.ts';

export function scaffoldContractArtifacts(
  projectRoot: string,
  name: string,
  forgeRoot: string,
  opts: { id?: string; qualityGateCmd?: readonly string[] } = {},
): string[] {
  return scaffoldContractArtifactsImpl(projectRoot, name, forgeRoot, readArtifactRoot, opts);
}


// ---------------------------------------------------------------------------
// Write routes (M2-2) — PUT /api/studio/agents/:slug, PUT /api/studio/projects/:id
// ---------------------------------------------------------------------------

// `demoProcessChanged` MOVED to @forge/projects/bridge-studio-project-onboard.ts (M4-projects
// carve, worker B). Re-exported here ONLY because
// apps/forge/bridge-studio-writes-demo-design.test.ts imports it directly from this
// module.
export { demoProcessChanged } from '@forge/projects/bridge-studio-project-onboard.ts';

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
 *   4. validateAgent / validateFlow block writes on error-level findings.
 */

/**
 * Spawn ONE detached `forge preflight fix` agent turn; events stream to
 * _logs/_preflight-fix-<runId>/events.jsonl. Mirrors spawnBrainFix.
 *
 * SESSIONS-owned (M4-projects routes budget row 12b), not projects' — kept
 * in this file (its original home) rather than moved, since the sessions
 * lane has not carved its routes yet. EXPORTED (it was module-local before
 * the M4-projects carve) so `apps/forge/routes.ts` can inject it into
 * `@forge/projects/bridge-studio-project-preflight-write.ts`'s `makePreflightWriteHandlers`
 * factory as `deps.spawnPreflightFix` — the same injected-dependency shape
 * used for `seedProjectBrain` in `bridge-studio-project-onboard.ts`.
 */
export function spawnPreflightFix(
  forgeRoot: string,
  p: { project: string; clause: string; instruction: string; detail: string; runId: string },
): void {
  // Harness guard: tests pin FORGE_ARCHITECT_NO_SPAWN=1 so the route is exercised
  // without launching a real SDK agent.
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  const logDir = join(forgeRoot, '_logs', `_preflight-fix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'apps/forge/cli.ts', 'preflight', 'fix',
    '--project', p.project, '--clause', p.clause, '--run-id', p.runId,
    '--instruction', p.instruction, '--detail', p.detail,
  ];
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

// ---------------------------------------------------------------------------
// W7-B4 helpers — agent/flow lifecycle (delete guards, no-op detection,
// starter-agent materialisation).
// ---------------------------------------------------------------------------


/** Key-sorted JSON — a stable equality basis for the flow no-op check. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The UI-editable projection of a flow definition — the fields a builder
 *  save can actually change. Version is EXCLUDED on purpose: a save that
 *  changes nothing else must not bump it (flows-12's no-op preservation). */
function flowEditableProjection(def: FlowDefinition): string {
  return canonicalJson({
    name: def.name,
    goal: def.goal,
    project: def.project ?? null,
    kb: def.kb ?? null,
    costCeilingUsd: def.costCeilingUsd,
    nodes: def.nodes,
    edges: def.edges,
    triggers: def.triggers,
    kickoff: def.kickoff ?? null,
  });
}

/**
 * W7-B4 (flows-09) — materialise any STARTER agents a flow save references
 * into the real roster (skills/<slug>/), so the seeded plan→dev→review
 * canvas is saveable on a fresh install. The slug set is CLOSED — only slugs
 * `listStarterAgents` itself enumerates (server-controlled values; the
 * client's node.agent strings merely SELECT from that set by equality), and
 * only when skills/<slug> does not already exist (an operator's own agent of
 * the same name always wins — nothing is ever overwritten).
 */
function planStarterAgentMaterialisation(
  forgeRoot: string,
  nodes: unknown[],
): { def: AgentDefinition; destPath: string }[] {
  const wanted = new Set<string>();
  for (const raw of nodes) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const agent = (raw as Record<string, unknown>)['agent'];
    if (typeof agent === 'string' && agent) wanted.add(agent);
  }
  if (wanted.size === 0) return [];
  const planned: { def: AgentDefinition; destPath: string }[] = [];
  for (const starter of listStarterAgents(forgeRoot)) {
    if (!wanted.has(starter.slug)) continue;
    const guard = resolveGuardedPath(toSkillsDir(forgeRoot), [starter.slug]);
    if (!guard.ok || guard.exists) continue; // existing roster agent wins
    planned.push({ def: starter, destPath: guard.realPath });
  }
  return planned;
}

/**
 * W7-B4 review finding 10 — APPLY the plan above. Split from the planning
 * pass because materialisation is a real, persistent mutation of the roster
 * (it copies whole packages into skills/), and it used to run BEFORE
 * validation, the edit-lock and the no-op check: a save that the server then
 * answered 400/423, or that changed nothing at all, still left new agents in
 * skills/. Planning is pure and can therefore still happen early enough to
 * inform validation; only the copy waits until the save is certain to land.
 */
function applyStarterAgentMaterialisation(
  forgeRoot: string,
  planned: { def: AgentDefinition; destPath: string }[],
): string[] {
  const materialized: string[] = [];
  for (const { def, destPath } of planned) {
    cpSync(join(forgeRoot, 'studio', 'starters', 'agents', def.slug), destPath, { recursive: true });

    // agents-44: a starter package is a design-time TEMPLATE and declares no
    // `phase:` — but the copy above lands it in the LIVE, dispatchable roster,
    // and deriveAgentSpec (runAgent()'s synchronous Step 1, before any spawn)
    // hard-requires phase. Copied verbatim, every materialised starter was
    // undispatchable from both the standalone Run button and flow execution,
    // with no in-Studio recovery (a builder re-save preserves an existing
    // agent's absent phase verbatim, by design). Stamp the SAME synthesis the
    // sibling agent-builder PUT path performs for a brand-new mint —
    // `phase: <slug>` — plus the explicit `library: true` every shipped
    // roster agent carries. Only ever applied to a FRESH copy: this path runs
    // exclusively when skills/<slug> did not already exist (see
    // planStarterAgentMaterialisation), so it can never rewrite an operator's
    // own agent.
    // The read/write both go back through the SAME containment guard the
    // destination came from (leaf included) rather than raw-joining onto
    // destPath — the SEC-04 leaf-append rule.
    const skillsRoot = toSkillsDir(forgeRoot);
    const skillMdPath = guardedFile(skillsRoot, [def.slug, 'SKILL.md'], 'read');
    if (skillMdPath === null) {
      throw new Error(`starter "${def.slug}": no readable SKILL.md under skills/${def.slug} after materialisation`);
    }
    const copied = loadAgentDefinition(skillMdPath);
    if (copied.phase === undefined || copied.library === undefined) {
      const stamped: AgentDefinition = {
        ...copied,
        phase: copied.phase ?? copied.slug,
        library: copied.library ?? true,
      };
      // No `originalRaw` fast path on purpose: the frontmatter genuinely
      // CHANGES here (phase is being added), so the byte-preserving branch
      // could never apply — passing it would only imply a fidelity guarantee
      // this write does not have.
      if (guardedWriteFile(skillsRoot, [def.slug, 'SKILL.md'], serializeAgentDefinition(stamped)) === null) {
        throw new Error(`starter "${def.slug}": containment rejected the SKILL.md phase stamp`);
      }
    }

    materialized.push(def.slug);
  }
  return materialized;
}

export async function handleStudioWriteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'PUT' && method !== 'POST' && method !== 'DELETE') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // W7-B3 review F3 (guard-symmetry), WIDENED at the W7-B4 merge: DELETE is
  // admitted into this function ONLY for the routes that actually implement
  // it — the agent/flow deletes (W7-B4). (The community registry item's
  // POST/PUT/DELETE — W7-B3 — MOVED to `packages/library/
  // bridge-studio-community-crud.ts` in the M4 §4 step 2 residue carve; this
  // function no longer sees that URL at all, `libraryRoutes` claims it first.)
  // Every OTHER write arm (projects/:id, save-repo, preflight/*, ...)
  // dispatches on its URL match alone with no `method ===` test, so an
  // unscoped DELETE would fall into a PUT handler and act; those still fall
  // through here (404), exactly as before W7-B3 added the method to the top
  // gate.
  //
  // This list is load-bearing and must grow with every new DELETE arm: W7-B3
  // wrote it as `!registryItemMatch` when the registry item was the only
  // DELETE route, and merging W7-B4 (which added two more) silently disabled
  // BOTH of them — the auto-merge was clean, and only the acceptance suite
  // caught it. Adding a DELETE arm below without adding its match here is a
  // route that answers 404 forever.
  const agentDeleteMatch = url.match(/^\/api\/studio\/agents\/([^/]+)$/);
  const flowDeleteMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (method === 'DELETE' && !agentDeleteMatch && !flowDeleteMatch) return false;

  // ---- PUT /api/studio/agents/:slug ----------------------------------------

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
      // W7-A4 (crosscut-20): `new` is the /flows/new builder segment, never a flow.
      if (isReservedId(id)) {
        sendJson(res, 400, { error: `flow id "${id}" is reserved (the /flows/new builder lives at that path) — choose another id` }, origin);
        return true;
      }

      // 2. Resolve + guard the flow.yaml path through the shared containment
      // guard (cli/studio-path-guard.ts). The former lexical
      // `startsWith(flowsBase + sep)` check had NO dirent-type gate anywhere
      // backing it up (unlike discoverProjects()'s isDirectory() filter for
      // projects) — all four escape shapes were reproduced live here.
      const flowsBase = resolve(ctx.forgeRoot, 'studio', 'flows');
      const pathGuard = resolveGuardedPath(flowsBase, [id, 'flow.yaml']);
      if (!pathGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const flowYamlPath = pathGuard.realPath;

      // ---- DELETE /api/studio/flows/:id (W7-B4, flows-11) ------------------
      // A shipped seed is refused outright (403 — the OOTB pipeline is not
      // deletable state); an in-flight run locks deletion exactly like edits
      // (423, ADR-028 D6); an authored flow deletes with its directory.
      if (method === 'DELETE') {
        if (!pathGuard.exists) {
          sendJson(res, 404, { error: `unknown flow "${id}"` }, origin);
          return true;
        }
        // W7-B4 review finding 7: the seed refusal must not DEPEND on a
        // successful parse. A corrupted authored flow.yaml used to answer 500
        // here, leaving the flow permanently undeletable from Studio (hand
        // surgery on disk was the only exit) — while the library listing kept
        // rendering it. On a parse failure we fall back to a raw-text seed
        // probe: a file that still declares `origin: seed` is refused exactly
        // as a parsed seed would be, and anything else is treated as authored
        // and deletable. Deleting is the recovery action for a broken flow.
        let def: FlowDefinition | null = null;
        try {
          def = loadFlowDefinition(flowYamlPath);
        } catch {
          const raw = readFileSync(flowYamlPath, 'utf8');
          if (/^\s*origin:\s*['"]?seed['"]?\s*$/m.test(raw)) {
            sendJson(res, 403, { error: `flow "${id}" is a shipped seed (origin: seed) — the OOTB pipeline cannot be deleted from Studio` }, origin);
            return true;
          }
        }
        if (def && def.origin === 'seed') {
          sendJson(res, 403, { error: `flow "${id}" is a shipped seed (origin: seed) — the OOTB pipeline cannot be deleted from Studio` }, origin);
          return true;
        }
        const activeDel = cachedListRuns(ctx.forgeRoot, Date.now()).find(
          (r) => r.flowId === id && r.status === 'active',
        );
        if (activeDel) {
          sendJson(res, 423, { error: 'flow locked — a run is in flight', runId: activeDel.id }, origin);
          return true;
        }
        // W7-B4 review finding 6 (dangling reference) — refuse while a SIBLING
        // flow triggers on this one. Every other delete on this surface has a
        // referenced-by guard; without this, `triggers[].target.ref` was left
        // pointing at nothing, which fails that sibling's next save and errors
        // studio lint. A malformed sibling is studio-lint's finding, not a
        // reason to block (or unblock) this delete — same rule the agent
        // delete's flow scan uses.
        const triggeringFlows: string[] = [];
        for (const otherId of listFlowIds(ctx.forgeRoot)) {
          if (otherId === id) continue;
          const g = resolveGuardedPath(flowsBase, [otherId, 'flow.yaml']);
          if (!g.ok || !g.exists) continue;
          try {
            const otherDef = loadFlowDefinition(g.realPath);
            if (otherDef.triggers.some((t) => t.target?.kind === 'flow' && t.target.ref === id)) {
              triggeringFlows.push(otherId);
            }
          } catch {
            // malformed sibling: studio lint's finding, not this route's
          }
        }
        if (triggeringFlows.length > 0) {
          sendJson(res, 409, {
            error: `flow "${id}" is the trigger target of ${triggeringFlows.length} flow(s): ${triggeringFlows.join(', ')} — retarget or remove those triggers first`,
            referencedBy: triggeringFlows,
          }, origin);
          return true;
        }
        rmSync(dirname(flowYamlPath), { recursive: true, force: true });
        sendJson(res, 200, { ok: true, id }, origin);
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

      // W7-B4 (flows-13): an EXPLICIT create must never silently overwrite an
      // existing flow — /flows/new sends `create: true`, collides with 409.
      if (b['create'] === true && pathGuard.exists) {
        sendJson(res, 409, {
          error: `flow "${id}" already exists — open /flows/${id} to edit it, or pick another name`,
        }, origin);
        return true;
      }

      // 4. Load existing flow (or scaffold for new flow)
      let existing: FlowDefinition | null = null;
      if (pathGuard.exists) {
        try {
          existing = loadFlowDefinition(flowYamlPath);
        } catch (err) {
          sendJson(res, 500, { error: sanitizeError(err) }, origin);
          return true;
        }
      }

      // W7-B4 (flows-09): a save referencing STARTER agents materialises them
      // into the roster, so the seeded plan→dev→review canvas actually
      // validates (agent-ref) on a fresh install. Closed slug set; an existing
      // skills/<slug> always wins. Only the PLAN is computed here (pure) — the
      // copy itself runs after every gate below (review finding 10); the
      // planned definitions are folded into the agents map so validation still
      // sees the agents this save is about to create.
      const plannedStarterAgents = planStarterAgentMaterialisation(
        ctx.forgeRoot,
        Array.isArray(b['nodes']) ? (b['nodes'] as unknown[]) : [],
      );

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
        // W7-B4 (flows-12): kickoff is a NON-UI field the builder never
        // sends — it must ride the merge like origin/disposable, or every
        // BUILD-tab save of a seeded flow silently strips its launch surface.
        kickoff: existing?.kickoff,
        path: flowYamlPath,
      };

      // 6. Build agents map for validateFlow
      const skillsDir = toSkillsDir(ctx.forgeRoot);
      let agentsList: AgentDefinition[] = [];
      try {
        agentsList = listAgentDefinitions(skillsDir);
      } catch {
        // skills dir absent in tests — proceed with empty map (agent-ref check will flag)
      }
      const agentsMap = new Map(agentsList.map((a) => [a.slug, a]));
      // Fold in the starters this save would materialise, so the agent-ref
      // check passes on the strength of the PLAN rather than of a side effect
      // that has already been committed to disk.
      for (const { def } of plannedStarterAgents) {
        if (!agentsMap.has(def.slug)) agentsMap.set(def.slug, def);
      }

      // 7. Validate — reject on any error-level finding. `flowProjectOf`
      // resolves the TARGET flow's project (R2-04) so the external-trigger
      // project requirement checks the flow the mint actually uses. `merged`
      // (the flow being saved) is resolved from memory so an in-flight edit to
      // its own project is honored; other targets load from disk.
      const flowProjectOf = (id: string): string | null | undefined => {
        if (id === merged.id) return merged.project;
        // CONTAINMENT (bd `forge-b2k`). `id` here is NOT the URL's `:id` — it
        // is `triggers[].target.ref` out of the REQUEST BODY, and the
        // SLUG_RE gate on this route covers the URL param only, never this
        // path. It used to reach a bare `join()` + read, which leaked a
        // boolean existence oracle: "is there a project-bearing,
        // flow.yaml-shaped file at this `..`-traversed location?", surfaced as
        // a difference in the returned validation findings.
        //
        // Two layers, matching the four already-fixed write routes:
        //   1. SLUG_RE as the independent first layer (defense in depth).
        //   2. The shared realpath identity guard, with `studio/flows` as a
        //      fixed forgeRoot-derived root and `id` as its OWN segment.
        // Every rejection returns `undefined` — byte-identical to "no such
        // flow" — because an oracle closes only when the rejected and the
        // not-found cases are indistinguishable to the caller.
        if (!SLUG_RE.test(id)) return undefined;
        const guarded = resolveGuardedPath(resolve(ctx.forgeRoot, 'studio', 'flows'), [id, 'flow.yaml']);
        if (!guarded.ok || !guarded.exists) return undefined;
        try {
          return loadFlowDefinition(guarded.realPath).project;
        } catch {
          return undefined;
        }
      };
      // R2-08-F1: thread the discovered-project id set so the trigger-projects
      // membership check runs on this write path too (mirrors flowIds above) —
      // the write path must reject the same shapes the dispatcher/lint reject,
      // not just accept-and-fail-later on the next load.
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const findings = validateFlow(merged, agentsMap, {
        flowIds: new Set(listFlowIds(ctx.forgeRoot)),
        flowProjectOf,
        projectIds: new Set(discoverProjects(projectsDir, ctx.forgeRoot).map((p) => p.id)),
      });
      const hasErrors = findings.some((f) => f.level === 'error');
      if (hasErrors) {
        sendJson(res, 400, { error: 'validation failed', findings }, origin);
        return true;
      }

      // 8. Edit-lock: reject if a run of this flowId is currently active (ADR-028 D6)
      // The predicate `r.flowId === id` is correct: since S8/DEC-3 run-model stamps
      // each run with the flowId its manifest names (forge-architect /
      // forge-develop), so a run of THIS flow is locked while in flight.
      // Pre-S8 manifests with no flow_id stamp as 'unknown' (never matches a real
      // editable flow id) — correct, an unknowable archival flow is not editable.
      // ADR-044 P1: cached per-manifest derivation — see packages/flows/run-list-cache.ts.
      const activeRun = cachedListRuns(ctx.forgeRoot, Date.now()).find(
        (r) => r.flowId === id && r.status === 'active',
      );
      if (activeRun) {
        sendJson(res, 423, { error: 'flow locked — a run is in flight', runId: activeRun.id }, origin);
        return true;
      }

      const flagFindings = findings.filter((f) => f.level === 'flag');

      // W7-B4 (flows-12): a save that changes NOTHING the builder can edit is
      // a no-op — the file is left byte-identical (hand-authored comments in
      // seed files survive) and the version does not bump. serializeFlow-
      // Definition drops YAML comments by construction, so "don't rewrite"
      // is the only preservation that actually preserves.
      if (existing && flowEditableProjection(existing) === flowEditableProjection(merged)) {
        sendJson(res, 200, { ok: true, id, version: existing.version, noop: true, findings: flagFindings }, origin);
        return true;
      }

      // Every gate has passed and this save WILL land — only now is the roster
      // mutated (review finding 10).
      const materializedAgents = applyStarterAgentMaterialisation(ctx.forgeRoot, plannedStarterAgents);

      // 9. Serialize and write. Derive from the ALREADY-GUARDED real path.
      const serialized = serializeFlowDefinition(merged);
      const flowDir = dirname(flowYamlPath);
      if (!existsSync(flowDir)) {
        mkdirSync(flowDir, { recursive: true });
      }
      writeFileSync(flowYamlPath, serialized, 'utf8');

      sendJson(res, 200, {
        ok: true,
        id,
        version,
        findings: flagFindings,
        ...(materializedAgents.length > 0 ? { materializedAgents } : {}),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
