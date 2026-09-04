/**
 * bridge-studio-catalog.ts — `GET /api/studio/catalog`, the Agent Builder
 * palette: the curated catalog reconciled with what is actually available.
 *
 * The LAST library route to leave the bridge: it reconciles catalog SDKs
 * against the live adapter registry, and `isSdkAvailable` is `@forge/agents`'
 * — rank 3, which this package may not import, so it arrives injected.
 * `design.md` §"The palette is scanned, not declared" carries the rest.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from '@forge/kernel';

import type { AgentFacts } from './studio/agent-facts.ts';
import { loadCatalog } from './studio/catalog-registry.ts';
import { communitySkillsFromRegistry } from './studio/community-registry.ts';
import { listPlainSkills } from './studio/skill-registry.ts';
import { listHookLibrary } from './studio/hook-library.ts';

export const CATALOG_URL = '/api/studio/catalog';

/** Whether a registered adapter reports an SDK usable. Supplied by `apps/forge`. */
export type SdkAvailabilityFn = (sdkId: string) => boolean;

export function createCatalogHandler(deps: {
  isSdkAvailable: SdkAvailabilityFn;
  agentFacts: AgentFacts;
}) {
  return async function handleCatalog(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: StudioContext,
    rawUrl: string,
    method: string,
  ): Promise<boolean> {
    if (method !== 'GET' || pathOnly(rawUrl) !== CATALOG_URL) return false;
    const origin = allowedOrigin(req);
    try {
      const catalogPath = join(resolve(ctx.forgeRoot), 'studio', 'catalog.yaml');
      if (!existsSync(catalogPath)) {
        sendJson(res, 404, { error: 'catalog.yaml not found' }, origin);
        return true;
      }
      const catalog = loadCatalog(catalogPath);
      // The registry is the source of truth, not the static yaml flag.
      const sdks = catalog.sdks.map((sdk) => ({ ...sdk, available: deps.isSdkAvailable(sdk.id) }));
      const community = communitySkillsFromRegistry(ctx.forgeRoot).map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
      const seen = new Set(community.map((s) => s.id));
      const skills = [...community, ...listPlainSkills(ctx.forgeRoot).filter((s) => !seen.has(s.id))];
      const hooks = listHookLibrary(ctx.forgeRoot, deps.agentFacts)
        .filter((h) => h.ok)
        .map((h) => ({ id: h.id, name: h.name, desc: h.description }));
      sendJson(res, 200, { catalog: { ...catalog, sdks, skills, hooks } }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  };
}
