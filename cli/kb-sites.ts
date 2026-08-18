/**
 * KB descriptor sites — the ONE enumeration of "where a kb.yaml may live".
 *
 * Two containment roots (ADR 035): the top-level brains `brain/<id>/kb.yaml`
 * (cycles, forge-dev) and the central per-project brains
 * `brain/projects/<id>/kb.yaml` (gitpulse, mdtoc, trafficGame, …). Both
 * `loadKbDescriptors` (cli/bridge-studio-kbs.ts — the roster + every per-KB
 * route) and `projectKbBindings` below (cli/bridge-studio.ts — the project
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

import { resolveGuardedPath } from './studio-path-guard.ts';
import { loadKbDescriptor } from '../orchestrator/studio/registry.ts';
import { KB_ID_RE } from '../orchestrator/studio/validate.ts';

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
 * W7-A4 (projects-34) — project id → the KB id whose
 * `binding: { kind: project, ref: <project id> }` names it, DERIVED from the
 * descriptors on disk (never stored). Exact, case-preserving match on the ONE
 * id rule (`KB_ID_RE`/`PROJECT_ID_RE`): `trafficGame` ↔ `trafficGame`. A KB
 * whose id fails the rule, or whose id is not its directory name, is not
 * routable and is not offered as a binding (a listed id must be routable).
 * First declaration wins on a (lint-flagged) duplicate.
 */
export function projectKbBindings(forgeRoot: string): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const { base, name } of kbSites(forgeRoot)) {
    const guard = resolveGuardedPath(base, [name, 'kb.yaml']);
    if (!guard.ok || !guard.exists) continue;
    try {
      const kb = loadKbDescriptor(guard.realPath);
      if (kb.id !== name || !KB_ID_RE.test(kb.id)) continue;
      if (kb.binding.kind === 'project' && !bindings.has(kb.binding.ref)) bindings.set(kb.binding.ref, kb.id);
    } catch {
      // unreadable kb.yaml — the KB roster reports it; no binding to derive
    }
  }
  return bindings;
}
