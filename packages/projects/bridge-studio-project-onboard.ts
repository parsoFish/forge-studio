/**
 * bridge-studio-project-onboard.ts — the create/onboard/update project routes, carved out
 * of `apps/forge/bridge-studio-writes.ts` (M4 §4 step 2, projects lane, worker B):
 *
 *   POST /api/studio/projects/create   (greenfield scaffold, R4-03)
 *   POST /api/studio/projects          (onboard an existing checkout)
 *   PUT  /api/studio/projects/:id      (update .forge/project.json — ALSO
 *                                        answers POST; see below)
 *
 * ORDERING (M4-projects routes budget §D): the generic `:id` regex
 * (`^/api/studio/projects/([^/]+)$`) matches the literal `create` as an id
 * capture. In the legacy if-chain the `create` literal check ran BEFORE the
 * generic `:id` arm, so it always won. Whichever table registers these rows
 * (`packages/projects/routes.ts`, T2's assembly — not this file) MUST list
 * `handleProjectsCreate`'s entry before `handleProjectPut`'s, or a project
 * literally id'd `create` becomes permanently un-updatable via POST — still
 * 200, nothing status-code-visible catches it wrong.
 *
 * `handleProjectPut` ANSWERS BOTH PUT AND POST (carve-rules.md, verified at
 * the original `apps/forge/bridge-studio-writes.ts:2030`): its entry gate is
 * `if (projectMatch && method !== 'DELETE')`, kept verbatim below as
 * defense-in-depth even though the route table (T2's job) should only ever
 * register PUT and POST rows against this handler and never a DELETE row.
 * Two table rows share this ONE handler; a `method: 'PUT'` row alone would
 * silently drop POST support.
 *
 * THREE INJECTED DEPENDENCIES, not direct imports — `OnboardDeps` below.
 * `projects` and `knowledge` are the SAME M4 §0 rank (both rank 2), so this
 * package importing `@forge/knowledge` (`seedProjectBrain`,
 * `checkProjectBrainSeedContainment`, `readArtifactRoot`) is a
 * `package-layer-order` violation — the exact boundary row this carve
 * exists to delete. `flows` is a HIGHER rank (5) than `projects` (2), so
 * `isContainedProjectRepoPath` (`@forge/flows/manifest-path-guard.ts`) is
 * the same violation in the other direction. All three are supplied by the
 * host (`apps/forge/routes.ts`, which `classify()` gives no rule at all) to
 * `makeOnboardHandlers(deps)` at assembly time. `import type` for any of
 * these was considered and rejected: `check-boundaries.mjs` cruises with
 * `tsPreCompilationDeps: true`, which tracks type-only imports as real
 * edges too — so the dep TYPES below are declared structurally, mirroring
 * each function's real signature, rather than imported.
 *
 * Every other line is a byte-for-byte move: same body, same guard order, same
 * comments. The two-phase check-then-write ordering in the onboard handler
 * (SEC-03 round 4) and every path guard in it are load-bearing —
 * `docs/reference/request-path-sinks.md` records five separate incidents in
 * this exact code.
 *
 * `readJson(req)` → `ctx.readBody()`: the ORIGINAL handlers called
 * `readJson` imported from `apps/forge/bridge-studio.ts` — that import is exactly
 * the `package-to-legacy` row this carve deletes. `ctx.readBody()` is the
 * seam's replacement (T1 ruling 30); each handler still calls it AT MOST
 * ONCE per request, same as before — a second call hangs forever, no
 * timeout, since the body stream cannot be read twice.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  discoverProjects,
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  SLUG_RE,
  PROJECT_ID_RE,
  isReservedId,
  resolveGuardedPath,
  PathGuardContainmentError,
  isDryBridge,
  refuseDryBridge,
  type RouteContext,
  guardedFile,
} from '@forge/kernel';

import { runPreflight } from './preflight.ts';
import { scaffoldGreenfieldProject } from './project-create.ts';
import { validateProjectConfig, readAgentInstructionsFile, readQualityGateSidecar, injectSidecarIntoTestProcess } from './project-config.ts';
import { withStudioWrite, saveProjectRepo } from './project-repo-tx.ts';
import { checkContractArtifactContainment, scaffoldContractArtifacts, ScaffoldContainmentError } from './project-contract-scaffold.ts';

/** Structural mirror of `@forge/knowledge/project-brain-seed.ts`'s
 *  `ProjectBrainSeedResult` — not imported (see this file's header). */
type ProjectBrainSeedResult = {
  projectId: string;
  brainDir: string;
  files: { path: string; action: 'created' | 'skipped-existing' }[];
};

/**
 * The three cross-package/cross-rank facts `handleProjectsOnboard` needs,
 * supplied by the host at assembly time instead of imported directly — see
 * this file's header for why each one is here.
 */
export type OnboardDeps = {
  /** `@forge/knowledge`'s `seedProjectBrain`. */
  seedBrain: (forgeRoot: string, projectId: string, name: string) => ProjectBrainSeedResult;
  /** `@forge/knowledge`'s `checkProjectBrainSeedContainment`. Throws
   *  `PathGuardContainmentError` (a real `@forge/kernel` export, imported
   *  above — that part is rank-safe) on rejection. */
  checkBrainSeedContainment: (forgeRoot: string, projectId: string) => void;
  /** `@forge/knowledge`'s `readArtifactRoot`, threaded down into
   *  `project-contract-scaffold.ts`'s injected-parameter functions. */
  readArtifactRoot: (projectRoot: string) => string;
  /** `@forge/flows/manifest-path-guard.ts`'s `isContainedProjectRepoPath`. */
  isContainedProjectRepoPath: (p: string, opts: { forgeRoot: string; projectsRoot?: string }) => boolean;
};

/**
 * W7-B6 (projects-28): "run demo-design" is signalled ONLY when the save
 * genuinely CHANGED demoProcess — presence-as-change tripped the banner on
 * every save because the client always sends the field. Pure decision rule,
 * exported for its direct pin (ADR-042: cli/ is not surface-capped).
 */
export function demoProcessChanged(incoming: unknown, stored: unknown): boolean {
  return Array.isArray(incoming) && JSON.stringify(incoming) !== JSON.stringify(stored ?? null);
}

/**
 * The skills an ONBOARDED project is bound to at scaffold time (bead
 * `forge-8vfn.6.11.13`, T1 rulings 231/233).
 *
 * `ContractReadiness` requires "≥ 1 relevant skill bound" for `data-flow-ready`
 * (`p.skills ?? []`). Every STARTER satisfies it — each declares a
 * `*-conventions` id AND ships it project-local — but this scaffold wrote no
 * `skills` key, so an onboarded project read 4 of 5 and never became flow-ready
 * however green its preflight was. A symmetry gap, not a missing feature.
 *
 * The binding resolves FORGE-WIDE, because an onboarded project has no
 * project-local skills by definition. `checkSkills` allows both sources and
 * `offeredSkills` puts the forge-wide catalog first in the operator's own
 * picker, so this is a default the operator could have chosen by hand;
 * `demo-design` generates the `demoProcess` written below. It AGES CORRECTLY:
 * `checkSkills` looks project-local first, so once the project's own copy is
 * generated the same id resolves there with no rebinding.
 *
 * ONLY WHAT RESOLVES IS WRITTEN, and the suite taught that rather than my
 * reasoning: declaring the id unconditionally turned two `onboard-born-green`
 * cases red, because in a forge root without the library the scaffold wrote a
 * binding that does not resolve — `checkSkills` is HARD, so it had created
 * exactly the LYING BINDING that clause exists to catch. A missing library now
 * yields no `skills` key at all, which is the honest state.
 */
export const ONBOARD_SCAFFOLD_SKILLS: readonly string[] = ['demo-design'];

/** The subset of {@link ONBOARD_SCAFFOLD_SKILLS} that actually resolves under
 *  `forgeRoot` — never a binding this scaffold cannot verify. */
export function resolvableScaffoldSkills(forgeRoot: string): string[] {
  return ONBOARD_SCAFFOLD_SKILLS.filter(
    (id) => guardedFile(forgeRoot, ['skills', id, 'SKILL.md'], 'read') !== null,
  );
}

/**
 * Builds the three create/onboard/update project route handlers. A factory
 * rather than plain exports because `handleProjectsOnboard` needs the three
 * injected dependencies in `OnboardDeps` above.
 */
export function makeOnboardHandlers(deps: OnboardDeps): {
  handleProjectsCreate: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
  handleProjectsOnboard: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
  handleProjectPut: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) => Promise<boolean>;
} {
  // ---- POST /api/studio/projects/create (greenfield, R4-03) ----------------
  // Scaffold a NEW project from a framework template (studio/starters/projects/
  // <app-type>/) + seed the central brain, then preflight. Local file ops only
  // (no spawn, no git-remote) — exempt-local under dry-bridge, like onboard.
  async function handleProjectsCreate(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    if (!(url === '/api/studio/projects/create' && method === 'POST')) return false;

    try {
      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }
      const b = body as Record<string, unknown>;
      const str = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
      const name = str('name');
      const appType = str('appType');
      const northStar = str('northStar');
      if (!name || !appType || !northStar) {
        sendJson(res, 400, { error: 'name, appType and northStar are required' }, origin); return true;
      }
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      let out;
      try {
        out = scaffoldGreenfieldProject({
          manifest: { name, appType, language: str('language') || 'typescript', northStar, ...(str('architecture') ? { architecture: str('architecture') } : {}) },
          forgeRoot: ctx.forgeRoot,
          projectsRoot: projectsDir,
        });
      } catch (err) {
        // Validation / unknown-app-type / duplicate-id are operator errors → 400.
        sendJson(res, 400, { error: sanitizeError(err) }, origin); return true;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          id: out.id,
          appType: out.appType,
          ready: out.hardGreen,
          filesWritten: out.filesWritten.length,
          failingClauses: out.failingClauses.map((c) => ({ id: c.clause, title: c.title, detail: c.detail })),
        },
        origin,
      );
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
  async function handleProjectsOnboard(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    if (!(url === '/api/studio/projects' && method === 'POST')) return false;

    try {
      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
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
      // W7-A4 (projects-30): `new` is the /projects/new onboarding segment —
      // a project named "new" would be permanently shadowed by the form.
      if (isReservedId(id)) { sendJson(res, 400, { error: `project id "${id}" is reserved (the /projects/new onboarding form lives at that path) — choose another name` }, origin); return true; }

      // quality_gate_cmd: accept argv array or a whitespace-split string.
      const toArgv = (v: unknown): string[] | null =>
        Array.isArray(v) ? v.map(String).filter(Boolean)
          : typeof v === 'string' && v.trim() ? v.trim().split(/\s+/) : null;
      const qualityGate = toArgv(b['qualityGateCmd']);
      if (!qualityGate) { sendJson(res, 400, { error: 'qualityGateCmd is required (the project quality-gate command)' }, origin); return true; }


      // Reject a duplicate id by disk scan (B1: projects are discovered, not
      // registered) — but ONLY when that id already carries a real contract
      // (`hasConfig`). Discovery also reports a bare, unonboarded directory
      // (no `.forge/project.json`) under the same id, and that shape is
      // exactly what this route exists to close (forge-8vfn.5.3, S1 beat 3):
      // Studio's own disk scan tells the operator a project is discovered
      // but unfinished, so onboarding a repo the scan already found must not
      // 409 as a conflict with itself. A genuine collision — an id that
      // already has a `.forge/project.json` — still refuses below. Resolve +
      // guard the repo path under the projects root.
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      if (discoverProjects(projectsDir, ctx.forgeRoot).some((p) => p.id === id && p.hasConfig)) {
        sendJson(res, 409, { error: `project "${id}" already exists` }, origin); return true;
      }
      const repoPathRel = typeof b['repoPath'] === 'string' && b['repoPath'].trim() ? b['repoPath'].trim() : `projects/${id}`;
      const projectRoot = resolve(ctx.forgeRoot, repoPathRel);
      // Real per-segment IDENTITY containment (packages/flows/manifest-path-guard.ts's
      // isContainedProjectRepoPath, itself built on cli/studio-path-guard.ts's
      // resolveGuardedPath) — NOT a lexical resolve().startsWith() check. That
      // shape is blind to a symlinked segment whose on-disk TARGET sits
      // outside <forgeRoot>/projects even though its lexical location is
      // inside forgeRoot (SEC-03 Defect 1, live-reproduced: leaf/nested dir
      // symlink, cross-object alias under the same root, repoPath inside
      // forgeRoot but outside projects/). Root is <forgeRoot>/projects, not
      // forgeRoot itself: writeManifest already asserts project_repo_path
      // under that same root, and discoverProjects only scans it — a project
      // created outside projects/ could never run a cycle and would be
      // invisible to the library.
      // R4-17 round-4 (pin 7): the guard checks against `projectsDir` — the
      // root THIS handler already resolved four lines up and used for the
      // duplicate-id scan — instead of re-reading `forge.config.json` inside
      // the guard. Without the pass-through the same handler resolves the
      // projects root TWICE from disk, so a config write landing between the
      // two reads scans one root and validates against another.
      if (!deps.isContainedProjectRepoPath(projectRoot, { forgeRoot: ctx.forgeRoot, projectsRoot: projectsDir })) {
        sendJson(res, 400, { error: 'repo path must resolve inside the forge projects directory' }, origin); return true;
      }

      // SEC-03 Defect 2 (bd forge-q80) — sibling-project clobber. Refuse to
      // onboard when the target already carries a project config: a fresh,
      // non-colliding `name` (so the duplicate-id 409 scan above never fires)
      // whose repoPath points at an ALREADY-ONBOARDED project would otherwise
      // silently overwrite that project's .forge/project.json wholesale,
      // including testProcess.local.cmd — the quality-gate command forge
      // later EXECUTES. Containment alone cannot close this — the victim's
      // directory is genuinely, honestly contained under projects/; this is
      // an application-level invariant (does a project already live here?),
      // checked BEFORE any side effect, same as the containment guard above.
      // 400, not 409: this is a rejected repoPath (same family as the
      // containment check immediately above), and the AT's own sanity
      // assertion requires this request NOT collide with the pre-existing
      // duplicate-id 409 shape (that 409 guards a different invariant — id
      // collision by disk scan — and must stay reserved for it alone).
      if (existsSync(join(projectRoot, '.forge', 'project.json'))) {
        sendJson(res, 400, { error: 'a project already exists at this repo path' }, origin); return true;
      }

      // ---- Phase 1 (SEC-03 round 4, T1's two-phase check-then-write ruling)
      // PURE containment checks — zero side effects on anything
      // request-derived — for EVERY path this route (and the two helpers it
      // calls) will write: `.forge/project.json`, `roadmap.md`,
      // `<artifactRoot>/brain/profile.md`, plus — only when the scaffold's
      // `needsGitInit` decision means it would CREATE the repo — the C2
      // hygiene `.gitignore`, all beneath `projectRoot`
      // (`checkContractArtifactContainment`), and the
      // `brain/projects/<id>/**` targets `seedProjectBrain` owns
      // (`checkProjectBrainSeedContainment`). A rejection from either check
      // returns here with NOTHING request-derived on disk anywhere.
      //
      // WHY THIS REPLACES "seed the brain first" (round 3): round 3 made
      // `seedProjectBrain` — a WRITING operation — run before every
      // project-directory write, which closed the containment-rejection
      // scenario (nothing under `projectRoot` yet when it throws) but not an
      // UNRELATED failure AFTER it succeeded: EACCES on this route's own
      // `mkdirSync(projectRoot)` left a fully-formed, orphaned
      // `brain/projects/<id>/kb.yaml` behind — a phantom KB, invisible to
      // `discoverProjects` (scans `projects/` only) but VISIBLE to
      // `loadKbDescriptors` (`packages/knowledge/bridge-studio-kbs.ts`), which walks
      // `brain/projects/` as its own second containment root. Moving the
      // orphan is not removing it. Separating the CHECK from the WRITE
      // removes the ordering question entirely: no write on this route can
      // even be ATTEMPTED before every path any of them touch is proven
      // safe, so `seedProjectBrain` can be restored to writing where it
      // always made most sense — after the project directory exists.
      try {
        checkContractArtifactContainment(projectRoot, ctx.forgeRoot, deps.readArtifactRoot, qualityGate);
      } catch (err) {
        if (err instanceof ScaffoldContainmentError) {
          sendJson(res, 400, { error: 'path containment check failed' }, origin); return true;
        }
        throw err;
      }
      try {
        deps.checkBrainSeedContainment(ctx.forgeRoot, id);
      } catch (err) {
        if (err instanceof PathGuardContainmentError) {
          sendJson(res, 400, { error: 'path containment check failed' }, origin); return true;
        }
        throw err;
      }

      // ---- Phase 2 — writes, in the ORIGINAL order (restored, SEC-03
      // round 4): mkdirSync(projectRoot) → .forge/project.json's own guard →
      // scaffoldContractArtifacts → seedProjectBrain → the project.json
      // write itself. Every path below was already containment-checked in
      // Phase 1 above; the per-write guards that remain (Defect 5,
      // scaffoldContractArtifacts's own, seedProjectBrain's own) are kept as
      // defense in depth — this function never writes through a path it has
      // not itself just re-verified, whether or not Phase 1 already ran. ----

      // SEC-03 Defect 5 (BLOCKER): validating projectRoot's own identity
      // (the isContainedProjectRepoPath check above) does not validate what
      // this route writes BENEATH it — see that section's own history for
      // the full writeup. resolveGuardedPath realpaths `root`
      // unconditionally — it has no create-mode for root itself — so
      // projectRoot must physically exist before this guard call can run.
      // Safe to create here: the isContainedProjectRepoPath call above just
      // walked every segment of this exact path with genuine realpath
      // identity checks (not a lexical prefix test), so materializing the
      // directory it already proved is contained introduces no new escape.
      if (!existsSync(projectRoot)) mkdirSync(projectRoot, { recursive: true });

      const forgeGuard = resolveGuardedPath(projectRoot, ['.forge', 'project.json']);
      if (!forgeGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin); return true;
      }

      // B3: scaffold the C4 artifacts the architect/PM need so a freshly
      // onboarded project is preflight-green (or at least clear about what is
      // missing). All writes are idempotent — never clobber an existing
      // operator file, and the stubs are clearly marked as TODO scaffolding.
      // scaffoldContractArtifacts computes its OWN per-segment guards
      // (roadmap.md, brain/profile.md) BEFORE either of its writes — see its
      // docstring — and throws ScaffoldContainmentError, never a silent
      // skip, on rejection. Fail closed here too: refuse before ANY of this
      // route's remaining writes (including the .forge/project.json write
      // below), never surface it as an unrelated 500.
      let scaffoldedLocal: string[];
      try {
        scaffoldedLocal = scaffoldContractArtifacts(projectRoot, name, ctx.forgeRoot, deps.readArtifactRoot, { id, qualityGateCmd: qualityGate });
      } catch (err) {
        if (err instanceof ScaffoldContainmentError) {
          sendJson(res, 400, { error: 'path containment check failed' }, origin); return true;
        }
        throw err;
      }

      // Phase 5 §8 / SEC-03 round 4: seed the project's CENTRAL Brain-3 stub
      // (kb.yaml + profile.md + themes/) — restored to its ORIGINAL
      // position, after the project-directory scaffolding above and before
      // the .forge/project.json write below (see the Phase 1 comment above
      // for why this ordering question no longer matters for containment:
      // every path either write touches was already proven safe before
      // Phase 2 started). Idempotent per file (never clobbers an
      // operator-authored brain). `seedProjectBrain` re-runs
      // `checkProjectBrainSeedContainment` itself (single source of truth,
      // see that module) rather than trusting Phase 1's result blindly.
      let brainSeed: ProjectBrainSeedResult;
      try {
        brainSeed = deps.seedBrain(ctx.forgeRoot, id, name);
      } catch (err) {
        if (err instanceof PathGuardContainmentError) {
          sendJson(res, 400, { error: 'path containment check failed' }, origin); return true;
        }
        throw err;
      }

      // R4-02-F3: bind the project to its central KB — but ONLY if the seeded
      // kb.yaml is genuinely on disk (buildKbYaml binds it to id === this
      // project id; a fresh create rejected a duplicate id above, so no
      // divergent pre-existing kb.yaml). If the seed somehow didn't land the
      // KB, leave the binding null rather than advertise a non-existent KB.
      // Closes known-gaps §4.3(a)/(d): ContractReadiness shows a real bound KB.
      const kbBound = existsSync(join(brainSeed.brainDir, 'kb.yaml')) ? id : null;

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
        // R1-03-F1: the typed test process is the one JSON source of the gate
        // fields (flat keys are rejected by the validator). The legacy `demo`
        // block (shape/command) had no reader and is no longer scaffolded.
        testProcess: { local: { cmd: qualityGate } },
        kb: kbBound,
      };
      // Ruling 231/233: an onboarded project binds the same default the
      // operator's own picker offers first, so it can reach flow-ready — but
      // only when the binding RESOLVES (see ONBOARD_SCAFFOLD_SKILLS).
      const scaffoldSkills = resolvableScaffoldSkills(ctx.forgeRoot);
      if (scaffoldSkills.length > 0) cfg.skills = scaffoldSkills;

      try { validateProjectConfig(cfg); }
      catch (err) { sendJson(res, 400, { error: String(err) }, origin); return true; }

      // Write through the ALREADY-GUARDED real path (forgeGuard.realPath),
      // not a fresh unguarded resolve(projectRoot, '.forge', 'project.json')
      // — reusing the guarded value end-to-end means there is no second,
      // unguarded path construction for this write to slip through.
      const forgeDirPath = dirname(forgeGuard.realPath);
      if (!existsSync(forgeDirPath)) mkdirSync(forgeDirPath, { recursive: true });
      writeFileSync(forgeGuard.realPath, JSON.stringify(cfg, null, 2), 'utf8');

      const scaffolded = [
        ...scaffoldedLocal,
        ...brainSeed.files.filter((f) => f.action === 'created').map((f) => f.path),
      ];

      // Re-run preflight and surface the clauses that still fail so the UI can
      // either celebrate (ready) or hand off to forge-onboard-project.
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const failing = report.clauses
        .filter((c) => c.hard && !c.pass)
        .map((c) => ({ id: c.clause, title: c.title, detail: c.detail }));

      sendJson(
        res,
        200,
        { ok: true, id, ready: report.ok, scaffolded, brainSeed: brainSeed.files, failingClauses: failing },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- PUT /api/studio/projects/:id (also answers POST; see this file's
  // header) ----------------------------------------------------------------
  async function handleProjectPut(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RouteContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    const url = pathOnly(rawUrl);
    const origin = allowedOrigin(req);
    const projectMatch = url.match(/^\/api\/studio\/projects\/([^/]+)$/);
    // W7-B4: DELETE now passes this handler's entry gate (agents/flows grew
    // delete routes) — projects deliberately have no delete surface here, so a
    // DELETE must fall through as unhandled (404), never enter the PUT logic.
    if (!(projectMatch && method !== 'DELETE')) return false;

    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/studio/projects/:id', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
    try {
      const id = decodeURIComponent(projectMatch[1]);

      // 1. Validate id before any fs operation (W7-A4: the case-preserving
      //    directory name, matched exactly — PROJECT_ID_RE)
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: `invalid project id — must match ${PROJECT_ID_RE}` }, origin);
        return true;
      }

      // 2. Resolve the project by disk scan (B1: auto-discovered from disk).
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
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
      // Guard `.forge/project.json` through the shared containment guard
      // (cli/studio-path-guard.ts) instead of a lexical
      // `startsWith(projectRoot + sep)` check — a symlinked `.forge` dir or a
      // hardlinked project.json both passed that trivially (verified live,
      // BLOCKER). `exists` also replaces the separate `existsSync` calls
      // below so both agree on the same resolved path.
      const pathGuard = resolveGuardedPath(projectRoot, ['.forge', 'project.json']);
      if (!pathGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const projectJsonPath = pathGuard.realPath;

      // 4. Parse request body
      let body: unknown;
      try {
        body = await ctx.readBody();
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
      if (pathGuard.exists) {
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

      // 6. Validate the merged config (throws on invalid). Single-source the
      // quality gate from the `.forge/quality_gate_cmd` sidecar for validation
      // ONLY (same as loadProjectConfig) — a project that declares the gate in
      // the sidecar legitimately omits it from project.json, so validate a copy
      // with the sidecar injected, but write `merged` unchanged (no mirror).
      const forValidation: Record<string, unknown> = { ...merged };
      {
        // ONE shared rule with the loader (injectSidecarIntoTestProcess) —
        // the predicates previously diverged (review finding: a
        // sidecar-sourced config declaring only local.timeoutMs loaded fine
        // but 400'd every Studio save).
        const sidecar = readQualityGateSidecar(projectRoot);
        if (sidecar) injectSidecarIntoTestProcess(forValidation, sidecar);
      }
      try {
        validateProjectConfig(forValidation);
      } catch (err) {
        sendJson(res, 400, { error: String(err) }, origin);
        return true;
      }

      // 7. Write back (pretty, 2-space), committed to the project's forge-studio branch.
      // Derive from the ALREADY-GUARDED real path, not a fresh lexical join.
      const forgeDir = dirname(projectJsonPath);
      if (!existsSync(forgeDir)) {
        mkdirSync(forgeDir, { recursive: true });
      }
      withStudioWrite(
        projectRoot,
        'forge-studio: update .forge/project.json',
        () => writeFileSync(projectJsonPath, JSON.stringify(merged, null, 2), 'utf8'),
        ['.forge/project.json'],
      );

      // R1-2: a "Save project" is the ONE durable save — merge the accumulated
      // forge-studio changes (this config edit + any preflight/instructions/demo
      // writes) into the default branch + push. Best-effort: the config is
      // already safe on forge-studio, so a merge/push failure (e.g. protected
      // main) doesn't fail the save — it's surfaced in `save`.
      let save: { merged: boolean; pushed: boolean; detail: string } | undefined;
      try { save = saveProjectRepo(projectRoot); } catch (err) { save = { merged: false, pushed: false, detail: sanitizeError(err) }; }

      // F5: when demoProcess CHANGED in this save, signal that the demo-design
      // skill should be run to generate per-project demo machinery. The UI
      // surfaces this as data-demo-design-state="needed" on the project page
      // so the operator can trigger: `forge run skill demo-design --project <id>`.
      // W7-B6 (projects-28): the client always sends demoProcess, so mere
      // PRESENCE tripped the banner after every save (a north-star-only edit
      // included) — compare against what was stored instead.
      const demoDesignNeeded = demoProcessChanged(b['demoProcess'], existingRaw['demoProcess']);

      sendJson(res, 200, { ok: true, id, ...(save ? { save } : {}), ...(demoDesignNeeded ? { demoDesignNeeded: true } : {}) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return { handleProjectsCreate, handleProjectsOnboard, handleProjectPut };
}
