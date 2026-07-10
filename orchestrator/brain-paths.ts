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
 */
export function resolveKbBrainDir(forgeRoot: string, kbId: string): string | null {
  const direct = resolve(forgeRoot, 'brain', kbId);
  if (existsSync(resolve(direct, 'kb.yaml'))) return direct;
  const project = projectBrainDir(forgeRoot, kbId);
  if (existsSync(resolve(project, 'kb.yaml'))) return project;
  return null;
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
