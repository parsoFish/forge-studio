/**
 * Catalog — library's own Catalog kind, split out of
 * `orchestrator/studio/registry.ts` (M4 library-by-kind carve, PR 3 / Part 2).
 *
 * MOVED VERBATIM — `parseCatalogSdks` / `parseCatalogModels` /
 * `parseCatalogGuards` / `loadCatalog` (registry.ts:719-791 on the pre-carve
 * head). `BAND_GUARD_IDS` is imported from `@forge/contracts` rather than
 * `@forge/agents/agent-bands.ts` — `agent-bands.ts` only re-exports it FROM
 * contracts (agents rank 3, library rank 2: library may not import agents),
 * mirroring the precedent M4-library PR 2 set for `skill-path.ts`.
 */

import { BAND_GUARD_IDS } from '@forge/contracts';
import { reqString, optString, optNumber, loadYaml } from '@forge/kernel/studio/yaml-fields.ts';
import type { Catalog, CatalogGuardEntry, CatalogModel, CatalogSdk } from '@forge/contracts/studio/types.ts';
import { parseConnectionEntries } from './connection-catalog.ts';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function parseCatalogSdks(raw: unknown, file: string): CatalogSdk[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: sdks[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      available: typeof e['available'] === 'boolean' ? e['available'] : false,
    };
  });
}

function parseCatalogModels(raw: unknown, file: string): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: models[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      sdk: reqString(e, 'sdk', file),
      tier: reqString(e, 'tier', file),
      costIn: optNumber(e, 'costIn'),
      costOut: optNumber(e, 'costOut'),
    };
  });
}

/**
 * Parse `catalog.yaml`'s `guards:` section. `kind` is DERIVED from
 * `BAND_GUARD_IDS`, never read from the file — a declared `kind:` value in the
 * YAML (if present) is parsed and then discarded, never merged or trusted
 * (ADR-027 R3-03 amendment).
 */
function parseCatalogGuards(raw: unknown, file: string): CatalogGuardEntry[] {
  if (!Array.isArray(raw)) return [];
  const bandIds = new Set<string>(BAND_GUARD_IDS as readonly string[]);
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: guards[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    return {
      id,
      name: reqString(e, 'name', file),
      desc: optString(e, 'desc'),
      kind: bandIds.has(id) ? 'band' : 'toggle',
    };
  });
}

// catalog.yaml is hand-edited (git changes); no serializer by design (ADR-027 §5).
export function loadCatalog(catalogYamlPath: string): Catalog {
  const d = loadYaml(catalogYamlPath);
  return {
    sdks: parseCatalogSdks(d['sdks'], catalogYamlPath),
    models: parseCatalogModels(d['models'], catalogYamlPath),
    tools: parseConnectionEntries(d['tools'], catalogYamlPath, 'tools', { readCapabilities: false }),
    mcps: parseConnectionEntries(d['mcps'], catalogYamlPath, 'mcps', { readCapabilities: true }),
    guards: parseCatalogGuards(d['guards'], catalogYamlPath),
    path: catalogYamlPath,
  };
}
