/**
 * Community registry (W6-CR-1) — library's own Community kind, split out of
 * `orchestrator/studio/registry.ts` (M4 library-by-kind carve, PR 3 / Part 2).
 *
 * MOVED VERBATIM — the whole Community block (registry.ts:793-1090 on the
 * pre-carve head): the schema const, retired-field lists, every parse/
 * serialize helper, `communityRegistryPath`, `loadCommunityRegistry`,
 * `serializeCommunityRegistry`, `resolveCommunitySource`, `toCommunitySkill`,
 * `communitySkillsFromRegistry`.
 *
 * studio/community/registry.yaml, the declared-list source of truth for
 * community items, superseding catalog.yaml's former `community-skills:`
 * section.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { reqString, optString, reqNumber, reqObject, oneOf, loadYamlWithRaw } from '@forge/kernel/studio/yaml-fields.ts';
import type {
  CommunitySkill,
  CommunityRegistry,
  CommunityRegistryItem,
  CommunityRegistrySource,
  CommunityRegistrySignals,
} from '@forge/contracts/studio/types.ts';
import { communitySourceKey } from './community-source-url.ts';
import { extractLeadingCommentBlock, findCommentLinesInBlock } from './yaml-comments.ts';

/** Mirrors community-index.ts's COMMUNITY_KINDS / types.ts's
 *  COMMUNITY_REGISTRY_KINDS exactly — kept as an independent literal here too
 *  (registry.ts sits BELOW community-index.ts in the import graph) so `oneOf`
 *  can validate the field without introducing a new cross-module edge for one
 *  four-string list. */
const COMMUNITY_REGISTRY_KIND_VALUES = ['skill', 'hook', 'mcp', 'tool'] as const;

/** Schema v2 (W8-B5 exit row E5) — the ONE version this loader accepts. There
 *  is no v1 compatibility arm: forge has no legacy users and CLAUDE.md forbids
 *  a "for backwards compatibility" path, so a v1 file fails loud with the
 *  remedy named. */
export const COMMUNITY_REGISTRY_SCHEMA_VERSION = 2 as const;

/** Repo-scoped fields v1 kept on the ITEM. Refused by name at load so a stale
 *  mis-scoped copy cannot survive in the file unnoticed — the structural half
 *  of E5's cure (the type having no such property is only the compile-time
 *  half; hand-edited YAML never passes through the type). */
const RETIRED_ITEM_FIELDS = ['upstreamUpdatedAt', 'fetchedAt', 'fetchedBy'] as const;
const RETIRED_SIGNAL_FIELDS = ['stars', 'starsDisplay'] as const;

function parseCommunityRegistrySignals(raw: unknown, file: string, itemId: string): CommunityRegistrySignals {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: items "${itemId}".signals must be a mapping`);
  }
  const s = raw as Record<string, unknown>;
  for (const retired of RETIRED_SIGNAL_FIELDS) {
    if (s[retired] !== undefined) {
      throw new Error(
        `${file}: items "${itemId}".signals.${retired} is a REPO-level fact and was removed from the item in schema v${COMMUNITY_REGISTRY_SCHEMA_VERSION} — it belongs in the top-level "sources" map, keyed by this item's sourceUrl. Delete it from the item.`,
      );
    }
  }
  const attributedTo = s['attributedTo'];
  if (attributedTo !== undefined && attributedTo !== null && typeof attributedTo !== 'string') {
    throw new Error(`${file}: items "${itemId}".signals.attributedTo must be a string or null`);
  }
  return { attributedTo: (attributedTo as string | null | undefined) ?? null };
}

function parseCommunityRegistrySource(raw: unknown, key: string, file: string): CommunityRegistrySource {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: sources "${key}" must be a mapping`);
  }
  const s = raw as Record<string, unknown>;
  const stars = s['stars'] ?? null;
  if (stars !== null && typeof stars !== 'number') {
    throw new Error(`${file}: sources "${key}".stars must be a number or null`);
  }
  const starsDisplay = s['starsDisplay'] ?? null;
  if (starsDisplay !== null && typeof starsDisplay !== 'string') {
    throw new Error(`${file}: sources "${key}".starsDisplay must be a string or null`);
  }
  const archived = s['archived'];
  if (archived !== undefined && typeof archived !== 'boolean') {
    throw new Error(`${file}: sources "${key}".archived must be a boolean when present`);
  }
  const version = s['version'];
  if (version !== undefined && typeof version !== 'string') {
    throw new Error(`${file}: sources "${key}".version must be a string when present`);
  }
  const topicsRaw = s['topics'];
  let topics: string[] | undefined;
  if (topicsRaw !== undefined) {
    if (!Array.isArray(topicsRaw) || topicsRaw.some((t) => typeof t !== 'string')) {
      throw new Error(`${file}: sources "${key}".topics must be an array of strings when present`);
    }
    topics = topicsRaw as string[];
  }
  return {
    stars: stars as number | null,
    starsDisplay: starsDisplay as string | null,
    upstreamUpdatedAt: parseNullableString(s['upstreamUpdatedAt'] ?? null, file, `sources "${key}".upstreamUpdatedAt`),
    fetchedAt: parseNullableString(s['fetchedAt'] ?? null, file, `sources "${key}".fetchedAt`),
    fetchedBy: reqString(s, 'fetchedBy', file),
    ...(archived !== undefined ? { archived } : {}),
    ...(topics !== undefined ? { topics } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

function parseCommunityRegistrySources(raw: unknown, file: string): Record<string, CommunityRegistrySource> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: "sources" must be a mapping of source key -> repo facts`);
  }
  const out: Record<string, CommunityRegistrySource> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = parseCommunityRegistrySource(value, key, file);
  }
  return out;
}

function parseNullableString(raw: unknown, file: string, field: string): string | null {
  if (raw !== null && typeof raw !== 'string') {
    throw new Error(`${file}: field "${field}" must be a string or null`);
  }
  return raw;
}

function parseCommunityRegistryItem(raw: unknown, i: number, file: string): CommunityRegistryItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: items[${i}] must be a mapping`);
  }
  const e = raw as Record<string, unknown>;
  const id = reqString(e, 'id', file);
  const kind = oneOf(reqString(e, 'kind', file), COMMUNITY_REGISTRY_KIND_VALUES, file, 'kind');
  for (const retired of RETIRED_ITEM_FIELDS) {
    if (e[retired] !== undefined) {
      throw new Error(
        `${file}: items[${i}] ("${id}").${retired} is a REPO-level fact and was removed from the item in schema v${COMMUNITY_REGISTRY_SCHEMA_VERSION} — it belongs in the top-level "sources" map, keyed by this item's sourceUrl. Delete it from the item.`,
      );
    }
  }
  return {
    id,
    kind,
    name: reqString(e, 'name', file),
    desc: optString(e, 'desc'),
    category: reqString(e, 'category', file),
    sourceUrl: reqString(e, 'sourceUrl', file),
    provenance: reqString(e, 'provenance', file),
    tier: optString(e, 'tier'),
    signals: parseCommunityRegistrySignals(e['signals'], file, id),
  };
}

export function communityRegistryPath(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'community', 'registry.yaml');
}

/** Throws on ANY structural violation (missing/malformed meta, non-array
 *  items, a malformed item) — callers that want to TOLERATE a missing file
 *  check existsSync first (mirrors loadCatalog's own bare-throw contract;
 *  `communitySkillsFromRegistry` below is the tolerant-to-missing wrapper
 *  most callers actually want). */
export function loadCommunityRegistry(registryYamlPath: string): CommunityRegistry {
  const { data: d, raw } = loadYamlWithRaw(registryYamlPath);
  const meta = reqObject(d, 'meta', registryYamlPath);
  const schemaVersion = reqNumber(meta, 'schemaVersion', registryYamlPath);
  if (schemaVersion !== COMMUNITY_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `${registryYamlPath}: meta.schemaVersion is ${schemaVersion} but this forge reads only v${COMMUNITY_REGISTRY_SCHEMA_VERSION}. v${COMMUNITY_REGISTRY_SCHEMA_VERSION} moves the repo-level facts (stars, upstreamUpdatedAt, fetchedAt, fetchedBy) off each item into a top-level "sources" map keyed by source URL. There is no compatibility path: re-shape the file, then run "forge community refresh" to populate the source rows.`,
    );
  }
  const lastRefresh = parseNullableString(meta['lastRefresh'], registryYamlPath, 'meta.lastRefresh');
  const rawItems = d['items'];
  if (!Array.isArray(rawItems)) {
    throw new Error(`${registryYamlPath}: "items" must be an array`);
  }
  return {
    schemaVersion,
    lastRefresh,
    sources: parseCommunityRegistrySources(d['sources'], registryYamlPath),
    items: rawItems.map((item, i) => parseCommunityRegistryItem(item, i, registryYamlPath)),
    leadingComments: extractLeadingCommentBlock(raw),
    itemsCommentLines: findCommentLinesInBlock(raw, 'items'),
    path: registryYamlPath,
  };
}

/** Renders one `CommunityRegistryItem` back to the plain-object shape
 *  `js-yaml` dumps — optional fields (`desc`/`tier`) are OMITTED (never
 *  written as `null`/`undefined`) when absent, mirroring
 *  `serializeFlowDefinition`'s own "spread in only when defined" discipline
 *  rather than trusting `yaml.dump` to drop `undefined` values on its own. */
function serializeCommunityRegistryItem(item: CommunityRegistryItem): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id, kind: item.kind, name: item.name };
  if (item.desc !== undefined) out.desc = item.desc;
  out.category = item.category;
  out.sourceUrl = item.sourceUrl;
  out.provenance = item.provenance;
  if (item.tier !== undefined) out.tier = item.tier;
  // Schema v2: curation only. stars / starsDisplay / upstreamUpdatedAt /
  // fetchedAt / fetchedBy are repo facts and live under `sources` — the item
  // is deliberately given no key to hold a mis-scoped copy in (exit row E5).
  out.signals = { attributedTo: item.signals.attributedTo };
  return out;
}

function serializeCommunityRegistrySource(src: CommunityRegistrySource): Record<string, unknown> {
  return {
    stars: src.stars,
    starsDisplay: src.starsDisplay,
    upstreamUpdatedAt: src.upstreamUpdatedAt,
    ...(src.archived !== undefined ? { archived: src.archived } : {}),
    ...(src.topics !== undefined ? { topics: src.topics } : {}),
    ...(src.version !== undefined ? { version: src.version } : {}),
    fetchedAt: src.fetchedAt,
    fetchedBy: src.fetchedBy,
  };
}

/**
 * W7-B3 — the ONE serializer for the whole registry document, shared by
 * `commitRegistryDraft` (orchestrator/interactive-finalizers.ts) and the
 * Studio CRUD routes (apps/forge/bridge-studio-writes.ts). Pure: takes the parsed
 * shape, returns the YAML text; the CALLER owns the temp-then-rename write.
 * Symmetric with `loadCommunityRegistry` above so a round-trip
 * (serialize → load) is the natural structural validation.
 */
export function serializeCommunityRegistry(doc: {
  schemaVersion: number;
  lastRefresh: string | null;
  sources: Readonly<Record<string, CommunityRegistrySource>>;
  items: readonly CommunityRegistryItem[];
  leadingComments: string;
}): string {
  // Source keys sorted so a write is deterministic regardless of insertion
  // order (two refreshes of the same tree must produce byte-identical output).
  const sources: Record<string, unknown> = {};
  for (const key of Object.keys(doc.sources).sort()) {
    sources[key] = serializeCommunityRegistrySource(doc.sources[key]);
  }
  const body = yaml.dump(
    {
      meta: { schemaVersion: doc.schemaVersion, lastRefresh: doc.lastRefresh },
      sources,
      items: doc.items.map(serializeCommunityRegistryItem),
    },
    { lineWidth: 100, quotingType: '"', forceQuotes: false },
  );
  return `${doc.leadingComments}${body}`;
}

/**
 * The repo-level facts for `item`, or `null` when its `sourceUrl` names no
 * recognised upstream (a blog post, a docs page) or names one the registry has
 * no `sources` row for yet.
 *
 * This is the whole of E5's cure at read time: two items sharing a `sourceUrl`
 * resolve to the SAME object, so they cannot report different star counts. A
 * `null` here is the honest "never verified" state — never a fabricated zero.
 */
export function resolveCommunitySource(
  registry: Pick<CommunityRegistry, 'sources'>,
  item: Pick<CommunityRegistryItem, 'sourceUrl'>,
): CommunityRegistrySource | null {
  const key = communitySourceKey(item.sourceUrl);
  if (key === null) return null;
  return registry.sources[key] ?? null;
}

/** Projects a registry item down onto the LEGACY `CommunitySkill` shape every
 *  existing consumer already depends on (skill-library.ts, validate.ts,
 *  community-index.ts, community-install.ts, the bridge routes) — `stars`
 *  here is always the curated DISPLAY string, never the parsed numeric
 *  `signals.stars` (types.ts's CommunitySkill doc).
 *
 *  W6-CR-2: `item.fetchedAt`/`item.fetchedBy`/`item.upstreamUpdatedAt`/
 *  `item.signals.stars` (the numeric figure) now thread straight through —
 *  every registry-sourced item genuinely HAS these facts (required fields on
 *  `CommunityRegistryItem`), so there is nothing to fabricate here; a
 *  vendored-only skill/hook or a connection (no registry row at all) is
 *  built directly as a `CommunityItem` in community-index.ts, never through
 *  this function, and gets its own honest fetchedAt:null/fetchedBy:'local'
 *  treatment there. */
function toCommunitySkill(item: CommunityRegistryItem, source: CommunityRegistrySource | null): CommunitySkill {
  return {
    id: item.id,
    name: item.name,
    provenance: item.provenance,
    source: item.sourceUrl,
    category: item.category,
    tier: item.tier,
    stars: source?.starsDisplay ?? undefined,
    starsNumeric: source?.stars ?? null,
    desc: item.desc,
    upstreamUpdatedAt: source?.upstreamUpdatedAt ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    // No resolvable source row ⇒ the row is hand-curated and has never been
    // fetched from anywhere. "seed" is the literal truth for such a row (it is
    // what the shipped file says), never a fabricated verification provenance.
    fetchedBy: source?.fetchedBy ?? 'seed',
  };
}

/** Every `kind: skill` row of studio/community/registry.yaml, in the LEGACY
 *  `CommunitySkill` shape. Tolerant of a MISSING file (returns `[]` — the
 *  fresh/half-onboarded shape every other studio/community/*.yaml reader
 *  already tolerates, see community-index.ts's listCommunityHubs); a file
 *  that EXISTS but fails to parse (missing required field, bad kind vocab,
 *  malformed signals, ...) throws loud, naming the file + the real error —
 *  a corrupt registry must never render identically to an honest empty one. */
export function communitySkillsFromRegistry(forgeRoot: string): CommunitySkill[] {
  const registryPath = communityRegistryPath(forgeRoot);
  if (!existsSync(registryPath)) return [];
  const registry = loadCommunityRegistry(registryPath);
  return registry.items
    .filter((item) => item.kind === 'skill')
    .map((item) => toCommunitySkill(item, resolveCommunitySource(registry, item)));
}
