/**
 * Community install routing (R3-07-F3, `_wave5/specs/R3-07.md` D2/D9).
 *
 * D2 — install ROUTES, it never re-implements. `routeCommunityInstall`
 * decides which of the three ALREADY-MERGED pipelines owns an item and what
 * argument that pipeline needs — it never writes anything itself, and never
 * calls (or, in its own comments, spells the name of) a function that could
 * turn a quarantined draft into a trusted or runnable object; this file's
 * source text is scanned for exactly that (cli/community-no-trust-decisions.test.ts).
 * `installCommunityHookPackage` is the one genuinely new install-side
 * behaviour this initiative authors: hook install has no existing "install a
 * package from a directory" route the way skills do, so this materialises
 * the vendored bytes into `studio/hooks/<id>/` and STOPS — it never writes an
 * approval-ledger entry and never makes the hook runnable. It materialises
 * UNCONDITIONALLY, regardless of what a scan would say about the script:
 * refusing on a scan verdict would itself be the one kind of decision this
 * surface must not own — the deny-by-default execution gate lives entirely
 * in the runtime that later decides whether to actually run the script.
 *
 * D9 — a WELL-FORMED slug that resolves to no item is an ordinary not-found:
 * `{pipeline:'none', reason}`, never a throw. A throw is reserved for
 * MALFORMED input (traversal-shaped, non-slug, over-length) — an attack or a
 * programming error, not an absent item. The "unknown item" reason and the
 * "known but not vendored" reason are kept TEXTUALLY DISTINGUISHABLE (a
 * caller maps them to 404 vs 400 respectively) — see `unknownItemReason` /
 * `notVendoredReason` below; neither string may contain the other's marker
 * word.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { assertSkillSlug, skillPath } from '../skill-path.ts';
import { hookDir, hookYamlPath } from './hook-library.ts';
import { listConnections } from './connection-library.ts';
import { loadCatalog } from './registry.ts';
import { vendoredPackageDir, readVendoredPackage, communityInstallState } from './community-index.ts';
import type { CommunityKind } from './community-index.ts';
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from './skill-library.ts';

// ---------------------------------------------------------------------------
// routeCommunityInstall
// ---------------------------------------------------------------------------

export type CommunityInstallRoute =
  | { pipeline: 'skill'; packageDir: string; upstream: { source: string } }
  | { pipeline: 'hook'; packageDir: string }
  | { pipeline: 'connection'; connectionId: string }
  | { pipeline: 'none'; reason: string };

/** Every real committed vendored package is forge-authored and attributed to
 *  this repo's own seed hub (studio/community/README.md) — the real,
 *  literal source the owning skill pipeline's own install input records. */
const VENDORED_UPSTREAM_SOURCE = 'https://github.com/parsoFish/forge-studio';

function unknownItemReason(kind: CommunityKind, id: string): string {
  return `No ${kind} item "${id}" is known to the community index — unknown id`;
}

function notVendoredReason(id: string): string {
  return `Community skill "${id}" is a curated catalog reference with no vendored package on disk — install cannot be driven by this surface`;
}

/** T2 ruling (round 6): the real install destination (skills/<id>/) can be
 *  occupied by a hand-authored local skill that merely shares the id with a
 *  vendored community package — installSkillPackage itself already refuses
 *  to overwrite it (idempotent-reinstall guard), but silently dispatching to
 *  that pipeline anyway would report `alreadyInstalled:true`, i.e. "success",
 *  for a package that was never actually installed. Refusing HERE, before
 *  dispatch, is what makes the refusal visible to the operator instead of
 *  laundered into a false success. Textually distinct from BOTH existing "no
 *  route" reasons above (no "vendor", no "unknown"/"no such"/"not found"). */
function collisionReason(id: string): string {
  return `Local skill "${id}" already exists at this id (occupied) but carries no community-install provenance — refusing to touch a file that merely happens to share this id`;
}

function skillKnownInCatalog(forgeRoot: string, id: string): boolean {
  const catalogPath = join(forgeRoot, 'studio', 'catalog.yaml');
  if (!existsSync(catalogPath)) return false;
  return (loadCatalog(catalogPath).communitySkills ?? []).some((cs) => cs.id === id);
}

export function routeCommunityInstall(forgeRoot: string, kind: CommunityKind, id: string): CommunityInstallRoute {
  assertSkillSlug(id); // D9 — throws on traversal-shaped/non-slug/over-length input, before any lookup

  if (kind === 'skill') {
    const dir = vendoredPackageDir(forgeRoot, 'skill', id);
    if (existsSync(join(dir, 'SKILL.md'))) {
      // T2 ruling: a real install destination occupied by something that
      // ISN'T this community package (no provenance block) must refuse
      // BEFORE dispatch — see collisionReason's own header comment.
      if (existsSync(skillPath(id, forgeRoot)) && communityInstallState(forgeRoot, 'skill', id) === 'not-installed') {
        return { pipeline: 'none', reason: collisionReason(id) };
      }
      return { pipeline: 'skill', packageDir: dir, upstream: { source: VENDORED_UPSTREAM_SOURCE } };
    }
    if (skillKnownInCatalog(forgeRoot, id)) {
      return { pipeline: 'none', reason: notVendoredReason(id) };
    }
    return { pipeline: 'none', reason: unknownItemReason('skill', id) };
  }

  if (kind === 'hook') {
    const dir = vendoredPackageDir(forgeRoot, 'hook', id);
    if (existsSync(join(dir, 'hook.yaml'))) {
      return { pipeline: 'hook', packageDir: dir };
    }
    return { pipeline: 'none', reason: unknownItemReason('hook', id) };
  }

  // kind === 'mcp' | 'tool' — the catalog IS the only source (D1); no
  // in-between "known but not vendored" state exists for a connection.
  const found = listConnections(forgeRoot).some((c) => c.kind === kind && c.id === id);
  if (found) return { pipeline: 'connection', connectionId: id };
  return { pipeline: 'none', reason: unknownItemReason(kind, id) };
}

// ---------------------------------------------------------------------------
// installCommunityHookPackage — the one genuinely new install-side behaviour
// (D2): materialise the vendored bytes into studio/hooks/<id>/ and STOP.
// ---------------------------------------------------------------------------

export interface InstallCommunityHookInput {
  forgeRoot: string;
  id: string;
}

export interface InstallCommunityHookResult {
  alreadyInstalled: boolean;
}

export function installCommunityHookPackage(input: InstallCommunityHookInput): InstallCommunityHookResult {
  const { forgeRoot, id } = input;
  assertSkillSlug(id);

  const vendoredDir = vendoredPackageDir(forgeRoot, 'hook', id);
  if (!existsSync(join(vendoredDir, 'hook.yaml'))) {
    throw new Error(`installCommunityHookPackage: no vendored hook package for "${id}" at "${vendoredDir}" — nothing to materialise`);
  }

  // Reinstall is idempotent — leave the existing installed copy untouched
  // (mirrors the skill pipeline's own reinstall behaviour).
  if (existsSync(hookYamlPath(id, forgeRoot))) {
    return { alreadyInstalled: true };
  }

  const files = readVendoredPackage(forgeRoot, 'hook', id);

  // MINOR (T2 round 4): package size caps, reused from skill-library.ts
  // rather than retyped — symmetry with installSkillPackage's own caps, kept
  // in step by derivation, not duplication.
  if (files.length > MAX_PACKAGE_FILES) {
    throw new Error(`installCommunityHookPackage: package "${id}" has ${files.length} files, exceeding the ${MAX_PACKAGE_FILES}-file cap`);
  }
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.body, 'utf8'), 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error(`installCommunityHookPackage: package "${id}" exceeds the ${MAX_PACKAGE_BYTES}-byte cap`);
  }

  // Pre-validate every destination path BEFORE any write (mirrors
  // installSkillPackage's own AT-21 discipline) — a failure above or below
  // must never leave a partial install on disk.
  const destDir = hookDir(id, forgeRoot);
  const boundary = resolve(destDir) + sep;
  const destinations = files.map((file) => {
    const destPath = join(destDir, ...file.path.split('/'));
    if (!resolve(destPath).startsWith(boundary)) {
      throw new Error(`installCommunityHookPackage: destination for "${file.path}" escapes "${destDir}" — refusing to write`);
    }
    return { destPath, file };
  });

  for (const { destPath, file } of destinations) {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, file.body, 'utf8');
  }

  return { alreadyInstalled: false };
}
