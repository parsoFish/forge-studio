/**
 * Manifest path-field guard — the choke point for the four frontmatter
 * fields (`worktree_path`, `project_repo_path`, `cycle_id`, `project`) that
 * a manifest can carry and that reach a DESTRUCTIVE filesystem/git call
 * somewhere downstream (SEC-02, bd `forge-d1f`).
 *
 * THE DEFECT (reproduced live by T2): `POST /api/initiatives`
 * (`cli/bridge-recovery.ts`) accepted a manifest whose frontmatter carried
 * these four fields with ZERO validation (`validateManifest`,
 * `orchestrator/manifest.ts`, never checked them). `POST
 * /api/recovery/:id/requeue` then calls `runRequeue`
 * (`cli/forge-requeue.ts`), whose default `resume:false` ⇒
 * `preserveWorktree=false` ⇒ an unconditional
 * `rmSync(worktreePath, { recursive: true, force: true })` on whatever
 * string the attacker put in the manifest. Live probe:
 *   POST /api/initiatives          -> 201 {"ok":true}
 *   POST /api/recovery/:id/requeue -> 200 {"ok":true,"worktreeRemoved":true}
 * — with a real, pre-existing sentinel directory OUTSIDE the forge root
 * destroyed in the process.
 *
 * WHY GUARD AT THE WRITE POINT, NOT EVERY READ SITE: these four fields are
 * written ONCE, at ingest (`orchestrator/promote-manifests.ts`,
 * `cli/bridge-recovery.ts`'s `POST /api/initiatives`), and then read
 * UNCHECKED by roughly a dozen call sites downstream — `runRequeue`'s
 * `rmSync` + `git branch -D` / `push --delete`, the bridge's
 * approve/send-back verdict handlers, `orchestrator/requeue-resume.ts`'s
 * `events.jsonl` reads + `git -C <projectRepoPath>` calls,
 * `orchestrator/flow-artifacts.ts`'s `writeVerdictJson`,
 * `orchestrator/logging.ts`'s `createLogger` (both do
 * `resolve(logsRoot, cycleId)`), `orchestrator/scheduler.ts`'s
 * `resolve('projects', m.project)` fallback. Guarding the WRITE choke point
 * (`writeManifest`) closes the defect for every one of those readers in one
 * place; guarding twelve read sites individually leaves the thirteenth
 * (today, or the next one added) unguarded by construction.
 * `cli/forge-requeue.ts`'s `runRequeue` gets an INDEPENDENT assertion too
 * (defence in depth) because it re-serialises the manifest via
 * `serializeManifest` without re-validating anything — so a manifest that
 * reaches disk through some OTHER path (a future ingest route that forgets
 * to call `writeManifest`, or direct corruption) is still caught immediately
 * before the destructive call, not merely at the original ingest.
 *
 * CONTAINMENT TECHNIQUE: reuses `resolveGuardedPath`
 * (`cli/studio-path-guard.ts`) rather than forking it. Per that module's
 * CONTRACT section, the untrusted candidate path is decomposed into
 * `segments[]` and NEVER folded into the trusted `root` argument —
 * `resolveGuardedPath` performs NO identity check on `root` itself, so
 * folding an attacker-controlled path into it is a total bypass (a symlink
 * at the candidate's own first segment gets silently resolved away by
 * `realpathSync(root)` before any per-segment check ever runs). See
 * `containedUnder` below.
 *
 * ESCAPE SHAPES CLOSED: a symlinked directory (at the leaf or a nested
 * segment) pointing outside the root; a symlinked directory pointing at a
 * DIFFERENT real object under the SAME root (cross-object alias —
 * "somewhere under root" is not the guarantee, "this path's own identity"
 * is); literal `..` segments in the raw string (not pre-collapsed by
 * `path.join` before the guard ever sees them); dangling symlinks; a
 * candidate whose FIRST segment under the root is a symlink escaping
 * outside (the root-folding shape); a non-absolute candidate (SEC-02 round
 * 2, Finding 3 — see `containedUnder`'s INVARIANT note: a relative candidate
 * would otherwise resolve against `process.cwd()`, not `forgeRoot`).
 * Every candidate handed to `isContainedWorktreePath` /
 * `isContainedProjectRepoPath` MUST therefore be absolute — every production
 * writer already emits absolute paths, so nothing legitimate regresses. Two
 * shapes are deliberately NOT escapes and MUST be accepted: "escape-and-return"
 * (`<root>/../projects/legit`, which `resolve()` normalises to a genuinely
 * contained path before comparison), and a directory literally named
 * `..foo` (not `..`, so it never leaves the root).
 *
 * NOT CLOSED (disclosed honestly, not silently assumed away):
 *   - The same residual check-then-use TOCTOU `studio-path-guard.ts`
 *     discloses: the filesystem can change between this guard's
 *     `realpathSync`/`lstatSync` calls and a caller's later
 *     `rmSync`/`readFileSync`/git invocation. Fully closing this would need
 *     an atomic `O_NOFOLLOW`-based operation Node's `fs` module does not
 *     expose ergonomically for this call shape.
 *   - `forgeRoot` is a TRUSTED, config-derived parameter (the daemon's own
 *     root directory) — NEVER request-derived. Every call site in this
 *     codebase passes a fixed constant; this module neither verifies nor
 *     can verify that a future caller upholds that.
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveGuardedPath } from './studio-path-guard.ts';

export type ManifestPathFields = {
  initiative_id: string;
  project?: string;
  worktree_path?: string;
  project_repo_path?: string;
  cycle_id?: string;
};

/** Generous but bounded — cycle ids are timestamp+slug shaped, never this long. */
const MAX_CYCLE_ID_LENGTH = 200;
const SAFE_CYCLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Real per-segment containment of `candidate` under `root`. The candidate is
 * ALWAYS decomposed into `segments[]` before being handed to
 * `resolveGuardedPath` — see the module docstring's CONTAINMENT TECHNIQUE
 * section for why folding it into `root` instead would bypass containment
 * entirely.
 *
 * INVARIANT (SEC-02 round 2, Finding 3): `candidate` MUST be absolute.
 * `resolve()` resolves a relative path against `process.cwd()`, not `root` —
 * a bare `resolve(candidate)` on a relative candidate therefore depends on
 * where the CALLING PROCESS happens to be running from, not on `forgeRoot`.
 * Every production writer emits absolute paths, so this is never hit in
 * practice, but it is an unstated (and, with `cwd` pointed at `forgeRoot`,
 * genuinely exploitable — a relative candidate then resolves to a real
 * contained path and is wrongly accepted) invariant. Rejecting any
 * non-absolute candidate outright, before any resolution, removes the `cwd
 * === forgeRoot` dependence entirely rather than merely relying on it.
 *
 * `resolve()` normalises `..` before `relative()` ever runs, so a surviving
 * literal `..` segment in the result can only mean the candidate resolves to
 * somewhere above `root` — that is the lexical pre-filter; `resolveGuardedPath`
 * is the real (identity) containment check on whatever segments remain.
 */
function containedUnder(root: string, candidate: string): { ok: boolean; segments: string[] } {
  if (!isAbsolute(candidate)) return { ok: false, segments: [] };
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '') return { ok: false, segments: [] }; // the root itself is not a valid target
  const segments = rel.split(sep);
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return { ok: false, segments }; // lexically escapes
  const r = resolveGuardedPath(root, segments); // REAL per-segment realpath identity walk
  return { ok: r.ok, segments };
}

/**
 * `worktree_path` is legitimate iff EITHER it is identity-bound to exactly
 * `<forgeRoot>/_worktrees/<initiativeId>` (the forge-managed worktree for
 * THIS initiative — not merely "somewhere under `_worktrees`", which would
 * let one initiative's manifest name another's worktree), OR it is
 * genuinely contained anywhere under `<forgeRoot>/projects/` (in-place
 * worktrees, e.g. `<forgeRoot>/projects/<name>/worktrees/<id>`).
 */
export function isContainedWorktreePath(p: string, opts: { forgeRoot: string; initiativeId: string }): boolean {
  const worktreesRoot = join(opts.forgeRoot, '_worktrees');
  const identity = containedUnder(worktreesRoot, p);
  if (identity.ok && identity.segments.length === 1 && identity.segments[0] === opts.initiativeId) {
    return true;
  }
  const projectsRoot = join(opts.forgeRoot, 'projects');
  return containedUnder(projectsRoot, p).ok;
}

/**
 * `project_repo_path` is legitimate iff genuinely contained under
 * `<forgeRoot>/projects/`.
 *
 * VALIDATING A ROOT DOES NOT VALIDATE WHAT YOU WRITE BENEATH IT (SEC-03
 * Defect 5, BLOCKER — the fifth time in this campaign a containment fix
 * shipped its own containment bug). This function answers exactly one
 * question: *is this directory itself contained?* It says NOTHING about
 * `<p>/anything/else`. A caller that then does
 * `writeFileSync(join(p, '.forge', 'project.json'), …)` has an UNGUARDED
 * write: a genuinely real, honestly-contained project directory whose
 * NESTED `.forge` entry is a symlink writes straight through it to the
 * link's target. Reproduced live against `POST /api/studio/projects`, which
 * wrote the `testProcess.local.cmd` forge later EXECUTES to a directory
 * outside the forge root while returning `200 {"ok":true}`.
 *
 * So: once this returns true, `p` is a TRUSTED root — hand it to
 * `resolveGuardedPath(p, [segment, …])` with every component you intend to
 * write as its own `segments[]` element, and write through the `realPath`
 * it returns. Do not build a second, unguarded path for the same write.
 */
export function isContainedProjectRepoPath(p: string, opts: { forgeRoot: string }): boolean {
  const projectsRoot = join(opts.forgeRoot, 'projects');
  return containedUnder(projectsRoot, p).ok;
}

/**
 * `cycle_id` becomes a directory-entry name via `resolve(logsRoot, cycleId)`
 * at two independent WRITE sites (`orchestrator/flow-artifacts.ts`
 * `writeVerdictJson`, `orchestrator/logging.ts` `createLogger`) — a single
 * safe path segment, never a nested path.
 */
export function isSafeCycleId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_CYCLE_ID_LENGTH && SAFE_CYCLE_ID_RE.test(id);
}

/**
 * `project` becomes a path segment via the scheduler's fallback
 * `resolve('projects', m.project)` (`orchestrator/scheduler.ts`) when a
 * manifest omits `project_repo_path` — a single safe path segment.
 */
export function isSafeProjectName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes(sep)
  );
}

/**
 * Validate the path-shaped fields of a manifest against `forgeRoot`.
 * `undefined` AND `''` both mean ABSENT for `worktree_path` /
 * `project_repo_path` / `cycle_id` and are ALWAYS accepted — `parseManifest`
 * defaults `project_repo_path` to `''` and `serializeManifest` always emits
 * that key, so rejecting `''` would break every legitimate manifest.
 *
 * Returns a (possibly empty) array of error strings. Each names the FIELD
 * and a fixed, generic reason — NEVER the resolved/real path or which
 * segment failed (that would be a fingerprinting aid for an attacker
 * iterating on the guard; same convention as `PathGuardReject.reason` in
 * `cli/studio-path-guard.ts`, which every call site logs-and-discards rather
 * than forwards to the client).
 */
export function validateManifestPathFields(m: ManifestPathFields, opts: { forgeRoot: string }): string[] {
  const errors: string[] = [];

  if (m.project !== undefined && m.project !== '' && !isSafeProjectName(m.project)) {
    errors.push('project must be a safe single path segment (no separators, no "." or "..")');
  }

  if (m.cycle_id !== undefined && m.cycle_id !== '' && !isSafeCycleId(m.cycle_id)) {
    errors.push('cycle_id must be a safe single path segment');
  }

  if (
    m.project_repo_path !== undefined &&
    m.project_repo_path !== '' &&
    !isContainedProjectRepoPath(m.project_repo_path, { forgeRoot: opts.forgeRoot })
  ) {
    errors.push('project_repo_path must be contained under the forge projects root');
  }

  if (
    m.worktree_path !== undefined &&
    m.worktree_path !== '' &&
    !isContainedWorktreePath(m.worktree_path, { forgeRoot: opts.forgeRoot, initiativeId: m.initiative_id })
  ) {
    errors.push('worktree_path must be contained under the forge worktrees or projects root');
  }

  return errors;
}

/** Throwing form for destructive call sites (`writeManifest`, `runRequeue`) — refuse rather than proceed. */
export function assertManifestPathFields(m: ManifestPathFields, opts: { forgeRoot: string }): void {
  const errors = validateManifestPathFields(m, opts);
  if (errors.length > 0) {
    throw new Error(`invalid manifest path fields:\n  - ${errors.join('\n  - ')}`);
  }
}
