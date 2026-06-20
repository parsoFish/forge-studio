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
 * The in-PR demo dir (`projectDemoRelDir`) stays WORKTREE-relative — it is the
 * demo the unifier authors into the PR, not the post-merge archive. `artifactRoot`
 * (project.json) now governs only that in-repo demo location.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
 * Central forge-owned artifacts home for a managed project (ADR 035):
 * `project-artifacts/<name>/`. Holds the archived development/demo history and
 * the resolved contract. Forge-owned + committed with forge's history — NOT in
 * the managed project's repo.
 */
export function projectArtifactsDir(forgeRoot: string, projectName: string): string {
  return resolve(forgeRoot, 'project-artifacts', projectName);
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
 * Central archived development/demo-history dir for one initiative (ADR 035):
 * `project-artifacts/<name>/demo-history/<initiativeId>/`. The post-merge
 * close-out writes the plan / demo / verdict bundle here so forge carries a
 * browsable record of how each initiative was built, without committing into
 * the project repo.
 */
export function projectHistoryDir(
  forgeRoot: string,
  projectName: string,
  initiativeId: string,
): string {
  return resolve(projectArtifactsDir(forgeRoot, projectName), 'demo-history', initiativeId);
}

/** Central SSOT path for a managed project's resolved forge↔project contract
 *  (ADR 035): `project-artifacts/<name>/contract.json`. The in-repo
 *  `.forge/project.json` stays only as the thin discovery pointer. */
export function projectContractPath(forgeRoot: string, projectName: string): string {
  return resolve(projectArtifactsDir(forgeRoot, projectName), 'contract.json');
}

/**
 * The worktree-relative demo directory for one initiative, resolved against the
 * project's `artifactRoot`. Single source of truth for where the unifier writes
 * the tracked demo bundle (and where every demo-seam consumer looks for it).
 *
 * - `artifactRoot === '.'` (legacy layout) → `demo/<initiativeId>` — unchanged,
 *   so projects that don't set `artifactRoot` keep the original location.
 * - any other `artifactRoot` → `<artifactRoot>/history/<initiativeId>/demo`, so a
 *   project that gathers its committed artifacts under (e.g.) `forge/` lands the
 *   demo alongside that initiative's history record at
 *   `forge/history/<initiativeId>/demo` rather than a parallel top-level `demo/`.
 *
 * Returns a POSIX-style relative path (forward slashes) because it is used both
 * as a filesystem segment AND as display text in prompts; callers `resolve(...)`
 * it against the worktree root when they need an absolute path. The same
 * path-escape guard `readArtifactRoot` applies means the segment is always clean.
 */
export function projectDemoRelDir(initiativeId: string, artifactRoot = '.'): string {
  const root = artifactRoot.trim();
  if (root === '' || root === '.') return `demo/${initiativeId}`;
  return `${root}/history/${initiativeId}/demo`;
}

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
