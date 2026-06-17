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
 * Layout (forge repo):
 *   brain/cycles/themes/   — Brain 2: forge-level cycle-derived themes
 *   brain/cycles/_raw/     — Brain 2: raw cycle archives
 *   brain/forge-dev/       — Brain 1: forge engineering knowledge
 * Project themes (Brain 3) live in each project's OWN repo at
 *   projects/<name>/<artifactRoot>/brain/themes/  (relative to the forge root).
 * `artifactRoot` is the project's optional committed-artifact home (project.json
 * `artifactRoot`, default `"."` = legacy layout `projects/<name>/brain/themes/`).
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
 * The committed-artifact home for a managed project (project.json `artifactRoot`,
 * default `"."` = the project root itself). Brain 3 + development history hang
 * off this. `resolve(..., '.')` collapses to the legacy path, so callers that
 * don't pass `artifactRoot` are unaffected.
 */
export function projectArtifactDir(
  forgeRoot: string,
  projectName: string,
  artifactRoot = '.',
): string {
  return resolve(forgeRoot, 'projects', projectName, artifactRoot);
}

/** Brain 3 (project) — the project's brain root, inside its repo. */
export function projectBrainDir(
  forgeRoot: string,
  projectName: string,
  artifactRoot = '.',
): string {
  return resolve(projectArtifactDir(forgeRoot, projectName, artifactRoot), 'brain');
}

/** Brain 3 (project) — a managed project's own theme dir, inside its repo. */
export function projectThemesDir(
  forgeRoot: string,
  projectName: string,
  artifactRoot = '.',
): string {
  return resolve(projectBrainDir(forgeRoot, projectName, artifactRoot), 'themes');
}

/**
 * Committed development-history dir for one initiative
 * (`<artifactRoot>/history/<initiativeId>/`). The close-out step writes the
 * plan / demo / verdict bundle here so the project repo carries a browsable
 * record of how it was built.
 */
export function projectHistoryDir(
  projectRoot: string,
  initiativeId: string,
  artifactRoot = '.',
): string {
  return resolve(projectRoot, artifactRoot, 'history', initiativeId);
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
