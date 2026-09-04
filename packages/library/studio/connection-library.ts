/**
 * Connections library — model + registry (R3-04, `_wave5/specs/R3-04.md`).
 *
 * A "connection" is a curated tool or MCP server an agent can be given — read
 * from `studio/catalog.yaml`'s `tools:`/`mcps:` sections (D1: there is NO
 * writable definition store, no per-connection file package, no create/
 * update/delete route anywhere — curation is a PR to catalog.yaml). This
 * module reads the catalog via the already-shipped `loadCatalog` (registry.ts,
 * which now parses the extended install/config/probe/provenance/capabilities
 * metadata onto `CatalogConnectionEntry`) and composes it with facts that must
 * be DERIVED, never declared:
 *
 *   kind         — D2: structural, from WHICH catalog section (`tools:` vs
 *                  `mcps:`) an entry came from. Never content-sniffed, never a
 *                  third kind.
 *   installable  — D13: `install.method === 'npm'` ONLY. `system-provided`
 *                  and `external` are BOTH non-installable — forge has no
 *                  driven install path for either ("Forge does not install
 *                  these" — D13's `external` ruling).
 *   usedBy /     — D-E (mirrors hook-library.ts's `carriedBy`/
 *   usedByDerivation  `carriedByDerivation`, template-library.ts's D3):
 *                  scanned from every real agent's `composition.tools` +
 *                  `composition.mcps` (a connection IS a tools/mcps entry —
 *                  D2's "no third kind" ruling means there is no separate
 *                  "connections" composition field to scan). `usedByDerivation`
 *                  names the scan (`CONNECTION_USAGE_SOURCE`) and how many
 *                  agents were scanned, so an empty `usedBy` always reads as
 *                  "scanned N, found none", never "unknown, rendered empty".
 *
 * Load-vs-lint split (D1, house convention): `loadCatalog` tolerates a
 * `tools:`/`mcps:` entry that carries NO connection metadata at all (it also
 * serves plain display-row consumers elsewhere in this codebase) — but THIS
 * module requires install/probe/provenance/config to compose a
 * `ConnectionDefinition` at all, and throws (naming the missing field) if one
 * is absent. `forge studio lint` (`validateConnections`, validate.ts) is the
 * place a missing/malformed piece is meant to be *discovered* operator-side,
 * with a specific, actionable finding — this module's throw is the same
 * "structural invalidity throws at load" contract applied one layer up, for a
 * caller (a future `/connections` UI, WI-5) that needs a fully-composed
 * connection or nothing.
 *
 * Secret-safety (D5): `ConnectionConfigVar` carries `{env, required,
 * purpose}` — a config var NAME only, structurally no value field anywhere.
 * This module never reads `process.env` for anything.
 */

import { join } from 'node:path';

import { assertSkillSlug } from '@forge/kernel/ids.ts';
import type { AgentFacts } from './agent-facts.ts';
import { loadCatalog } from './catalog-registry.ts';
import type {
  CatalogCapability,
  CatalogConfigVar,
  CatalogConnectionEntry,
  CatalogInstallMethod,
  CatalogProbeSpec,
} from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// D2 — CONNECTION_KINDS is closed at exactly two values, structural (which
// catalog section an entry came from), never content-sniffed and never a
// third kind (the mockup shows three "kinds" — MCPs/CLIs/tools — but forge
// has two catalog sections; see the spec's D2 for the stated limit).
// ---------------------------------------------------------------------------

export const CONNECTION_KINDS = ['tool', 'mcp'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

// The install/probe/config/capability SHAPES are identical to the raw
// catalog-entry shapes (registry.ts already enforces their structural
// validity at load) — aliased here under the connection-library's own public
// names rather than redefined, so the two can never drift.
export type ConnectionInstallMethod = CatalogInstallMethod;
export type ConnectionProbeSpec = CatalogProbeSpec;
export type ConnectionConfigVar = CatalogConfigVar;
export type ConnectionCapability = CatalogCapability;

/** Names the real on-disk source a `usedBy` array was scanned from, and how
 *  many of that source were scanned — the anti-fabrication device: an empty
 *  `usedBy` always reads as "scanned N, found none", never "unknown".
 *  Mirrors hook-library.ts's `HookUsedByDerivation`. */
export interface ConnectionUsedByDerivation {
  readonly source: string;
  readonly scanned: number;
}

export interface ConnectionDefinition {
  id: string;
  name: string;
  desc?: string;
  /** D2 — derived from the catalog section, never declared. */
  kind: ConnectionKind;
  install: ConnectionInstallMethod;
  probe: ConnectionProbeSpec;
  provenance: string;
  /** NAMES only (D5) — may be `[]`, never a value field. */
  config: ConnectionConfigVar[];
  /** D13 — true iff `install.method === 'npm'`; `system-provided` and
   *  `external` are both false (forge cannot drive either's install). */
  installable: boolean;
  usedBy: string[];
  usedByDerivation: ConnectionUsedByDerivation;
  /** `kind:'mcp'` entries that declare capabilities ONLY — a `kind:'tool'`
   *  entry never carries this key at all (D8: undefined, not a fabricated
   *  empty array). */
  capabilities?: ConnectionCapability[];
  /** Present iff `capabilities` is present — the R3-06 D3 "derivation names
   *  itself" device: a capability list is CURATED data (D8), never presented
   *  as a verified live capability list of the running server. */
  capabilitiesSource?: 'curated';
}

/**
 * A catalog connection WITHOUT the agent-derived usage fields.
 *
 * Every caller that only needs to know a connection EXISTS — the community
 * index, the install router, the probe and install routes, agents' run gate —
 * takes this. It is not a convenience: `usedBy` is derived by reading the
 * whole agent roster, so serving those callers a `ConnectionDefinition` meant
 * one full roster walk per existence check, and the only alternative that
 * avoided it would have been a fabricated empty `usedBy` — precisely what
 * `usedByDerivation` exists to make impossible. Measured before the split:
 * of the eleven call sites of `listConnections`/`connectionById`, exactly TWO
 * read `usedBy` (the connections list and detail routes, through
 * `toWireConnection`); the other nine read `kind`/`id`/`name`/`provenance` and
 * the probe/install fields.
 */
export type CatalogConnection = Omit<ConnectionDefinition, 'usedBy' | 'usedByDerivation'>;

export const CONNECTION_USAGE_SOURCE = 'skills/*/SKILL.md (composition.tools + composition.mcps)';

// ---------------------------------------------------------------------------
// usedBy / usedByDerivation — DERIVED from real agent specs, never declared.
// Read through the injected `AgentFacts` port (rulings 13/73/127): this
// module is rank 2 and may not read agent files. `usage('connection', ...)`
// scans composition.tools + composition.mcps (a connection IS a tools/mcps
// entry — D2), which is what the private roster walk here used to do.
// ---------------------------------------------------------------------------

function computeConnectionUsage(
  forgeRoot: string,
  facts: AgentFacts,
): {
  byConnection: Map<string, string[]>;
  derivation: ConnectionUsedByDerivation;
} {
  // The index already dedupes per agent and sorts each carrier list — this is
  // the same derivation the private roster walk did here, moved behind the
  // port. The copy is because `ConnectionDefinition.usedBy` is a mutable
  // `string[]` and the port hands back `readonly`.
  const { byId, scanned } = facts.usage('connection', forgeRoot);
  const byConnection = new Map<string, string[]>();
  for (const [id, slugs] of byId) byConnection.set(id, [...slugs]);
  return { byConnection, derivation: { source: CONNECTION_USAGE_SOURCE, scanned } };
}

export function deriveConnectionUsage(forgeRoot: string, facts: AgentFacts): Map<string, string[]> {
  return computeConnectionUsage(forgeRoot, facts).byConnection;
}

// ---------------------------------------------------------------------------
// listConnections / connectionById — compose loadCatalog's already-parsed
// tools:/mcps: entries with the derived facts above. Does NOT re-parse the
// YAML itself (registry.ts owns that).
// ---------------------------------------------------------------------------

function requireConnectionField<T>(value: T | undefined, entryId: string, field: string): T {
  if (value === undefined) {
    throw new Error(
      `connection "${entryId}" is missing its "${field}" — every studio/catalog.yaml tools:/mcps: entry must declare install/probe/provenance/config to compose as a connection ("forge studio lint" reports the specific missing piece as a connection/* finding)`,
    );
  }
  return value;
}

function composeCatalogConnection(
  entry: CatalogConnectionEntry,
  kind: ConnectionKind,
): CatalogConnection {
  const install = requireConnectionField(entry.install, entry.id, 'install');
  const probe = requireConnectionField(entry.probe, entry.id, 'probe');
  const provenance = requireConnectionField(entry.provenance, entry.id, 'provenance');
  const config = requireConnectionField(entry.config, entry.id, 'config');

  const def: CatalogConnection = {
    id: entry.id,
    name: entry.name,
    ...(entry.desc !== undefined ? { desc: entry.desc } : {}),
    kind,
    install,
    probe,
    provenance,
    config,
    installable: install.method === 'npm',
  };

  // D8 — capabilities are MCP-only, and present only when the catalog entry
  // actually declares them: a tool entry (kind:'tool') never reaches here
  // with capabilities set (parseConnectionEntries never reads that key for
  // the tools: section), and an mcp entry that omits capabilities entirely
  // stays undefined too — never a fabricated empty array.
  if (kind === 'mcp' && Array.isArray(entry.capabilities)) {
    return { ...def, capabilities: entry.capabilities, capabilitiesSource: 'curated' };
  }
  return def;
}

/** Every catalog connection, read from `studio/catalog.yaml` alone — no agent
 *  roster walk, so no `AgentFacts` and no fabricated usage. */
export function listCatalogConnections(forgeRoot: string): CatalogConnection[] {
  const catalog = loadCatalog(join(forgeRoot, 'studio', 'catalog.yaml'));
  return [
    ...catalog.tools.map((e) => composeCatalogConnection(e, 'tool')),
    ...catalog.mcps.map((e) => composeCatalogConnection(e, 'mcp')),
  ];
}

/** The catalog read DECORATED with who composes each connection. */
export function listConnections(forgeRoot: string, facts: AgentFacts): ConnectionDefinition[] {
  const { byConnection, derivation } = computeConnectionUsage(forgeRoot, facts);
  return listCatalogConnections(forgeRoot).map((def) => ({
    ...def,
    usedBy: byConnection.get(def.id) ?? [],
    usedByDerivation: derivation,
  }));
}

export function catalogConnectionById(forgeRoot: string, id: string): CatalogConnection | undefined {
  assertSkillSlug(id, 'connection');
  return listCatalogConnections(forgeRoot).find((e) => e.id === id);
}

export function connectionById(forgeRoot: string, id: string, facts: AgentFacts): ConnectionDefinition | undefined {
  // Defense-in-depth (house convention, hook-library.ts precedent): no path
  // is constructed from `id` today (there is no per-connection file — D1),
  // but a future bridge route (WI-4, `GET /api/studio/connections/:id`) will
  // pass a client-supplied id through exactly this function. Guarding at the
  // one shared lookup point means a traversal-shaped id is rejected here
  // before any future caller ever learns to build a path from it.
  assertSkillSlug(id, 'connection');
  return listConnections(forgeRoot, facts).find((e) => e.id === id);
}
