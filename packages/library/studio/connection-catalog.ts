/**
 * Connection catalog parsing (R3-04) — extracted from registry.ts (WI-1b) to
 * keep registry.ts under its house 800-line hard cap. A LEAF module: it must
 * NOT import from registry.ts or connection-library.ts (connection-library.ts
 * already imports `loadAgentDefinition`/`isStudioAgent` from registry.ts for
 * its usedBy derivation, so a back-edge here would close an import cycle in a
 * module ~35 files depend on). Only `types.ts` and `yaml-fields.ts` — both
 * already leaves — are imported.
 *
 * Parses `catalog.yaml`'s `tools:`/`mcps:` sections into
 * `CatalogConnectionEntry`. Connection metadata (install/config/probe/
 * provenance/capabilities) is OPTIONAL at this layer — its ABSENCE is a
 * `forge studio lint` finding (`validateConnections`, validate.ts), never a
 * load throw, because `Catalog.tools`/`Catalog.mcps` also serves plain
 * display-row consumers that never carry it at all (registry.test.ts's
 * `{id:'Read', name:'Read'}` / `{id:'gmail', name:'Gmail MCP'}` fixtures must
 * keep parsing without a connection-metadata throw). What DOES throw: a value
 * that IS present but malformed (load-vs-lint split, mirrors every other
 * loader in registry.ts).
 */

import { reqString, optString, oneOf } from './yaml-fields.ts';
import type {
  CatalogCapability,
  CatalogConfigVar,
  CatalogConnectionEntry,
  CatalogInstallMethod,
  CatalogProbeSpec,
} from './types.ts';

/**
 * Parse a `tools:`/`mcps:` `install:` block (R3-04 D13) — a CLOSED
 * three-method discriminated union. An unrecognised `method`, or a variant
 * missing ITS OWN required sub-field (`npm` with no `package`, `external`
 * with no `upstream`), THROWS — genuine structural defects, not missing
 * optional metadata. `npm`'s `version` is required to be a STRING but is
 * deliberately NOT checked for exact-pin shape here: an empty/range/`latest`
 * value is a `forge studio lint` finding (`connection/unpinned`,
 * validate.ts), never a load throw — the AT drives this exact case through
 * the real `runStudioLint` entry point with `version: ""`.
 */
function parseCatalogInstall(raw: unknown, file: string, entryId: string): CatalogInstallMethod {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: connection "${entryId}" install must be a mapping`);
  }
  const e = raw as Record<string, unknown>;
  const method = oneOf(reqString(e, 'method', file), ['system-provided', 'npm', 'external'] as const, file, `${entryId}.install.method`);
  if (method === 'system-provided') return { method };
  if (method === 'npm') {
    const pkg = reqString(e, 'package', file);
    const version = e['version'];
    if (typeof version !== 'string') {
      throw new Error(`${file}: connection "${entryId}" install.version must be a string field (npm method requires it present — pin-EXACTNESS is a lint concern, not a load concern)`);
    }
    return { method, package: pkg, version };
  }
  // method === 'external'
  return { method, upstream: reqString(e, 'upstream', file) };
}

/**
 * Parse a `tools:`/`mcps:` `probe:` block (R3-04 D15) — a CLOSED three-kind
 * discriminated union, mirroring `parseCatalogInstall`'s throw discipline: an
 * unrecognised `kind`, or a variant missing its own required sub-field,
 * throws. Coherence between `probe.kind` and `install.method` (D15's table)
 * is a SEMANTIC cross-field rule, not a structural one — enforced by
 * `validateConnections` (validate.ts), not here.
 */
function parseCatalogProbe(raw: unknown, file: string, entryId: string): CatalogProbeSpec {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: connection "${entryId}" probe must be a mapping`);
  }
  const e = raw as Record<string, unknown>;
  const kind = oneOf(reqString(e, 'kind', file), ['command', 'command-presence', 'npm-package'] as const, file, `${entryId}.probe.kind`);
  if (kind === 'command') {
    const command = reqString(e, 'command', file);
    const args = e['args'];
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      throw new Error(`${file}: connection "${entryId}" probe.args must be an array of strings (a "command" probe always declares its argv explicitly)`);
    }
    return { kind, command, args: args as string[] };
  }
  if (kind === 'command-presence') {
    return { kind, command: reqString(e, 'command', file) };
  }
  // kind === 'npm-package' — never spawns anything, carries no command/args.
  return { kind };
}

/** `config:` (R3-04 D5) — env-var-NAME schema only, never a value. Absent
 *  entirely ⇒ undefined (a display-row consumer never carries it); present ⇒
 *  every item's `env`/`required`/`purpose` triple must be well-typed. An
 *  extra key beyond that triple is NOT rejected here (structurally tolerated)
 *  — `connection/unknown-config-key` is a lint finding, not a load throw. */
function parseCatalogConfigVars(raw: unknown, file: string, entryId: string): CatalogConfigVar[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: connection "${entryId}" config must be an array`);
  }
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: connection "${entryId}" config[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const env = reqString(e, 'env', file);
    const required = e['required'];
    if (typeof required !== 'boolean') {
      throw new Error(`${file}: connection "${entryId}" config[${i}].required must be a boolean`);
    }
    return { env, required, purpose: reqString(e, 'purpose', file) };
  });
}

/** `capabilities:` (`mcps:` section only, R3-04 D8) — curated `{name,
 *  summary}` pairs. Absent ⇒ undefined (never fabricated as `[]`); an mcp
 *  entry declaring zero capabilities loads fine and is caught by
 *  `connection/mcp-capabilities` at lint, not here. */
function parseCatalogCapabilities(raw: unknown, file: string, entryId: string): CatalogCapability[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: connection "${entryId}" capabilities must be an array`);
  }
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: connection "${entryId}" capabilities[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return { name: reqString(e, 'name', file), summary: reqString(e, 'summary', file) };
  });
}

/**
 * Parse `catalog.yaml`'s `tools:`/`mcps:` sections into `CatalogConnectionEntry`
 * (R3-04, D1/D13/D15). Connection metadata (install/config/probe/provenance/
 * capabilities) is OPTIONAL at THIS layer — its ABSENCE is a
 * `forge studio lint` finding (`validateConnections`), never a load throw,
 * because `Catalog.tools`/`Catalog.mcps` also serves plain display-row
 * consumers that never carry it at all (registry.test.ts's `{id:'Read',
 * name:'Read'}` / `{id:'gmail', name:'Gmail MCP'}` fixtures must keep
 * parsing without a connection-metadata throw). What DOES throw: a value
 * that IS present but malformed (load-vs-lint split, mirrors every other
 * loader in registry.ts).
 */
export function parseConnectionEntries(raw: unknown, file: string, key: string, opts: { readCapabilities: boolean }): CatalogConnectionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: ${key}[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    return {
      id,
      name: reqString(e, 'name', file),
      desc: optString(e, 'desc'),
      install: e['install'] !== undefined ? parseCatalogInstall(e['install'], file, id) : undefined,
      probe: e['probe'] !== undefined ? parseCatalogProbe(e['probe'], file, id) : undefined,
      provenance: optString(e, 'provenance'),
      config: parseCatalogConfigVars(e['config'], file, id),
      capabilities: opts.readCapabilities ? parseCatalogCapabilities(e['capabilities'], file, id) : undefined,
    };
  });
}
