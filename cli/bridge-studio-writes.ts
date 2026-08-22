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
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import yaml from 'js-yaml';

import { classifyClause } from './preflight-resolve.ts';
import { applyPreflightAutoFixes } from './preflight-fix-auto.ts';
import { ensureStudioBranch, commitStudioChange, withStudioWrite, saveProjectRepo } from '../orchestrator/project-repo-tx.ts';
import type { ClauseResult } from './preflight.ts';

import {
  listAgentDefinitions,
  listStarterAgents,
  loadAgentDefinition,
  loadCatalog,
  loadFlowDefinition,
  discoverProjects,
  serializeAgentDefinition,
  serializeFlowDefinition,
  listFlowIds,
  isStudioAgent,
} from '../orchestrator/studio/registry.ts';
import { listSkillLibrary } from '../orchestrator/studio/skill-library.ts';
import { checkHookComposition, listHookIds } from '../orchestrator/studio/hook-library.ts';
import { communityRegistryPath, loadCommunityRegistry, serializeCommunityRegistry } from '../orchestrator/studio/registry.ts';
import type { CommunityRegistryItem } from '../orchestrator/studio/types.ts';
import { PLATFORM_GUARD_IDS } from '../orchestrator/agent-bands.ts';
import { skillsDir as toSkillsDir, assertSkillSlug } from '../orchestrator/skill-path.ts';
import { resolveGuardedPath, guardedFile, guardedWriteFile, PathGuardContainmentError } from './studio-path-guard.ts';
import type { AgentDefinition, FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE, PROJECT_ID_RE, isReservedId, validateAgent, validateFlow } from '../orchestrator/studio/validate.ts';
import { MAX_MATERIALS_LENGTH } from '../orchestrator/studio/materials.ts';
import { validateProjectConfig, readAgentInstructionsFile, readQualityGateSidecar, injectSidecarIntoTestProcess } from '../orchestrator/project-config.ts';
import { readArtifactRoot } from '../orchestrator/brain-paths.ts';
import { seedProjectBrain, checkProjectBrainSeedContainment } from '../orchestrator/project-brain-seed.ts';
import { scaffoldGreenfieldProject } from '../orchestrator/project-create.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { runPreflight, SCRATCH_PATHS, SCAFFOLD_BUILD_OUTPUT_IGNORES } from './preflight.ts';
import { isContainedProjectRepoPath } from './manifest-path-guard.ts';
import { isDryBridge, refuseDryBridge, dryBridgeAgentTurnMarker } from './dry-bridge.ts';
import { cachedListRuns } from './run-list-cache.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
// W7-B3 review F8: ONE decode-and-slug-validate helper for community-item URL
// ids — the community routes' own, not a local re-implementation (its
// malformed-%-encoding branch answers a distinct, friendlier 400).
import { decodeIdOrRespond } from './bridge-studio-community.ts';

// ---------------------------------------------------------------------------
// C4 contract-artifact scaffolding (B3)
// ---------------------------------------------------------------------------

/**
 * Thrown by `scaffoldContractArtifacts` when a per-segment containment guard
 * (`resolveGuardedPath`) rejects one of its writes (SEC-03 Defect 5). Caught
 * by its one caller and turned into a generic 400 — never allowed to fall
 * through to the route's outer catch-all, which would report a security
 * rejection as an unrelated 500. Not exported: internal to this module,
 * mirroring `PathGuardReject.reason` never reaching the client.
 */
class ScaffoldContainmentError extends Error {}

/** One of `contractArtifactTargets`'s two markdown targets (`roadmap.md`,
 *  `<artifactRoot>/brain/profile.md`). The scaffold's third, CONDITIONAL
 *  write target — the C2 hygiene `.gitignore`, written only on the branches
 *  that create the repo (`needsGitInit`) — is not one of these: its write
 *  condition depends on the git-init decision, so it is guarded inline at
 *  its write site and mirrored by the same `needsGitInit` predicate in the
 *  pre-check. */
type ContractArtifactTarget = {
  /** Segments passed to `resolveGuardedPath(projectRoot, segments)`. */
  segments: readonly string[];
  /** Absolute, plain-joined path — for the symlink-following `existsSync`
   *  idempotency probe only, never for reading/writing directly. */
  absPath: string;
  /** Relative path (project-root-relative, forward-slash) for reporting. */
  relPath: string;
};

/**
 * SINGLE SOURCE OF TRUTH for `scaffoldContractArtifacts`'s two UNCONDITIONAL
 * write targets (`roadmap.md`, `<artifactRoot>/brain/profile.md`) beneath
 * `projectRoot`. Both `scaffoldContractArtifacts` itself (the write) and
 * `checkContractArtifactContainment` (the pure Phase-1 pre-check on `POST
 * /api/studio/projects`, below) compute their target paths from THIS
 * function — one path set, not two that could drift apart (SEC-03 round 4).
 *
 * W7-FIX-B-PROJ: the scaffold has a THIRD write target this function does
 * NOT own — the C2 hygiene `.gitignore`, written ONLY when the scaffold
 * itself creates the repo. Its write condition is the `needsGitInit`
 * three-way git probe (a side-effecting decision this pure path-set function
 * must not absorb), so check/write parity for it is kept by both sites
 * calling the SAME `needsGitInit` predicate instead. Anyone enumerating the
 * route's full write set (docs/security-request-path-audit.md defers to
 * these comments): `.forge/project.json` + the two targets below + the
 * conditional `.gitignore`.
 */
function contractArtifactTargets(projectRoot: string): { roadmap: ContractArtifactTarget; profile: ContractArtifactTarget } {
  // `readArtifactRoot` already rejects an absolute value, a backslash, or a
  // literal '..' component in the RAW string — but a legitimate
  // multi-component value (e.g. "sub/dir") must still be split into
  // INDIVIDUAL segments[] elements before reaching resolveGuardedPath: a
  // segment containing '/' fails `isSafeSegment` outright, so folding it as
  // ONE element would always be rejected rather than silently under-checked.
  const artifactRoot = readArtifactRoot(projectRoot);
  const artifactSegments = artifactRoot === '.' ? [] : artifactRoot.split('/').filter((s) => s.length > 0 && s !== '.');
  const profileRel = artifactRoot === '.' ? join('brain', 'profile.md') : join(artifactRoot, 'brain', 'profile.md');
  return {
    roadmap: { segments: ['roadmap.md'], absPath: join(projectRoot, 'roadmap.md'), relPath: 'roadmap.md' },
    profile: {
      segments: [...artifactSegments, 'brain', 'profile.md'],
      absPath: join(projectRoot, ...artifactSegments, 'brain', 'profile.md'),
      relPath: profileRel.split(sep).join('/'),
    },
  };
}

/**
 * The three-way git-init decision (W7-B6 + review F4) — SHARED between
 * `scaffoldContractArtifacts` (which acts on it: `git init` + the C2
 * `.gitignore`) and `checkContractArtifactContainment` (which must guard
 * exactly the writes that decision implies — review F2's check/write
 * parity). Pure probe: reads git state, writes nothing.
 *
 *   - projectRoot IS its own work-tree root  → false (own repo governs);
 *   - enclosed by FORGE's own work tree      → true  (the gitignored
 *     projects/ case — the project must not inherit forge);
 *   - enclosed by any OTHER repo             → false (the operator's real
 *     repo governs; never nest a .git inside it);
 *   - in no repo at all                      → true.
 */
function needsGitInit(projectRoot: string, forgeRoot: string): boolean {
  try {
    const toplevel = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    );
    if (toplevel === realpathSync(projectRoot)) return false; // already its own repo
    let forgeToplevel: string | null = null;
    try {
      forgeToplevel = realpathSync(
        execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: forgeRoot, encoding: 'utf8' }).trim(),
      );
    } catch {
      forgeToplevel = null; // forge root not in a repo (test fixtures) — the enclosing repo cannot be forge's
    }
    return forgeToplevel !== null && toplevel === forgeToplevel;
  } catch {
    return true; // not in any repo at all
  }
}

// ---------------------------------------------------------------------------
// w8-a1 (bead forge-7pa) — the package.json CONDITIONAL FOURTH scaffold
// target.
//
// cli/preflight.ts's checkC1 (READ ONLY from this module — that file is
// outside this worker's fence) now fails a package-manager-shaped quality
// gate (`npm`/`yarn`/`pnpm`/`npx`/`bun`/`bunx` as the first token) when the
// project dir has no package.json: with none there, npm's own ancestor-
// package.json walk resolves the command against an ENCLOSING package.json
// (forge's own root, when the project lives under forge's `projects/`) — a
// false green on the wrong repo, the exact defect this campaign closes. The
// onboarding form's own default gate is `npm test`, so tightening C1 alone
// left every from-scratch JS project born hard-failing (bd forge-7pa,
// `cli/onboard-born-green.test.ts`).
//
// `isPackageManagerShaped`/`resolveScriptName` below are DELIBERATE,
// byte-for-byte mirrors of the same-named functions in `cli/preflight.ts`
// (its own `checkC1`, `PACKAGE_MANAGER_TOKENS`, `PM_NATIVE_SUBCOMMANDS`).
// preflight.ts does not export either — it is outside this worker's fence
// and must not be edited — so this is a deliberate, narrow duplication
// rather than a shared import; a drift between the two would silently
// re-break the invariant (the scaffold writing a package.json C1 doesn't
// recognise, or a C1-recognised shape the scaffold fails to script-name).
const PACKAGE_MANAGER_TOKENS = new Set(['npm', 'yarn', 'pnpm', 'npx', 'bun', 'bunx']);

/** True iff `cmd`'s first token invokes a package manager (case-insensitive).
 *  Mirrors `cli/preflight.ts`'s `isPackageManagerShaped` exactly. */
function isPackageManagerShaped(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? '';
  return PACKAGE_MANAGER_TOKENS.has(first.toLowerCase());
}

// pm-native verbs a bare `yarn <token>` / `pnpm <token>` must NOT be mistaken
// for a project script name. Mirrors `cli/preflight.ts`'s
// `PM_NATIVE_SUBCOMMANDS` exactly.
const PM_NATIVE_SUBCOMMANDS = new Set([
  'run', 'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'upgrade', 'up',
  'exec', 'dlx', 'init', 'publish', 'link', 'unlink', 'list', 'ls', 'outdated', 'audit', 'why',
  'info', 'view', 'config', 'cache', 'prune', 'pack', 'create', 'dedupe', 'patch', 'patch-commit',
  'patch-remove', 'deploy', 'rebuild', 'store', 'server', 'root', 'licenses', 'doctor', 'setup',
  'tag', 'team', 'owner', 'policies', 'import', 'global', 'node', 'env', 'workspace', 'workspaces',
  'login', 'logout', 'whoami', 'version', 'versions', 'help', '-v', '--version', '-h', '--help',
]);

/**
 * Resolves the package.json `scripts` key a declared gate would invoke, or
 * `null` when the shape can't be mapped to one. Mirrors `cli/preflight.ts`'s
 * `resolveScriptName` exactly — SAME mapped shapes: bare `npm test`/
 * `yarn test`/`pnpm test` → "test"; `npm run <name>`/`yarn run <name>`/
 * `pnpm run <name>` → "<name>"; `yarn <name>`/`pnpm <name>` (name not a known
 * pm subcommand) → "<name>". `npx`/`bunx`/`bun` and anything else → null.
 */
function resolveScriptName(cmd: string): string | null {
  const toks = cmd.trim().split(/\s+/).filter(Boolean);
  const runner = (toks[0] ?? '').toLowerCase();
  if (runner !== 'npm' && runner !== 'yarn' && runner !== 'pnpm') return null;
  const first = (toks[1] ?? '').toLowerCase();
  if (!first) return null;
  if (first === 'test') return 'test';
  if (first === 'run') return toks[2] ?? null;
  if (runner !== 'npm' && !PM_NATIVE_SUBCOMMANDS.has(first)) return toks[1]!;
  return null;
}

/**
 * True iff `scaffoldContractArtifacts` would write a package.json at
 * `projectRoot`'s root for the given declared quality-gate argv. SHARED
 * between the writer (its own write site, below) and
 * `checkContractArtifactContainment` (the pure pre-check) — the SAME
 * predicate the `.gitignore`/`needsGitInit` precedent uses, so the guard and
 * the write can never disagree about when this file is created:
 *
 *   - no declared gate, or its command is NOT package-manager-shaped → false
 *     (scoped to the C1 npm/yarn/pnpm/npx/bun/bunx shape — never a blanket
 *     "every project gets a package.json");
 *   - `projectRoot/package.json` already exists                     → false
 *     (never clobber an operator's file — same rule as roadmap.md);
 *   - `needsGitInit(projectRoot, forgeRoot)` is false                → false
 *     (the THIRD conjunct — never litter into a repo forge did not itself
 *     just create: an operator onboarding their OWN existing checkout — own
 *     work-tree root, or enclosed by their own non-forge repo — with the
 *     onboarding form's JS-shaped default gate left in place must get C1's
 *     honest, actionable failure ("add a package.json … or declare a gate
 *     that does not shell out to a package manager"), not a fabricated
 *     package.json dropped into a repo whose language it may not even
 *     match. Mirrors the SAME `.gitignore` precedent one bullet up — that
 *     hygiene file is likewise written ONLY on the branches that create the
 *     repo);
 *   - otherwise                                                      → true.
 */
function needsPackageJsonScaffold(
  projectRoot: string,
  forgeRoot: string,
  qualityGateCmd: readonly string[] | undefined,
): boolean {
  if (!qualityGateCmd || qualityGateCmd.length === 0) return false;
  if (!isPackageManagerShaped(qualityGateCmd.join(' '))) return false;
  if (existsSync(join(projectRoot, 'package.json'))) return false;
  return needsGitInit(projectRoot, forgeRoot);
}

/**
 * PURE containment pre-check (SEC-03 round 4, T1's two-phase
 * check-then-write ruling) for every path `POST /api/studio/projects`
 * writes beneath `projectRoot`: `.forge/project.json` (this route's own
 * write), the C2 hygiene `.gitignore` (W7-FIX-B-PROJ — but ONLY when the
 * scaffold's `needsGitInit` decision says the repo would be created by this
 * onboard, the sole condition under which the scaffold writes it; review F2:
 * guarding it unconditionally false-rejected own-repo checkouts carrying a
 * dangling-symlink `.gitignore` the route was never going to touch), the
 * w8-a1 conditional `package.json` (`needsPackageJsonScaffold` — same
 * shared-predicate shape as `.gitignore`), plus `scaffoldContractArtifacts`'s
 * two unconditional targets (`roadmap.md`, `<artifactRoot>/brain/
 * profile.md`), computed via the SAME `contractArtifactTargets`
 * `scaffoldContractArtifacts` itself uses. Zero side effects: no
 * `mkdirSync`, no `writeFileSync`.
 *
 * When `projectRoot` does not exist yet (the common brand-new-onboard
 * case), nothing beneath it could carry a pre-planted symlink —
 * `resolveGuardedPath` has no create-mode for `root` itself and would
 * reject a legitimately-absent directory outright — so this returns
 * immediately; `projectRoot`'s OWN identity is validated separately by the
 * caller's `isContainedProjectRepoPath` check, which does not require it to
 * exist. When `projectRoot` already exists (onboarding an existing
 * checkout), every target below is containment-checked before any write on
 * the route runs. Throws `ScaffoldContainmentError` on rejection — the same
 * class the write-time guards throw, so one catch clause at the call site
 * covers both.
 */
function checkContractArtifactContainment(projectRoot: string, forgeRoot: string, qualityGateCmd?: readonly string[]): void {
  if (!existsSync(projectRoot)) return;

  const forgeJsonPath = join(projectRoot, '.forge', 'project.json');
  if (!existsSync(forgeJsonPath)) {
    const guard = resolveGuardedPath(projectRoot, ['.forge', 'project.json']);
    if (!guard.ok) throw new ScaffoldContainmentError('path containment check failed while checking .forge/project.json');
  }

  // W7-FIX-B-PROJ: `.gitignore` joined the scaffold's write set (the C2
  // hygiene file written when scaffoldContractArtifacts creates the repo) —
  // the pure pre-check must cover EVERY path the route may write. Review F2:
  // and ONLY those — the scaffold writes `.gitignore` solely on the
  // `needsGitInit` branches, so the guard mirrors the SAME predicate; an
  // own-repo / operator-enclosed checkout's `.gitignore` (dangling symlink
  // or not) is never written and therefore never guarded (the Finding-B
  // rule below: guard the paths you WRITE, not the paths you merely probe).
  if (needsGitInit(projectRoot, forgeRoot) && !existsSync(join(projectRoot, '.gitignore'))) {
    const guard = resolveGuardedPath(projectRoot, ['.gitignore']);
    if (!guard.ok) throw new ScaffoldContainmentError('path containment check failed while checking .gitignore');
  }

  // w8-a1: `package.json` joined the scaffold's write set as its CONDITIONAL
  // FOURTH target — written only when `needsPackageJsonScaffold` says so
  // (the declared gate is package-manager-shaped, no package.json already
  // exists, AND the scaffold would itself be creating the repo — never into
  // an operator's own pre-existing checkout). Same Finding-B rule as
  // `.gitignore` immediately above: guard ONLY the paths the route may
  // actually write, via the SAME shared predicate the write site uses, so a
  // project whose package.json will never be written is never false-rejected
  // here.
  if (needsPackageJsonScaffold(projectRoot, forgeRoot, qualityGateCmd)) {
    const guard = resolveGuardedPath(projectRoot, ['package.json']);
    if (!guard.ok) throw new ScaffoldContainmentError('path containment check failed while checking package.json');
  }

  const { roadmap, profile } = contractArtifactTargets(projectRoot);
  for (const target of [roadmap, profile]) {
    if (existsSync(target.absPath)) continue; // already there — idempotent skip, nothing to guard
    const guard = resolveGuardedPath(projectRoot, target.segments);
    if (!guard.ok) throw new ScaffoldContainmentError(`path containment check failed while checking ${target.relPath}`);
  }
}

/**
 * Idempotently scaffold the machine-readable architecture context the C4
 * preflight clause requires: a `roadmap.md` at the project root and the
 * project's brain sub-wiki `profile.md` (under the project.json `artifactRoot`,
 * default `.`). Each file is written ONLY if absent — an existing operator file
 * is never clobbered. The stubs are clearly marked as TODO scaffolding so a
 * hollow roadmap is never written silently. A git repo is initialised when
 * the dir has no legitimate repo of its own — its OWN work tree and an
 * enclosing NON-forge repo both count as legitimate; only "no repo" or
 * "inside forge's own work tree" init (C6/preflight needs a git surface;
 * see the three-way rule at the probe below, W7-B6 review F4).
 *
 * SEC-03 Defect 5: validating `projectRoot`'s own identity (the caller's
 * `isContainedProjectRepoPath` check) does not validate what gets written
 * BENEATH it — a plain `resolve(projectRoot, 'roadmap.md')` follows a
 * symlinked or hardlinked segment straight through. Every path this function
 * writes through is resolved via `resolveGuardedPath` (studio-path-
 * guard.ts), with `projectRoot` as the TRUSTED, already-verified root and
 * every path component (including every `artifactRoot` component — see
 * below) its OWN `segments[]` element, never folded into `root` (see that
 * module's CONTRACT section: folding an untrusted segment into `root`
 * bypasses the per-segment identity walk entirely). A rejection throws
 * `ScaffoldContainmentError` rather than silently skipping the write (a
 * skipped write reported as success is the "declared data fails open" shape
 * this campaign keeps finding).
 *
 * SEC-03 Finding B (round-2 adversarial review) — the Defect-5 fix above
 * ran BOTH guards unconditionally, before either file's own `!exists`
 * idempotency check. `resolveGuardedPath` rejects any EXISTING leaf with
 * `nlink !== 1`, so an ordinary, harmless, wholly-in-forgeRoot hardlinked
 * `roadmap.md`/`brain/profile.md` (the kind `cp -al`/dedup/cache tooling
 * produces routinely) false-rejected the WHOLE onboard — on a path this
 * function was only ever going to SKIP, never write. T1's rule: guard the
 * paths you WRITE, not the paths you merely test for existence. Each file
 * below now probes existence FIRST with a plain, symlink-following
 * `existsSync` (the idempotency contract's actual meaning), and invokes the
 * containment guard ONLY when the file is genuinely absent — a dangling
 * symlink still reads as absent here (existsSync follows it to a target
 * that isn't there), so it still reaches the guard and is still rejected
 * (Defect 5 stays closed); an already-existing leaf (hardlinked or not)
 * never reaches `resolveGuardedPath` at all, so it can never be
 * false-rejected for a write that was never going to happen.
 *
 * w8-a1 (bd forge-7pa): a CONDITIONAL FOURTH target, `package.json`, joins
 * the write set — mirroring the `.gitignore` precedent exactly rather than
 * `roadmap.md`/`profile.md`'s unconditional pair: written only when
 * `needsPackageJsonScaffold(projectRoot, forgeRoot, opts.qualityGateCmd)`
 * says so (the declared gate is package-manager-shaped, no package.json
 * already exists, AND this call is itself the one creating the repo — the
 * SAME `needsGitInit` conjunct `.gitignore` uses, so an operator's own
 * pre-existing checkout never gets a fabricated package.json), guarded
 * inline at its own write site through the SAME
 * `resolveGuardedPath(projectRoot, ['package.json'])` call every other
 * leaf here uses (the leaf itself included — a dangling or symlinked
 * package.json is REFUSED, never written through).
 *
 * Returns the list of relative paths actually created (empty if everything was
 * already present), so the caller can tell the operator what it touched.
 */
export function scaffoldContractArtifacts(
  projectRoot: string,
  name: string,
  forgeRoot: string,
  opts: { id?: string; qualityGateCmd?: readonly string[] } = {},
): string[] {
  const created: string[] = [];

  // git init decision — three-way, not a boolean. W7-B6 (projects-11): the
  // original probe (`rev-parse --is-inside-work-tree`) reports true for ANY
  // dir inside an enclosing repo — `projects/` lives inside the forge work
  // tree, so every freshly onboarded project silently inherited FORGE's own
  // git repo (C2/C6 then evaluated against the wrong repo, and dev-loop
  // branches/commits would land in forge's history). W7-B6 review F4: the
  // first fix ("init unless projectRoot is ITSELF the work-tree root")
  // overcorrected — a subdirectory of an operator's REAL cloned repo (a
  // monorepo package onboarded as the repoPath, contained under projects/)
  // got a fresh empty repo NESTED inside their checkout, repointing every
  // subsequent forge git operation at a history-less repo. The honest rule:
  //   - projectRoot IS its own work-tree root            → skip (own repo);
  //   - enclosed by FORGE's own work tree                → init (the
  //     gitignored-projects/ case — the project must not inherit forge);
  //   - enclosed by any OTHER repo                       → skip (the
  //     operator's real repo governs; never nest a .git inside it);
  //   - in no repo at all                                → init.
  // The probe itself is `needsGitInit` above — SHARED with the pure
  // pre-check so the `.gitignore` guard and the `.gitignore` write can never
  // disagree about when the write happens (review F2).
  const needsInit = needsGitInit(projectRoot, forgeRoot);
  // w8-a1: decided HERE, before the mutating `git init` a few lines below —
  // `needsPackageJsonScaffold` calls `needsGitInit` internally, and calling
  // it again AFTER `git init` has already run would see `projectRoot` as
  // its OWN repo by then (the "already its own repo" branch) and silently
  // flip to false, even on the from-nothing onboard this whole change exists
  // to fix. Cached once, at the same pre-mutation instant `needsInit` above
  // was computed, and reused verbatim at the write site below — never
  // re-queried after the side effect.
  const scaffoldPackageJson = needsPackageJsonScaffold(projectRoot, forgeRoot, opts.qualityGateCmd);
  let repoInited = false;
  if (needsInit) {
    try {
      execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
      created.push('.git/');
      repoInited = true;
    } catch {
      // git unavailable or dir not writable — preflight will surface C6.
    }
    // W7-FIX-B-PROJ (gate A0 / R1-03-F1): a repo THIS call creates starts
    // with no ignore rules at all, so preflight C2 — now honestly evaluated
    // against the project's OWN repo (projects-11) — hard-failed every
    // scratch path at birth, parking the create-from-nothing form on a
    // failing checklist. The scaffold that creates the repo also closes C2:
    // write the hygiene .gitignore (scratch paths single-sourced from
    // SCRATCH_PATHS; deps + generic build outputs single-sourced from
    // SCAFFOLD_BUILD_OUTPUT_IGNORES beside BUILD_ARTIFACT_HINTS, review F4,
    // covering the ARTIFACTS companion for the common shapes). ONLY when
    // absent — an
    // operator file is never clobbered — and ONLY on the two branches that
    // create the repo from nothing; an existing repo's hygiene gaps surface
    // through the honest resolution panel + auto-fix instead. Written even
    // when `git init` itself failed: checkC2's no-repo fallback is a
    // .gitignore text-scan, which this file satisfies too.
    if (!existsSync(join(projectRoot, '.gitignore'))) {
      const giGuard = resolveGuardedPath(projectRoot, ['.gitignore']);
      if (!giGuard.ok) throw new ScaffoldContainmentError('path containment check failed while scaffolding .gitignore');
      writeFileSync(
        giGuard.realPath,
        '# scaffolded by forge onboarding — C2 scratch hygiene + build outputs\n' +
          `${SCAFFOLD_BUILD_OUTPUT_IGNORES.join('\n')}\n` +
          `# forge scratch (C2)\n${SCRATCH_PATHS.join('\n')}\n`,
        'utf8',
      );
      created.push('.gitignore');
    }
  }

  const { roadmap, profile } = contractArtifactTargets(projectRoot);

  // roadmap.md (C4) — TODO stub, clearly marked. SEC-03 Finding B: probe
  // existence FIRST (plain, symlink-following `existsSync` — "already
  // there, skip" is the whole of the idempotency contract), and only guard
  // + write when genuinely absent. Never clobbers an existing operator
  // file — a SEPARATE, real requirement from the containment guard; both
  // apply independently.
  if (!existsSync(roadmap.absPath)) {
    const roadmapGuard = resolveGuardedPath(projectRoot, roadmap.segments);
    if (!roadmapGuard.ok) throw new ScaffoldContainmentError('path containment check failed while scaffolding roadmap.md');
    writeFileSync(
      roadmapGuard.realPath,
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

  // brain sub-wiki profile.md (C4, Brain 3) under the artifactRoot. On THIS
  // call path artifactRoot is always '.' in practice (this function always
  // runs before .forge/project.json exists, and readArtifactRoot returns
  // '.' whenever that file is absent) — but `contractArtifactTargets`
  // applies the split unconditionally rather than leaning on that as an
  // invariant, since scaffoldContractArtifacts's own contract makes no such
  // promise about call order.
  if (!existsSync(profile.absPath)) {
    const profileGuard = resolveGuardedPath(projectRoot, profile.segments);
    if (!profileGuard.ok) throw new ScaffoldContainmentError('path containment check failed while scaffolding brain/profile.md');
    mkdirSync(dirname(profileGuard.realPath), { recursive: true });
    writeFileSync(
      profileGuard.realPath,
      `# ${name} — Project Profile (Brain 3)\n\n` +
        `> TODO (scaffold): replace this stub with the project's machine-readable\n` +
        `> architecture profile — the durable facts forge's planners query before\n` +
        `> designing (stack, module map, conventions, invariants). See\n` +
        `> docs/forge-project-contract.md (clause C4) and the forge-onboard-project skill.\n\n` +
        `## Stack\n\nTODO\n\n## Module map\n\nTODO\n\n## Conventions & invariants\n\nTODO\n`,
      'utf8',
    );
    created.push(profile.relPath);
  }

  // package.json (w8-a1, bd forge-7pa) — the CONDITIONAL FOURTH target,
  // mirroring the `.gitignore` precedent exactly (not folded into
  // `contractArtifactTargets`, whose docstring reserves that function for
  // the two UNCONDITIONAL targets only). Written ONLY when
  // `needsPackageJsonScaffold` said so — see that function's docstring for
  // the shared-predicate rule with `checkContractArtifactContainment`
  // above, including its third conjunct (never litter a package.json into
  // an operator's own pre-existing repo — only when THIS call is itself
  // creating the repo). `scaffoldPackageJson` is the CACHED decision from
  // above — not a fresh call — see that variable's own comment for why.
  // Placed before the `repoInited` commit below so a repo this call creates
  // carries the package.json in its first commit too.
  if (scaffoldPackageJson) {
    const pkgGuard = resolveGuardedPath(projectRoot, ['package.json']);
    if (!pkgGuard.ok) throw new ScaffoldContainmentError('path containment check failed while scaffolding package.json');
    // Derive the script name the SAME way checkC1 does (resolveScriptName,
    // mirrored above) so C1's script-existence check is satisfied by
    // construction. A shape C1 cannot map to a script name (`npx …`,
    // `bunx …`, bare `bun …`) still gets the file — the package.json-exists
    // half alone is what stops npm's ancestor walk — with an empty
    // `scripts` object; inventing a script name C1 would never look for
    // would be dishonest content, not a fix.
    const scriptName = resolveScriptName(opts.qualityGateCmd!.join(' '));
    const scripts: Record<string, string> = {};
    if (scriptName !== null) {
      // Fail HONESTLY rather than exit 0: a freshly scaffolded project has
      // no tests. A script that silently passed would recreate, one layer
      // down, the exact false-green this whole change closes — package.json
      // would resolve locally, but "pass" nothing. This is npm init's own
      // long-standing placeholder body, not a bespoke string.
      scripts[scriptName] = 'echo "Error: no test specified" && exit 1';
    }
    writeFileSync(
      pkgGuard.realPath,
      `${JSON.stringify({ name: opts.id ?? name, version: '0.0.0', private: true, scripts }, null, 2)}\n`,
      'utf8',
    );
    created.push('package.json');
  }

  // projects-37 (S1): a repo THIS call created is UNBORN until something
  // commits — no HEAD, no branch ref, so `defaultBranch()` returns its literal
  // 'main' fallback and every project-repo-tx operation is evaluated against a
  // branch that does not exist (the first "Save project" 500'd; saveProjectRepo
  // still cannot merge forge-studio into a nonexistent default branch). The
  // greenfield path (orchestrator/project-create.ts) already commits its
  // scaffold at birth — the onboard path got no equivalent when W7-B6 WI-1 made
  // `git init` fire for real here. Identity flags are passed per-invocation so
  // an unattended host with no global git identity still commits. Best-effort:
  // ensureStudioBranch's unborn guard is the real fix and backstops a failure
  // here, so a git hiccup must not fail an otherwise-good onboarding.
  if (repoInited) {
    try {
      execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' });
      execFileSync(
        'git',
        ['-c', 'user.name=forge', '-c', 'user.email=forge@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', `chore: onboard ${name} to forge`],
        { cwd: projectRoot, stdio: 'ignore' },
      );
    } catch {
      // git unavailable/misconfigured — preflight surfaces C6, and the unborn
      // guard in ensureStudioBranch keeps Studio writes working regardless.
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Write routes (M2-2) — PUT /api/studio/agents/:slug, PUT /api/studio/projects/:id
// ---------------------------------------------------------------------------

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
  if (!PROJECT_ID_RE.test(id)) {
    sendJson(res, 400, { error: 'invalid project id' }, origin);
    return null;
  }
  const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
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
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
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

// ---------------------------------------------------------------------------
// W7-B4 helpers — agent/flow lifecycle (delete guards, no-op detection,
// starter-agent materialisation).
// ---------------------------------------------------------------------------

/**
 * Which session-kind descriptors reference each agent slug (the DELETE
 * guard's second reference source, beside flow nodes). Deliberately a
 * TOLERANT scan of the descriptor ROWS rather than the strict
 * `loadSessionKinds` parse: for a refusal guard, over-collecting references
 * from a row that would fail the strict parse is the fail-closed direction
 * (a strict throw per-row would let a malformed sibling descriptor unblock a
 * guarded delete). A missing file is genuinely "no session kinds" — an empty
 * map.
 *
 * W7-B4 review finding 5: tolerance stops at the FILE. The previous `catch {
 * return refs }` around `yaml.load` inverted this function's whole rationale
 * — an unparseable file (one stray tab) produced an EMPTY map, so the caller
 * read "no session kind references this agent" and deleted it, breaking
 * every kind that dispatched it. An unreadable/unparseable descriptor file
 * means the guard CANNOT prove the agent is unreferenced, so it throws and
 * the caller refuses.
 */
export class SessionKindsUnreadableError extends Error {}

function sessionKindAgentRefs(forgeRoot: string): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const file = join(forgeRoot, 'studio', 'session-kinds.yaml');
  if (!existsSync(file)) return refs;
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SessionKindsUnreadableError(
      `studio/session-kinds.yaml could not be parsed (${err instanceof Error ? err.message : String(err)}) — fix it before deleting agents, since it cannot be checked for references`,
    );
  }
  if (!Array.isArray(parsed)) return refs;
  for (const row of parsed) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const agent = typeof r['agent'] === 'string' ? r['agent'] : '';
    const kindId = typeof r['id'] === 'string' ? r['id'] : '(unnamed kind)';
    if (!agent) continue;
    refs.set(agent, [...(refs.get(agent) ?? []), kindId]);
  }
  return refs;
}

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

// W7-B3 (community-23) — community-registry CRUD helpers. The registry
// (studio/community/registry.yaml) had exactly one writer, an agent commit
// path — Studio itself had no add/edit/remove. These helpers give the
// routes below the SAME structural discipline commitRegistryDraft holds:
// parse the body against the loader's own field rules, serialize through
// the ONE shared serializer, write temp-then-rename, and RE-PARSE the temp
// file through loadCommunityRegistry before it replaces the real one (a
// write this module cannot re-load must never land).
//
// Honesty stamps: an operator-written row is hand-curated — `fetchedAt:
// null` / `fetchedBy: 'operator'` are FORCED server-side regardless of what
// the body claims (never a fabricated verification timestamp; the freshness
// badge reads such a row as never-verified, which is the truth).
// ---------------------------------------------------------------------------

// W7-B3 review F1 (confirmed by live probe): the community index projects ONLY
// kind:'skill' rows out of the registry (hooks come from vendored packages,
// mcp/tool from studio/catalog.yaml), so a hand-added hook/mcp/tool row would
// write successfully and then be invisible and un-curatable — the detail page
// the form redirects to 404s and the edit/remove controls live there. The CRUD
// surface therefore admits ONLY 'skill'.
const COMMUNITY_REGISTRY_ITEM_KINDS = ['skill'] as const;

function parseRegistryItemBody(raw: unknown): { ok: true; item: CommunityRegistryItem } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object with an "item" field' };
  const itemRaw = (raw as Record<string, unknown>)['item'];
  if (itemRaw === null || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) return { ok: false, error: '"item" must be an object' };
  const e = itemRaw as Record<string, unknown>;

  const requireString = (field: string): string | { error: string } => {
    const v = e[field];
    if (typeof v !== 'string' || v.trim() === '') return { error: `item.${field} is required and must be a non-empty string` };
    return v;
  };

  const id = requireString('id');
  if (typeof id !== 'string') return { ok: false, error: id.error };
  try {
    assertSkillSlug(id, 'community item');
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }

  const kindRaw = e['kind'];
  if (typeof kindRaw !== 'string' || !(COMMUNITY_REGISTRY_ITEM_KINDS as readonly string[]).includes(kindRaw)) {
    return {
      ok: false,
      error: `item.kind must be "skill" — the community index surfaces only skill rows from the registry (hooks are vendored packages under studio/community/hooks/; mcp/tool connections live in studio/catalog.yaml)`,
    };
  }

  const name = requireString('name');
  if (typeof name !== 'string') return { ok: false, error: name.error };
  const category = requireString('category');
  if (typeof category !== 'string') return { ok: false, error: category.error };
  const sourceUrl = requireString('sourceUrl');
  if (typeof sourceUrl !== 'string') return { ok: false, error: sourceUrl.error };
  if (!/^https?:\/\//.test(sourceUrl)) return { ok: false, error: 'item.sourceUrl must be an http(s) URL' };
  const provenance = requireString('provenance');
  if (typeof provenance !== 'string') return { ok: false, error: provenance.error };

  const desc = e['desc'];
  if (desc !== undefined && typeof desc !== 'string') return { ok: false, error: 'item.desc must be a string when present' };
  const tier = e['tier'];
  if (tier !== undefined && typeof tier !== 'string') return { ok: false, error: 'item.tier must be a string when present' };
  const upstreamUpdatedAt = e['upstreamUpdatedAt'] ?? null;
  if (upstreamUpdatedAt !== null && typeof upstreamUpdatedAt !== 'string') {
    return { ok: false, error: 'item.upstreamUpdatedAt must be a string or null' };
  }

  const signalsRaw = e['signals'];
  let attributedTo: string | null = null;
  if (signalsRaw !== undefined && signalsRaw !== null) {
    if (typeof signalsRaw !== 'object' || Array.isArray(signalsRaw)) return { ok: false, error: 'item.signals must be an object when present' };
    const s = signalsRaw as Record<string, unknown>;
    if (s['stars'] !== undefined && s['stars'] !== null && typeof s['stars'] !== 'number') return { ok: false, error: 'item.signals.stars must be a number or null' };
    if (s['starsDisplay'] !== undefined && s['starsDisplay'] !== null && typeof s['starsDisplay'] !== 'string') return { ok: false, error: 'item.signals.starsDisplay must be a string or null' };
    if (s['attributedTo'] !== undefined && s['attributedTo'] !== null && typeof s['attributedTo'] !== 'string') return { ok: false, error: 'item.signals.attributedTo must be a string or null' };
    attributedTo = (s['attributedTo'] as string | null | undefined) ?? null;
  }

  return {
    ok: true,
    item: {
      id,
      kind: kindRaw as CommunityRegistryItem['kind'],
      name,
      ...(desc !== undefined ? { desc } : {}),
      category,
      sourceUrl,
      provenance,
      ...(tier !== undefined ? { tier } : {}),
      // SERVER-OWNED fetch facts — never trusted from the body (W7-B3 review
      // F5, the declared-data-fails-open class): stars/starsDisplay/
      // upstreamUpdatedAt are facts a refresh pass fetched about upstream. A
      // hand-entered value would be a fabricated signal that drives the
      // "Stars" sort, so a CREATE starts them null; the PUT arm carries the
      // EXISTING row's values forward (an operator edit must not wipe agent-
      // fetched facts either — review F4). Body values for these fields are
      // type-checked above (bad shapes still 400) and then IGNORED.
      // `attributedTo` stays operator-suppliable: it is a curation note, not
      // a fetched signal. `upstreamUpdatedAt` was type-checked above; its
      // parsed value is deliberately discarded here.
      signals: { stars: null, starsDisplay: null, attributedTo },
      upstreamUpdatedAt: null,
      fetchedAt: null,
      fetchedBy: 'operator',
    },
  };
}

/** Load the live registry tolerantly (missing file = the fresh-root empty
 *  baseline), apply `mutate`, then temp-write → re-parse → rename. A `null`
 *  from `mutate` means "refused, write NOTHING" — the file stays
 *  byte-identical (a 409/404 must never reformat the registry as a side
 *  effect). Throws on a malformed EXISTING registry (never half-trusts a
 *  corrupt file) and on a produced document the loader itself refuses. */
function mutateCommunityRegistry(
  forgeRoot: string,
  mutate: (items: CommunityRegistryItem[]) => CommunityRegistryItem[] | null,
): void {
  const destPath = communityRegistryPath(forgeRoot);
  const existing = existsSync(destPath)
    ? loadCommunityRegistry(destPath)
    : { schemaVersion: 1, lastRefresh: null as string | null, items: [] as CommunityRegistryItem[] };
  const nextItems = mutate([...existing.items]);
  if (nextItems === null) return;
  const serialized = serializeCommunityRegistry({ schemaVersion: existing.schemaVersion, lastRefresh: existing.lastRefresh, items: nextItems });

  mkdirSync(dirname(destPath), { recursive: true });
  const tempPath = join(dirname(destPath), `.registry.yaml.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(tempPath, serialized, 'utf8');
  try {
    loadCommunityRegistry(tempPath); // structural round-trip — the ONE loader is the validator
    renameSync(tempPath, destPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
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
  // admitted into this function ONLY for the three routes that actually
  // implement it — the community registry item (W7-B3) and the agent/flow
  // deletes (W7-B4). Every OTHER write arm (projects/:id, save-repo,
  // preflight/*, ...) dispatches on its URL match alone with no `method ===`
  // test, so an unscoped DELETE would fall into a PUT handler and act; those
  // still fall through here (404), exactly as before W7-B3 added the method
  // to the top gate.
  //
  // This list is load-bearing and must grow with every new DELETE arm: W7-B3
  // wrote it as `!registryItemMatch` when the registry item was the only
  // DELETE route, and merging W7-B4 (which added two more) silently disabled
  // BOTH of them — the auto-merge was clean, and only the acceptance suite
  // caught it. Adding a DELETE arm below without adding its match here is a
  // route that answers 404 forever.
  const registryItemMatch = url.match(/^\/api\/studio\/community\/registry\/items\/([^/]+)$/);
  const agentDeleteMatch = url.match(/^\/api\/studio\/agents\/([^/]+)$/);
  const flowDeleteMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (method === 'DELETE' && !registryItemMatch && !agentDeleteMatch && !flowDeleteMatch) return false;

  // ---- W7-B3 (community-23): community registry CRUD ----------------------
  if (method === 'POST' && url === '/api/studio/community/registry/items') {
    try {
      const parsed = parseRegistryItemBody(await readJson(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error }, origin);
        return true;
      }
      let conflict = false;
      mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        if (items.some((i) => i.id === parsed.item.id)) {
          conflict = true;
          return null; // refused — the file stays byte-identical
        }
        return [...items, parsed.item];
      });
      if (conflict) {
        sendJson(res, 409, { error: `a registry item with id "${parsed.item.id}" already exists — edit it instead` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id: parsed.item.id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // (PUT and DELETE are two separate dispatch lines, each with its own
  // explicit `method ===` test, so cli/dry-bridge-coverage.test.ts's route
  // derivation sees BOTH — a combined `(PUT || DELETE)` arm derives only the
  // first method and leaves the DELETE invisible to the coverage gate.
  // `registryItemMatch` itself is hoisted to the top of this function: the
  // DELETE-scoping guard there needs it.)
  if (registryItemMatch && method === 'PUT') {
    try {
      const id = decodeIdOrRespond(registryItemMatch[1], res, origin);
      if (id === null) return true;
      const parsed = parseRegistryItemBody(await readJson(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error }, origin);
        return true;
      }
      if (parsed.item.id !== id) {
        sendJson(res, 400, { error: `item.id "${parsed.item.id}" does not match the URL id "${id}" — a rename is delete + add` }, origin);
        return true;
      }
      let found = false;
      mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        const next = items.map((i) => {
          if (i.id !== id) return i;
          found = true;
          // W7-B3 review F4: an operator EDIT carries the EXISTING row's
          // agent-fetched facts forward — stars, starsDisplay and
          // upstreamUpdatedAt are server-owned (see parseRegistryItemBody).
          // Only fetchedAt/fetchedBy reset (the documented honesty reset:
          // the CONTENT is now hand-curated). attributedTo comes from the
          // body — it is a curation note the operator may edit.
          return {
            ...parsed.item,
            signals: {
              stars: i.signals.stars,
              starsDisplay: i.signals.starsDisplay,
              attributedTo: parsed.item.signals.attributedTo,
            },
            upstreamUpdatedAt: i.upstreamUpdatedAt,
          };
        });
        return found ? next : null; // 404 path writes nothing
      });
      if (!found) {
        sendJson(res, 404, { error: `no registry item with id "${id}"` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  if (registryItemMatch && method === 'DELETE') {
    try {
      const id = decodeIdOrRespond(registryItemMatch[1], res, origin);
      if (id === null) return true;
      let found = false;
      mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        const next = items.filter((i) => {
          if (i.id === id) {
            found = true;
            return false;
          }
          return true;
        });
        return found ? next : null; // 404 path writes nothing
      });
      if (!found) {
        sendJson(res, 404, { error: `no registry item with id "${id}"` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/:id/save-repo (R1-2) ----------------------
  // Merge the project's accumulated forge-studio changes into main + push.
  const saveRepoMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/save-repo$/);
  if (saveRepoMatch && method === 'POST') {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/studio/projects/:id/save-repo', method, action: 'git-remote', logsRoot: ctx.logsRoot });
      return true;
    }
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
      sendJson(res, 200, {
        ok: true, resolution: 'user', route: 'preflight-fix', runId,
        // R5-01-F1 stub-actions: only this user-tier branch spawns; the
        // auto/agent-tier branches above return without a marker.
        ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/studio/projects/:id/preflight/fix-agent', runId),
      }, origin);
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
      // W7-A4 (crosscut-20): `new` is the /agents/new builder segment, never
      // an agent — refuse it here so it can never be minted or shadowed.
      if (isReservedId(slug)) {
        sendJson(res, 400, { error: `agent slug "${slug}" is reserved (the /agents/new builder lives at that path) — choose another slug` }, origin);
        return true;
      }

      // 2. Resolve + guard the SKILL.md path through the shared, generalized
      // containment guard (cli/studio-path-guard.ts — see its docstring for
      // the full writeup of every escape shape closed: symlinked leaf,
      // symlinked slug dir, same-root cross-agent alias, hardlinked leaf,
      // nested-segment symlink). Also used by the instructions-draft and
      // skills-library author routes. Tolerates not-yet-created (`exists:
      // false`) so scaffolding a brand-new agent still works.
      const pathGuard = resolveGuardedPath(toSkillsDir(ctx.forgeRoot), [slug, 'SKILL.md']);
      if (!pathGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const skillMdPath = pathGuard.realPath;

      // ---- DELETE /api/studio/agents/:slug (W7-B4, agents-09) --------------
      // Refuses while anything REAL still references the agent: a flow node
      // (the run-time dispatch source) or a session-kind descriptor (the
      // interactive dispatch source) — each 409 names the referrers.
      if (method === 'DELETE') {
        if (!pathGuard.exists) {
          sendJson(res, 404, { error: `unknown agent "${slug}"` }, origin);
          return true;
        }
        // W7-B4 review finding 1 (kind confusion) — skills and agents share
        // skills/<id>/SKILL.md, so this route can address a plain composable
        // SKILL by slug. Neither guard below fires for one (flow nodes and
        // session kinds only ever reference AGENTS), so without this check a
        // skill fell straight through to the rmSync — deleting a package the
        // skills route deliberately refuses, and breaking every agent that
        // composes it at next spawn. Mirror of the skills route's own
        // isStudioAgent refusal (cli/bridge-studio-skills.ts), pointing the
        // operator at the surface that owns the object.
        if (!isStudioAgent(skillMdPath)) {
          sendJson(res, 404, {
            error: `"${slug}" is a library skill, not a studio agent — delete it from the library (/skills/${slug})`,
          }, origin);
          return true;
        }
        // Defence in depth: even for a real agent, never delete one that
        // something still composes. Same `usedBy` derivation the library
        // listing renders — one source of truth, no second scan.
        const composedBy = listSkillLibrary(ctx.forgeRoot).find((e) => e.id === slug)?.usedBy ?? [];
        if (composedBy.length > 0) {
          sendJson(res, 409, {
            error: `agent "${slug}" is still composed by ${composedBy.length} agent(s): ${composedBy.join(', ')} — unbind it from their builders first`,
            usedBy: composedBy,
          }, origin);
          return true;
        }
        const referencingFlows: string[] = [];
        for (const flowId of listFlowIds(ctx.forgeRoot)) {
          const guarded = resolveGuardedPath(resolve(ctx.forgeRoot, 'studio', 'flows'), [flowId, 'flow.yaml']);
          if (!guarded.ok || !guarded.exists) continue;
          try {
            const def = loadFlowDefinition(guarded.realPath);
            if (def.nodes.some((n) => n.agent === slug)) referencingFlows.push(flowId);
          } catch {
            // a malformed sibling flow is studio-lint's finding, not a
            // reason to unblock (or block) this delete
          }
        }
        if (referencingFlows.length > 0) {
          sendJson(res, 409, {
            error: `agent "${slug}" is still a node in ${referencingFlows.length} flow(s): ${referencingFlows.join(', ')} — edit those flows first`,
            referencedBy: referencingFlows,
          }, origin);
          return true;
        }
        let kindRefs: string[];
        try {
          kindRefs = sessionKindAgentRefs(ctx.forgeRoot).get(slug) ?? [];
        } catch (err) {
          // Fail CLOSED: the reference set is unknown, so the delete is refused
          // with the actionable reason rather than proceeding blind.
          sendJson(res, 409, { error: sanitizeError(err) }, origin);
          return true;
        }
        if (kindRefs.length > 0) {
          sendJson(res, 409, {
            error: `agent "${slug}" drives the session kind(s): ${kindRefs.join(', ')} (studio/session-kinds.yaml) — retire the descriptor first`,
            referencedBy: kindRefs,
          }, origin);
          return true;
        }
        rmSync(dirname(skillMdPath), { recursive: true, force: true });
        sendJson(res, 200, { ok: true, slug }, origin);
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

      // W7-B4 (agents-28): an EXPLICIT create must never silently overwrite
      // an existing agent — the /agents/new save path sends `create: true`
      // and collides with 409, leaving the file untouched.
      if (b['create'] === true && pathGuard.exists) {
        sendJson(res, 409, {
          error: `agent "${slug}" already exists — open /agents/${slug} to edit it, or pick another name`,
        }, origin);
        return true;
      }

      // 4. Load existing def or scaffold minimal one. Also capture the RAW
      // on-disk bytes (D5 wiring): five phase bindings + the release
      // finalizer readFileSync the WHOLE SKILL.md verbatim into the agent's
      // system prompt (orchestrator/phases/dev-binding.ts:63, pm-binding.ts:53,
      // reflector-binding.ts:52, adversarial-review-binding.ts:40,
      // demo-agent-binding.ts:53, orchestrator/release-finalize-invocation.ts:51)
      // — so a lossy re-serialize on save is a PROMPT change, not mere file
      // churn. Handing `originalRaw` to serializeAgentDefinition below lets it
      // take the byte-preserving fast path (comments, fanout, key order kept
      // verbatim) whenever the frontmatter didn't actually change. Both this
      // read and loadAgentDefinition's internal read use the same 'utf8'
      // encoding — no double-encoding risk, just two reads of the same bytes.
      let existing: AgentDefinition | null = null;
      let originalRaw: string | undefined;
      if (pathGuard.exists) {
        try {
          originalRaw = readFileSync(skillMdPath, 'utf8');
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
        guards: Array.isArray(compIn['guards']) ? (compIn['guards'] as string[]) : (existing?.composition.guards ?? []),
        // Deliberately NOT falling back to existing?.composition.hooks like
        // the other four fields (2026-08-04, see bridge-studio-writes-
        // guards-migration.test.ts's E1b): a stale on-disk SKILL.md can
        // carry the OLD `hooks:` vocabulary (guard ids, pre-rename) under
        // the field that now means library-hook ids — falling back to it
        // would silently round-trip that colliding value through every save
        // of that agent, forever, with no validation catching it (this
        // route does not yet run lintHookComposition — see the T3 report's
        // JOB 2 finding). Reading ONLY the request body means a save either
        // explicitly re-declares composition.hooks (the F4 Agent-Builder
        // binding path) or it's empty — never a silently-inherited legacy
        // value.
        hooks: Array.isArray(compIn['hooks']) ? (compIn['hooks'] as string[]) : [],
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

      // materials (R2-09 D2/D7 + 2026-08-05 adversarial-review round 2,
      // findings C/8 and C/9): the SAME inherit-when-omitted convention as
      // `phase`/`surface`/`executor` above — omitted from the PUT body ⇒
      // inherited from disk (`existing?.materials`); explicitly `[]` (or any
      // other array, up to the vocabulary-derived length cap) in the body ⇒
      // replaces it, including clearing to empty. The presence test is now
      // `b['materials'] !== undefined`, NOT `Array.isArray` — the previous
      // version treated ANY non-array explicit value as "not sent" and
      // silently fell back to the on-disk value with a 200 OK, so a caller
      // sending `materials: null` / `{}` / `"images"` believed it saved and
      // nothing changed (this campaign's recurring "declared data fails
      // open" shape). An explicit, malformed shape is now REJECTED (400,
      // file byte-unchanged) before any further processing — never
      // downgraded to "omitted". An oversized array (longer than the
      // vocabulary can ever legitimately need) is rejected the same way,
      // BEFORE validateAgent's per-value materials/enum lint would otherwise
      // fan out into one finding per element.
      if (b['materials'] !== undefined) {
        if (!Array.isArray(b['materials'])) {
          sendJson(
            res,
            400,
            { error: `materials must be an array of strings, got ${b['materials'] === null ? 'null' : typeof b['materials']}` },
            origin,
          );
          return true;
        }
        if ((b['materials'] as unknown[]).length > MAX_MATERIALS_LENGTH) {
          sendJson(
            res,
            400,
            {
              error: `materials array too long (${(b['materials'] as unknown[]).length} entries) — the vocabulary has only ${MAX_MATERIALS_LENGTH} kinds`,
            },
            origin,
          );
          return true;
        }
      }
      const materials: string[] | undefined = Array.isArray(b['materials'])
        ? (b['materials'] as string[])
        : existing?.materials;

      const merged: AgentDefinition = {
        slug,
        name,
        description: existing?.description ?? name,
        // W7-B4 (agents-18): a BRAND-NEW mint synthesises `phase: <slug>` so
        // the agent is dispatchable (deriveAgentSpec hard-requires phase;
        // without it a Studio-made agent could NEVER run). An existing
        // agent's phase — including deliberately-absent (declaration-only) —
        // is preserved verbatim, never backfilled.
        phase: existing ? existing.phase : slug,
        surface: existing?.surface,
        // R4-01 review: preserve the declared executor row — dropping it on a
        // builder save would silently strip developer-unifier's dispatch (the
        // one remaining executor, held until R4-01-F4 retirement).
        executor: existing?.executor,
        purpose,
        composition,
        runtime,
        // D7 fix: this literal used to omit `fanout` entirely, so saving a
        // fanout-capable agent (e.g. developer-ralph) through the builder
        // silently stripped its `fanout:` block and flipped its
        // `fanoutCapable` descriptor false. Same inherit-when-omitted
        // convention as `phase`/`surface`/`executor` — the PUT body has no
        // fanout-editing UI yet, so this is always inherited from disk.
        fanout: existing?.fanout,
        materials,
        brainAccess,
        interactivity,
        budgets: existing?.budgets ?? {},
        allowedTools: existing?.allowedTools ?? [],
        disallowedTools: existing?.disallowedTools ?? [],
        body: body_text,
        // 2026-08-05 adversarial-review round 2, finding C/10 claimed
        // `existing?.library ?? true` "silently flips" an agent whose on-disk
        // `library` is explicitly `false` (e.g. instructions-creator,
        // project-brain-builder) to `true` on a PUT that omits `library`.
        // VERIFIED AND NOT REPRODUCIBLE: `??` (nullish coalescing) only
        // substitutes its right operand when the left is `null`/`undefined`
        // — `false ?? true` evaluates to `false` in JS, confirmed empirically
        // (`node -e "console.log(false ?? true)"` → `false`). So
        // `existing?.library ?? true` already preserves an explicit
        // `library: false` verbatim; it only backfills `true` for (a) a
        // genuinely new agent (`existing` is `null`) or (b) an EXISTING
        // agent whose `library` key was never declared at all
        // (`existing.library === undefined`) — and that backfill is inert:
        // `isStudioAgent` (registry.ts) already treats an undeclared
        // `library` the same as `true` (`d.library !== false`), so writing
        // the explicit `true` changes no observable behaviour, only makes
        // the R3-01-F2 "explicit on every shipped skill" convention hold.
        // Kept as-is rather than "fixed" per the false claim — see the final
        // report.
        library: existing?.library ?? true,
        path: skillMdPath,
      };

      // 5b. Pre-load catalog guard ids for the composition/guard-unknown check
      // below (ADR-027 §6: "the same validation runs at save (bridge PUT) and
      // at spawn") — mirrors cli/studio-lint.ts's identical block; a missing
      // or malformed catalog leaves the set undefined so the rule simply does
      // not fire (a catalog load failure must not turn every save into a 400).
      let validGuardIds: ReadonlySet<string> | undefined;
      {
        const catalogPathEarly = join(ctx.forgeRoot, 'studio', 'catalog.yaml');
        if (existsSync(catalogPathEarly)) {
          try {
            validGuardIds = new Set(loadCatalog(catalogPathEarly).guards.map((g) => g.id));
          } catch {
            validGuardIds = undefined;
          }
        }
      }

      // 5c. Symmetric hooks/guards composition check (ADR-027 R3-03 amendment;
      // 2026-08-04 finding — the THIRD appearance of the same defect class in
      // this initiative: a rule implemented and unit-tested but inert because
      // production never invokes it). `checkHookComposition` is the SAME pure
      // predicate `lintHookComposition` runs over on-disk agents
      // (orchestrator/studio/hook-library.ts) — applied HERE to the
      // IN-MEMORY `merged.composition` candidate, since it is not yet
      // written; re-scanning disk would miss the very save this gates.
      // PLATFORM_GUARD_IDS is a fixed platform-vocabulary constant (not
      // catalog-sourced), and listHookIds reads studio/hooks/ directly, so
      // neither needs the catalog-load guard the guard-unknown check above
      // needs.
      const hookCompositionFindings = checkHookComposition(
        slug,
        merged.composition,
        new Set(PLATFORM_GUARD_IDS),
        new Set(listHookIds(ctx.forgeRoot)),
      );

      // 6. Validate — reject on any error-level finding
      const findings = [...validateAgent(merged, undefined, validGuardIds), ...hookCompositionFindings];
      const hasErrors = findings.some((f) => f.level === 'error');
      if (hasErrors) {
        sendJson(res, 400, { error: 'validation failed', findings }, origin);
        return true;
      }

      // 7. Serialize and write. Passing `originalRaw` lets serializeAgentDefinition
      // take the D5 byte-preserving fast path when nothing frontmatter-relevant
      // changed — see the comment on `originalRaw`'s read above for why a lossy
      // save here is a PROMPT change, not mere file churn.
      const serialized = serializeAgentDefinition(merged, originalRaw);
      // Derive the containing dir from the ALREADY-GUARDED real path (not a
      // fresh `skillDir(slug, ...)` lexical join) — reusing the guarded
      // value end-to-end means there is no second, unguarded path
      // construction for a brand-new agent to slip through.
      const skillDirPath = dirname(skillMdPath);
      if (!existsSync(skillDirPath)) {
        mkdirSync(skillDirPath, { recursive: true });
      }
      writeFileSync(skillMdPath, serialized, 'utf8');

      const flagFindings = findings.filter((f) => f.level === 'flag');
      sendJson(res, 200, { ok: true, slug, findings: flagFindings }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/projects/create (greenfield, R4-03) ----------------
  // Scaffold a NEW project from a framework template (studio/starters/projects/
  // <app-type>/) + seed the central brain, then preflight. Local file ops only
  // (no spawn, no git-remote) — exempt-local under dry-bridge, like onboard.
  if (url === '/api/studio/projects/create' && method === 'POST') {
    try {
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
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
      // registered). Resolve + guard the repo path under the projects root.
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      if (discoverProjects(projectsDir, ctx.forgeRoot).some((p) => p.id === id)) {
        sendJson(res, 409, { error: `project "${id}" already exists` }, origin); return true;
      }
      const repoPathRel = typeof b['repoPath'] === 'string' && b['repoPath'].trim() ? b['repoPath'].trim() : `projects/${id}`;
      const projectRoot = resolve(ctx.forgeRoot, repoPathRel);
      // Real per-segment IDENTITY containment (cli/manifest-path-guard.ts's
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
      if (!isContainedProjectRepoPath(projectRoot, { forgeRoot: ctx.forgeRoot, projectsRoot: projectsDir })) {
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
      // `loadKbDescriptors` (`cli/bridge-studio-kbs.ts`), which walks
      // `brain/projects/` as its own second containment root. Moving the
      // orphan is not removing it. Separating the CHECK from the WRITE
      // removes the ordering question entirely: no write on this route can
      // even be ATTEMPTED before every path any of them touch is proven
      // safe, so `seedProjectBrain` can be restored to writing where it
      // always made most sense — after the project directory exists.
      try {
        checkContractArtifactContainment(projectRoot, ctx.forgeRoot, qualityGate);
      } catch (err) {
        if (err instanceof ScaffoldContainmentError) {
          sendJson(res, 400, { error: 'path containment check failed' }, origin); return true;
        }
        throw err;
      }
      try {
        checkProjectBrainSeedContainment(ctx.forgeRoot, id);
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
        scaffoldedLocal = scaffoldContractArtifacts(projectRoot, name, ctx.forgeRoot, { id, qualityGateCmd: qualityGate });
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
      let brainSeed: ReturnType<typeof seedProjectBrain>;
      try {
        brainSeed = seedProjectBrain(ctx.forgeRoot, id, name);
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

  // ---- PUT /api/studio/projects/:id ----------------------------------------
  const projectMatch = url.match(/^\/api\/studio\/projects\/([^/]+)$/);
  // W7-B4: DELETE now passes this handler's entry gate (agents/flows grew
  // delete routes) — projects deliberately have no delete surface here, so a
  // DELETE must fall through as unhandled (404), never enter the PUT logic.
  if (projectMatch && method !== 'DELETE') {
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
      // ADR-044 P1: cached per-manifest derivation — see cli/run-list-cache.ts.
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
