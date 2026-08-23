/**
 * journey-community-registry — the harness's OWN reader for
 * studio/community/registry.yaml's schema v2 (W8-B5, exit row E5).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY THE DUPLICATION IS DELIBERATE.
 * ---------------------------------------------------------------------------
 * Schema v2 moved the REPO-level facts (`stars`, `starsDisplay`,
 * `upstreamUpdatedAt`, `fetchedAt`, `fetchedBy`) off every item and into ONE
 * top-level `sources:` map, keyed by a normalized key derived from the item's
 * own `sourceUrl` (nine items share five distinct source URLs, so v1 stamped
 * one repo's star count onto N rows and the copies drifted). Resolving an
 * item's facts now means resolving `sourceUrl -> sources[key]`.
 *
 * Production does that in `orchestrator/studio/community-source-url.ts`
 * (`communitySourceKey`). This module re-derives the SAME mapping from the raw
 * YAML, and that is the point rather than a duplication smell:
 *
 *   - The community/skills journeys exist to cross-check what a page CLAIMS
 *     against what the file on disk actually says. A helper that imported the
 *     production resolver would be re-reading the answer it is supposed to be
 *     checking — the same "assert reality, never the product's own claim"
 *     rule the journey modules' own headers state.
 *   - It is not importable anyway: the walkthrough runs as plain
 *     `node scripts/e2e-journey.mjs` (no `--experimental-strip-types`), so a
 *     `.ts` module cannot be loaded from a `.mjs` harness module at all.
 *
 * Drift between this copy and production therefore surfaces as a FAILING
 * BEAT — which is exactly the wanted behaviour. It is how the v1 -> v2 move
 * was caught: the journey's own fixture helper was still a v1 reader, and only
 * running the gate said so.
 *
 * It lives here, shared, rather than copied into each journey module, so the
 * NEXT schema move has one harness-side site to follow instead of one per
 * journey (community.mjs and skills.mjs both read these facts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

/** The parsed registry document (raw YAML — never the bridge's projection). */
export function loadCommunityRegistryDoc(forgeRoot) {
  return yaml.load(readFileSync(join(forgeRoot, 'studio', 'community', 'registry.yaml'), 'utf8'));
}

/** Mirrors community-source-url.ts's GitHub segment grammar byte-for-byte. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The `sources:` key for a `sourceUrl`, or `null` when the row names no
 * upstream this harness recognises.
 *
 * Only the GitHub arm is mirrored, on purpose and honestly: production also
 * parses npmjs.com and registry.modelcontextprotocol.io URLs, but NEITHER of
 * those upstreams publishes a star count, and the shipped registry carries no
 * such row today — every row is either a github.com repo or (for
 * `pre-impl-interview`) a blog post, which resolves to no upstream at all and
 * is honestly unrefreshable. A row this returns `null` for is treated exactly
 * the way production treats one: no source row, no signals, never fabricated.
 */
export function communitySourceKeyLocal(sourceUrl) {
  let u;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  // The same structural refusals production applies: https only, no userinfo,
  // no explicit non-default port.
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return null;
  if (u.hostname !== 'github.com') return null;
  const segs = u.pathname.split('/').filter((s) => s.length > 0);
  if (segs.length < 2) return null;
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!GITHUB_SEGMENT_RE.test(owner) || !GITHUB_SEGMENT_RE.test(repo)) return null;
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

/**
 * The repo-level facts row for one registry item, or `null` when its
 * `sourceUrl` names no recognised upstream (or the registry has no row for it
 * yet). A `null` is the honest "never verified" state — never a fabricated
 * zero, and never an item-local copy.
 */
export function communitySourceRowFor(doc, item) {
  const key = communitySourceKeyLocal(item?.sourceUrl ?? '');
  if (key === null) return null;
  return (doc?.sources ?? {})[key] ?? null;
}

/**
 * The highest numeric `stars` any of the registry's `sources:` rows carries,
 * with the source key that holds it — recomputed off the raw YAML, never off
 * a page's or the bridge's own claim. Throws when NO source row carries a
 * number: a registry that lost its star data must fail the gate loudly rather
 * than let a "stars" sort assertion quietly pass against nothing.
 */
export function topStarredCommunitySource(doc) {
  const sources = doc?.sources ?? {};
  const rows = Object.keys(sources)
    .map((key) => ({ key, stars: sources[key]?.stars ?? null }))
    .filter((row) => typeof row.stars === 'number');
  if (rows.length === 0) {
    throw new Error(
      'community journey: expected at least one studio/community/registry.yaml "sources" row with a numeric stars value ' +
      '(schema v2 keeps stars on the SOURCE, keyed by sourceUrl — never on the item)',
    );
  }
  return rows.reduce((best, cur) => (cur.stars > best.stars ? cur : best));
}
