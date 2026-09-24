/**
 * Package-owned discovery roots (SEAM F1, operator ruling item 81): "a
 * second discovery root — package-owned flows".
 *
 * Flow discovery and skill discovery each had exactly ONE hardcoded root
 * before this module: `<forgeRoot>/studio/flows/<id>/flow.yaml` and
 * `<forgeRoot>/skills/<slug>/SKILL.md`. This adds a SECOND kind of root for
 * each: a package's own `flows/` or `skills/` directory
 * (`<forgeRoot>/packages/<pkg>/flows`, `.../skills`). A factory now ships as
 * a package — drop `packages/<pkg>/flows/<id>/flow.yaml` or
 * `packages/<pkg>/skills/<slug>/SKILL.md` and the platform discovers it with
 * NO registration code; delete `packages/<pkg>` and that factory's flows and
 * agents are gone and nothing else changes.
 *
 * `studio/flows/` and `skills/` stay first in the returned list (the only
 * WRITABLE root for flows — `apps/forge/bridge-studio-writes.ts` refuses to
 * save/delete a flow whose id already resolves to a package root — and the
 * operator-authored root for skills), but their position is never used to
 * break a tie: a flow or skill id present under more than one root is a
 * defect in the checkout and every resolver built on this module reports it
 * as a loud, named error, never "first root wins" (`resolveIdAcrossRoots` /
 * `listIdsAcrossRoots` below).
 *
 * CONTAINMENT: a symlinked `packages/<pkg>` directory, or a symlinked
 * `flows`/`skills` leaf inside an otherwise real package directory, is NOT
 * followed. `readdirSync(dir, {withFileTypes:true})`'s `Dirent.isDirectory()`
 * reflects the ENTRY's own on-disk type (as `readdir` reports it), not what
 * a symlink points at, so a symlinked entry is simply excluded at each level
 * — the same convention `packages/library/skill-path.ts`'s `listSkillMdDirs`
 * documents and relies on for its own `SKILL.md` leaf.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FORGE_ROOT } from './ids.ts';
import { guardedFile } from './path-guard.ts';

/** Real (non-symlink) immediate subdirectory NAMES of `dir`, sorted. Absent
 *  or unreadable ⇒ [] — never an error; a fresh checkout with no `packages/`
 *  dir, or a package with no `flows/`/`skills/` dir, is a working state. */
function realSubdirNames(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** `<forgeRoot>/<primaryDir...>` first, then every real
 *  `<forgeRoot>/packages/<pkg>/<leaf>` that is itself a real (non-symlink)
 *  directory, package names sorted (deterministic — `readdirSync` order is
 *  not guaranteed). */
function discoveryRoots(forgeRoot: string, primaryDir: readonly string[], leaf: string): string[] {
  const root = resolve(forgeRoot);
  const roots = [join(root, ...primaryDir)];
  const packagesDir = join(root, 'packages');
  for (const pkg of realSubdirNames(packagesDir)) {
    const pkgDir = join(packagesDir, pkg);
    if (realSubdirNames(pkgDir).includes(leaf)) {
      roots.push(join(pkgDir, leaf));
    }
  }
  return roots;
}

/** Every root a flow's `flow.yaml` may live under: `studio/flows` (the only
 *  WRITABLE root), then every package's own `flows/` directory. */
export function flowRoots(forgeRoot: string = FORGE_ROOT): string[] {
  return discoveryRoots(forgeRoot, ['studio', 'flows'], 'flows');
}

/** Every root a skill's `SKILL.md` may live under: `skills/` (the
 *  operator-authored root), then every package's own `skills/` directory. */
export function skillRoots(forgeRoot: string = FORGE_ROOT): string[] {
  return discoveryRoots(forgeRoot, ['skills'], 'skills');
}

// ---------------------------------------------------------------------------
// Generic multi-root id resolution — shared by every per-kind resolver built
// on `flowRoots`/`skillRoots` (`packages/flows/flow-runner.ts`'s
// `flowPathForId`, `packages/flows/studio/flow-registry.ts`'s `listFlowIds`,
// `packages/library/skill-path.ts`'s skill listing). A duplicate id across
// roots is a defect in the checkout — two objects claiming the same identity
// — and is ALWAYS a loud, named error, never "first root wins" (which would
// silently hide whichever object lost, and the loser would differ with
// `readdirSync` order, which Node does not guarantee is stable).
// ---------------------------------------------------------------------------

export interface RootMatch {
  /** The discovery root this id resolved under (one of the input `roots`). */
  root: string;
  /** The guarded, existence-confirmed absolute path to `<root>/<id>/<...leafSegments>`. */
  path: string;
}

/**
 * Resolve `id` to `<root>/<id>/<...leafSegments>` under whichever of `roots`
 * actually contains it (containment-checked via `guardedFile`, `mode:
 * 'read'` — every escape shape `resolveGuardedPath` closes applies here).
 * Returns `null` if no root has it. THROWS, naming every matching path, if
 * more than one root has it.
 */
export function resolveIdAcrossRoots(
  roots: readonly string[],
  id: string,
  leafSegments: readonly string[],
): RootMatch | null {
  const matches: RootMatch[] = [];
  for (const root of roots) {
    const path = guardedFile(root, [id, ...leafSegments], 'read');
    if (path !== null) matches.push({ root, path });
  }
  if (matches.length > 1) {
    throw new Error(
      `id "${id}" resolves under more than one discovery root: ${matches.map((m) => m.path).join(' AND ')}`,
    );
  }
  return matches[0] ?? null;
}

/**
 * Every id (a real, immediate subdirectory NAME) present under any of
 * `roots`, deduplicated and sorted. Directory presence only — no
 * `flow.yaml`/`SKILL.md` load or existence check, mirroring the single-root
 * `listFlowIds`'s original contract. THROWS, naming every root that carries
 * it, when the SAME id is a real directory under more than one root.
 */
export function listIdsAcrossRoots(roots: readonly string[]): string[] {
  const rootsById = new Map<string, string[]>();
  for (const root of roots) {
    for (const name of realSubdirNames(root)) {
      const list = rootsById.get(name) ?? [];
      list.push(root);
      rootsById.set(name, list);
    }
  }
  for (const [id, rootsWithId] of rootsById) {
    if (rootsWithId.length > 1) {
      throw new Error(`id "${id}" is a real directory under more than one discovery root: ${rootsWithId.join(' AND ')}`);
    }
  }
  return [...rootsById.keys()].sort();
}
