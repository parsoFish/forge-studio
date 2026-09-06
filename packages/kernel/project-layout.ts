/**
 * Project-layout SSOT: id normalisation, on-disk discovery, and the central
 * per-project brain directories (ADR 035) — shared by three rank-2 packages
 * (`projects`, `knowledge`, `library`).
 *
 * MOVED VERBATIM (M4 layout PR): `normalizeProjectId`, `discoverProjects` and
 * `DiscoveredProject` from `@forge/kernel`; `projectBrainDir`
 * and `projectThemesDir` from `packages/knowledge/brain-paths.ts`. A symbol
 * two rank-2 siblings both need lives in kernel (M4 ruling 17/18) — it does
 * not travel sideways from one rank-2 package to another.
 *
 * `projectBrainDir`/`projectThemesDir` stay RE-EXPORTED from
 * `packages/knowledge/brain-paths.ts` — that module's "one place to drift
 * from" claim (ADR 035 brain-path layout) still holds for every brain path;
 * it is the door, kernel is the owner.
 */

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute, dirname } from 'node:path';

import { PROJECT_ID_RE } from './ids.ts';
import { resolveProjectsDir } from './config.ts';
import type { ProjectRef } from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// Project discovery (disk scan — replaces the studio/projects.yaml registry)
//
// A project is any immediate sub-directory of the projects root that carries a
// `.forge/project.json` contract file. The id IS the directory name, verbatim
// (case-preserving, `PROJECT_ID_RE` — W7-A4); the path is the project dir
// relative to forgeRoot. Dirs
// without a `.forge/project.json` are surfaced (hasConfig: false) so the
// operator/lint can warn rather than silently drop a half-onboarded project.
// ---------------------------------------------------------------------------

export type DiscoveredProject = ProjectRef & {
  /** True iff `<dir>/.forge/project.json` exists. */
  hasConfig: boolean;
  /** Absolute path to the project dir. */
  absPath: string;
};

/**
 * R2-08-F1 (N1, round-4): the ONE normalizer for "directory/raw name → project
 * id" — `discoverProjects` below is its original (and still primary) caller,
 * but `forge studio lint`'s `trigger-projects` membership check validates
 * `triggers[].projects` against IDS THIS FUNCTION PRODUCES. Every site that
 * resolves an `eventProject` (a raw directory name / `ProjectBinding.name` /
 * a flow's own `project:` field — none of which are guaranteed pre-normalized)
 * MUST run it through this SAME function before comparing against a declared
 * scope, or lint and dispatch silently read different evidence (rule 2).
 * Extracted so there is exactly one place to drift from, not a copy re-typed
 * at each call site (the second copy would be the same defect one layer down).
 *
 * W7-A4 (findings projects-02 / projects-34, bead forge-9bd): a project id IS
 * its directory name, case-preserving, matched exactly (`PROJECT_ID_RE`) — so
 * for any name that already satisfies the rule this is the IDENTITY
 * (`trafficGame` → `trafficGame`, never `trafficgame`). The old lowercasing
 * published an id no `:id` route could resolve back to the directory. A name
 * that fails the rule (whitespace, `.`, `/`) is not a project — discovery
 * skips it; this still returns a rule-shaped best effort (case preserved,
 * illegal characters folded to `-`) so scope comparisons stay total. Note the
 * best-effort form MAY collide with a differently-named real project (`my
 * proj` → `my-proj`); callers comparing scopes must treat it as a hint, never
 * as proof of identity (W7-FIX-A4 / W7A4-08).
 */
export function normalizeProjectId(name: string): string {
  if (PROJECT_ID_RE.test(name)) return name;
  return name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^[-_]+|-$/g, '');
}

/**
 * Scan `projectsDir` for project sub-directories. Pure + total: a missing or
 * unreadable projects root yields an empty list (a fresh box has no projects,
 * which is a working state, not an error). Entries are sorted by id so callers
 * get deterministic output.
 *
 * @param projectsDir - absolute path to the projects root (see resolveProjectsDir)
 * @param forgeRoot   - absolute forge root, used to relativise `path`
 */
export function discoverProjects(projectsDir: string, forgeRoot: string): DiscoveredProject[] {
  let entries: string[];
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true })
      // Skip dot-prefixed dirs — a `.staging-<id>-*` in-flight/orphaned create
      // (SEC-05 4on reopen-1) must NEVER surface as a project. A real project id
      // is slug-validated (no leading dot), so this drops only non-projects.
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }

  const root = resolve(forgeRoot);
  const found: DiscoveredProject[] = [];
  for (const name of entries) {
    // W7-A4: the id IS the directory name — a name that fails the id rule
    // (whitespace, `.`, a leading `-`, …) can never be resolved by a `:id`
    // route, so it is not a project and is never listed (a listed id must be
    // routable; knowledge-03's "listed but every route 400s" shape).
    if (!PROJECT_ID_RE.test(name)) continue;
    const id = name;
    const absPath = join(projectsDir, name);
    const rel = relative(root, absPath);
    // Skip any dir that resolves outside the forge root (defensive; should not
    // happen for a sub-dir of projectsDir, but guards a symlinked projectsDir).
    const path = rel && !rel.startsWith('..') ? rel.split(sep).join('/') : absPath;
    const hasConfig = existsSync(join(absPath, '.forge', 'project.json'));
    found.push({ id, path, hasConfig, absPath });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Brain 3 (project) — the project's brain root, CENTRAL in the forge brain wiki
 * at `brain/projects/<name>/` (ADR 035, reversing ADR 018's in-repo location so
 * the reflector can write it post-merge without an open project worktree).
 */
export function projectBrainDir(forgeRoot: string, projectName: string): string {
  return resolve(forgeRoot, 'brain', 'projects', projectName);
}

/** Brain 3 (project) — a managed project's theme dir, central (ADR 035). */
export function projectThemesDir(forgeRoot: string, projectName: string): string {
  return resolve(projectBrainDir(forgeRoot, projectName), 'themes');
}

/**
 * Where a run records the GitHub remotes it MINTED — bead `forge-8vfn.6.11.29`.
 *
 * `sweepStoryRemotes` has always required a creation manifest as its first of
 * two independent conditions, and **nothing ever wrote one**, so its `created`
 * list was permanently empty: the guard that refuses an unlisted repo was being
 * proven against a list that could not contain anything. Both the caller AND
 * its only real input were missing (`6.11.2`, reopened).
 *
 * The path lives here because two packages must agree on it — `packages/projects`
 * writes it at mint time, `scripts/stories` reads it at the trailing sweep — and
 * a second definition is how they would come to disagree.
 */
export function mintedRemotesManifestPath(forgeRoot: string): string {
  return resolve(forgeRoot, '_logs', 'minted-remotes.json');
}

/**
 * Append one `owner/repo` to that manifest.
 *
 * It lives beside the path rather than in the package that writes it because
 * the file's SHAPE is a contract between two packages — `packages/projects`
 * appends, `scripts/stories` reads — and a second implementation of the append
 * is how the two would come to disagree about it.
 *
 * Never throws: a project creation must not fail because its bookkeeping did.
 * The failure is not silent in the way that matters — an unrecorded remote is
 * one the sweep then REFUSES to delete, which is the safe direction.
 */
export function recordMintedRemote(forgeRoot: string, nameWithOwner: string): void {
  try {
    const path = mintedRemotesManifestPath(forgeRoot);
    mkdirSync(dirname(path), { recursive: true });
    const prior = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : [];
    const rows = Array.isArray(prior) ? prior : [];
    rows.push({ nameWithOwner, at: new Date().toISOString() });
    writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
  } catch { /* bookkeeping only — see the docstring */ }
}

/**
 * Does `forgeRoot` actually manage `projectDir`? — bead `forge-8vfn.6.11.26`.
 *
 * Brain 3 is CENTRAL: it lives under the forge root, while a project's own
 * files live under `projectDir`. A writer handed both is only coherent when the
 * root is the one that manages that project. S1 run 5 (M5-B session 8) was
 * handed a mismatched pair and split its single fix across two trees —
 * `roadmap.md` into the lane's ground, `brain/projects/<name>/profile.md` into
 * a different checkout entirely.
 *
 * `resolveProjectsDir` is the one place that decides where a root's projects
 * live, so this honours `FORGE_PROJECTS_DIR` and `forge.config.json` exactly as
 * every other caller does. Resolved, not `realpath`ed: forge is WSL2/Linux-only,
 * where neither a git worktree nor `/tmp` is a symlink, and reading a link here
 * would add a raw-fs sink to a bridge-reachable module to buy nothing.
 */
export function rootManagesProject(forgeRoot: string, projectDir: string): boolean {
  const rel = relative(resolve(resolveProjectsDir(forgeRoot)), resolve(projectDir));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Why a `(forgeRoot, projectDir)` pair was refused — the sentence a caller
 * surfaces instead of writing into a tree that does not own the project. It
 * lives here because it explains a KERNEL invariant (Brain 3 is central to the
 * forge root, ADR 035) using paths only this module computes, and because the
 * next incident is attributable from one log line only if both roots are named.
 */
export function rootMismatchReason(forgeRoot: string, projectDir: string): string {
  return (
    `forgeRoot ${forgeRoot} does not manage ${projectDir} (its projects live at ` +
    `${resolveProjectsDir(forgeRoot)}). Brain 3 is central to the forge root (ADR 035), so ` +
    'writing here would put this project\'s profile in an unrelated tree.'
  );
}
