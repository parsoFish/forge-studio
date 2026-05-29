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
 *   projects/<name>/brain/themes/  (relative to the forge root).
 */

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

/** Brain 3 (project) — a managed project's own theme dir, inside its repo. */
export function projectThemesDir(forgeRoot: string, projectName: string): string {
  return resolve(forgeRoot, 'projects', projectName, 'brain', 'themes');
}
