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
import { dirname, join } from 'node:path';

import { assertSkillSlug, skillPath } from '../skill-path.ts';
import { hooksDir } from './hook-library.ts';
import { guardedFile } from '../../cli/studio-path-guard.ts';
import { listConnections } from './connection-library.ts';
import { communitySkillsFromRegistry } from './registry.ts';
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

function skillKnownInRegistry(forgeRoot: string, id: string): boolean {
  return communitySkillsFromRegistry(forgeRoot).some((cs) => cs.id === id);
}

export function routeCommunityInstall(forgeRoot: string, kind: CommunityKind, id: string): CommunityInstallRoute {
  assertSkillSlug(id); // D9 — throws on traversal-shaped/non-slug/over-length input, before any lookup

  if (kind === 'skill') {
    const dir = vendoredPackageDir(forgeRoot, 'skill', id);
    if (existsSync(join(dir, 'SKILL.md'))) {
      // T2 ruling: a real install destination occupied by something that
      // ISN'T this community package (no provenance block) must refuse
      // BEFORE dispatch — see collisionReason's own header comment.
      // W7-B3 (library-31): that occupancy now has its own honest state
      // token, 'present-unmanaged' (communityInstallState's skill branch) —
      // the old detection ('not-installed' while the path exists) is kept as
      // a belt-and-braces alternate so a future state-mapping change can
      // only widen, never silently disable, this refusal.
      if (existsSync(skillPath(id, forgeRoot))) {
        const state = communityInstallState(forgeRoot, 'skill', id);
        if (state === 'present-unmanaged' || state === 'not-installed') {
          return { pipeline: 'none', reason: collisionReason(id) };
        }
      }
      return { pipeline: 'skill', packageDir: dir, upstream: { source: VENDORED_UPSTREAM_SOURCE } };
    }
    if (skillKnownInRegistry(forgeRoot, id)) {
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
  // (mirrors the skill pipeline's own reinstall behaviour). Probe the dedup
  // through the realpath containment guard, NOT a bare existsSync on a lexical
  // path: a `studio/hooks/<id>` that is a SYMLINK out of the tree must never be
  // read as an already-installed copy. `guardedFile` 'read' resolves every
  // ancestor segment's realpath (leaf included), so a symlinked `<id>` segment
  // yields null — the symlink-following dedup can no longer launder a false
  // `alreadyInstalled: true` for an install dir that really points outside root.
  if (guardedFile(hooksDir(forgeRoot), [id, 'hook.yaml'], 'read') !== null) {
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

  // Ensure the TRUSTED containment root exists before guarding — `studio/hooks`
  // is a fixed, config-derived directory (never request-derived), and
  // `resolveGuardedPath` realpaths its `root` up front, so a fresh forge root
  // (where `studio/hooks/` does not exist yet) would otherwise reject every
  // write. Creating it does NOT weaken containment: only the untrusted `<id>`
  // segment (and the package's own leaf paths) go through the per-segment
  // identity walk below; the root itself is trusted by contract.
  mkdirSync(hooksDir(forgeRoot), { recursive: true });

  // PHASE 1 — bless every destination path through the SAME realpath guard,
  // LEAF INCLUDED, before any write (mirrors installSkillPackage's own AT-21
  // "validate the whole package, then write" discipline). A lexical
  // `resolve().startsWith(boundary)` check is worthless here: it normalises
  // `..` away and is blind to a symlinked `studio/hooks/<id>` install
  // destination, through which `writeFileSync` would follow the symlink and
  // land the vendored bytes OUTSIDE the boundary (zip-slip into the install
  // destination). `guardedFile` 'write' resolves every ancestor segment's
  // realpath — a symlinked `<id>` segment yields null → refusal, so no vendored
  // byte is ever written through the symlink. A failure here must never leave a
  // partial install on disk, so nothing is written until every path is blessed.
  const blessed = files.map((file) => {
    const realPath = guardedFile(hooksDir(forgeRoot), [id, ...file.path.split('/')], 'write');
    if (realPath === null) {
      throw new Error(`installCommunityHookPackage: destination for "${file.path}" is not contained under studio/hooks/${id}/ (traversal or symlink) — refusing to write`);
    }
    return { realPath, file };
  });

  // PHASE 2 — every path is blessed; materialise the bytes.
  for (const { realPath, file } of blessed) {
    mkdirSync(dirname(realPath), { recursive: true });
    writeFileSync(realPath, file.body, 'utf8');
  }

  return { alreadyInstalled: false };
}
