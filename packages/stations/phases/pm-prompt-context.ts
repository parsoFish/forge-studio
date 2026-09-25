/**
 * What the project-manager prompt is BUILT FROM — the worktree reads and the
 * brain read, split out of `project-manager.ts` so that file comes under the
 * 800-line cap (M5-A exit row 8: "split by concern, never baselined").
 *
 * The seam is one-way and one concern: these three functions read, return
 * strings, and know nothing about the turn, the work-item set or the outcome.
 * `project-manager.ts` calls two of them once each, before the turn; the third
 * is `readProjectContext`'s own helper and travels with it rather than becoming
 * a second public name (ruling 31's door).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PM_ALWAYS_RELEVANT_THEMES } from './pm-binding.ts';


/** Bounds for the injected worktree listing (plan 2.11 — closes the
 *  six-broad-Globs gap from the 07-10 max-turns theme). */
const TREE_LISTING_MAX_DEPTH = 3;
const TREE_LISTING_MAX_ENTRIES = 400;
const TREE_LISTING_SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.git', '.next', '.forge', '.terraform', '__pycache__', 'target',
]);

/**
 * Read the project-shape context files off the worktree. Each is
 * optional — skipped if the file isn't present. Caps each file at
 * 8 KB so a freak large CLAUDE.md / package.json doesn't blow the
 * prompt budget; trims aren't ideal but the agent only needs enough
 * to identify the tooling.
 *
 * Surfaced 2026-05-25 by the claude-harness cycle 8 audit: PM was
 * hallucinating `jest` in a `node:test` project. Inlining
 * package.json's actual scripts makes it impossible to ignore.
 */
export function readProjectContext(worktreePath: string): {
  packageJson?: string;
  pyprojectToml?: string;
  cargoToml?: string;
  forgeProjectJson?: string;
  claudeMd?: string;
  treeListing?: string;
} {
  const safeRead = (rel: string): string | undefined => {
    const p = resolve(worktreePath, rel);
    if (!existsSync(p)) return undefined;
    try {
      const raw = readFileSync(p, 'utf8');
      return raw.length > 8192 ? raw.slice(0, 8192) + '\n… (truncated)' : raw;
    } catch {
      return undefined;
    }
  };
  return {
    packageJson: safeRead('package.json'),
    pyprojectToml: safeRead('pyproject.toml'),
    cargoToml: safeRead('Cargo.toml'),
    forgeProjectJson: safeRead('.forge/project.json'),
    claudeMd: safeRead('CLAUDE.md'),
    treeListing: buildTreeListing(worktreePath),
  };
}

/**
 * Plan 2.11 (G8 rescoped): pre-fetch the brain files EVERY PM run needs —
 * the project profile + the always-relevant themes SKILL.md Step 0 names —
 * so they ride in the prompt instead of costing agent turns. Domain-specific
 * project themes stay agent-discovered (the navigation index in the system
 * prompt covers them); only the deterministic reads are pinned here.
 * Best-effort per file (missing profile on a new project is fine); each
 * capped at 8 KB like the project-context reads.
 */
export function readPmBrainContext(
  forgeRoot: string,
  projectName: string,
): Array<{ path: string; content: string }> {
  const rels = [
    `brain/projects/${projectName}/profile.md`,
    ...PM_ALWAYS_RELEVANT_THEMES,
  ];
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of rels) {
    const p = resolve(forgeRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      out.push({
        path: rel,
        content: raw.length > 8192 ? raw.slice(0, 8192) + '\n… (truncated)' : raw,
      });
    } catch {
      /* best-effort — an unreadable theme is skipped, not fatal */
    }
  }
  return out;
}


/**
 * Depth- and entry-capped worktree listing, injected into the PM prompt so
 * the agent structurally sees the tree instead of re-deriving it with
 * repeated broad Globs (the 2026-07-10 theme recorded 6 Glob scans before
 * any WI write). Dot-entries and dependency/build dirs are skipped; deeper
 * paths remain reachable via targeted Glob.
 */
function buildTreeListing(worktreePath: string): string | undefined {
  const lines: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > TREE_LISTING_MAX_DEPTH || lines.length >= TREE_LISTING_MAX_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= TREE_LISTING_MAX_ENTRIES) return;
      if (entry.name.startsWith('.') || TREE_LISTING_SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        lines.push(`${childRel}/`);
        walk(join(dir, entry.name), childRel, depth + 1);
      } else {
        lines.push(childRel);
      }
    }
  };
  walk(worktreePath, '', 1);
  if (lines.length === 0) return undefined;
  const suffix =
    lines.length >= TREE_LISTING_MAX_ENTRIES
      ? `\n… (truncated at ${TREE_LISTING_MAX_ENTRIES} entries — use targeted Glob for deeper paths)`
      : '';
  return lines.join('\n') + suffix;
}
