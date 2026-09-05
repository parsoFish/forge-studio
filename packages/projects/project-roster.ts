/**
 * The project roster — `GET /api/studio/starters`,
 * `GET /api/studio/projects/starters` and `GET /api/studio/projects`.
 *
 * M4 §4 (projects routes carve). Moved out of `apps/forge/bridge-studio.ts`'s
 * `handleStudioRoutes` if-chain into standalone handlers with the
 * `RouteEntry` handler signature — `packages/projects/routes.ts` (T2's
 * assembly, not this file) drops them into the projects route table. Code is
 * moved VERBATIM from the legacy arms; only the two things a carve is allowed
 * to change moved with it — see the two dependency-injection notes below.
 *
 * `GET /api/studio/projects/attention` and `GET /api/studio/projects/:id/
 * roadmap` did NOT carve (still in `apps/forge/bridge-studio.ts`): their
 * helpers read `@forge/flows`, which outranks `projects` — `design.md`'s
 * "What this package deliberately does not own" carries the derivation.
 * `loadProjectsWithMeta` below has NO flows dependency and DID move; the
 * attention route imports it back from here for its one remaining call.
 *
 * TWO INJECTED DEPENDENCIES, both because a rank-2 `projects` package may not
 * import a same-or-higher rank package directly (`packages/kernel/
 * route-entry.ts`'s ranking; carve-rules.md's boundary section names
 * `@forge/knowledge` and `@forge/agents` explicitly):
 *
 *   1. `projectKbBindings` (`@forge/knowledge/kb-sites.ts`) — `loadProjectsWithMeta`
 *      derives a project's bound KB from it. `projects` (rank 2) may not
 *      import `@forge/knowledge` (same rank). Same shape as the ALREADY
 *      PRECEDENTED `seedProjectBrain` injection for the projects-onboard
 *      route (carve-rules.md): the dependency arrives as a parameter, and
 *      `packages/projects/routes.ts`'s factory closes over it — supplied by
 *      `apps/forge/routes.ts`, which `classify()` gives no rule at all and so
 *      may import both packages.
 *   2. `listStarterAgents`/`loadStarterFlow` (`orchestrator/studio/registry.ts`,
 *      LEGACY — no package-native home) and `agentCapabilityDescriptor`
 *      (`@forge/agents/studio/derive.ts`, rank 3, strictly higher than
 *      `projects`) — both needed by `GET /api/studio/starters`. Same
 *      injected-dependency shape as (1), closed over by the SAME factory.
 *
 * Neither is a "signature change" in the sense the carve forbids (no
 * behaviour differs) — it is the mechanical consequence of a handler that
 * used to live in a file with no rank at all (`cli/`) now living in a file
 * whose rank is enforced.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, resolve } from 'node:path';

import {
  discoverProjects,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  resolveGuardedPath,
  guardedFile,
  guardedReadFile,
  guardedReadDir,
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  type StudioContext,
} from '@forge/kernel';
import { listProjectStarters } from '@forge/projects/project-create.ts';
import {
  AGENT_INSTRUCTION_FILES,
  validateProjectConfig,
  readQualityGateSidecar,
  injectSidecarIntoTestProcess,
} from '@forge/projects/project-config.ts';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';

/** forge-3oq: the ONE provenance vocabulary this roster stamps every project
 *  with — Studio has no OOTB-project concept and `discoverProjects` is a
 *  pure directory scan, so 'unknown' is the only honest value. Duplicated
 *  from `cli/studio-provenance.ts`'s `PROJECT_PROVENANCE` rather than
 *  imported: that module is `cli/`, and a `projects` package handler may not
 *  import `cli/` (`package-to-legacy`). The value is the literal string
 *  `Provenance`'s 'unknown' member serializes to; kept as a bare string
 *  (not the `Provenance` type) so this file does not need the type either. */
const PROJECT_PROVENANCE = 'unknown' as const;

// ---------------------------------------------------------------------------
// Projects with merged project.json data
// ---------------------------------------------------------------------------

export type ProjectWithMeta = {
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
  /** forge-3oq: always PROJECT_PROVENANCE ('unknown') — Studio has no OOTB-
   *  project concept and discoverProjects is a pure directory scan, so the
   *  server has no field to attest either provenance from. */
  provenance: 'unknown';
  /** W8-C3 (projects-08 / forge-j1e): the project's contract health, DERIVED
   *  on every read by running `.forge/project.json` through the SAME
   *  validator the orchestrator runs the project through
   *  (`validateProjectConfig`). Never persisted — there is no field on disk a
   *  writer could forget to update, so it cannot go stale. Always present. */
  configHealth: ProjectConfigHealth;
  /** W8-C3 (projects-06 / projects-43): the ids of skills that live INSIDE this
   *  project (`.forge/skills/<id>/SKILL.md` — the shape the forge<->project
   *  contract already names, docs/forge-project-contract.md:445). Derived from
   *  disk on every read, never stored. `[]` means "we looked and found none",
   *  which is a different fact from an absent field. */
  localSkills: string[];
};

/**
 * W8-C3 (projects-08 / forge-j1e) — the derived contract-health verdict for
 * one project.
 *
 * · `ok`           — `.forge/project.json` exists, parses, and `validateProjectConfig` accepts it.
 * · `unconfigured` — the project directory exists but carries no `.forge/project.json` at all
 *                    (half-onboarded; `discoverProjects` deliberately still lists it).
 * · `invalid`      — the file is present but unreadable, is not JSON, or the REAL validator
 *                    rejects it (e.g. the R1-03 legacy flat gate keys — gitpulse's live state,
 *                    the shape `GET /api/studio/projects/:id/contract-stages` already 409s on).
 *
 * `reason` is the validator's OWN message wherever one exists, never a
 * re-worded copy: a copy is a second source of truth that drifts.
 */
const NO_PROJECT_CONFIG_REASON = 'no .forge/project.json — onboarding is unfinished';

export type ProjectConfigHealth = {
  state: 'ok' | 'unconfigured' | 'invalid';
  reason?: string;
};

/**
 * Derive one project's contract health from the parsed config.
 *
 * REVIEW ROUND 1 (S1) — this used to call `validateProjectConfig(raw)` on the
 * bare parsed JSON and claim, in three places, that it was "the SAME validator
 * the orchestrator runs the project through". **That claim was false**, and a
 * hostile review refuted it with a live project: `loadProjectConfig`
 * (`orchestrator/project-config.ts`) reads the `.forge/quality_gate_cmd`
 * sidecar and calls `injectSidecarIntoTestProcess` BEFORE validating, so a
 * project that single-sources its local gate from the sidecar — a supported,
 * documented R1-03-F1 shape, and the shape the live
 * `terraform-provider-betterado` project is in — was accepted by the
 * orchestrator and reported `invalid` / "contract broken" by this roster. A
 * healthy, actively-run project rendered bold red on the very index whose
 * purpose is telling broken from healthy: this lane's own defect class,
 * reshipped as a FALSE NEGATIVE.
 *
 * So the loader's pre-validation step happens here too, through the SAME
 * exported helper the loader uses (`injectSidecarIntoTestProcess`, whose own
 * docstring calls itself "the ONE sidecar-injection rule ... shared by the
 * loader and the bridge's PUT-validation copy") — never a re-implementation.
 * `apps/forge/bridge-studio-project-health.test.ts` pins PARITY rather than adding a
 * third fixture: for every shape, `state === 'ok'` iff `loadProjectConfig`
 * accepts it, because a disagreement in EITHER direction is the defect.
 *
 * `sidecarCmd` is read by the CALLER, which owns every filesystem decision, so
 * this function stays pure.
 */
export function deriveProjectLocalSkills(projectsDir: string, dirName: string): string[] {
  const entries = guardedReadDir(projectsDir, [dirName, '.forge', 'skills']);
  if (entries === null) return [];
  // A bare directory is not a skill: the SKILL.md is what makes an id
  // bindable, and offering a directory with no SKILL.md would re-create
  // projects-43 in the picker itself (an id that resolves to nothing).
  // Every leaf read rides the SAME per-segment guard as the rest of this
  // function (SEC-04): a symlinked skill dir escaping projectsDir is refused.
  return entries
    .filter((entry) => guardedFile(projectsDir, [dirName, '.forge', 'skills', entry, 'SKILL.md'], 'read') !== null)
    .sort((a, b) => a.localeCompare(b));
}

export function deriveConfigHealth(raw: unknown, sidecarCmd: string[] | null): ProjectConfigHealth {
  try {
    // Injection MUTATES its argument, so it gets a shallow copy — the caller's
    // `raw` is still read for name/northStar/skills/... afterwards and must not
    // be altered underneath it (return new objects, never mutate inputs).
    const forValidation: unknown =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : raw;
    if (sidecarCmd && forValidation !== null && typeof forValidation === 'object') {
      injectSidecarIntoTestProcess(forValidation as Record<string, unknown>, sidecarCmd);
    }
    validateProjectConfig(forValidation);
    return { state: 'ok' };
  } catch (err) {
    return { state: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The one injected dependency `loadProjectsWithMeta` needs — see the file
 *  header's dependency-injection note (1). */
export type ProjectKbBindingsFn = (forgeRoot: string) => Map<string, string>;

export function loadProjectsWithMeta(forgeRoot: string, projectKbBindings: ProjectKbBindingsFn): ProjectWithMeta[] {
  // B1: projects are auto-discovered from disk — scan `<projectsDir>/*` rather
  // than reading a registry file. All discovered dirs are listed (a
  // half-onboarded dir without `.forge/project.json` still surfaces, with
  // id-as-name defaults, so the operator can SEE it and finish onboarding —
  // `forge studio lint` warns about the missing contract file separately).
  const projectsDir = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
  const discovered = discoverProjects(projectsDir, forgeRoot);
  // W7-A4 (projects-34): a project's KB is DERIVED from the KB whose
  // `binding: { kind: project, ref: <id> }` names it — the descriptor is the
  // source of truth; nothing is stored back. Exact-match on the case-preserving
  // id (`trafficGame` ↔ `trafficGame`). An explicit project.json `kb` (an
  // operator rebind) still wins below.
  const kbBoundToProject = projectKbBindings(forgeRoot);

  return discovered.map((ref) => {
    // W8-C3: `configHealth` starts PESSIMISTIC. Every path below that learns
    // better overwrites it; a path that learns nothing leaves the project
    // honestly marked unconfigured rather than fabricating health. The whole
    // defect this closes was a fail-OPEN default, so the default fails closed.
    const result: ProjectWithMeta = {
      id: ref.id,
      name: ref.id,
      path: ref.path,
      provenance: PROJECT_PROVENANCE,
      configHealth: { state: 'unconfigured', reason: NO_PROJECT_CONFIG_REASON },
      // Derived BEFORE any config short-circuit below: a project whose config
      // is broken or missing is exactly the one whose bindings the operator
      // needs to see in order to fix it.
      localSkills: deriveProjectLocalSkills(projectsDir, basename(ref.absPath)),
    };
    // SEC-04 (bd forge-ebj): every read of a per-project leaf rides `guardedFile`
    // against the TRUSTED `projectsDir` root, with the on-disk project directory
    // NAME (`basename(ref.absPath)`, not the API-facing normalized id) as its OWN
    // `segments[]` element — never folded into the root. A project dir that is a
    // symlink escaping `projectsDir`, or a symlinked/hardlinked leaf
    // (`AGENTS.md`/`demo.lock.json`/`project.json`) inside an otherwise real
    // dir, is refused (`null`) rather than followed off-root. Replaces the
    // former raw `readAgentInstructionsFile(ref.absPath)` + `existsSync`/
    // `readFileSync(join(ref.absPath, …))` sinks that resolved the leaf outside
    // any per-segment identity guard.
    const dirName = basename(ref.absPath);
    // Instructions are single-sourced from the project's AGENTS.md (Stage A):
    // when it exists, its content IS the instructions and the UI binds read-only
    // to it. Read it BEFORE the no-config early-return — an AGENTS.md can precede
    // a full `.forge/project.json` (so a half-onboarded project still surfaces it).
    for (const file of AGENT_INSTRUCTION_FILES) {
      const content = guardedReadFile(projectsDir, [dirName, file]);
      if (content !== null && content.trim()) {
        result.instructions = content.trim();
        result.instructionsSource = file as 'AGENTS.md' | 'CLAUDE.md';
        break;
      }
    }
    const agentFile = result.instructions !== undefined;
    // Locked-demo state (read regardless of project.json) — the demo-builder lock.
    result.hasLockedDemo =
      guardedFile(projectsDir, [dirName, '.forge', 'demo', 'demo.lock.json'], 'read') !== null;
    const derivedKb = kbBoundToProject.get(ref.id);
    if (derivedKb !== undefined) result.kb = derivedKb;
    // `discoverProjects` deliberately lists a directory with no
    // `.forge/project.json` so a half-onboarded project stays VISIBLE. Before
    // W8-C3 it was visible AND indistinguishable from a fully-onboarded one.
    if (!ref.hasConfig) return result;
    const projectJsonRaw = guardedReadFile(projectsDir, [dirName, '.forge', 'project.json']);
    if (projectJsonRaw === null) {
      // `hasConfig` said the file is on disk, so this is a real read failure or
      // a containment refusal (a symlinked config escaping projectsDir) — NOT
      // the same thing as "never onboarded".
      result.configHealth = { state: 'invalid', reason: '.forge/project.json is present but could not be read' };
      return result;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(projectJsonRaw) as Record<string, unknown>;
    } catch (err) {
      result.configHealth = {
        state: 'invalid',
        reason: `.forge/project.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
      return result;
    }
    // The verdict is taken from the REAL validator — with the SAME sidecar
    // injection the orchestrator's own loader performs (review round 1, S1) —
    // and the field extraction below runs REGARDLESS of it: a project whose
    // contract is broken must still be nameable and openable, or the operator
    // cannot go fix it.
    //
    // The sidecar rides the projectsDir-rooted guard: `readQualityGateSidecar`
    // treats its argument as a TRUSTED root, so it is handed the guard's
    // verified realpath for this project dir, never `join(projectsDir,
    // dirName)` — folding a request-derived name into a trusted root is the
    // SEC-04 shape the rest of this function exists to avoid.
    const guardedProjectRoot = resolveGuardedPath(projectsDir, [dirName]);
    const sidecarCmd = guardedProjectRoot.ok && guardedProjectRoot.exists
      ? readQualityGateSidecar(guardedProjectRoot.realPath)
      : null;
    result.configHealth = deriveConfigHealth(raw, sidecarCmd);
    try {
      if (typeof raw.name === 'string' && raw.name.trim()) result.name = raw.name.trim();
      if (typeof raw.northStar === 'string') result.northStar = raw.northStar;
      // W7-FIX-A4: the STORED `kb` outranks the derived binding in BOTH
      // directions — a string is an explicit rebind, an explicit `null` is an
      // explicit UNBIND (the operator cleared the binding in KbBind; see
      // `apps/studio/lib/project-save-payload.ts`). Honouring only the string
      // made the unbind un-stickable: the PUT wrote `kb: null` and the very
      // next roster read handed the derived binding straight back. An ABSENT
      // key (and only an absent key) leaves the derivation live.
      if (typeof raw.kb === 'string') result.kb = raw.kb;
      else if (raw.kb === null) delete result.kb;
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
    } catch (err) {
      // W8-C3: this used to be a SILENT swallow (`catch { /* ignore */ }`) —
      // the exact fail-open shape this WI closes. Every read above is
      // typeof-guarded so a throw here means the config is shaped in a way we
      // genuinely cannot read; say so rather than returning a project that
      // looks healthy. Still per-project: one bad config never sinks the roster.
      result.configHealth = {
        state: 'invalid',
        reason: `.forge/project.json could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** The injected dependencies `GET /api/studio/starters` needs — see the file
 *  header's dependency-injection note (2). `agentCapabilityDescriptor`'s
 *  return type (`AgentCapabilityDescriptor`, `@forge/agents/studio/derive.ts`,
 *  rank 3) is deliberately NOT named here — even a type-only import of it
 *  would be a `package-layer-order` violation the same as a value import
 *  (`scripts/check-boundaries.mjs`'s `tsPreCompilationDeps: true` tracks
 *  type-only edges too). `unknown` is precise enough: this handler only
 *  forwards the value into a response object, never inspects its shape. */
export type StudioStartersDeps = {
  listStarterAgents: (forgeRoot: string) => AgentDefinition[];
  loadStarterFlow: (forgeRoot: string) => FlowDefinition | null;
  agentCapabilityDescriptor: (def: AgentDefinition) => unknown;
};

/**
 * GET /api/studio/starters — the curated OOTB starter agents (ADR-033) the
 * New-Agent picker offers. Same capability-descriptor threading as
 * `GET /api/studio/agents` (R2-02-F1, which stays in `apps/forge/bridge-studio.ts`)
 * — starters carry a real AgentDefinition the builder reads via the same
 * client parser, so the fact must be present here too.
 *
 * Returns a FACTORY, not a bare handler: `listStarterAgents`/`loadStarterFlow`
 * (legacy, `orchestrator/studio/registry.ts`) and `agentCapabilityDescriptor`
 * (`@forge/agents`, rank 3) cannot be imported directly by this rank-2
 * package — see the file header's dependency-injection note (2).
 */
export function createStudioStartersHandler(deps: StudioStartersDeps) {
  return async function handleStudioStarters(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: StudioContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    if (url === '/api/studio/starters' && method === 'GET') {
      try {
        const starters = deps.listStarterAgents(ctx.forgeRoot);
        const flow = deps.loadStarterFlow(ctx.forgeRoot);
        sendJson(
          res,
          200,
          { starters: starters.map((a) => ({ ...a, capability: deps.agentCapabilityDescriptor(a) })), flow },
          origin,
        );
      } catch (err) {
        sendJson(res, 500, { error: sanitizeError(err) }, origin);
      }
      return true;
    }
    return false;
  };
}

/**
 * GET /api/studio/projects/starters (R4-03) — the curated greenfield
 * app-type templates the create form offers. No injected dependency:
 * `listProjectStarters` is its own package.
 */
export async function handleProjectsStarters(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  if (url === '/api/studio/projects/starters' && method === 'GET') {
    try {
      sendJson(res, 200, { appTypes: listProjectStarters(ctx.forgeRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  return false;
}

/**
 * GET /api/studio/projects — the project roster.
 *
 * Returns a FACTORY: `loadProjectsWithMeta` needs `projectKbBindings`
 * injected — see the file header's dependency-injection note (1).
 */
export function createProjectsListHandler(deps: { projectKbBindings: ProjectKbBindingsFn }) {
  return async function handleProjectsList(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: StudioContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    if (url === '/api/studio/projects' && method === 'GET') {
      try {
        const projects = loadProjectsWithMeta(ctx.forgeRoot, deps.projectKbBindings);
        sendJson(res, 200, { projects }, origin);
      } catch (err) {
        sendJson(res, 500, { error: sanitizeError(err) }, origin);
      }
      return true;
    }
    return false;
  };
}
