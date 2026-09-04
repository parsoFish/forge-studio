/**
 * KB descriptor sites — the ONE enumeration of "where a kb.yaml may live".
 *
 * Two containment roots (ADR 035): the top-level brains `brain/<id>/kb.yaml`
 * (cycles, forge-dev) and the central per-project brains
 * `brain/projects/<id>/kb.yaml` (gitpulse, mdtoc, trafficGame, …). Both
 * `loadKbDescriptors` (packages/knowledge/bridge-studio-kbs.ts — the roster + every per-KB
 * route) and `projectKbBindings` below (apps/forge/bridge-studio.ts — the project
 * roster's derived `kb` field) walk THIS list, so the KB roster and the
 * project↔KB pairing can never disagree about which descriptors exist.
 *
 * Kept as a leaf (node:fs + the path guard + the descriptor loader only) so
 * bridge-studio.ts can derive a project's KB without importing
 * bridge-studio-kbs.ts back (which imports bridge-studio.ts — an ESM cycle
 * that would only work while every cyclic use stayed inside function bodies).
 *
 * CONTAINMENT: each site is returned as `{ base, name }` — the fixed root and
 * the directory's own name as a separate segment — never a pre-joined path,
 * so every caller re-enters the guard with the id as its own identity-checked
 * segment (`resolveGuardedPath(base, [name, 'kb.yaml'])`). Dot-prefixed dirs
 * are skipped (a `.staging-*` leftover must never surface as a phantom KB).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveGuardedPath, KB_ID_RE } from '@forge/kernel';
import { loadKbDescriptor } from './studio/kb-descriptor.ts';

export type KbSite = { base: string; name: string };

function subDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Every `{ base, name }` under which a `kb.yaml` MAY live, both roots. */
export function kbSites(forgeRoot: string): KbSite[] {
  const brainRoot = join(resolve(forgeRoot), 'brain');
  if (!existsSync(brainRoot)) return [];
  const sites: KbSite[] = [];
  // Top-level brains: brain/<id>/kb.yaml (brain/projects has no kb.yaml of its
  // own, so it is naturally skipped here).
  for (const name of subDirs(brainRoot)) sites.push({ base: brainRoot, name });
  // Central per-project brains: brain/projects/<id>/kb.yaml (ADR 035) — a
  // SECOND containment root with the identical treatment.
  const projectsRoot = join(brainRoot, 'projects');
  for (const name of subDirs(projectsRoot)) sites.push({ base: projectsRoot, name });
  return sites;
}

/**
 * W7-A4 (knowledge-03) / W7-FIX-A4 (W7A4-04) — the ONE routability predicate
 * for a KB descriptor: every per-KB route resolves `kbId` → `brain/**\/<kbId>/`,
 * so a descriptor is routable iff its `id` IS its directory name (exact,
 * case-preserving) AND satisfies the id rule (`KB_ID_RE`). Returns null when
 * routable, else the human reason. Shared by the roster (`loadKbDescriptors`,
 * packages/knowledge/bridge-studio-kbs.ts — which also reports every drop as an
 * `UnroutableKb` diagnostic), the derived project↔KB binding
 * (`projectKbBindings` below) and `forge studio lint`'s kb `dir-name` check —
 * so the roster can never silently drop what lint accepts, or vice-versa.
 */
export function unroutableKbReason(kbId: string, dirName: string): string | null {
  if (!KB_ID_RE.test(kbId)) {
    return `KB id ${JSON.stringify(kbId)} does not match ${KB_ID_RE} (one path segment, case-preserving) — no route can resolve it`;
  }
  if (kbId !== dirName) {
    return `KB id "${kbId}" must equal its directory name "${dirName}" — every per-KB route resolves the id to brain/**/<id>/, so a mismatched descriptor is unreachable and is dropped from the roster`;
  }
  return null;
}

/**
 * One dropped descriptor — the roster's diagnostic row (`GET /api/studio/kbs`
 * → `unroutable[]`, collected by `loadKbDescriptors` in the SAME walk that
 * builds the list, W7-FIX-A4 / W7A4-04) and the shape lint reports the same
 * predicate under (`kb:<id>` / `dir-name`).
 */
export type UnroutableKb = { dir: string; id: string; path: string; reason: string };

/**
 * W7-A4 (projects-34) — project id → the KB id whose
 * `binding: { kind: project, ref: <project id> }` names it, DERIVED from the
 * descriptors on disk (never stored). Exact, case-preserving match on the ONE
 * id rule (`KB_ID_RE`/`PROJECT_ID_RE`): `trafficGame` ↔ `trafficGame`. A KB
 * that is not routable (`unroutableKbReason`) is not offered as a binding (a
 * listed id must be routable). First declaration wins on a (lint-flagged)
 * duplicate.
 */
export function projectKbBindings(forgeRoot: string): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const { base, name } of kbSites(forgeRoot)) {
    const guard = resolveGuardedPath(base, [name, 'kb.yaml']);
    if (!guard.ok || !guard.exists) continue;
    try {
      const kb = loadKbDescriptor(guard.realPath);
      if (unroutableKbReason(kb.id, name) !== null) continue;
      if (kb.binding.kind === 'project' && !bindings.has(kb.binding.ref)) bindings.set(kb.binding.ref, kb.id);
    } catch {
      // unreadable kb.yaml — the KB roster reports it; no binding to derive
    }
  }
  return bindings;
}
