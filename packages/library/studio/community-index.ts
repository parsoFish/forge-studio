/**
 * Community index — DERIVED read-model over three existing registries
 * (R3-07-F1/F2, `_wave5/specs/R3-07.md`). This module owns ZERO trust
 * decisions: every fact rendered here is derived at read time from a real,
 * already-merged pipeline — nothing is written, nothing is approved, nothing
 * is overridden here, and no comment in this file spells the name of a
 * function that could do any of that (D2).
 *
 * D1 — three sources, no fourth declared list:
 *   kind skill    ← studio/community/registry.yaml `kind: skill` items
 *                   (W6-CR-1; moved off studio/catalog.yaml's former
 *                   `community-skills:` section) UNION vendored packages
 *                   under studio/community/skills/ with no matching registry
 *                   id (E-1, mirrors skill-library.ts's own local-dir ∪
 *                   catalog union one level up).
 *   kind hook     ← vendored packages under studio/community/hooks/.
 *   kind tool/mcp ← listConnections(forgeRoot) (R3-04), 1:1, never re-parsed.
 *
 * D3 — installState is EXECUTED per item from that item's own registry read
 * (skillTrustState / hookRunState / probeConnection) — never an
 * environment-wide scan attributed to several rows.
 *
 * D4 — hub is DERIVED by matching an item's own upstream URL against
 * studio/community/hubs.yaml on a path-segment boundary (resolveHub). No
 * match ⇒ null. A vendored (forge-authored) package's "upstream" is this
 * repo's own seed URL — the literal, real location its bytes live at, not an
 * invented one — which is exactly what the forge-seed hub in hubs.yaml names.
 *
 * D5 — signals are populated only from a value the source record already
 * carries; a vendored package or a connection carries signals:null exactly,
 * never a fabricated zero or an empty object.
 *
 * D9 — vendoredPackageDir is the one path-construction point for a vendored
 * package: it reuses skill-path.ts's slug guard (shared, not reimplemented)
 * and adds a boundary check on the resolved path as defense-in-depth.
 *
 * D13 — item identity is the (kind, id) pair; a skill and an mcp sharing an
 * id are two distinct CommunityItem rows.
 *
 * D14 (W6-CR-2) — fetchedAt/fetchedBy/upstreamUpdatedAt are populated only
 * from a value the source record already carries, mirroring D5's discipline
 * for signals: a registry-sourced skill (`CommunitySkill`, itself sourced
 * from `CommunityRegistryItem`) carries its own real fetchedAt/fetchedBy/
 * upstreamUpdatedAt straight through. A vendored-only skill/hook or a
 * connection has NO registry row at all — there is nothing to have been
 * "fetched" from, so it honestly carries `fetchedAt: null`,
 * `fetchedBy: 'local'` (curated/authored in this repo, never fetched from
 * anywhere), `upstreamUpdatedAt: null` — never a fabricated timestamp.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

import { assertSkillSlug } from '@forge/kernel/ids.ts';
import { guardedSkillMdPath } from '../skill-path.ts';
import { skillTrustState } from './skill-trust.ts';
import type { SkillTrust } from './skill-trust.ts';
import { extractProvenance } from './skill-package.ts';
import type { PackageFile } from './skill-package.ts';
import { hookYamlPath } from './hook-library.ts';
import { hookRunState } from './hook-approval-ledger.ts';
import { listCatalogConnections } from './connection-library.ts';
import type { CatalogConnection } from './connection-library.ts';
import { probeConnection } from './connection-probe.ts';
import type { ProbeState, ProbeResult } from './connection-probe.ts';
import { communityRegistryPath, communitySkillsFromRegistry } from './community-registry.ts';
import { reqString, loadYaml } from '@forge/kernel/studio/yaml-fields.ts';
import { guardedFile, guardedReadFile } from '@forge/kernel';
import type { CommunitySkill } from '@forge/contracts/studio/types.ts';
import type { Finding } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Constants / types
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ['skill', 'hook', 'mcp', 'tool'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

/** W7-B3 (library-31) adds `present-unmanaged`: `skills/<id>` is OCCUPIED by
 *  a local skill with no community-install provenance — the community
 *  package is neither installed nor installable at that id, and both /skills
 *  and /community must say so with the same word instead of contradicting
 *  each other forever. */
export const COMMUNITY_INSTALL_STATES = ['not-installed', 'draft-pending-approval', 'needs-review', 'installed', 'present-unmanaged'] as const;
export type CommunityInstallState = (typeof COMMUNITY_INSTALL_STATES)[number];

/** Every real committed package under studio/community/ is forge-authored and
 *  attributed to this repo's own seed hub (studio/community/README.md) — the
 *  literal, real URL a vendored package's bytes actually live at, not an
 *  invented one. Matches hubs.yaml's `forge-seed` entry exactly. */
const VENDORED_UPSTREAM_SOURCE = 'https://github.com/parsoFish/forge-studio';

/** D14 (W6-CR-2) — the one honest `fetchedBy` value for an item with NO
 *  registry row (a vendored skill/hook package, or a tool/mcp connection):
 *  never fetched from anywhere, curated/authored directly in this repo. */
const FETCHED_BY_LOCAL = 'local';

export interface CommunityHub {
  id: string;
  name: string;
  url: string;
  kinds: string; // raw curated string, never parsed into an array (D10)
}

export type CommunityHubCount = CommunityHub & { itemCount: number };

export interface CommunitySignals {
  stars: string;
  attributedTo: string;
  /** Parsed NUMERIC star count, alongside the display `stars` string above —
   *  null when the curated display string names a different unit (e.g. "156k
   *  installs") or carries no figure at all; never fabricated (W6-CR-2). */
  starsNumeric: number | null;
}

export interface CommunityItem {
  kind: CommunityKind;
  id: string;
  name: string;
  description?: string;
  vendored: boolean;
  installState: CommunityInstallState;
  /** connection kinds only — the REAL raw probe state behind installState
   *  (which only distinguishes not-installed/installed). Always populated
   *  for kind mcp/tool (never re-probed a second time to obtain it — this
   *  IS the one real execution `installState` itself was derived from, T2
   *  round 5/6 probe-budget fix); absent for skill/hook (no probe concept
   *  exists for either). */
  probeState?: ProbeState;
  signals: CommunitySignals | null;
  hub: CommunityHub | null;
  /** ISO date this item was last verified against upstream — null until a
   *  real refresh pass has run for it (still just the seed) OR for an item
   *  with no registry row at all (D14). NEVER rendered as a date when null. */
  fetchedAt: string | null;
  /** Provenance of the currently-recorded data — e.g. "seed" for a
   *  registry-sourced item, or "local" (D14) for a vendored package/
   *  connection with no registry row. Always a real, non-blank string. */
  fetchedBy: string;
  /** ISO date the upstream project last published a change, per the
   *  registry's own curated fact — null when unknown or for an item with no
   *  registry row at all; never fabricated. */
  upstreamUpdatedAt: string | null;
  /** A malformed vendored package surfaces here — never silently dropped. */
  error?: string;
}

// ---------------------------------------------------------------------------
// listCommunityHubs / resolveHub — D4, D10
// ---------------------------------------------------------------------------

function hubsYamlPath(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'community', 'hubs.yaml');
}

export function listCommunityHubs(forgeRoot: string): CommunityHub[] {
  const file = hubsYamlPath(forgeRoot);
  if (!existsSync(file)) return []; // half-onboarded/fresh root — not an error
  const d = loadYaml(file); // throws loudly on malformed YAML (never a silent empty list)
  const raw = d['hubs'];
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: "hubs" must be an array`);
  }
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: hubs[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      url: reqString(e, 'url', file),
      kinds: reqString(e, 'kinds', file),
    };
  });
}

/** D4 — a path-segment-boundary prefix match: `upstream` matches `hub.url`
 *  exactly, or matches with `/` as the very next character — never a bare
 *  string prefix (".../servers-archived" must not match ".../servers"). */
export function resolveHub(upstream: string, hubs: readonly CommunityHub[]): CommunityHub | null {
  for (const hub of hubs) {
    if (upstream === hub.url || upstream.startsWith(`${hub.url}/`)) return hub;
  }
  return null;
}

// ---------------------------------------------------------------------------
// vendoredPackageDir / readVendoredPackage — D9
// ---------------------------------------------------------------------------

function vendoredBaseDir(forgeRoot: string, kind: 'skill' | 'hook'): string {
  return join(forgeRoot, 'studio', 'community', kind === 'skill' ? 'skills' : 'hooks');
}

/** The one path-construction point for a vendored package directory. Reuses
 *  skill-path.ts's slug guard (slug shape + MAX_SKILL_ID_LENGTH cap) rather
 *  than reimplementing it, and boundary-checks the resolved path as
 *  defense-in-depth on top of that guard (D9).
 *
 *  MAJOR 1 (T2 round 4 adversarial review): the lexical check above only
 *  catches a traversal-shaped ID — it does nothing about the package ROOT
 *  itself being a symlink to somewhere outside the vendored tree (a slug
 *  guard has no opinion on what a directory of that name resolves to on
 *  disk). Mirrors hook-library.ts's `resolveHookScriptPath` exactly: the
 *  real path can only be checked once the entry exists, so a non-existent id
 *  still takes the ordinary not-found path everywhere else in this module,
 *  never a realpath error here. */
export function vendoredPackageDir(forgeRoot: string, kind: 'skill' | 'hook', id: string): string {
  assertSkillSlug(id);
  const base = vendoredBaseDir(forgeRoot, kind);
  const dir = join(base, id);
  const boundary = resolve(base) + sep;
  if (resolve(dir) !== resolve(base) && !resolve(dir).startsWith(boundary)) {
    throw new Error(`vendoredPackageDir: resolved path for "${id}" escapes the vendored ${kind}s directory — refusing`);
  }
  if (existsSync(dir)) {
    const real = realpathSync(dir);
    const rootReal = resolve(base);
    if (real !== rootReal && !real.startsWith(boundary)) {
      throw new Error(
        `vendoredPackageDir: "${id}" resolves (after following symlinks) outside the vendored ${kind}s directory "${base}" — refusing`,
      );
    }
  }
  return dir;
}

/** Every file under a vendored package, sorted by relative POSIX path.
 *  Absent package ⇒ [], never a throw (a non-vendored id is an ordinary,
 *  expected shape — vendored-ness is exactly what this distinguishes).
 *
 *  LEAF GUARD (SEC-05 q80 GAP 1) — every leaf is read through the shared
 *  realpath containment guard, LEAF INCLUDED, the SAME twin treatment the META
 *  readers (readVendoredSkillMeta/readVendoredHookMeta) already get.
 *  `vendoredPackageDir` realpath-checks only the package DIRECTORY, never the
 *  leaves inside it, so a HARDLINKED leaf (SEC-04 escape-shape 5: a real,
 *  non-symlink dirent — `isFile()` true, `nlink > 1` — sharing an inode with an
 *  outside file, which `realpathSync` is structurally blind to) would otherwise
 *  read the shared inode's bytes straight into this served `files` payload
 *  (surfaced by GET /api/studio/community/:kind/:id). `guardedReadFile` walks
 *  `<vendored base>/<id>/<...relPath>` per segment (identity walk + `nlink === 1`
 *  leaf check): a hardlinked/symlinked leaf yields null → throw → the caller's
 *  try/catch surfaces a refusal, never the target bytes. (A symlinked leaf is
 *  additionally skipped by the `withFileTypes` walk itself — `isFile()` is false
 *  for a symlink dirent — so it never even reaches this read.) `assertSkillSlug`
 *  is already enforced upstream by `vendoredPackageDir`, satisfying the guard's
 *  slug CONTRACT (the guard verifies path containment, never slug shape). */
export function readVendoredPackage(forgeRoot: string, kind: 'skill' | 'hook', id: string): PackageFile[] {
  const dir = vendoredPackageDir(forgeRoot, kind, id);
  if (!existsSync(dir)) return [];
  const base = vendoredBaseDir(forgeRoot, kind);
  const out: PackageFile[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const absPath = join(absDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
      } else if (entry.isFile()) {
        const body = guardedReadFile(base, [id, ...relPath.split('/')]);
        if (body === null) {
          throw new Error(
            `readVendoredPackage: leaf "${relPath}" of vendored ${kind} "${id}" is missing or fails realpath containment (a symlinked/hardlinked leaf never surfaces its bytes) — refusing to read`,
          );
        }
        out.push({ path: relPath, body });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every vendored id under `studio/community/<skills|hooks>/` carrying its
 *  marker file — existence-only (mirrors listHookIds/listSkillMdDirs); parse
 *  validity is checked at read time, not here, so one malformed sibling never
 *  hides the rest of the listing. */
function listVendoredIds(forgeRoot: string, kind: 'skill' | 'hook'): string[] {
  const dir = vendoredBaseDir(forgeRoot, kind);
  const marker = kind === 'skill' ? 'SKILL.md' : 'hook.yaml';
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.filter((name) => existsSync(join(dir, name, marker))).sort();
}

// ---------------------------------------------------------------------------
// communityInstallState — D3: executed per item, never attributed
// ---------------------------------------------------------------------------

/** Total function over the closed SkillTrust union — an unrecognised value
 *  (only reachable if skill-library.ts's own union ever widens without this
 *  file being updated) throws rather than silently defaulting (D1). */
function installStateFromSkillTrust(trust: SkillTrust): CommunityInstallState {
  switch (trust) {
    case 'draft':
      return 'draft-pending-approval';
    case 'needs-review':
      return 'needs-review';
    case 'ready':
      return 'installed';
    default: {
      const exhaustive: never = trust;
      throw new Error(`communityInstallState: unrecognised skill trust state "${String(exhaustive)}"`);
    }
  }
}

/** Total function over the closed ProbeState union (connection-probe.ts) —
 *  same throwing-default discipline as installStateFromSkillTrust above. */
function installStateFromProbe(state: ProbeState): CommunityInstallState {
  switch (state) {
    case 'not-installed':
      return 'not-installed';
    case 'available':
    case 'misconfigured':
      return 'installed';
    default: {
      const exhaustive: never = state;
      throw new Error(`communityInstallState: unrecognised probe state "${String(exhaustive)}"`);
    }
  }
}

/** T2 ruling (round 6): install-state describes THIS community package, not
 *  path occupancy. `skills/<id>` can be occupied by a hand-authored local
 *  skill that merely happens to share the id — reporting that as "installed"
 *  would attribute a status from a fact about the path rather than an
 *  execution against the thing it describes. A `provenance` block is the one
 *  fact that distinguishes "this id went through the community pipeline" from
 *  "this id is merely occupied" — its absence means not-installed, regardless
 *  of what trust the (unrelated) file on disk would otherwise compute to. */
function skillHasProvenanceBlock(forgeRoot: string, id: string): boolean {
  // COMMON §15.19 — guarded read. A path that escapes `skills/` has no
  // provenance block BY DEFINITION: whatever the link points at did not go
  // through the community pipeline. Answering `false` here is the same
  // not-installed verdict this function already gives an unmanaged file, and
  // it is the safe direction — it refuses the install rather than blessing it.
  const mdPath = guardedSkillMdPath(id, forgeRoot);
  if (mdPath === null) return false;
  const { data } = matter(readFileSync(mdPath, 'utf8'), {});
  return extractProvenance((data ?? {}) as Record<string, unknown>) !== null;
}

export function communityInstallState(forgeRoot: string, kind: CommunityKind, id: string): CommunityInstallState {
  if (kind === 'skill') {
    if (guardedSkillMdPath(id, forgeRoot) === null) return 'not-installed';
    // W7-B3 (library-31): occupied WITHOUT a provenance block used to read
    // 'not-installed' — which made this surface offer an Install that the
    // pipeline (correctly) refuses, forever. The honest state has its own
    // name: present locally, unmanaged by the community pipeline.
    if (!skillHasProvenanceBlock(forgeRoot, id)) return 'present-unmanaged';
    return installStateFromSkillTrust(skillTrustState(forgeRoot, id));
  }
  if (kind === 'hook') {
    if (!existsSync(hookYamlPath(id, forgeRoot))) return 'not-installed';
    return hookRunState(forgeRoot, id).runnable ? 'installed' : 'draft-pending-approval';
  }
  // kind === 'mcp' | 'tool' — D3: probed from that connection's OWN execution.
  const connection = listCatalogConnections(forgeRoot).find((c) => c.kind === kind && c.id === id);
  if (!connection) {
    throw new Error(`communityInstallState: no ${kind} connection "${id}" found in studio/catalog.yaml`);
  }
  return installStateFromProbe(probeConnection(forgeRoot, connection).state);
}

// ---------------------------------------------------------------------------
// listCommunityIndex / communityItem — D1, D5, D13
// ---------------------------------------------------------------------------

/** D5 — a signals block is emitted only when the catalog record carries a
 *  real stars value AND a non-blank attribution (E-2: attributedTo is the
 *  record's own curated `provenance` string, never `hub?.name`). A
 *  whitespace-only provenance (reqString accepts it — it only rejects a
 *  truly empty string) renders signals:null rather than a blank attribution. */
function communitySkillSignals(cs: CommunitySkill): CommunitySignals | null {
  if (cs.stars === undefined) return null;
  const attributedTo = cs.provenance.trim();
  if (attributedTo.length === 0) return null;
  return { stars: cs.stars, attributedTo, starsNumeric: cs.starsNumeric };
}

/** The fixed-filename leaf (`SKILL.md`/`hook.yaml`) inside a vendored package
 *  is read through the shared realpath containment guard, LEAF INCLUDED —
 *  `vendoredPackageDir` only realpath-checks the package DIRECTORY, never the
 *  leaf inside it, so a `SKILL.md`/`hook.yaml` that is a SYMLINK to an external
 *  secret would otherwise be read through and its bytes surface in the served
 *  `CommunityItem` (name/description). `guardedReadFile`/`guardedFile` walk
 *  `<vendored base>/<id>/<leaf>` per segment: a symlinked leaf (or `<id>` dir)
 *  yields null → these throw → the caller's `try/catch` surfaces the module's
 *  existing `error:` entry, never the target bytes. `assertSkillSlug` stays as
 *  the caller-side slug check the guard's own CONTRACT requires (the guard
 *  verifies path containment, never slug shape — see cli/studio-path-guard.ts). */
function readVendoredSkillMeta(forgeRoot: string, id: string): { name: string; description?: string } {
  assertSkillSlug(id);
  const raw = guardedReadFile(vendoredBaseDir(forgeRoot, 'skill'), [id, 'SKILL.md']);
  if (raw === null) {
    throw new Error(`readVendoredSkillMeta: SKILL.md for vendored skill "${id}" is missing or fails realpath containment (a symlinked leaf never surfaces its bytes) — refusing to read`);
  }
  const { data } = matter(raw, {});
  const d = (data ?? {}) as Record<string, unknown>;
  const name = typeof d['name'] === 'string' && d['name'] ? (d['name'] as string) : id;
  const description = typeof d['description'] === 'string' ? (d['description'] as string) : undefined;
  return { name, description };
}

function readVendoredHookMeta(forgeRoot: string, id: string): { name: string; description?: string } {
  assertSkillSlug(id);
  // Guard the leaf, then feed the BLESSED realpath to `loadYaml` unchanged (its
  // path-based parse + mapping/read-error semantics are reused, not re-invented
  // as a string parse). A symlinked/absent leaf → null → throw → error entry.
  const yamlPath = guardedFile(vendoredBaseDir(forgeRoot, 'hook'), [id, 'hook.yaml'], 'read');
  if (yamlPath === null) {
    throw new Error(`readVendoredHookMeta: hook.yaml for vendored hook "${id}" is missing or fails realpath containment (a symlinked leaf never surfaces its bytes) — refusing to read`);
  }
  const d = loadYaml(yamlPath);
  return { name: reqString(d, 'name', yamlPath), description: reqString(d, 'description', yamlPath) };
}

// ---------------------------------------------------------------------------
// Per-item builders — pure (or single-I/O) projections shared by
// listCommunityIndex (loops every id) and communityItem (resolves exactly
// one). Splitting these out is what lets communityItem resolve a SINGLE item
// without enumerating — let alone probing — every other one (T2 round 5/6
// probe-budget fix: "communityItem() builds the WHOLE index and filters" was
// the detail-route scope leak).
// ---------------------------------------------------------------------------

function buildCatalogSkillItem(forgeRoot: string, hubs: readonly CommunityHub[], cs: CommunitySkill, vendored: boolean): CommunityItem {
  return {
    kind: 'skill',
    id: cs.id,
    name: cs.name,
    description: cs.desc,
    vendored,
    installState: communityInstallState(forgeRoot, 'skill', cs.id),
    signals: communitySkillSignals(cs),
    hub: resolveHub(cs.source, hubs),
    fetchedAt: cs.fetchedAt,
    fetchedBy: cs.fetchedBy,
    upstreamUpdatedAt: cs.upstreamUpdatedAt,
  };
}

function buildVendoredOnlySkillItem(forgeRoot: string, hubs: readonly CommunityHub[], id: string): CommunityItem {
  try {
    const meta = readVendoredSkillMeta(forgeRoot, id);
    return {
      kind: 'skill',
      id,
      name: meta.name,
      description: meta.description,
      vendored: true,
      installState: communityInstallState(forgeRoot, 'skill', id),
      signals: null,
      hub: resolveHub(VENDORED_UPSTREAM_SOURCE, hubs),
      fetchedAt: null,
      fetchedBy: FETCHED_BY_LOCAL,
      upstreamUpdatedAt: null,
    };
  } catch (e) {
    return {
      kind: 'skill',
      id,
      name: id,
      vendored: true,
      installState: 'not-installed',
      signals: null,
      hub: null,
      fetchedAt: null,
      fetchedBy: FETCHED_BY_LOCAL,
      upstreamUpdatedAt: null,
      error: `cannot build community index entry for vendored skill "${id}" — ${(e as Error).message}`,
    };
  }
}

function buildHookItem(forgeRoot: string, hubs: readonly CommunityHub[], id: string): CommunityItem {
  try {
    const meta = readVendoredHookMeta(forgeRoot, id);
    return {
      kind: 'hook',
      id,
      name: meta.name,
      description: meta.description,
      vendored: true,
      installState: communityInstallState(forgeRoot, 'hook', id),
      signals: null,
      hub: resolveHub(VENDORED_UPSTREAM_SOURCE, hubs),
      fetchedAt: null,
      fetchedBy: FETCHED_BY_LOCAL,
      upstreamUpdatedAt: null,
    };
  } catch (e) {
    return {
      kind: 'hook',
      id,
      name: id,
      vendored: true,
      installState: 'not-installed',
      signals: null,
      hub: null,
      fetchedAt: null,
      fetchedBy: FETCHED_BY_LOCAL,
      upstreamUpdatedAt: null,
      error: `cannot build community index entry for vendored hook "${id}" — ${(e as Error).message}`,
    };
  }
}

/** Pure — takes the connection's OWN already-executed probe result rather
 *  than running one itself, so every caller (listCommunityIndex's loop,
 *  communityItem's single-connection resolution) controls exactly when the
 *  one real spawn happens and never repeats it (T2 round 5/6). `probeState`
 *  is always populated here — the real raw state behind `installState`. */
export function buildConnectionItem(hubs: readonly CommunityHub[], conn: CatalogConnection, probe: ProbeResult): CommunityItem {
  return {
    kind: conn.kind,
    id: conn.id,
    name: conn.name,
    description: conn.desc,
    vendored: false,
    installState: installStateFromProbe(probe.state),
    probeState: probe.state,
    signals: null,
    hub: resolveHub(conn.provenance, hubs),
    fetchedAt: null,
    fetchedBy: FETCHED_BY_LOCAL,
    upstreamUpdatedAt: null,
  };
}

/** Tolerant registry read shared by listCommunityIndex and communityItem
 *  (skill branch) — MAJOR 2's missing-vs-malformed split applies identically
 *  here (W6-CR-1: community skills moved from catalog.yaml's `community-skills:`
 *  section to studio/community/registry.yaml): a missing registry.yaml
 *  degrades to `[]` with a loud console.warn (this seam's own semantics, kept
 *  distinct from communitySkillsFromRegistry's silent tolerance — every OTHER
 *  caller of that shared helper has its own established tolerance policy, see
 *  registry.ts's doc comment); a registry.yaml that EXISTS but fails to parse
 *  throws loud via communitySkillsFromRegistry's own unguarded
 *  loadCommunityRegistry call — a corrupt registry must never render
 *  identically to an honest empty one. */
function registrySource(forgeRoot: string): { exists: boolean; communitySkills: CommunitySkill[] } {
  const registryPath = communityRegistryPath(forgeRoot);
  const exists = existsSync(registryPath);
  if (!exists) {
    console.warn(`community-index: ${registryPath} not found — community skills degrade to vendored packages + connections only`);
  }
  return { exists, communitySkills: communitySkillsFromRegistry(forgeRoot) };
}

/** W7-B3 review F7: `kinds` (optional, additive — ADR-042 disclose-not-park)
 *  narrows which sections are BUILT, not merely which are returned: a caller
 *  that wants only hooks (the /hooks page's community shelf) must not pay a
 *  child-process probe per catalog connection plus the registry read to get
 *  them. Omitted = every kind, byte-identical to the pre-F7 behavior. */
export function listCommunityIndex(forgeRoot: string, kinds?: readonly CommunityKind[]): CommunityItem[] {
  const want = (k: CommunityKind): boolean => kinds === undefined || kinds.includes(k);
  const hubs = listCommunityHubs(forgeRoot);
  // MAJOR 2 (T2 round 4 adversarial review), now split across TWO independent
  // files (W6-CR-1 decoupled community-skill sourcing from catalog.yaml):
  //  - registrySource: a MISSING studio/community/registry.yaml is the
  //    fresh/half-onboarded shape — mirrors listCommunityHubs's own
  //    documented fresh-root precedent above — and degrades to [], never a
  //    throw. A registry.yaml that EXISTS but fails to parse throws loud (via
  //    communitySkillsFromRegistry's own unguarded loadCommunityRegistry
  //    call, inside registrySource) — a corrupt registry must never render
  //    identically to an honest empty one.
  //  - catalogExists (below): studio/catalog.yaml's own existence, gating
  //    ONLY the mcp/tool connections loop — listConnections reads catalog.yaml
  //    independently of the community-skill registry above.
  const items: CommunityItem[] = [];

  // --- skill: catalog community-skills ∪ vendored-with-no-catalog-id (E-1) ---
  if (want('skill')) {
    const { communitySkills } = registrySource(forgeRoot);
    const catalogSkillIds = new Set(communitySkills.map((cs) => cs.id));
    const vendoredSkillIdSet = new Set(listVendoredIds(forgeRoot, 'skill'));

    for (const cs of communitySkills) {
      items.push(buildCatalogSkillItem(forgeRoot, hubs, cs, vendoredSkillIdSet.has(cs.id)));
    }

    for (const id of vendoredSkillIdSet) {
      if (catalogSkillIds.has(id)) continue; // collision — lintCommunityIndex reports it; represented once, above
      items.push(buildVendoredOnlySkillItem(forgeRoot, hubs, id));
    }
  }

  // --- hook: vendored packages only (D1) ---
  if (want('hook')) {
    for (const id of listVendoredIds(forgeRoot, 'hook')) {
      items.push(buildHookItem(forgeRoot, hubs, id));
    }
  }

  // --- mcp / tool: listConnections(forgeRoot), 1:1, never re-parsed (D1) ---
  // Skipped entirely when studio/catalog.yaml is absent (MAJOR 2) — there is
  // nothing to source a connection from without it; never fabricated. Each
  // connection is probed EXACTLY ONCE here (T2 round 5/6 probe-budget fix —
  // this loop used to be re-entered independently by hubsWithCounts and by
  // the bridge's own second listCommunityIndex call; both now derive from
  // ONE computation, see hubCountsFrom below and packages/library/bridge-studio-community.ts).
  if ((want('mcp') || want('tool')) && existsSync(join(forgeRoot, 'studio', 'catalog.yaml'))) {
    for (const conn of listCatalogConnections(forgeRoot)) {
      if (!want(conn.kind)) continue;
      items.push(buildConnectionItem(hubs, conn, probeConnection(forgeRoot, conn)));
    }
  }

  return items;
}

/** Resolves the ONE requested (kind, id) pair directly — never by building
 *  the whole index and filtering (T2 round 5/6: that scope-leak probed every
 *  OTHER connection just to answer a single-item detail request). A
 *  connection kind is probed exactly once, for the requested connection
 *  only; skill/hook kinds never probe at all. */
export function communityItem(forgeRoot: string, kind: CommunityKind, id: string): CommunityItem | undefined {
  const hubs = listCommunityHubs(forgeRoot);

  if (kind === 'skill') {
    const { communitySkills } = registrySource(forgeRoot);
    const cs = communitySkills.find((c) => c.id === id);
    const isVendored = existsSync(join(vendoredPackageDir(forgeRoot, 'skill', id), 'SKILL.md'));
    if (cs) return buildCatalogSkillItem(forgeRoot, hubs, cs, isVendored);
    if (isVendored) return buildVendoredOnlySkillItem(forgeRoot, hubs, id);
    return undefined;
  }

  if (kind === 'hook') {
    if (!existsSync(join(vendoredPackageDir(forgeRoot, 'hook', id), 'hook.yaml'))) return undefined;
    return buildHookItem(forgeRoot, hubs, id);
  }

  // kind === 'mcp' | 'tool'
  const conn = listCatalogConnections(forgeRoot).find((c) => c.kind === kind && c.id === id);
  if (!conn) return undefined;
  return buildConnectionItem(hubs, conn, probeConnection(forgeRoot, conn));
}

// ---------------------------------------------------------------------------
// hubsWithCounts — D10: derived per-hub counts, honest zero
// ---------------------------------------------------------------------------

/** Pure derivation — no I/O, no probing. A caller that has ALREADY computed
 *  `items` (e.g. the bridge's list route) derives hub counts from that SAME
 *  computation instead of re-entering listCommunityIndex a second time (T2
 *  round 5/6 probe-budget fix: hubsWithCounts used to be exactly that second
 *  entry point, each connection re-probed). `hubsWithCounts` below is the
 *  thin convenience wrapper for a caller that has not already computed
 *  either input. */
export function hubCountsFrom(items: readonly CommunityItem[], hubs: readonly CommunityHub[]): CommunityHubCount[] {
  return hubs.map((hub) => ({ ...hub, itemCount: items.filter((i) => i.hub?.id === hub.id).length }));
}

export function hubsWithCounts(forgeRoot: string): CommunityHubCount[] {
  return hubCountsFrom(listCommunityIndex(forgeRoot), listCommunityHubs(forgeRoot));
}

// ---------------------------------------------------------------------------
// lintCommunityIndex — README rule: a vendored skill id must never collide
// with a studio/community/registry.yaml `kind: skill` id (that would claim
// third-party bytes as forge's own). Wired into the real `forge studio lint`
// entry point in apps/forge/studio-lint.ts.
// ---------------------------------------------------------------------------

/** Tolerant registry read — an absent or malformed studio/community/registry.yaml
 *  is already surfaced as its own `community-registry`/`load` finding by
 *  runStudioLint's own community-registry section; re-throwing the SAME error
 *  here would crash the whole lint run instead of reporting it once (mirrors
 *  skill-library.ts's loadCommunitySkillsSafely). */
function communitySkillIdsSafely(forgeRoot: string): Set<string> {
  try {
    return new Set(communitySkillsFromRegistry(forgeRoot).map((cs) => cs.id));
  } catch {
    return new Set();
  }
}

export function lintCommunityIndex(forgeRoot: string): Finding[] {
  const catalogIds = communitySkillIdsSafely(forgeRoot);
  const findings: Finding[] = [];
  for (const id of listVendoredIds(forgeRoot, 'skill')) {
    if (catalogIds.has(id)) {
      findings.push({
        level: 'error',
        object: `community-skill:${id}`,
        check: 'community/vendored-catalog-collision',
        message: `Vendored community skill package "${id}" collides with a studio/community/registry.yaml community-skills entry of the same id — a vendored id may never collide with a community-skills id (that would be claiming third-party bytes as forge's own)`,
      });
    }
  }
  return findings;
}
