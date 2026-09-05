/**
 * project-contract-scaffold.ts — the C4 contract-artifact scaffolding pure
 * helpers (B3), carved out of `apps/forge/bridge-studio-writes.ts` (M4 §4 step 2,
 * projects lane, worker B).
 *
 * PURE HELPERS ONLY — no route handler lives here. `checkContractArtifactContainment`
 * (the pre-check) and `scaffoldContractArtifacts` (the write) are called from
 * `bridge-studio-project-onboard.ts`'s `POST /api/studio/projects` (onboard) handler; every
 * other function here exists only in service of those two.
 *
 * `readArtifactRoot` INJECTION (not in the original signature — a mandatory,
 * mechanical adaptation, not an improvement). `contractArtifactTargets` used
 * to import `readArtifactRoot` directly from `@forge/knowledge/brain-paths.ts`.
 * `projects` and `knowledge` are BOTH rank 2 in the M4 §0 chain
 * (`scripts/check-boundaries.mjs`'s `PACKAGE_RANK`), so a package-file import
 * of `@forge/knowledge` from here is a `package-layer-order` violation —
 * exactly the boundary row this carve exists to delete, the same reasoning
 * the carve brief spells out for `seedProjectBrain`. Unlike the route
 * handlers in `bridge-studio-project-onboard.ts`, this file has no `RouteContext`/`deps`
 * factory to carry an injected function through, so the three functions that
 * need it now take `readArtifactRoot` as an explicit parameter instead —
 * `bridge-studio-project-onboard.ts`'s handler factory receives the real
 * `@forge/knowledge` function as a dep and threads it down into these calls.
 * `import type` was considered and rejected: `check-boundaries.mjs` cruises
 * with `tsPreCompilationDeps: true`, which tracks TypeScript type-only
 * imports as real dependency edges too, so even a type-only import of
 * `@forge/knowledge` would still mint the forbidden row.
 *
 * Every other symbol below is a byte-for-byte move: same body, same
 * comments, same guard ordering. `docs/reference/request-path-sinks.md`
 * records five separate incidents in this exact code; a "tidy" that reorders
 * a check before a write, or a guard rewritten to look cleaner, reopens one
 * of them.
 *
 * NO `sendJson`/`readJson`/`pathOnly` TOKEN ANYWHERE IN THIS FILE. That drops
 * it out of `scripts/check-raw-fs-guarded.mjs`'s HTTP-plumbing signal
 * (`HTTP_PLUMBING_RE`) to the weaker TIER-2 sweep — the same shape that check
 * has silently blinded on three separate carves already (its own recorded
 * history, quoted in the M4-projects routes budget §E). This file needs an
 * `EXPLICIT_MODULES` row added to `scripts/check-raw-fs-guarded.mjs` in the
 * same PR that wires this file in — not made here (T2's bookkeeping) — with
 * a positive control proving the row fires. Every raw fs sink in this file,
 * for that row: `existsSync`, `mkdirSync`, `writeFileSync`, `realpathSync`
 * (read-only, but part of the same guard-adjacent surface), all reached
 * through request-derived `projectRoot`/`qualityGateCmd` parameters, most of
 * them behind `resolveGuardedPath` — see each call site's own comment for the
 * write it wraps.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { resolveGuardedPath } from '@forge/kernel';
import { SCRATCH_PATHS, SCAFFOLD_BUILD_OUTPUT_IGNORES } from './preflight.ts';
import { isPackageManagerShaped, resolveScriptName } from './preflight-gate.ts';

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
export class ScaffoldContainmentError extends Error {}

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
 * route's full write set (docs/reference/request-path-sinks.md defers to
 * these comments): `.forge/project.json` + the two targets below + the
 * conditional `.gitignore`.
 *
 * `readArtifactRoot` is an injected function, not an import — see this
 * file's header comment for why: it lives in `@forge/knowledge`, and
 * `projects`/`knowledge` are the same M4 §0 rank, so a direct import here
 * would mint a `package-layer-order` violation.
 */
export function contractArtifactTargets(
  projectRoot: string,
  readArtifactRoot: (projectRoot: string) => string,
): { roadmap: ContractArtifactTarget; profile: ContractArtifactTarget } {
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
export function needsGitInit(projectRoot: string, forgeRoot: string): boolean {
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
// packages/projects/preflight.ts's checkC1 (READ ONLY from this module — that file is
// outside this worker's fence) now fails a package-manager-shaped quality
// gate (`npm`/`yarn`/`pnpm`/`npx`/`bun`/`bunx` as the first token) when the
// project dir has no package.json: with none there, npm's own ancestor-
// package.json walk resolves the command against an ENCLOSING package.json
// (forge's own root, when the project lives under forge's `projects/`) — a
// false green on the wrong repo, the exact defect this campaign closes. The
// onboarding form's own default gate is `npm test`, so tightening C1 alone
// left every from-scratch JS project born hard-failing (bd forge-7pa,
// `apps/forge/onboard-born-green.test.ts`).
//
// `isPackageManagerShaped`/`resolveScriptName` used to be byte-for-byte COPIES
// here. The stated reason — "preflight.ts does not export either — it is
// outside this worker's fence and must not be edited" — stopped being true when
// `preflight-gate.ts` exported both for `preflight-deps.ts`, so the copies were
// deleted and the originals imported (bead `forge-8vfn.6.10.13`, the cull
// QUARRY.md:42's census already measured). Drift between two copies of this
// rule would silently re-break the invariant they exist for; one copy cannot
// drift from itself.

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
export function needsPackageJsonScaffold(
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
export function checkContractArtifactContainment(
  projectRoot: string,
  forgeRoot: string,
  readArtifactRoot: (projectRoot: string) => string,
  qualityGateCmd?: readonly string[],
): void {
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

  const { roadmap, profile } = contractArtifactTargets(projectRoot, readArtifactRoot);
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
  readArtifactRoot: (projectRoot: string) => string,
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

  const { roadmap, profile } = contractArtifactTargets(projectRoot, readArtifactRoot);

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
