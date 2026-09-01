/**
 * Wire projection for the community index — `CommunityItem` → the shape the
 * `/community` surfaces render.
 *
 * Split out of `bridge-studio-community.ts` in M4-library PR 4b, which was 833
 * lines against the repo's 800-line hard cap. This is the file's own
 * "Wire projection" section, lifted whole: a self-contained subgraph with zero
 * outgoing calls into the route layer, and the two module constants below are
 * read only from inside it. Nothing here writes, spawns or routes — the one
 * `existsSync` it carries is a read used to decide a wire field.
 *
 * `communityIndexMeta` deliberately did NOT come with it: it shells out to git
 * for the registry's dirty state and belongs with the route that renders it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type CommunityItem, type CommunityKind } from './studio/community-index.ts';
import { listConnections, type ConnectionDefinition } from './studio/connection-library.ts';
import { type ProbeState } from './studio/connection-probe.ts';
import type { CommunitySkill } from '@forge/contracts/studio/types.ts';

/** Every real committed vendored package (studio/community/{skills,hooks}/)
 *  is forge-authored and attributed to this repo's own seed hub — the same
 *  real, literal URL community-index.ts/community-install.ts already name
 *  for hub resolution (duplicated there twice already; a third read-only
 *  copy here follows that established convention rather than exporting a
 *  cross-module constant for one string). */
const VENDORED_UPSTREAM_SOURCE = 'https://github.com/parsoFish/forge-studio';

/** D5's "no signals published" idiom, applied to description: a source
 *  record with no description renders an honest statement of absence, never
 *  a fabricated string and never a silently-dropped wire field. */
const NO_DESCRIPTION = 'No description published.';
export type CommunityItemWire = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  /** W8-B5 (community-05 / exit row E11) — the registry row's OWN `category`,
   *  so `/community`'s search can match the word the registry actually files
   *  rows under ("planning", "memory", "review"). It reached the client
   *  nowhere before this, which is why adding the search term alone would
   *  have been a no-op.
   *
   *  `null` is LOAD-BEARING and never an invented string: a vendored package
   *  or a catalog connection has no registry row at all, so it genuinely has
   *  no category. Same discipline as `hub`/`signals` — an honest absence,
   *  never a fabricated value, and deliberately not `''` (an empty string
   *  would make every empty-ish query "match" it). */
  category: string | null;
  upstream: string;
  hub: CommunityItem['hub'];
  signals: CommunityItem['signals'];
  vendored: boolean;
  installState: CommunityItem['installState'];
  probeState: ProbeState | null;
  origin: string;
  /** W6-CR-2 — carried straight through from the item's own real fact (D14 in
   *  community-index.ts): null/'local' for a vendored package or connection
   *  with no registry row, never fabricated. */
  fetchedAt: CommunityItem['fetchedAt'];
  fetchedBy: CommunityItem['fetchedBy'];
  upstreamUpdatedAt: CommunityItem['upstreamUpdatedAt'];
  error?: string;
};

export type WireCtx = {
  communitySkills: readonly CommunitySkill[];
  connections: readonly ConnectionDefinition[];
  /**
   * The caller's error redactor (`sanitizeError`, the bridge transport's).
   * INJECTED rather than imported: this module is below the route layer, and
   * importing `cli/bridge-studio.ts` from a package is a `package-to-legacy`
   * boundary violation. Splitting a file that carries baselined legacy imports
   * would otherwise MULTIPLY those rows — one per new module — and this lane's
   * boundary baseline is a ratchet that may only shrink.
   */
  sanitize: (err: unknown) => string;
};

/** T2 round 6, AT GROUP 5: mirrors listCommunityIndex's own deliberate
 *  missing-vs-malformed split (orchestrator/studio/community-index.ts, MAJOR
 *  2) at the ROUTE level, now over TWO independent files (W6-CR-1 decoupled
 *  community-skill sourcing from catalog.yaml):
 *   - connections: `listConnections` calls `loadCatalog` unguarded — correct
 *     for ITS callers, which never expect a catalog-less root — so this
 *     function must not call it at all when studio/catalog.yaml is genuinely
 *     absent (the fresh/half-onboarded shape: degrade to no connections,
 *     never a 500).
 *   - communitySkills: `communitySkillsFromRegistry` is tolerant of a MISSING
 *     studio/community/registry.yaml (degrades to `[]`) but throws loud on a
 *     MALFORMED one (via its own unguarded `loadCommunityRegistry` call) — a
 *     corrupt registry must never render identically to an honest empty one. */
export function buildWireCtx(
  forgeRoot: string,
  communitySkills: readonly CommunitySkill[],
  sanitize: (err: unknown) => string,
): WireCtx {
  const catalogPath = join(forgeRoot, 'studio', 'catalog.yaml');
  const catalogExists = existsSync(catalogPath);
  const connections = catalogExists ? listConnections(forgeRoot) : [];
  return { communitySkills, connections, sanitize };
}


export function originFor(item: CommunityItem): string {
  if (item.kind === 'skill') {
    return item.vendored ? `studio/community/skills/${item.id}/SKILL.md` : 'studio/community/registry.yaml';
  }
  if (item.kind === 'hook') return `studio/community/hooks/${item.id}/hook.yaml`;
  return `listConnections (studio/catalog.yaml ${item.kind}s:)`;
}

/**
 * W8-B5 (exit row E11) — the item's category, read from the ONE place it is
 * declared: the registry row this item was sourced from (`CommunitySkill`,
 * itself projected from `CommunityRegistryItem`). Never derived, never
 * guessed, never defaulted to a plausible-looking string.
 *
 * A vendored-only skill package, a vendored hook and a catalog connection all
 * have NO registry row (D1's other two sources), so they honestly carry
 * `null` — the same treatment `fetchedAt`/`upstreamUpdatedAt` already get for
 * exactly the same reason (D14).
 */
export function categoryFor(item: CommunityItem, ctx: WireCtx): string | null {
  if (item.kind !== 'skill') return null;
  const cs = ctx.communitySkills.find((c) => c.id === item.id);
  return cs ? cs.category : null;
}

/** The item's own real source link — never hub.url substituted in (see this
 *  file's header: a hub can be a coarser prefix of an item's own upstream). */
export function upstreamFor(item: CommunityItem, ctx: WireCtx): string {
  if (item.vendored) return VENDORED_UPSTREAM_SOURCE;
  if (item.kind === 'hook') {
    // Unreachable under D1 (every hook item is sourced from a vendored
    // package) — thrown, not guessed, if that invariant is ever violated.
    throw new Error(`community item "${item.id}" (hook) is not vendored — every hook item must be vendored (D1)`);
  }
  if (item.kind === 'skill') {
    const cs = ctx.communitySkills.find((c) => c.id === item.id);
    if (!cs) {
      throw new Error(`community item "${item.id}" (skill) is not vendored and has no studio/community/registry.yaml community-skills entry`);
    }
    return cs.source;
  }
  const conn = ctx.connections.find((c) => c.kind === item.kind && c.id === item.id);
  if (!conn) throw new Error(`community item "${item.id}" (${item.kind}) has no matching listConnections entry`);
  return conn.provenance;
}

/** The REAL live probe state for a tool/mcp item; null for skill/hook (no
 *  probe concept exists for either). Read directly off the item's own
 *  `probeState` — `listCommunityIndex`/`communityItem`/`buildConnectionItem`
 *  populate it from the ONE real probe execution they already ran (T2 round
 *  5/6 probe-budget fix); this function never spawns a second one to get it.
 *  The throw below is defensive only — an invariant violation, not a
 *  reachable production path. */
export function probeStateFor(item: CommunityItem): ProbeState | null {
  if (item.kind !== 'tool' && item.kind !== 'mcp') return null;
  if (item.probeState === undefined) {
    throw new Error(`community item "${item.id}" (${item.kind}) carries no probeState — expected it to be populated for every connection-kind item`);
  }
  return item.probeState;
}

/** One item's wire projection. THROWS on a genuine derivation failure — the
 *  caller (`toWireItemSafe`) is the one place that degrades, so this
 *  function itself stays honest about failing loud. */
export function toWireItem(item: CommunityItem, ctx: WireCtx): CommunityItemWire {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    desc: item.description ?? NO_DESCRIPTION,
    category: categoryFor(item, ctx),
    upstream: upstreamFor(item, ctx),
    hub: item.hub,
    signals: item.signals,
    vendored: item.vendored,
    installState: item.installState,
    probeState: probeStateFor(item),
    origin: originFor(item),
    fetchedAt: item.fetchedAt,
    fetchedBy: item.fetchedBy,
    upstreamUpdatedAt: item.upstreamUpdatedAt,
    ...(item.error !== undefined ? { error: item.error } : {}),
  };
}

/** Anti-pattern #3: one item's wire-projection failure degrades to an honest
 *  `error` field on THAT item — never a 500 for the other N-1 rows in the
 *  list route. */
export function toWireItemSafe(item: CommunityItem, ctx: WireCtx): CommunityItemWire {
  try {
    return toWireItem(item, ctx);
  } catch (err) {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      desc: item.description ?? NO_DESCRIPTION,
      // The degraded row still carries the honest absence rather than
      // omitting the key: an ABSENT key is a malformed response to the
      // client's parser, which would turn one item's derivation failure into
      // a whole-list parse throw — the opposite of this arm's purpose.
      category: null,
      upstream: VENDORED_UPSTREAM_SOURCE,
      hub: item.hub,
      signals: item.signals,
      vendored: item.vendored,
      installState: item.installState,
      probeState: null,
      origin: originFor(item),
      fetchedAt: item.fetchedAt,
      fetchedBy: item.fetchedBy,
      upstreamUpdatedAt: item.upstreamUpdatedAt,
      error: `cannot fully derive community wire item — ${ctx.sanitize(err)}`,
    };
  }
}
