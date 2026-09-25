/**
 * Single source of truth for forge-side brain filesystem paths.
 *
 * The three-brain restructure (2026-05-26, ADR 018) moved several brain
 * directories. Before this module, the new locations were re-derived ad hoc
 * with `resolve(...)`/`join(...)` in half a dozen modules, and a later
 * rename left some readers pointing at directories that no longer exist
 * (e.g. the empty `brain/_raw/cycles/`). Route every brain-path lookup
 * through here so a future move is a one-file change.
 *
 * Layout (forge repo) — ADR 035: per-project brain + history + contract are
 * forge-owned and CENTRAL (no longer in the managed project's repo):
 *   brain/cycles/themes/                  — Brain 2: forge-level cycle-derived themes
 *   brain/cycles/_raw/                     — Brain 2: raw cycle archives
 *   brain/forge-dev/                       — Brain 1: forge engineering knowledge
 *   brain/projects/<name>/themes/          — Brain 3: per-project themes (central)
 *   project-artifacts/<name>/demo-history/<init>/ — archived dev/demo history (central)
 *   project-artifacts/<name>/contract.json — resolved forge↔project contract (central SSOT)
 *
 * The in-PR demo dir (`projectDemoRelDir`, demo-paths.ts) stays WORKTREE-relative — it is the
 * demo the unifier authors into the PR, not the post-merge archive. `artifactRoot`
 * (project.json) now governs only that in-repo demo location.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { resolveGuardedPath } from '@forge/kernel';

/** Brain 2 (cycles) — forge-level cycle-derived themes. */
export function cyclesThemesDir(forgeRoot: string): string {
  return resolve(forgeRoot, 'brain', 'cycles', 'themes');
}

/** Brain 2 (cycles) — raw cycle archives. */
export function cyclesRawDir(forgeRoot: string): string {
  return resolve(forgeRoot, 'brain', 'cycles', '_raw');
}

/** Path to a single cycle's raw archive markdown under Brain 2. */
export function cycleArchivePath(forgeRoot: string, cycleId: string): string {
  return resolve(cyclesRawDir(forgeRoot), `${cycleId}.md`);
}

/** Forge-root-relative form of {@link cycleArchivePath}, for display + frontmatter. */
export function cycleArchiveRelPath(cycleId: string): string {
  return `brain/cycles/_raw/${cycleId}.md`;
}

/**
 * The ONE kbId-from-path regex (forge-8vfn.8.3.5 / M7-C ABR). Matches a
 * `brain/` path SEGMENT — at the start of the string or after a `/`, so both
 * a repo-relative path (`brain/cycles/themes/x.md`, the PM's
 * `readPmBrainContext` shape) and an absolute one (an architect tool call's
 * `file_path`, since the architect's SDK session runs with `cwd` set to the
 * PROJECT repo, not forgeRoot — brain/ paths it Reads are absolute) resolve
 * to the same kbId. Optional `projects/` covers Brain 3 (`brain/projects/<id>/`).
 *
 * forge-8vfn.5.16 (M7-C U2) inlined an anchored ('^brain/...') copy of this
 * regex in `packages/stations/phases/project-manager.ts` before this helper
 * existed; that copy's input is always repo-relative so this superset regex
 * matches it identically. U2 should repoint at this export on merge rather
 * than carry a second definition (see this bead's report).
 */
const BRAIN_KB_ID_RE = /(?:^|\/)brain\/(?:projects\/)?([^/]+)\//;

/**
 * Derive the kbId a brain-rooted path belongs to, or `null` when `path` names
 * no brain/ segment at all (an ordinary project-repo path, the common case for
 * every OTHER file a turn reads). Never throws — a malformed/empty `path`
 * simply fails to match.
 */
export function deriveKbIdFromBrainPath(path: string): string | null {
  return BRAIN_KB_ID_RE.exec(path)?.[1] ?? null;
}

// Brain 3 (project) dirs — kernel owns these now (M4 ruling 18); this
// re-export keeps this module the one brain-path door (ADR 035).
export { projectBrainDir, projectThemesDir } from '@forge/kernel';

/**
 * Resolve a kbId to its on-disk brain directory, supporting BOTH top-level
 * brains (`brain/<id>` — e.g. `cycles`, `forge-dev`) AND central per-project
 * brains (`brain/projects/<id>` — ADR 035). The id stays flat + URL-safe (no
 * slash, so the Studio `/api/studio/kbs/:id` routes are unaffected): it is tried
 * at `brain/<id>` first, then falls back to `brain/projects/<id>`. Returns the
 * directory that actually carries a `kb.yaml`, or `null` if neither does.
 *
 * This is what makes per-project brains (gitpulse, mdtoc, …) reachable in
 * Studio's KB graph — every KB resolver routes through here so the fallback is a
 * one-place change.
 *
 * CONTAINMENT (bd `forge-wze`). `kbId` arrives straight off the Studio bridge's
 * `/api/studio/kbs/:id` routes, so this function is the choke point for the KB
 * half of the path-containment family. It previously resolved with
 * `resolve()` + `existsSync()`, which follows symlinks and asserts no identity
 * — confirmed live as an arbitrary-file-READ (`brain/<id>` symlinked outside)
 * and, through the nested tails its callers build, an arbitrary-file-WRITE.
 *
 * Both candidate locations are now resolved through the shared
 * `resolveGuardedPath` (per-segment realpath IDENTITY walk + `nlink` check on
 * the leaf). Note the call shape, which is load-bearing: each `root` is a
 * fixed, forgeRoot-derived constant and `kbId` is passed as its OWN
 * `segments[]` element. Folding it into `root` instead
 * (`resolveGuardedPath(join(base, kbId), ['kb.yaml'])`) would bypass every
 * check this guard makes — see the CONTRACT section of
 * `cli/studio-path-guard.ts`.
 *
 * Returning `dirname(realPath)` rather than the unresolved `join()` is
 * deliberate: callers append nested tails (`themes/`, `_raw/`, `_guidance/`)
 * to whatever this returns, so it must hand back the identity-verified real
 * directory, not a string that merely looks right.
 */
export function resolveKbBrainDir(forgeRoot: string, kbId: string): string | null {
  // Two containment roots, tried in order (top-level brain wins over a
  // same-named project brain — unchanged). Both are fixed and
  // forgeRoot-derived; neither is ever built from `kbId`.
  const roots = [resolve(forgeRoot, 'brain'), resolve(forgeRoot, 'brain', 'projects')];
  for (const root of roots) {
    const guarded = resolveGuardedPath(root, [kbId, 'kb.yaml']);
    // `exists: false` means the descriptor is not there — the same "no such
    // KB" answer the old `existsSync` gave. A guard REJECTION (`ok: false`)
    // is deliberately collapsed into the same answer so a planted symlink and
    // an absent brain are indistinguishable to the caller; the alternative
    // leaks a probe oracle for exactly the attacker iterating on this guard.
    if (guarded.ok && guarded.exists) return dirname(guarded.realPath);
  }
  return null;
}

// Why: design.md § Brain-lint truthfulness axis (forge-mfv5.3.4)
export function requireKbBrainDir(forgeRoot: string, kbId: string): string {
  const kbDir = resolveKbBrainDir(forgeRoot, kbId);
  if (!kbDir) {
    throw new Error(`Unknown kbId: "${kbId}" — no brain/${kbId}/kb.yaml or brain/projects/${kbId}/kb.yaml found`);
  }
  return kbDir;
}


// projectDemoRelDir moved to demo-paths.ts (plan 2.5 / N3) — the demo-artifact
// path SSOT. This module keeps readArtifactRoot: artifactRoot also governs
// non-demo in-repo locations (project brain dir, profile.md).

/**
 * Read a managed project's `artifactRoot` straight from its `.forge/project.json`
 * without a full config validation pass — for the brain-path consumers that only
 * hold a `projectName`/`projectRoot` string. Returns `"."` (legacy layout) when
 * the file is absent, unreadable, malformed, or omits the field, so a resolution
 * failure can never escalate into a thrown brain-path lookup.
 */
export function readArtifactRoot(projectRoot: string): string {
  try {
    const path = resolve(projectRoot, '.forge', 'project.json');
    if (!existsSync(path)) return '.';
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { artifactRoot?: unknown };
    const v = parsed?.artifactRoot;
    if (typeof v !== 'string') return '.';
    const trimmed = v.trim();
    if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.split('/').includes('..')) {
      return '.';
    }
    return trimmed === '.' ? '.' : trimmed;
  } catch {
    return '.';
  }
}


/**
 * Is `file` — absolute, or relative to `forgeRoot` — at or nested under `dir`?
 *
 * THE one containment comparison the KB scoping family shares: `KbBackend`'s
 * per-KB `contains()` (kb-backend.ts) and the findings lens `findingUnderDir`
 * (kb-lint-summary.ts) both route through here, so a KB's read scope and its
 * WRITE scope can never drift apart. It lives in this module because it is a
 * path rule, and because a copy in either caller would be a second definition
 * of "inside this knowledge base".
 *
 * Comparison is by identity-after-realpath, not a lexical prefix: `dir` is
 * already the realpath'd directory `resolveKbBrainDir` hands back, so a
 * symlinked forge-root component (e.g. macOS `/tmp`) cannot defeat the check,
 * and a file reached through a symlink that escapes `dir` is correctly EXCLUDED
 * rather than folded in. A realpath throw (a TOCTOU unlink between the
 * `existsSync` probe and the call) falls back to the lexical absolute path
 * rather than escaping and 500-ing an otherwise-fine caller.
 */
export function pathUnderDir(forgeRoot: string, dir: string, file: string): boolean {
  if (!file) return false;
  const abs = resolve(forgeRoot, file);
  let real = abs;
  try {
    if (existsSync(abs)) real = realpathSync(abs);
  } catch {
    real = abs;
  }
  return real === dir || real.startsWith(dir + sep);
}
